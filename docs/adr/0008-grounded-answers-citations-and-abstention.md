# 8. Grounded answers, citations and abstention

Date: 2026-10-18
Status: Accepted

## Context

A technical assistant that invents APIs or configuration is worse than none.
Users must be able to verify every answer against the original documentation.

## Decision

- The system prompt instructs the model to answer **only** from the provided
  context, and to cite the chunks it uses with numeric markers (`[1]`, `[2]`).
- The backend parses the markers, maps them to the retrieved chunks and returns
  every retrieved source with a `cited` flag.
- If no retrieved chunk passes a relevance threshold, the assistant does not call
  the answer step. It replies that the documentation does not cover the
  question, and suggests rephrasing.
- The threshold is applied inside each retriever, because score scales differ
  between retrieval strategies; the use case abstains when the retriever
  returns nothing. The fake retriever uses a keyword score (`minScore`); the
  PostgreSQL hybrid retriever requires a cosine similarity of at least
  `minSimilarity` = 0.5, chosen on the golden set (ADR 0010).
- The citation instruction is repeated after the question: with six long
  excerpts in the prompt, `qwen2.5:7b` ignored citation rules given only in the
  system prompt, and cited consistently once they were repeated at the end.
- Markers that do not match any retrieved chunk are removed from the answer and
  logged.

## Consequences

- Every claim can be traced to a Capire page.
- The relevance threshold needs tuning against the golden set
  ([ADR 0013](0013-testing-strategy-and-golden-set.md)); too strict means unhelpful refusals, too loose means
  weakly grounded answers.
- Some legitimate general questions ("what is CAP?") may be answered less
  fluently than by an unconstrained model; this is accepted.
