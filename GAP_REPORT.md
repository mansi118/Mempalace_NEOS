# PALACE Gap Report — What's Missing, Why, and Options Forward

**Generated:** April 20, 2026
**System State:** 424 closets, 694 facts, 14 tunnels, 100% embedding coverage, 0% graph ingestion

---

## 1. Knowledge Graph — 0/424 Ingested

### What's missing
All 424 closets have `graphitiStatus: "pending"`. Zero entity nodes or relationship edges exist in FalkorDB. The `palace_walk_tunnel` works only on manually created tunnels (14), not on auto-discovered entity relationships.

### Why it's missing
Graphiti v0.5+ switched from OpenAI's **Chat Completions API** to the **Responses API** (`client.responses.create` / `response.output_text`). HuggingFace-hosted LLMs (Llama 4 Scout, GPT-OSS, etc.) only support Chat Completions. The bridge creates the LLM client successfully but every `add_episode` call fails with `400: Not allowed to POST /v3/openai/responses`.

### Options to explore

| Option | Effort | Cost | Tradeoff |
|---|---|---|---|
| **A. Pin graphiti-core < 0.5** | Low | $0 | Older version may lack FalkorDB driver. Need to verify compatible version exists. |
| **B. Direct FalkorDB Cypher writes** | Medium | $0 | Skip Graphiti entirely. Write a `graphWriter.py` service that takes extracted entities (already produced by ingestion) and writes Cypher queries directly to FalkorDB. Full control, no LLM dependency at graph layer. Loses Graphiti's auto-dedup and contradiction detection (but we built both in Phase 8). |
| **C. Fork graphiti-core** | High | $0 | Patch `openai_base_client.py` to use `chat.completions.create` instead of `responses.create`. Maintenance burden on every upstream update. |
| **D. OpenAI API key (GPT-4o-mini)** | Low | ~$0.15/1M tokens | Graphiti works out of box. Adds paid dependency. ~$2/month at current volume. |
| **E. Self-hosted LLM on EC2** | High | $0 (compute cost) | Run Ollama or vLLM with a small model (Qwen 7B, Llama 8B). Graphiti points to localhost. EC2 t3.medium may not have enough RAM for inference. |
| **F. Wait for Graphiti update** | Zero | $0 | Graphiti may add chat completions support or a provider adapter. Unknown timeline. |
| **G. Use Neo4j instead of FalkorDB** | Medium | $0 | Graphiti's primary driver is Neo4j (better tested). Could swap FalkorDB for Neo4j community edition. But adds another service to manage. |

**Recommended:** Option B (direct FalkorDB writes) or Option D (GPT-4o-mini at $2/month).

---

## 2. Search Quality — 6/8 Queries Correct

### What's missing
Two query types consistently underperform:
- **Entity queries** ("Who is Rahul?") — score 0.44, below medium confidence
- **Topic queries with ambiguous terms** ("What is the ICP?", "Build3 fundraising") — top results are wrong wing/room

### Why it's missing
- Qwen3-Embedding-8B produces a **compressed score distribution** (relevant results score 0.4-0.8 vs Voyage/OpenAI at 0.6-0.95). The similarity floor (0.35) catches most results but confidence thresholds feel wrong.
- Section titles like "Identity" or "Library Structure" are generic — the embedding captures the title's generic meaning rather than the specific content about NeuralEDGE or ICPs.
- No **query expansion** — "Who is Rahul?" doesn't match well against a section titled "Dr. Rahul Kashyap" because the embedding model sees these as different semantic concepts.

### Options to explore

| Option | Effort | Impact |
|---|---|---|
| **A. Hybrid search (BM25 + vector)** | Medium | Keyword matching catches exact name matches that embeddings miss. Convex doesn't support BM25 natively — would need a fulltext search index or client-side filtering. |
| **B. Query expansion via LLM** | Medium | Before embedding, expand "Who is Rahul?" to "Rahul Kashyap NeuralEDGE CTO founder team". Uses Llama 4 Scout via HuggingFace (1 API call per search). |
| **C. Better embedding model** | Low | Try `Qwen/Qwen3-Embedding-0.6B` (faster, may have different score distribution) or `BAAI/bge-m3` (designed for retrieval). Requires re-embedding all 424 closets + schema dim change. |
| **D. Multi-vector per closet** | Medium | Embed both title and content separately. Score = max(title_score, content_score). Doubles embedding storage but improves title-match queries. |
| **E. Metadata pre-filtering** | Low | For queries containing known entity names (Rahul, Zoo Media, Convex), pre-filter to the relevant wing/room before vector search. Keyword → wing mapping already exists in `route.ts`. |
| **F. Re-rank with cross-encoder** | High | After vector search returns top-20, re-rank with a cross-encoder model (e.g., `ms-marco-MiniLM`). Dramatically improves relevance but adds latency. |

**Recommended:** Option E (metadata pre-filtering) for quick win + Option B (query expansion) for deeper fix.

---

## 3. Extraction LLM — Gemini Dependency

### What's missing
The ingestion pipeline (`convex/ingestion/extract.ts` + `convex/lib/geminiLlm.ts`) uses **Gemini 2.5 Flash** for memory extraction (routing + fact extraction). Gemini billing is not active on the current key — extraction fails silently and falls back to keyword routing.

### Why it's missing
The `ingestArchive.ts` script bypassed the extraction pipeline entirely — it used direct `createCloset` calls with pre-parsed markdown sections. The extraction pipeline was never exercised with real data. For future ingestion of Claude chat exports or live MCP `palace_remember`, Gemini (or a replacement) is needed.

### Options to explore

| Option | Effort | Cost |
|---|---|---|
| **A. Replace with Llama 4 Scout via HuggingFace** | Low | $0 | Already verified working. Change `geminiLlm.ts` to call `https://router.huggingface.co/novita/v3/openai/chat/completions` with model `meta-llama/llama-4-scout-17b-16e-instruct`. Same HF_TOKEN. |
| **B. Replace with GPT-OSS 20B via HuggingFace** | Low | $0 | Also verified working. Slightly faster than Llama 4 Scout. |
| **C. Fix Gemini billing** | Low | ~$0.50/month | Go to ai.studio/billing, raise cap. Gemini Flash is the cheapest option. |
| **D. Self-hosted extraction** | High | $0 (compute) | Run a small model locally. Overkill for this volume. |

**Recommended:** Option A (Llama 4 Scout). Already tested, free, good JSON output.

---

## 4. Vercel Deployment — Build Fails from Source

### What's missing
Vercel cannot build the frontend from source because components import from `@convex/_generated/api` which resolves via Vite alias to `../convex/_generated/api` (parent directory). Vercel's build environment can't access parent directories.

Currently deployed via pre-built `dist/` directory which works but requires manual rebuild + redeploy.

### Why it's missing
The frontend lives in `frontend/` but depends on Convex types from `convex/` (a sibling directory at the project root). Vite resolves this locally via the `@convex` alias, but Vercel's build environment only sees the `frontend/` directory.

### Options to explore

| Option | Effort | Impact |
|---|---|---|
| **A. Move frontend to project root** | Medium | Standard Vite project at root with `convex/` as sibling. Vercel sees both. Requires restructuring `package.json`. |
| **B. Copy `_generated/` into frontend at build time** | Low | Add a `prebuild` script: `cp -r ../convex/_generated frontend/src/convex`. Vercel runs it before `vite build`. |
| **C. Keep pre-built deploy** | Zero | Current approach works. Add a `deploy:vercel` script that builds locally then deploys `dist/`. |
| **D. Use Convex's hosted frontend** | Low | Convex supports hosting static sites. No Vercel needed. |
| **E. Monorepo with Turborepo** | High | Proper monorepo setup with shared packages. Overkill for this project size. |

**Recommended:** Option B (copy at build time) or Option C (keep pre-built).

---

## 5. Maintenance Crons — Untested in Production

### What's missing
10 cron jobs are defined in `convex/crons.ts` but never verified in production:
- `rebuild-l0-l1` (24h) — L0/L1 may not refresh if the cron fails silently
- `decay-closets` (6h) — no closets have TTLs set, so this is a no-op
- `backfill-embeddings` (6h) — works (verified manually) but cron hasn't fired yet
- `backfill-graphiti` (6h) — fails because bridge can't ingest (Issue #1)
- `detect-contradictions` (7d) — word-overlap heuristic untested on real data
- `detect-duplicate-rooms` (7d) — name similarity untested

### Why it's missing
Crons were defined in Phase 8 but the system was deployed only hours ago. Most crons haven't had time to fire their first tick. The 6-hour and 24-hour intervals mean we need to wait 1-7 days to see them in action.

### Options to explore

| Option | Effort |
|---|---|
| **A. Manual trigger each cron** | Low — `npx convex run maintenance/curator:rebuildAllL0L1` etc. |
| **B. Add a "run all maintenance" action** | Low — one action that calls all cron handlers sequentially |
| **C. Reduce intervals for testing** | Low — temporarily set to 1h, verify, then restore |

**Recommended:** Option A (manual trigger), then monitor via `npx convex run serving/monitoring:pipelineHealth`.

---

## 6. Access Control — Untested End-to-End

### What's missing
Phase 7 has 26 unit tests on the enforce module, but no integration test that:
- Registers a real NEop with the MCP server
- Attempts reads and writes through the HTTP endpoint
- Verifies denied operations return 403
- Verifies scope bindings restrict wing access

### Why it's missing
MCP registration with Claude Code hasn't been done yet (requires `CONVEX_SITE_URL` configured). All testing so far uses `neopId: "_admin"` which bypasses all access checks.

### Options to explore

| Option | Effort |
|---|---|
| **A. HTTP integration test script** | Medium — curl-based test script that calls `/mcp` with different neopIds and verifies responses |
| **B. Register real NEop in Claude Code** | Low — `claude mcp add palace -- npx tsx scripts/mcpServer.ts --neop-id=aria` |
| **C. Playwright E2E test** | High — browser-based test that searches as different NEops |

**Recommended:** Option A (curl test script) + Option B (register Aria).

---

## 7. Frontend — Missing Features

### What's missing
- **No authentication** — anyone with the URL can browse all palace data
- **No write UI** — can't add memories from the dashboard (only via MCP)
- **No quarantine review UI** — quarantined items need manual triage via CLI
- **No room-to-room navigation** — clicking a tunnel connection doesn't navigate
- **No search from room view** — can't search within a specific wing/room
- **No mobile responsiveness** — inline styles don't have breakpoints
- **No loading skeletons** — page content pops in without transition

### Options to explore

| Feature | Effort | Priority |
|---|---|---|
| Auth (Clerk/Convex Auth) | Medium | High — blocks public deployment |
| "Remember" input box | Low | Medium — enables write from UI |
| Quarantine review panel | Medium | Medium — surfaces needsReview items |
| Tunnel click navigation | Low | Low — nice-to-have |
| Wing-scoped search | Low | Medium — useful for deep dives |
| Mobile CSS | Medium | Low — primary users are desktop |
| Skeleton loading states | Low | Low — cosmetic |

---

## 8. Data Quality — Archive-Specific Issues

### What's missing
- **Section-level granularity is too coarse** — a section titled "Complete NEops Roster" contains 15 different NEops. Searching for "What is Aria?" matches the entire roster, not Aria-specific content.
- **No conversation-level context** — the archive was ingested as standalone sections. Cross-references between sections (e.g., "as mentioned in the architecture section") are lost.
- **No temporal data** — all 424 closets have the same `createdAt` (ingestion time), not the original conversation date. Temporal search returns everything or nothing.
- **42 conversations in chat_index not ingested** — the `08_chat_index/conversation_index.md` lists 42 Claude conversation URLs that could be individually fetched and ingested for richer content.

### Options to explore

| Option | Effort | Impact |
|---|---|---|
| **A. Split large sections** | Medium | Break "Complete NEops Roster" into per-NEop closets. Better search granularity. |
| **B. Add original dates** | Low | Parse dates from archive metadata, update closet `createdAt`. Enables temporal search. |
| **C. Ingest raw Claude conversations** | High | Export from claude.ai, parse with `parseClaude.ts`, run through extraction pipeline. Adds conversational context. |
| **D. Cross-reference linking** | Medium | Detect mentions of other wings/rooms in content, auto-create tunnels. |

---

## 9. Operational Gaps

### What's missing

| Gap | Impact | Fix |
|---|---|---|
| **No backup strategy** | Data loss risk | Convex has built-in snapshots. FalkorDB needs `BGSAVE` cron. |
| **No cost tracking** | Budget blindness | Log Qwen API tokens used per call. Aggregate daily. |
| **No alerting** | Silent failures | Set up a simple health check that pings `/health` every 5 min. |
| **No rate limiting on MCP** | DoS risk | Add request rate limiting to `convex/http.ts`. |
| **EC2 bridge not monitored** | Bridge goes down unnoticed | Add uptime monitoring (UptimeRobot, free tier). |
| **Git credentials in history** | Security | GitHub PAT and HF token were used in commands. Rotate both. |
| **No CI/CD pipeline** | Manual deploys | GitHub Actions: on push → `npx convex deploy` + `vercel deploy dist/`. |

---

## 10. Summary — Priority Matrix

| Priority | Gap | Effort | Status |
|---|---|---|---|
| **P0** | Graph ingestion blocked (Graphiti/Responses API) | Decide approach | Blocked |
| **P0** | Extraction LLM (Gemini not active) | Low — swap to Llama 4 Scout | Not started |
| **P1** | Search quality (6/8) | Medium — query expansion + pre-filtering | Partially addressed |
| **P1** | Cron verification | Low — manual trigger | Not started |
| **P1** | Access control E2E test | Medium — curl script | Not started |
| **P2** | Vercel build from source | Low — prebuild copy script | Workaround in place |
| **P2** | Data quality (section granularity) | Medium | Not started |
| **P2** | Frontend auth | Medium | Not started |
| **P2** | Operational gaps (backup, alerting) | Low each | Not started |
| **P3** | Frontend features (write UI, mobile) | Medium | Not started |
| **P3** | Raw Claude conversation ingestion | High | Not started |
| **P3** | CI/CD pipeline | Medium | Not started |

---

## Decisions Needed

1. **Graph approach:** Skip Graphiti entirely (Option B: direct FalkorDB writes), use a paid LLM (Option D: GPT-4o-mini), or defer graph features?
2. **Extraction LLM:** Swap to Llama 4 Scout (free, tested) or fix Gemini billing?
3. **Deployment:** Keep pre-built Vercel deploy or invest in monorepo structure?
4. **Auth:** Add before public launch or keep internal-only for now?
5. **Priority:** Which P0/P1 items to tackle first?
