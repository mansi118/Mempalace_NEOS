// Enrichment queries — separate from search.ts because search uses "use node".

import { internalQuery } from "../_generated/server.js";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel.js";

// ─── Palace lookup for graph search ─────────────────────────────

export const getPalaceForSearch = internalQuery({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    return await ctx.db.get(palaceId);
  },
});

// ─── Resolve embedding doc IDs to closetIds ─────────────────────

// Hybrid retrieval (ADR-neop-runtime GAP-1 floor fix): the lexical/full-text channel. Returns closetIds
// ordered best-first by full-text relevance. Run alongside vector search in coreSearch; lets exact-term
// matches surface and bypass the cosine floor that the pure-vector channel applies.
export const lexicalSearchClosets = internalQuery({
  args: {
    palaceId: v.id("palaces"),
    query: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, { palaceId, query, limit }) => {
    const hits = await ctx.db
      .query("closets")
      .withSearchIndex("search_content", (q) =>
        q.search("content", query).eq("palaceId", palaceId),
      )
      .take(limit);
    return hits.map((c) => c._id as string); // ordered by full-text relevance (best first)
  },
});

export const resolveEmbeddingIds = internalQuery({
  args: {
    embeddingIds: v.array(v.string()),
  },
  handler: async (ctx, { embeddingIds }) => {
    const results: Array<{ closetId: string; embeddingId: string } | null> = [];

    for (const embId of embeddingIds) {
      try {
        const emb = await ctx.db.get(embId as Id<"closet_embeddings">);
        if (emb) {
          results.push({
            closetId: emb.closetId as string,
            embeddingId: embId,
          });
        } else {
          results.push(null);
        }
      } catch {
        results.push(null);
      }
    }

    return results;
  },
});

// ─── Closet enrichment ──────────────────────────────────────────

export const enrichClosets = internalQuery({
  args: {
    closetIds: v.array(v.id("closets")),
  },
  handler: async (ctx, { closetIds }) => {
    const results = await Promise.all(
      closetIds.map(async (id) => {
        const closet = await ctx.db.get(id);
        if (!closet) return null;

        const [wing, room] = await Promise.all([
          ctx.db.get(closet.wingId),
          ctx.db.get(closet.roomId),
        ]);

        return {
          closet,
          wingName: wing?.name ?? "unknown",
          roomName: room?.name ?? "unknown",
        };
      }),
    );

    return results;
  },
});
