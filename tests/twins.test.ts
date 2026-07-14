// Twins — server-side CAS + version history/rollback (Track 1 single-writer safety + Track 3 twin ops).
//
// Covers: the blind latest-wins path is unchanged (no baseVersion); the CAS rejects a stale writer and
// accepts a matching base; version history is appended + bounded; getTwinVersion round-trips a snapshot
// (the diff primitive); rollback restores a prior doc AS A NEW FORWARD VERSION (monotonic). Own-seat
// isolation and the /mcp permission gate are covered by access.test.ts; here we drive the handlers directly.
//
// Run: `npm test`

import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api.js";
import schema from "../convex/schema.js";
import { runtimeOpForTool } from "../convex/access/enforce.js";

async function makePalace(t: ReturnType<typeof convexTest>) {
  return await t.mutation(api.palace.mutations.createPalace, {
    name: "Test Palace",
    clientId: "test",
    falkordbGraph: "test_graph",
    createdBy: "system",
  });
}

const doc = (o: object) => JSON.stringify(o, Object.keys(o).sort());

describe("twins — CAS", () => {
  test("without baseVersion, put is a blind latest-wins upsert (single-writer path, unchanged)", async () => {
    const t = convexTest(schema);
    const palaceId = await makePalace(t);
    const a = await t.mutation(api.palace.twins.putTwin, {
      palaceId, neopId: "aria", doc: doc({ v: 0 }), version: 0, maturity: "seed",
    });
    expect(a).toMatchObject({ status: "ok", upsert: "insert", version: 0 });
    const b = await t.mutation(api.palace.twins.putTwin, {
      palaceId, neopId: "aria", doc: doc({ v: 1 }), version: 1, maturity: "growing",
    });
    expect(b).toMatchObject({ status: "ok", upsert: "update", version: 1 });
    const got = await t.query(api.palace.twins.getTwin, { palaceId, neopId: "aria" });
    expect(got).toMatchObject({ twin: { v: 1 }, version: 1 }); // latest wins, one row
  });

  test("CAS rejects a stale writer (baseVersion != stored) with no write; accepts a matching base", async () => {
    const t = convexTest(schema);
    const palaceId = await makePalace(t);
    await t.mutation(api.palace.twins.putTwin, {
      palaceId, neopId: "aria", doc: doc({ v: 0 }), version: 0, maturity: "seed",
    });
    // writer B thinks the base is still 0, but it's already been bumped to 1 by writer A
    await t.mutation(api.palace.twins.putTwin, {
      palaceId, neopId: "aria", doc: doc({ v: 1, by: "A" }), version: 1, maturity: "growing", baseVersion: 0,
    });
    const stale = await t.mutation(api.palace.twins.putTwin, {
      palaceId, neopId: "aria", doc: doc({ v: 1, by: "B" }), version: 1, maturity: "growing", baseVersion: 0,
    });
    expect(stale).toMatchObject({ status: "stale_base", storedVersion: 1, baseVersion: 0 });
    const got = await t.query(api.palace.twins.getTwin, { palaceId, neopId: "aria" });
    expect(got).toMatchObject({ twin: { v: 1, by: "A" } }); // B did NOT clobber A
    // B re-reads (base now 1) and its CAS write lands
    const ok = await t.mutation(api.palace.twins.putTwin, {
      palaceId, neopId: "aria", doc: doc({ v: 2, by: "B" }), version: 2, maturity: "growing", baseVersion: 1,
    });
    expect(ok).toMatchObject({ status: "ok", version: 2 });
  });

  test("CAS on a first write (no row) is always allowed — nothing to clobber", async () => {
    const t = convexTest(schema);
    const palaceId = await makePalace(t);
    const first = await t.mutation(api.palace.twins.putTwin, {
      palaceId, neopId: "aria", doc: doc({ v: 0 }), version: 0, maturity: "seed", baseVersion: 0,
    });
    expect(first).toMatchObject({ status: "ok", upsert: "insert" });
  });
});

describe("twins — version history + rollback", () => {
  test("each put appends a snapshot; getTwinVersion round-trips a prior doc (the diff primitive)", async () => {
    const t = convexTest(schema);
    const palaceId = await makePalace(t);
    await t.mutation(api.palace.twins.putTwin, {
      palaceId, neopId: "aria", doc: doc({ tone: "warm" }), version: 0, maturity: "seed",
    });
    await t.mutation(api.palace.twins.putTwin, {
      palaceId, neopId: "aria", doc: doc({ tone: "curt" }), version: 1, maturity: "growing",
    });
    const list = await t.query(api.palace.twins.getTwinVersions, { palaceId, neopId: "aria" });
    expect(list.count).toBe(2);
    expect(list.versions.map((v: any) => v.version)).toEqual([1, 0]); // newest-first
    const v0 = await t.query(api.palace.twins.getTwinVersion, { palaceId, neopId: "aria", version: 0 });
    const v1 = await t.query(api.palace.twins.getTwinVersion, { palaceId, neopId: "aria", version: 1 });
    expect(v0).toMatchObject({ twin: { tone: "warm" }, version: 0 });
    expect(v1).toMatchObject({ twin: { tone: "curt" }, version: 1 });
    // an unretained version → null
    const miss = await t.query(api.palace.twins.getTwinVersion, { palaceId, neopId: "aria", version: 99 });
    expect(miss).toEqual({ twin: null });
  });

  test("rollback restores a prior doc AS A NEW FORWARD VERSION (monotonic, CAS-coherent)", async () => {
    const t = convexTest(schema);
    const palaceId = await makePalace(t);
    await t.mutation(api.palace.twins.putTwin, {
      palaceId, neopId: "aria", doc: doc({ tone: "warm" }), version: 0, maturity: "seed",
    });
    await t.mutation(api.palace.twins.putTwin, {
      palaceId, neopId: "aria", doc: doc({ tone: "curt" }), version: 1, maturity: "drifted",
    });
    const rb = await t.mutation(api.palace.twins.rollbackTwin, { palaceId, neopId: "aria", toVersion: 0 });
    expect(rb).toMatchObject({ status: "ok", version: 2, restoredFrom: 0 }); // forward to v2, content of v0
    const live = await t.query(api.palace.twins.getTwin, { palaceId, neopId: "aria" });
    expect(live).toMatchObject({ twin: { tone: "warm" }, version: 2, maturity: "seed" });
    const list = await t.query(api.palace.twins.getTwinVersions, { palaceId, neopId: "aria" });
    expect(list.versions[0]).toMatchObject({ version: 2, restoredFrom: 0 }); // rollback provenance recorded
  });

  test("rollback to an unknown version, or with a stale base, refuses without a write", async () => {
    const t = convexTest(schema);
    const palaceId = await makePalace(t);
    await t.mutation(api.palace.twins.putTwin, {
      palaceId, neopId: "aria", doc: doc({ v: 0 }), version: 0, maturity: "seed",
    });
    expect(await t.mutation(api.palace.twins.rollbackTwin, { palaceId, neopId: "aria", toVersion: 7 }))
      .toMatchObject({ status: "unknown_version" });
    expect(await t.mutation(api.palace.twins.rollbackTwin, { palaceId, neopId: "aria", toVersion: 0, baseVersion: 5 }))
      .toMatchObject({ status: "stale_base", storedVersion: 0 });
    // rollback on a seat with no twin at all
    expect(await t.mutation(api.palace.twins.rollbackTwin, { palaceId, neopId: "ghost", toVersion: 0 }))
      .toMatchObject({ status: "no_twin" });
  });
});

describe("twins — ACL op-map", () => {
  test("the whole twin family is identity-gated (absent from the memory op-map), like get/put_twin", () => {
    // Twins are identity, not memory — none of the twin tools resolve to a recall/remember op (B2).
    expect(runtimeOpForTool("palace_get_twin")).toBeNull();
    expect(runtimeOpForTool("palace_put_twin")).toBeNull();
    expect(runtimeOpForTool("palace_get_twin_versions")).toBeNull();
    expect(runtimeOpForTool("palace_get_twin_version")).toBeNull();
    expect(runtimeOpForTool("palace_rollback_twin")).toBeNull();
  });
});
