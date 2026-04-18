// Palace maintenance cron schedule.
//
// All crons run for ALL ready palaces (multi-palace support).
// Heavy work is done in internal actions (10-min limit),
// which call mutations in bounded batches.

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

// ─── Daily ──────────────────────────────────────────────────────

// Rebuild L0 (identity briefing) + L1 (wing index) for all palaces.
crons.interval("rebuild-l0-l1", { hours: 24 }, internal.maintenance.curator.rebuildAllL0L1);

// Prune drawers invalidated more than 30 days ago.
crons.interval("prune-drawers", { hours: 24 }, internal.maintenance.pruner.pruneExpiredDrawers);

// ─── Every 6 hours ──────────────────────────────────────────────

// Decay closets whose TTL has expired.
crons.interval("decay-closets", { hours: 6 }, internal.maintenance.pruner.decayExpiredClosets);

// Retry failed embeddings (Gemini API errors, rate limits).
crons.interval("backfill-embeddings", { hours: 6 }, internal.maintenance.backfill.backfillFailedEmbeddings);

// Retry failed graphiti ingestions (bridge down, timeouts).
crons.interval("backfill-graphiti", { hours: 6 }, internal.maintenance.backfill.backfillFailedGraphiti);

// ─── Weekly ─────────────────────────────────────────────────────

// Remove tunnels pointing to deleted rooms.
crons.interval("sweep-tunnels", { hours: 168 }, internal.maintenance.tunnels.sweepDanglingTunnels);

// Decay tunnel strengths (0.05/week) and prune weak old tunnels.
crons.interval("decay-tunnel-strength", { hours: 168 }, internal.maintenance.tunnels.decayTunnelStrengths);

// Find drawers in the same room with conflicting content.
crons.interval("detect-contradictions", { hours: 168 }, internal.maintenance.dedup.detectContradictions);

// Find rooms with similar names (merge candidates).
crons.interval("detect-duplicate-rooms", { hours: 168 }, internal.maintenance.dedup.detectDuplicateRooms);

// Report stale rooms (no activity in 30+ days).
crons.interval("detect-stale-rooms", { hours: 168 }, internal.maintenance.curator.detectStaleRooms);

export default crons;
