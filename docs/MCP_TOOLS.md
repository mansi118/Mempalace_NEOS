# PALACE MCP Tools — API Reference

19 tools exposed via the MCP server. Register with Claude Code:

```bash
export CONVEX_SITE_URL=https://<deployment>.convex.site
export PALACE_ID=<palace-id>
claude mcp add palace -- npx tsx scripts/mcpServer.ts --neop-id=aria
```

---

## Core Tools (14)

### palace_recall

**Primary memory access.** Returns L0 identity + L1 wing index + L2 search results, formatted for system prompt injection. Use this FIRST for any question about past decisions, people, or facts.

| Param | Type | Required | Description |
|---|---|---|---|
| query | string | Yes | What to search for |
| palaceId | string | No | Uses default if omitted |
| maxTokens | number | No | Max tokens in response (default 2000) |

**Returns:** `{ context, tokenEstimate, searchConfidence, resultCount, queryTimeMs }`

**Access:** Requires `recall` runtime op.

---

### palace_search

**Raw vector search** with wing/category filters. Use when you need fine-grained control over search scope.

| Param | Type | Required | Description |
|---|---|---|---|
| query | string | Yes | Search query |
| palaceId | string | No | |
| wingFilter | string | No | Restrict to wing (e.g. "platform") |
| categoryFilter | string | No | Restrict to category (e.g. "decision") |
| limit | number | No | Max results (default 5) |
| similarityFloor | number | No | Min score threshold (default 0.5) |

**Returns:** `{ results[], confidence, reason, tokenEstimate, queryTimeMs }`

Each result: `{ closetId, score, content, title, category, wingName, roomName, createdAt, confidence }`

**Access:** Requires `recall`. Results filtered by NEop's read permissions. Scope bindings enforced.

---

### palace_search_temporal

**Time-bounded search.** For "what did we decide last week" queries.

| Param | Type | Required | Description |
|---|---|---|---|
| query | string | Yes | Search query |
| palaceId | string | No | |
| after | number | No | Unix ms: only results after this time |
| before | number | No | Unix ms: only results before this time |
| limit | number | No | Max results (default 5) |

**Access:** Requires `recall`.

---

### palace_status

**Session start tool.** Returns palace identity, wing index, and the PALACE_PROTOCOL that guides tool selection. Call at session start.

| Param | Type | Required | Description |
|---|---|---|---|
| palaceId | string | No | |

**Returns:** `{ l0, l1, stats, protocol, neop: { id, scope } }`

**Access:** Requires `recall`.

---

### palace_list_wings

**Wing directory.** Lists all wings with room counts, sorted by recent activity.

| Param | Type | Required | Description |
|---|---|---|---|
| palaceId | string | No | |
| includeArchived | boolean | No | Include archived wings (default false) |

**Access:** Requires `recall`.

---

### palace_list_rooms

**Rooms in a wing.** Lists rooms with closet counts.

| Param | Type | Required | Description |
|---|---|---|---|
| wingId | string | Yes | Wing ID |

**Access:** Requires `recall`.

---

### palace_get_room

**L3 deep dive.** All memories, facts, and connections in a room. Paginated (20 per page).

| Param | Type | Required | Description |
|---|---|---|---|
| roomId | string | Yes | Room ID |
| palaceId | string | No | |
| pageSize | number | No | Items per page (default 20) |
| cursor | number | No | Pagination cursor from previous response |

**Returns:** `{ room, closets[], tunnels[], pagination: { hasMore, nextCursor } }`

Each closet includes its drawers (atomic facts).

**Access:** Requires `recall`. Scope bindings enforced on room's wing.

---

### palace_walk_tunnel

**Tunnel traversal.** BFS from a room, discovering connected rooms across wings. Use for "what's related to X" queries.

| Param | Type | Required | Description |
|---|---|---|---|
| fromRoomId | string | Yes | Starting room ID |
| palaceId | string | No | |
| maxDepth | number | No | Traversal depth (default 2) |
| relationshipFilter | string | No | Filter: depends_on, contradicts, extends, caused_by, clarifies, references |

**Returns:** `{ path: [{ roomId, roomName, wingName, summary, depth, relationship, strength }] }`

**Access:** Requires `recall`.

---

### palace_remember

**Store a new memory.** Auto-routes to the correct wing/room/category via Gemini extraction. Use this to save decisions, facts, or lessons from the current conversation.

| Param | Type | Required | Description |
|---|---|---|---|
| content | string | Yes | The memory content to store |
| title | string | No | Short title |
| context | string | No | Additional context |
| palaceId | string | No | |

**Returns:** `{ status, closetsCreated, drawersCreated, tokensUsed, errors[] }`

**Access:** Requires `remember`. Auto-routing may place content in any wing the NEop has write access to.

---

### palace_add_drawer

**Add an atomic fact** to an existing closet.

| Param | Type | Required | Description |
|---|---|---|---|
| closetId | string | Yes | Parent closet ID |
| fact | string | Yes | Atomic fact (< 100 chars) |
| palaceId | string | No | |
| confidence | number | No | 0-1 (default 0.8) |

**Access:** Requires `remember`.

---

### palace_create_room

**Create a new room** in a wing. Use when existing rooms don't cover a topic.

| Param | Type | Required | Description |
|---|---|---|---|
| wingName | string | Yes | Wing (e.g. "platform") |
| roomName | string | Yes | Room name (lowercase, hyphenated) |
| summary | string | No | Room description |
| palaceId | string | No | |

**Access:** Requires `remember`.

---

### palace_create_tunnel

**Connect two rooms** with a typed relationship.

| Param | Type | Required | Description |
|---|---|---|---|
| fromRoomId | string | Yes | Source room ID |
| toRoomId | string | Yes | Target room ID |
| relationship | string | Yes | depends_on, contradicts, extends, caused_by, clarifies, references |
| palaceId | string | No | |
| strength | number | No | 0-1 (default 0.5) |
| label | string | No | Human-readable label |

**Access:** Requires `remember`.

---

### palace_invalidate

**Invalidate a fact** (drawer). Marks it as no longer valid. The fact remains queryable with `includeDecayed=true` but is excluded from default results.

| Param | Type | Required | Description |
|---|---|---|---|
| drawerId | string | Yes | Drawer ID |
| supersededBy | string | No | ID of replacement drawer |

**Access:** Requires `remember`.

---

### palace_stats

**Palace statistics.** Wing/room/closet/drawer counts, category distribution, queue sizes.

| Param | Type | Required | Description |
|---|---|---|---|
| palaceId | string | No | |

**Returns:** `{ palace, wings, closets: { total, visible, retracted, decayed, needsReview, byCategory }, drawers, tunnels }`

**Access:** Requires `recall`.

---

## Admin Tools (5)

### palace_retract_closet

**GDPR-style erasure.** Replaces content with [REDACTED], deletes embedding. Irreversible.

| Param | Type | Required | Description |
|---|---|---|---|
| closetId | string | Yes | Closet to retract |
| reason | string | Yes | Reason for retraction |

**Access:** Requires `erase`.

---

### palace_add_closet

**Low-level closet creation** with explicit wing/room/category. Use `palace_remember` for auto-routing.

| Param | Type | Required | Description |
|---|---|---|---|
| roomId | string | Yes | Room ID |
| content | string | Yes | Memory content |
| category | string | Yes | fact, decision, task, conversation, lesson, preference, procedure, signal, identity, goal, relationship, metric, question |
| palaceId | string | No | |
| title | string | No | Short title |
| confidence | number | No | 0-1 (default 0.8) |

**Access:** Requires `remember`. Write access to the room's wing + category enforced.

---

### palace_create_wing

**Create a new wing.**

| Param | Type | Required | Description |
|---|---|---|---|
| name | string | Yes | Wing name (lowercase, hyphenated) |
| description | string | Yes | Wing description |
| palaceId | string | No | |
| sortOrder | number | No | Display order (default 99) |

**Access:** Requires `remember`.

---

### palace_merge_rooms

**Merge two rooms.** Moves all closets/drawers from source to target, re-points tunnels, deletes source.

| Param | Type | Required | Description |
|---|---|---|---|
| sourceRoomId | string | Yes | Room to merge FROM (will be deleted) |
| targetRoomId | string | Yes | Room to merge INTO |
| palaceId | string | No | |

**Access:** Requires `erase`.

---

### palace_export

**Export palace as Markdown.** For backup, GDPR portability, debugging.

| Param | Type | Required | Description |
|---|---|---|---|
| palaceId | string | No | |
| wingFilter | string | No | Export only this wing |

**Returns:** Hierarchical Markdown string.

**Access:** Requires `recall`.
