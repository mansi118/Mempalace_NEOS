// Tunnel maintenance — dangling sweep + strength decay.
//
// Dangling sweep: removes tunnels where fromRoom or toRoom no longer exists.
// Strength decay: tunnels lose 0.05 strength per week. Below 0.1 after 90 days → pruned.

import { internalAction, internalMutation, internalQuery } from "../_generated/server.js";
import { internal } from "../_generated/api.js";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel.js";

const STRENGTH_DECAY_PER_WEEK = 0.05;
const MIN_STRENGTH = 0.1;
const MIN_AGE_FOR_PRUNE_DAYS = 90;

// ─── Dangling tunnel sweep (weekly) ─────────────────────────────

export const sweepDanglingTunnels = internalAction({
  args: {},
  handler: async (ctx) => {
    const palaceIds: Id<"palaces">[] = await ctx.runQuery(
      internal.maintenance.curator.listReadyPalaces,
      {},
    );

    let totalSwept = 0;

    for (const palaceId of palaceIds) {
      const dangling: string[] = await ctx.runQuery(
        internal.maintenance.tunnels.findDanglingTunnels,
        { palaceId },
      );

      for (const tunnelId of dangling) {
        try {
          await ctx.runMutation(internal.maintenance.tunnels.deleteTunnel, {
            tunnelId: tunnelId as Id<"tunnels">,
          });
          totalSwept++;
        } catch (e) {
          console.error(`[tunnels] sweep failed for ${tunnelId}:`, e);
        }
      }
    }

    if (totalSwept > 0) {
      console.log(`[tunnels] swept ${totalSwept} dangling tunnels`);
    }
  },
});

export const findDanglingTunnels = internalQuery({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    const tunnels = await ctx.db
      .query("tunnels")
      .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
      .collect();

    const dangling: string[] = [];

    for (const t of tunnels) {
      const from = await ctx.db.get(t.fromRoomId);
      const to = await ctx.db.get(t.toRoomId);
      if (!from || !to) {
        dangling.push(t._id as string);
      }
    }

    return dangling;
  },
});

export const deleteTunnel = internalMutation({
  args: { tunnelId: v.id("tunnels") },
  handler: async (ctx, { tunnelId }) => {
    await ctx.db.delete(tunnelId);
  },
});

// ─── Strength decay + prune (weekly) ────────────────────────────

export const decayTunnelStrengths = internalAction({
  args: {},
  handler: async (ctx) => {
    const palaceIds: Id<"palaces">[] = await ctx.runQuery(
      internal.maintenance.curator.listReadyPalaces,
      {},
    );

    let decayed = 0;
    let pruned = 0;

    for (const palaceId of palaceIds) {
      const tunnelUpdates: Array<{
        id: string;
        action: "decay" | "prune";
        newStrength: number;
      }> = await ctx.runQuery(
        internal.maintenance.tunnels.computeStrengthUpdates,
        { palaceId },
      );

      for (const update of tunnelUpdates) {
        try {
          if (update.action === "prune") {
            await ctx.runMutation(internal.maintenance.tunnels.deleteTunnel, {
              tunnelId: update.id as Id<"tunnels">,
            });
            pruned++;
          } else {
            await ctx.runMutation(
              internal.maintenance.tunnels.updateStrength,
              {
                tunnelId: update.id as Id<"tunnels">,
                newStrength: update.newStrength,
              },
            );
            decayed++;
          }
        } catch (e) {
          console.error(`[tunnels] strength update failed for ${update.id}:`, e);
        }
      }
    }

    if (decayed > 0 || pruned > 0) {
      console.log(`[tunnels] decayed ${decayed}, pruned ${pruned} tunnels`);
    }
  },
});

export const computeStrengthUpdates = internalQuery({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    const tunnels = await ctx.db
      .query("tunnels")
      .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
      .collect();

    const now = Date.now();
    const pruneAgeCutoff = MIN_AGE_FOR_PRUNE_DAYS * 24 * 60 * 60 * 1000;

    return tunnels.map((t) => {
      const newStrength = Math.max(0, t.strength - STRENGTH_DECAY_PER_WEEK);
      const age = now - t.createdAt;

      if (newStrength < MIN_STRENGTH && age > pruneAgeCutoff) {
        return { id: t._id as string, action: "prune" as const, newStrength: 0 };
      }

      if (newStrength < t.strength) {
        return { id: t._id as string, action: "decay" as const, newStrength };
      }

      return { id: t._id as string, action: "decay" as const, newStrength: t.strength };
    });
  },
});

export const updateStrength = internalMutation({
  args: {
    tunnelId: v.id("tunnels"),
    newStrength: v.number(),
  },
  handler: async (ctx, { tunnelId, newStrength }) => {
    await ctx.db.patch(tunnelId, { strength: newStrength });
  },
});
