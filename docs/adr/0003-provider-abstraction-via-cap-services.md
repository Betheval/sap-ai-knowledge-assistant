# 3. Provider abstraction via CAP services

Date: 2026-10-18
Status: Accepted

## Context

Phase 1 uses Ollama for text generation and phase 2 adds embeddings and a vector
store. Phase 5 will replace Ollama with SAP AI Core, and the embedding and
retrieval implementations may also change. The question-answering logic, the
API contract and the UI must not change when a provider is swapped.

## Decision

The application core depends on ports defined as TypeScript interfaces in
`srv/lib/ports/`:

| Port                | Responsibility                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `LLMProvider`       | `chat(messages)` → text and model; `contextWindow`, `maxOutputTokens` for budgeting; `checkHealth()` |
| `Retriever`         | `search(query, k)` → ranked chunks with metadata, already filtered by the retriever's own threshold  |
| `EmbeddingProvider` | `embed(texts)` → vectors, plus model id and dimensions (added in phase 2)                            |

Each port is implemented by an adapter exposed as a CAP service and obtained with
`cds.connect.to('llm' | 'retriever' | 'embeddings')`. Adapters are registered as
custom service kinds, and the active one is chosen per profile in `cds.requires`:

```jsonc
"cds": {
  "requires": {
    "kinds": {
      "ollama-llm":     { "impl": "srv/lib/adapters/ollama/ollama-llm-service" },
      "fake-llm":       { "impl": "srv/lib/adapters/fake/fake-llm-service" },
      "fake-retriever": { "impl": "srv/lib/adapters/fake/fake-retriever-service" }
    },
    "llm":       { "kind": "ollama-llm", "chatModel": "qwen2.5:7b", ... },
    "retriever": { "kind": "fake-retriever", "minScore": 0.2 },
    "[fake-ai]": { "llm": { "kind": "fake-llm" } },
    "[test]":    { "llm": { "kind": "fake-llm" } }
  }
}
```

The `fake-ai` profile runs the whole app without an Ollama host
(`npm run watch:fake`). The retriever is a fake in-memory keyword search until
phase 2 adds the PostgreSQL hybrid retriever.

The use case (`answerQuestion`) only talks to the ports and receives them as
parameters. The CAP service handler that exposes `ask` stays thin: it validates
input, loads and stores the conversation, and delegates to the use case.

Source layout:

```
srv/
  knowledge-service.cds/.ts  # OData API (thin handler)
  server.ts                  # extra endpoints (/health/llm)
  lib/
    ports/                   # interfaces
    adapters/                # ollama/, fake/, (pg/ in phase 2, ai-core/ in phase 5)
    rag/                     # use case: query rewriting, prompt building, citations
    errors.ts                # provider errors mapped to HTTP status codes
```

Configuration keys of adapters must not collide with keys CAP itself interprets
in `cds.requires` (for example `model`, which CAP reads as CDS model files);
hence `chatModel`.

## Consequences

- Phase 5 means adding an `ai-core` adapter and changing configuration; no
  changes in the use case, API or UI.
- The use case is tested with plain stubs, and the service with fake adapters,
  without network access (see [ADR 0013](0013-testing-strategy-and-golden-set.md)).
- Following the CAP pattern (`cds.connect.to`) keeps the code idiomatic for SAP
  developers reviewing it.
- Slight indirection compared to calling Ollama directly.
