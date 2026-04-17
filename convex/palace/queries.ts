// Palace read queries.
//
// Note: serving-layer queries (Phase 5: searchPalace, getRoomDeep, etc.) live in
// convex/serving/. This file is the low-level data accessor. Filtering for
// retracted/decayed/needsReview happens at the caller level.

import { query } from "../_generated/server.js";
import { v } from "convex/values";
import type { Id, Doc } from "../_generated/dataModel.js";

// ─── PALACES ─────────────────────────────────────────────────

export const getPalace = query({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    return await ctx.db.get(palaceId);
  },
});

export const getPalaceByClient = query({
  args: { clientId: v.string() },
  handler: async (ctx, { clientId }) => {
    return await ctx.db
      .query("palaces")
      .withIndex("by_client", (q) => q.eq("clientId", clientId))
      .first();
  },
});

export const listPalaces = query({
  args: { onlyReady: v.optional(v.boolean()) },
  handler: async (ctx, { onlyReady }) => {
    if (onlyReady) {
      return await ctx.db
        .query("palaces")
        .withIndex("by_status", (q) => q.eq("status", "ready"))
        .collect();
    }
    return await ctx.db.query("palaces").collect();
  },
});

// ─── WINGS ───────────────────────────────────────────────────

export const listWings = query({
  args: {
    palaceId: v.id("palaces"),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, { palaceId, includeArchived }) => {
    const wings = await ctx.db
      .query("wings")
      .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
      .collect();

    const filtered = includeArchived ? wings : wings.filter((w) => !w.archived);
    return filtered.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

export const getWingByName = query({
  args: { palaceId: v.id("palaces"), name: v.string() },
  handler: async (ctx, { palaceId, name }) => {
    return await ctx.db
      .query("wings")
      .withIndex("by_palace_name", (q) => q.eq("palaceId", palaceId).eq("name", name))
      .first();
  },
});

// ─── HALLS ───────────────────────────────────────────────────

export const listHalls = query({
  args: { wingId: v.id("wings") },
  handler: async (ctx, { wingId }) => {
    return await ctx.db
      .query("halls")
      .withIndex("by_wing", (q) => q.eq("wingId", wingId))
      .collect();
  },
});

export const getHallByType = query({
  args: { wingId: v.id("wings"), type: v.string() },
  handler: async (ctx, { wingId, type }) => {
    return await ctx.db
      .query("halls")
      .withIndex("by_wing_type", (q) =>
        q.eq("wingId", wingId).eq("type", type as Doc<"halls">["type"]),
      )
      .first();
  },
});

// ─── ROOMS ───────────────────────────────────────────────────

export const getRoom = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    return await ctx.db.get(roomId);
  },
});

export const getRoomByName = query({
  args: { palaceId: v.id("palaces"), name: v.string() },
  handler: async (ctx, { palaceId, name }) => {
    return await ctx.db
      .query("rooms")
      .withIndex("by_palace_name", (q) => q.eq("palaceId", palaceId).eq("name", name))
      .first();
  },
});

export const listRoomsByWing = query({
  args: { wingId: v.id("wings") },
  handler: async (ctx, { wingId }) => {
    return await ctx.db
      .query("rooms")
      .withIndex("by_wing", (q) => q.eq("wingId", wingId))
      .collect();
  },
});

export const listRoomsByHall = query({
  args: { hallId: v.id("halls") },
  handler: async (ctx, { hallId }) => {
    return await ctx.db
      .query("rooms")
      .withIndex("by_hall", (q) => q.eq("hallId", hallId))
      .collect();
  },
});

// ─── CLOSETS ─────────────────────────────────────────────────

export const getCloset = query({
  args: { closetId: v.id("closets") },
  handler: async (ctx, { closetId }) => {
    return await ctx.db.get(closetId);
  },
});

export const listClosets = query({
  args: {
    roomId: v.id("rooms"),
    includeDecayed: v.optional(v.boolean()),
    includeRetracted: v.optional(v.boolean()),
    includeOlderVersions: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const closets = await ctx.db
      .query("closets")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();

    return closets.filter((c) => {
      if (!args.includeDecayed && c.decayed) return false;
      if (!args.includeRetracted && c.retracted) return false;
      if (!args.includeOlderVersions && c.supersededBy !== undefined) return false;
      return true;
    });
  },
});

export const findClosetByDedup = query({
  args: { palaceId: v.id("palaces"), dedupKey: v.string() },
  handler: async (ctx, { palaceId, dedupKey }) => {
    return await ctx.db
      .query("closets")
      .withIndex("by_dedup", (q) =>
        q.eq("palaceId", palaceId).eq("dedupKey", dedupKey),
      )
      .collect();
  },
});

export const listQuarantined = query({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    return await ctx.db
      .query("closets")
      .withIndex("by_palace_review", (q) =>
        q.eq("palaceId", palaceId).eq("needsReview", true),
      )
      .collect();
  },
});

export const listClosetsByCategory = query({
  args: {
    palaceId: v.id("palaces"),
    category: v.string(),
  },
  handler: async (ctx, { palaceId, category }) => {
    return await ctx.db
      .query("closets")
      .withIndex("by_palace_category", (q) =>
        q.eq("palaceId", palaceId).eq("category", category as Doc<"closets">["category"]),
      )
      .collect();
  },
});

// ─── DRAWERS ─────────────────────────────────────────────────

export const listDrawers = query({
  args: {
    closetId: v.id("closets"),
    validOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, { closetId, validOnly }) => {
    const drawers = await ctx.db
      .query("drawers")
      .withIndex("by_closet", (q) => q.eq("closetId", closetId))
      .collect();

    if (validOnly) return drawers.filter((d) => d.validUntil === undefined);
    return drawers;
  },
});

// ─── TUNNELS ─────────────────────────────────────────────────

export const listTunnelsFrom = query({
  args: { palaceId: v.id("palaces"), fromRoomId: v.id("rooms") },
  handler: async (ctx, { palaceId, fromRoomId }) => {
    return await ctx.db
      .query("tunnels")
      .withIndex("by_palace_from", (q) =>
        q.eq("palaceId", palaceId).eq("fromRoomId", fromRoomId),
      )
      .collect();
  },
});

export const listTunnelsTo = query({
  args: { palaceId: v.id("palaces"), toRoomId: v.id("rooms") },
  handler: async (ctx, { palaceId, toRoomId }) => {
    return await ctx.db
      .query("tunnels")
      .withIndex("by_palace_to", (q) =>
        q.eq("palaceId", palaceId).eq("toRoomId", toRoomId),
      )
      .collect();
  },
});

// ─── STATS ───────────────────────────────────────────────────

export const getStats = query({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    const [palace, wings, closets, drawers, tunnels] = await Promise.all([
      ctx.db.get(palaceId),
      ctx.db
        .query("wings")
        .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
        .collect(),
      ctx.db
        .query("closets")
        .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
        .collect(),
      ctx.db
        .query("drawers")
        .withIndex("by_palace_valid", (q) => q.eq("palaceId", palaceId))
        .collect(),
      ctx.db
        .query("tunnels")
        .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
        .collect(),
    ]);

    if (!palace) return null;

    const visibleClosets = closets.filter(
      (c) => !c.retracted && !c.decayed && c.supersededBy === undefined,
    );
    const validDrawers = drawers.filter((d) => d.validUntil === undefined);

    const byCategory: Record<string, number> = {};
    for (const c of visibleClosets) {
      byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
    }

    return {
      palace: { name: palace.name, status: palace.status },
      wings: wings.length,
      closets: {
        total: closets.length,
        visible: visibleClosets.length,
        retracted: closets.filter((c) => c.retracted).length,
        decayed: closets.filter((c) => c.decayed).length,
        needsReview: closets.filter((c) => c.needsReview).length,
        byCategory,
      },
      drawers: { total: drawers.length, valid: validDrawers.length },
      tunnels: tunnels.length,
    };
  },
});
