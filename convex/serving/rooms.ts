// L3 — Deep room dive.
//
// Returns closets (paginated), valid drawers, tunnels for a room.
// Used when a NEop wants full context on a specific topic.

import { query } from "../_generated/server.js";
import { v } from "convex/values";

const DEFAULT_PAGE_SIZE = 20;

export const getRoomDeep = query({
  args: {
    roomId: v.id("rooms"),
    palaceId: v.id("palaces"),
    pageSize: v.optional(v.number()),
    cursor: v.optional(v.number()), // createdAt cursor for pagination
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) return null;
    if (room.palaceId !== args.palaceId) return null;

    const wing = await ctx.db.get(room.wingId);
    const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;

    // Closets — paginated by createdAt, newest first.
    let closetQuery = ctx.db
      .query("closets")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .order("desc");

    const allClosets = await closetQuery.collect();

    // Filter: non-retracted, non-decayed, head versions only.
    const visible = allClosets.filter(
      (c) => !c.retracted && !c.decayed && c.supersededBy === undefined,
    );

    // Apply cursor (skip closets newer than cursor timestamp).
    const afterCursor = args.cursor
      ? visible.filter((c) => c.createdAt < args.cursor!)
      : visible;

    const page = afterCursor.slice(0, pageSize);
    const nextCursor =
      page.length === pageSize ? page[page.length - 1]?.createdAt : undefined;

    // Drawers — only for closets on this page.
    const drawersByCloset: Record<string, Array<{ fact: string; validFrom: number; confidence: number }>> = {};
    for (const closet of page) {
      const drawers = await ctx.db
        .query("drawers")
        .withIndex("by_closet", (q) => q.eq("closetId", closet._id))
        .collect();
      drawersByCloset[closet._id as string] = drawers
        .filter((d) => d.validUntil === undefined) // valid only
        .map((d) => ({
          fact: d.fact,
          validFrom: d.validFrom,
          confidence: d.confidence,
        }));
    }

    // Tunnels — all connections from/to this room.
    const [tunnelsFrom, tunnelsTo] = await Promise.all([
      ctx.db
        .query("tunnels")
        .withIndex("by_palace_from", (q) =>
          q.eq("palaceId", args.palaceId).eq("fromRoomId", args.roomId),
        )
        .collect(),
      ctx.db
        .query("tunnels")
        .withIndex("by_palace_to", (q) =>
          q.eq("palaceId", args.palaceId).eq("toRoomId", args.roomId),
        )
        .collect(),
    ]);

    // Resolve tunnel target room names.
    const tunnelDetails = await Promise.all(
      [...tunnelsFrom, ...tunnelsTo].map(async (t) => {
        const targetId =
          t.fromRoomId === args.roomId ? t.toRoomId : t.fromRoomId;
        const targetRoom = await ctx.db.get(targetId);
        const targetWing = targetRoom
          ? await ctx.db.get(targetRoom.wingId)
          : null;
        return {
          direction: t.fromRoomId === args.roomId ? "outgoing" : "incoming",
          targetRoom: targetRoom?.name ?? "unknown",
          targetWing: targetWing?.name ?? "unknown",
          relationship: t.relationship,
          strength: t.strength,
          label: t.label,
        };
      }),
    );

    return {
      room: {
        name: room.name,
        summary: room.summary,
        wing: wing?.name ?? "unknown",
        closetCount: room.closetCount,
        lastUpdated: room.lastUpdated,
        tags: room.tags,
      },
      closets: page.map((c) => ({
        id: c._id,
        content: c.content,
        title: c.title,
        category: c.category,
        confidence: c.confidence,
        createdAt: c.createdAt,
        sourceAdapter: c.sourceAdapter,
        drawers: drawersByCloset[c._id as string] ?? [],
      })),
      tunnels: tunnelDetails,
      pagination: {
        pageSize,
        returned: page.length,
        hasMore: nextCursor !== undefined,
        nextCursor,
      },
    };
  },
});
