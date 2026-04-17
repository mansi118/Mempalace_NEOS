// Field-level validators called inside mutations before db writes.
// Convex's v.* validators check types but not ranges/enums fully —
// these add the constraints the schema can't express.

import {
  AUTHOR_TYPES,
  CATEGORIES,
  HALL_TYPES,
  MAX_CONTENT_BYTES,
  RUNTIME_OPS,
  SOURCE_TYPES,
  TUNNEL_RELATIONSHIPS,
  VISIBILITIES,
  type AuthorType,
  type Category,
  type HallType,
  type SourceType,
  type TunnelRelationship,
  type Visibility,
} from "./enums.js";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ValidationError(message);
}

// ───── range validators ─────

export function validateConfidence(value: number, fieldName = "confidence"): void {
  assert(
    Number.isFinite(value) && value >= 0 && value <= 1,
    `${fieldName} must be in [0, 1], got ${value}`,
  );
}

export function validateStrength(value: number): void {
  assert(
    Number.isFinite(value) && value >= 0 && value <= 1,
    `strength must be in [0, 1], got ${value}`,
  );
}

export function validateTtlSeconds(value: number | undefined): void {
  if (value === undefined) return;
  assert(
    Number.isFinite(value) && value >= 0 && Number.isInteger(value),
    `ttlSeconds must be a non-negative integer, got ${value}`,
  );
}

// ───── enum validators ─────

export function validateCategory(value: string): asserts value is Category {
  assert(
    (CATEGORIES as readonly string[]).includes(value),
    `invalid category: ${value} (must be one of ${CATEGORIES.join(", ")})`,
  );
}

export function validateHallType(value: string): asserts value is HallType {
  assert(
    (HALL_TYPES as readonly string[]).includes(value),
    `invalid hall type: ${value} (must be one of ${HALL_TYPES.join(", ")})`,
  );
}

export function validateSourceType(value: string): asserts value is SourceType {
  assert(
    (SOURCE_TYPES as readonly string[]).includes(value),
    `invalid sourceType: ${value}`,
  );
}

export function validateAuthorType(value: string): asserts value is AuthorType {
  assert(
    (AUTHOR_TYPES as readonly string[]).includes(value),
    `invalid authorType: ${value}`,
  );
}

export function validateVisibility(value: string): asserts value is Visibility {
  assert(
    (VISIBILITIES as readonly string[]).includes(value),
    `invalid visibility: ${value}`,
  );
}

export function validateTunnelRelationship(value: string): asserts value is TunnelRelationship {
  assert(
    (TUNNEL_RELATIONSHIPS as readonly string[]).includes(value),
    `invalid tunnel relationship: ${value}`,
  );
}

export function validateRuntimeOps(values: readonly string[]): void {
  for (const v of values) {
    assert(
      (RUNTIME_OPS as readonly string[]).includes(v),
      `invalid runtime op: ${v}`,
    );
  }
}

// ───── content / string validators ─────

export function validateContent(content: string): void {
  assert(typeof content === "string", "content must be a string");
  assert(content.trim().length > 0, "content cannot be empty or whitespace-only");
  // Conservative byte estimate: each char up to 4 bytes in UTF-8.
  // Use Buffer.byteLength when running in Node-like environments.
  const byteLen =
    typeof Buffer !== "undefined"
      ? Buffer.byteLength(content, "utf8")
      : new Blob([content]).size;
  assert(
    byteLen <= MAX_CONTENT_BYTES,
    `content too large: ${byteLen} bytes (max ${MAX_CONTENT_BYTES})`,
  );
}

export function validateNonEmpty(value: string, fieldName: string): void {
  assert(typeof value === "string" && value.trim().length > 0, `${fieldName} cannot be empty`);
}

// ───── slug ─────

const SLUG_RE = /^[a-z0-9_]+(?:-[a-z0-9_]+)*$/;

export function validateSlug(value: string, fieldName: string): void {
  // Allow underscore prefix for system rooms like "_shared", "_events", "_quarantine".
  assert(
    SLUG_RE.test(value),
    `${fieldName} must be a slug (lowercase, hyphenated): got "${value}"`,
  );
}

// ───── content access JSON shape ─────

// Validates the JSON shape stored in neop_permissions.contentAccess.
// Throws if structurally wrong; returns parsed object on success.
export function validateContentAccess(json: string): Record<
  string,
  { read: "*" | string[]; write: "*" | string[] }
> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ValidationError("contentAccess must be valid JSON");
  }
  assert(parsed !== null && typeof parsed === "object", "contentAccess must be a JSON object");
  const obj = parsed as Record<string, unknown>;
  for (const [wing, rules] of Object.entries(obj)) {
    assert(
      rules !== null && typeof rules === "object",
      `contentAccess.${wing} must be an object`,
    );
    const r = rules as Record<string, unknown>;
    for (const op of ["read", "write"]) {
      const val = r[op];
      const ok =
        val === "*" ||
        (Array.isArray(val) &&
          val.every((c) => typeof c === "string" && (CATEGORIES as readonly string[]).includes(c)));
      assert(ok, `contentAccess.${wing}.${op} must be "*" or array of valid categories`);
    }
  }
  return obj as Record<string, { read: "*" | string[]; write: "*" | string[] }>;
}
