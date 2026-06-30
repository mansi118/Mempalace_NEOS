// PALACE schema — Phase 1
//
// Reconciles the PALACE plan's hierarchy (palace → wing → hall → room → closet → drawer)
// with the audited MemPalace v3.3.0 design (25-field MemoryItem, append-only writes,
// per-(wing, category) access control, audit log on every op).
//
// Key invariants enforced by this schema and the mutations that write it:
//   - Every closet has a dedupKey; duplicate (palace, dedupKey) is collapsed to noop.
//   - Closets are append-only: updates create a new version with supersedes pointer.
//   - Embeddings are versioned by model + modelVersion (so we can swap Voyage 4 → 5 safely).
//   - Palaces have a status field; only "ready" palaces are returned by serving queries.
//   - Halls are navigational containers for rooms; categories drive access control.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ───── enum literals (single source of truth, also exported from lib/enums.ts) ─────

const palaceStatus = v.union(
  v.literal("provisioning"),
  v.literal("ready"),
  v.literal("failed"),
  v.literal("archived"),
);

const hallType = v.union(
  v.literal("decisions"),
  v.literal("facts"),
  v.literal("conversations"),
  v.literal("lessons"),
  v.literal("preferences"),
  v.literal("tasks"),
  v.literal("procedures"),
  v.literal("signals"),
  v.literal("identities"),
);

const category = v.union(
  // v1 categories
  v.literal("identity"),
  v.literal("fact"),
  v.literal("decision"),
  v.literal("task"),
  v.literal("conversation"),
  v.literal("lesson"),
  v.literal("preference"),
  v.literal("procedure"),
  v.literal("signal"),
  // v2-reserved (allowed at write time, future code lights up)
  v.literal("goal"),
  v.literal("relationship"),
  v.literal("metric"),
  v.literal("question"),
);

const sourceType = v.union(
  v.literal("claude_chat"),
  v.literal("meeting"),
  v.literal("document"),
  v.literal("slack"),
  v.literal("email"),
  v.literal("manual"),
  v.literal("palace-promote"),
  v.literal("palace-audit"),
);

const authorType = v.union(
  v.literal("neop"),
  v.literal("human"),
  v.literal("adapter"),
  v.literal("system"),
);



const visibility = v.union(

  v.literal("default"),
  v.literal("restricted"),
  v.literal("public"),
);

const embeddingStatus = v.union(
  v.literal("pending"),
  v.literal("generated"),
  v.literal("failed"),
);

const graphitiStatus = v.union(
  v.literal("pending"),
  v.literal("ingested"),
  v.literal("failed"),
  v.literal("skipped"),
);

const wingPhase = v.union(
  v.literal("onboarding"),
  v.literal("active"),
  v.literal("maintenance"),
  v.literal("offboarding"),
);

const tunnelRelationship = v.union(
  v.literal("depends_on"),
  v.literal("contradicts"),
  v.literal("extends"),
  v.literal("caused_by"),
  v.literal("clarifies"),
  v.literal("references"),
);

const auditOp = v.union(
  v.literal("recall"),
  v.literal("remember"),
  v.literal("promote"),
  v.literal("erase"),
  v.literal("search"),
  v.literal("create"),
  v.literal("retract"),
  v.literal("invalidate"),
);

const auditStatus = v.union(
  v.literal("ok"),
  v.literal("noop"),
  v.literal("error"),
  v.literal("denied"),
);

// Which enforcement layer denied an op (#12). Unifies the denial signal across the stack so
// the Day-90 "isolation holds" bar is measurable: edge-auth → "edge", NEOS broker → "broker",
// Convex SoT dispatch/mutations → "convex_sot", FalkorDB bridge → "falkordb".
const deniedAtLayer = v.union(
  v.literal("edge"),
  v.literal("broker"),
  v.literal("convex_sot"),
  v.literal("falkordb"),
);

const ingestionStatus = v.union(
  v.literal("pending"),
  v.literal("extracted"),
  v.literal("failed"),
);

// ───── tables ─────

export default defineSchema({

  // ── PALACE ───────────────────────────────────────────────────

  palaces: defineTable({
    name: v.string(),
    clientId: v.string(),
    createdAt: v.number(),
    createdBy: v.string(),                 // neopId or "_admin" or "system"
    status: palaceStatus,                  // gates serving queries
    schemaVersion: v.number(),             // for migration runner
    falkordbGraph: v.string(),             // FalkorDB graph name (per palace)
    l0_briefing: v.string(),               // ~50 token identity summary
    l1_wing_index: v.string(),             // ~120 token wing map
  })
    .index("by_client", ["clientId"])
    .index("by_status", ["status"]),

  // ── WINGS ────────────────────────────────────────────────────

  wings: defineTable({
    palaceId: v.id("palaces"),
    name: v.string(),                      // "platform", "clients", ...
    description: v.string(),
    sortOrder: v.number(),
    roomCount: v.number(),                 // denormalized; reconciled by Phase 8 cron
    lastActivity: v.number(),
    archived: v.boolean(),                 // K1 churn flow
    phase: v.optional(wingPhase),          // K4 lifecycle
  })
    .index("by_palace", ["palaceId"])
    .index("by_palace_name", ["palaceId", "name"]),

  // ── HALLS (navigational grouping under wings) ────────────────

  halls: defineTable({
    wingId: v.id("wings"),
    palaceId: v.id("palaces"),
    type: hallType,
    roomCount: v.number(),                 // count of rooms with primary_hall = this hall
  })
    .index("by_wing", ["wingId"])
    .index("by_wing_type", ["wingId", "type"])
    .index("by_palace_type", ["palaceId", "type"]),

  // ── ROOMS ────────────────────────────────────────────────────

  rooms: defineTable({
    hallId: v.id("halls"),                 // primary_hall (Option A from analysis)
    wingId: v.id("wings"),
    palaceId: v.id("palaces"),
    name: v.string(),
    summary: v.string(),
    closetCount: v.number(),               // denormalized
    lastUpdated: v.number(),
    tags: v.array(v.string()),
    // Seat-isolation (Phase 1 ACL). Set = PERSONAL room owned by that seat (neopId);
    // unset/undefined = shared COMPANY room (all legacy rooms + admin-created). Additive,
    // non-breaking: existing rows read back as company rooms. Write-scope keys on this.
    ownerNeopId: v.optional(v.string()),
  })
    .index("by_hall", ["hallId"])
    .index("by_wing", ["wingId"])
    .index("by_palace", ["palaceId"])
    .index("by_palace_name", ["palaceId", "name"])
    .index("by_wing_name", ["wingId", "name"])
    .index("by_palace_owner", ["palaceId", "ownerNeopId"])
    // Owner-namespaced room resolution (Gate B-2): the same display name can exist once
    // per owner — a seat's "stack" is distinct from the company "stack" and from another
    // seat's "stack". ownerNeopId=undefined keys the shared COMPANY namespace (legacy rooms).
    .index("by_palace_owner_name", ["palaceId", "ownerNeopId", "name"])
    .searchIndex("search_rooms", {
      searchField: "name",
      filterFields: ["palaceId", "wingId"],
    }),

  // ── CLOSETS (full MemoryItem provenance, append-only) ────────

  closets: defineTable({
    // Address
    roomId: v.id("rooms"),
    hallId: v.id("halls"),
    wingId: v.id("wings"),
    palaceId: v.id("palaces"),

    // Content
    content: v.string(),
    title: v.optional(v.string()),

    // Classification
    category: category,
    sourceType: sourceType,
    sourceRef: v.optional(v.string()),
    sourceAdapter: v.string(),
    sourceExternalId: v.string(),

    // Provenance
    authorType: authorType,
    authorId: v.string(),

    // Identity & versioning
    version: v.number(),
    supersedes: v.optional(v.id("closets")),
    supersededBy: v.optional(v.id("closets")),
    schemaVersion: v.number(),

    // Quality
    confidence: v.number(),                // [0, 1] — validated at mutation
    needsReview: v.boolean(),
    conflictGroupId: v.optional(v.string()),

    // Lifecycle
    createdAt: v.number(),
    updatedAt: v.number(),
    ttlSeconds: v.optional(v.number()),
    decayed: v.boolean(),
    retracted: v.boolean(),
    legalHold: v.boolean(),

    // Privacy
    piiTags: v.array(v.string()),
    visibility: visibility,

    // Pipeline status (lets us re-embed / re-graphify failed rows)
    embeddingStatus: embeddingStatus,
    graphitiStatus: graphitiStatus,

    // Dedup
    dedupKey: v.string(),

    // Entity extraction cache (Llama 4 Scout → FalkorDB direct writes)
    entitiesExtracted: v.optional(v.boolean()),
    entitiesCount: v.optional(v.number()),
    relationsCount: v.optional(v.number()),
  })
    .index("by_room", ["roomId"])
    .index("by_palace", ["palaceId"])
    .index("by_wing", ["wingId"])
    .index("by_palace_category", ["palaceId", "category"])
    .index("by_time", ["palaceId", "createdAt"])
    .index("by_dedup", ["palaceId", "dedupKey"])           // critical: dedup race-safety
    .index("by_palace_decayed", ["palaceId", "decayed"])
    .index("by_palace_review", ["palaceId", "needsReview"])
    .index("by_embedding_status", ["palaceId", "embeddingStatus"])
    .index("by_graphiti_status", ["palaceId", "graphitiStatus"])
    // Hybrid retrieval (ADR-neop-runtime GAP-1 floor fix): a lexical/full-text channel alongside the
    // vector index, so exact-term queries hit hard and a strong lexical match can surface even when its
    // cosine score is marginal. Mirrors the rooms `search_rooms` index.
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["palaceId"],
    }),

  // ── DRAWERS (atomic facts, temporally valid) ─────────────────

  drawers: defineTable({
    closetId: v.id("closets"),
    roomId: v.id("rooms"),
    palaceId: v.id("palaces"),
    fact: v.string(),
    validFrom: v.number(),
    validUntil: v.optional(v.number()),    // undefined = still valid
    supersededBy: v.optional(v.id("drawers")),
    graphitiNodeId: v.optional(v.string()),
    confidence: v.number(),
  })
    .index("by_closet", ["closetId"])
    .index("by_room", ["roomId"])
    .index("by_palace_valid", ["palaceId", "validUntil"]),

  // ── TUNNELS (cross-room corridors) ───────────────────────────

  tunnels: defineTable({
    palaceId: v.id("palaces"),
    fromRoomId: v.id("rooms"),
    toRoomId: v.id("rooms"),
    relationship: tunnelRelationship,
    strength: v.number(),                  // [0, 1] — validated at mutation
    createdAt: v.number(),
    label: v.optional(v.string()),
  })
    .index("by_palace", ["palaceId"])
    .index("by_palace_from", ["palaceId", "fromRoomId"])
    .index("by_palace_to", ["palaceId", "toRoomId"]),

  // ── TWINS (per-seat structured state — ADDRESSED, never searched) ──
  //
  // A twin is one structured record per (palaceId, neopId). Unlike closets it is NOT embedded,
  // NOT vector-indexed, and never surfaces in palace_search — it is fetched/written by address.
  // `doc` is the serialized twin JSON; the NEOS broker (MemoryBroker.put_twin) is the SOLE owner
  // of versioning + stale-base rejection (see MEMPALACE_TWIN_CONTRACT.md). putTwin here is a
  // blind "latest wins" upsert with NO server-side version check — single owner, no double-gate.
  // Safe under single-writer-per-twin (Twin Curator); concurrent writers would need a server-side
  // conditional upsert (write iff stored version == base). version/maturity are denormalized for
  // cheap reads/debugging only; `doc` is the source of truth.
  twins: defineTable({
    palaceId: v.id("palaces"),
    neopId: v.string(),                    // = seat (the routed NEop)
    doc: v.string(),                       // serialized twin JSON (broker owns the schema)
    version: v.number(),                   // denormalized; broker is source of truth
    maturity: v.string(),                  // denormalized: seed|growing|mature|drifted
    updatedAt: v.number(),
  })
    .index("by_palace_neop", ["palaceId", "neopId"]),

  // ── PAUSED RUNS (AwaitingApproval durable pause; P2) ─────────
  // One row per paused NEop run, addressed by (palaceId, neopId, runId). `state` is the runtime's
  // to_state snapshot (runtime owns the shape; server is a blind store, like twins). The Decision
  // Queue reads pending rows by tenant+status; resume loads by runId and reconstructs the Pi-agent.
  paused_runs: defineTable({
    palaceId: v.id("palaces"),
    neopId: v.string(),                    // = seat that owns the paused run
    runId: v.string(),                     // correlation key (Decision Queue ↔ resume)
    state: v.any(),                        // serialized to_state snapshot (runtime-owned shape)
    status: v.string(),                    // "pending" | "resolved"
    updatedAt: v.number(),
  })
    .index("by_palace_neop_run", ["palaceId", "neopId", "runId"])
    .index("by_palace_run", ["palaceId", "runId"]) // load/resolve key here → neopId read FROM the row
    .index("by_palace_status", ["palaceId", "status"]),

  // ── VECTOR EMBEDDINGS (versioned by model) ───────────────────

  closet_embeddings: defineTable({
    closetId: v.id("closets"),
    palaceId: v.id("palaces"),
    wingId: v.id("wings"),
    embedding: v.array(v.float64()),       // Gemini Embedding: 768 dims
    model: v.string(),                     // "voyage-3-large"
    modelVersion: v.string(),              // "2026-04"
    generatedAt: v.number(),
  })
    .index("by_closet", ["closetId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["palaceId", "wingId"],
    }),

  // ── ACCESS CONTROL ───────────────────────────────────────────

  neop_permissions: defineTable({
    palaceId: v.id("palaces"),
    neopId: v.string(),                    // "aria", "icd_zoo_media", "_admin"
    parentNeopId: v.optional(v.string()),  // scoped instance → parent NEop for content lookup
    runtimeOps: v.array(v.string()),       // [recall, remember, promote, erase, audit]
    contentAccess: v.string(),             // JSON: {wing: {read: "*"|[cats], write: "*"|[cats]}}
    scopeWing: v.optional(v.string()),
    scopeRoom: v.optional(v.string()),
  })
    .index("by_palace", ["palaceId"])
    .index("by_palace_neop", ["palaceId", "neopId"]),

  // ── EDGE-AUTH: human ↔ seat bindings (#1/#3, E1) ─────────────
  //
  // The ONLY source of requester identity. resolveBinding(mxid) → (tenant, seat, role).
  // NEVER writable from a channel path (deliberately NOT registered as an /mcp tool —
  // the http dispatch can't reach it); provisioned per tenant. Write-time validation
  // (upsertSeatBinding) REJECTS a reserved seat_id — a human is never bound to _admin/_system.
  seat_bindings: defineTable({
    mxid: v.string(),                      // Matrix user id (credential-verified by the AS)
    tenant_id: v.string(),                 // = palace/tenant; from the AS namespace, never the body
    seat_id: v.string(),                   // bound NEop seat (neopId) — never a reserved id
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
    status: v.union(v.literal("active"), v.literal("suspended")),
    updatedAt: v.number(),
  })
    .index("by_mxid", ["mxid"])
    .index("by_tenant", ["tenant_id"]),

  // ── INGESTION LOG ────────────────────────────────────────────

  ingestion_log: defineTable({
    palaceId: v.id("palaces"),
    sourceType: v.string(),
    sourceRef: v.string(),
    status: ingestionStatus,
    closetsCreated: v.number(),
    drawersCreated: v.number(),
    graphitiEpisodeId: v.optional(v.string()),
    timestamp: v.number(),
    durationMs: v.optional(v.number()),
    tokensUsed: v.optional(v.number()),
    error: v.optional(v.string()),
    adapterName: v.string(),
    watermarkCursor: v.optional(v.string()),
  })
    .index("by_palace", ["palaceId"])
    .index("by_status", ["status"])
    .index("by_palace_adapter", ["palaceId", "adapterName"])
    .index("by_palace_time", ["palaceId", "timestamp"]),

  // ── AUDIT LOG ────────────────────────────────────────────────

  audit_events: defineTable({
    palaceId: v.id("palaces"),
    op: auditOp,
    neopId: v.string(),
    effectiveNeopId: v.string(),
    status: auditStatus,
    latencyMs: v.number(),
    timestamp: v.number(),
    wing: v.optional(v.string()),
    room: v.optional(v.string()),
    category: v.optional(v.string()),
    itemId: v.optional(v.string()),
    resultCount: v.optional(v.number()),
    queryHash: v.optional(v.string()),
    extra: v.optional(v.string()),         // JSON blob
    denied_at_layer: v.optional(deniedAtLayer),   // #12: which layer denied (when status=denied)
  })
    .index("by_palace", ["palaceId"])
    .index("by_palace_time", ["palaceId", "timestamp"])
    .index("by_palace_neop", ["palaceId", "neopId"])
    .index("by_palace_status", ["palaceId", "status"]),

  // ── QUERY LOG (serves retrieval-quality analysis) ───────────────
  //
  // Every palace_search call appends a row here. Used by:
  //   - /benchmarks dashboard (recent trend)
  //   - dogfood analysis (queries with no hits, weak hits, reformulations)
  //   - query cache lookups (by queryHash, same palace, same filters)
  query_log: defineTable({
    palaceId: v.id("palaces"),
    neopId: v.optional(v.string()),
    query: v.string(),                     // truncated to 300 chars
    queryHash: v.string(),                 // hash of (query + palaceId + filters)
    resultCount: v.number(),
    topScore: v.number(),
    confidence: v.string(),                // "high" | "medium" | "low"
    latencyMs: v.number(),
    mode: v.string(),                      // "live" | "test" | "benchmark"
    wingFilter: v.optional(v.string()),
    categoryFilter: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_palace_time", ["palaceId", "createdAt"])
    .index("by_hash", ["queryHash"])
    .index("by_palace_mode", ["palaceId", "mode"]),
});
