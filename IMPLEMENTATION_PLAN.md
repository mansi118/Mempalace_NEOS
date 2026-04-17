# Context Vault — PALACE Implementation Plan

**Codename:** PALACE
**Status:** Pre-implementation
**Created:** 2026-04-16
**Stack:** Convex + FalkorDB + Graphiti + Voyage 4

---

## 0. Architecture Review — Tensions & Resolutions

Before writing a single line of code, these design tensions between the audited MemPalace v3.3.0 design and the proposed PALACE plan must be resolved. Each tension has a resolution that the implementation follows.

### T1. Single substrate → Dual substrate

| | MemPalace v3.3.0 | PALACE plan |
|---|---|---|
| Design | "One substrate, zero federation" | Convex (structured + vectors) + FalkorDB (graph) |
| Storage | ChromaDB + SQLite KG, all local | Cloud DB + self-hosted graph |

**Resolution:** Accept the dual-substrate pivot. The original single-substrate principle was correct for a local CLI tool. PALACE is a cloud-native production service — Convex handles structured storage + vector search + real-time subscriptions, FalkorDB handles temporal graph intelligence. The consistency problem is solved by making **Convex the source of truth** and FalkorDB a derived, eventually-consistent intelligence layer. If FalkorDB is down, vector search still works. If Convex is down, nothing works (correct — it's the primary).

**Consistency rule:** Every write hits Convex first (synchronous). FalkorDB ingestion is fire-and-forget from a Convex action. On read, both are queried in parallel; results are merged. A missing FalkorDB result degrades graph traversal but doesn't break retrieval.

### T2. "Hall is a tag, not a container" → Halls table reintroduced

| | MemPalace v3.3.0 | PALACE plan |
|---|---|---|
| Halls | Eliminated — became `category` field on MemoryItem | Reintroduced as a table with 6 types |

**Resolution:** Keep halls as a **navigational convenience table**, not a routing mechanism. Each wing gets 6 hall entries (decisions, facts, conversations, lessons, preferences, tasks) that serve as UI groupings. But the actual routing, access control, and retrieval continue to use the `category` field on closets/drawers — the field that replaced halls in the audited design.

**Consequence:** The halls table exists for room organization and counts. It does NOT appear in access control checks. NEop permissions operate on `(wing, category)`, not `(wing, hall)`.

### T3. 12 audited wings → 7 consolidated wings

| | MemPalace v3.3.0 | PALACE plan |
|---|---|---|
| Wings | 12 (including audit, _quarantine, partners, infra) | 7 (missing 5 critical wings) |

**Resolution:** Use the **12-wing layout from wings.yaml** as the authoritative structure. The PALACE plan's 7 wings lose P0-required infrastructure:
- `audit` — required by gap C6/I2 (every operation logged)
- `_quarantine` — required by gap A8 (DLQ for unroutable items)
- `infra` — servers, services, incidents, runbooks
- `partners` — vendors, integrations (distinct from clients)
- `marketplace` — NeP ecosystem economics

The 7 wings from the PALACE plan are a presentation-layer simplification. The data model carries all 12.

### T4. 25-field MemoryItem → 8-field closet

| | MemPalace v3.3.0 | PALACE plan |
|---|---|---|
| Schema | 25+ fields, every P0 gap closed | ~8 fields per closet |

**Resolution:** The Convex closet schema must carry forward **all P0/P1 fields** from the MemoryItem spec. The PALACE plan's thin closet schema loses: `version`, `supersedes`, `dedup_key`, `schema_version`, `needs_review`, `conflict_group_id`, `pii_tags`, `visibility`, `ttl_seconds`, `decayed`, `retracted`, `legal_hold`, and structured `author`/`source` fields.

The implementation adds these fields to the Convex schema. See Section 2 for the complete schema.

### T5. 13 categories → 6 hall types

| | MemPalace v3.3.0 | PALACE plan |
|---|---|---|
| Categories | 13 (identity, fact, decision, task, conversation, lesson, preference, procedure, signal, goal, relationship, metric, question) | 6 hall types masquerading as categories |

**Resolution:** Keep the **full 13-category enum** as a field on closets. The 6 hall types are a coarse grouping. Categories drive retrieval filtering, access control, TTL defaults, and KG routing. Losing `identity`, `procedure`, `signal`, `goal`, `relationship`, `metric`, and `question` breaks the audited design.

### T6. Access control missing

| | MemPalace v3.3.0 | PALACE plan |
|---|---|---|
| Access | 11 NEops, per-(wing, category) read/write matrix, scope bindings | palaceId scoping only |

**Resolution:** Port `access_matrix.yaml` to a Convex table. Enforce at the action level. Every query/mutation checks `(neop, wing, category)` permissions before touching data. Scope bindings (e.g., `icd_zoo_media` restricted to `clients/zoo-media`) are enforced by the serving layer.

### T7. Append-only writes not mentioned

| | MemPalace v3.3.0 | PALACE plan |
|---|---|---|
| Write model | Append-only; updates create new version with `supersedes` pointer | Mutable (upsert implied) |

**Resolution:** Enforce **append-only writes** in Convex mutations. The `palace_update_closet` MCP tool creates a new version, not an in-place update. The old version gets `supersededBy` set. This preserves the audit trail and enables rollback.

---

## 1. Dependency Graph — What blocks what

```
Phase 0: Project Init
    ↓
Phase 1: Convex Schema + CRUD ──────────────────────────────────┐
    ↓                                                            │
Phase 2: FalkorDB + Graphiti Setup ──(independent of Phase 1)   │
    ↓                                                            │
Phase 3: Embeddings + Vector Search ──(depends on Phase 1)      │
    ↓                                                            │
Phase 4: Ingestion Pipeline ──(depends on Phase 1 + 2 + 3)     │
    ↓                                                            │
Phase 5: Serving Layer L0–L3 ──(depends on Phase 3 + 4)        │
    ↓                                                            │
Phase 6: MCP Server ──(depends on Phase 5)                      │
    ↓                                                            │
Phase 7: Access Control ──(depends on Phase 1, blocks Phase 8) │
    ↓                                                            │
Phase 8: Curator + Maintenance ──(depends on Phase 4 + 5)      │
    ↓                                                            │
Phase 9: Production Hardening ──(depends on all above)          │
```

**Critical path:** Phase 0 → 1 → 3 → 4 → 5 → 6
**Parallel track:** Phase 2 can run alongside Phase 1.
**Phase 7** can start after Phase 1 and should complete before Phase 9.

---

## 2. Complete Convex Schema (reconciled)

This schema carries forward all P0/P1 fields from MemoryItem while fitting Convex's table model. The PALACE plan's hierarchy (wings → halls → rooms → closets → drawers) is preserved, but every closet gets the full provenance chain.

```typescript
// convex/schema.ts — AUTHORITATIVE

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({

  // ─── PALACE ───────────────────────────────────────

  palaces: defineTable({
    name: v.string(),                       // "NeuralEDGE HQ"
    clientId: v.string(),                   // "neuraledge" | "zoo_media"
    createdAt: v.number(),
    l0_briefing: v.string(),               // ~50 token identity summary
    l1_wing_index: v.string(),             // ~120 token wing map
    falkordbGraph: v.string(),             // FalkorDB graph name
    schemaVersion: v.number(),             // from D7: migration path
  }),

  // ─── WINGS (12 from wings.yaml) ──────────────────

  wings: defineTable({
    palaceId: v.id("palaces"),
    name: v.string(),                       // "platform", "clients", etc.
    description: v.string(),
    icon: v.optional(v.string()),
    sortOrder: v.number(),
    roomCount: v.number(),                  // denormalized
    lastActivity: v.number(),
    archived: v.optional(v.boolean()),      // K1: churn flow
    phase: v.optional(v.string()),          // K4: onboarding|active|maintenance|offboarding
  })
    .index("by_palace", ["palaceId"])
    .index("by_palace_name", ["palaceId", "name"]),

  // ─── HALLS (navigational grouping) ────────────────

  halls: defineTable({
    wingId: v.id("wings"),
    palaceId: v.id("palaces"),
    type: v.string(),                       // decisions|facts|conversations|lessons|preferences|tasks|procedures|signals|identities
    roomCount: v.number(),                  // denormalized
  })
    .index("by_wing", ["wingId"])
    .index("by_palace_type", ["palaceId", "type"]),

  // ─── ROOMS ────────────────────────────────────────

  rooms: defineTable({
    hallId: v.id("halls"),
    wingId: v.id("wings"),
    palaceId: v.id("palaces"),
    name: v.string(),                       // "context-vault", "zoo-media"
    summary: v.string(),                   // 2-sentence room summary
    closetCount: v.number(),               // denormalized
    lastUpdated: v.number(),
    tags: v.array(v.string()),
  })
    .index("by_hall", ["hallId"])
    .index("by_wing", ["wingId"])
    .index("by_palace", ["palaceId"])
    .index("by_palace_name", ["palaceId", "name"])
    .searchIndex("search_rooms", {
      searchField: "name",
      filterFields: ["palaceId", "wingId"],
    }),

  // ─── CLOSETS (full MemoryItem provenance) ─────────

  closets: defineTable({
    roomId: v.id("rooms"),
    hallId: v.id("halls"),
    wingId: v.id("wings"),
    palaceId: v.id("palaces"),

    // Content
    content: v.string(),                    // Raw verbatim text
    title: v.optional(v.string()),          // Short label

    // Classification
    category: v.string(),                   // 13-type enum from categories.py
    sourceType: v.string(),                 // claude_chat|meeting|document|slack|email|manual|palace-promote|palace-audit
    sourceRef: v.optional(v.string()),     // Original conversation/doc ID
    sourceAdapter: v.string(),             // Adapter name (fireflies, matrix, cli, etc.)
    sourceExternalId: v.string(),          // Stable upstream ID

    // Provenance
    authorType: v.string(),                // neop|human|adapter|system
    authorId: v.string(),                  // NEop name, human email, etc.

    // Identity & versioning (A2, D7)
    version: v.number(),                    // Append-only: updates increment
    supersedes: v.optional(v.id("closets")), // Prior version ID
    supersededBy: v.optional(v.id("closets")), // Next version ID
    schemaVersion: v.number(),

    // Quality (A4, A8)
    confidence: v.number(),                // 0–1
    needsReview: v.boolean(),              // DLQ / quarantine flag
    conflictGroupId: v.optional(v.string()),

    // Lifecycle (A7, G4)
    createdAt: v.number(),
    updatedAt: v.number(),
    ttlSeconds: v.optional(v.number()),    // null = category default
    decayed: v.boolean(),
    retracted: v.boolean(),
    legalHold: v.boolean(),

    // Privacy (A12, I4)
    piiTags: v.array(v.string()),
    visibility: v.string(),                // default|restricted|public

    // Dedup (A10)
    dedupKey: v.string(),                  // sha256(content + adapter + external_id)
  })
    .index("by_room", ["roomId"])
    .index("by_palace", ["palaceId"])
    .index("by_wing", ["wingId"])
    .index("by_wing_hall", ["wingId", "hallId"])
    .index("by_palace_category", ["palaceId", "category"])
    .index("by_source", ["palaceId", "sourceType"])
    .index("by_time", ["palaceId", "createdAt"])
    .index("by_dedup", ["palaceId", "dedupKey"])
    .index("by_palace_decayed", ["palaceId", "decayed"])
    .index("by_palace_review", ["palaceId", "needsReview"]),

  // ─── DRAWERS (atomic facts) ───────────────────────

  drawers: defineTable({
    closetId: v.id("closets"),
    roomId: v.id("rooms"),
    palaceId: v.id("palaces"),
    fact: v.string(),                       // Single atomic fact
    validFrom: v.number(),
    validUntil: v.optional(v.number()),    // null = still valid
    supersededBy: v.optional(v.id("drawers")),
    graphitiNodeId: v.optional(v.string()), // Link to FalkorDB entity
    confidence: v.number(),                // Inherited from closet or overridden
  })
    .index("by_closet", ["closetId"])
    .index("by_room", ["roomId"])
    .index("by_palace_valid", ["palaceId", "validUntil"]),

  // ─── TUNNELS (cross-wing corridors) ───────────────

  tunnels: defineTable({
    palaceId: v.id("palaces"),
    fromRoomId: v.id("rooms"),
    toRoomId: v.id("rooms"),
    relationship: v.string(),              // depends_on|contradicts|extends|caused_by|clarifies
    strength: v.number(),                  // 0–1
    createdAt: v.number(),
    label: v.optional(v.string()),
  })
    .index("by_from", ["fromRoomId"])
    .index("by_to", ["toRoomId"])
    .index("by_palace", ["palaceId"]),

  // ─── VECTOR SEARCH ────────────────────────────────

  closet_embeddings: defineTable({
    closetId: v.id("closets"),
    palaceId: v.id("palaces"),
    wingId: v.id("wings"),
    embedding: v.array(v.float64()),       // Voyage 4, 1024 dims
  })
    .index("by_closet", ["closetId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["palaceId"],
    }),

  // ─── ACCESS CONTROL ───────────────────────────────

  neop_permissions: defineTable({
    palaceId: v.id("palaces"),
    neopId: v.string(),                    // "aria", "icd_zoo_media", "_admin"
    parentNeopId: v.optional(v.string()),  // For scoped instances: "icd"
    runtimeOps: v.array(v.string()),       // ["recall", "remember", "promote", "erase", "audit"]
    contentAccess: v.string(),             // JSON-serialized per-wing access map
    scopeWing: v.optional(v.string()),     // Scope binding: wing
    scopeRoom: v.optional(v.string()),     // Scope binding: room
  })
    .index("by_palace", ["palaceId"])
    .index("by_palace_neop", ["palaceId", "neopId"]),

  // ─── INGESTION LOG ────────────────────────────────

  ingestion_log: defineTable({
    palaceId: v.id("palaces"),
    sourceType: v.string(),
    sourceRef: v.string(),
    status: v.string(),                    // pending|extracted|failed
    closetsCreated: v.number(),
    drawersCreated: v.number(),
    graphitiEpisodeId: v.optional(v.string()),
    timestamp: v.number(),
    error: v.optional(v.string()),
    adapterName: v.string(),
    watermarkCursor: v.optional(v.string()),
  })
    .index("by_palace", ["palaceId"])
    .index("by_status", ["status"])
    .index("by_palace_adapter", ["palaceId", "adapterName"]),

  // ─── AUDIT LOG ────────────────────────────────────

  audit_events: defineTable({
    palaceId: v.id("palaces"),
    op: v.string(),                        // recall|remember|promote|erase|search
    neopId: v.string(),
    effectiveNeopId: v.string(),
    status: v.string(),                    // ok|noop|error|denied
    latencyMs: v.number(),
    timestamp: v.number(),
    wing: v.optional(v.string()),
    room: v.optional(v.string()),
    category: v.optional(v.string()),
    itemId: v.optional(v.string()),
    resultCount: v.optional(v.number()),
    queryHash: v.optional(v.string()),
    extra: v.optional(v.string()),         // JSON blob for additional context
  })
    .index("by_palace", ["palaceId"])
    .index("by_palace_time", ["palaceId", "timestamp"])
    .index("by_neop", ["palaceId", "neopId"]),
});
```

---

## 3. Phase-by-Phase Implementation

### Phase 0: Project Initialization (Steps 1–8)

**Goal:** Scaffolded project with all dependencies, CI, and git ready.

**Pre-requisites:** None.

```
Step 0.1:  Initialize git repo in /NEOS_Memory
           $ cd /mnt/c/Users/LENOVO/Desktop/NEOS_Memory
           $ git init
           $ echo "node_modules/\n.env*\n.convex/\n__pycache__/\n*.pyc\nvenv/\nservices/__pycache__/" > .gitignore

Step 0.2:  Initialize Node.js project
           $ npm init -y
           Install core deps:
           $ npm install convex@latest
           $ npm install @anthropic-ai/sdk voyageai

Step 0.3:  Initialize Convex project
           $ npx convex init
           Verify: convex/ directory created with _generated/

Step 0.4:  Create Python service directory for Graphiti bridge
           $ mkdir -p services
           $ cd services && python3 -m venv venv
           Write services/requirements.txt:
             graphiti-core[falkordb,anthropic,voyageai]
             fastapi
             uvicorn[standard]
             redis
           $ source venv/bin/activate && pip install -r requirements.txt

Step 0.5:  Create directory structure
           context-vault-palace/
           ├── convex/
           │   ├── schema.ts
           │   ├── palace/          # CRUD mutations + queries
           │   ├── serving/         # L0/L1/L2/L3
           │   ├── ingestion/       # extraction + embedding + routing
           │   ├── maintenance/     # curator, pruner, dedup
           │   ├── access/          # permission enforcement
           │   ├── http.ts          # MCP server
           │   └── crons.ts         # scheduled jobs
           ├── services/
           │   ├── graphiti_bridge.py
           │   └── requirements.txt
           ├── scripts/
           │   ├── parseClaude.ts
           │   ├── seedPalace.ts
           │   └── batchIngest.ts
           ├── config/
           │   ├── wings.yaml       # copied from MemPalace
           │   └── access_matrix.yaml # copied from MemPalace
           └── tests/

Step 0.6:  Copy authoritative config from MemPalace
           $ cp /Desktop/MemPalace/neos-memory-palace/schema/wings.yaml config/
           $ cp /Desktop/MemPalace/neos-memory-palace/schema/access_matrix.yaml config/

Step 0.7:  Set Convex environment variables
           $ npx convex env set VOYAGE_API_KEY=<key>
           $ npx convex env set ANTHROPIC_API_KEY=<key>
           $ npx convex env set GRAPHITI_BRIDGE_URL=http://<ec2-ip>:8100
           $ npx convex env set FALKORDB_HOST=<ec2-ip>

Step 0.8:  First commit
           $ git add -A && git commit -m "chore: scaffold PALACE project with Convex + Graphiti deps"

VALIDATION GATE 0:
  [ ] `npx convex dev` starts without errors (no schema yet, just empty project)
  [ ] `python -c "import graphiti_core"` succeeds in services/venv
  [ ] Directory structure matches Step 0.5
  [ ] wings.yaml and access_matrix.yaml present in config/
```

---

### Phase 1: Convex Schema + CRUD (Steps 9–22)

**Goal:** Full schema deployed to Convex. All palace hierarchy CRUD working. NeuralEDGE palace seeded with 12 wings, halls, and rooms.

**Depends on:** Phase 0.

```
Step 1.1:  Write convex/schema.ts
           Use the reconciled schema from Section 2 of this document.
           All 11 tables, all indexes, all fields.
           $ npx convex dev  →  schema deploys without error

Step 1.2:  Write palace creation mutation
           convex/palace/mutations.ts:
             createPalace({ name, clientId, falkordbGraph })
               → creates palace with schemaVersion=1, empty l0/l1
             Returns palace ID.

Step 1.3:  Write wing CRUD mutations
           convex/palace/mutations.ts:
             createWing({ palaceId, name, description, sortOrder })
               → creates wing, initializes roomCount=0, lastActivity=now
             updateWing({ wingId, ... })  → partial update
             archiveWing({ wingId })      → sets archived=true

Step 1.4:  Write hall CRUD mutations
           convex/palace/mutations.ts:
             createHall({ wingId, palaceId, type })
               → creates hall with roomCount=0
             Enforce: type must be one of the valid hall types.

Step 1.5:  Write room CRUD mutations
           convex/palace/mutations.ts:
             createRoom({ hallId, wingId, palaceId, name, summary, tags })
               → creates room, increments hall.roomCount and wing.roomCount
             updateRoom({ roomId, ... })  → partial update

Step 1.6:  Write closet creation mutation (append-only)
           convex/palace/mutations.ts:
             createCloset({ roomId, hallId, wingId, palaceId,
                            content, title, category, sourceType, sourceRef,
                            sourceAdapter, sourceExternalId,
                            authorType, authorId, confidence,
                            piiTags, visibility })
               → compute dedupKey = sha256(content + sourceAdapter + sourceExternalId)
               → check by_dedup index: if exists, return noop
               → check for prior version: if found, set supersedes, increment version
               → create closet with version=1 (or N+1), schemaVersion=1,
                 needsReview=false, decayed=false, retracted=false, legalHold=false
               → increment room.closetCount
               → return closet ID

Step 1.7:  Write drawer creation mutation
           convex/palace/mutations.ts:
             createDrawer({ closetId, roomId, palaceId, fact, validFrom, confidence })
               → create drawer with validUntil=undefined
               → return drawer ID

Step 1.8:  Write tunnel creation mutation
           convex/palace/mutations.ts:
             createTunnel({ palaceId, fromRoomId, toRoomId, relationship, strength, label })
               → validate both rooms exist and belong to palaceId
               → create tunnel
               → return tunnel ID

Step 1.9:  Write closet invalidation mutation (soft delete)
           convex/palace/mutations.ts:
             retractCloset({ closetId, reason, retractedBy })
               → set retracted=true, content="[REDACTED]"
               → check legalHold: if true, throw

Step 1.10: Write drawer invalidation mutation
           convex/palace/mutations.ts:
             invalidateDrawer({ drawerId, supersededById })
               → set validUntil=now, supersededBy=supersededById

Step 1.11: Write palace queries
           convex/palace/queries.ts:
             getPalace({ palaceId })
             listWings({ palaceId })
             listHalls({ wingId })
             listRooms({ hallId }) and listRoomsByWing({ wingId })
             getRoom({ roomId })
             listClosets({ roomId, includeDecayed?, includeRetracted? })
             listDrawers({ closetId, validOnly? })
             listTunnelsFrom({ roomId })
             listTunnelsTo({ roomId })

Step 1.12: Write audit event mutation
           convex/access/audit.ts:
             logAuditEvent({ palaceId, op, neopId, effectiveNeopId,
                             status, latencyMs, wing?, room?, category?,
                             itemId?, resultCount?, queryHash?, extra? })
               → insert into audit_events table

Step 1.13: Write ingestion log mutation
           convex/palace/mutations.ts:
             logIngestion({ palaceId, sourceType, sourceRef, status,
                           closetsCreated, drawersCreated, adapterName, error? })
               → insert into ingestion_log table

Step 1.14: Write palace seeder script
           scripts/seedPalace.ts:
             1. Create "NeuralEDGE HQ" palace (clientId="neuraledge",
                falkordbGraph="palace_neuraledge_hq")
             2. For each of 12 wings from wings.yaml:
                a. Create wing with description and sortOrder
                b. Create 6 standard halls (decisions, facts, conversations,
                   lessons, preferences, tasks) + procedure, signal, identity
                   halls where appropriate
                c. Create rooms from wings.yaml, assigning each to the
                   "facts" hall by default (rooms don't belong to a single
                   hall type — closets within them do)
             3. Set l0_briefing: "I am a NEop for NeuralEDGE, an AI company
                building the NEOS platform. ..."
             4. Set l1_wing_index: "Wings: platform (7 rooms), clients (3),
                team (6), gtm (6), legal (5), rd (5), marketplace (3),
                infra (5), partners (2), brand (3), audit (1), _quarantine (1).
                Total: 47 rooms."

Step 1.15: Run seeder
           $ npx convex run scripts/seedPalace
           Verify: Convex dashboard shows all tables populated.

Step 1.16: Write access control seeder
           scripts/seedAccess.ts:
             For each NEop in access_matrix.yaml:
               Create neop_permissions entry with:
                 runtimeOps from runtime section
                 contentAccess as JSON string from content section
                 scopeWing/scopeRoom from scopes section (if applicable)

Step 1.17: Run access seeder
           $ npx convex run scripts/seedAccess
           Verify: 12 neop_permissions entries created.

Step 1.18: Write unit tests for mutations
           tests/palace.test.ts:
             - createCloset → verify dedup (same content + adapter + externalId = noop)
             - createCloset → verify versioning (same dedupKey, different content = v2)
             - retractCloset → verify content replaced, legalHold respected
             - invalidateDrawer → verify validUntil set
             - createTunnel → verify cross-palace rejection

Step 1.19: Commit
           $ git add -A && git commit -m "feat: Convex schema, CRUD mutations, palace seeder"

VALIDATION GATE 1:
  [ ] `npx convex dev` deploys schema without errors
  [ ] NeuralEDGE HQ palace exists with 12 wings, 47 rooms
  [ ] Creating a closet with duplicate dedupKey returns noop
  [ ] Creating a closet with same dedupKey but different content creates v2 with supersedes
  [ ] Retracting a closet replaces content with [REDACTED]
  [ ] Retracting a closet under legalHold throws
  [ ] 12 neop_permissions entries exist
  [ ] All queries return correct data
```

---

### Phase 2: FalkorDB + Graphiti Setup (Steps 23–32)

**Goal:** FalkorDB running on EC2, Graphiti bridge service accepting HTTP requests, entity ingestion working end-to-end.

**Depends on:** Phase 0. **Parallelizable with Phase 1.**

```
Step 2.1:  SSH to EC2 instance
           Verify Docker is installed and running.
           $ docker --version

Step 2.2:  Deploy FalkorDB container
           $ docker run -d --name falkordb \
             -p 6379:6379 \
             -p 3000:3000 \
             -v falkordb_data:/data \
             --restart unless-stopped \
             falkordb/falkordb:latest

Step 2.3:  Verify FalkorDB
           $ redis-cli -p 6379 PING  →  PONG
           Open http://<ec2-ip>:3000 → FalkorDB Browser loads

Step 2.4:  Create initial graph for NeuralEDGE
           $ redis-cli -p 6379
           > GRAPH.QUERY palace_neuraledge_hq "RETURN 1"
           → Graph created implicitly.

Step 2.5:  Write Graphiti bridge service
           services/graphiti_bridge.py:
             FastAPI app with endpoints:
               POST /ingest   → add_episode to Graphiti
               POST /search   → search graph
               POST /entity   → query specific entity
               GET  /health   → connection check
             Connection pool keyed by (palace_id, graph_name).
             Error handling: if FalkorDB unreachable, return 503.

Step 2.6:  Write Graphiti initialization endpoint
           POST /init → build_indices_and_constraints for a graph
           Called once per new palace.

Step 2.7:  Write systemd service for Graphiti bridge
           /etc/systemd/system/graphiti-bridge.service:
             ExecStart=/path/to/venv/bin/uvicorn graphiti_bridge:app --host 0.0.0.0 --port 8100
             Restart=always
           $ sudo systemctl enable graphiti-bridge
           $ sudo systemctl start graphiti-bridge

Step 2.8:  Test ingestion end-to-end
           $ curl -X POST http://localhost:8100/ingest \
             -H "Content-Type: application/json" \
             -d '{
               "palace_id": "neuraledge",
               "graph_name": "palace_neuraledge_hq",
               "episode_name": "test_episode",
               "content": "Rahul decided to use Convex instead of Supabase for the NEOS platform because of real-time subscriptions and built-in vector search.",
               "source_description": "Architecture decision",
               "timestamp": "2026-04-16T10:00:00Z"
             }'
           → Should return {"status": "ingested"}

Step 2.9:  Verify in FalkorDB Browser
           Open http://<ec2-ip>:3000
           Select graph: palace_neuraledge_hq
           Run: MATCH (n) RETURN n LIMIT 20
           → Should see entity nodes (Rahul, Convex, Supabase, NEOS)
           Run: MATCH ()-[r]->() RETURN r LIMIT 20
           → Should see relationship edges

Step 2.10: Test search endpoint
           $ curl -X POST http://localhost:8100/search \
             -H "Content-Type: application/json" \
             -d '{
               "palace_id": "neuraledge",
               "graph_name": "palace_neuraledge_hq",
               "query": "Why was Convex chosen?",
               "limit": 5
             }'
           → Should return results mentioning Convex/Supabase decision

Step 2.11: Configure EC2 security group
           Allow inbound TCP 8100 from Convex's IP range (or use VPN/tunnel).
           Do NOT expose 6379 (FalkorDB/Redis) to the internet.

Step 2.12: Commit services directory
           $ git add -A && git commit -m "feat: Graphiti bridge service for FalkorDB"

VALIDATION GATE 2:
  [ ] FalkorDB responds to PING on EC2
  [ ] FalkorDB Browser accessible at :3000
  [ ] Graphiti bridge /health returns 200
  [ ] /ingest creates entities and relationships in FalkorDB
  [ ] /search returns relevant results
  [ ] Security group restricts 6379 to localhost only
```

---

### Phase 3: Embeddings + Vector Search (Steps 33–42)

**Goal:** Voyage 4 embeddings generated for closets, stored in Convex vector index, semantic search working with palace-scoped filtering.

**Depends on:** Phase 1 (closets table must exist).

```
Step 3.1:  Write Voyage 4 embedding action
           convex/ingestion/embed.ts:
             generateEmbedding(text: string) → number[]
               → Call Voyage API: model="voyage-3-large", input_type="document"
               → Return 1024-dim float array
               → On failure: retry once, then throw

Step 3.2:  Write embedding storage mutation
           convex/palace/mutations.ts:
             storeEmbedding({ closetId, palaceId, wingId, embedding })
               → Check embedding.length === 1024
               → Upsert into closet_embeddings (idempotent on closetId)

Step 3.3:  Write search-time embedding action
           convex/ingestion/embed.ts:
             generateQueryEmbedding(query: string) → number[]
               → Call Voyage API: model="voyage-3-large", input_type="query"
               → input_type="query" vs "document" matters for asymmetric search

Step 3.4:  Write vector search query
           convex/serving/vectorSearch.ts:
             searchByVector({ palaceId, embedding, limit })
               → ctx.vectorSearch("closet_embeddings", "by_embedding",
                   { vector: embedding, limit, filter: q => q.eq("palaceId", palaceId) })
               → For each result, fetch the closet document
               → Filter out retracted and decayed closets
               → Return closets with scores

Step 3.5:  Write combined search action (vector + metadata)
           convex/serving/l2.ts:
             searchPalace({ palaceId, query, wingFilter?, categoryFilter?, limit? })
               → 1. Generate query embedding
               → 2. Vector search (palaceId-scoped)
               → 3. If wingFilter: post-filter results
               → 4. If categoryFilter: post-filter results
               → 5. Apply similarity floor (0.5 default)
               → 6. Enrich each result with room/wing/hall context
               → 7. Return { results, tokenCount }

Step 3.6:  Embed existing seeded closets (if any test data exists)
           Write a one-shot action that:
             → Queries all closets without embeddings
             → Generates embedding for each
             → Stores in closet_embeddings
           This becomes the backfill mechanism for Phase 4.

Step 3.7:  Test with synthetic data
           Create 10 test closets spanning 3 wings with known content:
             - "We chose Convex over Supabase for real-time subscriptions" (platform/stack)
             - "Zoo Media retainer is 2.5L/month" (clients/zoo-media)
             - "ICP is knowledge workers at 50-500 employee companies" (gtm/icp)
             ... etc.
           Search: "why did we pick Convex?" → should return platform/stack closet
           Search: "how much does Zoo Media pay?" → should return clients/zoo-media closet
           Search: "who is our target customer?" → should return gtm/icp closet

Step 3.8:  Measure search latency
           Log time from query submission to results returned.
           Target: < 500ms for vector-only search.
           If > 500ms, check: embedding generation time, vector index performance.

Step 3.9:  Write similarity floor enforcement
           In searchPalace action, after vector results:
             if (topScore < 0.5) return { results: [], confidence: "low", reason: "no_match_above_floor" }
           This implements gap F4 ("I don't know" is first-class).

Step 3.10: Commit
           $ git add -A && git commit -m "feat: Voyage 4 embeddings + vector search with similarity floor"

VALIDATION GATE 3:
  [ ] Voyage API call succeeds, returns 1024-dim array
  [ ] Embedding stored in closet_embeddings table
  [ ] Vector search returns relevant results scoped to palaceId
  [ ] Search for unrelated query returns empty with confidence="low"
  [ ] Search latency < 500ms
  [ ] Retracted/decayed closets excluded from results
```

---

### Phase 4: Ingestion Pipeline (Steps 43–62)

**Goal:** Claude.ai chat exports parsed, routed to wings/rooms, extracted via Claude Sonnet, stored as closets + drawers + embeddings, mirrored to FalkorDB. Full pipeline from raw JSON to searchable palace.

**Depends on:** Phase 1 + 2 + 3 (all storage layers ready).

```
Step 4.1:  Export Claude.ai data
           Claude.ai → Settings → Export → Download ZIP
           Unzip to scripts/data/claude_export/
           Inspect structure: conversations.json is the main file.

Step 4.2:  Write Claude export parser
           scripts/parseClaude.ts:
             1. Read conversations.json
             2. For each conversation:
                a. Extract uuid, name, created_at, updated_at
                b. Chunk by Q+A exchange pairs (human→assistant)
                c. Skip exchanges where human message is < 20 chars
                   (avoid "ok", "thanks", "yes")
                d. Each exchange becomes a candidate for ingestion
             3. Output: array of Exchange objects:
                { human, assistant, timestamp, conversationId, conversationTitle }
             4. Log stats: total conversations, total exchanges, avg length

Step 4.3:  Write wing router
           convex/ingestion/route.ts:
             routeToWing(text: string) → string
               Use keyword-based routing from the PALACE plan's WING_ROUTES.
               BUT use the 12 wings from wings.yaml, not the 7 from the plan.
               Additional routes:
                 "infra": ["ec2", "docker", "nginx", "ssl", "deploy", "matrix.neuraledge"],
                 "partners": ["fireflies", "anthropic", "convex", "voyageai"],
                 "marketplace": ["nep", "marketplace", "self-improvement"],
                 "audit": [],  // never routed to; only written by system
                 "_quarantine": [],  // only via DLQ path
               Fallback: if no keyword matches → "_quarantine"
               Return wing name.

Step 4.4:  Write room router
           convex/ingestion/route.ts:
             routeToRoom(text: string, wing: string) → string
               Per-wing keyword matching to rooms from wings.yaml.
               Example for platform wing:
                 "stack" keywords: ["convex", "supabase", "tanstack", "fastapi", "voyage"]
                 "architecture" keywords: ["cortex", "topology", "multi-agent", "system design"]
                 "neop-catalog" keywords: ["neop", "aria", "forge", "scout", "recon"]
                 etc.
               Fallback within wing: first room alphabetically (or "unclassified" if _quarantine)

Step 4.5:  Write category classifier
           convex/ingestion/route.ts:
             classifyCategory(text: string) → string
               Decision signals: "decided", "chose", "picked", "went with", "rejected"
               Task signals: "todo", "need to", "action item", "should do", "will do"
               Lesson signals: "learned", "mistake", "worked well", "next time"
               Preference signals: "prefer", "like", "want", "style"
               Procedure signals: "steps", "how to", "process", "runbook", "sop"
               Signal signals: "alert", "warning", "incident", "down"
               Default: "fact"

Step 4.6:  Write confidence scorer
           convex/ingestion/route.ts:
             scoreConfidence(exchange: Exchange) → number
               Base confidence by source: claude_chat = 0.7
               Modifiers:
                 +0.1 if exchange has specific numbers/dates/names
                 +0.1 if assistant response is > 500 chars (detailed)
                 -0.2 if exchange is speculative ("maybe", "might", "could")
                 -0.1 if exchange is a question without resolution
               Clamp to [0.1, 1.0]

Step 4.7:  Write Claude Sonnet extraction action
           convex/ingestion/extract.ts:
             extractMemories({ content, sourceType, sourceRef, palaceId, wingName })
               → Call Claude Sonnet with extraction prompt (from PALACE plan Section 7.3)
               → BUT enhance the prompt to extract the full category set (13 types)
               → Parse JSON response
               → For each extracted memory:
                 a. Validate category is in the enum
                 b. Validate confidence is in [0,1]
                 c. Validate facts are atomic (< 100 chars each)
               → Return structured extractions

Step 4.8:  Write PII scanner
           convex/ingestion/pii.ts:
             scanForPII(text: string) → string[]
               Detect: email, phone (Indian +91), PAN (ABCDE1234F),
                       credit card (4/16 digits), AWS keys (AKIA...)
               Return list of PII types found.
               Do NOT redact — just tag. Redaction is a policy decision.

Step 4.9:  Write single-exchange ingestion action
           convex/ingestion/ingestExchange.ts:
             ingestExchange({ exchange, palaceId })
               → 1. Combine human + assistant text
               → 2. Route to wing (routeToWing)
               → 3. Route to room (routeToRoom)
               → 4. Scan for PII (scanForPII)
               → 5. If wing === "_quarantine": set needsReview=true
               → 6. Call Claude Sonnet extraction (extractMemories)
               → 7. For each extraction:
                    a. Find or create room in Convex
                    b. Create closet with full provenance:
                       - sourceType="claude_chat"
                       - sourceRef=exchange.conversationId
                       - sourceAdapter="claude-export"
                       - sourceExternalId=`${conversationId}:${exchangeIndex}`
                       - authorType="adapter", authorId="claude-export"
                       - category from extraction
                       - confidence from extraction
                       - piiTags from scan
                    c. Create drawers for each atomic fact
                    d. Generate Voyage 4 embedding → store
                    e. Call Graphiti bridge /ingest for entities
               → 8. Log to ingestion_log
               → 9. Return { closetsCreated, drawersCreated }

Step 4.10: Write batch ingestion runner
           scripts/batchIngest.ts:
             1. Parse Claude export → exchanges
             2. Sort by timestamp (oldest first)
             3. Deduplicate by (conversationId + exchangeIndex)
             4. For each exchange:
                a. Call ingestExchange action
                b. Log progress: "Ingested exchange N/total from conversation X"
                c. On failure: log error, continue to next exchange
                d. Rate limit: max 10 concurrent extractions (Sonnet rate limit)
             5. Print summary: total processed, succeeded, failed, quarantined

Step 4.11: Dry-run on 10 conversations
           $ npx convex run scripts/batchIngest -- --limit 10 --dry-run
           Review:
             - Are wing assignments correct?
             - Are room assignments sensible?
             - Are categories appropriate?
             - Are extractions high quality?
             - Are PII tags catching real PII?

Step 4.12: Fix routing misclassifications
           Based on dry-run review:
             - Add missing keywords to WING_ROUTES
             - Add missing room keywords
             - Adjust category signals
             - Tune confidence modifiers

Step 4.13: Run ingestion on first 50 conversations
           $ npx convex run scripts/batchIngest -- --limit 50
           Verify in Convex dashboard:
             - Closets created across multiple wings
             - Drawers created with atomic facts
             - Embeddings generated (closet_embeddings table)
             - Ingestion log entries with status="extracted"

Step 4.14: Verify FalkorDB graph
           Open http://<ec2-ip>:3000
           Select graph: palace_neuraledge_hq
           MATCH (n) RETURN count(n)  → should have entity nodes
           MATCH (n)-[r]->(m) RETURN n.name, type(r), m.name LIMIT 20
           → Should show meaningful relationships

Step 4.15: Search quality test
           Run 10 known queries against the palace:
             1. "Why did we choose Convex?" → should find stack decisions
             2. "What is the Zoo Media retainer?" → should find pricing info
             3. "Who is Rahul?" → should find team info
             4. "What is the ICP?" → should find GTM data
             5. "What happened with Supabase?" → should find architecture decisions
             6. "What is OpenClaw?" → should find platform/neop info
             7. "What are the brand colors?" → should find brand info
             8. "What is the pricing model?" → should find pricing decisions
             9. "What adapters exist?" → should find ingestion info
             10. "What is the CORTEX layer?" → should find architecture info
           Target: 8/10 correct in top-3 results.

Step 4.16: Run ingestion on remaining conversations
           $ npx convex run scripts/batchIngest
           Monitor: ingestion_log for failures, _quarantine wing for unroutable items.

Step 4.17: Write quarantine review tool
           scripts/reviewQuarantine.ts:
             1. Query all closets in _quarantine wing
             2. For each: display content, suggested wing/room
             3. Allow manual re-routing via mutation call

Step 4.18: Commit
           $ git add -A && git commit -m "feat: ingestion pipeline with Claude export parser, Sonnet extraction, routing"

VALIDATION GATE 4:
  [ ] Claude export parsed without errors
  [ ] Wing routing assigns > 80% of exchanges to correct wing (sample 50)
  [ ] Claude Sonnet extraction produces valid JSON for all inputs
  [ ] Closets have full provenance (all fields populated)
  [ ] Drawers contain atomic facts (< 100 chars each)
  [ ] Embeddings generated for all closets
  [ ] FalkorDB graph has meaningful entities and relationships
  [ ] Search quality: 8/10 known queries return correct top-3
  [ ] Dedup works: re-running ingestion on same data = noop
  [ ] _quarantine catches unroutable items with needsReview=true
  [ ] Ingestion log tracks all operations
```

---

### Phase 5: Serving Layer L0–L3 (Steps 63–76)

**Goal:** Four-tier retrieval system working: identity briefing, wing index, semantic+graph search, deep room dive. Context blocks ready for NEop system prompts.

**Depends on:** Phase 3 + 4 (data must exist to search).

```
Step 5.1:  Write L0 generator action
           convex/serving/l0.ts:
             generateL0({ palaceId })
               → Query palace, count wings/rooms/closets
               → Call Claude Haiku to summarize palace identity in ~50 tokens:
                 "I am [NEop name] for NeuralEDGE. Palace: NeuralEDGE HQ.
                  12 wings, 47 rooms, N closets. Memory: search before assuming."
               → Store as palace.l0_briefing
             getL0({ palaceId })
               → Return palace.l0_briefing

Step 5.2:  Write L1 generator action
           convex/serving/l1.ts:
             generateL1({ palaceId })
               → Query all wings with room counts
               → Format: "Wings: platform (7 rooms, 42 closets), clients (3, 18), ..."
               → Target: ~120 tokens
               → Store as palace.l1_wing_index
             getL1({ palaceId })
               → Return palace.l1_wing_index

Step 5.3:  Write L2 combined search action
           convex/serving/l2.ts:
             searchPalace({ palaceId, query, wingFilter?, categoryFilter?, limit?, neopId? })
               → 1. Embed query with Voyage 4 (input_type="query")
               → 2. Convex vector search (palace-scoped, limit * 3 overfetch)
               → 3. Graphiti bridge /search (parallel with step 2)
               → 4. Merge results:
                    a. Deduplicate by closetId (vector may return same closet as graph)
                    b. Score: vectorScore * 0.6 + graphScore * 0.4
                    c. Boost if both sources agree
               → 5. Apply wing/category filters
               → 6. Apply similarity floor (0.5)
               → 7. If empty: return { results: [], confidence: "low" }
               → 8. Enrich each result with:
                    - room name, wing name, hall type
                    - creation date, source adapter
                    - related drawers (active facts)
               → 9. Return { context, rooms, tokenCount, confidence }

Step 5.4:  Write L2 wing-scoped search
           convex/serving/l2.ts:
             searchWing({ palaceId, wingName, query, limit? })
               → Same as searchPalace but pre-filtered to one wing
               → Useful for scoped NEops (icd_zoo_media → clients wing only)

Step 5.5:  Write L2 temporal search
           convex/serving/l2.ts:
             searchTemporal({ palaceId, query, after?, before?, limit? })
               → Vector search + post-filter by createdAt range
               → For "what did we decide last week?" type queries

Step 5.6:  Write L3 deep room dive
           convex/serving/l3.ts:
             getRoomDeep({ roomId, palaceId })
               → All non-retracted closets in room (paginated)
               → All valid drawers (validUntil undefined)
               → All tunnels from and to this room
               → Room summary and metadata
               → Return assembled context

Step 5.7:  Write tunnel walker
           convex/serving/tunnels.ts:
             walkTunnel({ fromRoomId, palaceId, maxDepth?, relationshipFilter? })
               → BFS from fromRoomId following tunnels
               → maxDepth default = 2 (prevent infinite walks)
               → At each node: collect room summary + top closet
               → Return path with rooms and their summaries

Step 5.8:  Write context assembler
           convex/serving/assemble.ts:
             assembleContext({ palaceId, query, neopId, maxTokens? })
               → 1. Get L0 (always included)
               → 2. Get L1 (always included)
               → 3. Run L2 search
               → 4. If L2 has results, format as context block
               → 5. Count tokens, truncate if over maxTokens (default 2000)
               → 6. Return formatted context block for system prompt injection

Step 5.9:  Write palace statistics query
           convex/serving/stats.ts:
             getStats({ palaceId })
               → Total wings, rooms, closets, drawers, tunnels
               → Per-wing counts
               → Closets by category breakdown
               → Closets by source type breakdown
               → Quarantined count (needsReview=true)
               → Decayed count
               → Last ingestion timestamp

Step 5.10: Write Markdown export action
           convex/serving/export.ts:
             exportToMarkdown({ palaceId, wingFilter? })
               → Iterate wings → rooms → closets → drawers
               → Format as hierarchical Markdown
               → Include tunnel map at end
               → Return Markdown string

Step 5.11: Test L0/L1 generation
           Generate L0 and L1 for NeuralEDGE palace.
           Verify:
             - L0 < 60 tokens
             - L1 < 150 tokens
             - All 12 wings listed in L1
             - Room/closet counts accurate

Step 5.12: Test L2 search end-to-end
           Same 10 queries from Step 4.15.
           This time verify the full pipeline:
             query → embedding → vector search + graph search → merge → enrich → return
           Target: < 2 seconds end-to-end.

Step 5.13: Test L3 deep dive
           Pick 3 rooms with known content.
           Verify: all closets, drawers, and tunnels returned correctly.

Step 5.14: Commit
           $ git add -A && git commit -m "feat: serving layer L0-L3 with search, tunnel walks, context assembly"

VALIDATION GATE 5:
  [ ] L0 briefing < 60 tokens, accurate palace identity
  [ ] L1 wing index < 150 tokens, accurate counts
  [ ] L2 search returns relevant results in < 2 seconds
  [ ] L2 search with no match returns confidence="low"
  [ ] L2 merges vector + graph results without duplicates
  [ ] L3 deep dive returns all closets/drawers/tunnels for a room
  [ ] Tunnel walker traverses 2 hops correctly
  [ ] Context assembler produces < 2000 token blocks
  [ ] Stats query returns accurate counts
  [ ] Markdown export produces valid, readable output
```

---

### Phase 6: MCP Server (Steps 77–90)

**Goal:** Convex HTTP action serving MCP protocol. Claude Code can connect and use all 19+ palace tools. PALACE_PROTOCOL in system prompt guiding tool selection.

**Depends on:** Phase 5 (all serving functions exist).

```
Step 6.1:  Write MCP HTTP action
           convex/http.ts:
             Route POST /mcp to httpAction handler
             Parse { tool, params } from request body
             Dispatch to appropriate Convex query/mutation/action
             Return JSON response
             Handle errors: return { error: string, code: number }

Step 6.2:  Implement search tools (5)
           palace_search       → searchPalace (L2)
           palace_search_wing  → searchWing (L2 scoped)
           palace_search_temporal → searchTemporal (L2 time-filtered)
           palace_get_room     → getRoomDeep (L3)
           palace_walk_tunnel  → walkTunnel

Step 6.3:  Implement navigation tools (4)
           palace_status      → getL0 + getL1 (combined)
           palace_list_wings  → listWings
           palace_list_rooms  → listRoomsByWing
           palace_list_halls  → listHalls

Step 6.4:  Implement storage tools (5)
           palace_add_closet   → createCloset + storeEmbedding + graphiti ingest
           palace_add_drawer   → createDrawer
           palace_create_room  → createRoom
           palace_create_wing  → createWing
           palace_create_tunnel → createTunnel

Step 6.5:  Implement maintenance tools (3)
           palace_invalidate    → invalidateDrawer
           palace_update_closet → create new version (append-only)
           palace_merge_rooms   → move all closets from room A to room B, delete A

Step 6.6:  Implement meta tools (2)
           palace_stats   → getStats
           palace_export  → exportToMarkdown

Step 6.7:  Add PALACE_PROTOCOL to palace_status response
           When palace_status is called, include protocol instructions:
             "PALACE PROTOCOL:
              1. Call palace_status at session start to load L0+L1
              2. Before answering any question about past decisions, people,
                 projects, or facts: call palace_search first
              3. If search returns confidence=low, say 'I don't have that in memory'
              4. To store new information: call palace_add_closet
              5. Never fabricate memories — only report what the palace contains
              6. For deep context: use palace_get_room after identifying the room
              7. For cross-topic connections: use palace_walk_tunnel"

Step 6.8:  Add neopId parameter to all tools
           Every tool call includes neopId (required).
           Before executing:
             → Look up neop_permissions for this neopId + palaceId
             → Check runtimeOps (can this NEop call this operation?)
             → Check contentAccess (can this NEop see this wing/category?)
             → If scope binding exists, enforce wing/room restriction
           On access denied: return { error: "access_denied", detail: "..." }

Step 6.9:  Add audit logging to all tools
           Every tool call (success or failure) logs to audit_events.
           Fields: op=tool name, neopId, status, latencyMs, etc.

Step 6.10: Deploy HTTP endpoint
           $ npx convex deploy
           Note the HTTP URL: https://<deployment>.convex.site/mcp

Step 6.11: Register MCP server with Claude Code
           $ claude mcp add palace -- curl -X POST https://<deployment>.convex.site/mcp
           Or write a local MCP wrapper that calls the Convex HTTP endpoint.

Step 6.12: Test with Claude Code — discovery
           Start Claude Code session.
           Ask: "What palace tools do you have?"
           → Should list all 19 tools

Step 6.13: Test with Claude Code — search
           Ask: "What do you know about the NEOS architecture?"
           → Claude should call palace_search
           → Should return relevant closets from platform wing
           → Claude should synthesize the results

Step 6.14: Test with Claude Code — storage
           Ask Claude to remember a new decision:
           "We decided to use TanStack Router for the frontend routing."
           → Claude should call palace_add_closet with:
             wing=platform, room=stack, category=decision,
             content describing the decision

Step 6.15: Test with Claude Code — access control
           Configure Claude as icd_zoo_media NEop.
           Ask: "What are Rahul's preferences?"
           → Should be denied (icd_zoo_media can't read team wing)

Step 6.16: Commit
           $ git add -A && git commit -m "feat: MCP server with 19 tools, access control, audit logging"

VALIDATION GATE 6:
  [ ] MCP endpoint responds to all 19 tool names
  [ ] Invalid tool names return clear error
  [ ] Access control denies unauthorized operations
  [ ] Scope bindings restrict wing/room correctly
  [ ] Audit events logged for every tool call
  [ ] Claude Code discovers and uses palace tools
  [ ] palace_search returns relevant results via Claude Code
  [ ] palace_add_closet stores new memories correctly
  [ ] PALACE_PROTOCOL included in palace_status response
```

---

### Phase 7: Access Control Hardening (Steps 91–100)

**Goal:** Full access matrix ported from MemPalace, enforced at every query/mutation, with scope bindings for cross-client isolation.

**Depends on:** Phase 1 (neop_permissions table seeded in Step 1.16–1.17).

```
Step 7.1:  Write access enforcement module
           convex/access/enforce.ts:
             enforceRead({ palaceId, neopId, wing, category })
               → Load neop_permissions for (palaceId, neopId)
               → If scope binding exists: verify wing/room match
               → Parse contentAccess JSON
               → Check read permission for (wing, category)
               → If denied: throw AccessDenied
             enforceWrite({ palaceId, neopId, wing, category })
               → Same as enforceRead but checks write permission
             enforceRuntime({ palaceId, neopId, op })
               → Check runtimeOps includes op
               → If denied: throw AccessDenied

Step 7.2:  Wire enforcement into all mutations
           Every createCloset, createDrawer, createTunnel, retractCloset call:
             → enforceRuntime(palaceId, neopId, "remember")
             → enforceWrite(palaceId, neopId, wing, category)
           Every retractCloset call:
             → enforceRuntime(palaceId, neopId, "erase")

Step 7.3:  Wire enforcement into all queries
           Every searchPalace, getRoomDeep, listClosets call:
             → enforceRuntime(palaceId, neopId, "recall")
             → Per result: enforceRead(palaceId, neopId, wing, category)
             → Filter out results where read is denied
           This means a single search can return mixed results:
             some visible, some filtered — depending on NEop permissions.

Step 7.4:  Write scope injection for searches
           If NEop has scope binding (e.g., icd_zoo_media → clients/zoo-media):
             → Auto-add wing filter to all searches
             → Auto-add room filter if scope specifies room
             → NEop cannot override these filters

Step 7.5:  Write admin bypass
           _admin neopId: skip all access checks.
           Only used for CLI/manual operations, never for production NEops.

Step 7.6:  Write access control tests
           tests/access.test.ts:
             - aria can recall from all wings
             - aria can only write conversation/task to clients wing
             - icd_zoo_media can only access clients/zoo-media
             - icd_zoo_media cannot read team wing
             - forge can write to platform, rd, infra
             - neuralchat is read-only (no remember in runtimeOps)
             - _admin can do everything
             - unknown neopId is denied

Step 7.7:  Write permission update mutation
           convex/access/mutations.ts:
             updateNeopPermissions({ palaceId, neopId, runtimeOps?, contentAccess? })
               → Only callable by _admin
               → Update neop_permissions entry

Step 7.8:  Write permission query
           convex/access/queries.ts:
             getNeopPermissions({ palaceId, neopId })
               → Return full permission set for this NEop
             listNeops({ palaceId })
               → Return all NEops with their runtime ops (not full content access)

Step 7.9:  Test end-to-end with MCP server
           Configure Claude Code as different NEops, verify restrictions work.

Step 7.10: Commit
           $ git add -A && git commit -m "feat: full access control with scope bindings and per-category enforcement"

VALIDATION GATE 7:
  [ ] All 12 NEops from access_matrix.yaml enforced correctly
  [ ] Scope bindings restrict icd_zoo_media to clients/zoo-media
  [ ] Read enforcement filters results per-NEop
  [ ] Write enforcement blocks unauthorized category writes
  [ ] Runtime enforcement blocks unauthorized operations
  [ ] _admin bypasses all checks
  [ ] Unknown neopId is denied
  [ ] All access denials logged as audit events
```

---

### Phase 8: Curator + Maintenance (Steps 101–115)

**Goal:** Automated maintenance: L0/L1 rebuild, stale detection, drawer pruning, tunnel strength updates, contradiction detection. Palace stays healthy without manual intervention.

**Depends on:** Phase 4 + 5 (data exists, serving layer works).

```
Step 8.1:  Write L0/L1 rebuild cron
           convex/maintenance/curator.ts:
             rebuildL0L1({ palaceId })
               → Recount all wings/rooms/closets
               → Regenerate L0 briefing (~50 tokens)
               → Regenerate L1 wing index (~120 tokens)
               → Update palace document
           convex/crons.ts:
             crons.interval("rebuild-l0-l1", { hours: 24 }, internal.maintenance.curator.rebuildAllPalaces)

Step 8.2:  Write stale room detector
           convex/maintenance/curator.ts:
             detectStaleRooms({ palaceId, staleDays? })
               → Default staleDays = 30
               → Query rooms where lastUpdated < now - staleDays
               → Return list of stale rooms with last activity date
               → Do NOT auto-archive — just report

Step 8.3:  Write drawer pruner
           convex/maintenance/pruner.ts:
             pruneExpiredDrawers({ palaceId })
               → Query drawers where validUntil < now
               → For each: check if any other drawer references it
               → If no references and validUntil > 30 days ago: delete
               → If has references: leave (needed for supersession chain)
               → Log count pruned

Step 8.4:  Write closet decay engine
           convex/maintenance/pruner.ts:
             decayExpiredClosets({ palaceId })
               → Query closets where:
                 ttlSeconds is set AND
                 createdAt + ttlSeconds < now AND
                 decayed = false
               → For each: set decayed=true
               → Log count decayed

Step 8.5:  Write category-default TTL applier
           convex/maintenance/pruner.ts:
             When a closet is created with ttlSeconds=undefined:
               → Apply category default:
                 signal: 7 days (604800s)
                 conversation: 90 days (7776000s)
                 task: 30 days after resolution (deferred — no resolution tracking yet)
                 everything else: null (never expires)

Step 8.6:  Write tunnel strength updater
           convex/maintenance/curator.ts:
             updateTunnelStrengths({ palaceId })
               → For each tunnel:
                 Count how often both rooms appear in the same search results
                 (query audit_events for co-retrieval)
               → Normalize to 0–1
               → Update tunnel.strength
               → Prune tunnels with strength < 0.1 and age > 90 days

Step 8.7:  Write contradiction detector
           convex/maintenance/dedup.ts:
             detectContradictions({ palaceId })
               → Query drawers with same (roomId, fact-similarity > 0.9)
                 but different content
               → Group into conflict sets
               → For each conflict: set conflictGroupId on parent closets
               → Return list of conflicts for human review

Step 8.8:  Write room deduplication detector
           convex/maintenance/dedup.ts:
             detectDuplicateRooms({ palaceId })
               → Find rooms with similar names (edit distance < 3)
               → Find rooms in same wing with overlapping closet content
               → Report as candidates for merging (do NOT auto-merge)

Step 8.9:  Write dangling tunnel sweeper
           convex/maintenance/curator.ts:
             sweepDanglingTunnels({ palaceId })
               → Find tunnels where fromRoomId or toRoomId no longer exists
               → Delete dangling tunnels
               → Log count swept

Step 8.10: Register all crons
           convex/crons.ts:
             rebuildL0L1: every 24 hours
             decayExpiredClosets: every 6 hours
             pruneExpiredDrawers: every 24 hours
             sweepDanglingTunnels: every 7 days
             updateTunnelStrengths: every 7 days
             detectContradictions: every 7 days

Step 8.11: Write maintenance dashboard query
           convex/maintenance/dashboard.ts:
             getMaintenanceStatus({ palaceId })
               → Last L0/L1 rebuild timestamp
               → Stale room count
               → Decayed closet count
               → Quarantined closet count (needsReview=true)
               → Contradiction count
               → Dangling tunnel count
               → Last pruning run

Step 8.12: Test: create a closet with ttlSeconds=60, wait 2 min, verify decay
Step 8.13: Test: invalidate a drawer, run pruner, verify cleanup
Step 8.14: Test: delete a room, run tunnel sweeper, verify dangling tunnels removed

Step 8.15: Commit
           $ git add -A && git commit -m "feat: curator maintenance — decay, pruning, dedup, contradiction detection"

VALIDATION GATE 8:
  [ ] L0/L1 rebuild produces accurate, fresh summaries
  [ ] Stale rooms detected correctly (> 30 days inactive)
  [ ] Expired closets marked as decayed (excluded from default search)
  [ ] Expired drawers pruned after 30-day grace period
  [ ] Dangling tunnels swept after room deletion
  [ ] Contradiction detector finds conflicting drawers
  [ ] All crons registered and running
  [ ] Maintenance dashboard returns accurate status
```

---

### Phase 9: Production Hardening (Steps 116–130)

**Goal:** Security audit, load testing, monitoring, documentation, first live NEop wired up.

**Depends on:** All previous phases.

```
Step 9.1:  Security audit — palaceId scoping
           Review EVERY query, mutation, and action:
             → Verify palaceId is required and checked
             → Verify no query can return data from another palace
             → Verify no mutation can write to another palace
           Create checklist of all endpoints + scoping status.

Step 9.2:  Security audit — access control
           For each of 19 MCP tools:
             → Verify neopId is required
             → Verify access enforcement runs before data access
             → Verify audit event logged
           Test with unauthorized NEop → verify denial.

Step 9.3:  Security audit — input validation
           For each mutation:
             → Verify string inputs are bounded (max length)
             → Verify numeric inputs are bounded (min/max)
             → Verify enum inputs are validated
             → Verify no SQL/Cypher injection possible in Graphiti bridge

Step 9.4:  Load test — ingestion throughput
           Prepare 1000 synthetic exchanges.
           Time: batch ingestion of 1000 exchanges.
           Target: > 100 exchanges/hour (including Sonnet extraction).
           Bottleneck is likely Claude Sonnet rate limit.

Step 9.5:  Load test — search latency
           With 1000+ closets in the palace:
             Run 50 diverse queries.
             Measure p50, p95, p99 latency.
             Target: p95 < 2 seconds.

Step 9.6:  Load test — concurrent reads
           Simulate 5 concurrent NEops searching simultaneously.
           Verify: no race conditions, results are correct, latency acceptable.

Step 9.7:  Optimize Voyage 4 usage
           Review embedding generation:
             → Batch embeddings where possible (Voyage supports batch)
             → Cache query embeddings for repeated queries (LRU, 100 entries)

Step 9.8:  Optimize Graphiti search
           Review graph query patterns:
             → Tune num_results parameter
             → Add query timeout (5s max)
             → Implement graceful degradation: if Graphiti bridge is down,
               return vector-only results with a flag

Step 9.9:  Write palace provisioning action
           convex/palace/provision.ts:
             provisionPalace({ clientId, name })
               → Create palace
               → Create 12 wings from wings.yaml template
               → Create standard halls per wing
               → Create rooms from template
               → Create FalkorDB graph via Graphiti bridge /init
               → Seed default neop_permissions
               → Generate initial L0/L1
               → Return palace ID

Step 9.10: Wire Zoo Media ICD NEop
           Create Zoo Media palace:
             $ npx convex run palace/provision -- --clientId zoo_media --name "Zoo Media"
           Configure ICD NEop with scope binding to zoo_media palace.
           Ingest any Zoo Media-related Claude conversations.
           Test: ICD can search Zoo Media content, cannot see NeuralEDGE content.

Step 9.11: Write monitoring queries
           convex/serving/monitoring.ts:
             → Search latency (from audit_events, p50/p95/p99)
             → Extraction quality (from ingestion_log, success rate)
             → Token efficiency (from L2 results, avg tokens per response)
             → Error rate (from audit_events, status=error count)
             → Quarantine rate (needsReview closets / total closets)

Step 9.12: Build simple status dashboard
           Create a minimal React page (or Convex dashboard query) showing:
             → Palace stats (wings, rooms, closets, drawers)
             → Search latency graph
             → Ingestion activity
             → Quarantine queue size
             → Last maintenance run

Step 9.13: Write API documentation
           For each MCP tool: name, parameters, return type, access requirements,
           example request/response.
           Store in docs/MCP_TOOLS.md

Step 9.14: Write operational runbook
           docs/RUNBOOK.md:
             → How to add a new client palace
             → How to ingest new data sources
             → How to handle quarantined items
             → How to debug search quality issues
             → How to recover from FalkorDB downtime
             → How to run maintenance manually
             → How to update access matrix

Step 9.15: Final commit
           $ git add -A && git commit -m "feat: production hardening — security audit, load test, monitoring, docs"

VALIDATION GATE 9:
  [ ] Every endpoint verified for palaceId scoping
  [ ] Every MCP tool verified for access control
  [ ] No input validation gaps found
  [ ] Ingestion throughput > 100 exchanges/hour
  [ ] Search p95 < 2 seconds with 1000+ closets
  [ ] 5 concurrent NEops work without issues
  [ ] Graceful degradation when Graphiti bridge is down
  [ ] Zoo Media palace provisioned and isolated
  [ ] Monitoring queries return accurate metrics
  [ ] API documentation complete for all 19 tools
  [ ] Operational runbook covers all scenarios
```

---

## 4. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Claude Sonnet extraction produces invalid JSON | Medium | High — blocks ingestion | Wrap in try/catch, retry once, send to _quarantine on failure |
| Voyage API rate limiting during bulk ingestion | High | Medium — slows ingestion | Batch embeddings, 10 concurrent max, exponential backoff |
| FalkorDB OOM on EC2 t3.medium (2GB RAM) | Low | High — graph search fails | Monitor RSS, set maxmemory policy, consider t3.large if > 50K entities |
| Convex free tier limits hit | Medium | Medium — blocks development | Monitor usage, upgrade to Pro ($25/mo) proactively |
| Graphiti bridge becomes single point of failure | Medium | Medium — no graph search | Graceful degradation: vector-only results when bridge is down |
| Wing routing misclassification rate > 20% | High initially | Medium — wrong room, still searchable | Review first 50 manually, tune keywords, add LLM fallback in v2 |
| Schema migration needed after launch | Medium | High — data compatibility | schemaVersion field on every record, migration scripts per version |
| Cross-tenant data leak | Low | Critical — trust violation | palaceId on every index, security audit in Phase 9, automated tests |

---

## 5. Cost Model (monthly, steady state)

| Component | Free tier | Steady state | Scale (10 clients) |
|-----------|-----------|-------------|---------------------|
| Convex | $0 | $25 (Pro) | $25 (Pro) |
| FalkorDB (Docker) | $0 | $0 | $0 (self-hosted) |
| Graphiti (OSS) | $0 | $0 | $0 |
| Voyage 4 embeddings | $0.15 | $0.50 | $2.00 |
| Claude Sonnet (extraction) | $5 | $10 | $40 |
| Claude Haiku (L0/L1/compression) | $1 | $2 | $5 |
| EC2 (existing) | $0 | $0 | $0-30 (if upgrade needed) |
| **Total** | **~$6** | **~$38** | **~$72** |

---

## 6. Success Criteria

| Metric | Target | Measured at |
|--------|--------|-------------|
| L0+L1 load time | < 200ms | Phase 5 |
| L2 search latency (vector + graph) | < 2s p95 | Phase 5, 9 |
| Search relevance (top-3 accuracy) | > 85% on 50-query eval set | Phase 4, 9 |
| Token efficiency per L2 payload | < 500 tokens avg | Phase 5 |
| Extraction precision | > 85% (manual review of 50) | Phase 4 |
| Graph entity accuracy | > 80% correct dedup | Phase 4 |
| Ingestion throughput | > 100 conversations/hour | Phase 4, 9 |
| Palace freshness (source → searchable) | < 5 minutes | Phase 4 |
| Access control enforcement | 100% — zero cross-tenant leaks | Phase 7, 9 |
| Uptime (palace search available) | > 99% (Convex SLA) | Phase 9+ |
| DLQ rate | < 5% of ingested items | Phase 4 |

---

## 7. What ships vs. what's deferred

### Ships in v1 (this plan)

- Full Convex schema with 25+ fields per closet (all P0/P1 gaps)
- 12 wings from audited design
- 13-category classification
- Append-only writes with version chains
- Dedup by content + source hash
- Voyage 4 embeddings (1024-dim)
- FalkorDB temporal knowledge graph via Graphiti
- Claude Sonnet extraction
- L0/L1/L2/L3 serving layer
- 19 MCP tools with access control
- Audit logging for all operations
- Quarantine/DLQ for unroutable items
- Curator maintenance (decay, prune, dedup detect)
- Claude.ai export ingestion adapter
- Access matrix with 12 NEops and scope bindings

### Deferred to v2

- LLM-backed wing/room classifier (v1 uses keywords)
- Real-time adapters (Fireflies, Matrix, Slack, git, Calendar)
- Conflict resolution UI
- Query rewriting (NL → structured query)
- Signal → task automation
- Web browse UI
- Client self-hosting
- Hinglish embedding model swap
- AAAK compression on read (Claude Haiku)
- Hot/cold storage tiering
- Schema migration runner
- Cost tracking dashboard
