// Access control enforcement module.
//
// Called by the HTTP dispatch layer (convex/http.ts) before every tool call.
// NOT called by internal code paths (scripts, crons, ingestion actions) —
// those are trusted system operations.
//
// Three layers:
//   1. Runtime ops: can this NEop call this operation? (recall/remember/promote/erase/audit)
//   2. Content access: can this NEop read/write this (wing, category)?
//   3. Scope binding: is this NEop restricted to a specific wing/room?
//
// Tier 1 fixes from ultrathink:
//   - Missing wing entry = implicit deny (not implicit allow)
//   - Scoped instances resolve content access from parentNeopId
//   - Scope bindings block conflicting filters (not just inject defaults)

import type { Id, Doc } from "../_generated/dataModel.js";
import { ADMIN_NEOP_ID, SYSTEM_NEOP_ID } from "../lib/enums.js";

// ─── Types ──────────────────────────────────────────────────────

export class AccessDenied extends Error {
  constructor(
    public readonly neopId: string,
    public readonly detail: string,
  ) {
    super(`access_denied: ${neopId} — ${detail}`);
    this.name = "AccessDenied";
  }
}

export interface ResolvedPermissions {
  neopId: string;
  effectiveNeopId: string; // parent if scoped, self otherwise
  runtimeOps: string[];
  contentAccess: Record<string, { read: "*" | string[]; write: "*" | string[] }>;
  scopeWing: string | null;
  scopeRoom: string | null;
  isAdmin: boolean;
}

// ─── Permission resolution ──────────────────────────────────────

/**
 * Resolve full permissions for a neopId. Handles:
 *   - _admin bypass
 *   - Scoped instances → resolve content access from parent
 *   - Missing neopId → deny all
 */
export async function resolvePermissions(
  ctx: { db: any },
  palaceId: Id<"palaces">,
  neopId: string,
): Promise<ResolvedPermissions> {
  // Admin bypass.
  if (neopId === ADMIN_NEOP_ID) {
    return {
      neopId: "_admin",
      effectiveNeopId: "_admin",
      runtimeOps: ["recall", "remember", "promote", "erase", "audit"],
      contentAccess: {},
      scopeWing: null,
      scopeRoom: null,
      isAdmin: true,
    };
  }

  // Look up the NEop's permissions.
  const perm: Doc<"neop_permissions"> | null = await ctx.db
    .query("neop_permissions")
    .withIndex("by_palace_neop", (q: any) =>
      q.eq("palaceId", palaceId).eq("neopId", neopId),
    )
    .first();

  if (!perm) {
    throw new AccessDenied(neopId, "unknown neopId — no permissions found");
  }

  // If this is a scoped instance, resolve content access from parent.
  let contentAccessJson = perm.contentAccess;
  const effectiveNeopId = perm.parentNeopId ?? neopId;

  if (perm.parentNeopId) {
    const parentPerm: Doc<"neop_permissions"> | null = await ctx.db
      .query("neop_permissions")
      .withIndex("by_palace_neop", (q: any) =>
        q.eq("palaceId", palaceId).eq("neopId", perm.parentNeopId),
      )
      .first();

    if (parentPerm) {
      contentAccessJson = parentPerm.contentAccess;
    }
    // If parent not found, fall back to instance's own content access.
  }

  let contentAccess: Record<string, { read: "*" | string[]; write: "*" | string[] }>;
  try {
    contentAccess = JSON.parse(contentAccessJson);
  } catch {
    contentAccess = {};
  }

  return {
    neopId,
    effectiveNeopId,
    runtimeOps: perm.runtimeOps,
    contentAccess,
    scopeWing: perm.scopeWing ?? null,
    scopeRoom: perm.scopeRoom ?? null,
    isAdmin: false,
  };
}

// B2 (docs/decisions/twin-keying.md) — identity WITHOUT memory capabilities. A validly-named seat HAS an
// identity (its neopId) even with no neop_permissions row; it just holds no runtime ops. Used for twin
// ops (identity self-access): the seat reaches its OWN twin without a perms row, while memory/content
// tools still deny via enforceRuntimeOp (empty runtimeOps). Never grants an op; never elevates to admin.
// The exact-own-twin bound lives in getTwin/putTwin (`q.eq("neopId", neopId)`, server-derived neopId).
export function identityOnlyPerms(neopId: string): ResolvedPermissions {
  return {
    neopId,
    effectiveNeopId: neopId,
    runtimeOps: [],
    contentAccess: {},
    scopeWing: null,
    scopeRoom: null,
    isAdmin: false,
  };
}

// ─── Runtime op check ───────────────────────────────────────────

export function hasRuntimeOp(perms: ResolvedPermissions, op: string): boolean {
  if (perms.isAdmin) return true;
  return perms.runtimeOps.includes(op);
}

export function enforceRuntimeOp(perms: ResolvedPermissions, op: string): void {
  if (!hasRuntimeOp(perms, op)) {
    throw new AccessDenied(
      perms.neopId,
      `cannot call "${op}" — allowed ops: [${perms.runtimeOps.join(", ")}]`,
    );
  }
}

// ─── Content access check ───────────────────────────────────────

export function canReadCategory(
  perms: ResolvedPermissions,
  wing: string,
  category: string,
): boolean {
  if (perms.isAdmin) return true;

  const wingAccess = perms.contentAccess[wing];
  if (!wingAccess) return false; // Missing wing = implicit deny.

  const { read } = wingAccess;
  if (read === "*") return true;
  if (Array.isArray(read)) return read.includes(category);
  return false;
}

export function canWriteCategory(
  perms: ResolvedPermissions,
  wing: string,
  category: string,
): boolean {
  if (perms.isAdmin) return true;

  const wingAccess = perms.contentAccess[wing];
  if (!wingAccess) return false; // Missing wing = implicit deny.

  const { write } = wingAccess;
  if (write === "*") return true;
  if (Array.isArray(write)) return write.includes(category);
  return false;
}

export function enforceRead(
  perms: ResolvedPermissions,
  wing: string,
  category: string,
): void {
  if (!canReadCategory(perms, wing, category)) {
    throw new AccessDenied(
      perms.neopId,
      `cannot read category "${category}" in wing "${wing}"`,
    );
  }
}

export function enforceWrite(
  perms: ResolvedPermissions,
  wing: string,
  category: string,
): void {
  if (!canWriteCategory(perms, wing, category)) {
    throw new AccessDenied(
      perms.neopId,
      `cannot write category "${category}" to wing "${wing}"`,
    );
  }
}

// ─── Scope enforcement ──────────────────────────────────────────

/**
 * Check if a target wing/room is within the NEop's scope.
 * If no scope binding exists, all wings/rooms are allowed
 * (subject to content access checks).
 */
export function enforceScope(
  perms: ResolvedPermissions,
  targetWing?: string,
  targetRoom?: string,
): void {
  if (perms.isAdmin) return;
  if (!perms.scopeWing) return; // No scope binding → unrestricted.

  if (targetWing && targetWing !== perms.scopeWing) {
    throw new AccessDenied(
      perms.neopId,
      `scoped to wing "${perms.scopeWing}" — cannot access wing "${targetWing}"`,
    );
  }

  if (perms.scopeRoom && targetRoom && targetRoom !== perms.scopeRoom) {
    throw new AccessDenied(
      perms.neopId,
      `scoped to room "${perms.scopeWing}/${perms.scopeRoom}" — cannot access room "${targetRoom}"`,
    );
  }
}

/**
 * Apply scope to search filters. Returns the effective wingFilter.
 *
 * Rules:
 *   - No scope → return caller's wingFilter as-is
 *   - Scope exists, no caller filter → inject scope wing
 *   - Scope exists, caller filter matches → allow
 *   - Scope exists, caller filter conflicts → throw
 */
export function applyScopeToFilter(
  perms: ResolvedPermissions,
  callerWingFilter?: string,
): string | undefined {
  if (perms.isAdmin) return callerWingFilter;
  if (!perms.scopeWing) return callerWingFilter;

  if (!callerWingFilter) return perms.scopeWing;

  if (callerWingFilter !== perms.scopeWing) {
    throw new AccessDenied(
      perms.neopId,
      `scoped to wing "${perms.scopeWing}" — cannot filter by "${callerWingFilter}"`,
    );
  }

  return callerWingFilter; // Matches scope — allow.
}

// ─── Utility: filter search results by read permission ──────────

/**
 * Filter an array of search results, keeping only those the NEop
 * can read. Silently drops inaccessible results (no error per result).
 */
export function filterByReadAccess<T extends { wingName: string; category: string }>(
  perms: ResolvedPermissions,
  results: T[],
): T[] {
  if (perms.isAdmin) return results;
  return results.filter((r) => canReadCategory(perms, r.wingName, r.category));
}

// ─── Utility: map tool name to required runtime op ──────────────

const TOOL_TO_OP: Record<string, string> = {
  // Read ops → recall
  palace_recall: "recall",
  palace_search: "recall",
  palace_search_temporal: "recall",
  palace_status: "recall",
  palace_list_wings: "recall",
  palace_list_rooms: "recall",
  palace_get_room: "recall",
  palace_walk_tunnel: "recall",
  palace_stats: "recall",
  palace_get_paused_run: "recall",

  // Write ops → remember
  palace_remember: "remember",
  palace_save_paused_run: "remember",
  palace_resolve_paused_run: "remember",
  palace_add_closet: "remember",
  palace_add_drawer: "remember",
  palace_create_room: "remember",
  palace_create_tunnel: "remember",
  palace_create_wing: "remember",

  // Maintenance
  palace_invalidate: "remember",
  palace_retract_closet: "erase",
  palace_merge_rooms: "erase",

  // Meta
  palace_export: "recall",

  // NOTE: palace_get_twin / palace_put_twin are DELIBERATELY ABSENT (B2, docs/decisions/twin-keying.md).
  // The twin is IDENTITY, not memory — reading/writing your own self-model is self-access by *being* that
  // identity, categorically different from recall/remember (memory of stored facts). So twin ops are NOT
  // gated by a memory op. A twin op can only ever touch the twin at its own request neopId (getTwin/putTwin
  // key by an exact `q.eq("neopId", neopId)` — no prefix, no wildcard), and neopId is the server-derived
  // requester (edge-auth E1–E5, unforgeable). Cross-user isolation rests on that exact server-derived key,
  // NOT on the recall/remember gate (which only checked "does this seat do memory", never twin ownership).
};

export function runtimeOpForTool(tool: string): string | null {
  return TOOL_TO_OP[tool] ?? null;
}

// ─── Seat isolation: per-room ownership (Phase 1 ACL) ────────────
//
// A room carries an optional `ownerNeopId`:
//   - set   → PERSONAL room, owned by that seat (neopId).
//   - unset → shared COMPANY room (all legacy rooms + admin-created).
//
// read-scope ⊇ write-scope (S3 §3.2.1), two SEPARATE predicates:
//   • assertNeopScope     (WRITE) — a scoped seat may write ONLY its own room.
//   • assertNeopReadScope (READ)  — a scoped seat may read its own room OR any
//                                   company room; a room owned by ANOTHER seat is denied.
//
// IDENTITY POSTURE (Phase 1, honest-caller): neopId is the caller's DECLARED seat —
// there is no signed per-seat credential yet (http.ts resolves `body.neopId ?? header
// ?? _admin`). This is adequate for cooperating seats inside ONE tenant (the V2-alpha
// threat model: prevent accidental cross-seat contamination, NOT defend against a
// forged neopId). Cryptographic per-seat identity (signed X-NEop-Identity) is DEFERRED
// to the multi-tenant / adversarial phase. Do not present Phase 1 isolation as
// defense against a malicious seat that lies about its neopId.

/** Minimal shape needed to decide room scope — just the ownership field. */
export interface RoomScope {
  ownerNeopId?: string | null;
}

/** True iff this seat owns the room (a personal room keyed to it). */
export function ownsRoom(perms: ResolvedPermissions, room: RoomScope): boolean {
  return !!room.ownerNeopId && room.ownerNeopId === perms.effectiveNeopId;
}

/** True iff the room is a shared company room (no owner). */
export function isCompanyRoom(room: RoomScope): boolean {
  return room.ownerNeopId === undefined || room.ownerNeopId === null;
}

/** READ scope: own room OR any company room. Another seat's room → false. */
export function canReadRoom(perms: ResolvedPermissions, room: RoomScope): boolean {
  if (perms.isAdmin) return true;
  return ownsRoom(perms, room) || isCompanyRoom(room);
}

/** WRITE scope: own room ONLY. Company rooms are read-only for a scoped seat. */
export function canWriteRoom(perms: ResolvedPermissions, room: RoomScope): boolean {
  if (perms.isAdmin) return true;
  return ownsRoom(perms, room);
}

/** Throwing WRITE guard — a scoped seat may write only its own room. */
export function assertNeopScope(perms: ResolvedPermissions, room: RoomScope): void {
  if (!canWriteRoom(perms, room)) {
    const owner = room.ownerNeopId ?? "(company)";
    throw new AccessDenied(
      perms.neopId,
      `cannot write to room owned by "${owner}" — writes are restricted to this seat's own room`,
    );
  }
}

/** Throwing READ guard — a scoped seat may read its own room or a company room. */
export function assertNeopReadScope(perms: ResolvedPermissions, room: RoomScope): void {
  if (!canReadRoom(perms, room)) {
    throw new AccessDenied(
      perms.neopId,
      `cannot read room owned by "${room.ownerNeopId}" — not this seat's room`,
    );
  }
}

/** Drop rooms this seat may not read (own + company kept; other seats' dropped). */
export function filterRoomsByReadScope<T extends RoomScope>(
  perms: ResolvedPermissions,
  rooms: T[],
): T[] {
  if (perms.isAdmin) return rooms;
  return rooms.filter((r) => canReadRoom(perms, r));
}

// ─── Layer 1: SoT-side independent enforcement (defense in depth) ────────────
//
// The room-mutating Convex mutations enforce seat write-scope THEMSELVES when handed
// a caller identity (`actorNeopId`), independent of the /mcp dispatch guards (Layer 3).
// This holds the isolation invariant even if a write reaches a mutation WITHOUT going
// through dispatch — the deepest independence proof — and contains bugs (a dispatch path
// that forgets to guard).
//
// Semantics of `actorNeopId`:
//   • undefined → TRUSTED internal caller: no check. *** PHASE A (current) ***
//       This is the LEGACY fail-OPEN contract. It flips to DENY in PHASE B once every
//       internal write path passes an explicit actor and the completeness guard
//       (tests/actor_coverage.test.ts) is green. DO NOT rely on undefined for new code —
//       trusted internal paths must pass SYSTEM_NEOP_ID ("_system") instead.
//   • "_system" → TRUSTED internal actor (crons, ingestion pipeline, seed scripts): no
//       check. An ELEVATED identity, never derivable from request input, always audited.
//       Same family as "_admin". This is the EXPLICIT, Phase-B-safe form of the trusted
//       internal caller — it survives the undefined⇒DENY flip.
//   • "_admin"  → bypass.
//   • a seat    → must own the room to write; may read own + company rooms.
//
// PHASE A is ADDITIVE: undefined is STILL trusted; "_system" is allowed ALONGSIDE it. No
// existing caller changes behavior. PHASE B (the breaking flip: undefined ⇒ DENY) is gated
// on the completeness guard proving zero remaining undefined-relying internal callers.
//
// HONEST-CALLER posture (same as the rest of Phase 1): `actorNeopId` is DECLARED by the
// caller, not cryptographically authenticated. A malicious direct caller could omit it;
// this layer defends against accidental cross-seat writes and dispatch-bypass bugs, NOT a
// forged identity. Signed per-seat identity is deferred to the multi-tenant/adversarial phase.

export function assertActorCanWriteRoom(
  actorNeopId: string | undefined,
  room: RoomScope,
): void {
  // Phase B (FAIL-CLOSED): omission no longer means trust. A server-minted caller MUST pass an
  // explicit actor — `_system` for trusted internal paths, `_admin` for admin, or a seat. This is
  // safe because #2 made the dispatch thread `_admin` (never undefined) and the actor_coverage guard
  // proves no source call site omits the actor; the flip only denies a direct call that omits it.
  if (actorNeopId === undefined) {
    throw new AccessDenied("(unspecified)", "SoT fail-closed: a guarded write requires an explicit actorNeopId");
  }
  if (actorNeopId === SYSTEM_NEOP_ID) return;   // trusted internal actor (elevated)
  if (actorNeopId === ADMIN_NEOP_ID) return;    // admin bypass
  if (!(room.ownerNeopId && room.ownerNeopId === actorNeopId)) {
    throw new AccessDenied(
      actorNeopId,
      `SoT write-scope: room owned by "${room.ownerNeopId ?? "(company)"}" is not seat "${actorNeopId}"'s room`,
    );
  }
}

export function assertActorCanReadRoom(
  actorNeopId: string | undefined,
  room: RoomScope,
): void {
  // Phase B (FAIL-CLOSED) — see assertActorCanWriteRoom. Omission no longer means trust.
  if (actorNeopId === undefined) {
    throw new AccessDenied("(unspecified)", "SoT fail-closed: a guarded read requires an explicit actorNeopId");
  }
  if (actorNeopId === SYSTEM_NEOP_ID) return;   // trusted internal actor (elevated)
  if (actorNeopId === ADMIN_NEOP_ID) return;    // admin bypass
  const own = !!room.ownerNeopId && room.ownerNeopId === actorNeopId;
  const company = room.ownerNeopId === undefined || room.ownerNeopId === null;
  if (!(own || company)) {
    throw new AccessDenied(
      actorNeopId,
      `SoT read-scope: room owned by "${room.ownerNeopId}" is not readable by seat "${actorNeopId}"`,
    );
  }
}
