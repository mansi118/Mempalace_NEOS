// neop_keys accessors (Gate D) — the per-seat Ed25519 public-key registry.
//
// These are INTERNAL functions, deliberately NOT wired into the /mcp tool dispatch: key registration is a
// PROVISIONING/admin operation. A seat that could register or overwrite its own key would defeat the whole
// binding (it could register an attacker key and then "verify" against it). So registerNeopKey is reached
// only from a trusted provisioning script (via the internal API) or a future admin console, and getNeopKey
// is read by http.ts during Gate-D verification — never by a seat.

import { internalQuery, internalMutation } from "../_generated/server.js";
import { v } from "convex/values";

// The registered pubkey for a seat, or null. Read during Gate-D verification (http.ts).
export const getNeopKey = internalQuery({
  args: { palaceId: v.id("palaces"), neopId: v.string() },
  handler: async (ctx, { palaceId, neopId }) => {
    const row = await ctx.db
      .query("neop_keys")
      .withIndex("by_palace_neop", (q) => q.eq("palaceId", palaceId).eq("neopId", neopId))
      .first();
    return row ? { pubkey: row.pubkey, createdAt: row.createdAt, rotatedAt: row.rotatedAt } : null;
  },
});

// Register (or ROTATE) the authorized pubkey for a seat. Provisioning-only (internal). Upsert by
// (palaceId, neopId): the latest registration is the trusted key, so this doubles as key rotation.
export const registerNeopKey = internalMutation({
  args: { palaceId: v.id("palaces"), neopId: v.string(), pubkey: v.string() },
  handler: async (ctx, { palaceId, neopId, pubkey }) => {
    if (!pubkey || !pubkey.trim()) throw new Error("registerNeopKey: pubkey is required");
    const existing = await ctx.db
      .query("neop_keys")
      .withIndex("by_palace_neop", (q) => q.eq("palaceId", palaceId).eq("neopId", neopId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { pubkey, rotatedAt: now });
      return { status: "ok", neopId, rotated: true };
    }
    await ctx.db.insert("neop_keys", { palaceId, neopId, pubkey, createdAt: now });
    return { status: "ok", neopId, rotated: false };
  },
});
