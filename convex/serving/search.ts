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

// Bedrock Titan v2 score distribution (observed empirically, April 2026):
//   relevant in-domain:     0.55 - 0.75
//   weak in-domain:          0.45 - 0.55
//   irrelevant/off-domain:   0.25 - 0.40
//
// ADAPTIVE FLOOR (ADR-neop-runtime GAP-1 fix, 2026-06-30). A FIXED absolute cosine floor is the root
// error: cosine magnitudes are NOT comparable across query types (a lexical-overlap query's correct hit
// scores ~0.9; a zero-overlap paraphrase's correct hit scores ~0.36 — both correct). The GAP-1 box proof
// showed a legitimate #1 paraphrase at 0.358 sitting right at the old 0.35 floor. So gate by
//   keepThreshold = max(NOISE_FLOOR, topRaw × RELATIVE_KEEP_RATIO)
// NOISE_FLOOR is the ABSOLUTE minimum that preserves "I don't know" (empty when even the best hit is
// off-domain garbage); the relative term ADAPTS to query type and drops the weak tail. Lexical hits
// bypass entirely (they matched terms). NOISE_FLOOR is intentionally low (0.20, below legit paraphrase
// ~0.36, above off-domain noise ~0.25-).
const DEFAULT_SIMILARITY_FLOOR = 0.2; // = NOISE_FLOOR (absolute minimum; preserves "I don't know")
const RELATIVE_KEEP_RATIO = 0.5; // keep results within this fraction of the top raw relevance
const DEFAULT_LIMIT = 5;

// Graph-boost tuning. Each matching entity in a closet adds this to its vector
// score; capped at GRAPH_BOOST_MAX. Keeps vector dominant but re-ranks ties.
const GRAPH_BOOST_PER_ENTITY = 0.05;
const GRAPH_BOOST_MAX = 0.2;

// Hybrid lexical channel (ADR-neop-runtime GAP-1 floor fix). A full-text hit contributes
// LEXICAL_WEIGHT / (1 + rank): a #1 lexical hit adds 0.5 (clears the cosine floor on its own), #2 adds
// 0.25, etc. A lexical match ALSO bypasses the similarity floor — it matched terms, so it is relevant by
// a criterion the cosine floor doesn't measure. Vector still handles pure-semantic paraphrase (which
// already clears the 0.35 floor at ~0.36); lexical rescues exact-term and marginal-vector-but-on-topic.
const LEXICAL_WEIGHT = 0.5;

// Previously-unused signals now folded into ranking (Tier 1 quick-wins):
//   - closet.confidence: extraction-quality proxy (high when Gemini/Llama
//     was confident). Slightly boosts well-extracted closets.
//   - createdAt age: gentle recency decay, half-life 90 days. Lets fresh
//     memories float up when two results tie on vector+graph.
//   - same-room penalty: first result from a room pays nothing; subsequent
//     results from the same room get docked. Cheap MMR-lite, prevents
//     five near-duplicates dominating top-5.
const CONFIDENCE_WEIGHT = 0.05;
const RECENCY_WEIGHT = 0.05;
const RECENCY_HALF_LIFE_DAYS = 90;
const SAME_ROOM_PENALTY = 0.03;

// Confidence thresholds recalibrated for Titan's compressed score range.
// Previously 0.7/0.5 — tuned for Qwen3's wider distribution.
const CONF_HIGH_THRESHOLD = 0.65;
const CONF_MEDIUM_THRESHOLD = 0.50;

function recencyFactor(createdAt: number): number {
  const ageDays = (Date.now() - createdAt) / 86_400_000;
  // Exponential decay: 1.0 at ingest, ~0.5 at half-life, ~0.25 at 2× half-life.
  return Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS);
}

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

  // 5. Score every candidate; gate ADAPTIVELY afterward (not a fixed absolute cosine — see the
  //    DEFAULT_SIMILARITY_FLOOR comment). rawRelevance = vector+graph ONLY (bonuses excluded from the
  //    gate so a fresh/confident closet can't sneak past on an unrelated query).
  const scored: Array<{ result: SearchResult; rawRelevance: number; isLexical: boolean }> = [];

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

    const vectorScore = scoreMap.get(closet._id as string) ?? 0;
    const graphBoost = Math.min(
      (graphBoostMap.get(closet._id as string) ?? 0) * GRAPH_BOOST_PER_ENTITY,
      GRAPH_BOOST_MAX,
    );
    // Hybrid lexical boost: rank-weighted (#1 = +0.5, #2 = +0.25, …). A lexical match also bypasses the
    // adaptive floor below — it matched query terms (relevance cosine doesn't measure).
    const lrank = lexicalRank.get(closet._id as string);
    const isLexical = lrank !== undefined;
    const lexicalBoost = isLexical ? LEXICAL_WEIGHT / (1 + lrank!) : 0;
    const confidenceBoost = closet.confidence * CONFIDENCE_WEIGHT;
    const recencyBoost = recencyFactor(closet.createdAt) * RECENCY_WEIGHT;
    const score = vectorScore + graphBoost + lexicalBoost + confidenceBoost + recencyBoost;

    scored.push({
      rawRelevance: vectorScore + graphBoost,
      isLexical,
      result: {
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
      },
    });
  }

  // 5b. ADAPTIVE floor: keepThreshold = max(NOISE_FLOOR, topRaw × RELATIVE_KEEP_RATIO). The noise floor
  // (args.similarityFloor) preserves "I don't know" — if even the best hit is below it AND nothing matched
  // lexically, results is empty rather than best-of-garbage. The relative term adapts to query type and
  // drops the weak tail. Lexical hits always survive. (ADR-neop-runtime GAP-1 floor fix.)
  const topRaw = scored.reduce((m, c) => Math.max(m, c.rawRelevance), 0);
  const keepThreshold = Math.max(args.similarityFloor, topRaw * RELATIVE_KEEP_RATIO);
  const results: SearchResult[] = scored
    .filter((c) => c.isLexical || c.rawRelevance >= keepThreshold)
    .map((c) => c.result);

  // Re-rank by final score.
  results.sort((a, b) => b.score - a.score);

  // MMR-lite: apply same-room penalty greedily so top-K spans rooms.
  // Pass 1: pick top result; Pass N: any subsequent pick from a room
  // we've already picked from pays SAME_ROOM_PENALTY per prior pick,
  // then we re-sort the remaining pool.
  const diversified: SearchResult[] = [];
  const roomCount = new Map<string, number>();
  const pool = [...results];
  while (diversified.length < args.limit && pool.length > 0) {
    // Apply current penalty snapshot + re-rank pool.
    pool.sort((a, b) => {
      const penA = (roomCount.get(a.roomId) ?? 0) * SAME_ROOM_PENALTY;
      const penB = (roomCount.get(b.roomId) ?? 0) * SAME_ROOM_PENALTY;
      return (b.score - penB) - (a.score - penA);
    });
    const pick = pool.shift()!;
    diversified.push(pick);
    roomCount.set(pick.roomId, (roomCount.get(pick.roomId) ?? 0) + 1);
  }
  results.length = 0;
  results.push(...diversified);

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
