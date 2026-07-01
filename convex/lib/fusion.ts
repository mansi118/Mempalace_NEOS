// Pure ranking/gating fusion for palace search — EXTRACTED from search.ts ("use node") so the load-bearing
// scoring + adaptive-floor gate + MMR-lite diversification is UNIT-TESTABLE without the vectorSearch action.
//
// Why this exists (2026-07-01, post-mortem): the recency fallback shipped with its fusion logic inline in a
// "use node" action that convex-test can't run, so its live behavior was unprovable offline — it went to a
// live palace unverified and, on an already-broken index, looked like a total failure. This module makes the
// exact decision path testable: given scored candidates (vector / recency / lexical), does a clear-cosine
// fresh-write candidate survive when the vector channel is empty? does off-domain garbage stay filtered?
//
// The gate is ADAPTIVE (ADR-neop-runtime GAP-1 fix): keepThreshold = max(NOISE_FLOOR, topRaw × ratio).
// rawRelevance = vector+graph ONLY (bonuses excluded from the gate). Lexical hits bypass the floor.

export const DEFAULT_SIMILARITY_FLOOR = 0.2; // NOISE_FLOOR — absolute minimum; preserves "I don't know"
export const RELATIVE_KEEP_RATIO = 0.5; // keep within this fraction of the top raw relevance
export const GRAPH_BOOST_PER_ENTITY = 0.05;
export const GRAPH_BOOST_MAX = 0.2;
export const LEXICAL_WEIGHT = 0.5;
export const CONFIDENCE_WEIGHT = 0.05;
export const RECENCY_WEIGHT = 0.05;
export const RECENCY_HALF_LIFE_DAYS = 90;
export const SAME_ROOM_PENALTY = 0.03;

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

// One candidate entering the fusion, already enriched + filtered (retracted/decayed/wing/category/time
// filters applied upstream). vectorScore = cosine from the vector channel OR the recency channel's directly-
// computed cosine OR 0 (lexical-only). graphMatchCount = entities matched (→ graphBoost). lexicalRank
// undefined ⇒ not a lexical hit (so it does NOT bypass the floor).
export interface FusionInput {
  closetId: string;
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
  vectorScore: number;
  graphMatchCount: number;
  lexicalRank?: number;
}

// Gentle recency decay, half-life 90d. `now` injected (not Date.now()) so the fusion is deterministic/testable.
export function recencyFactor(createdAt: number, now: number): number {
  const ageDays = (now - createdAt) / 86_400_000;
  return Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS);
}

export interface FusionOpts {
  similarityFloor: number;
  limit: number;
  now: number;
}

// Score → adaptive-floor gate → rank → MMR-lite diversify. Pure; identical math to the prior inline path.
export function fuseAndRank(inputs: FusionInput[], opts: FusionOpts): SearchResult[] {
  const scored = inputs.map((i) => {
    const graphBoost = Math.min(i.graphMatchCount * GRAPH_BOOST_PER_ENTITY, GRAPH_BOOST_MAX);
    const isLexical = i.lexicalRank !== undefined;
    const lexicalBoost = isLexical ? LEXICAL_WEIGHT / (1 + (i.lexicalRank as number)) : 0;
    const confidenceBoost = i.confidence * CONFIDENCE_WEIGHT;
    const recencyBoost = recencyFactor(i.createdAt, opts.now) * RECENCY_WEIGHT;
    const score = i.vectorScore + graphBoost + lexicalBoost + confidenceBoost + recencyBoost;
    // rawRelevance = vector+graph ONLY (bonuses excluded from the gate so a fresh/confident closet can't
    // sneak past the floor on an unrelated query).
    const rawRelevance = i.vectorScore + graphBoost;
    return { i, score, rawRelevance, isLexical };
  });

  // ADAPTIVE floor: noise floor preserves "I don't know"; relative term drops the weak tail. Lexical bypasses.
  const topRaw = scored.reduce((m, s) => Math.max(m, s.rawRelevance), 0);
  const keepThreshold = Math.max(opts.similarityFloor, topRaw * RELATIVE_KEEP_RATIO);
  const kept = scored.filter((s) => s.isLexical || s.rawRelevance >= keepThreshold);
  kept.sort((a, b) => b.score - a.score);

  // MMR-lite: greedy same-room penalty so top-K spans rooms.
  const diversified: typeof kept = [];
  const roomCount = new Map<string, number>();
  const pool = [...kept];
  while (diversified.length < opts.limit && pool.length > 0) {
    pool.sort((a, b) => {
      const penA = (roomCount.get(a.i.roomId) ?? 0) * SAME_ROOM_PENALTY;
      const penB = (roomCount.get(b.i.roomId) ?? 0) * SAME_ROOM_PENALTY;
      return (b.score - penB) - (a.score - penA);
    });
    const pick = pool.shift() as (typeof kept)[number];
    diversified.push(pick);
    roomCount.set(pick.i.roomId, (roomCount.get(pick.i.roomId) ?? 0) + 1);
  }

  return diversified.map((s) => ({
    closetId: s.i.closetId,
    score: s.score,
    content: s.i.content,
    title: s.i.title,
    category: s.i.category,
    wingId: s.i.wingId,
    wingName: s.i.wingName,
    roomId: s.i.roomId,
    roomName: s.i.roomName,
    createdAt: s.i.createdAt,
    sourceAdapter: s.i.sourceAdapter,
    confidence: s.i.confidence,
  }));
}
