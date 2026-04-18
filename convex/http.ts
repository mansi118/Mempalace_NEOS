// Palace HTTP API — REST-like endpoint for MCP server proxy.
//
// This is NOT the MCP server itself. The MCP server is scripts/mcpServer.ts
// (local stdio process). This HTTP action handles tool dispatch: the MCP
// server translates JSON-RPC tool calls into HTTP POST requests to this
// endpoint.
//
// Architecture (Tier 1 fix from ultrathink):
//   Claude Code ←stdio→ mcpServer.ts ←HTTP→ convex/http.ts ←dispatch→ queries/mutations/actions

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";

const http = httpRouter();

// ─── CORS headers for cross-origin requests ─────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Palace-Neop",
};

http.route({
  path: "/mcp",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }),
});

// ─── Main tool dispatch endpoint ────────────────────────────────

http.route({
  path: "/mcp",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const t0 = Date.now();

    let body: {
      tool: string;
      params: Record<string, unknown>;
      neopId?: string;
      palaceId?: string;
    };

    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }

    const { tool, params } = body;
    const neopId = body.neopId ?? request.headers.get("X-Palace-Neop") ?? "_admin";
    const palaceId = (body.palaceId ?? params?.palaceId) as string | undefined;

    if (!tool) return jsonResponse({ error: "missing_tool" }, 400);

    try {
      const result = await dispatch(ctx, tool, { ...params, palaceId, neopId });
      const latencyMs = Date.now() - t0;

      // Audit log (best-effort).
      if (palaceId) {
        try {
          await ctx.runMutation(api.access.mutations.logAuditEvent, {
            palaceId: palaceId as Id<"palaces">,
            op: "search" as any,
            neopId,
            effectiveNeopId: neopId,
            status: "ok",
            latencyMs,
          });
        } catch { /* audit must not break ops */ }
      }

      return jsonResponse({ status: "ok", data: result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const latencyMs = Date.now() - t0;

      // Audit the failure.
      if (palaceId) {
        try {
          await ctx.runMutation(api.access.mutations.logAuditEvent, {
            palaceId: palaceId as Id<"palaces">,
            op: "search" as any,
            neopId,
            effectiveNeopId: neopId,
            status: "error",
            latencyMs,
            extra: JSON.stringify({ tool, error: msg.slice(0, 200) }),
          });
        } catch { /* audit must not break ops */ }
      }

      const status = msg.includes("not found") ? 404
        : msg.includes("access") || msg.includes("denied") ? 403
        : msg.includes("invalid") || msg.includes("missing") ? 400
        : 500;

      return jsonResponse({ status: "error", error: msg }, status);
    }
  }),
});

// ─── Health endpoint ────────────────────────────────────────────

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return jsonResponse({ status: "ok", service: "palace-mcp" });
  }),
});

// ─── Tool dispatcher ────────────────────────────────────────────

async function dispatch(
  ctx: any,
  tool: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const palaceId = params.palaceId as Id<"palaces"> | undefined;
  const neopId = params.neopId as string;

  switch (tool) {
    // ── RECALL (primary) ──────────────────────────────────
    case "palace_recall":
      return ctx.runAction(api.serving.assemble.assembleContext, {
        palaceId,
        query: params.query as string,
        neopId,
        maxTokens: params.maxTokens as number | undefined,
      });

    // ── SEARCH ────────────────────────────────────────────
    case "palace_search":
      return ctx.runAction(api.serving.search.searchPalace, {
        palaceId,
        query: params.query as string,
        wingFilter: params.wingFilter as string | undefined,
        categoryFilter: params.categoryFilter as string | undefined,
        limit: params.limit as number | undefined,
        similarityFloor: params.similarityFloor as number | undefined,
      });

    case "palace_search_temporal":
      return ctx.runAction(api.serving.search.searchTemporal, {
        palaceId,
        query: params.query as string,
        after: params.after as number | undefined,
        before: params.before as number | undefined,
        limit: params.limit as number | undefined,
      });

    // ── NAVIGATION ────────────────────────────────────────
    case "palace_status": {
      const [l0, l1, stats] = await Promise.all([
        ctx.runQuery(api.serving.l0l1.getL0, { palaceId }),
        ctx.runQuery(api.serving.l0l1.getL1, { palaceId }),
        ctx.runQuery(api.palace.queries.getStats, { palaceId }),
      ]);
      return {
        l0: l0 ?? "Palace identity not generated. Run seed:palace first.",
        l1: l1 ?? "Wing index not generated.",
        stats,
        protocol: PALACE_PROTOCOL,
      };
    }

    case "palace_list_wings":
      return ctx.runQuery(api.palace.queries.listWings, {
        palaceId,
        includeArchived: params.includeArchived as boolean | undefined,
      });

    case "palace_list_rooms":
      return ctx.runQuery(api.palace.queries.listRoomsByWing, {
        wingId: params.wingId as Id<"wings">,
      });

    case "palace_get_room":
      return ctx.runQuery(api.serving.rooms.getRoomDeep, {
        palaceId,
        roomId: params.roomId as Id<"rooms">,
        pageSize: params.pageSize as number | undefined,
        cursor: params.cursor as number | undefined,
      });

    case "palace_walk_tunnel":
      return ctx.runQuery(api.serving.tunnels.walkTunnel, {
        palaceId,
        fromRoomId: params.fromRoomId as Id<"rooms">,
        maxDepth: params.maxDepth as number | undefined,
        relationshipFilter: params.relationshipFilter as string | undefined,
      });

    // ── STORAGE ───────────────────────────────────────────
    case "palace_remember":
      // High-level: auto-route via Gemini extraction.
      return ctx.runAction(api.ingestion.ingest.ingestExchange, {
        palaceId,
        human: params.content as string ?? params.human as string,
        assistant: params.context as string ?? params.assistant as string ?? "",
        timestamp: Date.now(),
        conversationId: `mcp_${neopId}_${Date.now()}`,
        conversationTitle: params.title as string ?? "MCP memory",
        exchangeIndex: 0,
      });

    case "palace_add_closet":
      return ctx.runMutation(api.palace.mutations.createCloset, {
        roomId: params.roomId as Id<"rooms">,
        palaceId,
        content: params.content as string,
        title: params.title as string | undefined,
        category: params.category as string,
        sourceType: "manual",
        sourceRef: `mcp:${neopId}`,
        sourceAdapter: "mcp",
        sourceExternalId: `mcp_${neopId}_${Date.now()}`,
        authorType: "neop",
        authorId: neopId,
        confidence: (params.confidence as number) ?? 0.8,
        needsReview: params.needsReview as boolean | undefined,
      });

    case "palace_add_drawer":
      return ctx.runMutation(api.palace.mutations.createDrawer, {
        closetId: params.closetId as Id<"closets">,
        palaceId,
        fact: params.fact as string,
        validFrom: Date.now(),
        confidence: (params.confidence as number) ?? 0.8,
      });

    case "palace_create_room":
      return ctx.runMutation(api.palace.mutations.getOrCreateRoom, {
        palaceId,
        wingName: params.wingName as string,
        roomName: params.roomName as string,
        summary: params.summary as string | undefined,
      });

    case "palace_create_tunnel":
      return ctx.runMutation(api.palace.mutations.createTunnel, {
        palaceId,
        fromRoomId: params.fromRoomId as Id<"rooms">,
        toRoomId: params.toRoomId as Id<"rooms">,
        relationship: params.relationship as string,
        strength: (params.strength as number) ?? 0.5,
        label: params.label as string | undefined,
      });

    // ── MAINTENANCE ───────────────────────────────────────
    case "palace_invalidate":
      return ctx.runMutation(api.palace.mutations.invalidateDrawer, {
        drawerId: params.drawerId as Id<"drawers">,
        supersededBy: params.supersededBy as Id<"drawers"> | undefined,
      });

    case "palace_retract_closet":
      return ctx.runMutation(api.palace.mutations.retractCloset, {
        closetId: params.closetId as Id<"closets">,
        reason: params.reason as string,
        retractedBy: neopId,
      });

    case "palace_merge_rooms":
      // Move all closets from source to target, then delete source.
      // Implemented inline since it's admin-only.
      throw new Error("palace_merge_rooms not yet implemented");

    // ── META ──────────────────────────────────────────────
    case "palace_stats":
      return ctx.runQuery(api.palace.queries.getStats, { palaceId });

    case "palace_export":
      return ctx.runQuery(api.serving.export.exportToMarkdown, {
        palaceId,
        wingFilter: params.wingFilter as string | undefined,
      });

    case "palace_create_wing":
      return ctx.runMutation(api.palace.mutations.createWing, {
        palaceId,
        name: params.name as string,
        description: params.description as string,
        sortOrder: (params.sortOrder as number) ?? 99,
      });

    default:
      throw new Error(`unknown tool: ${tool}`);
  }
}

// ─── PALACE PROTOCOL ────────────────────────────────────────────

const PALACE_PROTOCOL = `PALACE PROTOCOL — How to use memory tools:
1. Call palace_status at session start to load identity + wing index.
2. For any question about past decisions, people, projects, or facts:
   call palace_recall first. It returns formatted context.
3. For precise queries with filters: use palace_search or palace_search_temporal.
4. If recall returns confidence=low, say "I don't have that in memory."
5. To store new information from this conversation: call palace_remember
   with the content. It auto-routes to the correct wing/room.
6. For deep context on a topic: use palace_get_room after identifying the room.
7. For cross-topic connections: use palace_walk_tunnel.
8. Never fabricate memories — only report what the palace contains.`;

// ─── Helpers ────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

export default http;
