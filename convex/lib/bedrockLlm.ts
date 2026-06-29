// Bedrock Nova LLM caller for structured extraction — the in-VPC, no-NAT replacement for geminiLlm.
//
// WHY: the dogfood spine is no-NAT (VPC endpoints only). Gemini
// (generativelanguage.googleapis.com) is a PUBLIC Google API with no VPC endpoint, so the Convex task
// cannot reach it → ingestion threw "extraction_failed: fetch failed" and every write quarantined
// without an embedded drawer (proven live 2026-06-29 during the jcode T0 spike). Bedrock Nova is
// reachable via the SAME bedrock-runtime PrivateLink VPC endpoint + bearer-token auth the Titan
// embedder already uses (lib/qwen.ts) — verified in-VPC: a bearer-token Nova invoke returns cleanly.
//
// On-demand Nova requires a cross-region INFERENCE PROFILE (bare `amazon.nova-*` ids reject on-demand),
// so the model id is the APAC profile. Drop-in for callGeminiLlm: same opts + same response shape.

const BEDROCK_REGION = "ap-south-1";

// APAC cross-region inference profile (on-demand Nova needs a profile, not the bare model id).
export const BEDROCK_LLM_MODEL_ID =
  process.env.BEDROCK_LLM_MODEL_ID || "apac.amazon.nova-lite-v1:0";

const BEDROCK_LLM_API_URL = `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com/model/${encodeURIComponent(
  BEDROCK_LLM_MODEL_ID,
)}/invoke`;

export interface BedrockLlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Call Bedrock Nova for text generation with optional JSON mode.
 * Signature + return shape are identical to callGeminiLlm (drop-in replacement).
 */
export async function callBedrockLlm(opts: {
  systemPrompt: string;
  userPrompt: string;
  jsonMode?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
}): Promise<BedrockLlmResponse> {
  const token = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!token) {
    throw new Error("AWS_BEARER_TOKEN_BEDROCK not set in Convex environment");
  }

  // Nova has no strict JSON-mode flag (unlike Gemini's responseMimeType) — instruct it, then strip
  // markdown fences defensively so parseExtractionResponse() receives clean JSON.
  const system = opts.jsonMode
    ? `${opts.systemPrompt}\n\nRespond with ONLY valid JSON. No markdown, no code fences, no commentary.`
    : opts.systemPrompt;

  const body = {
    system: [{ text: system }],
    messages: [{ role: "user", content: [{ text: opts.userPrompt }] }],
    inferenceConfig: {
      maxTokens: opts.maxOutputTokens ?? 4096,
      temperature: opts.temperature ?? 0.2,
    },
  };

  const response = await fetch(BEDROCK_LLM_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(
      `Bedrock Nova LLM error ${response.status}: ${errBody.slice(0, 400)}`,
    );
  }

  const data = (await response.json()) as {
    output?: { message?: { content?: Array<{ text?: string }> } };
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  };

  let text = (data.output?.message?.content ?? [])
    .map((p) => p.text ?? "")
    .join("");

  // Defensive: strip ```json … ``` fences if the model added them despite instructions.
  text = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const usage = data.usage ?? {};
  return {
    text,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
  };
}
