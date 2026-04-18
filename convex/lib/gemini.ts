// Gemini Embedding API caller — shared between embed actions and search actions.
//
// Extracted to a shared module so both embed.ts (action) and search.ts (action)
// can call Gemini directly without action-to-action calls (which Convex forbids).
//
// Models:
//   - gemini-embedding-001: production, 768 dims default, 2048 token input
//   - gemini-embedding-2-preview: preview, 768 dims default
//
// Gemini embedding supports task_type for asymmetric search:
//   - RETRIEVAL_DOCUMENT: for stored content
//   - RETRIEVAL_QUERY: for search queries
//   - SEMANTIC_SIMILARITY, CLASSIFICATION, CLUSTERING: other use cases

export const GEMINI_MODEL = "models/gemini-embedding-001";
export const GEMINI_DIMENSIONS = 768;
export const GEMINI_MAX_BATCH = 100; // Gemini batchEmbedContent limit

// Max chars to send to Gemini. gemini-embedding-001 supports 2048 tokens ≈ 8K chars.
// Be conservative.
const MAX_CONTENT_CHARS = 7_500;

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY";

function getApiUrl(model: string, batch: boolean): string {
  const endpoint = batch ? "batchEmbedContents" : "embedContent";
  return `https://generativelanguage.googleapis.com/v1beta/${model}:${endpoint}`;
}

export function truncateForEmbedding(text: string): string {
  if (text.length <= MAX_CONTENT_CHARS) return text;
  return text.slice(0, MAX_CONTENT_CHARS);
}

/**
 * Embed a single text via Gemini.
 */
export async function embedOne(
  text: string,
  taskType: TaskType,
): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set in Convex environment");
  }

  const truncated = truncateForEmbedding(text);
  const url = `${getApiUrl(GEMINI_MODEL, false)}?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      content: { parts: [{ text: truncated }] },
      taskType,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Gemini Embedding API error ${response.status}: ${body.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as {
    embedding: { values: number[] };
  };

  const values = data.embedding.values;
  if (values.length !== GEMINI_DIMENSIONS) {
    throw new Error(
      `Expected ${GEMINI_DIMENSIONS}-dim embedding, got ${values.length}`,
    );
  }

  return values;
}

/**
 * Batch embed multiple texts via Gemini's batchEmbedContents.
 */
export async function embedBatchTexts(
  texts: string[],
  taskType: TaskType = "RETRIEVAL_DOCUMENT",
): Promise<{ embeddings: number[][]; count: number }> {
  if (texts.length === 0) return { embeddings: [], count: 0 };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set in Convex environment");
  }

  const allEmbeddings: number[][] = [];

  // Gemini batchEmbedContents accepts up to 100 requests per call.
  for (let i = 0; i < texts.length; i += GEMINI_MAX_BATCH) {
    const chunk = texts.slice(i, i + GEMINI_MAX_BATCH);
    const url = `${getApiUrl(GEMINI_MODEL, true)}?key=${apiKey}`;

    const requests = chunk.map((text) => ({
      model: GEMINI_MODEL,
      content: { parts: [{ text: truncateForEmbedding(text) }] },
      taskType,
    }));

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Gemini Batch Embedding API error ${response.status}: ${body.slice(0, 300)}`,
      );
    }

    const data = (await response.json()) as {
      embeddings: Array<{ values: number[] }>;
    };

    for (const emb of data.embeddings) {
      if (emb.values.length !== GEMINI_DIMENSIONS) {
        throw new Error(
          `Expected ${GEMINI_DIMENSIONS}-dim, got ${emb.values.length}`,
        );
      }
      allEmbeddings.push(emb.values);
    }
  }

  return { embeddings: allEmbeddings, count: allEmbeddings.length };
}
