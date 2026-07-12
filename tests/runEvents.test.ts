// run_events — the INTERIM shadow-prediction store for the fidelity clock (Track 3).
//
// Covers the handler contract (blind store, newest-first, bounded read, kind filter) and OWN-SEAT
// isolation (a seat reads only its own events), plus the ACL op-map (get→recall / put→remember) so the
// /mcp gate treats these like every other own-seat tool. The full /mcp permission enforcement is covered
// by access.test.ts; here we assert the tool→op wiring and the query/mutation round-trip directly.
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

const shadow = (predicted: string, actual: string) => ({
  kind: "shadow_prediction",
  predicted,
  actual,
  class: "selective",
});

describe("run_events — interim fidelity store", () => {
  test("put then get round-trips the runtime-owned event, newest-first", async () => {
    const t = convexTest(schema);
    const palaceId = await makePalace(t);

    await t.mutation(api.palace.runEvents.putRunEvent, {
      palaceId, neopId: "aria", kind: "shadow_prediction", event: shadow("older", "a"), ts: 100,
    });
    await t.mutation(api.palace.runEvents.putRunEvent, {
      palaceId, neopId: "aria", kind: "shadow_prediction", event: shadow("newer", "b"), ts: 200,
    });

    const { events, count } = await t.query(api.palace.runEvents.getRunEvents, {
      palaceId, neopId: "aria",
    });
    expect(count).toBe(2);
    expect(events[0].predicted).toBe("newer"); // desc by ts
    expect(events[1].predicted).toBe("older");
  });

  test("OWN-SEAT isolation: a seat reads only its own events", async () => {
    const t = convexTest(schema);
    const palaceId = await makePalace(t);
    await t.mutation(api.palace.runEvents.putRunEvent, {
      palaceId, neopId: "aria", kind: "shadow_prediction", event: shadow("aria-1", "x"), ts: 1,
    });
    await t.mutation(api.palace.runEvents.putRunEvent, {
      palaceId, neopId: "recon", kind: "shadow_prediction", event: shadow("recon-1", "y"), ts: 1,
    });

    const aria = await t.query(api.palace.runEvents.getRunEvents, { palaceId, neopId: "aria" });
    expect(aria.count).toBe(1);
    expect(aria.events[0].predicted).toBe("aria-1"); // never sees recon's row
  });

  test("kind filter + read limit are honored", async () => {
    const t = convexTest(schema);
    const palaceId = await makePalace(t);
    await t.mutation(api.palace.runEvents.putRunEvent, {
      palaceId, neopId: "aria", kind: "shadow_prediction", event: shadow("s", "x"), ts: 2,
    });
    await t.mutation(api.palace.runEvents.putRunEvent, {
      palaceId, neopId: "aria", kind: "twin_written", event: { kind: "twin_written" }, ts: 3,
    });

    const onlyShadow = await t.query(api.palace.runEvents.getRunEvents, {
      palaceId, neopId: "aria", kind: "shadow_prediction",
    });
    expect(onlyShadow.count).toBe(1);
    expect(onlyShadow.events[0].kind).toBe("shadow_prediction");

    const limited = await t.query(api.palace.runEvents.getRunEvents, {
      palaceId, neopId: "aria", limit: 1,
    });
    expect(limited.count).toBe(1); // newest only
    expect(limited.events[0].kind).toBe("twin_written"); // ts=3 is newest
  });

  test("empty seat → { events: [], count: 0 } (no throw)", async () => {
    const t = convexTest(schema);
    const palaceId = await makePalace(t);
    const res = await t.query(api.palace.runEvents.getRunEvents, { palaceId, neopId: "nobody" });
    expect(res).toEqual({ events: [], count: 0 });
  });

  test("ACL op-map: get→recall, put→remember (gated like every own-seat tool)", () => {
    expect(runtimeOpForTool("palace_get_run_events")).toBe("recall");
    expect(runtimeOpForTool("palace_put_run_event")).toBe("remember");
  });
});
