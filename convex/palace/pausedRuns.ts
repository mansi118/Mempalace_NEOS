// Paused-run accessors — durable AwaitingApproval snapshots, ADDRESSED by (palaceId, neopId, runId).
//
// The runtime (NEOS core.py) owns the snapshot shape (to_state); the server is a BLIND store, exactly
// like twins — no validation of `state`, latest-wins upsert by runId. The Decision Queue surfaces
// pending pauses (by_palace_status); resume loads by runId and reconstructs the Pi-agent. Seat
// isolation is enforced upstream: the /mcp handler overwrites neopId server-side and gates
// get→recall / save→remember, so a caller can only reach its OWN paused runs (same discipline as twins).

import { query, mutation } from "../_generated/server.js";
import { v } from "convex/values";

// palace_get_paused_run → { state: <object> | null, status?, updatedAt? }
export const getPausedRun = query({
  args: { palaceId: v.id("palaces"), neopId: v.string(), runId: v.string() },
  handler: async (ctx, { palaceId, neopId, runId }) => {
    const row = await ctx.db
      .query("paused_runs")
      .withIndex("by_palace_neop_run", (q) =>
        q.eq("palaceId", palaceId).eq("neopId", neopId).eq("runId", runId),
      )
      .first();
    if (!row) return { state: null };
    return { state: row.state, status: row.status, updatedAt: row.updatedAt };
  },
});

// palace_save_paused_run → { status, runId, upsert }. Blind upsert by (palaceId, neopId, runId).
export const putPausedRun = mutation({
  args: {
    palaceId: v.id("palaces"),
    neopId: v.string(),
    runId: v.string(),
    state: v.any(),
    status: v.optional(v.string()),
  },
  handler: async (ctx, { palaceId, neopId, runId, state, status }) => {
    const existing = await ctx.db
      .query("paused_runs")
      .withIndex("by_palace_neop_run", (q) =>
        q.eq("palaceId", palaceId).eq("neopId", neopId).eq("runId", runId),
      )
      .first();
    const now = Date.now();
    const st = status ?? "pending";
    if (existing) {
      await ctx.db.patch(existing._id, { state, status: st, updatedAt: now });
      return { status: "ok", runId, upsert: "update" };
    }
    await ctx.db.insert("paused_runs", {
      palaceId,
      neopId,
      runId,
      state,
      status: st,
      updatedAt: now,
    });
    return { status: "ok", runId, upsert: "insert" };
  },
});
