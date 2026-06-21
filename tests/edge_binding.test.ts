// Edge-auth E1 — seat_bindings store (#1/#3). Offline via convex-test.
// The binding is the ONLY source of requester identity; write-time validation must reject
// binding a human to a reserved (server-minted) identity.
import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema.js";
import { api } from "../convex/_generated/api.js";

describe("Edge-auth E1 — seat_bindings store", () => {
  test("resolveBinding miss returns null", async () => {
    const t = convexTest(schema);
    expect(await t.query(api.access.bindings.resolveBinding, { mxid: "@nobody:x" })).toBeNull();
  });

  test("upsert then resolve returns the binding", async () => {
    const t = convexTest(schema);
    const r = await t.mutation(api.access.bindings.upsertSeatBinding, {
      mxid: "@alice:neuraledge.org", tenant_id: "neuraledge", seat_id: "aria", role: "member",
    });
    expect(r.status).toBe("created");
    const b = await t.query(api.access.bindings.resolveBinding, { mxid: "@alice:neuraledge.org" });
    expect(b!.seat_id).toBe("aria");
    expect(b!.tenant_id).toBe("neuraledge");
    expect(b!.status).toBe("active");
  });

  test("upsert is keyed by mxid — second write updates, never duplicates", async () => {
    const t = convexTest(schema);
    await t.mutation(api.access.bindings.upsertSeatBinding, {
      mxid: "@a:x", tenant_id: "t", seat_id: "aria", role: "member",
    });
    const r2 = await t.mutation(api.access.bindings.upsertSeatBinding, {
      mxid: "@a:x", tenant_id: "t", seat_id: "recon", role: "admin",
    });
    expect(r2.status).toBe("updated");
    const all = await t.run(async (ctx: any) =>
      ctx.db.query("seat_bindings").withIndex("by_mxid", (q: any) => q.eq("mxid", "@a:x")).collect());
    expect(all.length).toBe(1);
    expect(all[0]!.seat_id).toBe("recon");
  });

  test("write REJECTS binding a human to a reserved identity (server-minted only)", async () => {
    const t = convexTest(schema);
    for (const seat of ["_admin", "_system", "_x"]) {
      await expect(
        t.mutation(api.access.bindings.upsertSeatBinding, {
          mxid: "@e:x", tenant_id: "t", seat_id: seat, role: "member",
        }),
      ).rejects.toThrow(/reserved/i);
    }
    // …and the store stays empty (nothing was written).
    const any = await t.query(api.access.bindings.resolveBinding, { mxid: "@e:x" });
    expect(any).toBeNull();
  });
});
