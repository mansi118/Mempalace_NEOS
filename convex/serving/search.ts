"use node";
// Palace search — vector semantic search + metadata enrichment.
//
// This is the L2 serving layer. "use node" is required because we call
// the Gemini embedding API directly (avoiding action-to-action calls).
//
// Query flow:
//   1. Embed query with Gemini (taskType=RETRIEVAL_QUERY — asymmetric)
//   2. Vector search against closet_embeddings (palace-scoped)
//   3. Post-filter: retracted, decayed, superseded, wing/category filters
//   4. Apply similarity floor (0.5 default — "I don't know" is first-class)
//   5. Enrich results with room/wing metadata
//   6. Return context block for NEop system prompt injection
//
// Tier 1 fixes from ultrathink:
//   - NO action-to-action calls. Gemini API is called directly via
//     lib/gemini.ts. Search variants (searchWing, searchTemporal) call
//     a shared async function, not ctx.runAction.
//   - Empty query guard.
//   - Concurrent enrichment via Promise.all.

import { action } from "../_generated/server.js";
import { internal } from "../_generated/api.js";
import { v } from "convex/values";
import type { Id, Doc } from "../_generated/dataModel.js";
import { embedOne } from "../lib/qwen.js";

// Qwen3-Embedding-8B produces lower similarity scores than Voyage/Gemini.
// Calibrated from real query tests: relevant results score 0.4-0.8.
const DEFAULT_SIMILARITY_FLOOR = 0.35;
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

// ─── Core search logic (shared function, NOT an action) ─────────
//
// This is the fix for Tier 1 Issue A: searchWing and searchTemporal
// were calling searchPalace via ctx.runAction, which Convex forbids.
// Now they all call this shared function directly.

export interface CoreSearchArgs {
  palaceId: Id<"palaces">;
  query: string;
  wingFilter?: string;
  categoryFilter?: string;
  limit: number;
  similarityFloor: number;
  afterTs?: number;
  beforeTs?: number;
}

export async function coreSearch(
  ctx: any,
  args: CoreSearchArgs,
): Promise<SearchResponse> {
  const t0 = Date.now();

  // 0. Empty query guard.
  const trimmed = args.query.trim();
  if (!trimmed) {
    return {
      results: [],
      confidence: "low",
      reason: "empty_query",
      tokenEstimate: 0,
      queryTimeMs: 0,
    };
  }

  // 1. Embed query (asymmetric — RETRIEVAL_QUERY).
  //    Direct call to Gemini, not action-to-action.
  const queryEmbedding = await embedOne(trimmed);

  // 2. Vector search — actions have ctx.vectorSearch.
  //    Returns { _id, _score } where _id is the closet_embeddings doc ID,
  //    NOT the closetId. We resolve in step 3.
  const vectorHits: Array<{ _id: string; _score: number }> =
    await ctx.vectorSearch("closet_embeddings", "by_embedding", {
      vector: queryEmbedding,
      limit: args.limit * 3, // overfetch for post-filtering
      filter: (q: any) => q.eq("palaceId", args.palaceId),
    });

  if (vectorHits.length === 0) {
    return {
      results: [],
      confidence: "low",
      reason: "no_vector_hits",
      tokenEstimate: 0,
      queryTimeMs: Date.now() - t0,
    };
  }

  // 3. Resolve embedding doc IDs → closetIds via a query.
  //    vectorSearch only returns _id (embedding doc) + _score.
  const embeddingIds = vectorHits.map((h) => h._id);
  const scoreByEmbId = new Map(vectorHits.map((h) => [h._id, h._score]));

  const resolved: Array<{ closetId: string; embeddingId: string } | null> =
    await ctx.runQuery(internal.serving.enrich.resolveEmbeddingIds, {
      embeddingIds,
    });

  const closetIds: Id<"closets">[] = [];
  const scoreMap = new Map<string, number>();

  for (const r of resolved) {
    if (!r) continue;
    closetIds.push(r.closetId as Id<"closets">);
    scoreMap.set(r.closetId, scoreByEmbId.get(r.embeddingId) ?? 0);
  }

  if (closetIds.length === 0) {
    return {
      results: [],
      confidence: "low",
      reason: "no_valid_closets",
      tokenEstimate: 0,
      queryTimeMs: Date.now() - t0,
    };
  }

  // 4. Enrich with closet + room/wing metadata.
  const enriched: Array<{
    closet: Doc<"closets">;
    wingName: string;
    roomName: string;
  } | null> = await ctx.runQuery(internal.serving.enrich.enrichClosets, {
    closetIds,
  });

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

    // Time range filter (for searchTemporal).
    if (args.afterTs && closet.createdAt < args.afterTs) continue;
    if (args.beforeTs && closet.createdAt > args.beforeTs) continue;

    const score = scoreMap.get(closet._id as string) ?? 0;

    // Similarity floor — "I don't know" is first-class (gap F4).
    if (score < args.similarityFloor) continue;

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

    if (results.length >= args.limit) break;
  }

  // 6. Determine overall confidence.
  let confidence: "high" | "medium" | "low" = "low";
  let reason = "no_match_above_floor";

  if (results.length > 0) {
    const topScore = results[0]!.score;
    confidence =
      topScore >= 0.7 ? "high" : topScore >= 0.5 ? "medium" : "low";
    reason = "ok";
  }

  // 7. Estimate tokens (rough: 1 token ≈ 4 chars).
  const totalChars = results.reduce((sum, r) => sum + r.content.length, 0);
  const tokenEstimate = Math.ceil(totalChars / 4);

  return {
    results,
    confidence,
    reason,
    tokenEstimate,
    queryTimeMs: Date.now() - t0,
  };
}

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
    return coreSearch(ctx, {
      palaceId: args.palaceId,
      query: args.query,
      wingFilter: args.wingFilter,
      categoryFilter: args.categoryFilter,
      limit: args.limit ?? DEFAULT_LIMIT,
      similarityFloor: args.similarityFloor ?? DEFAULT_SIMILARITY_FLOOR,
    });
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
    return coreSearch(ctx, {
      palaceId: args.palaceId,
      query: args.query,
      wingFilter: args.wingName,
      limit: args.limit ?? DEFAULT_LIMIT,
      similarityFloor: args.similarityFloor ?? DEFAULT_SIMILARITY_FLOOR,
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
    return coreSearch(ctx, {
      palaceId: args.palaceId,
      query: args.query,
      limit: args.limit ?? DEFAULT_LIMIT,
      similarityFloor: DEFAULT_SIMILARITY_FLOOR,
      afterTs: args.after,
      beforeTs: args.before,
    });
  },
});
