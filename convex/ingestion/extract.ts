"use node";
// Memory extraction via Gemini 2.5 Flash.
//
// Given raw conversation exchange text, extracts structured memories:
//   - Routes to the correct (wing, room, category) from the palace structure
//   - Extracts atomic facts as drawers
//   - Identifies entities for graph ingestion
//   - Assigns confidence score
//
// Tier 1 fixes from ultrathink:
//   - Gemini is the PRIMARY router (not keywords). It sees the full palace
//     structure and picks (wing, room, category) in one call.
//   - Extraction failures → quarantine (never lost).
//   - Embeds extracted content+facts, not raw text (Gemini 2K token limit).
//   - Validates JSON output before creating closets.

import { action } from "../_generated/server.js";
import { v } from "convex/values";
import { callGeminiLlm } from "../lib/geminiLlm.js";
import { CATEGORIES } from "../lib/enums.js";

// ─── Types ──────────────────────────────────────────────────────

export interface ExtractionItem {
  wing: string;
  room: string;
  category: string;
  content: string;
  title: string;
  facts: string[];
  entities: Array<{
    name: string;
    type: string;
    relation: string;
    value: string;
  }>;
  confidence: number;
}

export interface ExtractionResult {
  items: ExtractionItem[];
  tokensUsed: number;
  raw: string;
}

// ─── Palace structure for the prompt ────────────────────────────

const PALACE_STRUCTURE = `
PALACE STRUCTURE — Route extracted memories to the correct (wing, room, category).

WINGS AND ROOMS:

platform — NEOS platform, NEops, architecture, stack
  rooms: stack, architecture, neop-catalog, api-contracts, features, retired, pricing

clients — Active and historical client engagements
  rooms: _shared, zoo-media, unborred-club

team — People-centric memory for the NeuralEDGE team
  rooms: rahul, mansi, shivam, naveen, ankit, org

gtm — Finding, convincing, and closing clients (go-to-market)
  rooms: pipeline, icp, positioning, outreach, pitch, competitive

legal — Entity, contracts, compliance, finance
  rooms: entities, contracts, compliance, finance, ip

rd — Research, experimentation, meta-memory
  rooms: memory-systems, agent-frameworks, experiments, papers, tools

marketplace — NeP marketplace, ecosystem economics
  rooms: neps, economics, quality

infra — Servers, deployments, monitoring
  rooms: servers, services, incidents, runbooks, linux-admin

partners — Vendors and integration partners (non-clients)
  rooms: vendors, integrations

brand — Content, assets, voice, case studies
  rooms: voice, assets, case-studies

audit — System events (do NOT route user content here)
  rooms: _events

_quarantine — Unclassifiable content (use only if nothing else fits)
  rooms: unclassified

CATEGORIES (pick the most specific one):
- identity: what the org IS (mission, values, positioning)
- fact: static truths (specs, configs, numbers, names)
- decision: choices made + reasoning ("we chose X because Y")
- task: actionable work items, todos
- conversation: meeting notes, chat exchanges, discussions
- lesson: what worked/failed, retrospectives
- preference: individual/team styles, preferences
- procedure: SOPs, runbooks, how-to guides
- signal: time-sensitive events, alerts (short TTL)
- goal: OKRs, targets, aspirational ("reach 10 clients by Q4")
- relationship: person↔person, org↔org connections
- metric: persistent measurements, KPIs
- question: open threads, unresolved questions

DOMAIN GLOSSARY:
- NeuralEDGE: the company (entity: Synlex Technologies PVT. LTD.)
- NEOS: the AI platform being built
- NEop: an AI agent/operator on the NEOS platform (e.g., Aria, Forge, Scout)
- NeP: NEop Enhancement Pack (marketplace plugin for NEops)
- CORTEX: the memory/intelligence layer of NEOS
- Context Vault / PALACE: the memory system (what you're extracting for)
- ICD: Image Content Director (a NEop for clients like Zoo Media)
- OpenClaw: the NEop runtime framework
- Rahul: Co-Founder/CTO
- Mansi: VP AI Research
`.trim();

// ─── Extraction prompt ──────────────────────────────────────────

const SYSTEM_PROMPT = `You are the EXTRACTOR for Context Vault (PALACE), NeuralEDGE's memory system.

Given a conversation exchange between a human and an AI assistant, extract structured memories.

${PALACE_STRUCTURE}

RULES:
1. Return a JSON array. Each item represents ONE distinct topic/decision/fact.
2. Pick wing and room from the lists above. Use the CLOSEST match.
3. Pick category from the list above. Be specific (decision > fact > conversation).
4. "content" should capture the FULL context — preserve exact quotes, numbers, dates, INR amounts.
5. "title" should be a short (< 80 char) label for the memory.
6. "facts" must be ATOMIC: one testable statement each, under 100 chars.
7. "entities" identify people, companies, projects, NEops mentioned.
8. "confidence" reflects extraction certainty: 0.9 = clearly stated, 0.6 = implied, 0.3 = speculation.
9. If the exchange is trivial (greetings, "thanks", corrections) return an empty array [].
10. If unsure about wing/room, use _quarantine/unclassified.

OUTPUT FORMAT (JSON array, no markdown wrapping):
[
  {
    "wing": "platform",
    "room": "stack",
    "category": "decision",
    "title": "Chose Convex over Supabase",
    "content": "Rahul decided to use Convex instead of Supabase for the NEOS platform because of real-time subscriptions and built-in vector search.",
    "facts": ["NEOS uses Convex as primary database", "Supabase was rejected for NEOS"],
    "entities": [{"name": "Rahul", "type": "person", "relation": "decided", "value": "CTO"}],
    "confidence": 0.9
  }
]`;

// ─── Extraction action ──────────────────────────────────────────

export const extractMemories = action({
  args: {
    exchangeText: v.string(),
    conversationTitle: v.optional(v.string()),
    exchangeIndex: v.optional(v.number()),
  },
  handler: async (_ctx, args): Promise<ExtractionResult> => {
    const contextPrefix = args.conversationTitle
      ? `Conversation: "${args.conversationTitle}"${args.exchangeIndex !== undefined ? ` (exchange ${args.exchangeIndex})` : ""}\n\n`
      : "";

    const userPrompt = `${contextPrefix}${args.exchangeText}`;

    const response = await callGeminiLlm({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      jsonMode: true,
      maxOutputTokens: 4096,
      temperature: 0.1,
    });

    // Parse and validate the JSON response.
    const items = parseExtractionResponse(response.text);

    return {
      items,
      tokensUsed: response.totalTokens,
      raw: response.text,
    };
  },
});

// ─── Response parsing + validation ──────────────────────────────

function parseExtractionResponse(raw: string): ExtractionItem[] {
  // Strip markdown code fences if present (belt and suspenders).
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Extraction JSON parse failed: ${cleaned.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed)) {
    // Sometimes Gemini wraps in an object like { "extractions": [...] }.
    if (parsed && typeof parsed === "object") {
      const values = Object.values(parsed);
      const arr = values.find(Array.isArray);
      if (arr) {
        parsed = arr;
      } else {
        throw new Error("Extraction response is not an array");
      }
    } else {
      throw new Error("Extraction response is not an array");
    }
  }

  const validCategories = new Set(CATEGORIES as readonly string[]);
  const items: ExtractionItem[] = [];

  for (const item of parsed as unknown[]) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;

    // Validate required fields.
    const wing = String(obj.wing ?? "_quarantine").toLowerCase().replace(/\s+/g, "-");
    const room = String(obj.room ?? "unclassified").toLowerCase().replace(/\s+/g, "-");
    const category = String(obj.category ?? "fact").toLowerCase();
    const content = String(obj.content ?? "");
    const title = String(obj.title ?? "").slice(0, 120);

    if (!content.trim()) continue; // Skip empty extractions.

    // Validate category — fall back to "fact" if invalid.
    const validCategory = validCategories.has(category) ? category : "fact";

    // Parse facts.
    const rawFacts = Array.isArray(obj.facts) ? obj.facts : [];
    const facts = rawFacts
      .map((f: unknown) => String(f).trim())
      .filter((f: string) => f.length > 0)
      .map((f: string) => f.slice(0, 200)); // Cap individual fact length.

    // Parse entities.
    const rawEntities = Array.isArray(obj.entities) ? obj.entities : [];
    const entities = rawEntities
      .filter((e: unknown) => e && typeof e === "object" && (e as Record<string, unknown>).name)
      .map((e: unknown) => {
        const ent = e as Record<string, unknown>;
        return {
          name: String(ent.name ?? ""),
          type: String(ent.type ?? "unknown"),
          relation: String(ent.relation ?? ""),
          value: String(ent.value ?? ""),
        };
      });

    // Parse confidence.
    let confidence = Number(obj.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      confidence = 0.5;
    }

    items.push({
      wing,
      room,
      category: validCategory,
      content,
      title,
      facts,
      entities,
      confidence,
    });
  }

  return items;
}
