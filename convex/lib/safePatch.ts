// Append-only enforcement for closets and drawers (Tier 1 fix).
//
// Direct ctx.db.patch on closets is forbidden by convention. All closet
// modifications must go through these helpers, which whitelist the
// fields that can change after creation.
//
// To enforce in code review: grep for "ctx.db.patch" inside files that touch
// closets and ensure each call site is one of these helpers.

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";

const ALLOWED_CLOSET_PATCH_FIELDS = new Set([
  "decayed",
  "retracted",
  "legalHold",
  "supersededBy",
  "needsReview",
  "conflictGroupId",
  "embeddingStatus",
  "graphitiStatus",
  "updatedAt",
  "entitiesExtracted",
  "entitiesCount",
  "relationsCount",
]);

const ALLOWED_DRAWER_PATCH_FIELDS = new Set([
  "validUntil",
  "supersededBy",
  "graphitiNodeId",
]);

const ALLOWED_ROOM_PATCH_FIELDS = new Set([
  "summary",
  "tags",
  "closetCount",
  "lastUpdated",
]);

const ALLOWED_WING_PATCH_FIELDS = new Set([
  "description",
  "roomCount",
  "lastActivity",
  "archived",
  "phase",
]);

const ALLOWED_HALL_PATCH_FIELDS = new Set(["roomCount"]);

const ALLOWED_PALACE_PATCH_FIELDS = new Set([
  "name",
  "status",
  "l0_briefing",
  "l1_wing_index",
  "schemaVersion",
]);

export class ImmutableFieldError extends Error {
  constructor(table: string, field: string) {
    super(`field "${field}" is immutable on ${table}; use a versioned update instead`);
    this.name = "ImmutableFieldError";
  }
}

function assertAllowed(
  table: string,
  fields: Record<string, unknown>,
  allowed: Set<string>,
): void {
  for (const k of Object.keys(fields)) {
    if (!allowed.has(k)) throw new ImmutableFieldError(table, k);
  }
}

export async function safePatchCloset(
  ctx: MutationCtx,
  id: Id<"closets">,
  fields: Partial<Doc<"closets">>,
): Promise<void> {
  assertAllowed("closets", fields, ALLOWED_CLOSET_PATCH_FIELDS);
  await ctx.db.patch(id, fields);
}

export async function safePatchDrawer(
  ctx: MutationCtx,
  id: Id<"drawers">,
  fields: Partial<Doc<"drawers">>,
): Promise<void> {
  assertAllowed("drawers", fields, ALLOWED_DRAWER_PATCH_FIELDS);
  await ctx.db.patch(id, fields);
}

export async function safePatchRoom(
  ctx: MutationCtx,
  id: Id<"rooms">,
  fields: Partial<Doc<"rooms">>,
): Promise<void> {
  assertAllowed("rooms", fields, ALLOWED_ROOM_PATCH_FIELDS);
  await ctx.db.patch(id, fields);
}

export async function safePatchWing(
  ctx: MutationCtx,
  id: Id<"wings">,
  fields: Partial<Doc<"wings">>,
): Promise<void> {
  assertAllowed("wings", fields, ALLOWED_WING_PATCH_FIELDS);
  await ctx.db.patch(id, fields);
}

export async function safePatchHall(
  ctx: MutationCtx,
  id: Id<"halls">,
  fields: Partial<Doc<"halls">>,
): Promise<void> {
  assertAllowed("halls", fields, ALLOWED_HALL_PATCH_FIELDS);
  await ctx.db.patch(id, fields);
}

export async function safePatchPalace(
  ctx: MutationCtx,
  id: Id<"palaces">,
  fields: Partial<Doc<"palaces">>,
): Promise<void> {
  assertAllowed("palaces", fields, ALLOWED_PALACE_PATCH_FIELDS);
  await ctx.db.patch(id, fields);
}
