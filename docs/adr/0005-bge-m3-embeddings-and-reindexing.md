# 5. bge-m3 embeddings and explicit reindexing

Date: 2026-10-18
Status: Accepted

## Context

Questions and corpus are in English. The embedding model must handle technical
prose mixed with code, and chunks of up to ~800 tokens without truncation.
Embeddings are also not portable: vectors produced by different models
(or with different dimensions) cannot be compared, so changing the embedding
provider (for example in phase 5) invalidates the whole index.

## Decision

- We will use `bge-m3` (served by the same Ollama host) as the embedding model.
  It performs well on retrieval benchmarks, produces 1024-dimensional vectors
  and accepts inputs up to 8192 tokens, so no chunk is truncated.
- Every stored chunk records the `embeddingModel` that produced its vector.
- Retrieval only queries chunks whose `embeddingModel` matches the configured
  provider; a mismatch at startup is reported by `/health`.
- Reindexing is an explicit command (`npm run ingest -- --reindex`), never an
  implicit side effect of a configuration change.

## Consequences

- Chunks are embedded whole, including their code blocks.
- The model is larger than alternatives such as `nomic-embed-text` (768 dims),
  which makes ingestion slower; acceptable for a corpus of Capire's size.
- Swapping the embedding provider is a deliberate, observable operation.
- The vector column dimension (1024) is tied to the model; another model with a
  different dimension requires a migration.
