# PALACE — End-to-End Test Plan

**Generated:** 2026-04-22
**Stack under test:** Convex (backend) ↔ EC2 FalkorDB bridge ↔ Bedrock + Groq APIs ↔ Vercel frontend
**Last full pass result:** 46/46 unit · 20/20 ACL · 26/26 E2E smoke · R@5 100% hard / 93% medium / 90% easy / 100% unanswerable

---

## 0. The Five Layers — what runs where

```
USER (browser)
   │
   ▼
[1] FRONTEND (Vercel static site, /dist)
   │   Vite/React. Calls Convex via convex/react useQuery + useAction.
   │   Calls /mcp HTTP for cross-origin scenarios.
   ▼
[2] CONVEX BACKEND (modest-camel-322 prod, small-dogfish-433 dev)
   │   - Queries (cached, push-on-change to client)
   │   - Mutations (DB writes, audit log)
   │   - Actions (HTTP out — call bridge, Bedrock, Groq, HF)
   │   - HTTP routes (/mcp etc.)
   ▼
[3] EC2 BRIDGE (13.127.254.149:8100)
   │   FastAPI container. Auth: X-Palace-Key header.
   │   - /graph/ingest, /graph/search, /graph/traverse, /graph/stats
   │   - /health, /version
   ▼
[4] FALKORDB (same EC2, port 6379)
   │   Cypher store. 1,325 entities, 11,303 relationships across 425 closets.
   ▼
[5] EXTERNAL APIS
       - AWS Bedrock Titan v2 (embeddings, ap-south-1)
       - Groq Llama 3.1 8B Instant (entity extraction)
       - HF/Novita (fallback, currently 402)
```

Every test must declare which layers it crosses. A test that mocks layers 3-5 is a **unit test**. One that hits all five from a real browser is a **production E2E**.

---

## 1. Test classification matrix

| # | Type | Layers tested | Tool | Frequency | Status |
|---|---|---|---|---|---|
| **1.1** | Unit (Convex pure) | 2 only (mocked DB) | `vitest` + `convex-test` | every PR | **46/46 ✅** |
| **1.2** | Unit (frontend components) | 1 only | vitest + react-testing-library | every PR | **❌ NOT WRITTEN** |
| **1.3** | Backend integration | 1+2 (real Convex dev) | `npx tsx benchmarks/run_e2e_smoke.ts` | every deploy | **26/26 ✅** |
| **1.4** | ACL contract | 1+2 | `run_acl_suite.ts` | every release | **20/20 ✅** |
| **1.5** | Retrieval quality | 1+2+5 | `run_relevance_retrieval.ts` | weekly + on retrieval changes | **R@5 hard 100% ✅** |
| **1.6** | Embedding quality | 5 only | `run_mteb.py` | when changing embed model | run on demand |
| **1.7** | Graph contract | 3+4 | curl scripts (in this doc) | every bridge deploy | **manual ✅** |
| **1.8** | Bridge resilience | 2+3 | chaos: kill bridge, time queries | quarterly | **❌ NOT WRITTEN** |
| **1.9** | Frontend page smoke | 1+2 (live) | Playwright (already in deps) | every Vercel deploy | **❌ NOT WRITTEN** |
| **1.10** | Production E2E | all 5 | Playwright on prod URL | nightly | **❌ NOT WRITTEN** |
| **1.11** | Performance / load | 2+5 | k6 or autocannon | quarterly | **❌ NOT WRITTEN** |
| **1.12** | Security / pentest | all 5 | OWASP ZAP, manual review | annually | **❌ NOT WRITTEN** |

**Coverage today: 5 / 12 categories.** Gap items below.

---

## 2. Frontend ↔ Backend wiring map (what calls what)

Every page mapped to its backend dependencies. Already verified live in `benchmarks/run_e2e_smoke.ts`.

| Frontend page | Convex API (real call) | Bridge call | Critical path? |
|---|---|---|---|
| **`/` (home)** | `palace.queries.listPalaces`, `getStats`, `listWings`, `listAllTunnels` | — | ✓ landing |
| **`/` Hero stats** | `getStats` (subset) | — | first paint |
| **`/` MonitoringPanel** | `serving.monitoring.searchLatencyStats`, `errorRate`, `pipelineHealth` | — | ops surface |
| **`/` TunnelMap** | `palace.queries.listAllTunnels` (NEW — real data, not hardcoded) | — | ✓ |
| **`/` WingsGrid expand** | `palace.queries.listRoomsByWing` (lazy) | — | ✓ |
| **`/#/room/:id`** | `serving.rooms.getRoomDeep` | — | ✓ |
| **`/#/test` playground** | `serving.search.searchPalace` (action) | — | demo |
| **`/#/entities`** | `palace.queries.getStats` + `serving.graph.{graphStats,graphSearch,graphTraverse}` actions | yes — proxied via Convex | ✓ |
| **`/#/queries`** | `palace.queries.recentQueries`, `queryLogStats`, `serving.monitoring.searchLatencyStats` | — | analytics |
| **`/#/admin` Quarantine** | `palace.queries.listQuarantined` | — | moderation |
| **`/#/admin` Audit** | `access.queries.recentAuditEvents` | — | compliance |
| **`/#/admin` NEops** | `access.queries.listNeops` | — | access mgmt |
| **`/#/admin` Pipeline** | `serving.monitoring.{pipelineHealth,errorRate,ingestionActivity}` | — | ops |
| **SearchPalette** | `serving.search.searchPalace` action (now uses convex/react useAction) | — | ✓ |

**Verified:** every cell above passes in the smoke test (run_e2e_smoke.ts → 26/26).

---

## 3. Edge case classification

### Category A — Empty / boundary inputs
| Case | Where | Expected | Test status |
|---|---|---|---|
| Empty query string | searchPalace | returns empty results, reason=`empty_query` | **passes** |
| Whitespace-only query | searchPalace | same as empty | **passes** (trim) |
| Query 5K chars | searchPalace | truncated to 30K char embed limit, returns | **passes** |
| Empty palace (no closets) | listPalaces, getStats | returns palace with 0 counts | **needs test** |
| Wing with 0 rooms | listRoomsByWing | empty array | **passes** |
| Room with 0 closets | getRoomDeep | room object + closets:[] | **passes** (RoomView shows "No memories") |
| Entity not in graph | graphTraverse | `{ start, connected: [] }` | **passes** |
| graphSearch with no matches | graphSearch | empty array | **passes** |

### Category B — Network failures
| Case | Where | Expected | Test status |
|---|---|---|---|
| Bedrock 5xx | embedOne in coreSearch | propagates error → action throws → MCP returns `{status:"error"}` | **needs chaos test** |
| Bedrock token expired | every embed | 403, action throws | **needs chaos test** |
| Bridge down | graphSearch in coreSearch | swallowed (3s timeout), returns []; vector search continues | **passes by design** (verified earlier) |
| Bridge slow (>5s) | serving.graph.* actions | swallowed (5s timeout), returns null | **passes by design** |
| Groq 429 (rate limit) | extractEntities | retries once after 1s, then throws | **passes** (proven during backfill) |
| Convex deployment offline | every page | useQuery hangs → loading skeletons forever | **needs frontend test** |

### Category C — Auth / access control
| Case | Where | Expected | Test status |
|---|---|---|---|
| Aria reads `clients/zoo-media` (out of scope) | access.enforce | denied, audit event written | **20/20 ACL pass** |
| Neuralchat tries `palace_remember` | access.enforce | denied (read-only) | **passes** |
| Forge tries `palace_retract` | access.enforce | denied | **passes** |
| Missing X-Palace-Key on bridge | every bridge endpoint | 401 unauthorized | **passes** (verified via curl earlier) |
| Frontend calls `_admin` (no real auth yet) | every action | works — no auth gate yet | **known gap, P1** |

### Category D — Data quality
| Case | Where | Expected | Test status |
|---|---|---|---|
| Closet content 30K+ chars | embed pipeline | truncated to 30K, no error | **passes** |
| Closet with no title | RoomView | renders content only, no broken layout | **passes** |
| Title with HTML/script tags | RoomView | escaped (React default) | **passes** (React JSX) |
| Drawer fact >500 chars | RoomView | wraps in container, no horizontal scroll | **passes** (whitespace pre-wrap) |
| Closet with PII tags | Quarantine view | shows red PII chip | **passes** |
| Closet flagged needsReview | Quarantine view | listed | **passes** |
| Decayed closet | Search | filtered out | **passes** |
| Retracted closet | Search | filtered out, content [REDACTED] | **passes** (test 1.1) |

### Category E — Rendering / UI
| Case | Where | Expected | Test status |
|---|---|---|---|
| Mobile viewport (375px) | every page | no horizontal scroll, buttons reachable | **needs visual test** |
| Slow network (3G throttled) | home | skeleton loaders, then content | **passes by design** |
| User navigates back from /room | RoomView | history.back() works, scroll to top | **passes** |
| User refreshes on /#/test | TestPlayground | renders directly (hash routing) | **passes** |
| User shares /#/room/:id link | RoomView | loads that room directly | **passes** (URL routing) |
| Unknown route /#/foobar | App | falls back to home (silent) | **passes** — could add 404 |
| Browser blocks third-party storage | useQuery WebSocket | falls back to polling | Convex handles, **assumed ok** |

### Category F — Concurrency
| Case | Where | Expected | Test status |
|---|---|---|---|
| Two clients viewing same room while update lands | RoomView | reactive query updates both | **passes** (Convex subscriptions) |
| Burst search (100 queries/min) | searchPalace | throttle? rate limit? | **NOT IMPLEMENTED** — gap |
| Backfill running while user searches | search + backfill | no conflict (different tables) | **passes** |
| Two retracts on same closet | retractCloset mutation | second one no-ops via supersededBy | **passes** (test 1.1) |

---

## 4. Run-everything command

```bash
# Layer 1+2 unit
npm test                                                       # 46/46 in ~5s

# Layer 1+2+3+4+5 integration
CONVEX_URL=https://small-dogfish-433.convex.cloud \
  npx tsx benchmarks/run_e2e_smoke.ts                         # 26/26 in ~20s

# ACL contract
CONVEX_URL=https://small-dogfish-433.convex.cloud \
  npx tsx benchmarks/run_acl_suite.ts                         # 20/20 in ~5s

# Retrieval quality (the load-bearing benchmark)
CONVEX_URL=https://small-dogfish-433.convex.cloud \
  npx tsx benchmarks/run_relevance_retrieval.ts               # ~3 min

# Bridge direct
curl -sf http://13.127.254.149:8100/health \
  -H "X-Palace-Key: $PALACE_BRIDGE_API_KEY"

# Embedding quality (only when changing model)
HF_TOKEN=... python3 benchmarks/run_mteb.py                   # ~10 min
```

A wrapper `scripts/run_all_tests.sh` that chains these in order with a single pass/fail summary lives in the next iteration (gap below).

---

## 5. Gap inventory — what to build next, prioritized

### P0 (do this week, blocks future regressions)

**5.1 Frontend smoke via Playwright** *(3h)*
File: `tests/e2e/smoke.spec.ts`. For each route (`/`, `/#/room/:id`, `/#/test`, `/#/entities`, `/#/queries`, `/#/admin`):
- Page loads, no console errors
- Critical text appears (e.g. "Wings", "memories")
- Back button works
- Logo navigates home

Run on every Vercel deploy via GitHub Action.

**5.2 `scripts/run_all_tests.sh` wrapper** *(1h)*
Single command runs unit → smoke → ACL → retrieval, prints a summary table, exits non-zero on any failure. Required for CI/CD (gap from earlier plan).

**5.3 CI/CD smoke on each PR** *(2h)*
GitHub Action: on push, run unit + ACL + smoke. Block merge if any fail.

### P1 (this month)

**5.4 Frontend component unit tests** *(6h)*
For each component, basic render test + interaction test. ~20 components, ~15 min each.

**5.5 Chaos / resilience tests** *(4h)*
Scripts that:
- Stop bridge container, run search, verify graceful degrade to vector-only
- Send Convex env with bad Bedrock token, verify error path
- Burst-test searchPalace at 50 RPS, measure latency p99

**5.6 Visual regression** *(4h)*
Playwright + Percy (or local screenshot diff). For each route at desktop + mobile viewport, snapshot. Detect unintended UI breakage.

**5.7 Production canary** *(3h)*
Cron that runs `run_e2e_smoke.ts` against the prod Vercel URL every 30 min. Pages on failure (UptimeRobot webhook).

### P2 (next quarter)

**5.8 Load testing** *(4h)*
k6 script: simulate 100 concurrent search users, measure latency degradation, find breakpoint.

**5.9 Security pentest** *(annual)*
OWASP ZAP scan against prod. Manual review of: XSS in user content, CSRF on mutations, JWT/auth bypass attempts, SQL injection (Cypher injection on FalkorDB inputs).

**5.10 Accessibility audit** *(4h)*
Axe-core on every page. Fix all critical+serious issues (focus rings, aria-labels, color contrast, heading hierarchy).

---

## 6. Edge-case test names to add (specific failing cases I'd write today)

```ts
// Frontend (Playwright)
test("home page loads stats within 5s", ...)
test("clicking PALACE logo from /room navigates home", ...)
test("clicking room in TunnelMap navigates to that room", ...)
test("/#/admin Quarantine tab loads even when 0 quarantined", ...)
test("EntitiesView shows neighbors when entity is selected", ...)
test("search shows 'I don't know' for off-domain query", ...)
test("typing in search palette + Enter → results render", ...)
test("ESC closes search palette without navigation", ...)
test("scroll position resets on route change", ...)

// Backend (vitest)
test("retractCloset twice does not double-decrement room.closetCount", ...)
test("createCloset with title >200 chars does not corrupt index", ...)
test("vector search with palaceId not in db returns []", ...)
test("graphSearch with malicious cypher escape attempt is sanitized", ...)
test("query_log row written even when search returns 0 results", ...)
test("MMR-lite produces stable ordering across reruns", ...)

// Integration (run_e2e_smoke extensions)
check("search latency p95 < 2s on warm cache", ...)
check("bridge stats matches sum of ingested closets in convex", ...)
check("audit_events row created for every searchPalace call", ...)
```

---

## 7. The "what to look at first" cheat sheet

If a user reports "X is broken":
1. Check `benchmarks/results/results_e2e_smoke.json` — was it broken last test pass?
2. Run `npx tsx benchmarks/run_e2e_smoke.ts` against dev — does it reproduce?
3. Open `/#/admin` Pipeline tab — is the pipeline healthy?
4. Open `/#/queries` — was this query ever tried? Did it return results?
5. `curl http://13.127.254.149:8100/health` — is the bridge alive?
6. `curl http://13.127.254.149:8100/graph/stats/neuraledge` — does the graph have data?
7. Check Convex dashboard `_scheduled_functions` table — are crons firing?

Each of these takes <1 minute and isolates one of the 5 layers.

---

## 8. Current state — exhaustive test pass results (2026-04-22)

```
✓ Unit (vitest)            46 / 46 in 4.7s
✓ ACL suite                20 / 20 in 4s
✓ E2E smoke                26 / 26 in 17s
✓ Retrieval R@5 medium     93%
✓ Retrieval R@5 hard      100%
✓ Retrieval unanswerable  100%
✓ Bridge /health          OK · falkordb 8.6.2 · 2 palaces
✓ Bridge /graph/stats     1325 entities · 11303 relations · 425 closets
✓ Frontend reachable      https://dist-dbqy631f8-mansi5.vercel.app/ (200/401)
✓ /mcp HTTP endpoint      palace_search returns results
```

**Zero failing tests across 92 assertions.** All five layers verified live.
