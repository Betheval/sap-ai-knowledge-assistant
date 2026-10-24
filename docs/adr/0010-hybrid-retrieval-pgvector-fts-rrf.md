# 10. Hybrid retrieval with pgvector, full-text search and RRF

Date: 2026-10-18
Status: Accepted

## Context

Technical documentation is full of exact identifiers: `@requires`,
`xs-security.json`, `cds.ql`, `mta.yaml`. Embedding similarity captures meaning
well but often ranks such exact matches poorly. Keyword search has the opposite
profile.

## Decision

The PostgreSQL retriever (`hybrid-pg-retriever`, `pg` profile) runs two searches
over the same chunks, in one SQL statement, and fuses them:

1. **Semantic:** cosine distance on the pgvector `embedding` column (HNSW index),
   restricted to chunks embedded with the configured model (ADR 0005).
2. **Lexical:** PostgreSQL full-text search on the generated `search_vector`
   column (`english` configuration, GIN index):
   - the heading path has weight **A** and the content weight **D**, so a match
     in "Deploy to Cloud Foundry" counts more than one in a paragraph;
   - query words are **OR-ed** (any word may match), because questions contain
     more words than the passages that answer them;
   - ranking uses `ts_rank`;
   - words present in the whole corpus ("CAP") are removed from the lexical query.
3. **Fusion:** Reciprocal Rank Fusion with equal weights over the top
   30 candidates of each search:

   ```
   score(chunk) = 1 / (60 + semantic_rank) + 1 / (60 + lexical_rank)
   ```

Both searches use the standalone query from
[ADR 0007](0007-conversation-history-with-query-rewriting.md). The top 6 chunks
go to the answer step.

**Runtime filter:** CAP has a Node.js and a Java runtime, and Capire documents
both. The assistant answers for **Node.js by default** and for Java when the
question or its rewrite mentions Java (Java, Spring Boot, Maven, `pom.xml`, …).
Both searches leave out the pages of the other runtime (`java/` for Node.js,
`node.js/` for Java); general guides are always searched, and the answer prompt
names the runtime so the model picks the right variant inside them. On the same
25 questions the filter raised hybrid search from 84% / 96% / 100% (MRR 0.910)
to 88% / 100% / 100% (MRR 0.933).

**Abstention** (ADR 0008): RRF scores are relative, so the retriever abstains
when no result has a cosine similarity of at least `minSimilarity` (0.5) to the
question.

### Evidence (golden set, 22 questions, Capire @2337009)

| Variant                                    | hit@1 | hit@3 | hit@6 | MRR@6 |
| ------------------------------------------ | ----- | ----- | ----- | ----- |
| Semantic only                              | 82%   | 91%   | 95%   | 0.860 |
| Lexical only, `ts_rank_cd`, no weights     | 27%   | 45%   | 59%   | 0.382 |
| Hybrid with that lexical search            | 45%   | 73%   | 86%   | 0.606 |
| Lexical only, weighted headings, `ts_rank` | 73%   | 86%   | 91%   | 0.797 |
| **Hybrid, weighted headings, `ts_rank`**   | 82%   | 95%   | 100%  | 0.898 |

Later, with the runtime filter on an extended set of 25 questions (three about
Java): hybrid 88% / 100% / 100%, MRR 0.933 (`npm run eval:retrieval`).

- The first hybrid attempt was **worse than semantic search alone**: an
  unnormalized `ts_rank_cd` with OR-ed words favors long chunks full of common
  words, and equal-weight fusion let it drag down good semantic results.
- Weighted headings with `ts_rank` fixed the lexical side; the hybrid then
  finds the right page within the top 6 for every question.
- Lower lexical weights in the fusion (0.5–0.7) and `k = 20` were tried and did
  not help; equal weights and `k = 60` are the standard choice.
- Abstention: the least similar covered question scored 0.583, the most similar
  uncovered question 0.396, so 0.5 separates all of them.

## Consequences

- The improvement over semantic search alone is real but small on this sample
  (one question corresponds to 4.5 points); it is mainly in recall, which is
  what matters for the answer step. The baseline in
  `test/golden/retrieval-baseline.json` makes regressions visible.
- RRF only uses ranks, so the different score scales never need to be
  normalized; the cosine similarity is still returned for abstention.
- Changing the `search_vector` expression requires recreating the generated
  column; `db/postgres/retrieval-schema.sql` detects an outdated definition.
- Java users have to say so in their question (or earlier in the
  conversation); otherwise Java-only pages are not searched.
- A reranking model could be added later behind the same `Retriever` port.
