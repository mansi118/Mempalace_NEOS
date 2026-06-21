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
    deniedAtLayer: v.optional(v.string()),   // #12: layer tag when status=denied
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
        denied_at_layer: args.deniedAtLayer as Doc<"audit_events">["denied_at_layer"],
      });
    } catch (e) {
      // Swallow audit failures — they cannot break the calling op.
      console.error("audit write failed", e);
    }
  },
});

// #12 — the unified-sink receiver for denials that happen OUTSIDE the Convex dispatch:
// the edge resolver (denied_at_layer=edge) and the NEOS broker (=broker) push their refusals
// here so all enforcement layers land in ONE audit_events sink (which nc-audit/S0.5 exports to
// ClickHouse for the Day-90 measurement). convex_sot denials are tagged inline by the dispatch.
export const recordExternalDenial = mutation({
  args: {
    palaceId: v.id("palaces"),
    deniedAtLayer: v.union(v.literal("edge"), v.literal("broker"), v.literal("falkordb")),
    neopId: v.optional(v.string()),   // declared/claimed seat or mxid; "unknown" if none
    op: v.optional(v.string()),
    reason: v.string(),
    extra: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const who = args.neopId ?? "unknown";
    await ctx.db.insert("audit_events", {
      palaceId: args.palaceId,
      op: (args.op ?? "search") as Doc<"audit_events">["op"],
      neopId: who,
      effectiveNeopId: who,
      status: "denied",
      latencyMs: 0,
      timestamp: Date.now(),
      denied_at_layer: args.deniedAtLayer,
      extra: args.extra ?? JSON.stringify({ reason: args.reason }),
    });
    return { status: "recorded" as const };
  },
});
