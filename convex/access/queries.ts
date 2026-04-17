// Permission + audit read queries.

import { query } from "../_generated/server.js";
import { v } from "convex/values";

export const getNeopPermissions = query({
  args: { palaceId: v.id("palaces"), neopId: v.string() },
  handler: async (ctx, { palaceId, neopId }) => {
    return await ctx.db
      .query("neop_permissions")
      .withIndex("by_palace_neop", (q) =>
        q.eq("palaceId", palaceId).eq("neopId", neopId),
      )
      .first();
  },
});

export const listNeops = query({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    const perms = await ctx.db
      .query("neop_permissions")
      .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
      .collect();
    // Don't return contentAccess JSON here — that's per-NEop detail.
    return perms.map((p) => ({
      neopId: p.neopId,
      parentNeopId: p.parentNeopId,
      runtimeOps: p.runtimeOps,
      scopeWing: p.scopeWing,
      scopeRoom: p.scopeRoom,
    }));
  },
});

export const recentAuditEvents = query({
  args: {
    palaceId: v.id("palaces"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { palaceId, limit }) => {
    return await ctx.db
      .query("audit_events")
      .withIndex("by_palace_time", (q) => q.eq("palaceId", palaceId))
      .order("desc")
      .take(limit ?? 50);
  },
});

export const auditEventsForNeop = query({
  args: {
    palaceId: v.id("palaces"),
    neopId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { palaceId, neopId, limit }) => {
    return await ctx.db
      .query("audit_events")
      .withIndex("by_palace_neop", (q) =>
        q.eq("palaceId", palaceId).eq("neopId", neopId),
      )
      .order("desc")
      .take(limit ?? 50);
  },
});
