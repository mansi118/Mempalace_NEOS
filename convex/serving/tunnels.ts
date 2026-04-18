// Tunnel walker — BFS traversal across room connections.
//
// Starts from a room, follows tunnel edges, collects connected rooms
// with their summaries. Useful for "show me everything related to X."
//
// Cycle detection via visited set (Tier 1 fix from ultrathink).
// maxDepth limits traversal depth (default 2).

import { query } from "../_generated/server.js";
import { v } from "convex/values";
import type { Id, Doc } from "../_generated/dataModel.js";

interface WalkNode {
  roomId: string;
  roomName: string;
  wingName: string;
  summary: string;
  depth: number;
  relationship: string; // how we got here
  strength: number;
}

export const walkTunnel = query({
  args: {
    palaceId: v.id("palaces"),
    fromRoomId: v.id("rooms"),
    maxDepth: v.optional(v.number()),
    relationshipFilter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const maxDepth = args.maxDepth ?? 2;
    const visited = new Set<string>();
    const result: WalkNode[] = [];

    // Seed with the starting room.
    const startRoom = await ctx.db.get(args.fromRoomId);
    if (!startRoom || startRoom.palaceId !== args.palaceId) return { path: [] };

    const startWing = await ctx.db.get(startRoom.wingId);
    result.push({
      roomId: args.fromRoomId as string,
      roomName: startRoom.name,
      wingName: startWing?.name ?? "unknown",
      summary: startRoom.summary,
      depth: 0,
      relationship: "origin",
      strength: 1.0,
    });
    visited.add(args.fromRoomId as string);

    // BFS queue: [roomId, depth]
    const queue: Array<[Id<"rooms">, number]> = [[args.fromRoomId, 0]];

    while (queue.length > 0) {
      const [currentRoomId, currentDepth] = queue.shift()!;

      if (currentDepth >= maxDepth) continue;

      // Find all tunnels from this room.
      const tunnelsOut = await ctx.db
        .query("tunnels")
        .withIndex("by_palace_from", (q) =>
          q.eq("palaceId", args.palaceId).eq("fromRoomId", currentRoomId),
        )
        .collect();

      // Also find tunnels TO this room (tunnels are directional,
      // but for discovery we traverse both directions).
      const tunnelsIn = await ctx.db
        .query("tunnels")
        .withIndex("by_palace_to", (q) =>
          q.eq("palaceId", args.palaceId).eq("toRoomId", currentRoomId),
        )
        .collect();

      const allTunnels = [
        ...tunnelsOut.map((t) => ({
          targetRoomId: t.toRoomId,
          relationship: t.relationship,
          strength: t.strength,
        })),
        ...tunnelsIn.map((t) => ({
          targetRoomId: t.fromRoomId,
          relationship: t.relationship,
          strength: t.strength,
        })),
      ];

      for (const tunnel of allTunnels) {
        const targetId = tunnel.targetRoomId as string;

        // Cycle detection.
        if (visited.has(targetId)) continue;

        // Relationship filter.
        if (
          args.relationshipFilter &&
          tunnel.relationship !== args.relationshipFilter
        ) {
          continue;
        }

        visited.add(targetId);

        const targetRoom = await ctx.db.get(tunnel.targetRoomId);
        if (!targetRoom) continue;

        const targetWing = await ctx.db.get(targetRoom.wingId);

        result.push({
          roomId: targetId,
          roomName: targetRoom.name,
          wingName: targetWing?.name ?? "unknown",
          summary: targetRoom.summary,
          depth: currentDepth + 1,
          relationship: tunnel.relationship,
          strength: tunnel.strength,
        });

        queue.push([tunnel.targetRoomId, currentDepth + 1]);
      }
    }

    return { path: result };
  },
});
