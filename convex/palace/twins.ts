// Twin accessors — per-seat structured state, ADDRESSED by (palaceId, neopId).
//
// A twin is NOT a closet: it is never embedded, never vector-indexed, and never returned by
// palace_search. It is read/written by address. `doc` is the serialized twin JSON and the NEOS broker
// (MemoryBroker.put_twin) OWNS its schema — the server stores it opaquely and never parses it.
//
// TWO CHANGES from the original blind store (see MEMPALACE_TWIN_CONTRACT.md §invariants):
//  1. SERVER-SIDE CAS (optional). putTwin still defaults to a blind latest-wins upsert (the single-writer
//     Twin-Curator path, unchanged), but when the caller passes `baseVersion` it becomes a compare-and-set:
//     write iff the stored version == baseVersion, else refuse with `status:"stale_base"` and NO write.
//     This closes the concurrent-writer clobber the contract flagged (flywheel auto-spawn / parallel twin
//     deltas) WITHOUT splitting the gate: when baseVersion is supplied the server is the sole authority.
//  2. VERSION HISTORY. Every successful put/rollback appends an opaque `doc` snapshot to `twin_versions`,
//     so a prior state can be fetched (getTwinVersion → the client diffs; the server never parses `doc`)
//     or rolled back to (rollbackTwin restores it AS A NEW FORWARD VERSION, keeping version monotonic so
//     CAS stays coherent). History is bounded per seat.
//
// Own-seat isolation is unchanged: every handler keys by the exact server-derived (palaceId, neopId).

import { query, mutation } from "../_generated/server.js";
import { v } from "convex/values";

// Per-(palaceId, neopId) history bound. History is for diff/rollback, not an audit log (that is
// ClickHouse's job post-Track-2); keep the most-recent TWIN_VERSION_CAP snapshots, trim the rest.
const TWIN_VERSION_CAP = 50;

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

// Append an opaque snapshot to twin_versions and trim beyond the cap (oldest first). Internal helper —
// called on every durable twin write so history and the live twin never diverge.
async function appendVersion(
  ctx: any,
  palaceId: any,
  neopId: string,
  doc: string,
  version: number,
  maturity: string,
  now: number,
  restoredFrom?: number,
) {
  await ctx.db.insert("twin_versions", {
    palaceId,
    neopId,
    version,
    doc,
    maturity,
    createdAt: now,
    ...(restoredFrom !== undefined ? { restoredFrom } : {}),
  });
  const rows = await ctx.db
    .query("twin_versions")
    .withIndex("by_palace_neop", (q: any) => q.eq("palaceId", palaceId).eq("neopId", neopId))
    .order("desc")
    .collect();
  for (const row of rows.slice(TWIN_VERSION_CAP)) {
    await ctx.db.delete(row._id);
  }
}

// palace_put_twin → { status, twinId, version, upsert } on success, or { status:"stale_base", ... } when
// a supplied baseVersion no longer matches the stored version (CAS conflict — the caller must re-read and
// retry). Without baseVersion this stays a blind latest-wins upsert (the single-writer path, unchanged).
export const putTwin = mutation({
  args: {
    palaceId: v.id("palaces"),
    neopId: v.string(),
    doc: v.string(),
    version: v.number(),
    maturity: v.string(),
    // Optional optimistic-concurrency guard. Present ⇒ compare-and-set; absent ⇒ blind latest-wins.
    baseVersion: v.optional(v.number()),
  },
  handler: async (ctx, { palaceId, neopId, doc, version, maturity, baseVersion }) => {
    const existing = await ctx.db
      .query("twins")
      .withIndex("by_palace_neop", (q) =>
        q.eq("palaceId", palaceId).eq("neopId", neopId),
      )
      .first();
    const now = Date.now();
    // CAS: only when a baseVersion is supplied AND a row exists. A first write (no row) has nothing to
    // clobber, so it is always allowed — the guard exists to stop a stale writer overwriting a newer twin.
    if (baseVersion !== undefined && existing && existing.version !== baseVersion) {
      return {
        status: "stale_base",
        storedVersion: existing.version,
        baseVersion,
        twinId: existing._id,
      };
    }
    if (existing) {
      await ctx.db.patch(existing._id, { doc, version, maturity, updatedAt: now });
      await appendVersion(ctx, palaceId, neopId, doc, version, maturity, now);
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
    await appendVersion(ctx, palaceId, neopId, doc, version, maturity, now);
    return { status: "ok", twinId: id, version, upsert: "insert" };
  },
});

// palace_get_twin_versions → { versions: [{version, maturity, createdAt, restoredFrom?}...], count }.
// METADATA only, newest-first, bounded — light enough to list a seat's history without shipping every doc.
export const getTwinVersions = query({
  args: {
    palaceId: v.id("palaces"),
    neopId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { palaceId, neopId, limit }) => {
    const take = Math.min(Math.max(limit ?? TWIN_VERSION_CAP, 1), TWIN_VERSION_CAP);
    const rows = await ctx.db
      .query("twin_versions")
      .withIndex("by_palace_neop", (q) => q.eq("palaceId", palaceId).eq("neopId", neopId))
      .order("desc")
      .take(take);
    const versions = rows.map((r) => ({
      version: r.version,
      maturity: r.maturity,
      createdAt: r.createdAt,
      ...(r.restoredFrom !== undefined ? { restoredFrom: r.restoredFrom } : {}),
    }));
    return { versions, count: versions.length };
  },
});

// palace_get_twin_version → { twin, version, maturity, createdAt } for ONE historical version, or
// { twin: null } if that version isn't retained. This is the diff primitive: the client fetches two
// versions and diffs them (the server never parses the broker-owned doc, so diff stays schema-agnostic).
export const getTwinVersion = query({
  args: {
    palaceId: v.id("palaces"),
    neopId: v.string(),
    version: v.number(),
  },
  handler: async (ctx, { palaceId, neopId, version }) => {
    const row = await ctx.db
      .query("twin_versions")
      .withIndex("by_palace_neop_version", (q) =>
        q.eq("palaceId", palaceId).eq("neopId", neopId).eq("version", version),
      )
      .first();
    if (!row) return { twin: null };
    return {
      twin: JSON.parse(row.doc),
      version: row.version,
      maturity: row.maturity,
      createdAt: row.createdAt,
      ...(row.restoredFrom !== undefined ? { restoredFrom: row.restoredFrom } : {}),
    };
  },
});

// palace_rollback_twin → restore a retained version's doc as the LIVE twin, as a NEW forward version
// (version = current + 1, content = the target snapshot). Rolling FORWARD (never decrementing the version
// number) keeps versions monotonic so the CAS guard stays coherent and history stays append-only. Returns
// { status:"ok", version, restoredFrom } | { status:"unknown_version" } | { status:"no_twin" } |
// { status:"stale_base", ... } when an optional baseVersion no longer matches the live twin.
export const rollbackTwin = mutation({
  args: {
    palaceId: v.id("palaces"),
    neopId: v.string(),
    toVersion: v.number(),
    baseVersion: v.optional(v.number()),
  },
  handler: async (ctx, { palaceId, neopId, toVersion, baseVersion }) => {
    const current = await ctx.db
      .query("twins")
      .withIndex("by_palace_neop", (q) =>
        q.eq("palaceId", palaceId).eq("neopId", neopId),
      )
      .first();
    if (!current) return { status: "no_twin" };
    if (baseVersion !== undefined && current.version !== baseVersion) {
      return { status: "stale_base", storedVersion: current.version, baseVersion };
    }
    const target = await ctx.db
      .query("twin_versions")
      .withIndex("by_palace_neop_version", (q) =>
        q.eq("palaceId", palaceId).eq("neopId", neopId).eq("version", toVersion),
      )
      .first();
    if (!target) return { status: "unknown_version", toVersion };
    const now = Date.now();
    const newVersion = current.version + 1;
    await ctx.db.patch(current._id, {
      doc: target.doc,
      version: newVersion,
      maturity: target.maturity,
      updatedAt: now,
    });
    await appendVersion(ctx, palaceId, neopId, target.doc, newVersion, target.maturity, now, toVersion);
    return { status: "ok", version: newVersion, restoredFrom: toVersion, twinId: current._id };
  },
});
