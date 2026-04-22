"use node";
// Entity extraction + FalkorDB graph ingestion.
//
// For each closet: extract entities/relations via Llama 4 Scout,
// then POST to the bridge's /graph/ingest endpoint for direct
// Cypher MERGE writes. No LLM runs on the bridge side.

import { action, internalAction } from "../_generated/server.js";
import { api, internal } from "../_generated/api.js";
import { v } from "convex/values";
import { extractEntities } from "../lib/entityExtractor.js";

interface ExtractResult {
  status: "ok" | "error" | "skipped";
  closetId: string;
  entities: number;
  relations: number;
  error?: string;
}

export const extractAndIngestCloset = action({
  args: { closetId: v.id("closets") },
  handler: async (ctx, { closetId }): Promise<ExtractResult> => {
    const closet = await ctx.runQuery(api.palace.queries.getCloset, { closetId });
    if (!closet) return { status: "error", closetId, entities: 0, relations: 0, error: "not_found" };

    const palace = await ctx.runQuery(api.palace.queries.getPalace, { palaceId: closet.palaceId });
    if (!palace) return { status: "error", closetId, entities: 0, relations: 0, error: "palace_not_found" };

    const wing = await ctx.runQuery(api.palace.queries.getWing, { wingId: closet.wingId });
    const room = await ctx.runQuery(api.palace.queries.getRoom, { roomId: closet.roomId });

    const text = closet.title ? `${closet.title}\n\n${closet.content}` : closet.content;
    if (text.trim().length < 40) {
      return { status: "skipped", closetId, entities: 0, relations: 0, error: "too_short" };
    }

    let extraction;
    try {
      extraction = await extractEntities(text);
    } catch (e) {
      return { status: "error", closetId, entities: 0, relations: 0, error: (e as Error).message.slice(0, 200) };
    }

    if (extraction.entities.length === 0) {
      await ctx.runMutation(internal.palace.mutations.setEntityExtractionResult, {
        closetId,
        extracted: true,
        entitiesCount: 0,
        relationsCount: 0,
      });
      return { status: "ok", closetId, entities: 0, relations: 0 };
    }

    const bridgeUrl = process.env.GRAPHITI_BRIDGE_URL;
    const bridgeKey = process.env.PALACE_BRIDGE_API_KEY;
    if (!bridgeUrl) {
      return { status: "error", closetId, entities: 0, relations: 0, error: "bridge_url_unset" };
    }

    const resp = await fetch(`${bridgeUrl}/graph/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bridgeKey ? { "X-Palace-Key": bridgeKey } : {}),
      },
      body: JSON.stringify({
        palace_id: palace.clientId,
        closet_id: closetId,
        wing: wing?.name ?? "",
        room: room?.name ?? "",
        title: closet.title ?? "",
        entities: extraction.entities.map((e) => ({ name: e.name, type: e.type, aliases: e.aliases })),
        relations: extraction.relations.map((r) => ({
          from_entity: r.from,
          to_entity: r.to,
          relation: r.relation,
        })),
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      await ctx.runMutation(internal.palace.mutations.setEntityExtractionResult, {
        closetId,
        extracted: false,
        entitiesCount: 0,
        relationsCount: 0,
      });
      return {
        status: "error",
        closetId,
        entities: 0,
        relations: 0,
        error: `bridge_${resp.status}: ${txt.slice(0, 100)}`,
      };
    }

    await ctx.runMutation(internal.palace.mutations.setEntityExtractionResult, {
      closetId,
      extracted: true,
      entitiesCount: extraction.entities.length,
      relationsCount: extraction.relations.length,
    });

    return {
      status: "ok",
      closetId,
      entities: extraction.entities.length,
      relations: extraction.relations.length,
    };
  },
});

export const extractBatch = internalAction({
  args: { closetIds: v.array(v.id("closets")) },
  handler: async (
    ctx,
    { closetIds },
  ): Promise<{ processed: number; entities: number; relations: number; errors: number }> => {
    let entities = 0;
    let relations = 0;
    let errors = 0;
    for (const closetId of closetIds) {
      try {
        const r: ExtractResult = await ctx.runAction(
          api.ingestion.extractEntities.extractAndIngestCloset,
          { closetId },
        );
        if (r.status === "ok") {
          entities += r.entities;
          relations += r.relations;
        } else if (r.status === "error") {
          errors += 1;
        }
      } catch {
        errors += 1;
      }
    }
    return { processed: closetIds.length, entities, relations, errors };
  },
});
