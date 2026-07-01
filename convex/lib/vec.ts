// Vector helpers shared by the serving layer. Kept out of search.ts ("use node") so pure math is unit-
// testable without pulling the action's runtime.

// Cosine similarity for the recency fallback (ADR-neop-runtime index-propagation fix) — MUST match Convex
// vectorSearch's `_score` metric (cosine) so recency-scored candidates are comparable to vector-scored ones
// in the same fusion. Titan v2 vectors are server-normalized (cosine == dot), but we normalize defensively
// so the two channels never diverge. Returns 0 on length mismatch / zero vector (never NaN).
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
