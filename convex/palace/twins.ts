// Twin accessors — per-seat structured state, ADDRESSED by (palaceId, neopId).
//
// A twin is NOT a closet: it is never embedded, never vector-indexed, and never returned by
// palace_search. It is read/written by address. The NEOS broker (MemoryBroker.put_twin) is the
// SOLE owner of versioning + stale-base rejection (see MEMPALACE_TWIN_CONTRACT.md); putTwin here
// is a blind "latest wins" upsert with NO server-side version check — one owner, no double-gate.
// Correct under single-writer-per-twin (the Twin Curator). If concurrent twin writers are ever
// introduced, move the gate server-side (write iff stored version == base) — do not split it.

import { query, mutation } from "../_generated/server.js";
import { v } from "convex/values";

// palace_get_twin → { twin: <object> | null, version?, maturity?, updatedAt? }
export const getTwin = query({
  args: { palaceId: v.id("palaces"), neopId: v.string() },
  handler: async (ctx, { palaceId, neopId }) => {
    const row = await ctx.db
      .query("twins")
      .withIndex("by_palace_neop", (q) =>
        q.eq("palaceId", palaceId).eq("neopId", neopId),
      )
      .first();
    if (!row) return { twin: null };
    return {
      twin: JSON.parse(row.doc),
      version: row.version,
      maturity: row.maturity,
      updatedAt: row.updatedAt,
    };
  },
});

// palace_put_twin → { status, twinId, version, upsert }. Blind upsert by (palaceId, neopId):
// latest wins, NO version check (the broker already enforced stale-base before calling).
export const putTwin = mutation({
  args: {
    palaceId: v.id("palaces"),
    neopId: v.string(),
    doc: v.string(),
    version: v.number(),
    maturity: v.string(),
  },
  handler: async (ctx, { palaceId, neopId, doc, version, maturity }) => {
    const existing = await ctx.db
      .query("twins")
      .withIndex("by_palace_neop", (q) =>
        q.eq("palaceId", palaceId).eq("neopId", neopId),
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { doc, version, maturity, updatedAt: now });
      return { status: "ok", twinId: existing._id, version, upsert: "update" };
    }
    const id = await ctx.db.insert("twins", {
      palaceId,
      neopId,
      doc,
      version,
      maturity,
      updatedAt: now,
    });
    return { status: "ok", twinId: id, version, upsert: "insert" };
  },
});
