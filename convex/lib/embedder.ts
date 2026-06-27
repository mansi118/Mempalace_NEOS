// Active embedding provider — the SINGLE place the embedder is chosen.
//
// Everything that embeds (ingestion/embed, ingestion/ingest, serving/search, palace/queries health)
// imports from HERE, never from a concrete provider lib. Switching providers is this one line.
//
//   active:   ./gemini.js     (gemini-embedding-001, 1024-d, L2-normalized) — the unblocked path.
//   parked:   ./qwen.js       (Bedrock Titan v2, 1024-d) — blocked account-wide; re-point here if Bedrock opens.
//   PLANNED:  ./voyage.js     (NOT YET) — the stated target embedder. Forward-dependency, named not hidden:
//             Gemini is correct *for now* (no Voyage key on hand). Moving to Voyage = add lib/voyage.js +
//             change the line below. The runtime is embedding-agnostic so the *switch* is cheap, but a
//             *re-embed* is required if Voyage's dimension/space differs from gemini-embedding-001's 1024-d.
//             Tracked as the "embedder provider" passage in docs/production-readiness.md.
//
// Provider libs MUST export the same surface: EMBEDDING_MODEL · EMBEDDING_DIMENSIONS · EMBEDDER_PROVIDER ·
// EMBEDDER_ENV_KEY · embedderConfigured · truncateForEmbedding · embedOne · embedBatchTexts · EmbedInputType.

export * from "./gemini.js";
