# PALACE Operational Runbook

## 1. Add a new client palace

```bash
# One command via Convex action:
npx convex run palace/provision:provisionPalace \
  '{"clientId": "zoo_media", "name": "Zoo Media"}'

# This creates: palace + 12 wings + halls + 47 rooms + _admin permissions
# + registers with Graphiti bridge + generates L0/L1 + marks "ready"
```

Or via MCP:
```
palace_create_wing → palace_create_room → palace_remember (to seed content)
```

## 2. Ingest data from Claude.ai

```bash
# 1. Export from Claude.ai → Settings → Export → Download ZIP
# 2. Unzip to scripts/data/

# 3. Dry run (free — reviews routing, no LLM calls):
npx tsx scripts/batchIngest.ts scripts/data/conversations.json --dry-run

# 4. Ingest first 50 (costs ~$0.25 for Gemini extraction):
npx tsx scripts/batchIngest.ts scripts/data/conversations.json --limit=50

# 5. Review quality:
#    - Check Convex dashboard for closets across wings
#    - Check _quarantine wing for misrouted items
#    - Run palace_search queries to verify relevance

# 6. Full ingestion:
npx tsx scripts/batchIngest.ts scripts/data/conversations.json

# 7. If it crashes, just re-run — progress file handles resume:
#    scripts/data/ingest_progress.json tracks processed exchanges
```

## 3. Handle quarantined items

Quarantined items are closets in `_quarantine/unclassified` with `needsReview=true`.

```bash
# List quarantined items:
npx convex run palace/queries:listQuarantined '{"palaceId": "<id>"}'

# For each item, either:
# a. Move to correct wing/room (create new closet, retract the quarantined one)
# b. Retract if it's noise
```

Via MCP: `palace_search` with `wingFilter: "_quarantine"` shows all quarantined content.

## 4. Debug search quality

**Symptom:** "palace_recall returns irrelevant results"

1. Check embedding status:
   ```bash
   npx convex run serving/monitoring:pipelineHealth '{"palaceId": "<id>"}'
   ```
   If `embedding.failed > 0`, embeddings are missing. Run backfill:
   ```bash
   npx convex run ingestion/embed:backfillEmbeddings \
     '{"palaceId": "<id>", "includeRetries": true}'
   ```

2. Check search latency:
   ```bash
   npx convex run serving/monitoring:searchLatencyStats '{"palaceId": "<id>"}'
   ```
   p95 > 3s → possible Gemini API slowness. Check billing status.

3. Check closet quality: use `palace_get_room` to see what's in the room. If content is garbled, the Gemini extraction may need prompt tuning.

4. Check similarity floor: default 0.5. If too high, relevant results are dropped. Try `palace_search` with `similarityFloor: 0.3` to see what's being filtered.

## 5. Recover from FalkorDB downtime

The palace continues working without FalkorDB — vector search still runs. Graph features (entity traversal) are degraded.

1. Check bridge health:
   ```bash
   curl http://<ec2-ip>:8100/health
   ```

2. If bridge is down:
   ```bash
   # SSH to EC2
   docker compose -f /opt/palace/docker-compose.yml logs bridge
   docker compose -f /opt/palace/docker-compose.yml restart bridge
   ```

3. After recovery, re-process failed graph ingestions:
   ```bash
   npx convex run maintenance/backfill:backfillFailedGraphiti
   ```
   Or wait for the 6-hour cron to pick it up.

## 6. Run maintenance manually

```bash
# Rebuild L0/L1 (identity + wing index):
npx convex run maintenance/curator:rebuildAllL0L1

# Decay expired closets:
npx convex run maintenance/pruner:decayExpiredClosets

# Prune old drawers:
npx convex run maintenance/pruner:pruneExpiredDrawers

# Sweep dangling tunnels:
npx convex run maintenance/tunnels:sweepDanglingTunnels

# Detect contradictions:
npx convex run maintenance/dedup:detectContradictions

# Retry failed embeddings:
npx convex run maintenance/backfill:backfillFailedEmbeddings
```

## 7. Update access matrix

```bash
# Edit config/access_matrix.yaml
# Then re-run the seeder:
npx tsx scripts/seedAccess.ts

# For a specific NEop change:
npx convex run palace/mutations:upsertNeopPermissions '{
  "palaceId": "<id>",
  "neopId": "aria",
  "runtimeOps": ["recall", "remember", "promote"],
  "contentAccess": "{\"platform\": {\"read\": \"*\", \"write\": []}}"
}'
```

## 8. Monitor palace health

```bash
# Search latency (last 24h):
npx convex run serving/monitoring:searchLatencyStats '{"palaceId": "<id>"}'

# Error rate:
npx convex run serving/monitoring:errorRate '{"palaceId": "<id>"}'

# Pipeline health (embedding + graphiti status):
npx convex run serving/monitoring:pipelineHealth '{"palaceId": "<id>"}'

# Ingestion activity:
npx convex run serving/monitoring:ingestionActivity '{"palaceId": "<id>"}'
```

## 9. Emergency: cross-tenant data leak suspected

1. **Immediately** check audit logs for the suspected NEop:
   ```bash
   npx convex run access/queries:auditEventsForNeop \
     '{"palaceId": "<id>", "neopId": "<neop>", "limit": 100}'
   ```

2. Check if scope binding is correct:
   ```bash
   npx convex run access/queries:getNeopPermissions \
     '{"palaceId": "<id>", "neopId": "<neop>"}'
   ```

3. If scope is missing, add it immediately:
   ```bash
   npx convex run palace/mutations:upsertNeopPermissions '{
     "palaceId": "<id>",
     "neopId": "<neop>",
     "scopeWing": "clients",
     "scopeRoom": "zoo-media",
     ...
   }'
   ```

4. Review all recent audit events with status="denied" to see if enforcement caught anything.

## 10. Costs

| Component | Typical monthly | What drives it |
|---|---|---|
| Convex | $0-25 | Free tier for dev, Pro at scale |
| Gemini embeddings | ~$0.10 | Volume of new closets |
| Gemini extraction | ~$0.50 | Volume of ingested exchanges |
| FalkorDB (EC2) | $0 | Self-hosted on existing instance |
| Total | ~$1-26 | |
