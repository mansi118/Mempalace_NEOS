// L0 + L1 generators — template-based, no LLM.
//
// L0 (~50 tokens): palace identity briefing. Always in NEop system prompt.
// L1 (~120 tokens): wing index with counts. Loaded at session start.
//
// Both are stored as strings on the palace document and regenerated
// by the Phase 8 daily cron. They're deterministic given palace data.
//
// Tier 1 fix from ultrathink: no LLM needed. Templates are deterministic,
// instant, free, and never fail.

import { query, mutation, internalMutation } from "../_generated/server.js";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";
import { safePatchPalace } from "../lib/safePatch.js";

// ─── Getters (fast reads from palace document) ──────────────────

export const getL0 = query({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    const palace = await ctx.db.get(palaceId);
    if (!palace) return null;
    return palace.l0_briefing || null;
  },
});

export const getL1 = query({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    const palace = await ctx.db.get(palaceId);
    if (!palace) return null;
    return palace.l1_wing_index || null;
  },
});

// ─── L0 generator ───────────────────────────────────────────────

export const generateL0 = internalMutation({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    const palace = await ctx.db.get(palaceId);
    if (!palace) throw new Error(`palace ${palaceId} not found`);

    const wings = await ctx.db
      .query("wings")
      .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
      .collect();

    const activeWings = wings.filter((w) => !w.archived);
    const totalRooms = activeWings.reduce((s, w) => s + w.roomCount, 0);

    // Count visible closets (non-retracted, non-decayed, head versions).
    const allClosets = await ctx.db
      .query("closets")
      .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
      .collect();
    const visibleClosets = allClosets.filter(
      (c) => !c.retracted && !c.decayed && c.supersededBy === undefined,
    );

    // Find 3 most recently active rooms.
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
      .collect();
    const recentRooms = rooms
      .sort((a, b) => b.lastUpdated - a.lastUpdated)
      .slice(0, 3);

    const recentStr = recentRooms
      .map((r) => {
        const wing = activeWings.find((w) => w._id === r.wingId);
        const age = formatAge(Date.now() - r.lastUpdated);
        return `${wing?.name ?? "?"}/${r.name} (${age})`;
      })
      .join(", ");

    const l0 = [
      `I am a NEop for ${palace.name}.`,
      `${activeWings.length} wings, ${totalRooms} rooms, ${visibleClosets.length} memories.`,
      recentRooms.length > 0 ? `Recent: ${recentStr}.` : "",
      `Memory protocol: search before assuming.`,
    ]
      .filter(Boolean)
      .join(" ");

    await safePatchPalace(ctx, palaceId, { l0_briefing: l0 });
    return l0;
  },
});

// ─── L1 generator ───────────────────────────────────────────────

export const generateL1 = internalMutation({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    const palace = await ctx.db.get(palaceId);
    if (!palace) throw new Error(`palace ${palaceId} not found`);

    const wings = await ctx.db
      .query("wings")
      .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
      .collect();

    // Sort by last activity (most recent first — Gap 3 fix).
    const activeWings = wings
      .filter((w) => !w.archived)
      .sort((a, b) => b.lastActivity - a.lastActivity);

    // Count closets per wing.
    const allClosets = await ctx.db
      .query("closets")
      .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
      .collect();

    const closetsByWing = new Map<string, number>();
    for (const c of allClosets) {
      if (c.retracted || c.decayed || c.supersededBy !== undefined) continue;
      const wingId = c.wingId as string;
      closetsByWing.set(wingId, (closetsByWing.get(wingId) ?? 0) + 1);
    }

    const wingEntries = activeWings.map((w) => {
      const count = closetsByWing.get(w._id as string) ?? 0;
      return `${w.name} (${w.roomCount}r, ${count}m)`;
    });

    const totalRooms = activeWings.reduce((s, w) => s + w.roomCount, 0);
    const totalMemories = [...closetsByWing.values()].reduce((s, c) => s + c, 0);

    const l1 = `Wings: ${wingEntries.join(", ")}. Total: ${totalRooms} rooms, ${totalMemories} memories.`;

    await safePatchPalace(ctx, palaceId, { l1_wing_index: l1 });
    return l1;
  },
});

// ─── Regenerate both (called by Phase 8 cron) ───────────────────

export const regenerateL0L1 = internalMutation({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    // Can't call internal mutations from internal mutations directly,
    // so inline the logic or schedule them. For simplicity, this is
    // a placeholder that the cron calls both separately.
  },
});

// ─── Helpers ────────────────────────────────────────────────────

function formatAge(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}
