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

// Recency fallback (ADR-neop-runtime index-propagation fix). The async vector/search indexes lag on the
// self-hosted backend (stall-leaning: a just-written closet can be invisible to vector+lexical search for
// 30min+ — box-proven 2026-07-01), so a fresh write is unrecallable until its index entry builds. This
// returns the last-N closets by createdAt via the TRANSACTIONAL `by_time` index, WITH each closet's stored
// embedding (the `closet_embeddings` row exists the instant `storeEmbedding` runs — only the vector INDEX is
// async). coreSearch computes cosine against these directly, so fresh writes are recallable immediately,
// scored by TRUE relevance (they surface when relevant, not always). Skips retracted/decayed/superseded.
export const recentClosetsWithEmbeddings = internalQuery({
  args: {
    palaceId: v.id("palaces"),
    limit: v.number(),
  },
  handler: async (ctx, { palaceId, limit }) => {
    const recents = await ctx.db
      .query("closets")
      .withIndex("by_time", (q) => q.eq("palaceId", palaceId))
      .order("desc") // most-recent createdAt first
      .take(limit);
    const out: Array<{ closetId: string; embedding: number[] }> = [];
    for (const c of recents) {
      if (c.retracted || c.decayed || c.supersededBy !== undefined) continue;
      const emb = await ctx.db
        .query("closet_embeddings")
        .withIndex("by_closet", (q) => q.eq("closetId", c._id))
        .first();
      if (emb) out.push({ closetId: c._id as string, embedding: emb.embedding });
    }
    return out;
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
