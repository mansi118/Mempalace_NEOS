// ─── Phase-A → Phase-B completeness guard (S0.3 _system actor flip) ───────────
//
// This is the GATE for the breaking flip. Today (Phase A), the SoT write/read
// predicates in convex/access/enforce.ts treat `actorNeopId === undefined` as a
// TRUSTED internal caller (fail-OPEN). Phase B flips that branch to DENY.
//
// That flip is SAFE *only* when every internal call site of the guarded room
// mutations passes an explicit `actorNeopId` (a seat, "_admin", or the trusted
// internal "_system") — otherwise the flip would break a path that silently
// relied on undefined-⇒-trusted.
//
// This test reads the actual source (convex/ + scripts/, excluding _generated,
// node_modules, and test files) and asserts that EVERY call to a guarded
// mutation passes an `actorNeopId` argument. It MUST be green before Phase B is
// undertaken. After the Phase-A migration it passes; before it, it would fail.

import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// Repo root is one level up from tests/.
const ROOT = resolve(__dirname, "..");

// The guarded room mutations (+ getOrCreateRoom) whose call sites must carry an
// explicit actor for the Phase-B flip to be safe.
const GUARDED = [
  "createCloset",
  "createDrawer",
  "createTunnel",
  "mergeRooms",
  "retractCloset",
  "invalidateDrawer",
  "getOrCreateRoom",
] as const;

// Source roots to scan, and what to exclude.
const SCAN_DIRS = ["convex", "scripts"];
const EXCLUDE_DIR_RE = /(^|\/)(_generated|node_modules)(\/|$)/;
const EXCLUDE_FILE_RE = /\.test\.ts$/;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const rel = full.slice(ROOT.length + 1);
    if (EXCLUDE_DIR_RE.test(rel)) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (full.endsWith(".ts") && !EXCLUDE_FILE_RE.test(full)) {
      out.push(full);
    }
  }
  return out;
}

// From `start`, find the next `{`-delimited object literal and return its
// balanced body. The two call shapes we must handle both put the args object
// immediately after the mutation reference:
//   • api.palace.mutations.createCloset, { ...args... }   (runMutation(ref, obj))
//   • api.palace.mutations.createCloset({ ...args... })   (client.mutation(ref, obj) / direct)
// We scan to the first `{` after the reference and capture to its matching `}`,
// tracking depth so a multi-line / nested object is captured whole.
function nextObjectBody(src: string, start: number): string | null {
  const open = src.indexOf("{", start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  // Unbalanced — return the rest; the assertion will then flag it loudly.
  return src.slice(open + 1);
}

interface CallSite {
  file: string;
  line: number;
  fn: string;
  hasActor: boolean;
}

function findCallSites(file: string): CallSite[] {
  const src = readFileSync(file, "utf8");
  const sites: CallSite[] = [];
  for (const fn of GUARDED) {
    // Match the mutation reference as a property access, e.g.
    // `api.palace.mutations.createCloset` or `mutations.createCloset`. We anchor
    // on `.${fn}` so the mutation *definitions* in convex/palace/mutations.ts
    // (`export const createCloset = mutation({`, no leading dot) are NOT matched.
    // A following `(` or `,` distinguishes a real reference from a substring.
    const re = new RegExp(`\\.${fn}\\s*[(,]`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const body = nextObjectBody(src, m.index);
      const line = src.slice(0, m.index).split("\n").length;
      // Accept both `actorNeopId: <value>` and ES6 shorthand `actorNeopId` (a
      // bare property terminated by comma / newline / closing brace).
      const hasActor =
        body !== null && /\bactorNeopId\s*(:|,|\}|$|[\r\n])/.test(body);
      sites.push({ file: file.slice(ROOT.length + 1), line, fn, hasActor });
    }
  }
  return sites;
}

const ALL_SITES: CallSite[] = SCAN_DIRS.flatMap((d) =>
  listSourceFiles(join(ROOT, d)).flatMap(findCallSites),
);

describe("Phase-A actor coverage (Phase-B flip gate)", () => {
  test("the scan finds the known guarded call sites (self-check)", () => {
    // Sanity: ensure the scanner is actually wired and finding call sites, so a
    // future regression in the scanner can't make this guard vacuously pass.
    expect(ALL_SITES.length).toBeGreaterThan(0);
  });

  test("every guarded mutation call site passes an explicit actorNeopId", () => {
    const missing = ALL_SITES.filter((s) => !s.hasActor).map(
      (s) => `${s.file}:${s.line} → ${s.fn}() is missing actorNeopId`,
    );
    expect(
      missing,
      `These internal callers rely on undefined-⇒-trusted and would break the ` +
        `Phase-B undefined⇒DENY flip:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});
