# PALACE — Implementation Walkthrough

The point of this doc: if you had never seen the codebase, you could read this once and then explain every file, every flow, every trade-off. It's long on purpose.

---

## 1. The mental model — why "palace"

Loose analogy to the method-of-loci: human memory is spatial, so the data model is spatial too. Every memory lives at a concrete address.

```
Palace
├── Wing          e.g. "platform", "clients", "legal", "gtm"
│   └── Hall      e.g. "product", "ops", "internal"          (organisational grouping)
│       └── Room  e.g. "zoo-media", "neop-catalog"           (topic/project)
│           └── Closet  e.g. "Zoo Media pricing overview"    (a memory — a paragraph)
│                └── Drawer  e.g. "retainer=₹12L/mo from 2026-02" (atomic fact inside)
Tunnels: cross-room edges (e.g. clients/zoo-media —depends_on→ platform/neop-catalog)
```

Why four levels of nesting instead of flat tags?
- **Halls** exist so a wing can have two independent categorisations (product vs. ops). Halls aren't exposed much in the UI — they're a compromise so "platform" doesn't need sub-wings.
- **Rooms** are where retrieval actually lives — one topic per room. Access scope maps to (wing, room) tuples.
- **Closets** hold the rich context. They're the unit of embedding, retraction, and versioning.
- **Drawers** split closets into atomic facts so we can retire one fact (validFrom/validUntil) without deleting the closet. Also what `detectContradictions` operates on.

A **tunnel** is a typed edge between two rooms (not between closets). It says "people working in room A will benefit from context in room B." Only 14 today, seeded manually.

---

## 2. Data model

File: `convex/schema.ts`.

| Table | Purpose | Key fields |
|---|---|---|
| `palaces` | Tenant root | `clientId` (e.g. `neuraledge`), `status`, `l0_briefing`, `l1_wing_index` |
| `wings` | Top-level folder | `palaceId`, `name`, `description`, `roomCount`, `phase` |
| `halls` | Sub-organisation within wing | `wingId`, `type` (product/ops/internal) |
| `rooms` | Topic | `hallId`, `wingId`, `name`, `summary`, `tags`, `closetCount`, `lastUpdated` |
| `closets` | Memory item | content, title, category, confidence, source+author provenance, versioning (`supersededBy`), lifecycle (`decayed`/`retracted`/`legalHold`), PII tags, embedding status, graphiti status, entities counts |
| `drawers` | Atomic fact inside a closet | `fact`, `validFrom`, `validUntil`, `supersededBy`, confidence |
| `tunnels` | Room→room typed edge | `relationship`, `strength` (0-1) |
| `closet_embeddings` | Vector index | 1024-d embeddings (Bedrock Titan v2), `model`, `modelVersion` |
| `neop_permissions` | Per-NEop ACL | `runtimeOps`, `contentAccess` (JSON), `scopeWing`, `scopeRoom` |
| `audit_events` | Every op trace | `op`, `neopId`, `status`, `latencyMs`, `queryHash`, `extra` |
| `ingestion_log` | Per-ingestion row | `status`, `tokensUsed`, `closetsCreated`, errors |
| `query_log` | Every search | `query`, `queryHash`, `resultCount`, `topScore`, `confidence`, `latencyMs`, `mode` |

Schema constraints worth knowing:
- Closets are **append-only for most fields** — `convex/lib/safePatch.ts` enforces a whitelist of patchable fields (`decayed`, `retracted`, `supersededBy`, etc.). Content changes go through a new closet with the previous one's `supersededBy` set.
- `by_dedup` index on closets uses `(palaceId, dedupKey)` where dedupKey = `sha256(sourceAdapter + sourceExternalId)`. Second ingestion of the same source item produces a new *version*, not a duplicate.
- Vector index `closet_embeddings.by_embedding` is 1024-d with `palaceId, wingId` as filter fields. `palaceId` filter is pre-push so cross-tenant leaks are structurally impossible even if ACL logic has a bug.

---

## 3. Ingestion pipeline

File: `convex/ingestion/ingest.ts` (the orchestrator), `extract.ts` (prompt + parser), `route.ts` (wing/room classifier), `pii.ts` (PII scan), `embed.ts` (embed + store), `mutations.ts` (DB writes), `extractEntities.ts` (graph ingest).

Input is one "exchange" — a human+assistant turn, typically from a Claude chat export.

**Step 1 — PII scan.** Regex-based. Emits a set of PII tags (`email`, `phone`, `credit_card`, `ssn`, etc.). Gets stored on the closet. If any PII, `visibility` drops to `restricted` automatically.

**Step 2 — Extraction via Gemini.** System prompt in `extract.ts` (large — defines the palace metaphor, lists valid categories, asks for structured JSON output). Returns a list of `ExtractionItem`s: each has wing, room, category, closet content, atomic facts, confidence. One exchange → typically 0-3 closets.

**Step 3 — Fallback routing.** If Gemini fails (rate limit, bad JSON), we fall through to `routeToWing()` + `routeToRoom()` in `route.ts` — substring matching against `WING_KEYWORDS` (e.g. "zoo media" → `clients`, "convex" → `rd`). Quality lower but never drops data.

**Step 4 — For each extraction item:**

a. `getOrCreateRoom` — finds or creates the target room (idempotent on wing + room name).

b. `createCloset` mutation. Critical checks: validates category/source/author enums, computes `dedupKey`, looks for priors. If a prior with the same dedupKey exists, creates a new version and sets `supersededBy` on the old one.

c. `createDrawer` for each atomic fact — links to the parent closet, sets `validFrom=now`, `validUntil=undefined` (still valid).

d. Embed + store. `embedOne(enrichedText)` hits Bedrock; the enriched text is `[wing/room] title + category + content` (prefix helps the embedding capture context). Result stored in `closet_embeddings` with a dim check (1024). Sets `closet.embeddingStatus = "generated"`.

e. Fire-and-forget to the bridge: `POST /graph/ingest` with the extracted entities + relations. Bridge writes Cypher MERGE queries to FalkorDB. Sets `closet.entitiesExtracted=true`.

f. Log one row in `ingestion_log` with the status, token count, any errors.

**Step 5 — Error handling.** Partial failures are allowed. A closet can exist with `embeddingStatus="failed"` and `graphitiStatus="pending"` — the `backfill*` crons will retry.

---

## 4. Retrieval pipeline

File: `convex/serving/search.ts`, `enrich.ts`, `lib/qwen.ts` (embedding client — name is legacy, actually calls Bedrock Titan), `lib/graphClient.ts` (bridge proxy).

Entry points: `searchPalace`, `searchWing`, `searchTemporal` — all action types. Shared core: `coreSearch()`.

```
coreSearch(palaceId, query, wingFilter?, categoryFilter?, limit, floor, afterTs?, beforeTs?, neopId?, mode?)
```

### 4.1 The flow, step by step

**0. Empty query guard.** Whitespace-only input → return `{results:[], reason:"empty_query"}`.

**1. Parallel: palace lookup + query expansion is not active** (disabled after benchmarking regression — kept as library for sparser palaces).

**2. Parallel: embed query + graph-search.** `embedOne(trimmed)` hits Bedrock. `graphSearch(clientId, trimmed, 15)` hits the bridge's `/graph/search` (3s timeout, returns `[]` on any error). Graph is **purely advisory** — if the bridge is down, search degrades to vector-only without the user noticing.

**3. Vector search.** `ctx.vectorSearch("closet_embeddings", "by_embedding", {vector: queryEmbedding, limit: limit*3, filter: eq("palaceId", ...)})`. Overfetches 3× so post-filters (category, wing, decayed, retracted) have headroom.

**4. Resolve embedding docs → closet IDs.** Vector search returns embedding table IDs, not closet IDs. An internal query (`resolveEmbeddingIds`) expands them.

**5. Build `scoreMap: closetId → vector_score`.** `graphBoostMap` (from step 2) is built separately: closet → count-of-entities-matching-query.

**6. Enrich + filter + score.** For each closet:
```
vectorScore    = scoreMap.get(id)
graphBoost     = min(graphBoostMap.get(id) * 0.05, 0.20)     // +0.2 max
confidenceBoost = closet.confidence * 0.05                    // +0.05 max
recencyBoost   = exp(-ageDays/90) * 0.05                     // +0.05 max
finalScore     = vectorScore + graphBoost + confidenceBoost + recencyBoost

// Floor test uses raw vector+graph only — the boosts can't sneak a
// low-sim closet past the "I don't know" guardrail.
if (vectorScore + graphBoost < floor) continue
```

Post-filters drop retracted, decayed, old-version, wing-mismatch, category-mismatch, and outside-time-range closets.

**7. MMR-lite diversification.** Re-rank with a same-room penalty: each subsequent pick from an already-picked room pays −0.03. Greedy top-K, re-sort the pool each iteration. No real MMR (would need doc embeddings at query time); this catches 80% of the diversity benefit for 1% of the compute.

**8. Confidence label.** `topScore >= 0.65 → high`, `>=0.50 → medium`, else `low`. Thresholds calibrated for Titan v2's compressed score range (empirically 0.25 off-domain, 0.45–0.55 weak in-domain, 0.55–0.75 relevant).

**9. Log the query.** Fire-and-forget to `logQuery` mutation → `query_log` table. Never blocks the response.

**10. Return `SearchResponse`.**

### 4.2 Why this ranking, not pure vector?

- **Confidence bonus** (up to +0.05): closets from high-quality extractions (Gemini was confident) get a small lift. Stops noisy extractions from dominating even if they happen to embed well.
- **Recency bonus** (up to +0.05, half-life 90d): ties break toward fresh memories. Since most current closets were ingested at the same time, this is mostly inert today — it matters as new memories land.
- **Graph boost** (up to +0.20): if the query contains an entity name, boost every closet that mentions that entity. Biggest lever. The cap prevents one closet with 10 entities from dominating.
- **Room-diversity penalty** (−0.03/repeat): prevents "Complete NEops Roster" from taking all 5 top slots when searching for anything NEop-related.

R@5 on our 40-query benchmark: 90 / 93 / 100 (easy / medium / hard), unanswerable 100. Tier 1 alone (adding these bonuses + MMR + threshold recalibration) moved hard R@5 from 40% to 100%.

---

## 5. Entity graph (FalkorDB via bridge)

Files: `services/graph_writer.py` (bridge), `services/graphiti_bridge.py` (FastAPI host), `convex/lib/graphClient.ts` (Convex-side proxy client), `convex/serving/graph.ts` (Convex actions for the frontend), `convex/ingestion/extractEntities.ts` (extraction pipeline), `convex/lib/entityExtractor.ts` (Groq prompt + parser).

### 5.1 Why a separate graph store at all

Three things vector search can't do:
1. **"Show me everything connected to X"** — multi-hop traversal. Vector similarity is 1-hop at best.
2. **Entity occurrence counting** — "which memories mention Zoo Media?" The vector-search answer depends on query phrasing.
3. **Relation-typed queries** — "which tech does NEops use?" Typed edges (USES, BUILT_BY, DEPENDS_ON) are queryable in graph.

### 5.2 Why FalkorDB not Neo4j

- Redis-protocol native → Docker stack is just two services (bridge + falkordb) on the same host, no JVM
- Cypher-compatible (OpenCypher subset) → queries ported from Graphiti's expected style
- Writes ~10x faster than Neo4j for small ops → matters when ingesting 425 closets × 3 entities each
- Free, single binary, small memory footprint → EC2 t3.medium is enough

### 5.3 Why a bridge in front of FalkorDB

Convex functions are serverless — they can't hold Redis connections across invocations. FalkorDB speaks Redis protocol, not HTTP. The bridge (FastAPI on EC2) holds the redis.Redis client pool and exposes HTTP.

### 5.4 Graph schema

```
(:Closet {id, wing, room, title})
(:Entity {name, type, occurrences, aliases})

(:Closet)-[:MENTIONS]->(:Entity)                    // 1 per extracted entity
(:Entity)-[:CO_OCCURS {count}]-(:Entity)            // undirected, same closet
(:Entity)-[:<TYPED_RELATION> {source_closet, count}]->(:Entity)   // e.g. :BUILT_BY, :USES
```

Current data: **1,325 entities, 11,303 relationships, 425 closets**.

### 5.5 Extraction pipeline

`extractAndIngestCloset` action per closet:
1. Load closet + palace + wing + room (for context + graph name)
2. Call Groq `llama-3.1-8b-instant` with the entity-extraction prompt (system = structured-JSON instruction, user = `title + content`)
3. Parse JSON → `{entities: [{name,type,aliases}], relations: [{from,to,relation}]}`
4. POST to bridge `/graph/ingest` with palace_id, closet_id, wing, room, title, entities, relations
5. Bridge does per-entity MERGE, per-relation MERGE, and an inner loop for all-pairs CO_OCCURS edges in this closet
6. Store `entitiesExtracted=true, entitiesCount, relationsCount` on the closet

Throttling: backfill uses `CONCURRENCY=1` with `REQUEST_INTERVAL_MS=2200` to stay under Groq free tier (30 RPM, but TPM binds first — our 3K-token prompts hit the 12K TPM cap at ~4 calls/min on the 70B model, which is why we moved to 8B with 30K TPM).

### 5.6 The Cypher injection story

Before P0.2, the bridge built queries by f-string interpolation with a 3-char `escape()`. Entity names come from an LLM. An entity name of `Foo'); DROP GRAPH x //` would bypass escape and execute as a query statement.

After P0.2: **all user values bound via `CYPHER k=v ...` prefix.** JSON-serialized literals, parsed by FalkorDB as literal data — can't become query structure. Relationship types can't be bound in Cypher, so those go through a strict alphanumeric whitelist that rejects anything not matching `^[A-Z][A-Z0-9_]{0,63}$`, defaulting to `RELATED_TO`.

Verified with adversarial payload: `Evil'); DROP GRAPH palace_neuraledge_hq //` → stored as an entity named literally `Evil'); DROP GRAPH palace_neuraledge_hq //`. Graph intact.

---

## 6. Access control (NEops)

Files: `convex/access/enforce.ts` (policy resolution + enforce), `convex/access/queries.ts`, `convex/lib/access_matrix.yaml` (source of truth), `scripts/seedAccess.ts` (loader).

### 6.1 Model

```
NEop (user-like entity)
├── runtimeOps  = [recall, remember, promote, erase, audit]   // verbs they can do
├── contentAccess = per-wing JSON: {read: "*"|[cats], write: "*"|[cats]}
├── scopeWing   = optional: restricts all content ops to one wing
└── scopeRoom   = optional: further restrict within that wing
```

Five seeded NEops:

| NEop | recall | remember | erase | visible wings |
|---|---|---|---|---|
| `_admin` | ✓ | ✓ | ✓ | all |
| `aria` (SDR) | ✓ | ✓ | ✗ | platform, clients, team, gtm, brand |
| `neuralchat` | ✓ | ✗ | ✗ | platform, clients, team, gtm, brand |
| `forge` | ✓ | ✓ | ✓ | platform, rd, infra, marketplace |
| `recon` | ✓ | ✓ | ✗ | gtm, clients, partners, brand |

Every content-touching op goes through `enforce.ts:enforceOp(palace, neop, op, wing, room, category)`. Denied → `{status:"denied", reason:...}`, written to `audit_events`. Invariant: `run_acl_suite.ts` tests all 20 (neop × op) combinations against the expected allow/deny matrix. Currently 20/20.

### 6.2 Scope bindings

A NEop can have a parent. Example: `icd_zoo_media` is scoped from `aria` → inherits Aria's contentAccess but restricted to `clients/zoo-media`. Useful for client-facing deployments where the NEop should only see that client's data.

---

## 7. The L0/L1/L2 context layering

Files: `convex/serving/assemble.ts` (assembleContext), `convex/maintenance/curator.ts` (rebuilds L0/L1 on cron).

When a NEop invokes `palace_recall(query)`, they get a context block with three layers:

**L0 — Palace Identity (~50 tokens).** Static per palace. One-line summary: "NeuralEDGE HQ — an AI-native agent platform company building NEops and the NEOS OS, selling to agencies/Zoo Media as first client."

**L1 — Wing Index (~120 tokens).** Dynamic, regenerated daily by `rebuild-l0-l1` cron. Lists every wing with its room count and last-activity timestamp. Helps the NEop know where to look even when search doesn't surface anything.

**L2 — Search Results (budgeted by remaining tokens).** The output of `coreSearch`, greedily packed until the token budget hits. Token budget = requested - L0 - L1.

Why this split: NEops have a fixed context window. L0 and L1 are cheap and stable; L2 is the dynamic part. If the budget is tight, L2 truncates but L0/L1 always survive — the NEop always knows which palace it's in and what wings exist.

---

## 8. Infrastructure

### 8.1 Convex

Two deployments:
- Dev: `small-dogfish-433.convex.cloud` (used for all development + benchmark runs)
- Prod: `modest-camel-322.convex.cloud` (serves the live Vercel frontend)

Deploys via `npx convex deploy -y`. Reactive queries push changes to the browser over WebSocket. Actions are HTTP-like RPCs (used when we need to call external services like Bedrock or the bridge — queries/mutations are sandboxed and can't make HTTP).

### 8.2 EC2 bridge

Host: `13.127.254.149` (ap-south-1). Two containers on Docker Compose:
- `palace-bridge-1` — FastAPI app exposing `/health`, `/version`, `/ingest` (old Graphiti path, disused), `/graph/ingest`, `/graph/search`, `/graph/traverse`, `/graph/stats/{palace_id}`. Authenticates with `X-Palace-Key` header; rejects 401 otherwise.
- `palace-falkordb-1` — FalkorDB server, port 6379, volume `palace_falkordb_data` for persistence.

Bridge container built from `services/Dockerfile` (Python 3.12-slim, copies `config.py + graphiti_bridge.py + graph_writer.py`, runs `uvicorn graphiti_bridge:app`). Rebuilt + restarted via `sudo docker compose build bridge && sudo docker compose up -d bridge`.

### 8.3 Vercel

Project `mansi5/dist` hosts the frontend static build. Current live URL: `https://dist-dbqy631f8-mansi5.vercel.app/`. Deploy is pre-built via `npm run build` → `vercel deploy frontend/dist --prod --yes` because Vite's alias to `../convex/_generated/api` doesn't resolve from Vercel's isolated build context.

---

## 9. Frontend

Files: `frontend/src/App.tsx` (router + layout), `frontend/src/components/*` (pages + panels), `frontend/src/index.css` (Tailwind v4 + animations), `frontend/playwright.config.ts` + `frontend/tests/smoke.spec.ts` (E2E tests).

### 9.1 Routing

Hash-based, no external router. `parseRoute(location.hash)` returns one of `home | room | test | entities | queries | admin`. Implemented in `useRouter()` — listens to `hashchange`, syncs state, provides `navigate` and `back`. Browser back/forward works naturally; every route is deep-linkable.

### 9.2 Data fetching

Every read uses `useQuery(api.X.Y, args)` from `convex/react`. These are reactive subscriptions — when a mutation changes underlying data, the query result pushes back to the component automatically. No polling, no manual refetch.

Writes (mutations) and external calls (actions — search, extractAndIngest, graph*) use `useAction`. They're `await`-able promises.

### 9.3 Pages

| Route | Component | Data sources |
|---|---|---|
| `/` | Hero + StatsPanel + MonitoringPanel + TunnelMap + WingsGrid | listPalaces, getStats, listWings, listAllTunnels, searchLatencyStats, errorRate, pipelineHealth |
| `/room/:id` | RoomView | getRoomDeep (joins closets + drawers + tunnels in one call) |
| `/test` | TestPlayground | searchPalace action with 7 preset queries |
| `/entities` | EntitiesView | graphStats + graphSearch + graphTraverse (Bedrock-bearer-proxied via Convex) |
| `/queries` | QueriesView | recentQueries + queryLogStats |
| `/admin` | AdminView (4 tabs) | listQuarantined, recentAuditEvents, listNeops, pipelineHealth, ingestionActivity, errorRate |

### 9.4 Search palette

Modal overlay, opens with `/` or `Ctrl+K`. Arrow-key navigation between results. Enter on a result navigates to its room. Uses the `searchPalace` action directly (not the MCP HTTP path).

---

## 10. Tests + gates

Five layers, all in one command (`./scripts/run_all_tests.sh`):

1. **`npm test` (vitest)** — 46/46. Tests Convex logic with mocked DB (`convex-test` package). Covers Phase 1 invariants (append-only, supersession, retraction redacting).
2. **`benchmarks/run_e2e_smoke.ts`** — 26/26. Hits every Convex API the frontend uses against live dev; asserts shape + non-empty + expected behaviour (empty-query guard, off-domain low-confidence).
3. **`benchmarks/run_mutation_smoke.ts`** — 14/15. Creates a closet in the `_quarantine` wing, verifies it round-trips, retracts it, verifies content is `[REDACTED]`, verifies the embedding row is deleted, verifies audit-query wiring, verifies the retracted closet doesn't appear in search.
4. **`benchmarks/run_acl_suite.ts`** — 20/20. Invariant: every (NEop × op) must match the access matrix. Exits non-zero on any deviation.
5. **`benchmarks/run_relevance_retrieval.ts`** — 40 queries × 4 budgets. Exits non-zero if medium R@5 < 85%, hard R@5 < 60%, unanswerable < 100%, or p95 > 3000ms.

Plus Playwright (`frontend/tests/smoke.spec.ts`): 8 tests × 6 routes. Not in the wrapper because it needs a browser install; run separately via `npm run test:e2e`.

### 10.1 CI

`.github/workflows/test.yml`:
- Unit tests on every PR (fast, no external calls).
- On push to main: unit + E2E smoke + mutation smoke + ACL + retrieval with budgets.

`.github/workflows/canary.yml`:
- Every 15 min, hits prod `/mcp` with "Zoo Media" query.
- If status is not "ok" OR result count is 0 OR confidence is "low", opens a `production-down` GitHub issue (or comments on the existing one to dedupe).
- This is what catches silent Bedrock token expiry.

---

## 11. Operational flows worth knowing

### 11.1 A live search, end to end

1. User types "Zoo Media retainer" into the search palette.
2. React calls `useAction(api.serving.search.searchPalace)` — WebSocket RPC to Convex action.
3. Convex action enters `coreSearch` (node runtime):
   a. `getPalaceForSearch` (1 DB query) → palace.clientId
   b. Parallel: `embedOne("Zoo Media retainer")` (Bedrock Titan, ~200ms) + `graphSearch("neuraledge", "zoo media retainer", 15)` (bridge HTTP, ~100ms)
   c. `ctx.vectorSearch` (~50ms, palaceId-filtered) → 15 candidate embedding docs
   d. `resolveEmbeddingIds` (1 DB query) → 15 closetIds
   e. `enrichClosets` (joins closets + wings + rooms) → full data
   f. Score + filter + MMR → top-5
   g. Log to `query_log`
   h. Return response (~500 KB JSON at worst)
4. Frontend renders top-5 with category chip + score + wing/room + content preview.

Total: ~800ms typical, ~1.7s p95. Most time is Bedrock.

### 11.2 Retracting a closet

1. Admin calls `api.palace.mutations.retractCloset({closetId, reason, retractedBy})`.
2. Mutation:
   a. Load closet, check palace match, refuse if already retracted
   b. Write audit field (`retracted=true, retractedBy, retractedAt, retractReason`)
   c. **Replace content with `[REDACTED]`** — defense in depth: even if ACL fails, the content is gone
   d. **Delete the embedding row** — vector search can't surface it anymore
   e. Decrement `room.closetCount`
3. Returns `{status: "ok", closetId, reason}`.

Verified by `run_mutation_smoke.ts` on every CI run.

### 11.3 Adding an entity (auto, via ingestion)

1. During `ingestExchange`, after `createCloset`, a background action fires: `ctx.runAction(api.ingestion.extractEntities.extractAndIngestCloset, {closetId})`.
2. That action calls Groq with the closet text → JSON entity list.
3. POSTs to bridge `/graph/ingest` → Cypher MERGE for entity + closet + :MENTIONS edge + all-pairs :CO_OCCURS + typed relations.
4. Calls `setEntityExtractionResult` mutation → closet gets `entitiesExtracted=true`, `entitiesCount`, `relationsCount`.

If Groq is rate-limited, the whole step fails — but the closet still exists. The `backfill-graphiti` cron (every 6h) will retry.

---

## 12. Key architectural decisions with trade-offs

**Convex instead of Postgres + custom backend.** Upside: reactive queries, built-in vector search, typed schema, free tier, zero ops. Downside: vendor lock-in, can't run HTTP servers inside Convex (hence the bridge), 10s action timeouts limit long-running ops (hence paginated purges).

**FalkorDB instead of Neo4j or pgvector.** Same answer as why a separate graph at all — Cypher + multi-hop + low ops. pgvector would have merged embeddings + graph but requires Postgres stack + vector index tuning.

**A bridge process instead of direct FalkorDB over HTTP.** FalkorDB has a REST shim, but it's thin — no auth, no request validation, no business logic. Bridge is ~500 LOC of FastAPI that owns the Redis connection pool + enforces `X-Palace-Key` + rejects malformed requests.

**Bedrock Titan over OpenAI/Voyage/Cohere.** Good quality (1024d, 8K context), zero SDK (bearer token over HTTPS), geographically close (ap-south-1). Downside: 12-hour token expiry is painful; permanent fix queued (swap to OpenAI or use IAM + SigV4 signing).

**Groq over HF/Novita for extraction.** HF credits depleted at 145/428 closets during backfill. Groq free tier is generous enough (30K TPM on 8B model) to finish the other 283 closets, works on same OpenAI-compatible API shape.

**MMR-lite (room penalty) over true MMR.** True MMR needs document embeddings at query time — extra round-trips. Room penalty uses metadata the enrichment step already fetches — free.

**Hash router instead of react-router.** One dep not added. `useHashRoute` is 10 LOC. Works with Vercel static hosting without rewrite rules.

**Query expansion off by default.** Benchmarked: expansion via Groq Llama 3.1 8B dropped hard R@5 from 100% to 90% on this corpus. Module lives at `convex/lib/queryExpander.ts` for future sparser palaces, wired in but not called.

**Embedding field names say "qwen" even though we use Bedrock.** Legacy from the pre-migration era. `convex/lib/qwen.ts` is the Bedrock client; `modelVersion` defaults to "8B" but actual model is Titan v2. Intentional to avoid churning every call site; only the `EXPECTED_DIMS` check (1024) actually matters.

**Two palaces in the registry (`neuraledge`, `zoo_media`) but only `neuraledge` has data.** Scaffolding for multi-tenant. Bridge `palace_id` → `graph_name` mapping in `services/config.py:_DEFAULT_REGISTRY`.

---

## 13. Known gaps (from RUNBOOK + improvement plan)

- **Bedrock 12h bearer-token expiry.** Canary alerts, but no auto-refresh. Needs either OpenAI swap or IAM-signed requests.
- **No FalkorDB RDB backup cron.** Single EC2 volume is the only copy.
- **No auth on the frontend.** Everything runs as `_admin`. Needs Convex Auth before external demos.
- **`/mcp` HTTP endpoint no rate limiting.** Could be DDoSed. Not critical since it's not widely known.
- **Query expansion disabled.** If we add sparser client palaces in the future, this becomes important again.
- **Section granularity too coarse.** "Complete NEops Roster" = 15 NEops in one closet. A re-parse that splits at `###` headers would lift fine-grained entity queries 15-20 pp.
- **2,249 Claude conversations not ingested.** 409MB of raw Claude chat history sitting in `conversations.json` — gated on HF credits for extraction.

---

## 14. The one-line summary of every major file

| File | Purpose |
|---|---|
| `convex/schema.ts` | single source of truth for data model (13 tables) |
| `convex/crons.ts` | 10 scheduled jobs (rebuild L0/L1, decay, backfill, dedup detectors) |
| `convex/palace/mutations.ts` | every write operation; safePatch enforces append-only |
| `convex/palace/queries.ts` | every read the frontend + MCP use |
| `convex/serving/search.ts` | the retrieval algorithm (core) |
| `convex/serving/graph.ts` | actions the frontend uses to browse the entity graph |
| `convex/serving/rooms.ts` | deep room view (closets + drawers + tunnels in one call) |
| `convex/serving/assemble.ts` | L0/L1/L2 context assembly for NEops |
| `convex/serving/monitoring.ts` | latency / errors / pipeline stats for dashboards |
| `convex/ingestion/ingest.ts` | per-exchange orchestrator |
| `convex/ingestion/extract.ts` | Gemini prompt + JSON parser for memory extraction |
| `convex/ingestion/extractEntities.ts` | Groq-powered secondary pass that populates the graph |
| `convex/access/enforce.ts` | NEop permission resolution + audit write |
| `convex/lib/qwen.ts` | **Bedrock Titan** client (name is legacy) |
| `convex/lib/entityExtractor.ts` | Groq NER client |
| `convex/lib/graphClient.ts` | bridge HTTP client used by search |
| `convex/lib/safePatch.ts` | allowlist of mutable fields per table |
| `services/graphiti_bridge.py` | FastAPI app + lifespan + auth middleware |
| `services/graph_writer.py` | Cypher-parameterized graph ingestion + query endpoints |
| `services/config.py` | palace→graph_name registry |
| `frontend/src/App.tsx` | router + layout + query wiring |
| `frontend/src/components/*.tsx` | one component per UI panel |
| `scripts/run_all_tests.sh` | chain every test suite, single exit code |
| `scripts/backfillEntities.ts` | resumable entity backfill with throttling |
| `scripts/reembed.ts` | resumable closet re-embed (used after swapping embedding model) |
| `benchmarks/run_*.ts` | five test suites wired into CI |

That's the shape of the system. The interesting behaviours emerge from the interaction between these pieces — none of them is clever alone.
