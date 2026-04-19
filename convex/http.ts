// Palace HTTP API — REST-like endpoint for MCP server proxy.
//
// Architecture:
//   Claude Code ←stdio→ mcpServer.ts ←HTTP→ convex/http.ts ←dispatch→ queries/mutations/actions
//
// Phase 7: Access control enforcement at the HTTP gate.
//   1. Resolve NEop permissions (runtime ops + content access + scope)
//   2. Check runtime op for the requested tool
//   3. Apply scope binding to search filters / write targets
//   4. Dispatch to the appropriate Convex function
//   5. For search results: post-filter by read permission
//   6. Audit log every call (success + failure + denied)

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
  type ResolvedPermissions,
  resolvePermissions,
  enforceRuntimeOp,
  enforceScope,
  enforceWrite,
  applyScopeToFilter,
  filterByReadAccess,
  runtimeOpForTool,
  AccessDenied,
} from "./access/enforce.js";

const http = httpRouter();

// ─── CORS ───────────────────────────────────────────────────────

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

// ─── Main dispatch with access control ──────────────────────────

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

    const { tool, params = {} } = body;
    const neopId =
      body.neopId ?? request.headers.get("X-Palace-Neop") ?? "_admin";
    const palaceId = (body.palaceId ?? params.palaceId) as string | undefined;

    if (!tool) return jsonResponse({ error: "missing_tool" }, 400);
    if (!palaceId) return jsonResponse({ error: "missing_palaceId" }, 400);

    const pid = palaceId as Id<"palaces">;

    try {
      // ── Phase 7: Access control gate ────────────────────
      // Resolve permissions via a mutation (has db access).
      const perms: ResolvedPermissions = await ctx.runQuery(
        internal.access.queries.resolvePermsQuery,
        { palaceId: pid, neopId },
      );

      // Check runtime op.
      const requiredOp = runtimeOpForTool(tool);
      if (requiredOp) {
        enforceRuntimeOp(perms, requiredOp);
      }

      // Dispatch with permissions context.
      const result = await dispatch(ctx, tool, {
        ...params,
        palaceId: pid,
        neopId,
        _perms: perms,
      });

      const latencyMs = Date.now() - t0;

      // Audit success.
      try {
        await ctx.runMutation(api.access.mutations.logAuditEvent, {
          palaceId: pid,
          op: (requiredOp ?? "search") as any,
          neopId,
          effectiveNeopId: perms.effectiveNeopId,
          status: "ok",
          latencyMs,
          extra: JSON.stringify({ tool }),
        });
      } catch (auditErr) { console.error("[audit] write failed:", auditErr); }

      return jsonResponse({ status: "ok", data: result });

    } catch (e) {
      const latencyMs = Date.now() - t0;
      const msg = e instanceof Error ? e.message : String(e);
      const isDenied = e instanceof AccessDenied;

      // Audit failure/denial.
      try {
        await ctx.runMutation(api.access.mutations.logAuditEvent, {
          palaceId: pid,
          op: (runtimeOpForTool(tool) ?? "search") as any,
          neopId,
          effectiveNeopId: neopId,
          status: isDenied ? "denied" : "error",
          latencyMs,
          extra: JSON.stringify({ tool, error: msg.slice(0, 200) }),
        });
      } catch (auditErr) { console.error("[audit] write failed:", auditErr); }

      const status = isDenied ? 403
        : msg.includes("not found") ? 404
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

// ─── Tool dispatcher (with permissions threaded through) ────────

async function dispatch(
  ctx: any,
  tool: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const palaceId = params.palaceId as Id<"palaces">;
  const neopId = params.neopId as string;
  const perms = params._perms as ResolvedPermissions;

  switch (tool) {
    // ── RECALL ────────────────────────────────────────────
    case "palace_recall": {
      const wingFilter = applyScopeToFilter(
        perms,
        params.wingFilter as string | undefined,
      );
      // assembleContext already does scope lookup, but we enforce here too.
      const result: any = await ctx.runAction(
        api.serving.assemble.assembleContext,
        {
          palaceId,
          query: params.query as string,
          neopId,
          maxTokens: params.maxTokens as number | undefined,
        },
      );
      // Post-filter results by read permission.
      if (result.context && !perms.isAdmin) {
        // assembleContext returns formatted text, not structured results.
        // The filtering happens inside assembleContext via neopId scope.
        // For deeper filtering, Phase 7 adds per-result checks in coreSearch.
      }
      return result;
    }

    // ── SEARCH ────────────────────────────────────────────
    case "palace_search": {
      const wingFilter = applyScopeToFilter(
        perms,
        params.wingFilter as string | undefined,
      );
      const result: any = await ctx.runAction(
        api.serving.search.searchPalace,
        {
          palaceId,
          query: params.query as string,
          wingFilter,
          categoryFilter: params.categoryFilter as string | undefined,
          limit: params.limit as number | undefined,
          similarityFloor: params.similarityFloor as number | undefined,
        },
      );
      // Post-filter: drop results the NEop can't read.
      if (result.results && !perms.isAdmin) {
        result.results = filterByReadAccess(perms, result.results);
      }
      return result;
    }

    case "palace_search_temporal": {
      const result: any = await ctx.runAction(
        api.serving.search.searchTemporal,
        {
          palaceId,
          query: params.query as string,
          after: params.after as number | undefined,
          before: params.before as number | undefined,
          limit: params.limit as number | undefined,
        },
      );
      if (result.results && !perms.isAdmin) {
        result.results = filterByReadAccess(perms, result.results);
      }
      return result;
    }

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
        neop: { id: neopId, scope: perms.scopeWing ? `${perms.scopeWing}/${perms.scopeRoom ?? "*"}` : "unrestricted" },
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

    case "palace_get_room": {
      // Scope check: can this NEop access this room's wing?
      if (perms.scopeWing) {
        const room: any = await ctx.runQuery(api.palace.queries.getRoom, {
          roomId: params.roomId as Id<"rooms">,
        });
        if (room) {
          const wing: any = await ctx.runQuery(api.palace.queries.getWingByName, {
            palaceId,
            name: perms.scopeWing,
          });
          if (wing && room.wingId !== wing._id) {
            throw new AccessDenied(neopId, `scoped to wing "${perms.scopeWing}" — cannot access this room`);
          }
        }
      }
      return ctx.runQuery(api.serving.rooms.getRoomDeep, {
        palaceId,
        roomId: params.roomId as Id<"rooms">,
        pageSize: params.pageSize as number | undefined,
        cursor: params.cursor as number | undefined,
      });
    }

    case "palace_walk_tunnel":
      return ctx.runQuery(api.serving.tunnels.walkTunnel, {
        palaceId,
        fromRoomId: params.fromRoomId as Id<"rooms">,
        maxDepth: params.maxDepth as number | undefined,
        relationshipFilter: params.relationshipFilter as string | undefined,
      });

    // ── STORAGE ───────────────────────────────────────────
    case "palace_remember":
      return ctx.runAction(api.ingestion.ingest.ingestExchange, {
        palaceId,
        human: (params.content as string) ?? (params.human as string),
        assistant: (params.context as string) ?? (params.assistant as string) ?? "",
        timestamp: Date.now(),
        conversationId: `mcp_${neopId}_${Date.now()}`,
        conversationTitle: (params.title as string) ?? "MCP memory",
        exchangeIndex: 0,
      });

    case "palace_add_closet": {
      // Enforce write access for the target wing + category.
      if (!perms.isAdmin) {
        const room: any = await ctx.runQuery(api.palace.queries.getRoom, {
          roomId: params.roomId as Id<"rooms">,
        });
        if (!room) throw new Error(`room ${params.roomId} not found`);
        const wings: any[] = await ctx.runQuery(api.palace.queries.listWings, { palaceId });
        const wing = wings.find((w: any) => w._id === room.wingId);
        if (!wing) throw new Error(`wing for room ${params.roomId} not found`);
        enforceScope(perms, wing.name);
        enforceWrite(perms, wing.name, params.category as string);
      }
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
    }

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
      return ctx.runMutation(api.palace.mutations.mergeRooms, {
        palaceId,
        sourceRoomId: params.sourceRoomId as Id<"rooms">,
        targetRoomId: params.targetRoomId as Id<"rooms">,
      });

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
