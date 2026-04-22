# Test Plan — Honest Critique (Ultrathink)

**Generated:** 2026-04-22
**Context:** Re-reading `TEST_PLAN.md` with fresh eyes, looking for where it's lying to itself.

---

## 0. The immediate proof: while ultrathinking this plan, I discovered search is broken in production

- Smoke test at 10:33 local: **26/26 pass**
- Fresh search at 10:34 local: **`Bedrock Titan embed error 403: Bearer Token has expired`**

The `AWS_BEARER_TOKEN_BEDROCK` is an AWS SigV4 pre-signed URL embedded as a bearer token. It has `X-Amz-Expires=43200` (12 hours). It was issued at `2026-04-21 18:01:36Z`. It expired at **2026-04-22 06:01:36Z**. Production search has been silently broken since then.

**The plan did not flag this. The smoke test passed right before. No alert exists. No dashboard shows it.**

This is the single most important finding. Every other critique is downstream of it: a green board that doesn't track the real production state is worse than no board at all.

---

## 1. What the "92/92 pass" actually proves vs pretends to prove

| Claim in plan | What it actually tests | What it lets through |
|---|---|---|
| 46/46 unit tests pass | Phase 1 invariants with mocked 1024-dim vectors | The real Bedrock integration, Groq integration, graph writer, MMR logic, query log wiring — all untested |
| 20/20 ACL pass | 5 NEops × 4 ops = 20 action-level checks | HTTP-path enforcement, scope bindings in real wings, audit-log integrity |
| 26/26 E2E smoke pass | Shape of responses (array/object/number), non-zero counts | Correctness of the answers. "Does listQuarantined return the right closets?" is untested |
| R@5 hard = 100% | 10 hand-written queries I wrote against the corpus I know | Overfit. Real user queries will differ. Nothing measures distribution drift |
| Frontend reachable | HTML returns 200/401 from Vercel | The page actually renders, no JS errors, queries fire, hash routing works, buttons work |

In one sentence: **the plan tests that things don't throw, not that they do the right thing.**

---

## 2. Production risks the plan does not cover

### 2.1 Short-lived credentials silently expire

- `AWS_BEARER_TOKEN_BEDROCK` — 12h. Just expired. Search dead until refresh.
- `PALACE_BRIDGE_API_KEY` — persistent, OK.
- `GROQ_API_KEY` — persistent, OK.
- `HF_TOKEN` — persistent, but quota-based; hit 402 last week.
- `GITHUB_PAT` — 90d default. Will fail CI push at some point.

**No test catches any of these. No monitoring. The failure mode is always "silent". Real user types a query → gets nothing → assumes PALACE is broken.**

### 2.2 Cypher injection surface in `services/graph_writer.py:24-26`

```python
def escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'").replace('"', '\\"')
```

Entity names come from an LLM (Groq → user content → Llama output). The only sanitization is backslash/quote escaping. An entity name of `a\u0000', (n)-[r:ANY]->(m) DELETE r, //` would bypass this — Cypher unicode/control-char handling is not defensive. The MATCH/MERGE queries use f-strings, not parameterized binding.

**FalkorDB has no RLS. A successful injection would let any content reach any palace's graph.** Listed as "P2 — security pentest" in the plan; it should be P0.

### 2.3 Zero mutations tested integration-level

Unit tests cover `retractCloset` with a mocked store. Integration tests don't exercise:
- `createCloset` (live ingest)
- `retractCloset` (live redaction + embedding delete)
- `storeEmbedding` (the dim check)
- `logQuery` (write on every search)
- `purgeEmbeddingsBatch` (migration-critical)
- `setEntityExtractionResult` (graph status)

If any of these regress, we only find out when a user's content disappears.

### 2.4 Frontend has zero automated coverage

The plan says Playwright is "P0 — 3h". But:
- Vercel preview deploys are auth-walled (401s). Need a bypass token or a public prod deploy.
- "Back button works" is the user's original complaint. No regression test for it yet.
- Hash router fallback on unknown routes silently goes home — no 404. A typo in a shared link looks like a working load, which is worse than an error.

### 2.5 Retrieval quality has no regression budget

I celebrated "hard R@5 = 100%" — but if tomorrow someone changes the similarity floor and it drops to 60%, the benchmark file is regenerated with new numbers and no alert fires. There is no `if (metrics.hardR5 < 0.85) exit 1` anywhere.

### 2.6 Token/quota budgets are silent too

Every search burns one Bedrock embedding. Extraction burns Groq tokens. Nothing tracks cost. Nothing alerts if we 10× overnight due to a loop bug.

### 2.7 No replay from the query log

I added the `query_log` table and the `/queries` UI surfaces it. But there's no "replay this query and diff against the current system" flow. If retrieval logic changes, we can't cheaply retest historical queries against the new code.

### 2.8 Single bridge = single point of failure

EC2 bridge container. No health auto-restart beyond Docker's `restart: unless-stopped`. No replica. FalkorDB RDB backups aren't automated. If the EC2 instance dies, graph goes with it. The plan marks "FalkorDB backup" P2.

---

## 3. Category bloat — the plan has too many buckets

12 test types × 6 edge-case categories = a matrix no one maintains. Reality:

- **3 categories that actually pay for themselves every week:** invariants, quality budgets, failure drills.
- Everything else is aspirational.

Better framing:

### The 3 invariants (must always hold, fail CI if broken)
1. **Isolation:** no NEop sees data outside its scope. Test: 20/20 ACL.
2. **Redaction:** retracted content is unreachable. Test: unit + integration that hits vectorSearch after retract.
3. **Unanswerable safety:** off-domain queries return low confidence. Test: 5/5 unanswerable in retrieval benchmark.

### The 3 budgets (track over time, alert on regression)
1. **Retrieval quality:** R@5 medium ≥ 85%, R@5 hard ≥ 60%, unanswerable = 100%.
2. **Latency:** search p95 ≤ 2s, bridge /graph/* p95 ≤ 500ms.
3. **Pipeline coverage:** embedding 100%, graph ingestion ≥ 95%.

### The 3 runbooks (what to do when X breaks)
1. **Bedrock token expired** → refresh token in Convex env, redeploy. (Live today.)
2. **Bridge unreachable** → search degrades to vector-only automatically; admin checks EC2 status; restart container if needed.
3. **Groq 429** → extraction backfill slows; falls back to HF; if HF also 402, pause backfill.

That's it. Nine concrete things. Everything else is nice-to-have.

---

## 4. The 5 P0 items the plan under-prioritized

Revised, not-just-wishlist priorities:

### P0.1 — Live production canary (today, 1h)
Cron (GitHub Action every 15 min) hits `https://prod-url/mcp` with a canary query. If `resultCount === 0` OR confidence !== "high", open a GitHub issue and page via UptimeRobot. This would have caught the Bedrock expiry 15 minutes after it happened, not 30 minutes after my smoke test said green.

### P0.2 — Bedrock credential lifecycle (today, 2h)
Three options, any works:
- a) Switch to a permanent IAM access key + generate SigV4 per request server-side (adds dependency, $0)
- b) A cron that refreshes the bearer token every 10h (requires persistent IAM creds anyway)
- c) Swap to `openai` embeddings ($0.02/1M, permanent key, zero lifecycle)
Option (c) is cheapest and most boring. Recommend it.

### P0.3 — Cypher parameterized queries (today, 2h)
Rewrite `graph_writer.py` to use FalkorDB's parameter binding instead of f-strings. Current `escape()` is a nominal defense; parameter binding is the real fix. ~30 LOC.

### P0.4 — Mutation integration tests (this week, 4h)
`benchmarks/run_mutation_smoke.ts` that creates a test closet, retracts it, verifies vector disappears, verifies audit trail. Run on every deploy.

### P0.5 — Regression budgets in CI (this week, 2h)
Modify the benchmark scripts to `process.exit(1)` when any metric falls below its budget. Wire to GitHub Action on every PR.

---

## 5. What I'd actually ship this week (revised)

~15 hours of work, each item ships something that would have caught a real failure we've already seen:

| Day | Task | Prevents |
|---|---|---|
| Mon | Swap Bedrock → OpenAI embeddings (P0.2 option c) + re-embed 425 closets | 12h credential rot |
| Mon | Production canary GitHub Action (P0.1) | silent production outages |
| Tue | Mutation integration tests (P0.4) | untested write path |
| Tue | Regression budgets in benchmark scripts (P0.5) | silent quality drift |
| Wed | Cypher parameter binding (P0.3) | graph injection |
| Wed | Playwright smoke for `/`, `/room/:id`, `/test`, `/entities`, `/queries`, `/admin` (3h) | UI regressions |
| Thu | Run-all wrapper + GitHub Action on PR (2h) | broken main branch |
| Fri | Runbook doc + UptimeRobot setup (2h) | unknown-failure paralysis |

That's a plan I believe in. The 92/92 green board I produced earlier is a snapshot; these items make it a living contract.

---

## 6. Honest state of the plan, per category

**What the existing `TEST_PLAN.md` does well:**
- Catalogues what exists
- Maps frontend↔backend wiring
- Provides the "what to look at first" isolation sheet
- Is a useful reference doc

**Where it oversells:**
- Classifies things as "passes" that only pass a weak assertion
- Treats effort estimates as fact (they're ~2× reality)
- Lists wishlist as gap inventory
- Doesn't distinguish "test exists and passes" from "assumption not yet violated"

**Where it is materially wrong:**
- Claims production is green when it is not (Bedrock token)
- Puts Cypher injection under "P2 annual" when it's a live risk
- Puts credential rotation under "gap" when it's a P0 production blocker
- Treats retrieval quality as a snapshot instead of a budget

---

## 7. The one-liner

> The plan's failure mode is the same as the system's: **everything looks green until a user finds it broken.** The fix is regression budgets enforced in CI, a live canary against production, and a runbook per failure mode — not more test types.
