// Backfill — retry failed embeddings and graphiti ingestions.
//
// Processes in bounded batches (20 per tick) to stay within action time limits.

import { internalAction } from "../_generated/server.js";
import { api, internal } from "../_generated/api.js";
import type { Id } from "../_generated/dataModel.js";

const BATCH_SIZE = 20;

// ─── Embedding backfill (every 6h) ──────────────────────────────

export const backfillFailedEmbeddings = internalAction({
  args: {},
  handler: async (ctx) => {
    const palaceIds: Id<"palaces">[] = await ctx.runQuery(
      internal.maintenance.curator.listReadyPalaces,
      {},
    );

    let totalRetried = 0;
    let totalSucceeded = 0;

    for (const palaceId of palaceIds) {
      try {
        const result = await ctx.runAction(
          api.ingestion.embed.backfillEmbeddings,
          { palaceId, limit: BATCH_SIZE, includeRetries: true },
        );
        totalRetried += result.processed;
        totalSucceeded += result.succeeded;
      } catch (e) {
        console.error(`[backfill] embedding retry failed for palace ${palaceId}:`, e);
      }
    }

    if (totalRetried > 0) {
      console.log(
        `[backfill] embeddings: retried ${totalRetried}, succeeded ${totalSucceeded}`,
      );
    }
  },
});

// ─── Graphiti backfill (every 6h) ───────────────────────────────

export const backfillFailedGraphiti = internalAction({
  args: {},
  handler: async (ctx) => {
    const palaceIds: Id<"palaces">[] = await ctx.runQuery(
      internal.maintenance.curator.listReadyPalaces,
      {},
    );

    const bridgeUrl = process.env.GRAPHITI_BRIDGE_URL;
    const bridgeKey = process.env.PALACE_BRIDGE_API_KEY;

    if (!bridgeUrl) {
      // Bridge not configured — skip silently.
      return;
    }

    // Check bridge health before attempting batch.
    try {
      const healthResp = await fetch(`${bridgeUrl}/health`);
      if (!healthResp.ok) {
        console.log("[backfill] graphiti bridge unhealthy, skipping");
        return;
      }
    } catch {
      console.log("[backfill] graphiti bridge unreachable, skipping");
      return;
    }

    let totalRetried = 0;
    let totalSucceeded = 0;

    for (const palaceId of palaceIds) {
      const pending: Array<{
        _id: string;
        content: string;
        wingId: string;
        roomId: string;
        category: string;
      }> = await ctx.runQuery(
        internal.palace.queries.closetsPendingGraphiti,
        { palaceId, limit: BATCH_SIZE },
      );

      // Also get failed closets.
      const failed: Array<{
        _id: string;
        content: string;
        wingId: string;
        roomId: string;
        category: string;
      }> = await ctx.runQuery(
        internal.palace.queries.closetsFailedGraphiti,
        { palaceId, limit: BATCH_SIZE },
      );

      const all = [...pending, ...failed];

      for (const closet of all) {
        totalRetried++;
        try {
          const resp = await fetch(`${bridgeUrl}/ingest`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(bridgeKey ? { "X-Palace-Key": bridgeKey } : {}),
            },
            body: JSON.stringify({
              palace_id: palaceId,
              content: closet.content,
              episode_name: `backfill_${closet._id}`,
              source_description: "backfill",
              timestamp: new Date().toISOString(),
              metadata: {
                closet_id: closet._id,
                category: closet.category,
              },
            }),
            signal: AbortSignal.timeout(15_000),
          });

          if (resp.ok) {
            await ctx.runMutation(
              internal.palace.mutations.setGraphitiStatus,
              { closetId: closet._id as Id<"closets">, status: "ingested" },
            );
            totalSucceeded++;
          } else {
            await ctx.runMutation(
              internal.palace.mutations.setGraphitiStatus,
              { closetId: closet._id as Id<"closets">, status: "failed" },
            );
          }
        } catch {
          // Leave status as-is; will retry next tick.
        }
      }
    }

    if (totalRetried > 0) {
      console.log(
        `[backfill] graphiti: retried ${totalRetried}, succeeded ${totalSucceeded}`,
      );
    }
  },
});
