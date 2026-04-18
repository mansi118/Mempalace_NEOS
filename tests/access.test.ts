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
} from "../convex/access/enforce.js";

// ─── Test permission sets ───────────────────────────────────────

const ADMIN: ResolvedPermissions = {
  neopId: "_admin",
  effectiveNeopId: "_admin",
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
