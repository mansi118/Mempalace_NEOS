// Qwen3-Embedding-8B via HuggingFace/Scaleway — single embedding provider.
//
// OpenAI-compatible API via HuggingFace router.
// Replaces Voyage and Gemini embeddings.
//
// Endpoint: https://router.huggingface.co/scaleway/v1/embeddings
// Model: qwen3-embedding-8b (provider ID, not HF model ID)
// Dimensions: 4096
// Auth: Bearer HF_TOKEN

export const EMBEDDING_MODEL = "qwen3-embedding-8b";
export const EMBEDDING_DIMENSIONS = 4096;
export const EMBEDDING_API_URL =
  "https://router.huggingface.co/scaleway/v1/embeddings";

// Qwen3-Embedding-8B supports up to 32K tokens. Be conservative.
const MAX_CONTENT_CHARS = 120_000;

export function truncateForEmbedding(text: string): string {
  if (text.length <= MAX_CONTENT_CHARS) return text;
  return text.slice(0, MAX_CONTENT_CHARS);
}

/**
 * Embed a single text.
 */
export async function embedOne(text: string): Promise<number[]> {
  const { embeddings } = await callQwenEmbedding([text]);
  return embeddings[0]!;
}

/**
 * Batch embed multiple texts. The API handles batching natively.
 */
export async function embedBatchTexts(
  texts: string[],
): Promise<{ embeddings: number[][]; count: number }> {
  if (texts.length === 0) return { embeddings: [], count: 0 };

  // Scaleway/HF handles batches natively. Chunk at 64 to be safe.
  const CHUNK_SIZE = 64;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
    const chunk = texts.slice(i, i + CHUNK_SIZE);
    const { embeddings } = await callQwenEmbedding(chunk);
    allEmbeddings.push(...embeddings);
  }

  return { embeddings: allEmbeddings, count: allEmbeddings.length };
}

/**
 * Call the Qwen embedding API (OpenAI-compatible format).
 */
async function callQwenEmbedding(
  texts: string[],
): Promise<{ embeddings: number[][] }> {
  const token = process.env.HF_TOKEN;
  if (!token) {
    throw new Error("HF_TOKEN not set in Convex environment");
  }

  const truncated = texts.map(truncateForEmbedding);

  const response = await fetch(EMBEDDING_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: truncated,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Qwen Embedding API error ${response.status}: ${body.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
    model: string;
  };

  // Sort by index (API may return out of order).
  const sorted = data.data.sort((a, b) => a.index - b.index);
  const embeddings = sorted.map((d) => d.embedding);

  // Sanity check.
  for (let i = 0; i < embeddings.length; i++) {
    if (embeddings[i]!.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Expected ${EMBEDDING_DIMENSIONS}-dim, got ${embeddings[i]!.length} at index ${i}`,
      );
    }
  }

  return { embeddings };
}
