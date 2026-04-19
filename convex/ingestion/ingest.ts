"use node";
// Exchange ingestion orchestrator.
//
// Takes a single Q+A exchange from a Claude conversation and:
//   1. Calls Gemini for extraction (primary router + extractor)
//   2. On extraction failure → falls back to keyword routing → _quarantine
//   3. For each extraction item:
//      a. getOrCreateRoom
//      b. createCloset (with full provenance)
//      c. createDrawer for each atomic fact
//      d. Embed extracted content+facts (not raw text — Tier 1 fix)
//      e. Mirror to Graphiti bridge (if available)
//   4. Logs to ingestion_log
//
// Called from scripts/batchIngest.ts (local) or a Convex scheduled function.

import { action } from "../_generated/server.js";
import { api, internal } from "../_generated/api.js";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel.js";
import { scanForPII } from "./pii.js";
import { routeToWing, routeToRoom, classifyCategory, scoreConfidence } from "./route.js";
import { embedOne, EMBEDDING_MODEL } from "../lib/qwen.js";
import { callGeminiLlm } from "../lib/geminiLlm.js";
import { CATEGORIES } from "../lib/enums.js";
import { EXTRACTION_SYSTEM_PROMPT, parseExtractionResponse, type ExtractionItem } from "./extract.js";

// ─── Types ──────────────────────────────────────────────────────

interface IngestExchangeArgs {
  palaceId: string;
  human: string;
  assistant: string;
  timestamp: number;
  conversationId: string;
  conversationTitle: string;
  exchangeIndex: number;
}

interface IngestResult {
  status: "ok" | "partial" | "quarantined" | "error";
  closetsCreated: number;
  drawersCreated: number;
  tokensUsed: number;
  errors: string[];
}

// ─── Main ingestion action ──────────────────────────────────────

export const ingestExchange = action({
  args: {
    palaceId: v.id("palaces"),
    human: v.string(),
    assistant: v.string(),
    timestamp: v.number(),
    conversationId: v.string(),
    conversationTitle: v.string(),
    exchangeIndex: v.number(),
  },
  handler: async (ctx, args): Promise<IngestResult> => {
    const t0 = Date.now();
    const errors: string[] = [];
    let closetsCreated = 0;
    let drawersCreated = 0;
    let tokensUsed = 0;

    const exchangeText = `Human: ${args.human}\n\nAssistant: ${args.assistant}`;
    const sourceExternalId = `${args.conversationId}:${args.exchangeIndex}`;

    // ── 1. PII scan ─────────────────────────────────────────
    const piiTags = scanForPII(exchangeText);

    // ── 2. Try Gemini extraction (primary) ──────────────────
    //    Direct call to Gemini — NOT via ctx.runAction (which would crash:
    //    Convex forbids action-to-action calls).
    let extractions: ExtractionItem[] = [];
    let extractionFailed = false;

    try {
      const contextPrefix = args.conversationTitle
        ? `Conversation: "${args.conversationTitle}" (exchange ${args.exchangeIndex})\n\n`
        : "";

      const response = await callGeminiLlm({
        systemPrompt: EXTRACTION_SYSTEM_PROMPT,
        userPrompt: contextPrefix + exchangeText,
        jsonMode: true,
        maxOutputTokens: 4096,
        temperature: 0.1,
      });

      extractions = parseExtractionResponse(response.text);
      tokensUsed = response.totalTokens;
    } catch (e) {
      extractionFailed = true;
      errors.push(`extraction_failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // ── 3. Fallback: keyword routing → quarantine ───────────
    if (extractionFailed || extractions.length === 0) {
      const wing = extractionFailed ? "_quarantine" : routeToWing(exchangeText);
      const room = extractionFailed ? "unclassified" : routeToRoom(exchangeText, wing);
      const category = extractionFailed ? "conversation" : classifyCategory(exchangeText);
      const confidence = extractionFailed ? 0.3 : scoreConfidence(args.human, args.assistant);

      extractions = [{
        wing,
        room,
        category,
        content: exchangeText.slice(0, 50_000), // cap raw content
        title: args.conversationTitle.slice(0, 80) || "Unprocessed exchange",
        facts: [],
        entities: [],
        confidence,
      }];
    }

    // ── 4. Process each extraction item ─────────────────────
    for (const item of extractions) {
      try {
        // 4a. Resolve room (creates if needed).
        const roomId: Id<"rooms"> = await ctx.runMutation(
          api.palace.mutations.getOrCreateRoom,
          {
            palaceId: args.palaceId,
            wingName: item.wing,
            roomName: item.room,
            summary: item.title,
          },
        );

        // 4b. Create closet.
        const closetResult = await ctx.runMutation(
          api.palace.mutations.createCloset,
          {
            roomId,
            palaceId: args.palaceId,
            content: item.content,
            title: item.title || undefined,
            category: item.category,
            sourceType: "claude_chat",
            sourceRef: args.conversationId,
            sourceAdapter: "claude-export",
            sourceExternalId,
            authorType: "adapter",
            authorId: "claude-export",
            confidence: item.confidence,
            piiTags,
            needsReview: item.wing === "_quarantine" || extractionFailed,
          },
        );

        if (closetResult.status === "noop") continue; // already ingested
        closetsCreated++;

        const closetId = closetResult.closetId;

        // 4c. Create drawers for atomic facts.
        for (const fact of item.facts) {
          try {
            await ctx.runMutation(api.palace.mutations.createDrawer, {
              closetId,
              palaceId: args.palaceId,
              fact,
              validFrom: args.timestamp,
              confidence: item.confidence,
            });
            drawersCreated++;
          } catch (e) {
            errors.push(`drawer_failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // 4d. Embed with enriched context: wing/room + title + content + facts.
        //     Prepending wing/room gives the embedding semantic grounding so
        //     queries like "What is NeuralEDGE?" match the right closets.
        const textToEmbed = [
          `[${item.wing}/${item.room}]`,
          item.title,
          `Category: ${item.category}`,
          item.content,
          ...item.facts,
        ].filter(Boolean).join("\n");

        try {
          const embedding = await embedOne(textToEmbed);
          await ctx.runMutation(api.palace.mutations.storeEmbedding, {
            closetId,
            palaceId: args.palaceId,
            embedding,
            model: EMBEDDING_MODEL,
            modelVersion: "001",
          });
        } catch (e) {
          errors.push(`embed_failed: ${e instanceof Error ? e.message : String(e)}`);
          await ctx.runMutation(internal.palace.mutations.setEmbeddingStatus, {
            closetId,
            status: "failed",
          });
        }

        // 4e. Graphiti bridge ingest (fire-and-forget, non-blocking).
        const bridgeUrl = process.env.GRAPHITI_BRIDGE_URL;
        const bridgeKey = process.env.PALACE_BRIDGE_API_KEY;
        if (bridgeUrl && item.entities.length > 0) {
          try {
            const resp = await fetch(`${bridgeUrl}/ingest`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(bridgeKey ? { "X-Palace-Key": bridgeKey } : {}),
              },
              body: JSON.stringify({
                palace_id: args.palaceId,
                content: item.content,
                episode_name: `claude_${args.conversationId}_${args.exchangeIndex}`,
                source_description: "claude_chat_export",
                timestamp: new Date(args.timestamp).toISOString(),
                metadata: {
                  closet_id: closetId,
                  wing: item.wing,
                  room: item.room,
                  category: item.category,
                },
              }),
              signal: AbortSignal.timeout(15_000), // 15s timeout
            });

            if (resp.ok) {
              await ctx.runMutation(internal.palace.mutations.setGraphitiStatus, {
                closetId,
                status: "ingested",
              });
            } else {
              await ctx.runMutation(internal.palace.mutations.setGraphitiStatus, {
                closetId,
                status: "failed",
              });
            }
          } catch {
            await ctx.runMutation(internal.palace.mutations.setGraphitiStatus, {
              closetId,
              status: "failed",
            });
          }
        } else {
          // No bridge URL or no entities → skip graph ingestion.
          await ctx.runMutation(internal.palace.mutations.setGraphitiStatus, {
            closetId,
            status: "skipped",
          });
        }

      } catch (e) {
        errors.push(`item_failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // ── 5. Log ingestion ────────────────────────────────────
    const durationMs = Date.now() - t0;
    try {
      await ctx.runMutation(api.ingestion.mutations.logIngestion, {
        palaceId: args.palaceId,
        sourceType: "claude_chat",
        sourceRef: sourceExternalId,
        status: closetsCreated > 0 ? "extracted" : "failed",
        closetsCreated,
        drawersCreated,
        adapterName: "claude-export",
        durationMs,
        tokensUsed,
        error: errors.length > 0 ? errors.join("; ") : undefined,
      });
    } catch {
      // Audit logging must not break ingestion.
    }

    return {
      status: errors.length === 0
        ? "ok"
        : closetsCreated > 0
          ? "partial"
          : extractionFailed
            ? "quarantined"
            : "error",
      closetsCreated,
      drawersCreated,
      tokensUsed,
      errors,
    };
  },
});
