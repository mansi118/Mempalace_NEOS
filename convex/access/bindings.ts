// Edge-auth E1 — human↔seat binding store (#1/#3). The ONLY source of requester identity.
//
// resolveBinding(mxid) is what the edge resolver (NEURAL-ops acp/edge_auth) calls after the
// Application-Service verifies the mxid. Bindings are provisioned per tenant; upsertSeatBinding
// is deliberately NOT registered as an /mcp tool, so a channel path can never write a binding.
// Write-time validation enforces the core invariant: a human is NEVER bound to a reserved,
// server-minted identity (_admin/_system/_*).

import { query, mutation } from "../_generated/server.js";
import { v } from "convex/values";
import { isReservedIdentity } from "../lib/enums.js";

export const resolveBinding = query({
  args: { mxid: v.string() },
  handler: async (ctx, { mxid }) => {
    return await ctx.db
      .query("seat_bindings")
      .withIndex("by_mxid", (q) => q.eq("mxid", mxid))
      .first();
  },
});

export const upsertSeatBinding = mutation({
  args: {
    mxid: v.string(),
    tenant_id: v.string(),
    seat_id: v.string(),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
    status: v.optional(v.union(v.literal("active"), v.literal("suspended"))),
  },
  handler: async (ctx, args) => {
    if (!args.mxid.trim()) throw new Error("mxid required");
    if (!args.tenant_id.trim()) throw new Error("tenant_id required");
    if (!args.seat_id.trim()) throw new Error("seat_id required");
    // Core E1 invariant: reserved identities are server-minted only — never a binding target.
    if (isReservedIdentity(args.seat_id)) {
      throw new Error(
        `cannot bind a human to a reserved identity "${args.seat_id}" — ` +
          `reserved ids are server-minted only`,
      );
    }

    const doc = {
      mxid: args.mxid,
      tenant_id: args.tenant_id,
      seat_id: args.seat_id,
      role: args.role,
      status: args.status ?? ("active" as const),
      updatedAt: Date.now(),
    };

    // Keyed by mxid — one binding per human. Second write updates, never duplicates.
    const existing = await ctx.db
      .query("seat_bindings")
      .withIndex("by_mxid", (q) => q.eq("mxid", args.mxid))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return { status: "updated" as const, bindingId: existing._id };
    }
    const bindingId = await ctx.db.insert("seat_bindings", doc);
    return { status: "created" as const, bindingId };
  },
});
