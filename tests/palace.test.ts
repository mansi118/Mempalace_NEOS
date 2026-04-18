// Phase 1 invariant tests.
//
// Covers the 15 tests identified in the ultrathink analysis:
//   1.  dedup correctness
//   2.  whitespace normalization
//   3.  version chain
//   4.  concurrent dedup writes (race-safety)
//   5.  retract under legalHold throws
//   6.  retract clears content AND deletes embedding
//   7.  cross-palace tunnel rejection
//   8.  counter denormalization integrity
//   9.  seed idempotency
//  10.  invalid category throws
//  11.  invalid confidence range throws
//  12.  content > 900KB throws
//  13.  createCloset for non-existent room throws
//  14.  createDrawer for non-existent closet throws
//  15.  retract cascade behavior
//
// Run: `npm test`

import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api.js";
import schema from "../convex/schema.js";

const EMBED_DIM = 768; // Gemini Embedding
const fakeEmbedding = (): number[] => Array.from({ length: EMBED_DIM }, () => Math.random());

// Helper: create a fully-scaffolded palace with a single wing/hall/room.
async function makePalace(t: ReturnType<typeof convexTest>) {
  const palaceId = await t.mutation(api.palace.mutations.createPalace, {
    name: "Test Palace",
    clientId: "test",
    falkordbGraph: "test_graph",
    createdBy: "system",
  });
  const wingId = await t.mutation(api.palace.mutations.createWing, {
    palaceId,
    name: "platform",
    description: "Platform wing",
    sortOrder: 1,
  });
  const hallId = await t.mutation(api.palace.mutations.createHall, {
    wingId,
    palaceId,
    type: "facts",
  });
  const roomId = await t.mutation(api.palace.mutations.createRoom, {
    hallId,
    wingId,
    palaceId,
    name: "stack",
    summary: "Tech stack",
    tags: [],
  });
  await t.mutation(api.palace.mutations.markPalaceReady, { palaceId });
  return { palaceId, wingId, hallId, roomId };
}

const baseClosetArgs = (palaceId: string, roomId: string, overrides: Record<string, unknown> = {}) => ({
  palaceId,
  roomId,
  content: "We chose Convex over Supabase for real-time subscriptions.",
  category: "decision",
  sourceType: "claude_chat",
  sourceAdapter: "claude-export",
  sourceExternalId: "convo-1:exchange-3",
  authorType: "adapter",
  authorId: "claude-export",
  confidence: 0.8,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────

describe("Phase 1 invariants", () => {

  // ── 1. Dedup correctness ────────────────────────────────────
  test("same dedup key returns noop on second create", async () => {
    const t = convexTest(schema);
    const { palaceId, roomId } = await makePalace(t);

    const r1 = await t.mutation(api.palace.mutations.createCloset,
      baseClosetArgs(palaceId, roomId) as any);
    expect(r1.status).toBe("created");

    const r2 = await t.mutation(api.palace.mutations.createCloset,
      baseClosetArgs(palaceId, roomId) as any);
    expect(r2.status).toBe("noop");
    expect(r2.closetId).toEqual(r1.closetId);
  });

  // ── 2. Whitespace normalization ─────────────────────────────
  test("whitespace-only content differences resolve to noop", async () => {
    const t = convexTest(schema);
    const { palaceId, roomId } = await makePalace(t);

    const r1 = await t.mutation(api.palace.mutations.createCloset,
      baseClosetArgs(palaceId, roomId, { content: "hello world" }) as any);
    const r2 = await t.mutation(api.palace.mutations.createCloset,
      baseClosetArgs(palaceId, roomId, { content: "hello   world" }) as any);
    const r3 = await t.mutation(api.palace.mutations.createCloset,
      baseClosetArgs(palaceId, roomId, { content: "\n hello\tworld \n" }) as any);

    expect(r1.status).toBe("created");
    expect(r2.status).toBe("noop");
    expect(r3.status).toBe("noop");
    expect(r2.closetId).toEqual(r1.closetId);
    expect(r3.closetId).toEqual(r1.closetId);
  });

  // ── 3. Version chain ────────────────────────────────────────
  test("different content with same source creates v2 with supersedes link", async () => {
    const t = convexTest(schema);
    const { palaceId, roomId } = await makePalace(t);

    const r1 = await t.mutation(api.palace.mutations.createCloset,
      baseClosetArgs(palaceId, roomId, { content: "Original decision text." }) as any);

    const r2 = await t.mutation(api.palace.mutations.createCloset,
      baseClosetArgs(palaceId, roomId, { content: "Revised decision text." }) as any);

    expect(r2.status).toBe("versioned");
    expect(r2.version).toBe(2);

    const v1 = await t.query(api.palace.queries.getCloset, { closetId: r1.closetId });
    const v2 = await t.query(api.palace.queries.getCloset, { closetId: r2.closetId });

    expect(v2!.supersedes).toEqual(r1.closetId);
    expect(v1!.supersededBy).toEqual(r2.closetId);
    expect(v2!.version).toBe(2);
  });

  // ── 4. Concurrent dedup writes ──────────────────────────────
  test("concurrent createCloset with same dedupKey: only one head exists", async () => {
    const t = convexTest(schema);
    const { palaceId, roomId } = await makePalace(t);

    // Fire 20 parallel writes with identical content+source.
    const args = baseClosetArgs(palaceId, roomId);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        t.mutation(api.palace.mutations.createCloset, args as any),
      ),
    );

    // Convex OCC retries conflicting mutations. Net: exactly one closet
    // created (status="created"), all others noop.
    const created = results.filter((r) => r.status === "created");
    const noops = results.filter((r) => r.status === "noop");

    expect(created.length).toBe(1);
    expect(noops.length).toBe(19);

    // All point to the same closet.
    for (const r of noops) expect(r.closetId).toEqual(created[0]!.closetId);

    // And only one head row exists (no supersededBy) in the palace.
    const headClosetDoc = await t.query(api.palace.queries.getCloset, {
      closetId: created[0]!.closetId,
    });
    const all = await t.query(api.palace.queries.findClosetByDedup, {
      palaceId,
      dedupKey: headClosetDoc!.dedupKey,
    });
    const heads = all.filter((c) => c.supersededBy === undefined);
    expect(heads.length).toBe(1);
  });

  // ── 5. Retract under legalHold throws ───────────────────────
  test("retract on legalHold=true throws", async () => {
    const t = convexTest(schema);
    const { palaceId, roomId } = await makePalace(t);

    const r = await t.mutation(api.palace.mutations.createCloset,
      baseClosetArgs(palaceId, roomId) as any);
    await t.mutation(api.palace.mutations.setLegalHold, {
      closetId: r.closetId,
      hold: true,
    });

    await expect(
      t.mutation(api.palace.mutations.retractCloset, {
        closetId: r.closetId,
        reason: "test",
        retractedBy: "_admin",
      }),
    ).rejects.toThrow(/legal hold/i);
  });

  // ── 6. Retract clears content AND deletes embedding ─────────
  test("retract replaces content with [REDACTED] and deletes embedding row", async () => {
    const t = convexTest(schema);
    const { palaceId, roomId } = await makePalace(t);

    const r = await t.mutation(api.palace.mutations.createCloset,
      baseClosetArgs(palaceId, roomId) as any);

    await t.mutation(api.palace.mutations.storeEmbedding, {
      closetId: r.closetId,
      palaceId,
      embedding: fakeEmbedding(),
      model: "voyage-3-large",
      modelVersion: "2026-04",
    });

    await t.mutation(api.palace.mutations.retractCloset, {
      closetId: r.closetId,
      reason: "GDPR request",
      retractedBy: "_admin",
    });

    const closet = await t.query(api.palace.queries.getCloset, { closetId: r.closetId });
    expect(closet!.retracted).toBe(true);
    expect(closet!.content).toBe("[REDACTED]");

    // Embedding row must be gone.
    const all = await t.run(async (ctx) =>
      ctx.db
        .query("closet_embeddings")
        .withIndex("by_closet", (q) => q.eq("closetId", r.closetId))
        .collect(),
    );
    expect(all.length).toBe(0);
  });

  // ── 7. Cross-palace tunnel rejection ────────────────────────
  test("createTunnel rejects rooms from different palaces", async () => {
    const t = convexTest(schema);
    const a = await makePalace(t);

    // Second palace.
    const palaceBId = await t.mutation(api.palace.mutations.createPalace, {
      name: "Other", clientId: "other", falkordbGraph: "other_graph", createdBy: "system",
    });
    const wingBId = await t.mutation(api.palace.mutations.createWing, {
      palaceId: palaceBId, name: "platform", description: "x", sortOrder: 1,
    });
    const hallBId = await t.mutation(api.palace.mutations.createHall, {
      wingId: wingBId, palaceId: palaceBId, type: "facts",
    });
    const roomBId = await t.mutation(api.palace.mutations.createRoom, {
      hallId: hallBId, wingId: wingBId, palaceId: palaceBId,
      name: "stack", summary: "x", tags: [],
    });

    await expect(
      t.mutation(api.palace.mutations.createTunnel, {
        palaceId: a.palaceId,
        fromRoomId: a.roomId,
        toRoomId: roomBId,
        relationship: "depends_on",
        strength: 0.8,
      }),
    ).rejects.toThrow(/cross-palace/i);
  });

  // ── 8. Counter denormalization integrity ────────────────────
  test("creating N closets results in room.closetCount = N", async () => {
    const t = convexTest(schema);
    const { palaceId, roomId } = await makePalace(t);

    for (let i = 0; i < 5; i++) {
      await t.mutation(api.palace.mutations.createCloset,
        baseClosetArgs(palaceId, roomId, {
          content: `Closet ${i}`,
          sourceExternalId: `convo:${i}`,
        }) as any);
    }

    const room = await t.query(api.palace.queries.getRoom, { roomId });
    expect(room!.closetCount).toBe(5);
  });

  // ── 9. Seed idempotency ─────────────────────────────────────
  test("re-running create operations is idempotent", async () => {
    const t = convexTest(schema);
    const a = await makePalace(t);
    const b = await makePalace(t);

    expect(a.palaceId).toEqual(b.palaceId);
    expect(a.wingId).toEqual(b.wingId);
    expect(a.hallId).toEqual(b.hallId);
    expect(a.roomId).toEqual(b.roomId);

    // Wing room count incremented exactly once.
    const wing = await t.run(async (ctx) => ctx.db.get(a.wingId));
    expect(wing!.roomCount).toBe(1);
  });

  // ── 10. Invalid category throws ─────────────────────────────
  test("invalid category throws", async () => {
    const t = convexTest(schema);
    const { palaceId, roomId } = await makePalace(t);

    await expect(
      t.mutation(api.palace.mutations.createCloset,
        baseClosetArgs(palaceId, roomId, { category: "definitely-not-a-category" }) as any),
    ).rejects.toThrow(/invalid category/i);
  });

  // ── 11. Invalid confidence range throws ─────────────────────
  test("confidence outside [0,1] throws", async () => {
    const t = convexTest(schema);
    const { palaceId, roomId } = await makePalace(t);

    await expect(
      t.mutation(api.palace.mutations.createCloset,
        baseClosetArgs(palaceId, roomId, { confidence: 1.5 }) as any),
    ).rejects.toThrow(/confidence must be in/i);

    await expect(
      t.mutation(api.palace.mutations.createCloset,
        baseClosetArgs(palaceId, roomId, { confidence: -0.1, sourceExternalId: "x" }) as any),
    ).rejects.toThrow(/confidence must be in/i);
  });

  // ── 12. Content > 900KB throws ──────────────────────────────
  test("oversized content rejected", async () => {
    const t = convexTest(schema);
    const { palaceId, roomId } = await makePalace(t);

    const huge = "a".repeat(950_000);
    await expect(
      t.mutation(api.palace.mutations.createCloset,
        baseClosetArgs(palaceId, roomId, { content: huge }) as any),
    ).rejects.toThrow(/content too large/i);
  });

  // ── 13. createCloset for non-existent room throws ───────────
  test("createCloset with deleted roomId throws", async () => {
    const t = convexTest(schema);
    const { palaceId, hallId, wingId } = await makePalace(t);

    // Create a temporary room, then delete it to obtain a well-formed but
    // dangling room ID.
    const fakeRoomId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("rooms", {
        hallId, wingId, palaceId,
        name: "temp-for-deletion",
        summary: "x",
        closetCount: 0,
        lastUpdated: Date.now(),
        tags: [],
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      t.mutation(api.palace.mutations.createCloset,
        baseClosetArgs(palaceId, fakeRoomId) as any),
    ).rejects.toThrow(/not found/i);
  });

  // ── 14. createDrawer for non-existent closet throws ─────────
  test("createDrawer with deleted closetId throws", async () => {
    const t = convexTest(schema);
    const { palaceId, roomId, hallId, wingId } = await makePalace(t);

    const fakeClosetId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("closets", {
        roomId, hallId, wingId, palaceId,
        content: "temp", category: "fact", sourceType: "manual",
        sourceAdapter: "test", sourceExternalId: "temp",
        authorType: "system", authorId: "test",
        version: 1, schemaVersion: 1,
        confidence: 1.0, needsReview: false,
        createdAt: Date.now(), updatedAt: Date.now(),
        decayed: false, retracted: false, legalHold: false,
        piiTags: [], visibility: "default",
        embeddingStatus: "pending", graphitiStatus: "pending",
        dedupKey: "tmp",
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      t.mutation(api.palace.mutations.createDrawer, {
        closetId: fakeClosetId,
        palaceId,
        fact: "fact",
        validFrom: Date.now(),
        confidence: 0.5,
      }),
    ).rejects.toThrow(/not found/i);
  });

  // ── 15. Retract cascade: stats reflect retraction ───────────
  test("retracted closets are excluded from default stats and listClosets", async () => {
    const t = convexTest(schema);
    const { palaceId, roomId } = await makePalace(t);

    const r1 = await t.mutation(api.palace.mutations.createCloset,
      baseClosetArgs(palaceId, roomId, { sourceExternalId: "a" }) as any);
    await t.mutation(api.palace.mutations.createCloset,
      baseClosetArgs(palaceId, roomId, { sourceExternalId: "b", content: "Other" }) as any);

    let visible = await t.query(api.palace.queries.listClosets, { roomId });
    expect(visible.length).toBe(2);

    await t.mutation(api.palace.mutations.retractCloset, {
      closetId: r1.closetId, reason: "test", retractedBy: "_admin",
    });

    visible = await t.query(api.palace.queries.listClosets, { roomId });
    expect(visible.length).toBe(1);

    const stats = await t.query(api.palace.queries.getStats, { palaceId });
    expect(stats!.closets.retracted).toBe(1);
    expect(stats!.closets.visible).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────
// Append-only enforcement
// ─────────────────────────────────────────────────────────────────

describe("safePatch enforcement", () => {
  test("safePatchCloset rejects immutable fields", async () => {
    const t = convexTest(schema);
    const { palaceId, roomId } = await makePalace(t);
    const r = await t.mutation(api.palace.mutations.createCloset,
      baseClosetArgs(palaceId, roomId) as any);

    // Try to patch content directly via t.run (simulating a malicious caller).
    await expect(
      t.run(async (ctx) => {
        const { safePatchCloset } = await import("../convex/lib/safePatch.js");
        await safePatchCloset(ctx, r.closetId as any, { content: "hacked" } as any);
      }),
    ).rejects.toThrow(/immutable/);
  });
});

// ─────────────────────────────────────────────────────────────────
// Validators (unit-level)
// ─────────────────────────────────────────────────────────────────

describe("validators", () => {
  test("dedup key is source-identity only (content-independent)", async () => {
    const { computeDedupKey } = await import("../convex/lib/dedup.js");
    // Same (adapter, externalId) → same key regardless of any content.
    const a = await computeDedupKey("src", "id");
    const b = await computeDedupKey("src", "id");
    expect(a).toEqual(b);
  });

  test("dedup key differs by adapter or externalId", async () => {
    const { computeDedupKey } = await import("../convex/lib/dedup.js");
    const base = await computeDedupKey("src1", "id1");
    expect(await computeDedupKey("src2", "id1")).not.toEqual(base);
    expect(await computeDedupKey("src1", "id2")).not.toEqual(base);
  });

  test("normalizeContent collapses whitespace", async () => {
    const { normalizeContent } = await import("../convex/lib/dedup.js");
    expect(normalizeContent("hello   world")).toEqual("hello world");
    expect(normalizeContent("  hello\tworld  ")).toEqual("hello world");
    expect(normalizeContent("line1\n\n\nline2")).toEqual("line1 line2");
    expect(normalizeContent("no-change")).toEqual("no-change");
  });

  test("validateContentAccess rejects malformed JSON", async () => {
    const { validateContentAccess } = await import("../convex/lib/validators.js");
    expect(() => validateContentAccess("not-json")).toThrow();
    expect(() =>
      validateContentAccess(JSON.stringify({ platform: { read: "all", write: [] } })),
    ).toThrow(/contentAccess.platform.read/);
    expect(() =>
      validateContentAccess(JSON.stringify({ platform: { read: ["bogus"], write: [] } })),
    ).toThrow(/contentAccess.platform.read/);
    // Valid shape passes.
    expect(() =>
      validateContentAccess(
        JSON.stringify({ platform: { read: "*", write: ["fact", "decision"] } }),
      ),
    ).not.toThrow();
  });
});
