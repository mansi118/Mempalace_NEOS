// vault_promoted — the VL-5 do-not-re-promote markers (durable half of runtime/vault.py).
// Covers mark → isPromoted true, clear → isPromoted false (re-promote allowed), own-seat isolation,
// idempotent clear of an absent key, and the ACL op-map (mark→promote, is→recall, clear→erase).
// Run: `npm test`

import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api.js";
import schema from "../convex/schema.js";
import { runtimeOpForTool } from "../convex/access/enforce.js";

async function makePalace(t: ReturnType<typeof convexTest>) {
  return await t.mutation(api.palace.mutations.createPalace, {
    name: "Test Palace", clientId: "test", falkordbGraph: "test_graph", createdBy: "system",
  });
}

describe("vault_promoted — do-not-re-promote markers", () => {
  test("mark → isPromoted true; clear → isPromoted false (re-promote allowed)", async () => {
    const t = convexTest(schema);
    const palaceId = await makePalace(t);
    expect((await t.query(api.palace.vaultPromoted.isPromoted, { palaceId, neopId: "aria", key: "k1" })).promoted).toBe(false);
    await t.mutation(api.palace.vaultPromoted.markPromoted, { palaceId, neopId: "aria", key: "k1", promotedAt: "2026-01-01T00:00:00Z" });
    const got = await t.query(api.palace.vaultPromoted.isPromoted, { palaceId, neopId: "aria", key: "k1" });
    expect(got).toMatchObject({ promoted: true, promotedAt: "2026-01-01T00:00:00Z" });
    const cleared = await t.mutation(api.palace.vaultPromoted.clearPromoted, { palaceId, neopId: "aria", key: "k1" });
    expect(cleared).toEqual({ status: "ok", cleared: true });
    expect((await t.query(api.palace.vaultPromoted.isPromoted, { palaceId, neopId: "aria", key: "k1" })).promoted).toBe(false);
  });

  test("OWN-SEAT isolation: a seat sees only its own markers", async () => {
    const t = convexTest(schema);
    const palaceId = await makePalace(t);
    await t.mutation(api.palace.vaultPromoted.markPromoted, { palaceId, neopId: "aria", key: "shared" });
    expect((await t.query(api.palace.vaultPromoted.isPromoted, { palaceId, neopId: "recon", key: "shared" })).promoted).toBe(false);
  });

  test("clearing an absent key is an idempotent no-op", async () => {
    const t = convexTest(schema);
    const palaceId = await makePalace(t);
    expect(await t.mutation(api.palace.vaultPromoted.clearPromoted, { palaceId, neopId: "aria", key: "nope" }))
      .toEqual({ status: "ok", cleared: false });
  });

  test("ACL op-map: mark→promote, is→recall, clear→erase", () => {
    expect(runtimeOpForTool("palace_mark_promoted")).toBe("promote");
    expect(runtimeOpForTool("palace_is_promoted")).toBe("recall");
    expect(runtimeOpForTool("palace_clear_promoted")).toBe("erase");
  });
});
