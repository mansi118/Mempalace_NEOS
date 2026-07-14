// Gate D — server-side X-NEop-Identity verification (Track 1).
//
// Two layers of proof:
//  1. CROSS-LANGUAGE: a FIXED vector signed by the Python shim (neop_jcode_adapter, Ed25519 over
//     `${palaceId}\n${neopId}\n${tool}`) verifies here in JS — proving the shim's signature and the
//     server's verify agree byte-for-byte (the whole point of the newline claim: no JSON drift).
//  2. DECISION: decideIdentity denies every failure mode (no claim, missing headers, unregistered seat,
//     wrong key, bad signature) and only accepts a valid, registered, verifying identity.
// Plus the flag-gated /mcp path via convexTest: OFF is byte-identical (legacy neopId), ON fails closed.

import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api.js";
import schema from "../convex/schema.js";
import {
  verifyIdentityClaim,
  decideIdentity,
  pubkeysEqual,
} from "../convex/access/edgeIdentity.js";

// A FIXED vector produced by the Python shim (Ed25519Signer.from_seed(bytes(range(32)))) signing
// `_identity_claim("pal_test","aria","palace_search")`. If the JS verify ever stops accepting this, the
// two sides have drifted — a real Gate-D break, not a flaky test.
const VECTOR = {
  palaceId: "pal_test",
  neopId: "aria",
  tool: "palace_search",
  pubkey: "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=",
  sig: "/QKBfUDTsIG8MGnxRjDoV0llplcaXfZVCmsHkCLYjrWq/DBgBdnekrzOcJEV2ay1spjutAmdXEH4TiH0hbh5Aw==",
};

describe("edgeIdentity — cross-language signature", () => {
  test("verifies the Python-shim-signed identity claim (byte-for-byte agreement)", () => {
    expect(verifyIdentityClaim(VECTOR.pubkey, VECTOR.palaceId, VECTOR.neopId, VECTOR.tool, VECTOR.sig))
      .toBe(true);
  });

  test("rejects the same signature against a forged seat / palace / tool", () => {
    expect(verifyIdentityClaim(VECTOR.pubkey, VECTOR.palaceId, "recon", VECTOR.tool, VECTOR.sig)).toBe(false);
    expect(verifyIdentityClaim(VECTOR.pubkey, "pal_other", VECTOR.neopId, VECTOR.tool, VECTOR.sig)).toBe(false);
    expect(verifyIdentityClaim(VECTOR.pubkey, VECTOR.palaceId, VECTOR.neopId, "palace_remember", VECTOR.sig)).toBe(false);
  });

  test("a malformed pubkey/sig returns false, never throws", () => {
    expect(verifyIdentityClaim("!!not-b64!!", VECTOR.palaceId, VECTOR.neopId, VECTOR.tool, VECTOR.sig)).toBe(false);
    expect(verifyIdentityClaim(VECTOR.pubkey, VECTOR.palaceId, VECTOR.neopId, VECTOR.tool, "!!nope!!")).toBe(false);
  });
});

describe("edgeIdentity — decideIdentity", () => {
  const base = {
    palaceId: VECTOR.palaceId,
    claimedNeopId: VECTOR.neopId,
    tool: VECTOR.tool,
    presentedPubkeyB64: VECTOR.pubkey,
    signatureB64: VECTOR.sig,
    registeredPubkeyB64: VECTOR.pubkey,
  };

  test("accepts a valid, registered, verifying identity", () => {
    expect(decideIdentity(base)).toEqual({ ok: true, neopId: "aria" });
  });

  test("denies each failure mode with a reason, never falling back", () => {
    expect(decideIdentity({ ...base, claimedNeopId: null }).ok).toBe(false);
    expect(decideIdentity({ ...base, presentedPubkeyB64: null }).ok).toBe(false);
    expect(decideIdentity({ ...base, signatureB64: null }).ok).toBe(false);
    expect(decideIdentity({ ...base, registeredPubkeyB64: null }).ok).toBe(false); // unregistered seat
    // presented key differs from the registered key (attacker signs with their own key)
    const other = "AAAAv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=";
    expect(decideIdentity({ ...base, presentedPubkeyB64: other, registeredPubkeyB64: VECTOR.pubkey }).ok).toBe(false);
    // presented==registered but the signature is over a different claim (tampered neopId)
    expect(decideIdentity({ ...base, claimedNeopId: "recon" }).ok).toBe(false);
  });

  test("pubkeysEqual is length-safe and value-correct", () => {
    expect(pubkeysEqual(VECTOR.pubkey, VECTOR.pubkey)).toBe(true);
    expect(pubkeysEqual(VECTOR.pubkey, VECTOR.pubkey.slice(0, -1))).toBe(false);
    expect(pubkeysEqual("a", "b")).toBe(false);
  });
});

describe("/mcp Gate-D flag (enable_bridge_identity)", () => {
  async function makePalace(t: ReturnType<typeof convexTest>) {
    return await t.mutation(api.palace.mutations.createPalace, {
      name: "P", clientId: "c", falkordbGraph: "g", createdBy: "system",
    });
  }
  const post = (t: ReturnType<typeof convexTest>, palaceId: string, headers: Record<string, string> = {}) =>
    t.fetch("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ tool: "palace_search", palaceId, neopId: "aria", params: { query: "x" } }),
    });

  test("OFF (default): no identity headers required — request is NOT denied at the edge", async () => {
    delete process.env.ENABLE_BRIDGE_IDENTITY;
    const t = convexTest(schema);
    const palaceId = await makePalace(t);
    const res = await post(t, palaceId); // no X-NEop-* headers
    const bodyText = await res.text();
    expect(bodyText).not.toContain("identity_denied"); // legacy path, byte-identical to today
  });

  test("ON without a signed identity → 403 identity_denied at the edge (fail-closed)", async () => {
    process.env.ENABLE_BRIDGE_IDENTITY = "true";
    try {
      const t = convexTest(schema);
      const palaceId = await makePalace(t);
      const res = await post(t, palaceId); // still no identity headers
      expect(res.status).toBe(403);
      const j = await res.json();
      expect(j).toMatchObject({ error: "identity_denied", denied_at_layer: "edge" });
    } finally {
      delete process.env.ENABLE_BRIDGE_IDENTITY;
    }
  });

  test("ON with an unregistered but validly-signed seat → still denied (key not registered)", async () => {
    process.env.ENABLE_BRIDGE_IDENTITY = "true";
    try {
      const t = convexTest(schema);
      const palaceId = await makePalace(t);
      // valid signature + pubkey, but the seat's key was never registered in neop_keys
      const res = await post(t, palaceId, {
        "X-NEop-Pubkey": VECTOR.pubkey,
        "X-NEop-Identity": VECTOR.sig,
      });
      expect(res.status).toBe(403);
    } finally {
      delete process.env.ENABLE_BRIDGE_IDENTITY;
    }
  });
});

describe("neop_keys registry", () => {
  test("register (insert then rotate) and read back the pubkey", async () => {
    const t = convexTest(schema);
    const palaceId = await t.mutation(api.palace.mutations.createPalace, {
      name: "P", clientId: "c", falkordbGraph: "g", createdBy: "system",
    });
    const ins = await t.mutation(internal.palace.neopKeys.registerNeopKey, {
      palaceId, neopId: "aria", pubkey: VECTOR.pubkey,
    });
    expect(ins).toMatchObject({ status: "ok", rotated: false });
    const got = await t.query(internal.palace.neopKeys.getNeopKey, { palaceId, neopId: "aria" });
    expect(got?.pubkey).toBe(VECTOR.pubkey);
    const rot = await t.mutation(internal.palace.neopKeys.registerNeopKey, {
      palaceId, neopId: "aria", pubkey: "NEWKEYv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=",
    });
    expect(rot).toMatchObject({ rotated: true });
    const got2 = await t.query(internal.palace.neopKeys.getNeopKey, { palaceId, neopId: "aria" });
    expect(got2?.pubkey).toContain("NEWKEY");
    // never-registered seat → null
    expect(await t.query(internal.palace.neopKeys.getNeopKey, { palaceId, neopId: "ghost" })).toBeNull();
  });
});
