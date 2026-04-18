// Monitoring queries — palace health and performance metrics.
//
// All queries handle empty data gracefully (fresh deployment = zeros, not errors).

import { query } from "../_generated/server.js";
import { v } from "convex/values";

// ─── Search latency stats ───────────────────────────────────────

export const searchLatencyStats = query({
  args: {
    palaceId: v.id("palaces"),
    lastHours: v.optional(v.number()),
  },
  handler: async (ctx, { palaceId, lastHours }) => {
    const cutoff = Date.now() - (lastHours ?? 24) * 60 * 60 * 1000;

    const events = await ctx.db
      .query("audit_events")
      .withIndex("by_palace_time", (q) => q.eq("palaceId", palaceId))
      .order("desc")
      .collect();

    const searches = events.filter(
      (e) =>
        e.op === "recall" &&
        e.status === "ok" &&
        e.timestamp > cutoff &&
        e.latencyMs > 0,
    );

    if (searches.length === 0) {
      return { count: 0, p50: 0, p95: 0, p99: 0, avg: 0 };
    }

    const latencies = searches.map((e) => e.latencyMs).sort((a, b) => a - b);

    return {
      count: latencies.length,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      avg: Math.round(latencies.reduce((s, l) => s + l, 0) / latencies.length),
    };
  },
});

// ─── Error rate ─────────────────────────────────────────────────

export const errorRate = query({
  args: {
    palaceId: v.id("palaces"),
    lastHours: v.optional(v.number()),
  },
  handler: async (ctx, { palaceId, lastHours }) => {
    const cutoff = Date.now() - (lastHours ?? 24) * 60 * 60 * 1000;

    const events = await ctx.db
      .query("audit_events")
      .withIndex("by_palace_time", (q) => q.eq("palaceId", palaceId))
      .order("desc")
      .collect();

    const recent = events.filter((e) => e.timestamp > cutoff);
    if (recent.length === 0) {
      return { total: 0, ok: 0, errors: 0, denied: 0, errorRate: 0 };
    }

    const ok = recent.filter((e) => e.status === "ok" || e.status === "noop").length;
    const errors = recent.filter((e) => e.status === "error").length;
    const denied = recent.filter((e) => e.status === "denied").length;

    return {
      total: recent.length,
      ok,
      errors,
      denied,
      errorRate: recent.length > 0 ? +(errors / recent.length).toFixed(4) : 0,
    };
  },
});

// ─── Pipeline health ────────────────────────────────────────────

export const pipelineHealth = query({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    const closets = await ctx.db
      .query("closets")
      .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
      .collect();

    const visible = closets.filter(
      (c) => !c.retracted && c.supersededBy === undefined,
    );

    const embeddingPending = visible.filter((c) => c.embeddingStatus === "pending").length;
    const embeddingFailed = visible.filter((c) => c.embeddingStatus === "failed").length;
    const embeddingGenerated = visible.filter((c) => c.embeddingStatus === "generated").length;

    const graphitiPending = visible.filter((c) => c.graphitiStatus === "pending").length;
    const graphitiFailed = visible.filter((c) => c.graphitiStatus === "failed").length;
    const graphitiIngested = visible.filter((c) => c.graphitiStatus === "ingested").length;
    const graphitiSkipped = visible.filter((c) => c.graphitiStatus === "skipped").length;

    const quarantined = visible.filter((c) => c.needsReview).length;
    const decayed = closets.filter((c) => c.decayed).length;

    return {
      total: visible.length,
      embedding: {
        pending: embeddingPending,
        failed: embeddingFailed,
        generated: embeddingGenerated,
        rate: visible.length > 0
          ? +((embeddingGenerated / visible.length) * 100).toFixed(1)
          : 0,
      },
      graphiti: {
        pending: graphitiPending,
        failed: graphitiFailed,
        ingested: graphitiIngested,
        skipped: graphitiSkipped,
      },
      quarantined,
      decayed,
    };
  },
});

// ─── Ingestion activity ─────────────────────────────────────────

export const ingestionActivity = query({
  args: {
    palaceId: v.id("palaces"),
    lastHours: v.optional(v.number()),
  },
  handler: async (ctx, { palaceId, lastHours }) => {
    const cutoff = Date.now() - (lastHours ?? 24) * 60 * 60 * 1000;

    const logs = await ctx.db
      .query("ingestion_log")
      .withIndex("by_palace_time", (q) => q.eq("palaceId", palaceId))
      .order("desc")
      .collect();

    const recent = logs.filter((l) => l.timestamp > cutoff);

    const extracted = recent.filter((l) => l.status === "extracted");
    const failed = recent.filter((l) => l.status === "failed");
    const totalClosets = extracted.reduce((s, l) => s + l.closetsCreated, 0);
    const totalDrawers = extracted.reduce((s, l) => s + l.drawersCreated, 0);
    const totalTokens = extracted.reduce((s, l) => s + (l.tokensUsed ?? 0), 0);

    return {
      total: recent.length,
      extracted: extracted.length,
      failed: failed.length,
      closetsCreated: totalClosets,
      drawersCreated: totalDrawers,
      tokensUsed: totalTokens,
      successRate:
        recent.length > 0
          ? +((extracted.length / recent.length) * 100).toFixed(1)
          : 0,
    };
  },
});

// ─── Combined dashboard ─────────────────────────────────────────

export const dashboard = query({
  args: { palaceId: v.id("palaces") },
  handler: async (ctx, { palaceId }) => {
    const palace = await ctx.db.get(palaceId);
    if (!palace) return null;

    return {
      palace: {
        name: palace.name,
        status: palace.status,
        clientId: palace.clientId,
      },
      // Note: for the full dashboard, call searchLatencyStats, errorRate,
      // pipelineHealth, and ingestionActivity separately. This query just
      // confirms the palace exists and returns its basic info.
      // Full aggregation would exceed query time limits on large palaces.
    };
  },
});

// ─── Helper ─────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}
