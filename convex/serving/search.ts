// Palace search — vector semantic search + metadata enrichment.
//
// This is the L2 serving layer. Query flow:
//   1. Embed query with Voyage 4 (input_type="query" — asymmetric)
//   2. Vector search against closet_embeddings (palace-scoped)
//   3. Post-filter: retracted, decayed, superseded, wing/category filters
//   4. Apply similarity floor (0.5 default — "I don't know" is first-class)
//   5. Enrich results with room/wing metadata
//   6. Return context block for NEop system prompt injection
//
// Phase 5 will add graph search (Graphiti bridge) as a parallel path,
// merged with vector results. For now, vector-only.
//
// Architecture notes:
//   - vectorSearch is only available in queries/mutations, not actions.
//     So we use an internalAction that calls an internalQuery for the
//     vector search step, then enriches in a second internal query.
//   - Wing filtering is post-filter (vectorSearch filterFields only
//     supports single eq, not compound AND). We overfetch 3x to compensate.

import { action, internalAction, internalQuery } from "../_generated/server.js";
import { api, internal } from "../_generated/api.js";
import { v } from "convex/values";
import type { Id, Doc } from "../_generated/dataModel.js";

const DEFAULT_SIMILARITY_FLOOR = 0.5;
const DEFAULT_LIMIT = 5;

// ─── Types ──────────────────────────────────────────────────────

export interface SearchResult {
  closetId: string;
  score: number;
  content: string;
  title?: string;
  category: string;
  wingId: string;
  wingName: string;
  roomId: string;
  roomName: string;
  createdAt: number;
  sourceAdapter: string;
  confidence: number;
}

export interface SearchResponse {
  results: SearchResult[];
  confidence: "high" | "medium" | "low";
  reason: string;
  tokenEstimate: number;
  queryTimeMs: number;
}

// ─── Closet enrichment (internal query) ─────────────────────────

export const enrichClosets = internalQuery({
  args: {
    closetIds: v.array(v.id("closets")),
  },
  handler: async (ctx, { closetIds }) => {
    const results: Array<{
      closet: Doc<"closets">;
      wingName: string;
      roomName: string;
    } | null> = [];

    for (const id of closetIds) {
      const closet = await ctx.db.get(id);
      if (!closet) {
        results.push(null);
        continue;
      }

      const wing = await ctx.db.get(closet.wingId);
      const room = await ctx.db.get(closet.roomId);

      results.push({
        closet,
        wingName: wing?.name ?? "unknown",
        roomName: room?.name ?? "unknown",
      });
    }

    return results;
  },
});

// ─── L2 Search: Full palace search ──────────────────────────────

export const searchPalace = action({
  args: {
    palaceId: v.id("palaces"),
    query: v.string(),
    wingFilter: v.optional(v.string()),
    categoryFilter: v.optional(v.string()),
    limit: v.optional(v.number()),
    similarityFloor: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SearchResponse> => {
    const t0 = Date.now();
    const limit = args.limit ?? DEFAULT_LIMIT;
    const floor = args.similarityFloor ?? DEFAULT_SIMILARITY_FLOOR;

    // 1. Embed query (asymmetric — input_type="query").
    const queryEmbedding: number[] = await ctx.runAction(
      api.ingestion.embed.embedQuery,
      { text: args.query },
    );

    // 2. Vector search — actions have ctx.vectorSearch.
    // Note: hand-written _generated types don't express vector index names;
    // `npx convex dev` regenerates with full type coverage. Cast for now.
    const vectorHits = await (ctx as any).vectorSearch(
      "closet_embeddings",
      "by_embedding",
      {
        vector: queryEmbedding,
        limit: limit * 3,
        filter: (q: any) => q.eq("palaceId", args.palaceId),
      },
    ) as Array<{ _id: string; _score: number; closetId: string }>;

    if (vectorHits.length === 0) {
      return {
        results: [],
        confidence: "low",
        reason: "no_vector_hits",
        tokenEstimate: 0,
        queryTimeMs: Date.now() - t0,
      };
    }

    // 3. Extract closetIds from embedding hits and build score map.
    const embeddingClosetIds: Id<"closets">[] = [];
    const scoreMap = new Map<string, number>();

    for (const hit of vectorHits) {
      const closetId = (hit as unknown as { closetId: Id<"closets"> }).closetId;
      const score = hit._score;
      embeddingClosetIds.push(closetId);
      scoreMap.set(closetId as string, score);
    }

    // 4. Enrich with closet + room/wing metadata.
    const enriched = await ctx.runQuery(
      internal.serving.search.enrichClosets,
      { closetIds: embeddingClosetIds },
    );

    // 5. Post-filter and rank.
    const results: SearchResult[] = [];

    for (const item of enriched) {
      if (!item) continue;
      const { closet, wingName, roomName } = item;

      // Skip retracted, decayed, older versions.
      if (closet.retracted) continue;
      if (closet.decayed) continue;
      if (closet.supersededBy !== undefined) continue;

      // Wing filter (post-filter since vectorSearch only filters by palaceId).
      if (args.wingFilter && wingName !== args.wingFilter) continue;

      // Category filter.
      if (args.categoryFilter && closet.category !== args.categoryFilter) continue;

      const score = scoreMap.get(closet._id as string) ?? 0;

      // Similarity floor — "I don't know" is first-class (gap F4).
      if (score < floor) continue;

      results.push({
        closetId: closet._id,
        score,
        content: closet.content,
        title: closet.title ?? undefined,
        category: closet.category,
        wingId: closet.wingId,
        wingName,
        roomId: closet.roomId,
        roomName,
        createdAt: closet.createdAt,
        sourceAdapter: closet.sourceAdapter,
        confidence: closet.confidence,
      });

      if (results.length >= limit) break;
    }

    // 6. Determine overall confidence.
    let confidence: "high" | "medium" | "low" = "low";
    let reason = "no_match_above_floor";

    if (results.length > 0) {
      const topScore = results[0]!.score;
      confidence = topScore >= 0.8 ? "high" : topScore >= 0.65 ? "medium" : "low";
      reason = "ok";
    }

    // 7. Estimate tokens (rough: 1 token ≈ 4 chars).
    const totalChars = results.reduce(
      (sum: number, r: SearchResult) => sum + r.content.length,
      0,
    );
    const tokenEstimate = Math.ceil(totalChars / 4);

    return {
      results,
      confidence,
      reason,
      tokenEstimate,
      queryTimeMs: Date.now() - t0,
    };
  },
});

// ─── L2 Wing-scoped search ──────────────────────────────────────

export const searchWing = action({
  args: {
    palaceId: v.id("palaces"),
    wingName: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
    similarityFloor: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SearchResponse> => {
    return ctx.runAction(api.serving.search.searchPalace, {
      palaceId: args.palaceId,
      query: args.query,
      wingFilter: args.wingName,
      limit: args.limit,
      similarityFloor: args.similarityFloor,
    });
  },
});

// ─── L2 Temporal search ─────────────────────────────────────────

export const searchTemporal = action({
  args: {
    palaceId: v.id("palaces"),
    query: v.string(),
    after: v.optional(v.number()),
    before: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SearchResponse> => {
    // Run standard search then post-filter by time range.
    const base: SearchResponse = await ctx.runAction(
      api.serving.search.searchPalace,
      {
        palaceId: args.palaceId,
        query: args.query,
        limit: (args.limit ?? DEFAULT_LIMIT) * 3, // overfetch for time filter
      },
    );

    const filtered = base.results.filter((r: SearchResult) => {
      if (args.after && r.createdAt < args.after) return false;
      if (args.before && r.createdAt > args.before) return false;
      return true;
    });

    const limited = filtered.slice(0, args.limit ?? DEFAULT_LIMIT);
    const topScore = limited[0]?.score ?? 0;

    return {
      results: limited,
      confidence:
        limited.length === 0
          ? "low"
          : topScore >= 0.8
            ? "high"
            : topScore >= 0.65
              ? "medium"
              : "low",
      reason: limited.length === 0 ? "no_match_in_time_range" : "ok",
      tokenEstimate: Math.ceil(
        limited.reduce((s: number, r: SearchResult) => s + r.content.length, 0) / 4,
      ),
      queryTimeMs: base.queryTimeMs,
    };
  },
});
