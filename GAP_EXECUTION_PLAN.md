# PALACE Gap Resolution — Execution Plan

**Generated:** 2026-04-21
**Status after FalkorDB shift:** P0s on knowledge graph + extraction LLM are DONE. Graph has 570 entities, 4,813 relations, 155/428 closets ingested.
**Meta-blocker:** HF Novita credits depleted → blocks Qwen embeddings, Llama extraction, Gemini fallback until resolved.

---

## The Real Dependency Graph

```
HF credits (TOP-UP or SWITCH)
  ├─ Resume entity backfill (271 remaining closets)
  ├─ Query expansion (search quality jump)
  ├─ Re-benchmark (measure reality)
  └─ Raw Claude conversation ingestion (23K messages)

Auth decision
  └─ Public frontend deploy
      └─ Client demos

No dependencies (can ship today):
  - Metadata pre-filter in search
  - Cron verification
  - ACL E2E HTTP test
  - Vercel prebuild fix
  - MCP rate limiting
  - Monitoring (UptimeRobot)
  - Git credential rotation
  - CI/CD pipeline
```

**Critical path:** HF top-up → Phase 2 search quality → Auth → public demo.
Everything else is parallel.

---

## Phase 0 — Meta-unblock (YOU, today)

One decision, one action, 5 minutes.

### HF credit options (pick one)

| Option | Cost | Uptime risk | Effort |
|---|---|---|---|
| **HF PRO on ml@synlex.tech** | $9/mo | Low (same provider, same token) | 2 min |
| **Pre-paid HF credits** | $5 min, pay-as-you-go | Low | 2 min |
| **Switch to Together AI** | ~$0.18/1M in | Medium (new provider) | 1h (new SDK config) |
| **Switch to Groq** | ~$0.15/1M in, ~5x faster | Medium | 1h |
| **Self-host Qwen3-8B on EC2** | $0 (current EC2 is t3, probably can't fit) | High | 6h+ |

**Recommend:** HF PRO. Changes nothing else, $9 unblocks a month.
**Second choice:** Together AI. Diversifies from HF for resilience. OpenAI-compatible API so code change is a URL and model name.

### Credential rotation (do while waiting for credit decision)

- [ ] Rotate HF_TOKEN (it's been in shell history + may have leaked)
- [ ] Rotate GitHub PAT (used in push commands)
- [ ] Update Convex env + EC2 env with new tokens

---

## Phase 1 — Ship today (no HF, no decisions)

4–6 hours of focused work. All items independent, safe to parallelize.

### 1.1 — Metadata pre-filter in coreSearch *(1h)*

Extend `convex/serving/search.ts`:
- Use existing `WING_KEYWORDS` in `route.ts` to derive "candidate wings" from query tokens
- When query contains wing-specific keyword (e.g., "Rahul" → team wing, "Zoo Media" → clients wing), bump scores of results in that wing by +0.05
- Combines with existing graph boost (they're complementary — graph boosts per entity match, wing boost per topic category)

**Risk:** negligible. Boost-only; no results removed.

### 1.2 — Cron verification *(1h)*

Write `scripts/verifyCrons.ts`:
- Enumerate all 10 crons from `convex/crons.ts`
- For each, invoke the handler via `npx convex run <path>` programmatically
- Capture: success, error, duration, side-effect counts
- Emit report showing which are broken

Fix anything that breaks. Check Convex dashboard `_scheduled_functions` for real invocation history.

### 1.3 — ACL HTTP E2E test *(2h)*

Existing `run_acl_suite.ts` tests at action level (20/20 pass) but uses `_admin`. Write `scripts/testAccessE2E.ts`:
- For each of 15 NEops × (search, remember, retract) × (in-scope, out-of-scope) combinations
- Hit `/mcp` HTTP endpoint with that neopId
- Verify correct allow/deny code
- Emit coverage matrix

~225 tests. Any deny-leak is a P0 security bug — likely none, but needs verification for client trust.

### 1.4 — Vercel build fix *(30min)*

`frontend/package.json`:
```json
{
  "scripts": {
    "prebuild": "cp -r ../convex/_generated ./src/_convex_generated",
    "build": "vite build"
  }
}
```

Update `frontend/vite.config.ts` alias: `@convex/_generated` → `./src/_convex_generated`.
Remove the pre-built `dist/` workflow. Vercel rebuilds from source on every push.

### 1.5 — MCP rate limiting *(2h)*

Add `rate_limits` table keyed on `(palaceId, neopId)`, store rolling-window timestamp list.
Middleware in `convex/http.ts`:
- 60 requests/minute per (palace, NEop)
- 429 with `Retry-After` header when exceeded
- Whitelist `_admin` for unthrottled access

### 1.6 — Monitoring *(15min setup)*

Free UptimeRobot:
- `https://small-dogfish-433.convex.site/health` — every 5 min
- `http://13.127.254.149:8100/health` — every 5 min
- SMS/email alert on 2 consecutive failures

---

## Phase 2 — After HF unblock *(same day as Phase 0)*

### 2.1 — Resume entity backfill *(30min unattended)*

```bash
CONVEX_URL=... npx tsx scripts/backfillEntities.ts
```

Picks up from 157 → 428 on the `entitiesExtracted=false` flag. Unattended.

### 2.2 — Query expansion *(3h)*

`convex/lib/queryExpander.ts`:
- Take user query, call Llama 4 Scout with: *"Given this query about a NeuralEDGE knowledge base, output 3-5 related search terms as JSON."*
- Cache expansions in a new table `query_expansions` keyed by query hash (most queries repeat — cache hit = 0 LLM cost)
- Merge expansion into embedding input: `"{query} {expansion_terms}"`
- Heuristic: skip expansion if query >5 tokens (already specific)

Add to `coreSearch` before embed step. Fallback to plain query if expansion fails.

**Expected impact:** hard R@5 40% → 65%+, medium 87% → 92%+.

### 2.3 — Re-run all benchmarks, publish report *(30min)*

Run:
```bash
npx tsx benchmarks/run_relevance_retrieval.ts
npx tsx benchmarks/run_palace_retrieval.ts
npx tsx benchmarks/run_acl_suite.ts
python3 benchmarks/run_mteb.py
```

Update `benchmarks/BENCHMARK_REPORT.md` with post-graph + post-expansion numbers. This is what clients see.

### 2.4 — Decide on re-embedding *(2h investigation, up to 4h if yes)*

Current embeddings prepend `[wing/room]`. Could extend to include top-3 extracted entities:
```
[clients/zoo-media] Zoo Media, Akhilesh Sabharwal, ICD NEop
Status
<content>
```

Test on 20 closets, measure quality delta. If meaningful (+5% R@5), re-embed all 428 (free on dev, takes ~20 min with HF credits).

---

## Phase 3 — Production-ready *(week 2, ~15h)*

Requires a decision: go public or stay internal? Public = auth mandatory.

### 3.1 — Convex Auth *(6-8h)* — **DECISION NEEDED**

Options:
- **Convex Auth** (native, $0, Google OAuth or magic links)
- **Clerk** (better UX, free tier, 2-3h less effort on pre-built components)

Recommend Convex Auth. Work:
- Install `@convex-dev/auth`
- Wrap queries/mutations in `auth.requireUser()` (preserve `_admin` API-key bypass)
- Frontend login page + session hook
- Map authenticated user → NEop scope (start with all authenticated users = `_admin`, tighten later)

### 3.2 — Write UI *(2-3h)*

Remember box on dashboard. Mutation already exists (`palace_remember` via MCP). Just UI.

### 3.3 — Quarantine review panel *(3h)*

New page showing closets with `needsReview=true` or in `_quarantine` wing. Actions: promote to real wing, delete, edit category.

### 3.4 — Section granularity fix *(6h)* — **DECISION NEEDED**

Problem: "Complete NEops Roster" contains 15 NEops in one closet. Search for Aria returns the roster.

Options:
- **A. Re-parse source markdown, split at `###`** — clean, requires re-ingestion to staging first
- **B. In-place split of oversized closets** — messy, breaks references
- **C. Virtual sub-closet layer (metadata only)** — no re-ingestion but heavy serving-layer change

Recommend A. ~200 LOC markdown splitter, stage in dev palace, compare metrics, migrate.

---

## Phase 4 — Scale *(week 3+)*

### 4.1 — Raw Claude conversation ingestion

409MB, 2249 conversations, 23K messages. Cost estimate: 23K × (1 extraction + 1 embedding) = ~46K HF calls. If current tier tops out at ~3K calls/month, need ~$30-50 in pre-paid credits or 2 months of PRO.

Infrastructure ready (`parseClaude.ts`, `batchIngest.ts`, `extractEntities.ts`). Pure budget question.

Run to STAGING palace first. Verify quality. Merge to prod if good.

### 4.2 — CI/CD pipeline *(4h)*

`.github/workflows/deploy.yml`:
- On push to main: `npx convex deploy` + `vercel --prod --prebuilt`
- On PR: run benchmarks, comment results
- Secrets: `CONVEX_DEPLOY_KEY`, `VERCEL_TOKEN`

### 4.3 — Temporal data *(6h)*

Parse `<!-- date: 2026-03-15 -->` markers from source markdown. Backfill `createdAt` on existing closets. Enables `searchTemporal` to work meaningfully.

Only useful if source docs have dates. Spot-check first — if <30% have dates, defer.

### 4.4 — Mobile CSS *(4h)*

Add media queries to inline styles. Desktop users are primary, so low priority. Skip unless clients complain.

### 4.5 — FalkorDB backup *(1h)*

EC2 cron: `0 */6 * * * redis-cli --rdb /var/backups/palace-$(date +%Y%m%d%H).rdb`.
Retain 7 days. Upload nightly to S3 (optional).

---

## Timing summary

| Phase | Wall time | Human-hours | Blocker |
|---|---|---|---|
| 0. Meta-unblock | 5 min | 5 min | USER decision |
| 1. Ship today | 1 day | 6h | None |
| 2. HF-unblock | 1 day | 6h | Phase 0 |
| 3. Production | 1 week | 15h | Auth decision |
| 4. Scale | 2-3 weeks | 20h | Budget for 4.1 |

**Fast path to public demo:** Phase 0 → Phase 1 → Phase 2 → 3.1 (auth). ~3 days real time.

---

## Decisions I need from you

1. **HF:** PRO ($9/mo) or switch to Together/Groq? *(affects Phase 0 today)*
2. **Auth provider:** Convex Auth (native) or Clerk (polish)? *(affects Phase 3.1 in week 2)*
3. **Public launch scope:** full client-facing dashboard or team-internal only? *(affects whether Phase 3 is critical path)*
4. **Section split strategy:** re-ingest from source (clean) or in-place split (risky)? *(affects Phase 3.4)*
5. **Claude conversation ingestion budget:** proceed with $30-50 in pre-paid HF, or defer? *(affects Phase 4.1)*

Pick #1 now — everything downstream waits on it. The rest can wait until their phase.
