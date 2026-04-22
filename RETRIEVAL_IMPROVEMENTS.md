# PALACE Retrieval — Deep Improvement Plan

**Generated:** 2026-04-22
**Current state:** Bedrock Titan v2 embeddings (1024d), Groq extraction, 425/429 closets with entity graph (1,325 entities, 11,303 relations). Vector search + graph boost (+0.05/entity, cap +0.2) wired into coreSearch.
**Goal:** Push R@5 medium from 87% → 95%+, hard from 40% → 75%+, while keeping "I don't know" at 100%.

---

## 1. What's actually happening right now

### Scoring signals in coreSearch (what's used)
- Vector cosine (Titan v2 normalized, 0-1)
- Graph boost: +0.05 per matching entity, cap +0.2
- Post-filters: retracted, decayed, supersededBy, wing, category, time

### Signals computed but NOT used for ranking (dead weight)
- **`closet.confidence`** [0-1] — extraction quality score, just metadata
- **`closet.createdAt`** — only used for `searchTemporal`, never as decay factor
- **`closet.sourceAdapter`** — stored, never used (claude-export vs markdown-archive may have different reliability)
- **`conflictGroupId`** — contradiction detector flags it but ranking ignores it
- **`closet.category`** — post-filter only; vector search wastes capacity on wrong-category matches
- **L1 wing index** — included in every context but never guides search away from empty wings

### Enrichment at index time
- Content is prefixed with `[wing/room]` before embedding ✓
- Title, category included ✓
- Facts folded in ✓
- Missing: **extracted entity list is NOT added to the embedded text** even though we now have 1,325 entities mapped to closets

### Enrichment at query time
- Query embedded raw, no expansion
- No synonym handling, no alias lookup (even though graph has aliases)
- No fallback if vector confidence low

---

## 2. High-Impact Improvements (prioritized)

### Tier 1 — Quick wins (no re-ingestion, <2h each, measurable impact)

**1.1 Confidence + recency into score** *(30 min)*
```ts
score = vectorScore
      + graphBoost                                    // +0 to +0.2
      + (confidence * 0.05)                           // trusted sources +0.05
      + decayFactor(createdAt, halfLifeDays=90) * 0.05  // recent +0 to +0.05
```
Hits Gap A + B simultaneously. Zero latency cost.

**1.2 MMR diversity in top-5** *(1h)*
After scoring, select top-5 with MMR (λ=0.7): each new result must be score-dominant AND semantically diverse from already-picked. Prevents 5 near-duplicates taking top 5. Uses stored embeddings, no API calls.

**1.3 Query cache** *(1h)*
New `query_cache` table keyed by hash(query + palaceId + filters). 5-min TTL. 95%+ hit rate for repeated queries in demos/benchmarks. Serves at <20ms.

**1.4 Confidence calibration** *(1h)*
Titan scores are compressed: relevant=0.55-0.75, irrelevant=0.25-0.40. Recalibrate:
- `high`: ≥0.65 (was 0.7)
- `medium`: 0.50-0.65 (was 0.5-0.7)
- `low`: <0.50 (was <0.5)
- Floor: 0.45 (was 0.35) for out-of-domain rejection

**1.5 Log query metadata** *(30 min)*
New `query_log` table: {query, resultCount, topScore, confidence, latency, palaceId, neopId, timestamp}. Enables Tier 2 data-driven improvements + benchmarks.

### Tier 2 — Query-side improvements (no re-ingestion, 2-5h each)

**2.1 Query expansion via Groq** *(3h)*
Before embed, call Groq `llama-3.1-8b-instant` with 500-token prompt: "Given this query about a NeuralEDGE knowledge base, output 3-5 related search terms as JSON: {expanded: [...]}". Cache by query hash. Fallback to raw query on error.

Expected impact: **hard R@5 40% → 60-70%**. Biggest single lever for hard queries.

**2.2 HyDE (Hypothetical Document Embeddings)** *(3h)*
For queries like "How does NeuralEDGE make money?", call Groq to generate a hypothetical ideal answer, embed THAT instead of the query. Search then finds docs closest to the ideal answer, not the question.

Expected impact: +10-15 pp on reasoning queries (complementary to 2.1). Add as a flag on searchPalace: `mode: "hyde" | "plain"`.

**2.3 Metadata pre-filter** *(2h)*
Extract tokens from query → check against `WING_KEYWORDS` in route.ts → if matched, pre-filter vector search by wingId. Shrinks search space AND boosts results from the right wing.

**2.4 Entity-aware query rewrite** *(2h)*
For every query, call `/graph/search` first → if entities match, append canonical names and aliases to query before embedding. E.g., "Who's Rahul?" → "Who's Rahul? Rahul Kashyap Dr. Rahul".

Uses existing graph. +5-10 pp on entity queries.

**2.5 Multi-query retrieval + RRF fusion** *(4h)*
Generate 3 query variants via Groq, embed each, union candidates, rank with Reciprocal Rank Fusion. Best practice in IR for catching phrasing misses.

### Tier 3 — Index-side (re-embedding needed, 4-8h)

**3.1 Include entities in embedded text** *(4h + re-embed 429 closets)*
After graph backfill, re-embed each closet with its top entities appended:
```
[clients/zoo-media] Zoo Media, Akhilesh Sabharwal, ICD NEop
Status
| Pillar | Status... |
```
We now have 1,325 entities mapped to 425 closets. This is low-hanging fruit. Re-embed cost: ~$0.01 via Bedrock.

Expected impact: +5-10 pp on entity queries, no impact elsewhere.

**3.2 Chunk long closets** *(6h + re-ingest)*
Closets >2000 chars get split into 500-char overlapping chunks. Index each chunk with parent pointer. Search returns chunk hits, deduplicates to parent closets.

Biggest recall win for the "Complete NEops Roster" problem (15 NEops in one closet).

**3.3 Switch to Cohere embed-english-v3 on Bedrock** *(3h + re-embed)*
Cohere v3 is asymmetric (`input_type: "search_document" | "search_query"`) vs Titan's symmetric embedding. Asymmetric usually adds 2-5 pp on retrieval.

Same Bedrock bearer-token auth, no new creds. Drop-in replacement.

### Tier 4 — Structural (re-ingest, 6-10h)

**4.1 Section splitting** *(6h)*
Re-parse source markdown at `###` level, not just `##`. "Complete NEops Roster" becomes 15 closets. Stage in dev palace first, compare metrics, migrate.

Expected impact: +15-20 pp on fine-grained entity queries ("What is Aria?").

**4.2 Synonym + alias index at query time** *(4h)*
Build synonym table from graph aliases. Query "Rahul" → also match closets containing "Rahul Kashyap", "Dr. Rahul", etc. Can be a simple Convex table keyed on (canonicalName → aliases[]).

### Tier 5 — ML-heavy (longer term)

**5.1 Cross-encoder re-ranking** *(4-6h)*
Top-20 from vector → cross-encoder scores → top-5. Adds 200-500ms. Use Bedrock's Rerank API (Cohere Rerank 3.5 on Bedrock, free tier exists).

Typical gain: +10-15 pp but at latency cost.

**5.2 Learning-to-rank** *(weeks, gated on user data)*
Once users are clicking results, log clicks. Train a small reranker on click data. Production ML — not for now.

---

## 3. Recommended sequencing

**Today (2 hours):**
- 1.1 confidence + recency in score
- 1.2 MMR diversity
- 1.4 threshold recalibration
- 1.5 query log table

**This week (~6h):**
- 2.1 query expansion (highest single ROI)
- 2.3 metadata pre-filter
- 2.4 entity-aware query rewrite
- 3.1 entity-enriched re-embed

**Next week (~8h):**
- 2.2 HyDE
- 2.5 multi-query + RRF
- 3.2 chunk splitting (biggest structural win)

**Month 2:**
- 4.1 section splitting from source
- 5.1 cross-encoder rerank

Expected benchmark trajectory:
- Now (Titan + graph boost only): Est R@5 ≈ 75% medium, 40% hard
- After Tier 1: ≈ 80% medium, 45% hard
- After Tier 2: ≈ 88% medium, 65% hard
- After Tier 3: ≈ 93% medium, 75% hard
- After Tier 4: ≈ 95% medium, 80% hard

---

## 4. Testing on Vercel

Vercel hosts the frontend; Convex hosts the backend. "Testing on Vercel" means: verifying the end-to-end experience from the deployed URL, by a real user or a machine.

### 4.1 Live Search Playground *(2h)*

Add a `/test` route in `frontend/src/` — interactive page:
```
┌─────────────────────────────────────┐
│ Query: [__________________] Search  │
│ Filters: Wing[__] Category[__]      │
│                                     │
│ Result 1: [score 0.72] clients/...  │
│   Top matches entity: Zoo Media    │
│   Graph boost: +0.10 (2 entities)  │
│ Result 2: [score 0.68] ...          │
│ ...                                 │
│ Confidence: HIGH  Latency: 420ms   │
└─────────────────────────────────────┘
```

Anyone with the URL can test any query, see scores + confidence + which signals fired. Catches regressions by eyeballing.

### 4.2 Benchmark Dashboard *(2h)*

Add `/benchmarks` route — loads the latest `benchmarks/results/*.json` and renders:
- Summary scorecard: R@1, R@5, nDCG by difficulty (easy/medium/hard/unanswerable)
- Per-query table: query | expected_room | actual_top_room | score | pass/fail
- Compare against prior runs (trend line)

Auto-refreshes from the repo's JSON files on every deploy. No live API calls, cheap.

### 4.3 Automated Smoke Test in CI *(3h)*

GitHub Action: after Vercel deploy, curl the deployed `/mcp` endpoint with 10 canonical queries, check responses match expected room/wing. Fail the deploy (via Vercel API) if <80% pass.

```yaml
# .github/workflows/smoke.yml
on: deployment_status
jobs:
  smoke:
    if: github.event.deployment_status.state == 'success'
    steps:
      - run: npx tsx benchmarks/run_smoke.ts --url ${{ github.event.deployment_status.target_url }}
```

This is the "can't-accidentally-break-retrieval" safeguard.

### 4.4 NEop "dogfood" mode *(4h)*

Add a `neopId=test` option that logs every search + result to `query_log` with `mode: "test"`. Point Aria/Neuralchat at it during internal use. After 2 weeks, review logs for:
- Queries that returned no results (gaps)
- Queries with low top score (weak embeddings)
- Queries where user rephrased quickly (first attempt failed)

This is the slow-burn feedback loop that beats synthetic benchmarks in the long run.

### 4.5 Public-facing quality badge

A `/quality` page showing:
- "Last benchmark: R@5 = 87%, Unanswerable = 100%"
- "Corpus: 429 memories, 1,325 entities, 11,303 relations"
- "Embedding model: Bedrock Titan v2"
- "Verified: [timestamp]"

Client-trust artifact. Zero maintenance after first build.

---

## 5. What I'd do first

**Fastest path to measurable improvement (today, 3 hours):**

1. Implement 1.1 (confidence + recency) + 1.2 (MMR) + 1.4 (recalibration)
2. Run benchmark — confirm no regression
3. Implement 2.1 (query expansion via Groq)
4. Run benchmark — expect 5-15 pp jump on hard queries
5. Implement 4.1 (live search playground at `/test`) — gives you + Yatharth a way to manually inspect quality any time

Commit after each phase. Push. Benchmark. Repeat.

This frontloads the biggest per-hour improvements and gives you a live demo UI to show clients.
