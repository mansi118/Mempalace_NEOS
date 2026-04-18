// Pruner — closet decay engine + expired drawer cleanup.
//
// Closet decay: marks closets as decayed when their TTL expires.
//   Decayed closets are excluded from default search but still queryable.
//
// Drawer pruning: deletes invalidated drawers after a 30-day grace period.
//   Preserves supersession chains.

import { internalAction, internalMutation, internalQuery } from "../_generated/server.js";
import { internal } from "../_generated/api.js";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel.js";

const BATCH_SIZE = 100;
const DRAWER_GRACE_DAYS = 30;

// ─── Closet decay (every 6h) ───────────────────────────────────

export const decayExpiredClosets = internalAction({
  args: {},
  handler: async (ctx) => {
    const palaceIds: Id<"palaces">[] = await ctx.runQuery(
      internal.maintenance.curator.listReadyPalaces,
      {},
    );

    let totalDecayed = 0;

    for (const palaceId of palaceIds) {
      const expired: string[] = await ctx.runQuery(
        internal.maintenance.pruner.findExpiredClosets,
        { palaceId, limit: BATCH_SIZE },
      );

      for (const closetId of expired) {
        try {
          await ctx.runMutation(internal.maintenance.pruner.markDecayed, {
            closetId: closetId as Id<"closets">,
          });
          totalDecayed++;
        } catch (e) {
          console.error(`[pruner] decay failed for ${closetId}:`, e);
        }
      }
    }

    if (totalDecayed > 0) {
      console.log(`[pruner] decayed ${totalDecayed} expired closets`);
    }
  },
});

export const findExpiredClosets = internalQuery({
  args: {
    palaceId: v.id("palaces"),
    limit: v.number(),
  },
  handler: async (ctx, { palaceId, limit }) => {
    const now = Date.now();
    const closets = await ctx.db
      .query("closets")
      .withIndex("by_palace_decayed", (q) =>
        q.eq("palaceId", palaceId).eq("decayed", false),
      )
      .take(limit * 3); // overfetch since most won't be expired

    return closets
      .filter((c) => {
        if (!c.ttlSeconds) return false; // no TTL = never expires
        if (c.retracted) return false;
        if (c.legalHold) return false;
        const expiresAt = c.createdAt + c.ttlSeconds * 1000;
        return expiresAt < now;
      })
      .slice(0, limit)
      .map((c) => c._id as string);
  },
});

export const markDecayed = internalMutation({
  args: { closetId: v.id("closets") },
  handler: async (ctx, { closetId }) => {
    const closet = await ctx.db.get(closetId);
    if (!closet || closet.decayed) return;
    await ctx.db.patch(closetId, { decayed: true, updatedAt: Date.now() });
  },
});

// ─── Drawer pruning (daily) ────────────────────────────────────

export const pruneExpiredDrawers = internalAction({
  args: {},
  handler: async (ctx) => {
    const palaceIds: Id<"palaces">[] = await ctx.runQuery(
      internal.maintenance.curator.listReadyPalaces,
      {},
    );

    let totalPruned = 0;

    for (const palaceId of palaceIds) {
      const pruneable: string[] = await ctx.runQuery(
        internal.maintenance.pruner.findPruneableDrawers,
        { palaceId, limit: BATCH_SIZE },
      );

      for (const drawerId of pruneable) {
        try {
          await ctx.runMutation(internal.maintenance.pruner.deleteDrawer, {
            drawerId: drawerId as Id<"drawers">,
          });
          totalPruned++;
        } catch (e) {
          console.error(`[pruner] drawer prune failed for ${drawerId}:`, e);
        }
      }
    }

    if (totalPruned > 0) {
      console.log(`[pruner] pruned ${totalPruned} expired drawers`);
    }
  },
});

export const findPruneableDrawers = internalQuery({
  args: {
    palaceId: v.id("palaces"),
    limit: v.number(),
  },
  handler: async (ctx, { palaceId, limit }) => {
    const cutoff = Date.now() - DRAWER_GRACE_DAYS * 24 * 60 * 60 * 1000;

    // Query drawers that have been invalidated (validUntil is set).
    // The by_palace_valid index has validUntil in the key — we need drawers
    // where validUntil IS set (not undefined). Query all and filter.
    const drawers = await ctx.db
      .query("drawers")
      .withIndex("by_palace_valid", (q) => q.eq("palaceId", palaceId))
      .take(limit * 5);

    return drawers
      .filter((d) => {
        if (d.validUntil === undefined) return false; // still valid
        if (d.validUntil > cutoff) return false; // grace period not over
        return true;
      })
      .slice(0, limit)
      .map((d) => d._id as string);
  },
});

export const deleteDrawer = internalMutation({
  args: { drawerId: v.id("drawers") },
  handler: async (ctx, { drawerId }) => {
    const drawer = await ctx.db.get(drawerId);
    if (!drawer) return;

    // Check parent closet for legal hold.
    const closet = await ctx.db.get(drawer.closetId);
    if (closet?.legalHold) return; // skip drawers under legal hold

    await ctx.db.delete(drawerId);
  },
});
