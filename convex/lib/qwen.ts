// Bedrock Titan Text Embeddings v2 — primary embedding provider.
//
// File name kept as "qwen.ts" to avoid import churn across the codebase.
// The concrete backend is AWS Bedrock's Titan v2 model (ap-south-1),
// invoked via Bedrock's bearer-token auth (no SigV4 needed).
//
// Model:    amazon.titan-embed-text-v2:0
// Dims:     1024 (configurable: 256 / 512 / 1024)
// Context:  8K tokens per input
// Batch:    1 text per call — parallelized at the caller side
//
// Prior providers tried: Qwen3-8B via HF/Scaleway (credits depleted),
// Voyage direct (no API key provided), Gemini (billing not active).
// Bedrock's bearer-token mode is the unblocked path.

const BEDROCK_REGION = "ap-south-1";
const BEDROCK_MODEL_ID = "amazon.titan-embed-text-v2:0";

export const EMBEDDING_MODEL = BEDROCK_MODEL_ID;
export const EMBEDDING_DIMENSIONS = 1024;
export const EMBEDDING_API_URL =
  `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com/model/${encodeURIComponent(BEDROCK_MODEL_ID)}/invoke`;

// Titan v2 accepts up to 8192 tokens (~32K chars). Keep a safe margin.
const MAX_CONTENT_CHARS = 30_000;

export type EmbedInputType = "query" | "document";

export function truncateForEmbedding(text: string): string {
  if (text.length <= MAX_CONTENT_CHARS) return text;
  return text.slice(0, MAX_CONTENT_CHARS);
}

export async function embedOne(
  text: string,
  _inputType: EmbedInputType = "document",
): Promise<number[]> {
  return callBedrock(text);
}

export async function embedBatchTexts(
  texts: string[],
  _inputType: EmbedInputType = "document",
): Promise<{ embeddings: number[][]; count: number }> {
  if (texts.length === 0) return { embeddings: [], count: 0 };

  // Titan v2 is single-input per call. Parallelize in chunks to avoid
  // per-region rate limits.
  const CONCURRENCY = 8;
  const results: number[][] = new Array(texts.length);

  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const batch = texts.slice(i, i + CONCURRENCY);
    const vecs = await Promise.all(batch.map((t) => callBedrock(t)));
    for (let j = 0; j < batch.length; j++) {
      results[i + j] = vecs[j]!;
    }
  }

  return { embeddings: results, count: results.length };
}

async function callBedrock(text: string): Promise<number[]> {
  const token = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!token) throw new Error("AWS_BEARER_TOKEN_BEDROCK not set");

  const truncated = truncateForEmbedding(text);
  if (!truncated.trim()) {
    return new Array(EMBEDDING_DIMENSIONS).fill(0);
  }

  const response = await fetch(EMBEDDING_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      inputText: truncated,
      dimensions: EMBEDDING_DIMENSIONS,
      normalize: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Bedrock Titan embed error ${response.status}: ${body.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as {
    embedding: number[];
    inputTextTokenCount: number;
  };

  if (!data.embedding || data.embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Bedrock returned ${data.embedding?.length ?? 0}-dim, expected ${EMBEDDING_DIMENSIONS}`,
    );
  }

  return data.embedding;
}
