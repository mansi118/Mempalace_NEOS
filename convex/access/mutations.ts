// Audit + permission mutations.
// Audit writes are best-effort and never throw — auditing must not break ops.

import { mutation } from "../_generated/server.js";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";

export const logAuditEvent = mutation({
  args: {
    palaceId: v.id("palaces"),
    op: v.string(),
    neopId: v.string(),
    effectiveNeopId: v.string(),
    status: v.string(),
    latencyMs: v.number(),
    wing: v.optional(v.string()),
    room: v.optional(v.string()),
    category: v.optional(v.string()),
    itemId: v.optional(v.string()),
    resultCount: v.optional(v.number()),
    queryHash: v.optional(v.string()),
    extra: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      await ctx.db.insert("audit_events", {
        palaceId: args.palaceId,
        op: args.op as Doc<"audit_events">["op"],
        neopId: args.neopId,
        effectiveNeopId: args.effectiveNeopId,
        status: args.status as Doc<"audit_events">["status"],
        latencyMs: args.latencyMs,
        timestamp: Date.now(),
        wing: args.wing,
        room: args.room,
        category: args.category,
        itemId: args.itemId,
        resultCount: args.resultCount,
        queryHash: args.queryHash,
        extra: args.extra,
      });
    } catch (e) {
      // Swallow audit failures — they cannot break the calling op.
      console.error("audit write failed", e);
    }
  },
});
