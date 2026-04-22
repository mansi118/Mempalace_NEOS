"use node";
// Graph explorer — Convex actions that proxy FalkorDB bridge reads.
//
// Frontend calls these so the bridge bearer key stays server-side. Each
// action has a 5s timeout and swallows bridge errors into an empty result
// so UI degrades gracefully when the bridge is slow or down.

import { action } from "../_generated/server.js";
import { v } from "convex/values";

interface BridgeResp<T> {
  status: string;
  data?: T;
  detail?: string;
}

async function callBridge<T>(path: string, body?: any): Promise<T | null> {
  const bridgeUrl = process.env.GRAPHITI_BRIDGE_URL;
  const bridgeKey = process.env.PALACE_BRIDGE_API_KEY;
  if (!bridgeUrl) return null;

  try {
    const resp = await fetch(`${bridgeUrl}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(bridgeKey ? { "X-Palace-Key": bridgeKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as BridgeResp<T>;
    if (json.status !== "ok" || !json.data) return null;
    return json.data;
  } catch {
    return null;
  }
}

export const graphStats = action({
  args: { palaceId: v.string() },
  handler: async (_ctx, { palaceId }): Promise<{ entities: number; closets: number; relationships: number } | null> => {
    return callBridge(`/graph/stats/${encodeURIComponent(palaceId)}`);
  },
});

export const graphSearch = action({
  args: { palaceId: v.string(), query: v.string(), limit: v.optional(v.number()) },
  handler: async (_ctx, { palaceId, query, limit }) => {
    const data = await callBridge<{ results: any[] }>(`/graph/search`, {
      palace_id: palaceId,
      query,
      limit: limit ?? 20,
    });
    return data?.results ?? [];
  },
});

export const graphTraverse = action({
  args: { palaceId: v.string(), entityName: v.string(), maxDepth: v.optional(v.number()) },
  handler: async (_ctx, { palaceId, entityName, maxDepth }) => {
    const data = await callBridge<{ start: string; connected: any[] }>(`/graph/traverse`, {
      palace_id: palaceId,
      entity_name: entityName,
      max_depth: maxDepth ?? 2,
    });
    return data ?? { start: entityName, connected: [] };
  },
});
