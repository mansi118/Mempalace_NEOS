// Run-event accessors — the INTERIM shadow-prediction store for the fidelity clock (Track 3), ADDRESSED
// by (palaceId, neopId). The runtime (NEOS core.py) owns the `event` shape (predicted/actual/class); the
// server is a BLIND store, exactly like twins / paused_runs — no validation, append on write.
//
// INTERIM BY DESIGN: this exists so the fidelity clock can warm BEFORE the comms tier lands. The durable
// event corpus MOVES to ClickHouse when enable_comms_tier applies (Track 2) — do NOT grow features on this
// table; it is a stopgap the runner's load_events reads until the bus/columnar sink exists. Bounded on
// write (per-seat cap) so Convex never becomes the event firehose (that is exactly ClickHouse's job); the
// read is bounded too. Seat isolation is enforced upstream: the /mcp handler overwrites neopId server-side
// and gates get→recall / put→remember, so a caller can only reach its OWN events (same discipline as twins).

import { query, mutation } from "../_generated/server.js";
import { v } from "convex/values";

// Per-(palaceId, neopId) retention bound. Interim only — ClickHouse holds the full corpus post-Track-2.
const RUN_EVENT_CAP = 1000;
const READ_DEFAULT = 200;

// palace_get_run_events → { events: [<event>...], count }. Newest-first, bounded, optional `kind` filter.
// Keyed by the server-derived (palaceId, neopId): a caller reads only its OWN events.
export const getRunEvents = query({
  args: {
    palaceId: v.id("palaces"),
    neopId: v.string(),
    kind: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { palaceId, neopId, kind, limit }) => {
    const take = Math.min(Math.max(limit ?? READ_DEFAULT, 1), RUN_EVENT_CAP);
    const rows = await ctx.db
      .query("run_events")
      .withIndex("by_palace_neop_ts", (q) => q.eq("palaceId", palaceId).eq("neopId", neopId))
      .order("desc")
      .take(take);
    const events = rows.filter((r) => !kind || r.kind === kind).map((r) => r.event);
    return { events, count: events.length };
  },
});

// palace_put_run_event → { status, upsert:"insert", trimmed }. Append-only insert keyed by the
// server-derived (palaceId, neopId). Bounded: after insert, trim rows beyond RUN_EVENT_CAP for this seat
// (oldest first) so the table cannot grow without limit — the firehose is ClickHouse's job, not Convex's.
export const putRunEvent = mutation({
  args: {
    palaceId: v.id("palaces"),
    neopId: v.string(),
    kind: v.string(),
    event: v.any(),
    runId: v.optional(v.string()),
    ts: v.optional(v.number()),
  },
  handler: async (ctx, { palaceId, neopId, kind, event, runId, ts }) => {
    await ctx.db.insert("run_events", {
      palaceId,
      neopId,
      runId,
      kind,
      event,
      ts: ts ?? Date.now(),
    });
    // Interim bound: keep only the most-recent RUN_EVENT_CAP for this seat.
    const rows = await ctx.db
      .query("run_events")
      .withIndex("by_palace_neop_ts", (q) => q.eq("palaceId", palaceId).eq("neopId", neopId))
      .order("desc")
      .collect();
    let trimmed = 0;
    for (const row of rows.slice(RUN_EVENT_CAP)) {
      await ctx.db.delete(row._id);
      trimmed++;
    }
    return { status: "ok", upsert: "insert", trimmed };
  },
});
