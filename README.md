# SAP AI Knowledge Assistant

[![CI](https://github.com/Betheval/sap-ai-knowledge-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/Betheval/sap-ai-knowledge-assistant/actions/workflows/ci.yml)

A retrieval-augmented assistant that answers SAP Cloud Application Programming
Model (CAP) development questions from the official CAP documentation, and shows
the sources behind every answer.

> **Independent portfolio project. Not affiliated with or endorsed by SAP SE.**

Example questions:

- How do I implement an action in SAP CAP?
- How do I configure XSUAA authentication?
- How do I deploy a CAP application to Cloud Foundry?

![Chat with a cited answer](docs/images/chat.png)

<p>
  <img src="docs/images/chat-phone.png" alt="Chat on a phone" width="260" />
  <img src="docs/images/chat-error.png" alt="Error state when the model host is down" width="520" />
</p>

## Status

| Phase | Scope                                                             | Status  |
| ----- | ----------------------------------------------------------------- | ------- |
| 1     | CAP backend, CDS model, `ask` endpoint, Ollama adapter            | Done    |
| 2     | Real RAG: PostgreSQL + pgvector, ingestion, hybrid retrieval      | Done    |
| 3     | SAPUI5 / Fiori chat with sources, loading and error states        | Done    |
| 4     | Quality and production: tests, observability, Docker, CI/CD, BTP  | Planned |
| 5     | SAP AI Core instead of Ollama, behind the same internal interface | Planned |

## Architecture

```
SAPUI5 chat (TS) ──OData V4──▶ KnowledgeService (CAP, TypeScript)
                                   │  ask(conversationId?, question)
                                   ▼
                             answerQuestion (use case)
                     rewrite follow-up → retrieve → budget prompt → generate → cite
                         │                    │
                   LLMProvider            Retriever          ◀── ports
                         │                    │
                Ollama · fake · (AI Core)   pgvector + full-text (RRF) · fake  ◀── adapters
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

Open **http://localhost:4004/assistant/** for the chat UI (SAPUI5, served by
`cds-plugin-ui5` inside `cds watch`).

Development users (mocked authentication): `alice` / `alice` and `bob` / `bob`.
Each user only sees their own conversations.

### Run the production image

```bash
npm run docker:build           # or: docker build -t knowledge-assistant .
```

Create a `docker.env` file (never commit it):

```bash
CDS_ENV=standalone             # production without SAP BTP: basic authentication
OLLAMA_BASE_URL=http://<ollama-host>:11434
CDS_REQUIRES_DB_CREDENTIALS_HOST=<postgres-host>
CDS_REQUIRES_DB_CREDENTIALS_PASSWORD=<knowledge_app password>
CDS_REQUIRES_AUTH_USERS={"alice":{"password":"<choose one>","roles":["KnowledgeUser"]}}
```

```bash
docker run -p 4004:4004 --env-file docker.env knowledge-assistant
```

The image contains the compiled backend and the built UI (SAPUI5 is loaded from
the SAP CDN). The database schema is deployed beforehand with `npm run db:deploy`.
See [ADR 0018](docs/adr/0018-production-build-and-docker-image.md).

### Deploy to SAP BTP, Cloud Foundry

Requires the [cf CLI](https://github.com/cloudfoundry/cli) with the `multiapps`
plugin and a PostgreSQL instance with the `vector` extension (once per space, see
[ADR 0019](docs/adr/0019-deployment-to-sap-btp-cloud-foundry.md)):

```bash
cf create-service postgresql-db trial knowledge-db
# then enable the extension through the service API (ADR 0019)

# deploy the archive the CI built for the latest commit on main
gh run download --name "mta-archive-$(git rev-parse HEAD)" --dir mta_archives
npm run deploy:cf
```

Assign the role collection `KnowledgeUser (knowledge-assistant <space>)` to your
user in the BTP cockpit, then open the `knowledge-assistant` route. Until SAP AI
Core is integrated (phase 5), the cloud deployment answers with the fake model
and sample documents: login, UI, history and authorization are real.

### Try it from the command line

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

| Script                   | Description                                                 |
| ------------------------ | ----------------------------------------------------------- |
| `npm run watch`          | Development server: Ollama and PostgreSQL                   |
| `npm run watch:fake`     | Development server: fake LLM, SQLite                        |
| `npm run watch:trace`    | Development server with OpenTelemetry traces in the console |
| `npm run db:deploy`      | Deploy the schema to PostgreSQL                             |
| `npm run ingest`         | Ingest Capire into the knowledge base                       |
| `npm run eval:retrieval` | Retrieval metrics on the golden set                         |
| `npm run build`          | Production build (backend, UI, credentials check)           |
| `npm run docker:build`   | Production Docker image                                     |
| `npm test`               | Unit and service tests (no network required)                |
| `npm run typecheck`      | TypeScript type check                                       |
| `npm run lint`           | ESLint (TypeScript and CDS)                                 |
| `npm run format`         | Prettier                                                    |

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
