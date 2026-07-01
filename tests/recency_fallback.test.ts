// Recency fallback (ADR-neop-runtime index-propagation fix) — offline tests.
//
// The async vector/search indexes lag on the self-hosted backend (stall-leaning: a just-written closet can
// be invisible to vector+lexical search for 30min+, box-proven 2026-07-01). The recency fallback routes
// fresh writes around the async index using the TRANSACTIONAL by_time index + the closet's stored embedding
// (present the instant storeEmbedding runs). These tests cover the two offline-provable halves:
//   1. cosineSimilarity — the metric that MUST match Convex vectorSearch's cosine _score.
//   2. recentClosetsWithEmbeddings — the transactional fetch returns a just-written+embedded closet
//      immediately, skips un-embedded ones, and orders most-recent-first.
// The full coreSearch fusion (vectorSearch/searchIndex) is proven LIVE on the box (convex-test can't run
// vector/search indexes) — that live fresh-write recall is the done-bar this fix exists to close.

import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api.js";
import schema from "../convex/schema.js";
import { cosineSimilarity } from "../convex/lib/vec.js";

const EMBED_DIM = 1024;
const unit = (seed: number): number[] => {
  // deterministic non-zero vector
  const v = Array.from({ length: EMBED_DIM }, (_, i) => Math.sin(seed * (i + 1)));
  return v;
};

describe("cosineSimilarity (recency-channel metric)", () => {
  test("identical vectors → 1", () => {
    const v = unit(1);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
  });
  test("opposite vectors → -1", () => {
    const v = unit(2);
    const neg = v.map((x) => -x);
    expect(cosineSimilarity(v, neg)).toBeCloseTo(-1, 6);
  });
  test("scale-invariant (normalized)", () => {
    const v = unit(3);
    const scaled = v.map((x) => x * 7.5);
    expect(cosineSimilarity(v, scaled)).toBeCloseTo(1, 6);
  });
  test("orthogonal → ~0", () => {
    const a = [1, 0, 0, 0];
    const b = [0, 1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6);
  });
  test("length mismatch / empty → 0 (never NaN)", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });
});

async function makePalace(t: ReturnType<typeof convexTest>) {
  const palaceId = await t.mutation(api.palace.mutations.createPalace, {
    name: "Recency Palace", clientId: "test", falkordbGraph: "test_graph", createdBy: "system",
  });
  const wingId = await t.mutation(api.palace.mutations.createWing, {
    palaceId, name: "platform", description: "Platform wing", sortOrder: 1,
  });
  const hallId = await t.mutation(api.palace.mutations.createHall, { wingId, palaceId, type: "facts" });
  const roomId = await t.mutation(api.palace.mutations.createRoom, {
    hallId, wingId, palaceId, name: "stack", summary: "Tech stack", tags: [],
  });
  await t.mutation(api.palace.mutations.markPalaceReady, { palaceId });
  return { palaceId, roomId };
}

const closetArgs = (palaceId: string, roomId: string, o: Record<string, unknown> = {}) => ({
  palaceId, roomId, content: "seed", category: "fact", sourceType: "claude_chat",
  sourceAdapter: "test", sourceExternalId: "x", authorType: "adapter", authorId: "test",
  confidence: 0.8, actorNeopId: "_system", ...o,
});

async function embed(t: ReturnType<typeof convexTest>, palaceId: string, closetId: string, seed: number) {
  await t.mutation(api.palace.mutations.storeEmbedding, {
    closetId: closetId as any, palaceId: palaceId as any,
    embedding: unit(seed), model: "test", modelVersion: "001",
  });
}

describe("recentClosetsWithEmbeddings (transactional recency fetch)", () => {
  test("returns a just-written+embedded closet immediately, with its embedding", async () => {
    const t = convexTest(schema);
    const { palaceId, roomId } = await makePalace(t);
    const { closetId } = await t.mutation(
      api.palace.mutations.createCloset, closetArgs(palaceId, roomId, { content: "fresh fact", sourceExternalId: "c1" }) as any);
    await embed(t, palaceId, closetId, 1);

    const out = await t.query(internal.serving.enrich.recentClosetsWithEmbeddings, {
      palaceId: palaceId as any, limit: 25,
    });
    expect(out.length).toBe(1);
    expect(out[0]!.closetId).toBe(closetId);
    expect(out[0]!.embedding.length).toBe(EMBED_DIM);
  });

  test("skips closets that have no embedding row", async () => {
    const t = convexTest(schema);
    const { palaceId, roomId } = await makePalace(t);
    const a = await t.mutation(api.palace.mutations.createCloset, closetArgs(palaceId, roomId, { content: "embedded", sourceExternalId: "a" }) as any);
    await embed(t, palaceId, a.closetId, 1);
    // second closet, NO storeEmbedding → must be skipped (nothing to cosine against)
    await t.mutation(api.palace.mutations.createCloset, closetArgs(palaceId, roomId, { content: "unembedded", sourceExternalId: "b" }) as any);

    const out = await t.query(internal.serving.enrich.recentClosetsWithEmbeddings, {
      palaceId: palaceId as any, limit: 25,
    });
    expect(out.length).toBe(1);
    expect(out[0]!.closetId).toBe(a.closetId);
  });

  test("orders most-recent-first and honors limit", async () => {
    const t = convexTest(schema);
    const { palaceId, roomId } = await makePalace(t);
    const first = await t.mutation(api.palace.mutations.createCloset, closetArgs(palaceId, roomId, { content: "older", sourceExternalId: "f" }) as any);
    await embed(t, palaceId, first.closetId, 1);
    const second = await t.mutation(api.palace.mutations.createCloset, closetArgs(palaceId, roomId, { content: "newer", sourceExternalId: "s" }) as any);
    await embed(t, palaceId, second.closetId, 2);

    const out = await t.query(internal.serving.enrich.recentClosetsWithEmbeddings, {
      palaceId: palaceId as any, limit: 25,
    });
    expect(out.length).toBe(2);
    expect(out[0]!.closetId).toBe(second.closetId); // most-recent first

    const limited = await t.query(internal.serving.enrich.recentClosetsWithEmbeddings, {
      palaceId: palaceId as any, limit: 1,
    });
    expect(limited.length).toBe(1);
    expect(limited[0]!.closetId).toBe(second.closetId);
  });
});
