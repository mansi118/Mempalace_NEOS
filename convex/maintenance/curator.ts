// Curator — L0/L1 rebuild + stale room detection.
//
// Runs as scheduled cron (daily). Iterates all ready palaces.

import { internalAction, internalMutation, internalQuery } from "../_generated/server.js";
import { internal } from "../_generated/api.js";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel.js";

// ─── Multi-palace wrapper ───────────────────────────────────────

export const listReadyPalaces = internalQuery({
  args: {},
  handler: async (ctx) => {
    const palaces = await ctx.db
      .query("palaces")
      .withIndex("by_status", (q) => q.eq("status", "ready"))
      .collect();
    return palaces.map((p) => p._id);
  },
});

// ─── L0/L1 rebuild (daily) ──────────────────────────────────────

export const rebuildAllL0L1 = internalAction({
  args: {},
  handler: async (ctx) => {
    const palaceIds: Id<"palaces">[] = await ctx.runQuery(
      internal.maintenance.curator.listReadyPalaces,
      {},
    );

    for (const palaceId of palaceIds) {
      try {
        await ctx.runMutation(internal.serving.l0l1.generateL0, { palaceId });
        await ctx.runMutation(internal.serving.l0l1.generateL1, { palaceId });
      } catch (e) {
        console.error(`L0/L1 rebuild failed for ${palaceId}:`, e);
      }
    }

    console.log(`[curator] L0/L1 rebuilt for ${palaceIds.length} palaces`);
  },
});

// ─── Stale room detection (weekly) ──────────────────────────────

const STALE_DAYS = 30;

export const detectStaleRooms = internalAction({
  args: {},
  handler: async (ctx) => {
    const palaceIds: Id<"palaces">[] = await ctx.runQuery(
      internal.maintenance.curator.listReadyPalaces,
      {},
    );

    let totalStale = 0;

    for (const palaceId of palaceIds) {
      const staleRooms: Array<{ name: string; wing: string; lastUpdated: number }> =
        await ctx.runQuery(internal.maintenance.curator.findStaleRooms, {
          palaceId,
          staleDays: STALE_DAYS,
        });
      totalStale += staleRooms.length;

      if (staleRooms.length > 0) {
        console.log(
          `[curator] ${staleRooms.length} stale rooms in palace ${palaceId}:`,
          staleRooms.map((r) => `${r.wing}/${r.name}`).join(", "),
        );
      }
    }

    console.log(`[curator] ${totalStale} total stale rooms across all palaces`);
  },
});

export const findStaleRooms = internalQuery({
  args: {
    palaceId: v.id("palaces"),
    staleDays: v.number(),
  },
  handler: async (ctx, { palaceId, staleDays }) => {
    const cutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;

    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
      .collect();

    const stale = [];
    for (const room of rooms) {
      if (room.lastUpdated < cutoff && room.closetCount > 0) {
        const wing = await ctx.db.get(room.wingId);
        stale.push({
          name: room.name,
          wing: wing?.name ?? "unknown",
          lastUpdated: room.lastUpdated,
        });
      }
    }

    return stale;
  },
});
