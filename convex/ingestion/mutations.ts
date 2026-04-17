// Ingestion log mutation. Phase 4 fills this with adapter activity.

import { mutation } from "../_generated/server.js";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";

export const logIngestion = mutation({
  args: {
    palaceId: v.id("palaces"),
    sourceType: v.string(),
    sourceRef: v.string(),
    status: v.string(),
    closetsCreated: v.number(),
    drawersCreated: v.number(),
    adapterName: v.string(),
    durationMs: v.optional(v.number()),
    tokensUsed: v.optional(v.number()),
    graphitiEpisodeId: v.optional(v.string()),
    error: v.optional(v.string()),
    watermarkCursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("ingestion_log", {
      palaceId: args.palaceId,
      sourceType: args.sourceType,
      sourceRef: args.sourceRef,
      status: args.status as Doc<"ingestion_log">["status"],
      closetsCreated: args.closetsCreated,
      drawersCreated: args.drawersCreated,
      adapterName: args.adapterName,
      timestamp: Date.now(),
      durationMs: args.durationMs,
      tokensUsed: args.tokensUsed,
      graphitiEpisodeId: args.graphitiEpisodeId,
      error: args.error,
      watermarkCursor: args.watermarkCursor,
    });
  },
});
