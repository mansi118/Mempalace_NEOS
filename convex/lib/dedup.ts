// Dedup key computation.
//
// Two concerns, two functions:
//   computeDedupKey(adapter, externalId)   — source-level identity. Stable per
//     upstream item. Re-ingesting the same source finds the existing head row
//     via this key; the handler then compares content to decide noop vs version.
//
//   normalizeContent(content)   — canonicalizes whitespace so trivial reformatting
//     (extra spaces, leading/trailing whitespace) resolves to noop instead of
//     creating spurious versions.
//
// Why split them: the audited MemPalace design wanted both idempotency (same
// source re-ingested = noop) AND version chains (same source with updated
// content = v2). A single content-bearing dedup key can't give you both.

/**
 * Source-level dedup key. SHA-256 of (adapter, externalId).
 *
 * Stable per upstream item. Does NOT include content, so a source whose
 * content changes over time produces a new version, not a duplicate head.
 *
 * Returns 64-char lowercase hex string.
 */
export async function computeDedupKey(
  adapter: string,
  externalId: string,
): Promise<string> {
  const payload = `${adapter}\x00${externalId}`;
  const data = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bufferToHex(digest);
}

/**
 * Whitespace-normalize content for content-level comparison.
 * - trim leading/trailing whitespace
 * - collapse runs of whitespace (including newlines) to single space
 */
export function normalizeContent(content: string): string {
  return content.trim().replace(/\s+/g, " ");
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Stable item ID (closet ID is the Convex doc ID; this is for external references
 * like Graphiti node properties or audit trails).
 *
 * Format: ci_<wing>_<category>_<short-hash>_<version>
 */
export async function computeItemRef(opts: {
  wing: string;
  category: string;
  dedupKey: string;
  version: number;
}): Promise<string> {
  const payload = `${opts.wing}/${opts.category}/${opts.dedupKey}/v${opts.version}`;
  const data = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = bufferToHex(digest);
  return `ci_${opts.wing}_${opts.category}_${hex.slice(0, 16)}_v${opts.version}`;
}
