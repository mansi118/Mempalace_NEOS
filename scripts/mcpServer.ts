#!/usr/bin/env npx tsx
// Palace MCP Server — local stdio process for Claude Code integration.
//
// Speaks the MCP protocol (JSON-RPC 2.0 over stdio) and proxies tool
// calls to the Convex HTTP endpoint.
//
// Usage:
//   claude mcp add palace -- npx tsx scripts/mcpServer.ts
//   claude mcp add palace -- npx tsx scripts/mcpServer.ts --neop-id=aria
//   claude mcp add palace -- npx tsx scripts/mcpServer.ts --neop-id=icd_zoo_media
//
// Environment:
//   CONVEX_SITE_URL  — Convex HTTP endpoint (e.g. https://xyz.convex.site)
//   PALACE_ID        — default palaceId to use

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Args ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
const neopIdArg = args.find((a) => a.startsWith("--neop-id="));
const NEOP_ID = neopIdArg ? neopIdArg.split("=")[1]! : "_admin";

const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL ?? "";
const PALACE_ID = process.env.PALACE_ID ?? "";

// ─── HTTP caller ────────────────────────────────────────────────

async function callPalace(
  tool: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (!CONVEX_SITE_URL) {
    throw new Error(
      "CONVEX_SITE_URL not set. Set it to your Convex deployment's HTTP URL.",
    );
  }

  const resp = await fetch(`${CONVEX_SITE_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Palace-Neop": NEOP_ID,
    },
    body: JSON.stringify({
      tool,
      params: { ...params, palaceId: params.palaceId ?? PALACE_ID },
      neopId: NEOP_ID,
    }),
  });

  const data = await resp.json();

  if (!resp.ok) {
    throw new Error(data.error ?? `HTTP ${resp.status}`);
  }

  return data.data ?? data;
}

// ─── MCP Server ─────────────────────────────────────────────────

const server = new McpServer({
  name: "palace",
  version: "0.1.0",
});

// ── RECALL (primary entry point) ────────────────────────────────

server.tool(
  "palace_recall",
  "Search palace memory for relevant context. Returns formatted memories with confidence level. Use this FIRST for any question about past decisions, people, projects, or facts.",
  {
    query: z.string().describe("What to search for in memory"),
    palaceId: z.string().optional().describe("Palace ID (uses default if omitted)"),
    maxTokens: z.number().optional().describe("Max tokens in response (default 2000)"),
  },
  async ({ query, palaceId, maxTokens }) => {
    const result = await callPalace("palace_recall", { query, palaceId, maxTokens });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── SEARCH ──────────────────────────────────────────────────────

server.tool(
  "palace_search",
  "Raw vector search with optional wing/category filters. Use palace_recall for general queries; use this for precise filtered searches.",
  {
    query: z.string().describe("Search query"),
    palaceId: z.string().optional(),
    wingFilter: z.string().optional().describe("Filter to a specific wing (e.g. 'platform', 'clients')"),
    categoryFilter: z.string().optional().describe("Filter to a category (e.g. 'decision', 'fact')"),
    limit: z.number().optional().describe("Max results (default 5)"),
  },
  async (params) => {
    const result = await callPalace("palace_search", params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "palace_search_temporal",
  "Search memories within a time range. Use for 'what did we decide last week' type queries.",
  {
    query: z.string().describe("Search query"),
    palaceId: z.string().optional(),
    after: z.number().optional().describe("Unix timestamp: only results after this time"),
    before: z.number().optional().describe("Unix timestamp: only results before this time"),
    limit: z.number().optional(),
  },
  async (params) => {
    const result = await callPalace("palace_search_temporal", params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── NAVIGATION ──────────────────────────────────────────────────

server.tool(
  "palace_status",
  "Get palace identity briefing, wing index, and memory protocol. Call this at session start.",
  {
    palaceId: z.string().optional(),
  },
  async (params) => {
    const result = await callPalace("palace_status", params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "palace_list_wings",
  "List all wings in the palace with room counts.",
  {
    palaceId: z.string().optional(),
    includeArchived: z.boolean().optional(),
  },
  async (params) => {
    const result = await callPalace("palace_list_wings", params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "palace_list_rooms",
  "List rooms in a specific wing.",
  {
    wingId: z.string().describe("Wing ID"),
  },
  async (params) => {
    const result = await callPalace("palace_list_rooms", params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "palace_get_room",
  "Deep dive into a room: all memories, facts, and connections. Use after identifying the room via search.",
  {
    roomId: z.string().describe("Room ID"),
    palaceId: z.string().optional(),
    pageSize: z.number().optional().describe("Memories per page (default 20)"),
    cursor: z.number().optional().describe("Pagination cursor from previous response"),
  },
  async (params) => {
    const result = await callPalace("palace_get_room", params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "palace_walk_tunnel",
  "Traverse connections from a room. Discovers related rooms across wings. Use for 'what's connected to X' queries.",
  {
    fromRoomId: z.string().describe("Starting room ID"),
    palaceId: z.string().optional(),
    maxDepth: z.number().optional().describe("Max traversal depth (default 2)"),
    relationshipFilter: z.string().optional().describe("Filter by relationship type: depends_on, contradicts, extends, caused_by, clarifies, references"),
  },
  async (params) => {
    const result = await callPalace("palace_walk_tunnel", params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── STORAGE ─────────────────────────────────────────────────────

server.tool(
  "palace_remember",
  "Store a new memory. Auto-routes to the correct wing/room/category via AI extraction. Use this to save decisions, facts, or lessons from the current conversation.",
  {
    content: z.string().describe("The memory content to store"),
    title: z.string().optional().describe("Short title for the memory"),
    context: z.string().optional().describe("Additional context (e.g. prior conversation)"),
    palaceId: z.string().optional(),
  },
  async (params) => {
    const result = await callPalace("palace_remember", params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "palace_add_drawer",
  "Add an atomic fact to an existing memory closet.",
  {
    closetId: z.string().describe("Closet ID to add the fact to"),
    fact: z.string().describe("Single atomic fact (< 100 chars, testable as true/false)"),
    palaceId: z.string().optional(),
    confidence: z.number().optional().describe("Confidence 0-1 (default 0.8)"),
  },
  async (params) => {
    const result = await callPalace("palace_add_drawer", params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "palace_create_room",
  "Create a new room in a wing. Use when existing rooms don't cover a topic.",
  {
    wingName: z.string().describe("Wing name (e.g. 'platform', 'clients')"),
    roomName: z.string().describe("Room name (lowercase, hyphenated)"),
    summary: z.string().optional().describe("Room description"),
    palaceId: z.string().optional(),
  },
  async (params) => {
    const result = await callPalace("palace_create_room", params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "palace_create_tunnel",
  "Create a connection between two rooms.",
  {
    fromRoomId: z.string().describe("Source room ID"),
    toRoomId: z.string().describe("Target room ID"),
    relationship: z.enum(["depends_on", "contradicts", "extends", "caused_by", "clarifies", "references"]),
    palaceId: z.string().optional(),
    strength: z.number().optional().describe("Connection strength 0-1 (default 0.5)"),
    label: z.string().optional(),
  },
  async (params) => {
    const result = await callPalace("palace_create_tunnel", params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── MAINTENANCE ─────────────────────────────────────────────────

server.tool(
  "palace_invalidate",
  "Mark a fact (drawer) as no longer valid. The fact remains but is excluded from default queries.",
  {
    drawerId: z.string().describe("Drawer ID to invalidate"),
    supersededBy: z.string().optional().describe("ID of the drawer that replaces this one"),
  },
  async (params) => {
    const result = await callPalace("palace_invalidate", params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── META ────────────────────────────────────────────────────────

server.tool(
  "palace_stats",
  "Get palace statistics: wing/room/closet/drawer counts, category distribution, queue sizes.",
  {
    palaceId: z.string().optional(),
  },
  async (params) => {
    const result = await callPalace("palace_stats", params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "palace_export",
  "Export palace contents as Markdown. Optionally filter to a single wing.",
  {
    palaceId: z.string().optional(),
    wingFilter: z.string().optional().describe("Export only this wing"),
  },
  async (params) => {
    const result = await callPalace("palace_export", params);
    return { content: [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result) }] };
  },
);

// ── ADMIN (available but not prominently described) ─────────────

server.tool(
  "palace_retract_closet",
  "[Admin] GDPR-style erasure: replace content with [REDACTED], delete embedding.",
  {
    closetId: z.string().describe("Closet ID to retract"),
    reason: z.string().describe("Reason for retraction"),
  },
  async (params) => {
    const result = await callPalace("palace_retract_closet", params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "palace_add_closet",
  "[Admin] Low-level closet creation with explicit wing/room/category. Use palace_remember for auto-routing.",
  {
    roomId: z.string().describe("Room ID"),
    content: z.string().describe("Memory content"),
    category: z.string().describe("Category: fact, decision, task, conversation, lesson, preference, procedure, signal, identity, goal, relationship, metric, question"),
    palaceId: z.string().optional(),
    title: z.string().optional(),
    confidence: z.number().optional(),
  },
  async (params) => {
    const result = await callPalace("palace_add_closet", params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "palace_create_wing",
  "[Admin] Create a new wing in the palace.",
  {
    name: z.string().describe("Wing name (lowercase, hyphenated)"),
    description: z.string().describe("Wing description"),
    palaceId: z.string().optional(),
    sortOrder: z.number().optional(),
  },
  async (params) => {
    const result = await callPalace("palace_create_wing", params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ─── Start server ───────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until the process is killed.
}

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});
