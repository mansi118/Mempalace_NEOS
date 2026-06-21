// Phase 7: Access control tests.
//
// Tests the enforce module logic (unit tests on the permission checker).
// These don't need a Convex backend — they test the pure functions directly.

import { describe, expect, test } from "vitest";
import {
  type ResolvedPermissions,
  hasRuntimeOp,
  canReadCategory,
  canWriteCategory,
  enforceRuntimeOp,
  enforceRead,
  enforceWrite,
  enforceScope,
  applyScopeToFilter,
  filterByReadAccess,
  runtimeOpForTool,
  AccessDenied,
  ownsRoom,
  isCompanyRoom,
  canReadRoom,
  canWriteRoom,
  assertNeopScope,
  assertNeopReadScope,
  filterRoomsByReadScope,
} from "../convex/access/enforce.js";
import { ADMIN_NEOP_ID } from "../convex/lib/enums.js";
import { convexTest } from "convex-test";
import schema from "../convex/schema.js";
import { api } from "../convex/_generated/api.js";

// ─── Test permission sets ───────────────────────────────────────

const ADMIN: ResolvedPermissions = {
  neopId: ADMIN_NEOP_ID,
  effectiveNeopId: ADMIN_NEOP_ID,
  runtimeOps: ["recall", "remember", "promote", "erase", "audit"],
  contentAccess: {},
  scopeWing: null,
  scopeRoom: null,
  isAdmin: true,
};

const ARIA: ResolvedPermissions = {
  neopId: "aria",
  effectiveNeopId: "aria",
  runtimeOps: ["recall", "remember", "promote"],
  contentAccess: {
    platform: { read: "*", write: [] },
    clients: { read: "*", write: ["conversation", "task"] },
    team: { read: "*", write: ["conversation", "task"] },
    gtm: { read: "*", write: ["task"] },
    legal: { read: ["fact"], write: [] },
    rd: { read: "*", write: [] },
    marketplace: { read: ["fact", "signal"], write: [] },
    infra: { read: ["fact", "signal"], write: [] },
    partners: { read: "*", write: [] },
    brand: { read: "*", write: [] },
    audit: { read: [], write: [] },
  },
  scopeWing: null,
  scopeRoom: null,
  isAdmin: false,
};

const NEURALCHAT: ResolvedPermissions = {
  neopId: "neuralchat",
  effectiveNeopId: "neuralchat",
  runtimeOps: ["recall"],
  contentAccess: {
    platform: { read: ["fact"], write: [] },
    clients: { read: ["fact", "conversation"], write: [] },
    team: { read: ["fact", "preference"], write: [] },
    gtm: { read: ["fact"], write: [] },
    brand: { read: "*", write: [] },
  },
  scopeWing: null,
  scopeRoom: null,
  isAdmin: false,
};

const ICD_ZOO: ResolvedPermissions = {
  neopId: "icd_zoo_media",
  effectiveNeopId: "icd",
  runtimeOps: ["recall", "remember", "promote"],
  contentAccess: {
    clients: { read: "*", write: ["fact", "decision", "task", "conversation", "lesson", "procedure"] },
    platform: { read: ["fact", "decision", "procedure"], write: [] },
    brand: { read: "*", write: [] },
  },
  scopeWing: "clients",
  scopeRoom: "zoo-media",
  isAdmin: false,
};

const FORGE: ResolvedPermissions = {
  neopId: "forge",
  effectiveNeopId: "forge",
  runtimeOps: ["recall", "remember", "promote", "erase"],
  contentAccess: {
    platform: { read: "*", write: "*" },
    rd: { read: "*", write: "*" },
    infra: { read: "*", write: "*" },
    marketplace: { read: "*", write: ["fact", "procedure"] },
    partners: { read: "*", write: [] },
  },
  scopeWing: null,
  scopeRoom: null,
  isAdmin: false,
};

// ─── Runtime op tests ───────────────────────────────────────────

describe("Runtime op enforcement", () => {
  test("admin has all ops", () => {
    expect(hasRuntimeOp(ADMIN, "recall")).toBe(true);
    expect(hasRuntimeOp(ADMIN, "erase")).toBe(true);
    expect(hasRuntimeOp(ADMIN, "audit")).toBe(true);
  });

  test("aria can recall, remember, promote but not erase", () => {
    expect(hasRuntimeOp(ARIA, "recall")).toBe(true);
    expect(hasRuntimeOp(ARIA, "remember")).toBe(true);
    expect(hasRuntimeOp(ARIA, "promote")).toBe(true);
    expect(hasRuntimeOp(ARIA, "erase")).toBe(false);
  });

  test("neuralchat is read-only", () => {
    expect(hasRuntimeOp(NEURALCHAT, "recall")).toBe(true);
    expect(hasRuntimeOp(NEURALCHAT, "remember")).toBe(false);
    expect(hasRuntimeOp(NEURALCHAT, "erase")).toBe(false);
  });

  test("enforceRuntimeOp throws on denial", () => {
    expect(() => enforceRuntimeOp(NEURALCHAT, "remember")).toThrow(AccessDenied);
    expect(() => enforceRuntimeOp(ARIA, "recall")).not.toThrow();
  });
});

// ─── Content access tests ───────────────────────────────────────

describe("Content access enforcement", () => {
  test("aria can read all categories in platform", () => {
    expect(canReadCategory(ARIA, "platform", "fact")).toBe(true);
    expect(canReadCategory(ARIA, "platform", "decision")).toBe(true);
    expect(canReadCategory(ARIA, "platform", "signal")).toBe(true);
  });

  test("aria cannot write anything to platform", () => {
    expect(canWriteCategory(ARIA, "platform", "fact")).toBe(false);
    expect(canWriteCategory(ARIA, "platform", "decision")).toBe(false);
  });

  test("aria can write conversation and task to clients", () => {
    expect(canWriteCategory(ARIA, "clients", "conversation")).toBe(true);
    expect(canWriteCategory(ARIA, "clients", "task")).toBe(true);
    expect(canWriteCategory(ARIA, "clients", "decision")).toBe(false);
    expect(canWriteCategory(ARIA, "clients", "fact")).toBe(false);
  });

  test("aria can read only fact in legal", () => {
    expect(canReadCategory(ARIA, "legal", "fact")).toBe(true);
    expect(canReadCategory(ARIA, "legal", "decision")).toBe(false);
    expect(canReadCategory(ARIA, "legal", "conversation")).toBe(false);
  });

  test("missing wing = implicit deny", () => {
    // neuralchat has no entry for legal, rd, marketplace, infra
    expect(canReadCategory(NEURALCHAT, "legal", "fact")).toBe(false);
    expect(canReadCategory(NEURALCHAT, "rd", "fact")).toBe(false);
    expect(canWriteCategory(NEURALCHAT, "legal", "fact")).toBe(false);
  });

  test("forge can write all categories to platform (wildcard)", () => {
    expect(canWriteCategory(FORGE, "platform", "fact")).toBe(true);
    expect(canWriteCategory(FORGE, "platform", "decision")).toBe(true);
    expect(canWriteCategory(FORGE, "platform", "signal")).toBe(true);
  });

  test("forge can write only fact and procedure to marketplace", () => {
    expect(canWriteCategory(FORGE, "marketplace", "fact")).toBe(true);
    expect(canWriteCategory(FORGE, "marketplace", "procedure")).toBe(true);
    expect(canWriteCategory(FORGE, "marketplace", "decision")).toBe(false);
  });

  test("enforceRead/Write throw AccessDenied", () => {
    expect(() => enforceRead(NEURALCHAT, "legal", "fact")).toThrow(AccessDenied);
    expect(() => enforceWrite(ARIA, "platform", "decision")).toThrow(AccessDenied);
    expect(() => enforceRead(ARIA, "platform", "decision")).not.toThrow();
    expect(() => enforceWrite(ARIA, "clients", "task")).not.toThrow();
  });

  test("admin bypasses all content checks", () => {
    expect(canReadCategory(ADMIN, "anything", "whatever")).toBe(true);
    expect(canWriteCategory(ADMIN, "anything", "whatever")).toBe(true);
  });
});

// ─── Scope enforcement tests ────────────────────────────────────

describe("Scope enforcement", () => {
  test("icd_zoo_media scoped to clients/zoo-media", () => {
    expect(() => enforceScope(ICD_ZOO, "clients", "zoo-media")).not.toThrow();
    expect(() => enforceScope(ICD_ZOO, "clients")).not.toThrow();
    expect(() => enforceScope(ICD_ZOO, "platform")).toThrow(AccessDenied);
    expect(() => enforceScope(ICD_ZOO, "clients", "unborred-club")).toThrow(AccessDenied);
  });

  test("unscoped NEop can access any wing", () => {
    expect(() => enforceScope(ARIA, "platform")).not.toThrow();
    expect(() => enforceScope(ARIA, "legal")).not.toThrow();
    expect(() => enforceScope(FORGE, "rd")).not.toThrow();
  });

  test("applyScopeToFilter injects scope when no filter", () => {
    expect(applyScopeToFilter(ICD_ZOO, undefined)).toBe("clients");
  });

  test("applyScopeToFilter allows matching filter", () => {
    expect(applyScopeToFilter(ICD_ZOO, "clients")).toBe("clients");
  });

  test("applyScopeToFilter rejects conflicting filter", () => {
    expect(() => applyScopeToFilter(ICD_ZOO, "platform")).toThrow(AccessDenied);
  });

  test("applyScopeToFilter passes through for unscoped", () => {
    expect(applyScopeToFilter(ARIA, "platform")).toBe("platform");
    expect(applyScopeToFilter(ARIA, undefined)).toBeUndefined();
  });
});

// ─── Result filtering tests ─────────────────────────────────────

describe("Search result filtering", () => {
  const mockResults = [
    { wingName: "platform", category: "fact", content: "NEOS uses Convex" },
    { wingName: "clients", category: "conversation", content: "Zoo Media call" },
    { wingName: "legal", category: "decision", content: "NDA template" },
    { wingName: "team", category: "preference", content: "Rahul prefers..." },
    { wingName: "rd", category: "fact", content: "Graphiti research" },
  ];

  test("admin sees all results", () => {
    const filtered = filterByReadAccess(ADMIN, mockResults);
    expect(filtered.length).toBe(5);
  });

  test("neuralchat sees only permitted results", () => {
    const filtered = filterByReadAccess(NEURALCHAT, mockResults);
    // neuralchat can read: platform/fact ✓, clients/conversation ✓,
    // legal/decision ✗ (no legal access), team/preference ✓, rd/fact ✗ (no rd)
    expect(filtered.length).toBe(3);
    expect(filtered.map((r) => r.wingName)).toEqual(["platform", "clients", "team"]);
  });

  test("icd_zoo_media sees clients + platform + brand only", () => {
    const filtered = filterByReadAccess(ICD_ZOO, mockResults);
    // icd can read: platform/fact ✓ (read: [fact, decision, procedure]),
    // clients/conversation ✓ (read: *), legal ✗, team ✗, rd ✗
    expect(filtered.length).toBe(2);
    expect(filtered.map((r) => r.wingName)).toEqual(["platform", "clients"]);
  });
});

// ─── Seat isolation: per-room ownership (Phase 1 ACL) ───────────

describe("Seat isolation — room ownership", () => {
  const ariaRoom = { ownerNeopId: "aria" };       // owned by seat aria
  const icdRoom = { ownerNeopId: "icd" };          // owned by another seat (icd)
  const companyRoom = { ownerNeopId: undefined };  // shared/legacy room, no owner

  test("ownsRoom / isCompanyRoom basics", () => {
    expect(ownsRoom(ARIA, ariaRoom)).toBe(true);
    expect(ownsRoom(ARIA, icdRoom)).toBe(false);
    expect(ownsRoom(ARIA, companyRoom)).toBe(false);   // a company room is owned by no seat
    expect(isCompanyRoom(companyRoom)).toBe(true);
    expect(isCompanyRoom(ariaRoom)).toBe(false);
  });

  test("WRITE scope: a scoped seat writes ONLY its own room", () => {
    expect(canWriteRoom(ARIA, ariaRoom)).toBe(true);
    expect(canWriteRoom(ARIA, icdRoom)).toBe(false);      // another seat's room — denied
    expect(canWriteRoom(ARIA, companyRoom)).toBe(false);  // company room is read-only for a seat
  });

  test("READ scope: own room OR company room; another seat's room denied", () => {
    expect(canReadRoom(ARIA, ariaRoom)).toBe(true);
    expect(canReadRoom(ARIA, companyRoom)).toBe(true);    // read ⊇ write — company readable
    expect(canReadRoom(ARIA, icdRoom)).toBe(false);       // cross-seat read denied
  });

  test("assertNeopScope (write) throws on cross-seat + company, allows own", () => {
    expect(() => assertNeopScope(ARIA, icdRoom)).toThrow(AccessDenied);
    expect(() => assertNeopScope(ARIA, companyRoom)).toThrow(AccessDenied);
    expect(() => assertNeopScope(ARIA, ariaRoom)).not.toThrow();
  });

  test("assertNeopReadScope (read) throws only on another seat's room", () => {
    expect(() => assertNeopReadScope(ARIA, icdRoom)).toThrow(AccessDenied);
    expect(() => assertNeopReadScope(ARIA, companyRoom)).not.toThrow();
    expect(() => assertNeopReadScope(ARIA, ariaRoom)).not.toThrow();
  });

  test("admin bypasses room scope entirely", () => {
    expect(canWriteRoom(ADMIN, icdRoom)).toBe(true);
    expect(canReadRoom(ADMIN, icdRoom)).toBe(true);
    expect(() => assertNeopScope(ADMIN, icdRoom)).not.toThrow();
  });

  test("scope keys on effectiveNeopId (parent), not the instance neopId", () => {
    // ICD_ZOO.neopId = "icd_zoo_media" but effectiveNeopId = "icd" (scoped instance).
    // Ownership must resolve to the PARENT seat, so icd-owned rooms are writable.
    expect(canWriteRoom(ICD_ZOO, icdRoom)).toBe(true);
    expect(canWriteRoom(ICD_ZOO, ariaRoom)).toBe(false);
  });

  test("filterRoomsByReadScope keeps own + company, drops other seats'", () => {
    const rooms = [ariaRoom, icdRoom, companyRoom];
    const visible = filterRoomsByReadScope(ARIA, rooms);
    expect(visible).toEqual([ariaRoom, companyRoom]);
    expect(filterRoomsByReadScope(ADMIN, rooms)).toEqual(rooms);  // admin sees all
  });
});

// ─── Tool-to-op mapping tests ───────────────────────────────────

describe("Tool to runtime op mapping", () => {
  test("search tools require recall", () => {
    expect(runtimeOpForTool("palace_recall")).toBe("recall");
    expect(runtimeOpForTool("palace_search")).toBe("recall");
    expect(runtimeOpForTool("palace_status")).toBe("recall");
  });

  test("write tools require remember", () => {
    expect(runtimeOpForTool("palace_remember")).toBe("remember");
    expect(runtimeOpForTool("palace_add_closet")).toBe("remember");
    expect(runtimeOpForTool("palace_add_drawer")).toBe("remember");
  });

  test("retract requires erase", () => {
    expect(runtimeOpForTool("palace_retract_closet")).toBe("erase");
  });

  test("unknown tool returns null", () => {
    expect(runtimeOpForTool("nonexistent_tool")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// Gate B: end-to-end seat isolation through the /mcp HTTP dispatch.
//
// Drives the REAL convex/http.ts dispatcher via convex-test's t.fetch — this
// proves the WIRING (which guard at which case), not just the pure predicates
// covered above. Every Gate B tool resolves to a Convex query/mutation (no
// actions ⇒ no network I/O), so both allow AND deny paths grade fully offline.
// ─────────────────────────────────────────────────────────────────

// Two seats + a company room, all in one "platform" wing. seat_a gets broad
// content access + all runtime ops, so the ONLY thing that can deny is the new
// per-room ownership guard — isolating Gate B from the Phase-7 content layer.
async function setupSeatPalace() {
  const t = convexTest(schema);
  const palaceId = await t.mutation(api.palace.mutations.createPalace, {
    name: "ACL Palace", clientId: "acl", falkordbGraph: "acl_graph", createdBy: "system",
  });
  const wingId = await t.mutation(api.palace.mutations.createWing, {
    palaceId, name: "platform", description: "Platform", sortOrder: 1,
  });
  const hallId = await t.mutation(api.palace.mutations.createHall, {
    wingId, palaceId, type: "facts",
  });
  const roomA = await t.mutation(api.palace.mutations.createRoom, {
    hallId, wingId, palaceId, name: "alpha", summary: "A's room", tags: [], ownerNeopId: "seat_a",
  });
  const roomCompany = await t.mutation(api.palace.mutations.createRoom, {
    hallId, wingId, palaceId, name: "shared", summary: "Company room", tags: [],
  });
  const roomB = await t.mutation(api.palace.mutations.createRoom, {
    hallId, wingId, palaceId, name: "beta", summary: "B's room", tags: [], ownerNeopId: "seat_b",
  });
  await t.mutation(api.palace.mutations.markPalaceReady, { palaceId });
  await t.run(async (ctx: any) => {
    await ctx.db.insert("neop_permissions", {
      palaceId,
      neopId: "seat_a",
      runtimeOps: ["recall", "remember", "promote", "erase", "audit"],
      contentAccess: JSON.stringify({ platform: { read: "*", write: "*" } }),
    });
  });
  return { t, palaceId, wingId, hallId, roomA, roomCompany, roomB };
}

// Seed a closet (+ drawer) inside a room, returning their ids — used to test
// one-hop closet→room and drawer→room write-guard resolution.
async function seedClosetDrawer(t: any, palaceId: string, roomId: string) {
  const r = await t.mutation(api.palace.mutations.createCloset, {
    palaceId, roomId, content: "owned by B", category: "fact",
    sourceType: "manual", sourceAdapter: "test", sourceExternalId: "b-seed",
    authorType: "system", authorId: "test", confidence: 0.9,
  });
  await t.mutation(api.palace.mutations.createDrawer, {
    closetId: r.closetId, palaceId, fact: "B fact", validFrom: 1, confidence: 0.9,
  });
  const drawers = await t.query(api.palace.queries.listDrawers, { closetId: r.closetId });
  return { closetId: r.closetId as string, drawerId: drawers[0]._id as string };
}

async function call(
  t: any, tool: string, params: Record<string, unknown>, neopId: string, palaceId: string,
) {
  const res = await t.fetch("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, params, neopId, palaceId }),
  });
  return { status: res.status, json: await res.json() };
}

describe("Gate B — seat isolation through /mcp dispatch", () => {
  // ── WRITE scope (own room only) ─────────────────────────────
  test("WRITE: seat writes its OWN room → ok", async () => {
    const { t, palaceId, roomA } = await setupSeatPalace();
    const { status, json } = await call(t, "palace_add_closet",
      { roomId: roomA, content: "A decision", category: "decision" }, "seat_a", palaceId);
    expect(status).toBe(200);
    expect(json.status).toBe("ok");
  });

  test("WRITE: seat CANNOT write another seat's room → 403", async () => {
    const { t, palaceId, roomB } = await setupSeatPalace();
    const { status, json } = await call(t, "palace_add_closet",
      { roomId: roomB, content: "sneak", category: "decision" }, "seat_a", palaceId);
    expect(status).toBe(403);
    expect(json.error).toMatch(/own room/i);
  });

  test("WRITE: seat CANNOT write a company room (read-only) → 403", async () => {
    const { t, palaceId, roomCompany } = await setupSeatPalace();
    const { status } = await call(t, "palace_add_closet",
      { roomId: roomCompany, content: "x", category: "decision" }, "seat_a", palaceId);
    expect(status).toBe(403);
  });

  // ── READ scope (own + company) ──────────────────────────────
  test("READ: seat can read its OWN room → ok", async () => {
    const { t, palaceId, roomA } = await setupSeatPalace();
    const { status } = await call(t, "palace_get_room", { roomId: roomA }, "seat_a", palaceId);
    expect(status).toBe(200);
  });

  test("READ: seat can read a COMPANY room → ok", async () => {
    const { t, palaceId, roomCompany } = await setupSeatPalace();
    const { status } = await call(t, "palace_get_room", { roomId: roomCompany }, "seat_a", palaceId);
    expect(status).toBe(200);
  });

  test("READ: seat CANNOT read another seat's room → 403", async () => {
    const { t, palaceId, roomB } = await setupSeatPalace();
    const { status } = await call(t, "palace_get_room", { roomId: roomB }, "seat_a", palaceId);
    expect(status).toBe(403);
  });

  // ── LIST filter ─────────────────────────────────────────────
  test("LIST: rooms filtered to own + company; other seat's room hidden", async () => {
    const { t, palaceId, wingId, roomA, roomCompany, roomB } = await setupSeatPalace();
    const { status, json } = await call(t, "palace_list_rooms", { wingId }, "seat_a", palaceId);
    expect(status).toBe(200);
    const ids = (json.data as any[]).map((r) => r._id);
    expect(ids).toContain(roomA);
    expect(ids).toContain(roomCompany);
    expect(ids).not.toContain(roomB);
  });

  // ── One-hop resolution: closet→room and drawer→room ─────────
  test("ERASE: seat CANNOT retract a closet in another seat's room → 403", async () => {
    const { t, palaceId, roomB } = await setupSeatPalace();
    const { closetId } = await seedClosetDrawer(t, palaceId, roomB);
    const { status } = await call(t, "palace_retract_closet",
      { closetId, reason: "nope" }, "seat_a", palaceId);
    expect(status).toBe(403);
  });

  test("WRITE: seat CANNOT add a drawer to another seat's closet → 403", async () => {
    const { t, palaceId, roomB } = await setupSeatPalace();
    const { closetId } = await seedClosetDrawer(t, palaceId, roomB);
    const { status } = await call(t, "palace_add_drawer",
      { closetId, fact: "sneak" }, "seat_a", palaceId);
    expect(status).toBe(403);
  });

  test("WRITE: seat CANNOT invalidate a drawer in another seat's room → 403", async () => {
    const { t, palaceId, roomB } = await setupSeatPalace();
    const { drawerId } = await seedClosetDrawer(t, palaceId, roomB);
    const { status } = await call(t, "palace_invalidate", { drawerId }, "seat_a", palaceId);
    expect(status).toBe(403);
  });

  // ── Multi-room writes: tunnel (own from) and merge (own both) ─
  test("TUNNEL: seat CANNOT create a tunnel FROM another seat's room → 403", async () => {
    const { t, palaceId, roomA, roomB } = await setupSeatPalace();
    const { status } = await call(t, "palace_create_tunnel",
      { fromRoomId: roomB, toRoomId: roomA, relationship: "references" }, "seat_a", palaceId);
    expect(status).toBe(403);
  });

  test("MERGE: seat CANNOT merge when it doesn't own both rooms → 403", async () => {
    const { t, palaceId, roomA, roomB } = await setupSeatPalace();
    const { status } = await call(t, "palace_merge_rooms",
      { sourceRoomId: roomB, targetRoomId: roomA }, "seat_a", palaceId);
    expect(status).toBe(403);
  });

  // ── Admin bypass ────────────────────────────────────────────
  test("ADMIN: bypasses seat isolation writing another seat's room → ok", async () => {
    const { t, palaceId, roomB } = await setupSeatPalace();
    const { status } = await call(t, "palace_add_closet",
      { roomId: roomB, content: "admin override", category: "decision" }, "_admin", palaceId);
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────
// Gate D — Layer 2 (FalkorDB/Graphiti) seat isolation. DEFERRED by decision
// 2026-06-11: the graph stays tenant-shared (one graph per palace) because
// seat-isolating it would fragment cross-seat entity resolution. This SKIPPED
// placeholder keeps the gap VISIBLE (vs silently absent) and pins the exact
// condition to assert if/when the shared-graph posture is revisited: private-wing
// content must not produce any cross-seat-traversable edge in the palace graph.
// The real assertion lives against the bridge (services/graphiti_bridge.py) and
// is gated on the live FalkorDB backend, so it is not part of the offline suite.
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// Gate A+ / L1: SoT-side INDEPENDENT enforcement. Calls the Convex mutations
// DIRECTLY (no /mcp dispatch) with an actorNeopId — proves seat isolation holds
// even when Layer 3 is bypassed (the deepest independence proof), AND that
// actorNeopId=undefined still lets trusted internal callers (crons/ingestion) through.
// ─────────────────────────────────────────────────────────────────

const closetArgs = (palaceId: string, roomId: string, actorNeopId?: string) => ({
  palaceId, roomId, content: "direct-call content", category: "decision",
  sourceType: "manual", sourceAdapter: "test", sourceExternalId: `direct-${roomId}-${actorNeopId ?? "trusted"}`,
  authorType: "system", authorId: "test", confidence: 0.8,
  ...(actorNeopId !== undefined ? { actorNeopId } : {}),
});

describe("Gate A+ — L1 SoT independent enforcement (direct mutation calls)", () => {
  test("createCloset DIRECT into another seat's room → denied (L3 bypassed)", async () => {
    const { t, palaceId, roomB } = await setupSeatPalace();
    await expect(
      t.mutation(api.palace.mutations.createCloset, closetArgs(palaceId, roomB, "seat_a") as any),
    ).rejects.toThrow(/SoT write-scope/i);
  });

  test("createCloset DIRECT into own room → allowed", async () => {
    const { t, palaceId, roomA } = await setupSeatPalace();
    const r = await t.mutation(api.palace.mutations.createCloset, closetArgs(palaceId, roomA, "seat_a") as any);
    expect(r.status).toBe("created");
  });

  test("createCloset DIRECT into a company room → denied (company is read-only for a seat)", async () => {
    const { t, palaceId, roomCompany } = await setupSeatPalace();
    await expect(
      t.mutation(api.palace.mutations.createCloset, closetArgs(palaceId, roomCompany, "seat_a") as any),
    ).rejects.toThrow(/SoT write-scope/i);
  });

  test("createCloset DIRECT with NO actorNeopId → allowed (trusted internal caller preserved)", async () => {
    const { t, palaceId, roomB } = await setupSeatPalace();
    const r = await t.mutation(api.palace.mutations.createCloset, closetArgs(palaceId, roomB) as any);
    expect(r.status).toBe("created"); // crons/ingestion still write anywhere
  });

  test("createCloset DIRECT with actorNeopId=_admin → allowed (admin bypass)", async () => {
    const { t, palaceId, roomB } = await setupSeatPalace();
    const r = await t.mutation(api.palace.mutations.createCloset, closetArgs(palaceId, roomB, "_admin") as any);
    expect(r.status).toBe("created");
  });

  test("createDrawer DIRECT into another seat's closet → denied (closet→room)", async () => {
    const { t, palaceId, roomB } = await setupSeatPalace();
    const { closetId } = await seedClosetDrawer(t, palaceId, roomB);
    await expect(
      t.mutation(api.palace.mutations.createDrawer, {
        closetId, palaceId, fact: "x", validFrom: 1, confidence: 0.9, actorNeopId: "seat_a",
      } as any),
    ).rejects.toThrow(/SoT write-scope/i);
  });

  test("invalidateDrawer DIRECT in another seat's room → denied (drawer→room)", async () => {
    const { t, palaceId, roomB } = await setupSeatPalace();
    const { drawerId } = await seedClosetDrawer(t, palaceId, roomB);
    await expect(
      t.mutation(api.palace.mutations.invalidateDrawer, { drawerId, actorNeopId: "seat_a" } as any),
    ).rejects.toThrow(/SoT write-scope/i);
  });

  test("retractCloset DIRECT in another seat's room → denied", async () => {
    const { t, palaceId, roomB } = await setupSeatPalace();
    const { closetId } = await seedClosetDrawer(t, palaceId, roomB);
    await expect(
      t.mutation(api.palace.mutations.retractCloset, {
        closetId, reason: "x", retractedBy: "seat_a", actorNeopId: "seat_a",
      } as any),
    ).rejects.toThrow(/SoT write-scope/i);
  });

  test("createTunnel DIRECT from another seat's room → denied", async () => {
    const { t, palaceId, roomA, roomB } = await setupSeatPalace();
    await expect(
      t.mutation(api.palace.mutations.createTunnel, {
        palaceId, fromRoomId: roomB, toRoomId: roomA, relationship: "references", strength: 0.5, actorNeopId: "seat_a",
      } as any),
    ).rejects.toThrow(/SoT write-scope/i);
  });

  test("mergeRooms DIRECT not owning both → denied", async () => {
    const { t, palaceId, roomA, roomB } = await setupSeatPalace();
    await expect(
      t.mutation(api.palace.mutations.mergeRooms, {
        palaceId, sourceRoomId: roomB, targetRoomId: roomA, actorNeopId: "seat_a",
      } as any),
    ).rejects.toThrow(/SoT write-scope/i);
  });
});

describe("Gate D — graph seat isolation (DEFERRED)", () => {
  test.skip("acl_graph_no_private_crossseat_edges", () => {
    // WHEN un-skipped (post-decision to seat-isolate the graph):
    //   - seat_a writes private-wing content → bridge ingests episode into the palace graph
    //   - assert NO edge/path makes that content traversable from seat_b's subgraph
    //     (group_id / namespace boundary holds), while company content stays shared.
    // Requires a live/stubbed FalkorDB; tracked with Gate D, not offline-gradeable here.
  });
});

// ─────────────────────────────────────────────────────────────────
// #12 — denied_at_layer unified into audit_events (the Day-90 measurement sink).
// A SoT dispatch denial self-tags convex_sot; edge/broker denials push in via
// recordExternalDenial; denialsByLayer is the instrument that counts them.
// ─────────────────────────────────────────────────────────────────

describe("#12 — denied_at_layer unified audit + measurement", () => {
  test("a SoT /mcp denial is tagged convex_sot and counted by denialsByLayer", async () => {
    const { t, palaceId, roomB } = await setupSeatPalace();
    const { status } = await call(t, "palace_add_closet",
      { roomId: roomB, content: "x", category: "decision" }, "seat_a", palaceId);
    expect(status).toBe(403);

    const counts = await t.query(api.access.queries.denialsByLayer, { palaceId });
    expect(counts.byLayer.convex_sot).toBeGreaterThanOrEqual(1);
    expect(counts.total).toBeGreaterThanOrEqual(1);

    // The raw audit row carries the layer tag.
    const rows = await t.run(async (ctx: any) =>
      ctx.db.query("audit_events").withIndex("by_palace_status",
        (q: any) => q.eq("palaceId", palaceId).eq("status", "denied")).collect());
    expect(rows.some((r: any) => r.denied_at_layer === "convex_sot")).toBe(true);
  });

  test("recordExternalDenial unifies edge + broker denials into the same sink", async () => {
    const { t, palaceId } = await setupSeatPalace();
    await t.mutation(api.access.mutations.recordExternalDenial, {
      palaceId, deniedAtLayer: "edge", neopId: "@evil:x", reason: "reserved_identity_claimed_from_channel",
    });
    await t.mutation(api.access.mutations.recordExternalDenial, {
      palaceId, deniedAtLayer: "broker", neopId: "unknown", reason: "blank_identity",
    });
    const counts = await t.query(api.access.queries.denialsByLayer, { palaceId });
    expect(counts.byLayer.edge).toBe(1);
    expect(counts.byLayer.broker).toBe(1);
    expect(counts.total).toBe(2);
  });

  test("denialsByLayer respects the sinceMs window", async () => {
    const { t, palaceId } = await setupSeatPalace();
    await t.mutation(api.access.mutations.recordExternalDenial, {
      palaceId, deniedAtLayer: "edge", reason: "x",
    });
    const future = await t.query(api.access.queries.denialsByLayer, {
      palaceId, sinceMs: Date.now() + 60_000,
    });
    expect(future.total).toBe(0);
    const all = await t.query(api.access.queries.denialsByLayer, { palaceId });
    expect(all.total).toBeGreaterThanOrEqual(1);
  });
});
