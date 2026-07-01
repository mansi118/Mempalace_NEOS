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
import { embedOne } from "../lib/embedder.js";
import { graphSearch, buildGraphBoostMap } from "../lib/graphClient.js";
import { cosineSimilarity } from "../lib/vec.js";
import {
  fuseAndRank,
  DEFAULT_SIMILARITY_FLOOR,
  type FusionInput,
  type SearchResult,
} from "../lib/fusion.js";

// Scoring/gating/diversification constants + the adaptive-floor fusion now live in `lib/fusion.ts`
// (pure + unit-tested — the load-bearing decision path is provable offline, unlike when it was inline in
// this "use node" action). search.ts keeps only the orchestration knobs below.
const DEFAULT_LIMIT = 5;

// Recency fallback window (ADR-neop-runtime index-propagation fix). The async vector/search indexes lag
// (stall-leaning on the self-hosted backend), so the last-N closets by createdAt are additionally scored
// via cosine computed directly from their transactionally-available stored embedding — routing fresh
// writes around the async index. Only recents NOT already found by the vector channel are cosine-scored.
const RECENCY_WINDOW = 25;

// Confidence thresholds recalibrated for Titan's compressed score range (top final score → high/medium/low).
const CONF_HIGH_THRESHOLD = 0.65;
const CONF_MEDIUM_THRESHOLD = 0.50;

// ─── Types (SearchResult re-exported from lib/fusion) ───────────

export type { SearchResult };

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
  neopId?: string;
  mode?: string; // "live" (default) | "test" | "benchmark"
}

// djb2 hash — deterministic across runtimes, enough for cache keys.
function hashQuery(query: string, palaceId: string, wing?: string, cat?: string): string {
  const input = `${query}::${palaceId}::${wing ?? ""}::${cat ?? ""}`;
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
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

  // 1. Look up palace, then embed + graph-search in parallel.
  //
  // (Query expansion via Groq was prototyped in lib/queryExpander.ts but
  // measured a regression on this corpus — the Tier 1 score was already
  // at 100% R@5 hard and expansion added noise. Keep the module for
  // future use on sparser palaces where base retrieval actually misses.)
  const palaceDoc: Doc<"palaces"> | null = await ctx.runQuery(
    internal.serving.enrich.getPalaceForSearch,
    { palaceId: args.palaceId },
  );
  const clientId = palaceDoc?.clientId ?? "";

  // #6: retrieval degrades GRACEFULLY when the embedder is unavailable (credential absent /
  // provider blocked) — return the structured low-confidence shape instead of an uncaught 500.
  // embeddingHealth surfaces the root cause. The graph is advisory, so its failure never blocks.
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedOne(trimmed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      results: [],
      confidence: "low" as const,
      reason: `retrieval_unavailable: embedder error (${msg.slice(0, 80)})`,
      tokenEstimate: 0,
      queryTimeMs: 0,
    };
  }
  const graphHits = clientId
    ? await graphSearch(clientId, trimmed, 15).catch(() => [])
    : [];

  const graphBoostMap = buildGraphBoostMap(graphHits);

  // 2. Vector search — actions have ctx.vectorSearch.
  //    Returns { _id, _score } where _id is the closet_embeddings doc ID,
  //    NOT the closetId. We resolve in step 3.
  const vectorHits: Array<{ _id: string; _score: number }> =
    await ctx.vectorSearch("closet_embeddings", "by_embedding", {
      vector: queryEmbedding,
      limit: args.limit * 3, // overfetch for post-filtering
      filter: (q: any) => q.eq("palaceId", args.palaceId),
    });

  // NOTE: no early return on empty vectorHits — a fresh write may be invisible to the async vector index
  // yet recallable via the lexical channel (3b) or the recency fallback (3c). Bailing here would strand
  // exactly the fresh-write case this path exists to serve; the real empty guard is `closetIds.length === 0`
  // after all three channels have run.

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

  // 3b. Hybrid lexical channel (ADR-neop-runtime GAP-1 floor fix). Run full-text search and UNION its
  //     hits into the candidate set — exact-term matches the vector top-k missed are added here; a
  //     lexical hit later bypasses the cosine floor (step 5) and gets a rank-weighted boost. Vector
  //     stays primary; lexical rescues exact-term + marginal-vector-but-on-topic recall.
  const lexicalIds: string[] = await ctx.runQuery(
    internal.serving.enrich.lexicalSearchClosets,
    { palaceId: args.palaceId, query: trimmed, limit: args.limit * 3 },
  );
  const lexicalRank = new Map<string, number>();
  lexicalIds.forEach((id, i) => lexicalRank.set(id, i));
  for (const id of lexicalIds) {
    if (!scoreMap.has(id)) {
      closetIds.push(id as Id<"closets">);
      scoreMap.set(id, 0); // no vector score; surfaced via lexical boost + floor bypass
    }
  }

  // 3c. Recency fallback channel (ADR-neop-runtime index-propagation fix). The async vector/search indexes
  //     lag (stall-leaning on the self-hosted backend — box-proven), so steps 2–3b can miss a just-written
  //     closet until its index entry builds. Fetch the last-N by createdAt via the TRANSACTIONAL by_time
  //     index WITH their stored embeddings (present the moment storeEmbedding ran — only the vector INDEX is
  //     async) and score each with cosine computed directly here. A recency candidate already found by the
  //     vector channel is skipped (the async index caught up). Its real cosine feeds the SAME fusion + gate
  //     (NOT a floor bypass — we have true relevance) so a fresh fact surfaces when relevant, never always.
  const recents: Array<{ closetId: string; embedding: number[] }> = await ctx.runQuery(
    internal.serving.enrich.recentClosetsWithEmbeddings,
    { palaceId: args.palaceId, limit: RECENCY_WINDOW },
  );
  for (const rc of recents) {
    if (scoreMap.has(rc.closetId)) continue; // already surfaced by the vector channel — index caught up
    closetIds.push(rc.closetId as Id<"closets">);
    scoreMap.set(rc.closetId, cosineSimilarity(queryEmbedding, rc.embedding));
  }

  // Note: graph results are only used to re-rank vector hits (step 5 boost).
  // We deliberately do NOT inject graph-only closets here — the similarity
  // floor is the guardrail that makes "I don't know" first-class, and
  // CONTAINS-based entity search is too loose for short out-of-domain queries.

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

  // 5. Build fusion inputs (apply retracted/decayed/superseded + wing/category/time filters here), then
  //    hand off to the PURE fuseAndRank (lib/fusion) for scoring + adaptive-floor gate + MMR-lite diversify.
  //    The decision path lives in fusion.ts so it is unit-testable without this "use node" action.
  const fusionInputs: FusionInput[] = [];
  for (const item of enriched) {
    if (!item) continue;
    const { closet, wingName, roomName } = item;

    if (closet.retracted) continue;
    if (closet.decayed) continue;
    if (closet.supersededBy !== undefined) continue;
    if (args.wingFilter && wingName !== args.wingFilter) continue;
    if (args.categoryFilter && closet.category !== args.categoryFilter) continue;
    if (args.afterTs && closet.createdAt < args.afterTs) continue;
    if (args.beforeTs && closet.createdAt > args.beforeTs) continue;

    fusionInputs.push({
      closetId: closet._id as string,
      content: closet.content,
      title: closet.title ?? undefined,
      category: closet.category,
      wingId: closet.wingId as string,
      wingName,
      roomId: closet.roomId as string,
      roomName,
      createdAt: closet.createdAt,
      sourceAdapter: closet.sourceAdapter,
      confidence: closet.confidence,
      vectorScore: scoreMap.get(closet._id as string) ?? 0, // vector cosine OR recency-computed cosine OR 0
      graphMatchCount: graphBoostMap.get(closet._id as string) ?? 0,
      lexicalRank: lexicalRank.get(closet._id as string), // undefined ⇒ not a lexical hit
    });
  }

  const results: SearchResult[] = fuseAndRank(fusionInputs, {
    similarityFloor: args.similarityFloor,
    limit: args.limit,
    now: Date.now(),
  });

  // 6. Determine overall confidence.
  let confidence: "high" | "medium" | "low" = "low";
  let reason = "no_match_above_floor";

  if (results.length > 0) {
    const topScore = results[0]!.score;
    confidence =
      topScore >= CONF_HIGH_THRESHOLD
        ? "high"
        : topScore >= CONF_MEDIUM_THRESHOLD
          ? "medium"
          : "low";
    reason = "ok";
  }

  // 7. Estimate tokens (rough: 1 token ≈ 4 chars).
  const totalChars = results.reduce((sum, r) => sum + r.content.length, 0);
  const tokenEstimate = Math.ceil(totalChars / 4);

  const queryTimeMs = Date.now() - t0;

  // 8. Log query (best-effort; don't block on failure).
  try {
    await ctx.runMutation(internal.palace.mutations.logQuery, {
      palaceId: args.palaceId,
      neopId: args.neopId,
      query: trimmed,
      queryHash: hashQuery(trimmed, args.palaceId, args.wingFilter, args.categoryFilter),
      resultCount: results.length,
      topScore: results[0]?.score ?? 0,
      confidence,
      latencyMs: queryTimeMs,
      mode: args.mode ?? "live",
      wingFilter: args.wingFilter,
      categoryFilter: args.categoryFilter,
    });
  } catch {
    // Logging failure is never allowed to break a search.
  }

  return {
    results,
    confidence,
    reason,
    tokenEstimate,
    queryTimeMs,
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
