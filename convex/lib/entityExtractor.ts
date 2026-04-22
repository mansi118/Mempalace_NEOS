// Entity extraction via Groq Llama 3.3 70B (free tier, fast LPU inference).
// Replaces Graphiti's LLM extraction for direct FalkorDB writes.
//
// Groq's OpenAI-compatible API. Free tier: ~30 req/min on 70B model.

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

export interface ExtractedEntity {
  name: string;
  type: string;
  aliases: string[];
}

export interface ExtractedRelation {
  from: string;
  to: string;
  relation: string;
}

export interface EntityExtraction {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

const SYSTEM_PROMPT = `Extract entities and relationships from text. Return ONLY valid JSON:
{
  "entities": [{"name": "canonical name", "type": "person|company|product|technology|concept|event|location|neop", "aliases": ["alt1"]}],
  "relations": [{"from": "entity", "to": "entity", "relation": "verb"}]
}

Rules:
- Canonical names (e.g. "NeuralEDGE" not "neuraledge")
- Skip generic concepts ("users", "system", "company")
- Max 15 entities per extraction
- Only explicit verb-based relations`;

export async function extractEntities(text: string): Promise<EntityExtraction> {
  const token = process.env.GROQ_API_KEY;
  if (!token) throw new Error("GROQ_API_KEY not set");

  const input = text.length > 8000 ? text.slice(0, 8000) : text;

  // Retry once on transient 5xx or rate-limit (429).
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: input },
        ],
        max_tokens: 1024,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      if (attempt === 0 && (response.status >= 500 || response.status === 429)) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw new Error(`Entity extraction ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    const parsed = parseEntityResponse(data.choices[0]?.message?.content ?? "");
    if (parsed.entities.length > 0 || attempt === 1) return parsed;
  }
  return { entities: [], relations: [] };
}

function parseEntityResponse(raw: string): EntityExtraction {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) return { entities: [], relations: [] };
  cleaned = cleaned.slice(start, end + 1);

  let parsed: any;
  try { parsed = JSON.parse(cleaned); } catch { return { entities: [], relations: [] }; }

  const entities: ExtractedEntity[] = (parsed.entities ?? [])
    .filter((e: any) => e?.name && typeof e.name === "string")
    .map((e: any) => ({
      name: e.name.trim(),
      type: String(e.type ?? "concept").toLowerCase(),
      aliases: Array.isArray(e.aliases) ? e.aliases.filter((a: any) => typeof a === "string") : [],
    }))
    .slice(0, 15);

  const relations: ExtractedRelation[] = (parsed.relations ?? [])
    .filter((r: any) => r?.from && r?.to && r?.relation)
    .map((r: any) => ({
      from: String(r.from).trim(),
      to: String(r.to).trim(),
      relation: String(r.relation).trim().toLowerCase(),
    }))
    .slice(0, 20);

  return { entities, relations };
}

export function normalizeEntityName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, " ").trim();
}
