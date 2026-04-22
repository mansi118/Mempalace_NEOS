# PALACE Runbook

**When something breaks, start here.** Each section is a failure mode, how to recognise it, and what to do. Ordered by frequency + user impact.

---

## §1 Production canary failed — search returns nothing or errors

**Alert:** GitHub issue with label `production-down` auto-opened by `.github/workflows/canary.yml`.

**Triage order** (each takes <1 min):

### 1a. Is Bedrock token expired?

```bash
curl -s -X POST https://modest-camel-322.convex.site/mcp \
  -H "Content-Type: application/json" \
  -d "{\"tool\":\"palace_search\",\"params\":{\"query\":\"test\",\"palaceId\":\"$PALACE_ID\",\"limit\":1},\"neopId\":\"_admin\",\"palaceId\":\"$PALACE_ID\"}"
```

If response contains `"Bearer Token has expired"` → Bedrock token rotated. This is the #1 failure mode.

**Fix:** Issue a new AWS Bedrock bearer token from the AWS console (ap-south-1 region, Bedrock → API keys). Token `X-Amz-Expires` is 43200 seconds = 12 hours.

```bash
# In Convex, replace the expired token:
npx convex env set AWS_BEARER_TOKEN_BEDROCK '<new-token>'
```

**Longer-term fix:** Switch to long-lived credentials — either a permanent IAM access key with `bedrock:InvokeModel` scope (SigV4 sign per request), or swap to OpenAI/Cohere embeddings (permanent API key). Ship either this week; 12h silent-failure loop is unacceptable in production.

### 1b. Is the bridge reachable?

```bash
curl -s http://13.127.254.149:8100/health
```

If no response:
```bash
ssh -i /tmp/mansi-research.pem ubuntu@13.127.254.149 \
  "sudo docker ps && sudo docker logs palace-bridge-1 --tail 30"
```

**Fix:**
```bash
ssh ubuntu@13.127.254.149 "cd /opt/palace && sudo docker compose restart bridge"
```

If the container is crashlooping, rebuild:
```bash
sudo docker compose build bridge && sudo docker compose up -d bridge
```

### 1c. Is Convex deployed?

```bash
curl -s https://modest-camel-322.convex.site/version
```

If 5xx, check Convex dashboard: https://dashboard.convex.dev/t/mansi5/modest-camel-322/logs

**Fix:** Redeploy.
```bash
npx convex deploy -y
```

### 1d. Nothing obviously wrong — query log tells the real story

Open `/#/queries` on the live site and look at the last 10 searches. If they all return `confidence=low` and topScore ≈ 0, something further upstream is broken (Bedrock, query-log mutation, enrichment). If most succeed and the canary query is the outlier, the canary criterion is wrong — update it.

---

## §2 Bedrock token expired (specific case of §1)

**Symptom:** Every search throws `Bedrock Titan embed error 403: Bearer Token has expired`. Graph-only closet lookups still work. Frontend loads fine; search page shows nothing.

**Recognition:** Check token expiry locally:

```bash
python3 -c "
import base64, urllib.parse
raw = '<everything after bedrock-api-key- in AWS_BEARER_TOKEN_BEDROCK>'
decoded = base64.b64decode(raw).decode()
d = urllib.parse.parse_qs(urllib.parse.urlparse('https://' + decoded).query)
print('issued:', d.get('X-Amz-Date'))
print('expires_seconds:', d.get('X-Amz-Expires'))
"
```

**Fix:** rotate per §1a. Also check the canary isn't masked — confirm a *fresh* GitHub Action run fires after you update the env var.

**Permanent fix (do this week):** Replace with long-lived auth:
- Option A — OpenAI embeddings (`text-embedding-3-small`, $0.02/1M tokens, permanent key)
- Option B — Cohere `embed-english-v3` via Bedrock with a permanent IAM key + SigV4 signing
- Option C — Direct Voyage API (`voyage-3-lite`, asymmetric, 512d)

---

## §3 Bridge down, FalkorDB alive

**Symptom:** `curl http://13.127.254.149:8100/health` hangs or 5xx. Entities page shows empty. Search degrades to vector-only (this is the intended graceful fallback — `coreSearch` swallows bridge errors with a 3s timeout).

**Root causes seen so far:**
- Bridge container OOM-killed after large ingestion batch
- Dockerfile rebuilt without new file copied (graph_writer.py not in image)
- Config env missing after container recreate

**Fix:**
```bash
ssh ubuntu@13.127.254.149
sudo docker ps                                      # is bridge running?
sudo docker logs palace-bridge-1 --tail 50          # what did it say?
cd /opt/palace && sudo docker compose restart bridge
```

If the host is under memory pressure:
```bash
free -h
# If tight: sudo docker system prune -f
```

**Verify:**
```bash
curl http://13.127.254.149:8100/health
curl http://13.127.254.149:8100/graph/stats/neuraledge \
  -H "X-Palace-Key: $PALACE_BRIDGE_API_KEY"
```

---

## §4 FalkorDB down

**Symptom:** Bridge `/health` responds but reports `"falkordb":"unreachable"`. Every `/graph/*` endpoint errors.

**Fix:**
```bash
ssh ubuntu@13.127.254.149
sudo docker ps | grep falkordb                      # still there?
sudo docker exec palace-falkordb-1 redis-cli ping   # responds PONG?
sudo docker compose restart falkordb
```

**Data recovery:** FalkorDB persists to `/data` via a named Docker volume (`palace_falkordb_data`). If it survived, a restart restores state. If the volume is gone, the graph is gone — re-run entity backfill:
```bash
CONVEX_URL=https://small-dogfish-433.convex.cloud npx tsx scripts/backfillEntities.ts
```

**Prevention (gap):** no automated RDB backups. Add:
```bash
0 */6 * * * docker exec palace-falkordb-1 redis-cli --rdb /data/bg-$(date +\%s).rdb
```

---

## §5 Groq rate limit during backfill

**Symptom:** `scripts/backfillEntities.ts` hits repeated `429: Rate limit reached for model llama-…`. Only some closets extract; error count grows.

**Root cause:** Free tier is 30 RPM on Llama 3.3 70B *and* ~12K TPM on the same model. At ~3K tokens per extraction, TPM binds before RPM.

**Fix:** The backfill script throttles at 2.2s between calls (27 RPM) and uses `llama-3.1-8b-instant` (30K TPM, 5× headroom). If you still hit 429:
1. Bump `REQUEST_INTERVAL_MS` in `scripts/backfillEntities.ts` to 7000 (~8 RPM).
2. Wait 5 min for the rolling-minute window to clear.
3. Rerun. The script skips already-done closets automatically.

Don't use the 70B model for bulk extraction — it will always hit TPM first.

---

## §6 Retrieval quality below budget (R@5 regression)

**Symptom:** `run_relevance_retrieval.ts` exits with `BUDGET FAIL — retrieval quality below threshold`. Medium R@5 < 85% or hard R@5 < 60% or unanswerable < 100%.

**Triage:**
1. Diff the recent commits touching `convex/serving/search.ts`, `convex/lib/qwen.ts`, `convex/lib/graphClient.ts`.
2. Run locally: `npx tsx benchmarks/run_relevance_retrieval.ts`. Look at which specific queries now fail.
3. If only off-domain drift (unanswerable regressed), check `DEFAULT_SIMILARITY_FLOOR` wasn't lowered.
4. If hard R@5 tanked, check graph boost constants (`GRAPH_BOOST_PER_ENTITY`, `GRAPH_BOOST_MAX`).

**Rollback:** `git revert <offending-commit>` → redeploy.

---

## §7 Convex mutation regression

**Symptom:** `run_mutation_smoke.ts` fails on a step that previously passed.

**Common cause:** a schema/migration change invalidated the shape of existing data. Check the Convex dashboard logs for `ArgumentValidationError` or `ImmutableFieldError`.

**Fix:** either roll back the schema change or patch the data. For schema shape changes, Convex deploys will refuse to start until conflicts resolve — migrate first (via internalMutation), then change the schema.

---

## §8 ACL regression

**Symptom:** `run_acl_suite.ts` returns less than 100%. This is a **P0 security bug** — block the deploy immediately.

**Triage:** The suite reports which (neopId, tool, action) combination regressed. Check:
1. `convex/access/enforce.ts` — the permission-resolve logic.
2. `convex/lib/access_matrix.yaml` — the source-of-truth policy.
3. The most recent change to either.

**Never hotfix ACL by loosening policy.** Roll forward with a proper fix; block releases that can't pass 20/20.

---

## §9 Vercel deploy broken

**Symptom:** Frontend URL returns 500. `vercel inspect` shows build failures.

**Common causes:**
- `@convex/_generated/api` path resolution broken (vite.config.ts alias). Fix: pre-build the frontend locally and deploy the `dist/` directly (`vercel deploy frontend/dist --prod`).
- Missing env var for `VITE_CONVEX_URL`. Fix: set in Vercel project settings.

---

## §10 GitHub push rejected

**Symptom:** `git push` returns `Authentication failed`.

**Cause:** The embedded PAT in `origin` remote URL was revoked or expired.

**Fix:**
```bash
git remote set-url origin https://ghp_NEW_TOKEN@github.com/mansi118/Mempalace_NEOS.git
git push origin main
```

Store the token in `.git-credentials` for future sessions.

---

## Appendix — Health-check one-liner

Paste this to see every layer's status at once:

```bash
echo "--- Convex prod ---"
curl -sf https://modest-camel-322.convex.site/version || echo "DOWN"

echo "--- Convex dev ---"
curl -sf https://small-dogfish-433.convex.site/version || echo "DOWN"

echo "--- Bridge health ---"
curl -sf http://13.127.254.149:8100/health || echo "DOWN"

echo "--- Bridge stats ---"
curl -sf "http://13.127.254.149:8100/graph/stats/neuraledge" \
  -H "X-Palace-Key: $PALACE_BRIDGE_API_KEY" || echo "DOWN"

echo "--- Frontend ---"
curl -sI https://dist-dbqy631f8-mansi5.vercel.app/ | head -1
```

Green everywhere → system is healthy. Any red → start at §1.
