// Enum sets used by validators. Schema literals in convex/schema.ts must match.

export const HALL_TYPES = [
  "decisions",
  "facts",
  "conversations",
  "lessons",
  "preferences",
  "tasks",
  "procedures",
  "signals",
  "identities",
] as const;
export type HallType = (typeof HALL_TYPES)[number];

export const CATEGORIES = [
  "identity",
  "fact",
  "decision",
  "task",
  "conversation",
  "lesson",
  "preference",
  "procedure",
  "signal",
  "goal",
  "relationship",
  "metric",
  "question",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SOURCE_TYPES = [
  "claude_chat",
  "meeting",
  "document",
  "slack",
  "email",
  "manual",
  "palace-promote",
  "palace-audit",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const AUTHOR_TYPES = ["neop", "human", "adapter", "system"] as const;
export type AuthorType = (typeof AUTHOR_TYPES)[number];

export const VISIBILITIES = ["default", "restricted", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const TUNNEL_RELATIONSHIPS = [
  "depends_on",
  "contradicts",
  "extends",
  "caused_by",
  "clarifies",
  "references",
] as const;
export type TunnelRelationship = (typeof TUNNEL_RELATIONSHIPS)[number];

export const RUNTIME_OPS = [
  "recall",
  "remember",
  "promote",
  "erase",
  "audit",
] as const;
export type RuntimeOp = (typeof RUNTIME_OPS)[number];

export const PII_TAGS = ["email", "phone", "pan", "credit_card", "aws_key", "name"] as const;
export type PiiTag = (typeof PII_TAGS)[number];

// ───── category default TTLs (Phase 8 decay engine consults this) ─────

export const CATEGORY_TTL_DEFAULTS: Partial<Record<Category, number>> = {
  signal: 7 * 24 * 60 * 60,             // 7 days
  conversation: 90 * 24 * 60 * 60,      // 90 days
  // task: 30 days after resolution — needs resolution tracking, deferred
  // everything else: undefined = never expires
};

// ───── KG-backed categories (mirrored to Graphiti) ─────

export const KG_BACKED_CATEGORIES = new Set<Category>([
  "decision",
  "lesson",
  "identity",
  "relationship",
]);

// ───── Convex document size guard ─────

// Convex enforces a 1MB document limit. Leave headroom for metadata.
export const MAX_CONTENT_BYTES = 900_000;
