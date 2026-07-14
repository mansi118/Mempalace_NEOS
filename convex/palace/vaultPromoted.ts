// Vault do-not-re-promote markers — the durable half of VL-5 (runtime/vault.py), ADDRESSED by
// (palaceId, neopId, key). The Vault-Promoter's nightly cadence must not promote the same candidate
// twice across ticks; `promote()` marks a key here, and `rollback()` CLEARS it so a corrected record
// can be re-promoted. The server is a blind marker store (runtime owns the key = provenance.
// source_external_id / dedup_key); own-seat, gated promote/recall/erase — same discipline as twins /
// run_events (the /mcp handler overwrites neopId server-side, so a caller touches only its OWN markers).

import { query, mutation } from "../_generated/server.js";
import { v } from "convex/values";

// palace_mark_promoted → { status, key, upsert }. Idempotent upsert by (palaceId, neopId, key).
export const markPromoted = mutation({
  args: {
    palaceId: v.id("palaces"),
    neopId: v.string(),
    key: v.string(),
    promotedAt: v.optional(v.string()), // runtime-supplied ISO ts (provenance; server does not interpret)
  },
  handler: async (ctx, { palaceId, neopId, key, promotedAt }) => {
    const existing = await ctx.db
      .query("vault_promoted")
      .withIndex("by_palace_neop_key", (q) =>
        q.eq("palaceId", palaceId).eq("neopId", neopId).eq("key", key))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { promotedAt, updatedAt: now });
      return { status: "ok", key, upsert: "update" };
    }
    await ctx.db.insert("vault_promoted", { palaceId, neopId, key, promotedAt, updatedAt: now });
    return { status: "ok", key, upsert: "insert" };
  },
});

// palace_is_promoted → { promoted: boolean, promotedAt? }. The cross-pass do-not-re-promote check.
export const isPromoted = query({
  args: { palaceId: v.id("palaces"), neopId: v.string(), key: v.string() },
  handler: async (ctx, { palaceId, neopId, key }) => {
    const row = await ctx.db
      .query("vault_promoted")
      .withIndex("by_palace_neop_key", (q) =>
        q.eq("palaceId", palaceId).eq("neopId", neopId).eq("key", key))
      .first();
    return row ? { promoted: true, promotedAt: row.promotedAt } : { promoted: false };
  },
});

// palace_clear_promoted → { status, cleared }. VL-5 rollback: drop the marker so a corrected record can
// be re-promoted. No-op (cleared:false) if the key was never marked — idempotent, never throws.
export const clearPromoted = mutation({
  args: { palaceId: v.id("palaces"), neopId: v.string(), key: v.string() },
  handler: async (ctx, { palaceId, neopId, key }) => {
    const row = await ctx.db
      .query("vault_promoted")
      .withIndex("by_palace_neop_key", (q) =>
        q.eq("palaceId", palaceId).eq("neopId", neopId).eq("key", key))
      .first();
    if (!row) return { status: "ok", cleared: false };
    await ctx.db.delete(row._id);
    return { status: "ok", cleared: true };
  },
});
