// HTTP client for the FalkorDB bridge (13.127.254.149:8100).
// Used by coreSearch as a parallel retrieval path alongside vector search.

export interface GraphSearchHit {
  entity: string;
  type: string;
  occurrences: number;
  closets: string[];
}

export async function graphSearch(
  palaceId: string,
  query: string,
  limit = 10,
): Promise<GraphSearchHit[]> {
  const bridgeUrl = process.env.GRAPHITI_BRIDGE_URL;
  const bridgeKey = process.env.PALACE_BRIDGE_API_KEY;
  if (!bridgeUrl) return [];

  try {
    const resp = await fetch(`${bridgeUrl}/graph/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bridgeKey ? { "X-Palace-Key": bridgeKey } : {}),
      },
      body: JSON.stringify({ palace_id: palaceId, query, limit }),
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return [];
    const body = (await resp.json()) as {
      status: string;
      data?: { results: Array<Record<string, unknown>> };
    };
    if (body.status !== "ok" || !body.data) return [];

    return body.data.results.map((r) => ({
      entity: String(r["e.name"] ?? ""),
      type: String(r["e.type"] ?? ""),
      occurrences: Number(r["e.occurrences"] ?? 0),
      closets: parseClosetList(r.closets),
    }));
  } catch {
    return [];
  }
}

// FalkorDB returns closet lists either as JSON arrays or as string-formatted
// lists like "[id1, id2, id3]". Normalize to string[].
function parseClosetList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string") return [];
  const inner = raw.replace(/^\[|\]$/g, "").trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Build a map closetId → boost (number of query-matching entities in that closet).
export function buildGraphBoostMap(hits: GraphSearchHit[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const h of hits) {
    for (const cid of h.closets) {
      m.set(cid, (m.get(cid) ?? 0) + 1);
    }
  }
  return m;
}
