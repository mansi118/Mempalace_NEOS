# PALACE Final Audit — Plan vs Reality

**Date:** April 20, 2026
**System:** 120 files, 46 tests passing, 429 closets live, 20 commits

---

## Phase-by-Phase Scorecard

### Phase 1: Convex Schema + CRUD — COMPLETE

| Deliverable | Status | Evidence |
|---|---|---|
| Schema (11 tables, all indexes) | DONE | `convex/schema.ts` deployed to Convex cloud |
| Palace/Wing/Hall/Room CRUD | DONE | All mutations in `convex/palace/mutations.ts` |
| Closet creation (append-only, dedup) | DONE | 429 closets live, dedup tested |
| Drawer creation | DONE | 694 drawers live |
| Tunnel creation | DONE | 14 tunnels created |
| safePatch enforcement | DONE | `convex/lib/safePatch.ts` with whitelist |
| Validators | DONE | `convex/lib/validators.ts` |
| Dedup key | DONE | `convex/lib/dedup.ts` (SHA-256, source-identity) |
| Seeder scripts | DONE | `scripts/seedPalace.ts`, `scripts/seedAccess.ts` |
| Palace provisioning | DONE | `convex/palace/provision.ts` (one-command setup) |
| NeuralEDGE HQ seeded | DONE | 12 wings, 47 rooms, 15 NEops |
| Tests | DONE | 20 invariant tests passing |

**Missing:** Nothing.

---

### Phase 2: FalkorDB + Graphiti — PARTIALLY COMPLETE

| Deliverable | Status | Evidence |
|---|---|---|
| FalkorDB on EC2 | DONE | Docker running, healthy at 13.127.254.149:6379 |
| FalkorDB Browser | DONE | Accessible at 13.127.254.149:3000 |
| Graphiti bridge service | DONE | Running at 13.127.254.149:8100 |
| API key auth | DONE | 401 without key verified |
| Palace registry | DONE | neuraledge + zoo_media registered |
| Health endpoint | DONE | Returns connected status |
| Stats endpoint | DONE | Returns node/edge counts |
| **Entity extraction** | **BLOCKED** | Graphiti v0.5+ uses OpenAI Responses API, HF providers only support Chat Completions |
| **Graph ingestion** | **BLOCKED** | 0/429 ingested, 364 pending, 60 failed |
| Contract tests | DONE | `services/test_bridge_contract.py` |

**Blocking issue:** Graphiti requires OpenAI's Responses API which no free HF provider supports. See GAP_REPORT.md for options.

---

### Phase 3: Embeddings + Vector Search — COMPLETE

| Deliverable | Status | Evidence |
|---|---|---|
| Embedding model | DONE | Qwen3-Embedding-8B (4096 dims) via HuggingFace/Scaleway |
| Embedding generation | DONE | `convex/lib/qwen.ts` + `convex/ingestion/embed.ts` |
| Batch embedding | DONE | 429/429 at 100% coverage |
| Vector search | DONE | `convex/serving/search.ts` with enrichment |
| Similarity floor | DONE | 0.35 (calibrated for Qwen score distribution) |
| Confidence levels | DONE | high ≥0.7, medium ≥0.5, low <0.5 |
| Backfill action | DONE | Processes pending + failed closets |
| Benchmark | DONE | STS Spearman 0.863, R@1 100% on clean corpus |

**Missing:** Nothing. Fully operational.

---

### Phase 4: Ingestion Pipeline — COMPLETE

| Deliverable | Status | Evidence |
|---|---|---|
| Claude export parser | DONE | `scripts/parseClaude.ts` |
| Archive ingestion | DONE | `scripts/ingestArchive.ts` — 425 closets from NeuralEDGE archive |
| Keyword router (fallback) | DONE | `convex/ingestion/route.ts` |
| Category classifier | DONE | 7 categories detected from content |
| Confidence scorer | DONE | Based on specificity/speculation signals |
| PII scanner | DONE | `convex/ingestion/pii.ts` (email, phone, PAN, credit card, AWS key) |
| Extraction via LLM | DONE (code) | `convex/ingestion/extract.ts` + `convex/lib/geminiLlm.ts` |
| Batch runner | DONE | `scripts/batchIngest.ts` with progress file, dry-run, concurrency |
| Re-embedding script | DONE | `scripts/reembed.ts` with enriched context |

**Gap:** Extraction LLM uses Gemini Flash (billing inactive). Code exists but untested with real Claude exports. The archive ingestion bypassed LLM extraction entirely (used direct markdown parsing). Swap to Llama 4 Scout recommended (tested, free via HF).

---

### Phase 5: Serving Layer L0-L3 — COMPLETE

| Deliverable | Status | Evidence |
|---|---|---|
| L0 identity briefing | DONE | Template-based, "12 wings, 47 rooms, 424 memories" |
| L1 wing index | DONE | Sorted by activity, room + memory counts |
| L2 search (vector) | DONE | `coreSearch()` in `convex/serving/search.ts` |
| L2 search (graph merge) | NOT DONE | Blocked by Graphiti (Phase 2 issue) |
| L3 deep room dive | DONE | `convex/serving/rooms.ts` with pagination |
| Tunnel walker (BFS) | DONE | `convex/serving/tunnels.ts` with cycle detection |
| Context assembler | DONE | `convex/serving/assemble.ts` with token budgeting |
| Stats query | DONE | `convex/palace/queries.ts:getStats` |
| Markdown export | DONE | `convex/serving/export.ts` |
| Monitoring queries | DONE | `convex/serving/monitoring.ts` (latency, errors, pipeline, ingestion) |

**Gap:** L2 graph search merge not implemented (blocked by Phase 2).

---

### Phase 6: MCP Server — COMPLETE

| Deliverable | Status | Evidence |
|---|---|---|
| Convex HTTP endpoint | DONE | `convex/http.ts` with 19 tool dispatch |
| MCP stdio server | DONE | `scripts/mcpServer.ts` with @modelcontextprotocol/sdk |
| 19 MCP tools | DONE | All implemented, no stubs |
| palace_recall (primary) | DONE | Backed by assembleContext |
| palace_remember (auto-route) | DONE | Backed by ingestExchange |
| palace_merge_rooms | DONE | Full implementation (moves closets, drawers, tunnels) |
| PALACE_PROTOCOL | DONE | Embedded in palace_status response |
| Audit logging | DONE | Every tool call logged (console.error on failure) |
| Tool descriptions | DONE | Zod schemas with precise descriptions |

**Gap:** MCP not yet registered with Claude Code (needs `CONVEX_SITE_URL` + `claude mcp add`).

---

### Phase 7: Access Control — COMPLETE

| Deliverable | Status | Evidence |
|---|---|---|
| Enforcement module | DONE | `convex/access/enforce.ts` |
| Runtime op check | DONE | recall/remember/promote/erase/audit |
| Content access check | DONE | Per-(wing, category) read/write |
| Scope bindings | DONE | icd_zoo_media restricted to clients/zoo-media |
| Admin bypass | DONE | _admin skips all checks |
| Per-result filtering | DONE | filterByReadAccess in HTTP dispatch |
| 15 NEops seeded | DONE | seedAccess.ts ran successfully |
| Tests | DONE | 26 unit tests + 20/20 ACL benchmark (100%) |

**Gap:** No integration test with real MCP registration (all tests use curl to HTTP endpoint).

---

### Phase 8: Curator + Maintenance — COMPLETE (code), UNVERIFIED (production)

| Deliverable | Status | Evidence |
|---|---|---|
| L0/L1 rebuild cron | DONE | `convex/maintenance/curator.ts` |
| Closet decay engine | DONE | `convex/maintenance/pruner.ts` |
| Drawer pruner | DONE | Respects legal hold, 30-day grace |
| Dangling tunnel sweeper | DONE | `convex/maintenance/tunnels.ts` |
| Tunnel strength decay | DONE | 0.05/week, prune <0.1 after 90 days |
| Contradiction detector | DONE | `convex/maintenance/dedup.ts` (word-overlap) |
| Duplicate room detector | DONE | Name similarity heuristic |
| Embedding backfill cron | DONE | 6-hour interval |
| Graphiti backfill cron | DONE (code) | 6-hour interval, but blocked by Phase 2 |
| Stale room detector | DONE | 30-day inactivity threshold |
| Cron registration | DONE | `convex/crons.ts` — 10 crons registered |

**Gap:** No cron has been manually verified in production. All defined but untested at runtime.

---

### Phase 9: Production Hardening — PARTIALLY COMPLETE

| Deliverable | Status | Evidence |
|---|---|---|
| Palace provisioning (one-command) | DONE | `convex/palace/provision.ts` |
| Monitoring queries | DONE | 4 monitoring functions live |
| API documentation | DONE | `docs/MCP_TOOLS.md` — all 19 tools |
| Operational runbook | DONE | `docs/RUNBOOK.md` — 10 procedures |
| Security audit (palaceId scoping) | PARTIALLY | Scope enforcement wired in HTTP dispatch, but no exhaustive audit of all 40+ functions |
| Load testing | NOT DONE | No synthetic load test |
| Zoo Media palace provisioning | NOT DONE | Only NeuralEDGE HQ exists |
| Concurrent NEop testing | NOT DONE | Only single-NEop tests |
| Graceful degradation testing | NOT DONE | Bridge down → vector-only not explicitly tested |

---

## Frontend — COMPLETE with gaps

| Deliverable | Status |
|---|---|
| Navbar with search | DONE |
| Hero with live stats | DONE |
| Stats panel (category distribution) | DONE |
| Monitoring panel (4 health cards) | DONE |
| Tunnel map (14 connections) | DONE |
| Wings grid (12 expandable cards) | DONE |
| Room deep-dive view | DONE |
| Search palette (Ctrl+K) | DONE |
| Error handling in search | DONE |
| Footer | DONE |
| Vercel deployment | DONE (pre-built deploy) |
| **Authentication** | **NOT DONE** |
| **Write UI (palace_remember)** | **NOT DONE** |
| **Mobile responsiveness** | **NOT DONE** |
| **Quarantine review panel** | **NOT DONE** |
| **Tunnel click navigation** | **NOT DONE** |

---

## Benchmarks — COMPLETE

| Benchmark | Status | Result |
|---|---|---|
| MTEB/STS (embedding quality) | DONE | Spearman 0.863 |
| MTEB/Retrieval (clean corpus) | DONE | R@1 100% |
| PALACE Retrieval (exact-closet) | DONE | R@1 6.5%, R@5 10.5% |
| PALACE Relevance (room-level) | DONE | Easy 70%, Medium 87%, Hard 40% |
| ACL Isolation | DONE | 100% (20/20) |
| Unanswerable detection | DONE | 100% (5/5) |
| **LongMemEval (full 500q)** | **NOT DONE** | Baseline from plan: 96.6-99% |
| **BEIR (standard corpora)** | **NOT DONE** | Needs GPU for full eval |
| **HotpotQA (multi-hop)** | **NOT DONE** | Blocked by sparse graph |
| **LoCoMo (conversational)** | **NOT DONE** | Needs dataset adaptation |
| Benchmark report | DONE | `benchmarks/BENCHMARK_REPORT.md` |

---

## Cross-Cutting Issues

### Data Issues
| Issue | Severity | Detail |
|---|---|---|
| 5 quarantined closets | LOW | `needsReview=true`, need manual triage |
| All closets same createdAt | MEDIUM | No temporal search capability |
| Section granularity too coarse | MEDIUM | "Complete NEops Roster" = 15 NEops in one closet |
| No raw Claude conversations ingested | LOW | Only structured archive, not chat JSON |

### Security Issues
| Issue | Severity | Detail |
|---|---|---|
| HF token in git history | HIGH | Committed in earlier commits, needs rotation |
| GitHub PAT used in commands | HIGH | Token visible in bash history |
| Convex .env with AWS credentials | MEDIUM | Was committed then removed |
| No rate limiting on MCP endpoint | MEDIUM | DoS possible |
| No authentication on frontend | MEDIUM | Anyone with URL can browse palace |

### Operational Issues
| Issue | Severity | Detail |
|---|---|---|
| No CI/CD pipeline | MEDIUM | Manual deploy via `npx convex dev --once` |
| No backup strategy for FalkorDB | MEDIUM | No BGSAVE cron |
| No uptime monitoring | MEDIUM | Bridge could go down unnoticed |
| No cost tracking | LOW | Qwen API usage not aggregated |
| Crons unverified | MEDIUM | 10 crons defined, none confirmed running |

### Code Quality Issues
| Issue | Severity | Detail |
|---|---|---|
| `as any` casts | LOW | ~20 instances across codebase |
| Inline styles in frontend | LOW | Works but not maintainable at scale |
| No E2E integration tests | MEDIUM | Only unit tests + manual curl |
| Extraction LLM untested | MEDIUM | Gemini Flash code exists, never exercised |

---

## What Works End-to-End Today

```
✅ Provision a palace (one command)
✅ Ingest markdown archives (425 closets, 694 facts)
✅ Embed all closets (Qwen 4096-dim, 100% coverage)
✅ Search via MCP HTTP endpoint
✅ Search via frontend (Ctrl+K palette)
✅ Browse wings → rooms → closets → drawers
✅ View monitoring dashboard (latency, errors, pipeline)
✅ View tunnel connections
✅ Access control (15 NEops, all enforced)
✅ Unanswerable detection (100%)
✅ Retract closets (GDPR erasure)
✅ Merge rooms
✅ Export to Markdown
✅ View on Vercel (pre-built deploy)
✅ Run benchmarks (4 implemented, results saved)
```

## What Doesn't Work Today

```
❌ Knowledge graph ingestion (Graphiti blocked)
❌ Graph search merge in L2 (depends on graph)
❌ Temporal search (no timestamps on closets)
❌ Live Claude conversation ingestion (LLM extraction inactive)
❌ MCP registration with Claude Code (not configured)
❌ Cron job execution (defined but unverified)
❌ Frontend authentication
❌ Frontend write UI
❌ Multi-hop reasoning beyond tunnels
❌ CI/CD pipeline
```

---

## Priority Actions

| Priority | Action | Effort | Impact |
|---|---|---|---|
| **P0** | Rotate HF token + GitHub PAT (security) | 10 min | Critical |
| **P0** | Verify crons are running (`npx convex run maintenance/curator:rebuildAllL0L1`) | 5 min | Confirms Phase 8 |
| **P1** | Swap extraction LLM to Llama 4 Scout (free, tested) | 30 min | Enables live ingestion |
| **P1** | Register MCP with Claude Code | 5 min | Enables NEop usage |
| **P1** | Add temporal metadata to closets | 1 hour | Enables temporal search |
| **P2** | Resolve graph ingestion (direct FalkorDB writes or paid OpenAI) | 2-4 hours | Enables graph features |
| **P2** | Frontend auth (Clerk or Convex Auth) | 2 hours | Enables public deployment |
| **P2** | Split coarse sections into finer closets | 1-2 hours | Improves search quality |
| **P3** | Run remaining benchmarks (LongMemEval, HotpotQA) | 1 week | Validates claims |
| **P3** | CI/CD pipeline (GitHub Actions) | 1 hour | Automates deploys |
