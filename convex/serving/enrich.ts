// Enrichment queries — separate from search.ts because search uses "use node".

import { internalQuery } from "../_generated/server.js";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel.js";

// ─── Resolve embedding doc IDs to closetIds ─────────────────────

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
