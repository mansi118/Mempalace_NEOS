// Query expansion via Groq Llama 3.1 8B.
//
// Before embedding a user query, we ask a small LLM for 3-5 related
// search terms. The original query + expanded terms are then embedded
// together, which is especially powerful on short or underspecified
// queries ("Who is Rahul?" → "Rahul Kashyap NeuralEDGE CTO founder").
//
// Heuristics:
//   - Skip expansion if query has >6 tokens (already specific).
//   - Skip on any LLM error and fall back to raw query — expansion is
//     a bonus, never a blocker.
//   - Cap total added length so the embedded text stays short.

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-8b-instant";

const EXPANSION_SYSTEM_PROMPT = `You expand retrieval queries for a knowledge base about NeuralEDGE
(an AI-agent platform company that builds NEops, sold to clients like Zoo Media).
Given a user query, output 3-5 related search terms that capture the likely answer.
Return ONLY valid JSON of the form: {"expanded": ["term1", "term2", ...]}

Rules:
- Terms should be noun phrases or named entities, not sentences.
- Canonical names ("NeuralEDGE" not "neuraledge").
- Avoid repeating the query verbatim.
- Skip generic words ("the", "of", "system").`;

export interface ExpansionResult {
  original: string;
  expanded: string[];      // the extra terms only
  combined: string;        // "<original> <term1> <term2> ..."
  skipped: boolean;        // true = expansion wasn't attempted or added nothing
}

export async function expandQuery(query: string): Promise<ExpansionResult> {
  const trimmed = query.trim();
  const tokenCount = trimmed.split(/\s+/).length;

  // Already specific enough — skip.
  if (tokenCount > 6 || trimmed.length < 3) {
    return { original: trimmed, expanded: [], combined: trimmed, skipped: true };
  }

  const token = process.env.GROQ_API_KEY;
  if (!token) {
    return { original: trimmed, expanded: [], combined: trimmed, skipped: true };
  }

  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: EXPANSION_SYSTEM_PROMPT },
          { role: "user", content: trimmed },
        ],
        max_tokens: 200,
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) {
      return { original: trimmed, expanded: [], combined: trimmed, skipped: true };
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const raw = data.choices[0]?.message?.content ?? "";
    const parsed = parseExpansion(raw);

    if (parsed.length === 0) {
      return { original: trimmed, expanded: [], combined: trimmed, skipped: true };
    }

    // Cap combined length — don't let expansion swamp the embedding input.
    const combined = `${trimmed} ${parsed.join(" ")}`.slice(0, 400);
    return { original: trimmed, expanded: parsed, combined, skipped: false };
  } catch {
    return { original: trimmed, expanded: [], combined: trimmed, skipped: true };
  }
}

function parseExpansion(raw: string): string[] {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end < 0) return [];
    const json = JSON.parse(raw.slice(start, end + 1)) as { expanded?: unknown };
    if (!Array.isArray(json.expanded)) return [];
    return json.expanded
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && t.length < 80)
      .slice(0, 5);
  } catch {
    return [];
  }
}
