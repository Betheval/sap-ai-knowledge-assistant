# 7. Conversation history with query rewriting

Date: 2026-10-18
Status: Accepted

## Context

Conversations are multi-turn. Follow-up questions such as "and how do I deploy
it?" cannot be used for retrieval as they are: they depend on earlier turns.
Questions and corpus are in English only.

## Decision

Each `ask` call runs in two LLM steps:

1. **Rewrite.** The LLM receives the last N turns (initially 6 messages) and the
   new question, and returns a _standalone search query_. On the first turn of a
   conversation there is no history, so this step is skipped and the question is
   used as is.
2. **Answer.** Retrieval uses the rewritten query. The answer prompt contains the
   system instructions, the trimmed history, the retrieved chunks and the
   original question.

History is trimmed by a token budget, not only by message count, so it never
crowds out retrieved context. The rewritten query is stored on the assistant
message.

## Consequences

- Follow-up questions retrieve relevant documents, for both halves of hybrid
  search ([ADR 0010](0010-hybrid-retrieval-pgvector-fts-rrf.md)).
- One extra LLM call per follow-up question, which adds latency.
- Rewriting errors can derail retrieval; storing the rewritten query makes them
  visible and debuggable.
