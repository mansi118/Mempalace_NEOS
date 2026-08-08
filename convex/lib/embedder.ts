// Active embedding provider — the SINGLE place the embedder is chosen.
//
// Everything that embeds (ingestion/embed, ingestion/ingest, serving/search, palace/queries health)
// imports from HERE, never from a concrete provider lib. Switching providers is this one line.
//
//   active:   ./qwen.js       (Bedrock Titan v2, 1024-d, server-normalized) — reaches Bedrock via the
//             bedrock-runtime PrivateLink VPC endpoint, so it needs NO internet/NAT. The correct embedder
//             for the no-NAT spine (verified: Titan embeddings ARE available on this account; the stale
//             "Bedrock blocked" note was disproven by a live invoke-model test). Auth = AWS_BEARER_TOKEN_BEDROCK.
//   parked:   ./gemini.js     (gemini-embedding-001, 1024-d, client-L2) — correct code, but Google's API is
//             external internet with NO VPC endpoint → needs NAT. One-line switch here IF a NAT/EIP lands.
//   PLANNED:  ./voyage.js     (NOT YET) — the stated target embedder. Forward-dependency, named not hidden:
//             Bedrock Titan is correct *for now* (no Voyage key on hand; Bedrock is internet-free in-VPC).
//             Moving to Voyage = add lib/voyage.js + change the line below + a re-embed IF dims/space differ.
//             Tracked as the "embedder provider" passage in docs/production-readiness.md.
//
// Provider libs MUST export the same surface: EMBEDDING_MODEL · EMBEDDING_DIMENSIONS · EMBEDDER_PROVIDER ·
// EMBEDDER_ENV_KEY · embedderConfigured · truncateForEmbedding · embedOne · embedBatchTexts · EmbedInputType.

// M1/D1: Gemini @768 is the canonical V1 embedder. NOTE: do NOT deploy this branch to the live no-NAT
// AWS spine — Gemini is unreachable there (no internet egress); that spine stays on qwen.js (Titan@1024)
// until a NAT gateway lands. This selector is for dev + the post-NAT live flip (empty corpus = free re-index).
export * from "./gemini.js";
