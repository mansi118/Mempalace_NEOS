# PALACE — Project Status

**Updated:** 2026-04-22
**One-line:** Context Vault memory system for NEops at NeuralEDGE. Stores, retrieves, and graph-navigates structured team knowledge with per-NEop access control.

---

## Green board

| Layer | State | Evidence |
|---|---|---|
| Frontend (Vercel) | 🟢 live | https://dist-dbqy631f8-mansi5.vercel.app/ |
| Convex (dev) | 🟢 live | `small-dogfish-433.convex.cloud` |
| Convex (prod) | 🟢 live | `modest-camel-322.convex.cloud` |
| Bridge (EC2) | 🟢 live | `13.127.254.149:8100` |
| FalkorDB | 🟢 live | `v8.6.2`, same EC2, `palace_neuraledge_hq` |
| Bedrock embeddings | 🟡 12h-lease | last rotation: 2026-04-22 06:58Z · next expiry: 18:58Z |
| Groq extraction | 🟢 live | llama-3.1-8b-instant, free tier |

**Last full test pass:** ALL GREEN 5/5 suites (`7bd3291`).

---

## Current data

| Metric | Value |
|---|---|
| Palaces | 1 (`neuraledge`) |
| Wings | 12 |
| Rooms | 47 |
| Closets | 442 visible / 442 total |
| Drawers (atomic facts) | 694 |
| Tunnels (cross-room edges) | 14 |
| Graph entities | 1,325 |
| Graph relationships | 11,303 |
| Embedding coverage | 100% (1024-d Titan v2) |
| Entity extraction coverage | 425/429 (99%, 4 skipped as too short) |

---

## Retrieval quality (last benchmark)

| Metric | Value | Budget |
|---|---|---|
| Easy R@5 | 90% | — |
| Medium R@5 | **93%** | ≥ 85% |
| Hard R@5 | **100%** | ≥ 60% |
| Unanswerable precision | **100%** | = 100% |
| MRR@10 | 80.7% | — |
| p95 latency | 1,713 ms | ≤ 3,000 ms |

Budgets auto-enforced in CI (`run_relevance_retrieval.ts` exits non-zero on breach).

---

## Architecture

```
Vercel (React/Vite)  ◄────── user browser
      │
      │ convex/react subscriptions + actions
      ▼
Convex functions ─────────────► Bedrock Titan v2 (embed, ap-south-1)
      │                ─────────► Groq Llama 3.1 8B (entity extraction)
      │                ─────────► HF Novita (fallback, 402)
      │
      │ HTTP (X-Palace-Key)
      ▼
EC2 bridge (FastAPI) ─► FalkorDB (Cypher, same host)
```

Frontend calls Convex via WebSocket subscriptions (queries) and action RPCs.
Convex actions proxy Bedrock + Groq + bridge so no secret ever reaches the browser.

---

## Route map (frontend)

| Path | Component | Purpose |
|---|---|---|
| `/` | Hero + StatsPanel + MonitoringPanel + TunnelMap + WingsGrid | overview, live stats, drill-in |
| `/#/room/:id` | RoomView | closets + drawers for one room |
| `/#/test` | TestPlayground | interactive retrieval probe, 7 presets |
| `/#/entities` | EntitiesView | 1,325 entities, filter + 2-hop neighbours |
| `/#/queries` | QueriesView | confidence dist, p50/p95, top repeats, last 50 searches |
| `/#/admin` | AdminView | Quarantine · Audit · NEops · Pipeline tabs |

Search palette opens anywhere with Ctrl+K or `/`.

---

## Backend API surface

- `convex/palace/queries.ts` — listPalaces, getStats, listWings, listRoomsByWing, getCloset, listQuarantined, recentQueries, queryLogStats, listAllTunnels
- `convex/palace/mutations.ts` — createCloset, retractCloset, storeEmbedding, logQuery, purgeEmbeddingsBatch, setEntityExtractionResult
- `convex/serving/search.ts` — coreSearch + searchPalace/Wing/Temporal (vector + graph-boost + MMR-lite + confidence + recency)
- `convex/serving/graph.ts` — graphStats, graphSearch, graphTraverse (proxy Bedrock bearer via bridge)
- `convex/serving/rooms.ts` — getRoomDeep
- `convex/serving/tunnels.ts` — walkTunnel
- `convex/serving/monitoring.ts` — searchLatencyStats, errorRate, pipelineHealth, ingestionActivity
- `convex/access/queries.ts` — listNeops, getNeopPermissions, recentAuditEvents, auditEventsForNeop
- `convex/ingestion/embed.ts` — embedQuery, embedDocument, backfillEmbeddings
- `convex/ingestion/extractEntities.ts` — extractAndIngestCloset, extractBatch

---

## Tests & gates

```
tests/                         → vitest suite, 46/46
benchmarks/run_e2e_smoke.ts    → 26 shape checks across every frontend-facing API
benchmarks/run_mutation_smoke.ts → live write path (createCloset → retract → redaction)
benchmarks/run_acl_suite.ts    → 20 NEop × op cases, must be 100%
benchmarks/run_relevance_retrieval.ts → 40 queries with 4 auto-enforced budgets
frontend/tests/smoke.spec.ts   → 8 Playwright tests across 6 routes

scripts/run_all_tests.sh       → chains all of the above, exits non-zero on fail
.github/workflows/test.yml     → CI gate on every PR + push
.github/workflows/canary.yml   → 15-min cron against prod /mcp, opens issue on fail
```

---

## Key docs in the repo

| File | What it's for |
|---|---|
| `README.md` (if any) | project overview |
| `STATUS.md` ← this file | at-a-glance state |
| `RUNBOOK.md` | 10 failure modes × recognise/triage/fix |
| `TEST_PLAN.md` | exhaustive test classification + wiring map |
| `TEST_PLAN_CRITIQUE.md` | honest review of what TEST_PLAN doesn't catch |
| `P0_IMPLEMENTATION_PLAN.md` | the sprint that closed the critique |
| `RETRIEVAL_IMPROVEMENTS.md` | 29-item prioritised improvement backlog |
| `GAP_EXECUTION_PLAN.md` | the broader gap roadmap (beyond P0) |
| `GAP_REPORT.md` | original gap inventory from shipping the MVP |
| `IMPLEMENTATION_PLAN.md` | day-1 build plan |
| `benchmarks/BENCHMARK_REPORT.md` | published retrieval benchmark (for clients) |
| `benchmarks/BENCHMARKS.md` | what each benchmark measures and why |
| `docs/BENCHMARK_EXPLAINER.md` | benchmarks written for ML/product review |

---

## Known risks

1. **Bedrock token rotates every 12h.** Manual refresh needed until we swap to permanent creds (OpenAI embeddings or IAM + SigV4). Canary will alert, but restoration is not automatic.
2. **Cron crons untested in prod.** 10 crons defined in `convex/crons.ts`. First firings have happened but nothing verified end-to-end.
3. **Auth bypass = no auth.** Everything authenticates as `_admin`. Public deploy needs Convex Auth or Clerk before external demos.
4. **FalkorDB no backups.** EC2 volume is the only copy. RDB snapshot cron listed in RUNBOOK §4 as "prevention gap".
5. **Vercel preview auth-walls block Playwright.** Tests need `VERCEL_BYPASS_TOKEN` or a public prod URL to run in CI.

---

## Recent commits (last ten)

```
7bd3291 chore: tune p95 budget to 3000ms (observed current-stack p99)
01a0acb test(e2e): Playwright smoke suite — 8 tests × 6 routes
e5b8d7d feat: CI gates + runbook — budgets, smoke, canary, on-call playbook
b69d705 fix(security): parameterize Cypher queries in graph_writer.py
be3e631 docs: P0 implementation plan (from critique to ship)
dde69b9 docs: ultrathink critique — what TEST_PLAN.md doesn't catch
b8e5e6c test: end-to-end pass + comprehensive test plan
495b2ff feat(ui): url routing, back buttons, real tunnels, entity/query/admin views
fbdd97f feat: /test search playground + query expansion module (unwired)
f5ce8bd feat: Tier 1 retrieval scoring — confidence+recency+MMR+calibration
```

---

## How to operate

### Run every test
```bash
./scripts/run_all_tests.sh             # dev
./scripts/run_all_tests.sh --prod      # prod
./scripts/run_all_tests.sh --fast      # skip retrieval (slowest step)
```

### Health check (all layers in one go)
```bash
# See RUNBOOK.md Appendix for the one-liner.
```

### Deploy backend
```bash
npx convex dev --once                   # dev
npx convex deploy -y                    # prod
```

### Deploy frontend
```bash
cd frontend && npm run build
cd dist && vercel deploy --prod --yes
```

### Rotate Bedrock token
```bash
npx convex env set AWS_BEARER_TOKEN_BEDROCK '<new-token>'
```

### Resume entity backfill (new/changed closets)
```bash
CONVEX_URL=https://small-dogfish-433.convex.cloud \
  npx tsx scripts/backfillEntities.ts
```

### Query the graph directly
```bash
curl -s "http://13.127.254.149:8100/graph/stats/neuraledge" \
  -H "X-Palace-Key: $PALACE_BRIDGE_API_KEY"
```

---

## The invariant / budget / runbook matrix

| Guard | What | Where |
|---|---|---|
| **Invariant 1** | ACL = 20/20 | `run_acl_suite` `exit 2` if <100% |
| **Invariant 2** | Redaction round-trip | `run_mutation_smoke` asserts `[REDACTED]` + embedding deleted |
| **Invariant 3** | Unanswerable = 100% | `run_relevance_retrieval` `exit 2` if < 100% |
| **Budget 1** | Medium R@5 ≥ 85% | retrieval benchmark gate |
| **Budget 2** | Hard R@5 ≥ 60% | retrieval benchmark gate |
| **Budget 3** | p95 latency ≤ 3s | retrieval benchmark gate |
| **Runbook 1** | Bedrock expiry | RUNBOOK §2 |
| **Runbook 2** | Bridge down | RUNBOOK §3 |
| **Runbook 3** | Groq 429 | RUNBOOK §5 |

Everything else — UI polish, new features, performance work — is nice-to-have on top of this.

---

## Links

- **Repo:** https://github.com/mansi118/Mempalace_NEOS
- **Live site:** https://dist-dbqy631f8-mansi5.vercel.app/
- **Convex prod dashboard:** https://dashboard.convex.dev/t/mansi5/modest-camel-322
- **Convex dev dashboard:** https://dashboard.convex.dev/t/mansi5/small-dogfish-433
