// Dedup — contradiction detection + duplicate room detection.
//
// Contradiction detection: finds drawers in the same room with high
// word overlap but different content. Flags parent closets with
// conflictGroupId for human review.
//
// Duplicate room detection: finds rooms with similar names in the same
// wing. Reports as merge candidates (does NOT auto-merge).

import { internalAction, internalMutation, internalQuery } from "../_generated/server.js";
import { internal } from "../_generated/api.js";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel.js";

const WORD_OVERLAP_THRESHOLD = 0.6;

// ─── Contradiction detection (weekly) ───────────────────────────

export const detectContradictions = internalAction({
  args: {},
  handler: async (ctx) => {
    const palaceIds: Id<"palaces">[] = await ctx.runQuery(
      internal.maintenance.curator.listReadyPalaces,
      {},
    );

    let totalConflicts = 0;

    for (const palaceId of palaceIds) {
      const conflicts: Array<{
        roomId: string;
        drawerA: string;
        drawerB: string;
        factA: string;
        factB: string;
        overlap: number;
      }> = await ctx.runQuery(
        internal.maintenance.dedup.findConflictingDrawers,
        { palaceId },
      );

      for (const conflict of conflicts) {
        try {
          await ctx.runMutation(
            internal.maintenance.dedup.flagConflict,
            {
              drawerAId: conflict.drawerA as Id<"drawers">,
              drawerBId: conflict.drawerB as Id<"drawers">,
            },
          );
          totalConflicts++;
        } catch (e) {
          console.error(`[dedup] conflict flag failed:`, e);
        }
      }
    }

    if (totalConflicts > 0) {
      console.log(`[dedup] flagged ${totalConflicts} potential contradictions`);
    }
  },
});

export const findConflictingDrawers = internalQuery({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    // Get all rooms in this palace.
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
      .collect();

    const conflicts: Array<{
      roomId: string;
      drawerA: string;
      drawerB: string;
      factA: string;
      factB: string;
      overlap: number;
    }> = [];

    for (const room of rooms) {
      // Get valid drawers in this room.
      const drawers = await ctx.db
        .query("drawers")
        .withIndex("by_room", (q) => q.eq("roomId", room._id))
        .collect();

      const valid = drawers.filter((d) => d.validUntil === undefined);

      // O(n^2) comparison — bounded by room size (typically < 50 drawers).
      for (let i = 0; i < valid.length; i++) {
        for (let j = i + 1; j < valid.length; j++) {
          const a = valid[i]!;
          const b = valid[j]!;

          if (a.fact === b.fact) continue; // exact match = not a contradiction

          const overlap = wordOverlap(a.fact, b.fact);
          if (overlap >= WORD_OVERLAP_THRESHOLD) {
            conflicts.push({
              roomId: room._id as string,
              drawerA: a._id as string,
              drawerB: b._id as string,
              factA: a.fact,
              factB: b.fact,
              overlap,
            });
          }
        }
      }
    }

    return conflicts;
  },
});

export const flagConflict = internalMutation({
  args: {
    drawerAId: v.id("drawers"),
    drawerBId: v.id("drawers"),
  },
  handler: async (ctx, { drawerAId, drawerBId }) => {
    const a = await ctx.db.get(drawerAId);
    const b = await ctx.db.get(drawerBId);
    if (!a || !b) return;

    // Generate a conflict group ID from the pair.
    const groupId = [drawerAId, drawerBId].sort().join(":");

    // Flag parent closets.
    const closetA = await ctx.db.get(a.closetId);
    const closetB = await ctx.db.get(b.closetId);

    if (closetA && !closetA.conflictGroupId) {
      await ctx.db.patch(a.closetId, {
        conflictGroupId: groupId,
        needsReview: true,
        updatedAt: Date.now(),
      });
    }
    if (closetB && !closetB.conflictGroupId) {
      await ctx.db.patch(b.closetId, {
        conflictGroupId: groupId,
        needsReview: true,
        updatedAt: Date.now(),
      });
    }
  },
});

// ─── Duplicate room detection (weekly) ──────────────────────────

export const detectDuplicateRooms = internalAction({
  args: {},
  handler: async (ctx) => {
    const palaceIds: Id<"palaces">[] = await ctx.runQuery(
      internal.maintenance.curator.listReadyPalaces,
      {},
    );

    for (const palaceId of palaceIds) {
      const duplicates: Array<{ wingName: string; roomA: string; roomB: string; similarity: number }> =
        await ctx.runQuery(
          internal.maintenance.dedup.findSimilarRooms,
          { palaceId },
        );

      if (duplicates.length > 0) {
        console.log(
          `[dedup] ${duplicates.length} potential duplicate rooms in palace ${palaceId}:`,
          duplicates
            .map((d) => `${d.wingName}: ${d.roomA} ≈ ${d.roomB} (${(d.similarity * 100).toFixed(0)}%)`)
            .join(", "),
        );
      }
    }
  },
});

export const findSimilarRooms = internalQuery({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    const wings = await ctx.db
      .query("wings")
      .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
      .collect();

    const duplicates: Array<{ wingName: string; roomA: string; roomB: string; similarity: number }> = [];

    for (const wing of wings) {
      const rooms = await ctx.db
        .query("rooms")
        .withIndex("by_wing", (q) => q.eq("wingId", wing._id))
        .collect();

      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          const a = rooms[i]!;
          const b = rooms[j]!;
          const sim = nameSimilarity(a.name, b.name);
          if (sim > 0.7) {
            duplicates.push({
              wingName: wing.name,
              roomA: a.name,
              roomB: b.name,
              similarity: sim,
            });
          }
        }
      }
    }

    return duplicates;
  },
});

// ─── Helpers ────────────────────────────────────────────────────

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function wordOverlap(a: string, b: string): number {
  const wordsA = tokenize(a);
  const wordsB = tokenize(b);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let shared = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) shared++;
  }

  // Jaccard-like: shared / smaller set size.
  const minSize = Math.min(wordsA.size, wordsB.size);
  return shared / minSize;
}

function nameSimilarity(a: string, b: string): number {
  // Simple: check if one name is a prefix/suffix of the other,
  // or if edit distance is small relative to length.
  const la = a.toLowerCase();
  const lb = b.toLowerCase();

  if (la === lb) return 1.0;
  if (la.startsWith(lb) || lb.startsWith(la)) return 0.9;
  if (la.includes(lb) || lb.includes(la)) return 0.8;

  // Character-level Jaccard.
  const charsA = new Set(la.split(""));
  const charsB = new Set(lb.split(""));
  let shared = 0;
  for (const c of charsA) if (charsB.has(c)) shared++;
  const union = new Set([...charsA, ...charsB]).size;
  return union > 0 ? shared / union : 0;
}
