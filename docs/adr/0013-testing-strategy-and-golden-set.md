# 13. Testing strategy and RAG golden set

Date: 2026-10-18
Status: Accepted

## Context

Phase 4 is dedicated to quality, but deferring all tests until then would make
early refactors risky. RAG quality also cannot be judged by unit tests alone:
changes to chunking, `k`, thresholds or models can silently make answers worse.

## Decision

From phase 1:

- **Unit tests** for the use cases (rewriting, prompt building, citation parsing,
  abstention) using the fake adapters from [ADR 0003](0003-provider-abstraction-via-cap-services.md).
- **Service tests** with `cds.test` against the OData API (`ask`, history,
  per-user isolation) on in-memory SQLite.
- Test runner: Jest, the best supported option for `cds.test`.
- No test requires the Ollama host; tests that need it are tagged and run on demand.

From phase 2:

- **Golden set:** `test/golden/retrieval.json`, with 22 standalone questions,
  each with the Capire pages that answer it, plus questions the documentation
  does not cover, for abstention. Follow-up questions are covered by the unit
  tests of query rewriting; the retrieval set uses standalone questions so its
  results do not depend on the LLM.
- `npm run eval:retrieval` reports hit@1/3/6 and MRR@6 for semantic, lexical and
  hybrid search, and the similarity margin between covered and uncovered
  questions. `--save` stores the results in `test/golden/retrieval-baseline.json`,
  so every retrieval change can be compared with the previous baseline.
- Integration tests for the PostgreSQL retriever against the `knowledge_test`
  database ([ADR 0011](0011-persistence-sqlite-then-postgres.md)). They are skipped
  when no test database is configured, so `npm test` stays runnable anywhere;
  CI (phase 4) provides its own PostgreSQL service container.

## Consequences

- Safe refactoring from day one, and a fast test suite without network access.
- Retrieval tuning ([ADR 0008](0008-grounded-answers-citations-and-abstention.md), [ADR 0010](0010-hybrid-retrieval-pgvector-fts-rrf.md)) becomes data-driven instead of anecdotal.
- The golden set has to be maintained when the corpus commit changes.
- Answer quality (as opposed to retrieval) is evaluated manually at first; an
  LLM-as-judge step can be added later.
