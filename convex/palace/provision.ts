"use node";
// Palace provisioning — one-action new-client setup.
//
// Creates a complete palace from the wings.yaml template:
//   1. Palace document (status="provisioning")
//   2. 12 wings from template
//   3. 9 standard halls per wing
//   4. Rooms from template (with primary_hall assignment)
//   5. Default neop_permissions (from access_matrix.yaml template)
//   6. Register with Graphiti bridge (if available)
//   7. Generate L0 + L1 briefings
//   8. Mark palace "ready"
//
// Idempotent: if palace already exists for this clientId, returns it.

import { action } from "../_generated/server.js";
import { api, internal } from "../_generated/api.js";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel.js";
import { HALL_TYPES } from "../lib/enums.js";

// ─── Wing/room template (matches config/wings.yaml) ─────────────

interface RoomTemplate {
  primaryHall: string;
  description: string;
}

interface WingTemplate {
  description: string;
  sortOrder: number;
  rooms: Record<string, RoomTemplate>;
}

const WING_TEMPLATE: Record<string, WingTemplate> = {
  platform: {
    description: "NEOS platform, NEops, architecture, stack",
    sortOrder: 1,
    rooms: {
      stack: { primaryHall: "facts", description: "Tech stack registry" },
      architecture: { primaryHall: "facts", description: "System design, multi-agent topology" },
      "neop-catalog": { primaryHall: "facts", description: "Every NEop — name, purpose, status" },
      "api-contracts": { primaryHall: "facts", description: "Internal APIs, webhooks" },
      features: { primaryHall: "facts", description: "What exists, WIP, planned" },
      retired: { primaryHall: "lessons", description: "Killed components and why" },
      pricing: { primaryHall: "decisions", description: "Tier 1/2 model, NEop pricing" },
    },
  },
  clients: {
    description: "Active and historical client engagements",
    sortOrder: 2,
    rooms: {
      _shared: { primaryHall: "facts", description: "Cross-client patterns" },
      "zoo-media": { primaryHall: "conversations", description: "Active — ICD engagement" },
      "unborred-club": { primaryHall: "lessons", description: "Historical" },
    },
  },
  team: {
    description: "People-centric memory for the team",
    sortOrder: 3,
    rooms: {
      rahul: { primaryHall: "preferences", description: "Co-Founder/CTO" },
      mansi: { primaryHall: "preferences", description: "VP AI Research" },
      shivam: { primaryHall: "preferences", description: "Consultant" },
      naveen: { primaryHall: "preferences", description: "Consultant" },
      ankit: { primaryHall: "preferences", description: "Consultant" },
      org: { primaryHall: "facts", description: "Org chart, roles, skills" },
    },
  },
  gtm: {
    description: "Finding, convincing, and closing clients",
    sortOrder: 4,
    rooms: {
      pipeline: { primaryHall: "facts", description: "Active leads and stages" },
      icp: { primaryHall: "facts", description: "Ideal customer profiles" },
      positioning: { primaryHall: "decisions", description: "Digital AI OS framing" },
      outreach: { primaryHall: "lessons", description: "Cold email, LinkedIn" },
      pitch: { primaryHall: "facts", description: "Decks, demo scripts" },
      competitive: { primaryHall: "facts", description: "Competitor intel" },
    },
  },
  legal: {
    description: "Entity, contracts, compliance, finance",
    sortOrder: 5,
    rooms: {
      entities: { primaryHall: "facts", description: "Synlex Technologies PVT. LTD." },
      contracts: { primaryHall: "facts", description: "NDA/SOW/MSA, templates" },
      compliance: { primaryHall: "tasks", description: "Filings, obligations" },
      finance: { primaryHall: "facts", description: "MRR/ARR, invoices, runway" },
      ip: { primaryHall: "decisions", description: "Patent vs trade secret" },
    },
  },
  rd: {
    description: "Research, experimentation, meta-memory",
    sortOrder: 6,
    rooms: {
      "memory-systems": { primaryHall: "facts", description: "Graphiti, Letta, Memoria" },
      "agent-frameworks": { primaryHall: "decisions", description: "OpenClaw, Strands" },
      experiments: { primaryHall: "lessons", description: "What's been tried" },
      papers: { primaryHall: "facts", description: "Research library" },
      tools: { primaryHall: "facts", description: "Apify, Firecrawl, Neo4j" },
    },
  },
  marketplace: {
    description: "NeP marketplace, ecosystem economics",
    sortOrder: 7,
    rooms: {
      neps: { primaryHall: "facts", description: "Published NePs, versions" },
      economics: { primaryHall: "decisions", description: "Pricing tiers, revenue share" },
      quality: { primaryHall: "procedures", description: "Design standards" },
    },
  },
  infra: {
    description: "Servers, deployments, monitoring",
    sortOrder: 8,
    rooms: {
      servers: { primaryHall: "facts", description: "AWS EC2, domains, IPs" },
      services: { primaryHall: "facts", description: "Service map, health endpoints" },
      incidents: { primaryHall: "lessons", description: "Active + historical incidents" },
      runbooks: { primaryHall: "procedures", description: "Deployment, rollback" },
      "linux-admin": { primaryHall: "procedures", description: "Ubuntu operations" },
    },
  },
  partners: {
    description: "Vendors and integration partners",
    sortOrder: 9,
    rooms: {
      vendors: { primaryHall: "facts", description: "Fireflies, AWS, Convex, Anthropic" },
      integrations: { primaryHall: "facts", description: "Integration partners" },
    },
  },
  brand: {
    description: "Content, assets, voice, case studies",
    sortOrder: 10,
    rooms: {
      voice: { primaryHall: "preferences", description: "Brand voice, style guides" },
      assets: { primaryHall: "facts", description: "Logos, decks, templates" },
      "case-studies": { primaryHall: "facts", description: "Proof points" },
    },
  },
  audit: {
    description: "System events, short-TTL, immutable",
    sortOrder: 11,
    rooms: {
      _events: { primaryHall: "signals", description: "Every recall and remember" },
    },
  },
  _quarantine: {
    description: "Dead-letter queue for unclassifiable content",
    sortOrder: 12,
    rooms: {
      unclassified: { primaryHall: "facts", description: "needs_review=true; human must triage" },
    },
  },
};

// ─── Default NEop permissions template ──────────────────────────

const DEFAULT_NEOP_PERMS: Array<{
  neopId: string;
  runtimeOps: string[];
  contentAccess: Record<string, { read: string | string[]; write: string | string[] }>;
}> = [
  {
    neopId: "_admin",
    runtimeOps: ["recall", "remember", "promote", "erase", "audit"],
    contentAccess: {
      platform: { read: "*", write: "*" },
      clients: { read: "*", write: "*" },
      team: { read: "*", write: "*" },
      gtm: { read: "*", write: "*" },
      legal: { read: "*", write: "*" },
      rd: { read: "*", write: "*" },
      marketplace: { read: "*", write: "*" },
      infra: { read: "*", write: "*" },
      partners: { read: "*", write: "*" },
      brand: { read: "*", write: "*" },
      audit: { read: "*", write: [] },
      _quarantine: { read: "*", write: "*" },
    },
  },
];

// ─── Provision action ───────────────────────────────────────────

export const provisionPalace = action({
  args: {
    clientId: v.string(),
    name: v.string(),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const createdBy = args.createdBy ?? "system";

    // 1. Create palace (idempotent).
    const palaceId: Id<"palaces"> = await ctx.runMutation(
      api.palace.mutations.createPalace,
      {
        name: args.name,
        clientId: args.clientId,
        falkordbGraph: `palace_${args.clientId}`,
        createdBy,
      },
    );

    // Check if already ready (re-run of provision).
    const palace = await ctx.runQuery(api.palace.queries.getPalace, { palaceId });
    if (palace?.status === "ready") {
      return { status: "already_provisioned", palaceId };
    }

    // 2. Create wings.
    const wingIds: Record<string, Id<"wings">> = {};
    for (const [name, tmpl] of Object.entries(WING_TEMPLATE)) {
      wingIds[name] = await ctx.runMutation(api.palace.mutations.createWing, {
        palaceId,
        name,
        description: tmpl.description,
        sortOrder: tmpl.sortOrder,
      });
    }

    // 3. Create halls (all standard types per wing).
    const hallIds: Record<string, Id<"halls">> = {};
    for (const [wingName, wingId] of Object.entries(wingIds)) {
      for (const hallType of HALL_TYPES) {
        const hallId = await ctx.runMutation(api.palace.mutations.createHall, {
          wingId,
          palaceId,
          type: hallType,
        });
        hallIds[`${wingName}/${hallType}`] = hallId;
      }
    }

    // 4. Create rooms.
    let roomCount = 0;
    for (const [wingName, tmpl] of Object.entries(WING_TEMPLATE)) {
      const wingId = wingIds[wingName]!;
      for (const [roomName, room] of Object.entries(tmpl.rooms)) {
        const hallId = hallIds[`${wingName}/${room.primaryHall}`]!;
        await ctx.runMutation(api.palace.mutations.createRoom, {
          hallId,
          wingId,
          palaceId,
          name: roomName,
          summary: room.description,
          tags: [],
        });
        roomCount++;
      }
    }

    // 5. Seed default permissions.
    for (const perm of DEFAULT_NEOP_PERMS) {
      await ctx.runMutation(api.palace.mutations.upsertNeopPermissions, {
        palaceId,
        neopId: perm.neopId,
        runtimeOps: perm.runtimeOps,
        contentAccess: JSON.stringify(perm.contentAccess),
      });
    }

    // 6. Register with Graphiti bridge (best-effort).
    const bridgeUrl = process.env.GRAPHITI_BRIDGE_URL;
    const bridgeKey = process.env.PALACE_BRIDGE_API_KEY;
    if (bridgeUrl) {
      try {
        await fetch(`${bridgeUrl}/palaces/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(bridgeKey ? { "X-Palace-Key": bridgeKey } : {}),
          },
          body: JSON.stringify({
            palace_id: args.clientId,
            graph_name: `palace_${args.clientId}`,
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        // Non-fatal — bridge can be registered later.
      }
    }

    // 7. Generate L0 + L1.
    try {
      await ctx.runMutation(internal.serving.l0l1.generateL0, { palaceId });
      await ctx.runMutation(internal.serving.l0l1.generateL1, { palaceId });
    } catch {
      // Non-fatal — cron will regenerate.
    }

    // 8. Mark ready.
    await ctx.runMutation(api.palace.mutations.markPalaceReady, { palaceId });

    return {
      status: "provisioned",
      palaceId,
      wings: Object.keys(wingIds).length,
      rooms: roomCount,
    };
  },
});
