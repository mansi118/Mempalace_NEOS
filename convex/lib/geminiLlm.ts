// Gemini 2.5 Flash LLM caller for structured extraction.
//
// Used by Phase 4 ingestion to extract memories from raw exchange text.
// Shares the GEMINI_API_KEY with lib/gemini.ts (embeddings).
//
// Uses Gemini's structured output (JSON mode) for reliable parsing.

export const GEMINI_LLM_MODEL = "gemini-2.5-flash-preview-04-17";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiLlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Call Gemini for text generation with optional JSON mode.
 */
export async function callGeminiLlm(opts: {
  systemPrompt: string;
  userPrompt: string;
  jsonMode?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
}): Promise<GeminiLlmResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set in Convex environment");
  }

  const url = `${GEMINI_API_BASE}/models/${GEMINI_LLM_MODEL}:generateContent?key=${apiKey}`;

  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [{ text: opts.userPrompt }],
      },
    ],
    systemInstruction: {
      parts: [{ text: opts.systemPrompt }],
    },
    generationConfig: {
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
      temperature: opts.temperature ?? 0.2,
      ...(opts.jsonMode
        ? { responseMimeType: "application/json" }
        : {}),
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(
      `Gemini LLM error ${response.status}: ${errBody.slice(0, 400)}`,
    );
  }

  const data = (await response.json()) as {
    candidates: Array<{
      content: { parts: Array<{ text: string }> };
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };

  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error("Gemini returned no candidates");
  }

  const text = candidate.content.parts.map((p) => p.text).join("");
  const usage = data.usageMetadata ?? {};

  return {
    text,
    inputTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
    totalTokens: usage.totalTokenCount ?? 0,
  };
}
