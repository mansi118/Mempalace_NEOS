"use node";
// Context assembler — the function NEops actually call.
//
// Produces a formatted text block for system prompt injection:
//   1. L0 identity briefing (always, ~50 tokens)
//   2. L1 wing index (always, ~120 tokens)
//   3. L2 search results (query-dependent, token-budgeted)
//
// Token budgeting: greedily adds results until maxTokens is hit.
// Most relevant results (highest score) are included first.
//
// Tier 1 fix: calls coreSearch directly (not via ctx.runAction).
// Tier 2 fix: applies NEop scope if scope binding exists.

import { action } from "../_generated/server.js";
import { api, internal } from "../_generated/api.js";
import { v } from "convex/values";
import { coreSearch, type SearchResult, type SearchResponse } from "./search.js";

const DEFAULT_MAX_TOKENS = 2000;
const CHARS_PER_TOKEN = 4; // rough estimate

interface AssembleResult {
  context: string;
  tokenEstimate: number;
  searchConfidence: "high" | "medium" | "low";
  resultCount: number;
  queryTimeMs: number;
  neopScope: string | null;
}

export const assembleContext = action({
  args: {
    palaceId: v.id("palaces"),
    query: v.string(),
    neopId: v.optional(v.string()),
    maxTokens: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<AssembleResult> => {
    const maxTokens = args.maxTokens ?? DEFAULT_MAX_TOKENS;
    const maxChars = maxTokens * CHARS_PER_TOKEN;

    // 1. Get L0 + L1.
    const [l0, l1] = await Promise.all([
      ctx.runQuery(api.serving.l0l1.getL0, { palaceId: args.palaceId }),
      ctx.runQuery(api.serving.l0l1.getL1, { palaceId: args.palaceId }),
    ]);

    const l0Block = l0 ?? "Palace identity not generated yet.";
    const l1Block = l1 ?? "Wing index not generated yet.";

    // Calculate remaining budget for L2.
    const headerChars = l0Block.length + l1Block.length + 60; // padding for labels
    const remainingChars = Math.max(0, maxChars - headerChars);
    const estimatedResultsLimit = Math.max(
      1,
      Math.floor(remainingChars / 400), // ~100 tokens per result
    );

    // 2. Resolve NEop scope (Tier 2 fix).
    let wingFilter: string | undefined;
    if (args.neopId) {
      const perms: { scopeWing?: string; scopeRoom?: string } | null =
        await ctx.runQuery(api.access.queries.getNeopPermissions, {
          palaceId: args.palaceId,
          neopId: args.neopId,
        });
      if (perms?.scopeWing) {
        wingFilter = perms.scopeWing;
      }
    }

    // 3. Run L2 search (direct call — no action-to-action).
    let searchResponse: SearchResponse;
    const trimmed = args.query.trim();
    if (!trimmed) {
      searchResponse = {
        results: [],
        confidence: "low",
        reason: "empty_query",
        tokenEstimate: 0,
        queryTimeMs: 0,
      };
    } else {
      searchResponse = await coreSearch(ctx, {
        palaceId: args.palaceId,
        query: trimmed,
        wingFilter,
        limit: estimatedResultsLimit,
        similarityFloor: 0.5,
      });
    }

    // 4. Format context block with token budgeting.
    const blocks: string[] = [];
    let usedChars = 0;

    // L0.
    const l0Formatted = `[IDENTITY] ${l0Block}`;
    blocks.push(l0Formatted);
    usedChars += l0Formatted.length;

    // L1.
    const l1Formatted = `[WINGS] ${l1Block}`;
    blocks.push(l1Formatted);
    usedChars += l1Formatted.length;

    // L2 results (greedy — add one by one until budget hit).
    if (searchResponse.results.length > 0) {
      const confidenceLabel =
        searchResponse.confidence === "high"
          ? "high confidence"
          : searchResponse.confidence === "medium"
            ? "moderate confidence"
            : "low confidence";

      blocks.push(
        `\n[MEMORY — ${searchResponse.results.length} results, ${confidenceLabel}]`,
      );
      usedChars += 60;

      for (let i = 0; i < searchResponse.results.length; i++) {
        const r = searchResponse.results[i]!;
        const formatted = formatResult(r, i + 1);
        if (usedChars + formatted.length > maxChars) break;
        blocks.push(formatted);
        usedChars += formatted.length;
      }
    } else if (trimmed) {
      blocks.push(
        `\n[MEMORY — no relevant memories found for "${trimmed.slice(0, 60)}"]`,
      );
    }

    const contextBlock = blocks.join("\n");
    const tokenEstimate = Math.ceil(contextBlock.length / CHARS_PER_TOKEN);

    return {
      context: contextBlock,
      tokenEstimate,
      searchConfidence: searchResponse.confidence,
      resultCount: searchResponse.results.length,
      queryTimeMs: searchResponse.queryTimeMs,
      neopScope: wingFilter ?? null,
    };
  },
});

// ─── Result formatter ───────────────────────────────────────────

function formatResult(r: SearchResult, index: number): string {
  const title = r.title ?? r.content.slice(0, 60).replace(/\n/g, " ");
  const contentPreview = r.content.length > 300
    ? r.content.slice(0, 297) + "..."
    : r.content;
  const score = r.score.toFixed(2);

  return [
    `${index}. ${title} (${r.category}, ${r.wingName}/${r.roomName}, ${score})`,
    `   ${contentPreview.replace(/\n/g, "\n   ")}`,
  ].join("\n");
}
