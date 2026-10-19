# 10. Hybrid retrieval with pgvector, full-text search and RRF

Date: 2026-10-18
Status: Accepted

## Context

Technical documentation is full of exact identifiers: `@requires`,
`xs-security.json`, `cds.ql`, `mta.yaml`. Embedding similarity captures meaning
well but often ranks such exact matches poorly. Keyword search has the opposite
profile.

## Decision

The `Retriever` adapter for PostgreSQL runs two searches in parallel over the
same chunks:

1. **Semantic:** cosine similarity on a pgvector column (`vector(1024)`, HNSW index).
2. **Lexical:** Postgres full-text search on a `tsvector` column with the
   `english` configuration (GIN index).

Both searches use the standalone query from [ADR 0007](0007-conversation-history-with-query-rewriting.md).

The two ranked lists are merged with **Reciprocal Rank Fusion**:

```
score(chunk) = Σ  1 / (k + rank_i(chunk))      k = 60 initially
```

The top results (initially 6) are passed to the answer step. Both queries are
written in SQL inside the adapter.

## Consequences

- Better recall on identifier-heavy questions, with no extra infrastructure.
- RRF only uses ranks, so the two very different score scales never need to be
  normalized.
- Two indexes to maintain; `k` and the result count are tuned against the
  golden set ([ADR 0013](0013-testing-strategy-and-golden-set.md)).
- A reranking model could be added later behind the same `Retriever` port.
