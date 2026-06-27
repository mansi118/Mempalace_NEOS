// Gemini text embeddings — embedding provider (the unblocked path; Bedrock Titan is account-blocked).
//
// Model:    gemini-embedding-001  (Google Generative Language API, v1beta)
// Dims:     1024  — matches the schema `by_embedding` vector index EXACTLY (no re-index).
//           gemini-embedding-001 supports outputDimensionality (Matryoshka); we request 1024.
// Norm:     CLIENT-SIDE L2. Gemini only auto-normalizes at the full 3072-d output; at a truncated
//           dimension it returns UN-normalized vectors (measured L2≈0.61 @1024). Cosine/dot retrieval
//           needs unit vectors, so we normalize here — the silent-garbage failure class if skipped.
// Context:  ~2048 input tokens for this model (smaller than Titan's 8K) → tighter truncation.
// Task:     uses taskType (RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY) — the `inputType` arg that was a
//           no-op for Titan is a real asymmetric-retrieval quality lever for Gemini.
//
// Provider switch lives in lib/embedder.ts (the single active-provider choice). FORWARD-DEPENDENCY:
// the stated target embedder is Voyage; Gemini is correct *for now* (Voyage key not on hand). Moving to
// Voyage later is a re-embed IF the dimension/space differs — see the ledger "embedder provider" passage.

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 1024;
export const EMBEDDING_API_URL =
  `${GEMINI_API_BASE}/models/${EMBEDDING_MODEL}:embedContent`;

// Single source of truth for the provider name + env key (surfaced by the embeddingHealth query).
// The credential must live in the CONVEX deployment env (`convex env set GEMINI_API_KEY ...`), NOT the
// runtime container — embeddings compute server-side here; when absent, embedOne throws → closets land
// embeddingStatus="failed" → retrieval silently degrades, which the health query exposes.
export const EMBEDDER_PROVIDER = "gemini-embedding-001";
export const EMBEDDER_ENV_KEY = "GEMINI_API_KEY";
export function embedderConfigured(): boolean {
  return !!(process.env[EMBEDDER_ENV_KEY] || "").trim();
}

// gemini-embedding-001 accepts ~2048 tokens; keep a safe char margin (~4 chars/token).
const MAX_CONTENT_CHARS = 8_000;

export type EmbedInputType = "query" | "document";

export function truncateForEmbedding(text: string): string {
  if (text.length <= MAX_CONTENT_CHARS) return text;
  return text.slice(0, MAX_CONTENT_CHARS);
}

function taskTypeFor(inputType: EmbedInputType): string {
  return inputType === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
}

// L2-normalize to unit length (required: Gemini does not normalize truncated-dim output).
function l2normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const x of vec) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  return vec.map((x) => x / norm);
}

function apiKey(): string {
  const key = (process.env[EMBEDDER_ENV_KEY] || "").trim();
  if (!key) throw new Error(`${EMBEDDER_ENV_KEY} not set in the Convex deployment env`);
  return key;
}

export async function embedOne(
  text: string,
  inputType: EmbedInputType = "document",
): Promise<number[]> {
  const truncated = truncateForEmbedding(text);
  if (!truncated.trim()) {
    return new Array(EMBEDDING_DIMENSIONS).fill(0);
  }

  const response = await fetch(`${EMBEDDING_API_URL}?key=${apiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text: truncated }] },
      taskType: taskTypeFor(inputType),
      outputDimensionality: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini embed error ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as { embedding?: { values?: number[] } };
  const values = data.embedding?.values;
  if (!values || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Gemini returned ${values?.length ?? 0}-dim, expected ${EMBEDDING_DIMENSIONS}`,
    );
  }
  return l2normalize(values);
}

export async function embedBatchTexts(
  texts: string[],
  inputType: EmbedInputType = "document",
): Promise<{ embeddings: number[][]; count: number }> {
  if (texts.length === 0) return { embeddings: [], count: 0 };

  // batchEmbedContents caps requests per call; chunk conservatively.
  const BATCH = 100;
  const results: number[][] = new Array(texts.length);

  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH);
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${apiKey()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: chunk.map((t) => ({
            model: `models/${EMBEDDING_MODEL}`,
            content: { parts: [{ text: truncateForEmbedding(t) || " " }] },
            taskType: taskTypeFor(inputType),
            outputDimensionality: EMBEDDING_DIMENSIONS,
          })),
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gemini batch embed error ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = (await response.json()) as { embeddings?: Array<{ values?: number[] }> };
    const embs = data.embeddings;
    if (!embs || embs.length !== chunk.length) {
      throw new Error(`Gemini batch returned ${embs?.length ?? 0}, expected ${chunk.length}`);
    }
    for (let j = 0; j < chunk.length; j++) {
      const values = embs[j]?.values;
      if (!values || values.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Gemini batch item ${j} ${values?.length ?? 0}-dim, expected ${EMBEDDING_DIMENSIONS}`,
        );
      }
      results[i + j] = l2normalize(values);
    }
  }

  return { embeddings: results, count: results.length };
}
