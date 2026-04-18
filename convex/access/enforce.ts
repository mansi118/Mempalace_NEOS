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

import type { GenericQueryCtx } from "convex/server";
import type { Id, Doc } from "../_generated/dataModel.js";
import type { DataModel } from "../_generated/dataModel.js";

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
  if (neopId === "_admin") {
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

  // Write ops → remember
  palace_remember: "remember",
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
};

export function runtimeOpForTool(tool: string): string | null {
  return TOOL_TO_OP[tool] ?? null;
}
