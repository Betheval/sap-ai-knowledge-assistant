# 6. OData V4 API with an `ask` action

Date: 2026-10-18
Status: Accepted

## Context

The frontend (phase 3) will be SAPUI5/Fiori, which consumes OData V4 natively.
The UI needs to send questions, read conversation history and display the
sources behind each answer. Sources must be part of the contract from phase 1 so
the frontend is not reworked when real retrieval arrives in phase 2.

## Decision

We will expose a CAP service over OData V4 with:

- An unbound action `ask(conversationId: UUID?, question: String)`.
  If `conversationId` is empty, a new conversation is created.
- The action returns:

  ```
  AskResult {
    conversationId : UUID
    messageId      : UUID
    answer         : String
    sources        : many Source { title, url, snippet, score, cited: Boolean }
    model          : String
    latencyMs      : Integer
  }
  ```

- Read-only projections `Conversations` and `Messages` (with their sources) for
  the history view.
- All entities use the `cuid` and `managed` aspects from `@sap/cds/common`.

Each assistant `Message` also stores the rewritten standalone query, the model
used and the latency, for debugging and observability.

## Consequences

- SAPUI5 can bind directly to the service with an OData V4 model.
- The response shape is stable across phases; in phase 1 `sources` may come
  from a small fake retriever.
- Responses are not streamed. CAP actions do not stream naturally; streaming
  may be added in phase 3 through a dedicated SSE endpoint if latency requires it.
