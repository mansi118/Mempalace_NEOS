// Fusion tests (ADR-neop-runtime) — the decision path that shipped UNPROVABLE offline (inline in a
// "use node" action convex-test can't run) and broke a live palace. Now pure + tested. The load-bearing
// case: does a clear-cosine RECENCY candidate survive when the vector channel is empty (the fresh-write
// promise)? And does off-domain garbage stay filtered ("I don't know")?

import { describe, expect, test } from "vitest";
import { fuseAndRank, type FusionInput } from "../convex/lib/fusion.js";

const NOW = 1_782_900_000_000;
const base = (o: Partial<FusionInput>): FusionInput => ({
  closetId: "c", content: "x", category: "fact", wingId: "w", wingName: "W",
  roomId: "r", roomName: "R", createdAt: NOW, sourceAdapter: "t", confidence: 0.8,
  vectorScore: 0, graphMatchCount: 0, lexicalRank: undefined, ...o,
});
const opts = (floor = 0.2, limit = 5) => ({ similarityFloor: floor, limit, now: NOW });

describe("fuseAndRank — recency/vector-empty (the fresh-write promise)", () => {
  test("clear-cosine recency candidate SURVIVES when the vector channel is empty", () => {
    // Simulates the exact broken-index scenario: vector returned nothing, recency injected candidates
    // scored by directly-computed cosine. The on-topic fresh write (0.5) must come back.
    const inputs = [
      base({ closetId: "fresh", content: "the fresh fact", vectorScore: 0.5, roomId: "r1" }),
      base({ closetId: "noise1", vectorScore: 0.1, roomId: "r2" }),
      base({ closetId: "noise2", vectorScore: 0.08, roomId: "r3" }),
    ];
    const out = fuseAndRank(inputs, opts());
    expect(out.length).toBe(1);
    expect(out[0]!.closetId).toBe("fresh");
  });

  test("two on-topic recency candidates both survive, ranked by score", () => {
    const out = fuseAndRank([
      base({ closetId: "a", vectorScore: 0.6, roomId: "r1" }),
      base({ closetId: "b", vectorScore: 0.45, roomId: "r2" }),
      base({ closetId: "junk", vectorScore: 0.1, roomId: "r3" }),
    ], opts());
    expect(out.map((r) => r.closetId)).toEqual(["a", "b"]); // junk (0.1 < keepThreshold 0.3) dropped
  });
});

describe("fuseAndRank — 'I don't know' preserved", () => {
  test("all off-domain (below noise floor) → empty", () => {
    const out = fuseAndRank([
      base({ closetId: "g1", vectorScore: 0.15, roomId: "r1" }),
      base({ closetId: "g2", vectorScore: 0.12, roomId: "r2" }),
    ], opts());
    expect(out.length).toBe(0);
  });

  test("marginal zero-overlap paraphrase at 0.18 is filtered by the 0.2 noise floor (documents the boundary)", () => {
    // This is the KNOWN GAP-1 boundary — not a bug. A fresh write whose true cosine is sub-floor is treated
    // exactly like a settled one; the recency channel does not (and should not) force best-of-marginal.
    const out = fuseAndRank([base({ closetId: "para", vectorScore: 0.18, roomId: "r1" })], opts());
    expect(out.length).toBe(0);
  });
});

describe("fuseAndRank — lexical bypass + adaptive floor", () => {
  test("a lexical hit survives even with zero vector score (bypasses the floor)", () => {
    const out = fuseAndRank([
      base({ closetId: "lex", vectorScore: 0, lexicalRank: 0, roomId: "r1" }),
      base({ closetId: "hi", vectorScore: 0.7, roomId: "r2" }),
    ], opts());
    expect(out.map((r) => r.closetId).sort()).toEqual(["hi", "lex"]);
  });

  test("relative term drops the weak tail below topRaw×0.5", () => {
    // top 0.8 → keepThreshold = max(0.2, 0.4) = 0.4; 0.5 survives, 0.3 dropped.
    const out = fuseAndRank([
      base({ closetId: "top", vectorScore: 0.8, roomId: "r1" }),
      base({ closetId: "mid", vectorScore: 0.5, roomId: "r2" }),
      base({ closetId: "weak", vectorScore: 0.3, roomId: "r3" }),
    ], opts());
    expect(out.map((r) => r.closetId)).toEqual(["top", "mid"]);
  });
});

describe("fuseAndRank — diversification + limit", () => {
  test("same-room penalty lets a slightly-lower cross-room hit rank above a same-room duplicate", () => {
    // r1: 0.80 and 0.78; r2: 0.79. After picking r1(0.80), r1(0.78) pays 0.03 → 0.75 < r2 0.79.
    const out = fuseAndRank([
      base({ closetId: "r1a", vectorScore: 0.80, roomId: "r1" }),
      base({ closetId: "r1b", vectorScore: 0.78, roomId: "r1" }),
      base({ closetId: "r2a", vectorScore: 0.79, roomId: "r2" }),
    ], opts(0.2, 3));
    expect(out.map((r) => r.closetId)).toEqual(["r1a", "r2a", "r1b"]);
  });

  test("honors the limit", () => {
    const inputs = Array.from({ length: 6 }, (_, i) => base({ closetId: `c${i}`, vectorScore: 0.9 - i * 0.01, roomId: `room${i}` }));
    expect(fuseAndRank(inputs, opts(0.2, 3)).length).toBe(3);
  });
});
