// Palace CRUD mutations.
//
// Invariants enforced here (see IMPLEMENTATION_PLAN.md §0 + ultrathink analysis):
//   1. Append-only writes on closets (use safePatchCloset for allowed mutations).
//   2. Idempotent creation: createWing/Hall/Room return existing if already present.
//   3. Dedup on closet creation: same (palaceId, dedupKey) => noop or auto-version.
//   4. Counter denormalization is updated in the same mutation as the insert.
//   5. retractCloset deletes the corresponding embedding row (defense in depth).
//   6. Cross-palace foreign keys are validated.
//   7. Provisioning atomicity: palaces start as "provisioning" and only flip
//      to "ready" when the seeder finishes.

import { mutation, internalMutation } from "../_generated/server.js";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel.js";
import { computeDedupKey, normalizeContent } from "../lib/dedup.js";
import {
  CATEGORY_TTL_DEFAULTS,
  HALL_TYPES,
  type Category,
  type HallType,
} from "../lib/enums.js";
import {
  validateCategory,
  validateConfidence,
  validateContent,
  validateContentAccess,
  validateHallType,
  validateNonEmpty,
  validateRuntimeOps,
  validateSlug,
  validateSourceType,
  validateAuthorType,
  validateStrength,
  validateTtlSeconds,
  validateTunnelRelationship,
  validateVisibility,
} from "../lib/validators.js";
import {
  safePatchCloset,
  safePatchHall,
  safePatchPalace,
  safePatchRoom,
  safePatchWing,
} from "../lib/safePatch.js";

// ─────────────────────────────────────────────────────────────────
// PALACES
// ─────────────────────────────────────────────────────────────────

export const createPalace = mutation({
  args: {
    name: v.string(),
    clientId: v.string(),
    falkordbGraph: v.string(),
    createdBy: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"palaces">> => {
    validateNonEmpty(args.name, "name");
    validateNonEmpty(args.clientId, "clientId");
    validateNonEmpty(args.falkordbGraph, "falkordbGraph");

    // Idempotency: one palace per clientId.
    const existing = await ctx.db
      .query("palaces")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("palaces", {
      name: args.name,
      clientId: args.clientId,
      createdAt: Date.now(),
      createdBy: args.createdBy,
      status: "provisioning",
      schemaVersion: 1,
      falkordbGraph: args.falkordbGraph,
      l0_briefing: "",
      l1_wing_index: "",
    });
  },
});

export const markPalaceReady = mutation({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    const palace = await ctx.db.get(palaceId);
    if (!palace) throw new Error(`palace ${palaceId} not found`);
    await safePatchPalace(ctx, palaceId, { status: "ready" });
  },
});

export const updatePalaceBriefing = mutation({
  args: {
    palaceId: v.id("palaces"),
    l0_briefing: v.optional(v.string()),
    l1_wing_index: v.optional(v.string()),
  },
  handler: async (ctx, { palaceId, l0_briefing, l1_wing_index }) => {
    const fields: Partial<Doc<"palaces">> = {};
    if (l0_briefing !== undefined) fields.l0_briefing = l0_briefing;
    if (l1_wing_index !== undefined) fields.l1_wing_index = l1_wing_index;
    if (Object.keys(fields).length > 0) await safePatchPalace(ctx, palaceId, fields);
  },
});

// ─────────────────────────────────────────────────────────────────
// WINGS
// ─────────────────────────────────────────────────────────────────

export const createWing = mutation({
  args: {
    palaceId: v.id("palaces"),
    name: v.string(),
    description: v.string(),
    sortOrder: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"wings">> => {
    validateSlug(args.name, "wing.name");

    const existing = await ctx.db
      .query("wings")
      .withIndex("by_palace_name", (q) =>
        q.eq("palaceId", args.palaceId).eq("name", args.name),
      )
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("wings", {
      palaceId: args.palaceId,
      name: args.name,
      description: args.description,
      sortOrder: args.sortOrder,
      roomCount: 0,
      lastActivity: Date.now(),
      archived: false,
    });
  },
});

export const archiveWing = mutation({
  args: { wingId: v.id("wings") },
  handler: async (ctx, { wingId }) => {
    await safePatchWing(ctx, wingId, { archived: true });
  },
});

// ─────────────────────────────────────────────────────────────────
// HALLS
// ─────────────────────────────────────────────────────────────────

export const createHall = mutation({
  args: {
    wingId: v.id("wings"),
    palaceId: v.id("palaces"),
    type: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"halls">> => {
    validateHallType(args.type);

    // Foreign key sanity.
    const wing = await ctx.db.get(args.wingId);
    if (!wing) throw new Error(`wing ${args.wingId} not found`);
    if (wing.palaceId !== args.palaceId) {
      throw new Error("wing.palaceId mismatch with provided palaceId");
    }

    const existing = await ctx.db
      .query("halls")
      .withIndex("by_wing_type", (q) => q.eq("wingId", args.wingId).eq("type", args.type as HallType))
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("halls", {
      wingId: args.wingId,
      palaceId: args.palaceId,
      type: args.type as HallType,
      roomCount: 0,
    });
  },
});

// ─────────────────────────────────────────────────────────────────
// ROOMS
// ─────────────────────────────────────────────────────────────────

export const createRoom = mutation({
  args: {
    hallId: v.id("halls"),
    wingId: v.id("wings"),
    palaceId: v.id("palaces"),
    name: v.string(),
    summary: v.string(),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"rooms">> => {
    validateSlug(args.name, "room.name");

    const hall = await ctx.db.get(args.hallId);
    const wing = await ctx.db.get(args.wingId);
    if (!hall) throw new Error(`hall ${args.hallId} not found`);
    if (!wing) throw new Error(`wing ${args.wingId} not found`);
    if (hall.wingId !== args.wingId) throw new Error("hall.wingId mismatch with provided wingId");
    if (wing.palaceId !== args.palaceId) {
      throw new Error("wing.palaceId mismatch with provided palaceId");
    }

    const existing = await ctx.db
      .query("rooms")
      .withIndex("by_palace_name", (q) =>
        q.eq("palaceId", args.palaceId).eq("name", args.name),
      )
      .first();
    if (existing) return existing._id;

    const roomId = await ctx.db.insert("rooms", {
      hallId: args.hallId,
      wingId: args.wingId,
      palaceId: args.palaceId,
      name: args.name,
      summary: args.summary,
      closetCount: 0,
      lastUpdated: Date.now(),
      tags: args.tags,
    });

    // Counter denormalization (atomic with insert via Convex OCC).
    await safePatchHall(ctx, args.hallId, { roomCount: hall.roomCount + 1 });
    await safePatchWing(ctx, args.wingId, {
      roomCount: wing.roomCount + 1,
      lastActivity: Date.now(),
    });

    return roomId;
  },
});

// ─── getOrCreateRoom (used by ingestion when Gemini picks a room name) ──

export const getOrCreateRoom = mutation({
  args: {
    palaceId: v.id("palaces"),
    wingName: v.string(),
    roomName: v.string(),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"rooms">> => {
    // Normalize names.
    const wn = args.wingName.toLowerCase().replace(/\s+/g, "-");
    const rn = args.roomName.toLowerCase().replace(/\s+/g, "-");

    // 1. Check if room already exists by name in this palace.
    const existing = await ctx.db
      .query("rooms")
      .withIndex("by_palace_name", (q) =>
        q.eq("palaceId", args.palaceId).eq("name", rn),
      )
      .first();
    if (existing) return existing._id;

    // 2. Find the wing.
    const wing = await ctx.db
      .query("wings")
      .withIndex("by_palace_name", (q) =>
        q.eq("palaceId", args.palaceId).eq("name", wn),
      )
      .first();

    if (!wing) {
      // Wing doesn't exist — route to _quarantine wing.
      const quarantine = await ctx.db
        .query("wings")
        .withIndex("by_palace_name", (q) =>
          q.eq("palaceId", args.palaceId).eq("name", "_quarantine"),
        )
        .first();
      if (!quarantine) throw new Error("_quarantine wing not found");

      const hall = await ctx.db
        .query("halls")
        .withIndex("by_wing_type", (q) =>
          q.eq("wingId", quarantine._id).eq("type", "facts"),
        )
        .first();
      if (!hall) throw new Error("_quarantine/facts hall not found");

      const roomId = await ctx.db.insert("rooms", {
        hallId: hall._id,
        wingId: quarantine._id,
        palaceId: args.palaceId,
        name: rn,
        summary: args.summary ?? `Auto-created room: ${rn}`,
        closetCount: 0,
        lastUpdated: Date.now(),
        tags: ["auto-created"],
      });
      await safePatchHall(ctx, hall._id, { roomCount: hall.roomCount + 1 });
      await safePatchWing(ctx, quarantine._id, {
        roomCount: quarantine.roomCount + 1,
        lastActivity: Date.now(),
      });
      return roomId;
    }

    // 3. Find the "facts" hall as default for new rooms.
    const hall = await ctx.db
      .query("halls")
      .withIndex("by_wing_type", (q) =>
        q.eq("wingId", wing._id).eq("type", "facts"),
      )
      .first();
    if (!hall) throw new Error(`No "facts" hall in wing ${wn}`);

    // 4. Create the room.
    const roomId = await ctx.db.insert("rooms", {
      hallId: hall._id,
      wingId: wing._id,
      palaceId: args.palaceId,
      name: rn,
      summary: args.summary ?? `Auto-created room: ${rn}`,
      closetCount: 0,
      lastUpdated: Date.now(),
      tags: ["auto-created"],
    });
    await safePatchHall(ctx, hall._id, { roomCount: hall.roomCount + 1 });
    await safePatchWing(ctx, wing._id, {
      roomCount: wing.roomCount + 1,
      lastActivity: Date.now(),
    });
    return roomId;
  },
});

export const updateRoomSummary = mutation({
  args: {
    roomId: v.id("rooms"),
    summary: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { roomId, summary, tags }) => {
    const fields: Partial<Doc<"rooms">> = { lastUpdated: Date.now() };
    if (summary !== undefined) fields.summary = summary;
    if (tags !== undefined) fields.tags = tags;
    await safePatchRoom(ctx, roomId, fields);
  },
});

// ─────────────────────────────────────────────────────────────────
// CLOSETS — the critical mutation
// ─────────────────────────────────────────────────────────────────

export const createCloset = mutation({
  args: {
    roomId: v.id("rooms"),
    palaceId: v.id("palaces"),
    content: v.string(),
    title: v.optional(v.string()),
    category: v.string(),
    sourceType: v.string(),
    sourceRef: v.optional(v.string()),
    sourceAdapter: v.string(),
    sourceExternalId: v.string(),
    authorType: v.string(),
    authorId: v.string(),
    confidence: v.number(),
    piiTags: v.optional(v.array(v.string())),
    visibility: v.optional(v.string()),
    ttlSeconds: v.optional(v.number()),
    needsReview: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "created" | "noop" | "versioned"; closetId: Id<"closets">; version: number }> => {
    // ── 1. Validate inputs ──────────────────────────────────
    validateContent(args.content);
    validateCategory(args.category);
    validateSourceType(args.sourceType);
    validateAuthorType(args.authorType);
    validateConfidence(args.confidence);
    validateNonEmpty(args.sourceAdapter, "sourceAdapter");
    validateNonEmpty(args.sourceExternalId, "sourceExternalId");
    validateNonEmpty(args.authorId, "authorId");
    if (args.visibility !== undefined) validateVisibility(args.visibility);
    if (args.ttlSeconds !== undefined) validateTtlSeconds(args.ttlSeconds);

    // ── 2. Resolve foreign keys ─────────────────────────────
    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error(`room ${args.roomId} not found`);
    if (room.palaceId !== args.palaceId) {
      throw new Error("room.palaceId mismatch with provided palaceId");
    }

    // ── 3. Compute source-level dedupKey ───────────────────
    // Does NOT include content. Same (adapter, externalId) always produces
    // the same dedupKey, so content updates produce versions, not duplicates.
    const dedupKey = await computeDedupKey(
      args.sourceAdapter,
      args.sourceExternalId,
    );

    // ── 4. Check for prior versions in this palace ──────────
    const priors = await ctx.db
      .query("closets")
      .withIndex("by_dedup", (q) =>
        q.eq("palaceId", args.palaceId).eq("dedupKey", dedupKey),
      )
      .collect();

    // The "head" prior is the one without supersededBy; collisions in the
    // race window will cause Convex OCC to retry one of the writes, at which
    // point this query sees the now-existing row and we noop.
    const head = priors.find((p) => p.supersededBy === undefined);

    // ── 5. Idempotency: whitespace-normalized content match => noop ──
    if (head && normalizeContent(head.content) === normalizeContent(args.content)) {
      return { status: "noop", closetId: head._id, version: head.version };
    }

    // ── 6. Apply category default TTL if not specified ──────
    const ttlSeconds =
      args.ttlSeconds ?? CATEGORY_TTL_DEFAULTS[args.category as Category];

    const now = Date.now();
    const newVersion = head ? head.version + 1 : 1;

    // ── 7. Insert new closet ────────────────────────────────
    const closetId = await ctx.db.insert("closets", {
      roomId: args.roomId,
      hallId: room.hallId,
      wingId: room.wingId,
      palaceId: args.palaceId,
      content: args.content,
      title: args.title,
      category: args.category as Category,
      // Cast through unknown because Convex's union literals are stricter than
      // string at the type level; we've validated the value above.
      sourceType: args.sourceType as Doc<"closets">["sourceType"],
      sourceRef: args.sourceRef,
      sourceAdapter: args.sourceAdapter,
      sourceExternalId: args.sourceExternalId,
      authorType: args.authorType as Doc<"closets">["authorType"],
      authorId: args.authorId,
      version: newVersion,
      supersedes: head?._id,
      schemaVersion: 1,
      confidence: args.confidence,
      needsReview: args.needsReview ?? false,
      createdAt: now,
      updatedAt: now,
      ttlSeconds,
      decayed: false,
      retracted: false,
      legalHold: false,
      piiTags: args.piiTags ?? [],
      visibility: (args.visibility ?? "default") as Doc<"closets">["visibility"],
      embeddingStatus: "pending",
      graphitiStatus: "pending",
      dedupKey,
    });

    // ── 8. Wire the supersession chain (atomic with insert) ─
    if (head) {
      await safePatchCloset(ctx, head._id, { supersededBy: closetId });
    }

    // ── 9. Counter denormalization ──────────────────────────
    await safePatchRoom(ctx, args.roomId, {
      closetCount: room.closetCount + 1,
      lastUpdated: now,
    });

    return {
      status: head ? "versioned" : "created",
      closetId,
      version: newVersion,
    };
  },
});

export const retractCloset = mutation({
  args: {
    closetId: v.id("closets"),
    reason: v.string(),
    retractedBy: v.string(),
  },
  handler: async (ctx, { closetId, reason, retractedBy }) => {
    const closet = await ctx.db.get(closetId);
    if (!closet) throw new Error(`closet ${closetId} not found`);
    if (closet.legalHold) {
      throw new Error(`closet ${closetId} is under legal hold; cannot retract`);
    }
    if (closet.retracted) {
      // Idempotent: already retracted.
      return { status: "noop" as const, closetId };
    }

    // Replace content with tombstone. NOTE: for true GDPR erasure, content
    // must be unrecoverable — we overwrite, and we delete the embedding row
    // so semantic search can't surface the original meaning.
    await ctx.db.patch(closetId, {
      content: "[REDACTED]",
      title: undefined,
      retracted: true,
      updatedAt: Date.now(),
    });

    // Defense in depth (Tier 1 fix): drop the embedding so vector search
    // cannot surface the original semantic content.
    const emb = await ctx.db
      .query("closet_embeddings")
      .withIndex("by_closet", (q) => q.eq("closetId", closetId))
      .first();
    if (emb) await ctx.db.delete(emb._id);

    // Decrement room counter so L1 wing index reflects visible closets.
    const room = await ctx.db.get(closet.roomId);
    if (room && room.closetCount > 0) {
      await safePatchRoom(ctx, closet.roomId, {
        closetCount: room.closetCount - 1,
        lastUpdated: Date.now(),
      });
    }

    // Audit trail (caller should also write an explicit audit_event with op=retract).
    return {
      status: "ok" as const,
      closetId,
      reason: reason.slice(0, 200),
      retractedBy,
    };
  },
});

export const decayCloset = mutation({
  args: { closetId: v.id("closets") },
  handler: async (ctx, { closetId }) => {
    await safePatchCloset(ctx, closetId, {
      decayed: true,
      updatedAt: Date.now(),
    });
  },
});

export const setLegalHold = mutation({
  args: { closetId: v.id("closets"), hold: v.boolean() },
  handler: async (ctx, { closetId, hold }) => {
    await safePatchCloset(ctx, closetId, {
      legalHold: hold,
      updatedAt: Date.now(),
    });
  },
});

export const setEmbeddingStatus = internalMutation({
  args: {
    closetId: v.id("closets"),
    status: v.string(),
  },
  handler: async (ctx, { closetId, status }) => {
    await safePatchCloset(ctx, closetId, {
      embeddingStatus: status as Doc<"closets">["embeddingStatus"],
    });
  },
});

export const setGraphitiStatus = internalMutation({
  args: {
    closetId: v.id("closets"),
    status: v.string(),
  },
  handler: async (ctx, { closetId, status }) => {
    await safePatchCloset(ctx, closetId, {
      graphitiStatus: status as Doc<"closets">["graphitiStatus"],
    });
  },
});

// ─────────────────────────────────────────────────────────────────
// DRAWERS
// ─────────────────────────────────────────────────────────────────

export const createDrawer = mutation({
  args: {
    closetId: v.id("closets"),
    palaceId: v.id("palaces"),
    fact: v.string(),
    validFrom: v.number(),
    confidence: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"drawers">> => {
    validateNonEmpty(args.fact, "fact");
    validateConfidence(args.confidence);

    const closet = await ctx.db.get(args.closetId);
    if (!closet) throw new Error(`closet ${args.closetId} not found`);
    if (closet.palaceId !== args.palaceId) {
      throw new Error("closet.palaceId mismatch");
    }

    return await ctx.db.insert("drawers", {
      closetId: args.closetId,
      roomId: closet.roomId,
      palaceId: args.palaceId,
      fact: args.fact,
      validFrom: args.validFrom,
      confidence: args.confidence,
    });
  },
});

export const invalidateDrawer = mutation({
  args: {
    drawerId: v.id("drawers"),
    supersededBy: v.optional(v.id("drawers")),
  },
  handler: async (ctx, { drawerId, supersededBy }) => {
    const drawer = await ctx.db.get(drawerId);
    if (!drawer) throw new Error(`drawer ${drawerId} not found`);

    await ctx.db.patch(drawerId, {
      validUntil: Date.now(),
      supersededBy,
    });
  },
});

// ─────────────────────────────────────────────────────────────────
// TUNNELS
// ─────────────────────────────────────────────────────────────────

export const createTunnel = mutation({
  args: {
    palaceId: v.id("palaces"),
    fromRoomId: v.id("rooms"),
    toRoomId: v.id("rooms"),
    relationship: v.string(),
    strength: v.number(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"tunnels">> => {
    validateTunnelRelationship(args.relationship);
    validateStrength(args.strength);

    if (args.fromRoomId === args.toRoomId) {
      throw new Error("tunnel cannot connect a room to itself");
    }

    const fromRoom = await ctx.db.get(args.fromRoomId);
    const toRoom = await ctx.db.get(args.toRoomId);
    if (!fromRoom) throw new Error(`fromRoom ${args.fromRoomId} not found`);
    if (!toRoom) throw new Error(`toRoom ${args.toRoomId} not found`);

    // Cross-palace isolation: both rooms must belong to the same palace,
    // and that palace must match the provided palaceId.
    if (fromRoom.palaceId !== args.palaceId || toRoom.palaceId !== args.palaceId) {
      throw new Error("cross-palace tunnels are forbidden");
    }

    return await ctx.db.insert("tunnels", {
      palaceId: args.palaceId,
      fromRoomId: args.fromRoomId,
      toRoomId: args.toRoomId,
      relationship: args.relationship as Doc<"tunnels">["relationship"],
      strength: args.strength,
      createdAt: Date.now(),
      label: args.label,
    });
  },
});

// ─────────────────────────────────────────────────────────────────
// ROOM MERGE (admin — moves all closets from source to target, deletes source)
// ─────────────────────────────────────────────────────────────────

export const mergeRooms = mutation({
  args: {
    palaceId: v.id("palaces"),
    sourceRoomId: v.id("rooms"),
    targetRoomId: v.id("rooms"),
  },
  handler: async (ctx, args) => {
    if (args.sourceRoomId === args.targetRoomId) {
      throw new Error("cannot merge a room into itself");
    }

    const source = await ctx.db.get(args.sourceRoomId);
    const target = await ctx.db.get(args.targetRoomId);
    if (!source) throw new Error(`source room ${args.sourceRoomId} not found`);
    if (!target) throw new Error(`target room ${args.targetRoomId} not found`);
    if (source.palaceId !== args.palaceId || target.palaceId !== args.palaceId) {
      throw new Error("both rooms must belong to the same palace");
    }

    // Move all closets from source to target.
    const closets = await ctx.db
      .query("closets")
      .withIndex("by_room", (q) => q.eq("roomId", args.sourceRoomId))
      .collect();

    let moved = 0;
    for (const closet of closets) {
      await ctx.db.patch(closet._id, {
        roomId: args.targetRoomId,
        hallId: target.hallId,
        wingId: target.wingId,
      });
      moved++;
    }

    // Move drawers.
    const drawers = await ctx.db
      .query("drawers")
      .withIndex("by_room", (q) => q.eq("roomId", args.sourceRoomId))
      .collect();
    for (const drawer of drawers) {
      await ctx.db.patch(drawer._id, { roomId: args.targetRoomId });
    }

    // Update tunnels referencing source → point to target.
    const tunnelsFrom = await ctx.db
      .query("tunnels")
      .withIndex("by_palace_from", (q) =>
        q.eq("palaceId", args.palaceId).eq("fromRoomId", args.sourceRoomId),
      )
      .collect();
    for (const t of tunnelsFrom) {
      if (t.toRoomId === args.targetRoomId) {
        await ctx.db.delete(t._id); // Self-loop after merge → delete.
      } else {
        await ctx.db.patch(t._id, { fromRoomId: args.targetRoomId });
      }
    }

    const tunnelsTo = await ctx.db
      .query("tunnels")
      .withIndex("by_palace_to", (q) =>
        q.eq("palaceId", args.palaceId).eq("toRoomId", args.sourceRoomId),
      )
      .collect();
    for (const t of tunnelsTo) {
      if (t.fromRoomId === args.targetRoomId) {
        await ctx.db.delete(t._id);
      } else {
        await ctx.db.patch(t._id, { toRoomId: args.targetRoomId });
      }
    }

    // Update target room counts.
    await safePatchRoom(ctx, args.targetRoomId, {
      closetCount: target.closetCount + moved,
      lastUpdated: Date.now(),
    });

    // Update source wing/hall counts (decrement).
    const sourceHall = await ctx.db.get(source.hallId);
    const sourceWing = await ctx.db.get(source.wingId);
    if (sourceHall && sourceHall.roomCount > 0) {
      await safePatchHall(ctx, source.hallId, { roomCount: sourceHall.roomCount - 1 });
    }
    if (sourceWing && sourceWing.roomCount > 0) {
      await safePatchWing(ctx, source.wingId, { roomCount: sourceWing.roomCount - 1 });
    }

    // Delete source room.
    await ctx.db.delete(args.sourceRoomId);

    return { merged: moved, closetsMoved: moved, drawersMoved: drawers.length, sourceDeleted: true };
  },
});

// ─────────────────────────────────────────────────────────────────
// EMBEDDINGS (Phase 3 hooks; usable in Phase 1 for tests)
// ─────────────────────────────────────────────────────────────────

export const storeEmbedding = mutation({
  args: {
    closetId: v.id("closets"),
    palaceId: v.id("palaces"),
    embedding: v.array(v.float64()),
    model: v.string(),
    modelVersion: v.string(),
  },
  handler: async (ctx, args) => {
    // Dimension check — must match schema vectorIndex dimensions.
    // Qwen3-Embedding-8B: 4096 dims.
    const EXPECTED_DIMS = 4096;
    if (args.embedding.length !== EXPECTED_DIMS) {
      throw new Error(
        `embedding must be ${EXPECTED_DIMS}-dim, got ${args.embedding.length}`,
      );
    }
    const closet = await ctx.db.get(args.closetId);
    if (!closet) throw new Error(`closet ${args.closetId} not found`);
    if (closet.palaceId !== args.palaceId) throw new Error("closet.palaceId mismatch");

    // Idempotent on closetId.
    const existing = await ctx.db
      .query("closet_embeddings")
      .withIndex("by_closet", (q) => q.eq("closetId", args.closetId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        embedding: args.embedding,
        model: args.model,
        modelVersion: args.modelVersion,
        generatedAt: Date.now(),
      });
      // Tier 1 fix (Issue C): also update embeddingStatus on re-embed.
      // Without this, a closet at "failed" stays "failed" even after
      // a successful re-embedding.
      await safePatchCloset(ctx, args.closetId, {
        embeddingStatus: "generated",
      });
      return existing._id;
    }

    const embId = await ctx.db.insert("closet_embeddings", {
      closetId: args.closetId,
      palaceId: args.palaceId,
      wingId: closet.wingId,
      embedding: args.embedding,
      model: args.model,
      modelVersion: args.modelVersion,
      generatedAt: Date.now(),
    });

    await safePatchCloset(ctx, args.closetId, {
      embeddingStatus: "generated",
    });

    return embId;
  },
});

// ─────────────────────────────────────────────────────────────────
// NEOP PERMISSIONS (idempotent upsert for seed)
// ─────────────────────────────────────────────────────────────────

export const upsertNeopPermissions = mutation({
  args: {
    palaceId: v.id("palaces"),
    neopId: v.string(),
    parentNeopId: v.optional(v.string()),
    runtimeOps: v.array(v.string()),
    contentAccess: v.string(),
    scopeWing: v.optional(v.string()),
    scopeRoom: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"neop_permissions">> => {
    validateNonEmpty(args.neopId, "neopId");
    validateRuntimeOps(args.runtimeOps);
    validateContentAccess(args.contentAccess);

    const existing = await ctx.db
      .query("neop_permissions")
      .withIndex("by_palace_neop", (q) =>
        q.eq("palaceId", args.palaceId).eq("neopId", args.neopId),
      )
      .first();

    const fields = {
      palaceId: args.palaceId,
      neopId: args.neopId,
      parentNeopId: args.parentNeopId,
      runtimeOps: args.runtimeOps,
      contentAccess: args.contentAccess,
      scopeWing: args.scopeWing,
      scopeRoom: args.scopeRoom,
    };

    if (existing) {
      await ctx.db.replace(existing._id, fields);
      return existing._id;
    }

    return await ctx.db.insert("neop_permissions", fields);
  },
});

// ─────────────────────────────────────────────────────────────────
// HELPER: list all standard halls to scaffold per wing
// ─────────────────────────────────────────────────────────────────

export const STANDARD_HALL_TYPES = HALL_TYPES;
