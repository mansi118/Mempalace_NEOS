// Gate D — server-side verification of the signed X-NEop-Identity claim (the shim's Ed25519 signature).
//
// The shim (neop_jcode_adapter/palace_mcp_shim.py) signs `${palaceId}\n${neopId}\n${tool}` — the
// canonicalization-safe identity claim (all-string, non-model fields, so these exact bytes reconstruct in
// JS with zero Python↔JS JSON drift) — and sends X-NEop-Identity (sig) + X-NEop-Pubkey (the presented key).
// This module verifies that signature. Binding the presented key to a REGISTERED key for the seat is the
// caller's job (http.ts looks up neop_keys) — verifyIdentityClaim only proves the holder of THIS pubkey
// signed THIS claim. Both together = "the caller holds seat <neopId>'s registered private key".
//
// Pure JS (no WebCrypto Ed25519 dependency) so it runs identically in the Convex runtime and in the
// convex-test Node harness. sha512 is @noble/hashes (pure JS); ed25519 is @noble/ed25519 (audited).

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2";

// @noble/ed25519 v2 needs a sha512 hook for its synchronous verify.
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

function unb64(s: string): Uint8Array {
  // base64 → bytes, tolerant of standard base64 (the shim emits standard, not url-safe).
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// The exact bytes the shim signed. Keep this byte-identical to shim `_identity_claim`.
export function identityClaimBytes(palaceId: string, neopId: string, tool: string): Uint8Array {
  return new TextEncoder().encode(`${palaceId}\n${neopId}\n${tool}`);
}

// Verify an Ed25519 signature over the identity claim. Returns true iff the signature is valid for the
// presented pubkey — NEVER throws on a bad signature or malformed input (a verify that throws could be
// mistaken for a 500; a forged claim must read as `false`, an explicit deny).
export function verifyIdentityClaim(
  presentedPubkeyB64: string,
  palaceId: string,
  neopId: string,
  tool: string,
  signatureB64: string,
): boolean {
  try {
    const msg = identityClaimBytes(palaceId, neopId, tool);
    return ed.verify(unb64(signatureB64), msg, unb64(presentedPubkeyB64));
  } catch {
    return false;
  }
}

// Constant-time-ish equality for the pubkey binding check (presented == registered). The pubkeys are not
// secret, but comparing without an early length/content branch keeps the binding decision uniform.
export function pubkeysEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type IdentityDecision =
  | { ok: true; neopId: string }
  | { ok: false; reason: string };

/**
 * The full Gate-D decision for one request, PURE over the registered pubkey (http.ts supplies it from
 * neop_keys). Confirms: a claimed neopId, a presented pubkey + signature, the seat has a registered key,
 * the presented key IS that registered key, and the signature verifies over (palaceId, claimedNeopId,
 * tool). Any failure is an explicit deny with a reason — never a fallback to _admin.
 */
export function decideIdentity(args: {
  palaceId: string;
  claimedNeopId: string | null | undefined;
  tool: string;
  presentedPubkeyB64: string | null | undefined;
  signatureB64: string | null | undefined;
  registeredPubkeyB64: string | null | undefined;
}): IdentityDecision {
  const { palaceId, claimedNeopId, tool, presentedPubkeyB64, signatureB64, registeredPubkeyB64 } = args;
  if (!claimedNeopId) return { ok: false, reason: "no claimed neopId" };
  if (!presentedPubkeyB64 || !signatureB64) {
    return { ok: false, reason: "missing X-NEop-Pubkey / X-NEop-Identity (bridge identity enforced)" };
  }
  if (!registeredPubkeyB64) {
    return { ok: false, reason: `no registered key for seat ${claimedNeopId}` };
  }
  if (!pubkeysEqual(presentedPubkeyB64, registeredPubkeyB64)) {
    return { ok: false, reason: `presented key does not match the registered key for ${claimedNeopId}` };
  }
  if (!verifyIdentityClaim(presentedPubkeyB64, palaceId, claimedNeopId, tool, signatureB64)) {
    return { ok: false, reason: "signature does not verify over (palaceId, neopId, tool)" };
  }
  return { ok: true, neopId: claimedNeopId };
}
