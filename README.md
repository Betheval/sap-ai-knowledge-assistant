# SAP AI Knowledge Assistant

A retrieval-augmented assistant that answers SAP Cloud Application Programming
Model (CAP) development questions from the official CAP documentation, and shows
the sources behind every answer.

> **Independent portfolio project. Not affiliated with or endorsed by SAP SE.**

Example questions:

- How do I implement an action in SAP CAP?
- How do I configure XSUAA authentication?
- How do I deploy a CAP application to Cloud Foundry?

## Status

| Phase | Scope                                                             | Status      |
| ----- | ----------------------------------------------------------------- | ----------- |
| 1     | CAP backend, CDS model, `ask` endpoint, Ollama adapter            | Done        |
| 2     | Real RAG: PostgreSQL + pgvector, ingestion, hybrid retrieval      | In progress |
| 3     | SAPUI5 / Fiori chat with sources, loading and error states        | Planned     |
| 4     | Quality and production: tests, observability, Docker, CI/CD, BTP  | Planned     |
| 5     | SAP AI Core instead of Ollama, behind the same internal interface | Planned     |

## Architecture

```
SAPUI5 (phase 3) ──OData V4──▶ KnowledgeService (CAP, TypeScript)
                                   │  ask(conversationId?, question)
                                   ▼
                             answerQuestion (use case)
                     rewrite follow-up → retrieve → budget prompt → generate → cite
                         │                    │
                   LLMProvider            Retriever          ◀── ports
                         │                    │
                Ollama · fake · (AI Core)   fake · (pgvector + FTS)  ◀── adapters
```

The use case only depends on ports; adapters are CAP services selected by
configuration, so providers can be swapped without touching the API or the UI.
Every significant decision is recorded in [`docs/adr/`](docs/adr/README.md).

## Getting started

Requirements: Node.js 22 or later.

```bash
npm install
npm run watch:fake      # fake model, in-memory SQLite: no other services needed
```

For the real setup you need, on a machine you can reach:

- [Ollama](https://ollama.com) with `qwen2.5:7b` and `bge-m3`
- PostgreSQL with pgvector (for example the `pgvector/pgvector:pg18` image),
  prepared once with `psql -U <superuser> -v app_password=<password> -f infra/postgres/setup.sql`

```bash
cp .env.example .env    # Ollama URL, database host and password
npm run db:deploy       # CDS schema + retrieval columns and indexes
npm run ingest          # download Capire, chunk, embed and store (add -- --dry-run to review first)
npm run watch
```

Development users (mocked authentication): `alice` / `alice` and `bob` / `bob`.
Each user only sees their own conversations.

### Try it

```bash
curl -u alice:alice -X POST http://localhost:4004/odata/v4/knowledge/ask \
  -H 'content-type: application/json' \
  -d '{"question":"How do I implement an action in CAP?"}'
```

Pass the returned `conversationId` to ask follow-up questions. History is
available at `/odata/v4/knowledge/Conversations?$expand=messages($expand=sources)`.

| Endpoint              | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `/odata/v4/knowledge` | OData V4 service: `ask` action, conversation history   |
| `/health`             | Liveness of the application                            |
| `/health/llm`         | Model host reachable, model pulled, running on the GPU |

## Scripts

| Script                   | Description                                  |
| ------------------------ | -------------------------------------------- |
| `npm run watch`          | Development server: Ollama and PostgreSQL    |
| `npm run watch:fake`     | Development server: fake LLM, SQLite         |
| `npm run db:deploy`      | Deploy the schema to PostgreSQL              |
| `npm run ingest`         | Ingest Capire into the knowledge base        |
| `npm run eval:retrieval` | Retrieval metrics on the golden set          |
| `npm test`               | Unit and service tests (no network required) |
| `npm run typecheck`      | TypeScript type check                        |
| `npm run lint`           | ESLint (TypeScript and CDS)                  |
| `npm run format`         | Prettier                                     |

## Documentation corpus and attribution

Answers are grounded in [Capire](https://cap.cloud.sap/docs/), the CAP
documentation, whose sources are published at
[github.com/cap-js/docs](https://github.com/cap-js/docs) under the
[Apache License 2.0](https://github.com/cap-js/docs/blob/main/LICENSE),
© SAP SE or an SAP affiliate company and cap-js/docs contributors. The
documentation is not copied into this repository; every answer links to the
original pages. See [ADR 0009](docs/adr/0009-capire-as-corpus.md).

SAP and other SAP products mentioned are trademarks or registered trademarks of
SAP SE in Germany and other countries.

## License

[Apache License 2.0](LICENSE)
