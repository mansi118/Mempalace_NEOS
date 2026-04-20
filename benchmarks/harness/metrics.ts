// Standard Information Retrieval metrics.
// All functions take retrieved IDs (ranked) and relevant IDs (unranked gold set).

/**
 * Recall@K: fraction of relevant docs found in top K results.
 */
export function recallAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0;
  const topK = retrieved.slice(0, k);
  const found = topK.filter(id => relevant.has(id)).length;
  return found / relevant.size;
}

/**
 * Precision@K: fraction of top K results that are relevant.
 */
export function precisionAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  const topK = retrieved.slice(0, k);
  if (topK.length === 0) return 0;
  const found = topK.filter(id => relevant.has(id)).length;
  return found / topK.length;
}

/**
 * MRR (Mean Reciprocal Rank): 1/rank of first relevant result.
 */
export function reciprocalRank(retrieved: string[], relevant: Set<string>): number {
  for (let i = 0; i < retrieved.length; i++) {
    if (relevant.has(retrieved[i]!)) return 1 / (i + 1);
  }
  return 0;
}

/**
 * nDCG@K: normalized discounted cumulative gain.
 */
export function ndcgAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  const topK = retrieved.slice(0, k);

  // DCG: sum of 1/log2(rank+1) for relevant docs.
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    if (relevant.has(topK[i]!)) {
      dcg += 1 / Math.log2(i + 2); // i+2 because rank is 1-indexed, log2(1)=0
    }
  }

  // Ideal DCG: all relevant docs at the top.
  const idealCount = Math.min(relevant.size, k);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * F1 token overlap between predicted and gold answer strings.
 */
export function tokenF1(predicted: string, gold: string): number {
  const predTokens = new Set(predicted.toLowerCase().split(/\s+/));
  const goldTokens = new Set(gold.toLowerCase().split(/\s+/));
  if (predTokens.size === 0 || goldTokens.size === 0) return 0;

  let overlap = 0;
  for (const t of predTokens) if (goldTokens.has(t)) overlap++;

  const precision = overlap / predTokens.size;
  const recall = overlap / goldTokens.size;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Exact Match: normalized string comparison.
 */
export function exactMatch(predicted: string, gold: string): boolean {
  const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");
  return norm(predicted) === norm(gold);
}

// ─── Aggregate metrics across queries ────────────────────────

export interface QueryResult {
  queryId: string;
  query: string;
  retrievedIds: string[];
  relevantIds: Set<string>;
  scores?: number[];
  latencyMs?: number;
}

export interface BenchmarkResult {
  name: string;
  timestamp: string;
  corpusSize: number;
  queryCount: number;
  metrics: {
    "R@1": number;
    "R@5": number;
    "R@10": number;
    "MRR@10": number;
    "nDCG@10": number;
    "P@5": number;
    avgLatencyMs: number;
    medianLatencyMs: number;
    p95LatencyMs: number;
  };
  perQuery: Array<{
    queryId: string;
    query: string;
    "R@5": number;
    "nDCG@10": number;
    mrr: number;
    latencyMs?: number;
    topResult?: string;
    correct: boolean;
  }>;
}

export function computeBenchmark(
  name: string,
  results: QueryResult[],
  corpusSize: number,
): BenchmarkResult {
  const n = results.length;
  if (n === 0) {
    return {
      name, timestamp: new Date().toISOString(), corpusSize, queryCount: 0,
      metrics: { "R@1": 0, "R@5": 0, "R@10": 0, "MRR@10": 0, "nDCG@10": 0, "P@5": 0, avgLatencyMs: 0, medianLatencyMs: 0, p95LatencyMs: 0 },
      perQuery: [],
    };
  }

  let sumR1 = 0, sumR5 = 0, sumR10 = 0, sumMRR = 0, sumNDCG = 0, sumP5 = 0;
  const latencies: number[] = [];
  const perQuery: BenchmarkResult["perQuery"] = [];

  for (const r of results) {
    const r1 = recallAtK(r.retrievedIds, r.relevantIds, 1);
    const r5 = recallAtK(r.retrievedIds, r.relevantIds, 5);
    const r10 = recallAtK(r.retrievedIds, r.relevantIds, 10);
    const mrr = reciprocalRank(r.retrievedIds.slice(0, 10), r.relevantIds);
    const ndcg = ndcgAtK(r.retrievedIds, r.relevantIds, 10);
    const p5 = precisionAtK(r.retrievedIds, r.relevantIds, 5);

    sumR1 += r1; sumR5 += r5; sumR10 += r10;
    sumMRR += mrr; sumNDCG += ndcg; sumP5 += p5;
    if (r.latencyMs) latencies.push(r.latencyMs);

    perQuery.push({
      queryId: r.queryId,
      query: r.query,
      "R@5": r5,
      "nDCG@10": ndcg,
      mrr,
      latencyMs: r.latencyMs,
      topResult: r.retrievedIds[0],
      correct: r1 > 0,
    });
  }

  latencies.sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => arr.length ? arr[Math.min(Math.floor(p / 100 * arr.length), arr.length - 1)]! : 0;

  return {
    name,
    timestamp: new Date().toISOString(),
    corpusSize,
    queryCount: n,
    metrics: {
      "R@1": +(sumR1 / n).toFixed(4),
      "R@5": +(sumR5 / n).toFixed(4),
      "R@10": +(sumR10 / n).toFixed(4),
      "MRR@10": +(sumMRR / n).toFixed(4),
      "nDCG@10": +(sumNDCG / n).toFixed(4),
      "P@5": +(sumP5 / n).toFixed(4),
      avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
      medianLatencyMs: pct(latencies, 50),
      p95LatencyMs: pct(latencies, 95),
    },
    perQuery,
  };
}
