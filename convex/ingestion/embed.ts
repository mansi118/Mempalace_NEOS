"use node";
// Gemini embedding generation.
//
// "use node" is required because this module calls the Gemini HTTP API,
// which needs process.env for the API key (only available in Node actions).
//
// Called from:
//   - Phase 4 ingestion (embed each new closet after creation)
//   - Phase 8 backfill cron (embed closets with status pending or failed)
//
// Architecture note (Tier 1 fix from ultrathink):
//   The Gemini API call lives in lib/gemini.ts so that search.ts can call
//   it directly without action-to-action calls (which Convex forbids).

import { action } from "../_generated/server.js";
import { api, internal } from "../_generated/api.js";
import { v } from "convex/values";
import {
  embedBatchTexts,
  embedOne,
  GEMINI_DIMENSIONS,
  GEMINI_MODEL,
} from "../lib/gemini.js";

// ─── Single embedding (for search queries) ──────────────────────

export const embedQuery = action({
  args: { text: v.string() },
  handler: async (_ctx, { text }): Promise<number[]> => {
    return embedOne(text, "RETRIEVAL_QUERY");
  },
});

// ─── Single document embedding ──────────────────────────────────

export const embedDocument = action({
  args: { text: v.string() },
  handler: async (_ctx, { text }): Promise<number[]> => {
    return embedOne(text, "RETRIEVAL_DOCUMENT");
  },
});

// ─── Batch embedding (for backfill) ─────────────────────────────

export const embedBatch = action({
  args: { texts: v.array(v.string()) },
  handler: async (_ctx, { texts }): Promise<number[][]> => {
    const { embeddings } = await embedBatchTexts(texts);
    return embeddings;
  },
});

// ─── Embed + store a single closet ──────────────────────────────

export const embedAndStoreCloset = action({
  args: {
    closetId: v.id("closets"),
    palaceId: v.id("palaces"),
    content: v.string(),
  },
  handler: async (ctx, { closetId, palaceId, content }) => {
    try {
      const embedding = await embedOne(content, "RETRIEVAL_DOCUMENT");

      await ctx.runMutation(api.palace.mutations.storeEmbedding, {
        closetId,
        palaceId,
        embedding,
        model: GEMINI_MODEL,
        modelVersion: "001",
      });

      return { status: "ok" as const, closetId };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.palace.mutations.setEmbeddingStatus, {
        closetId,
        status: "failed",
      });
      return { status: "failed" as const, closetId, error: msg };
    }
  },
});

// ─── Backfill: embed pending AND failed closets ─────────────────

export const backfillEmbeddings = action({
  args: {
    palaceId: v.id("palaces"),
    limit: v.optional(v.number()),
    includeRetries: v.optional(v.boolean()),
  },
  handler: async (ctx, { palaceId, limit, includeRetries }) => {
    const batchLimit = limit ?? 50;

    const pending: Array<{ _id: string; content: string }> =
      await ctx.runQuery(
        internal.palace.queries.closetsPendingEmbedding,
        { palaceId, limit: batchLimit },
      );

    let retries: Array<{ _id: string; content: string }> = [];
    if (includeRetries) {
      retries = await ctx.runQuery(
        internal.palace.queries.closetsFailedEmbedding,
        { palaceId, limit: Math.max(0, batchLimit - pending.length) },
      );
    }

    const all = [...pending, ...retries];
    if (all.length === 0) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    const texts = all.map((c) => c.content);
    let embeddings: number[][];
    try {
      const result = await embedBatchTexts(texts);
      embeddings = result.embeddings;
    } catch (e) {
      for (const c of all) {
        await ctx.runMutation(internal.palace.mutations.setEmbeddingStatus, {
          closetId: c._id as any,
          status: "failed",
        });
      }
      return {
        processed: all.length,
        succeeded: 0,
        failed: all.length,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < all.length; i++) {
      const closet = all[i]!;
      const embedding = embeddings[i];
      if (!embedding || embedding.length !== GEMINI_DIMENSIONS) {
        await ctx.runMutation(internal.palace.mutations.setEmbeddingStatus, {
          closetId: closet._id as any,
          status: "failed",
        });
        failed++;
        continue;
      }

      try {
        await ctx.runMutation(api.palace.mutations.storeEmbedding, {
          closetId: closet._id as any,
          palaceId,
          embedding,
          model: GEMINI_MODEL,
          modelVersion: "001",
        });
        succeeded++;
      } catch {
        await ctx.runMutation(internal.palace.mutations.setEmbeddingStatus, {
          closetId: closet._id as any,
          status: "failed",
        });
        failed++;
      }
    }

    return { processed: all.length, succeeded, failed };
  },
});
