// Voyage 4 embedding generation.
//
// Two modes:
//   - document embedding: for closet content (stored in closet_embeddings)
//   - query embedding: for search queries (asymmetric search — Voyage
//     optimizes differently for docs vs queries)
//
// Called from:
//   - Phase 4 ingestion (embed each new closet)
//   - Phase 5 serving (embed search query at request time)
//   - Phase 3 backfill (embed closets that have embeddingStatus=pending/failed)
//
// Rate limiting: Voyage allows 300 RPM on the standard plan. Batch endpoint
// accepts up to 128 texts per call. We use batching for backfill and single
// calls for real-time.

import { action, internalAction } from "../_generated/server.js";
import { api, internal } from "../_generated/api.js";
import { v } from "convex/values";

const VOYAGE_MODEL = "voyage-3-large";
const VOYAGE_DIMENSIONS = 1024;
const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MAX_BATCH = 128;

// ─── Single embedding (for search queries) ──────────────────────

export const embedQuery = action({
  args: { text: v.string() },
  handler: async (_ctx, { text }): Promise<number[]> => {
    return await callVoyage([text], "query").then((r) => r[0]!);
  },
});

// ─── Single document embedding ──────────────────────────────────

export const embedDocument = action({
  args: { text: v.string() },
  handler: async (_ctx, { text }): Promise<number[]> => {
    return await callVoyage([text], "document").then((r) => r[0]!);
  },
});

// ─── Batch embedding (for backfill) ─────────────────────────────

export const embedBatch = action({
  args: { texts: v.array(v.string()) },
  handler: async (_ctx, { texts }): Promise<number[][]> => {
    if (texts.length === 0) return [];
    // Voyage API accepts up to 128 per call. Chunk if needed.
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += VOYAGE_MAX_BATCH) {
      const chunk = texts.slice(i, i + VOYAGE_MAX_BATCH);
      const embeddings = await callVoyage(chunk, "document");
      results.push(...embeddings);
    }
    return results;
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
      const embedding = await callVoyage([content], "document").then(
        (r) => r[0]!,
      );

      await ctx.runMutation(api.palace.mutations.storeEmbedding, {
        closetId,
        palaceId,
        embedding,
        model: VOYAGE_MODEL,
        modelVersion: "2026-04",
      });

      return { status: "ok" as const, closetId };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Mark as failed so backfill cron can retry.
      await ctx.runMutation(internal.palace.mutations.setEmbeddingStatus, {
        closetId,
        status: "failed",
      });
      return { status: "failed" as const, closetId, error: msg };
    }
  },
});

// ─── Backfill: embed all pending closets ────────────────────────

export const backfillEmbeddings = action({
  args: {
    palaceId: v.id("palaces"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { palaceId, limit }) => {
    const batchLimit = limit ?? 50;

    // Query closets with pending embedding status.
    const pending: Array<{ _id: string; content: string }> = await ctx.runQuery(
      internal.palace.queries.closetsPendingEmbedding,
      { palaceId, limit: batchLimit },
    );

    if (pending.length === 0) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    // Batch embed all content.
    const texts = pending.map((c) => c.content);
    let embeddings: number[][];
    try {
      embeddings = await callVoyage(texts, "document");
    } catch (e) {
      // Batch failed entirely — mark all as failed.
      for (const c of pending) {
        await ctx.runMutation(internal.palace.mutations.setEmbeddingStatus, {
          closetId: c._id as any,
          status: "failed",
        });
      }
      return {
        processed: pending.length,
        succeeded: 0,
        failed: pending.length,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < pending.length; i++) {
      const closet = pending[i]!;
      const embedding = embeddings[i];
      if (!embedding || embedding.length !== VOYAGE_DIMENSIONS) {
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
          model: VOYAGE_MODEL,
          modelVersion: "2026-04",
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

    return { processed: pending.length, succeeded, failed };
  },
});

// ─── Voyage API caller ──────────────────────────────────────────

async function callVoyage(
  texts: string[],
  inputType: "document" | "query",
): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY not set in Convex environment");
  }

  const response = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: texts,
      input_type: inputType,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Voyage API error ${response.status}: ${body.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
    usage: { total_tokens: number };
  };

  const embeddings = data.data.map((d) => d.embedding);

  // Sanity check dimensions.
  for (let i = 0; i < embeddings.length; i++) {
    if (embeddings[i]!.length !== VOYAGE_DIMENSIONS) {
      throw new Error(
        `Expected ${VOYAGE_DIMENSIONS}-dim embedding, got ${embeddings[i]!.length} at index ${i}`,
      );
    }
  }

  return embeddings;
}
