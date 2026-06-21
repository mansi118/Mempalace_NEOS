// Permission + audit read queries.

import { query, internalQuery } from "../_generated/server.js";
import { v } from "convex/values";
import { resolvePermissions, type ResolvedPermissions } from "./enforce.js";

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

// ─── Permission resolution (internal, used by HTTP dispatch) ────

export const resolvePermsQuery = internalQuery({
  args: { palaceId: v.id("palaces"), neopId: v.string() },
  handler: async (ctx, { palaceId, neopId }): Promise<ResolvedPermissions> => {
    return resolvePermissions(ctx, palaceId, neopId);
  },
});

// ─── Audit queries ──────────────────────────────────────────────

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

// #12 — Day-90 measurement instrument. Counts DENIED ops per enforcement layer over a window,
// so "isolation holds" is an audited fact: each layer's catch-rate is visible, and a layer
// dropping to zero while attempts exist (or any untagged denial) is investigable. Denials are
// the defense WORKING (a breach would be a cross-seat *success*, which the ACL prevents); this
// surfaces the catches. Uses by_palace_status so it scans only denial rows (exceptional, bounded);
// `capped` is honest about the take limit rather than silently truncating.
export const denialsByLayer = query({
  args: { palaceId: v.id("palaces"), sinceMs: v.optional(v.number()) },
  handler: async (ctx, { palaceId, sinceMs }) => {
    const CAP = 20000;
    const denials = await ctx.db
      .query("audit_events")
      .withIndex("by_palace_status", (q) =>
        q.eq("palaceId", palaceId).eq("status", "denied"),
      )
      .take(CAP);
    const since = sinceMs ?? 0;
    const byLayer: Record<string, number> = {
      edge: 0, broker: 0, convex_sot: 0, falkordb: 0, untagged: 0,
    };
    let total = 0;
    for (const d of denials) {
      if (d.timestamp < since) continue;
      total++;
      const layer = d.denied_at_layer ?? "untagged";
      byLayer[layer] = (byLayer[layer] ?? 0) + 1;
    }
    return { byLayer, total, windowFrom: since, capped: denials.length >= CAP };
  },
});
