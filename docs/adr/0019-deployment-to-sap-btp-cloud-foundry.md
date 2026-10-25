# 19. Deployment to SAP BTP, Cloud Foundry, without a model host

Date: 2026-10-25
Status: Accepted

## Context

The app has to be deployable to SAP BTP, Cloud Foundry, with real
authentication ([ADR 0012](0012-mocked-auth-now-xsuaa-later.md)), on a free
SAP BTP trial account, and every change on `main` should reach that deployment
without manual steps.

The language and embedding models run on a host in the local network
([ADR 0004](0004-ollama-on-remote-host.md)), which SAP BTP cannot reach. Two ways
to bring models to the cloud exist (SAP AI Core, or the SAP Cloud Connector in
front of the local host; see the README), but neither is part of this step:
SAP AI Core is not included in the trial, and a working assistant is
demonstrated locally. A PostgreSQL instance with pgvector was created on the
trial (the `vector` extension is enabled through the service API,
`PUT https://api-backing-services.<landscape>.data.services.cloud.sap/v1/postgresql-db/instances/<id>/extensions/vector`,
with the landscape such as `us10-001`, not the region) and removed again: without
models in the cloud it would hold no documents.

## Decision

**What runs on SAP BTP** (`mta.yaml`, profile `production,btp-no-model`):

| Module / resource     | Content                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `knowledge-srv`       | CAP service from `gen/srv`, health check on `/health`                   |
| `knowledge-assistant` | Approuter: XSUAA login, the built UI, routes `/odata` and `/health/llm` |
| `knowledge-auth`      | XSUAA (`application` plan), role `KnowledgeUser`, role collection       |

- **No database service:** the service uses an in-memory SQLite database
  (Node.js built-in driver, no native modules); its schema is created at start-up.
- **No model host:** no `OLLAMA_BASE_URL` is configured, so every question
  fails with "language model unavailable" (HTTP 503), and `/health/llm` reports
  the model as down. The UI shows both states as designed (ADR 0015). This is the
  real behavior of the app without a model, not a special mode.
- **Sample history:** each user gets three sample conversations on first access
  (`srv/lib/demo/demo-history.ts`), owned by that user, so per-user access rules
  apply unchanged.
- **Authentication:** XSUAA; `xs-security.json` defines the `KnowledgeUser`
  scope and role template, and the MTA creates the role collection
  `KnowledgeUser (knowledge-assistant <space>)`, assigned to users in the cockpit.
- **Telemetry:** `NO_TELEMETRY=true` until an exporter is set up (ADR 0017).

**Build once, deploy that archive, on every commit to `main`:**

- The CI job `mta` builds the archive on a clean runner (`npm ci`,
  `npm run build` with the credentials check of ADR 0018, `scripts/prepare-cf.ts`
  for a production-only `package.json`/lockfile and the UI in the approuter),
  checks the unpacked archive for credentials again, and publishes it as an
  artifact for 7 days.
- The CI job `deploy` runs after all other jobs on pushes to `main`, downloads
  that artifact and runs `cf deploy`. It uses the GitHub environment `btp`
  (secrets `CF_USERNAME`, `CF_PASSWORD`; variables `CF_API`, `CF_ORG`, `CF_SPACE`,
  `BTP_APP_URL`) and is enabled with the repository variable `BTP_DEPLOY=true`.
  Deployments never run in parallel and are never cancelled midway.

## Consequences

- A UI or backend change on `main` is tested, packaged and deployed to SAP BTP
  without manual steps; every deployed archive comes from a tested commit and
  never passed through a machine holding credentials.
- The cloud deployment demonstrates login, UI, authorization, packaging and CD;
  answering questions is demonstrated locally with the Windows host.
- BTP credentials are stored as GitHub secrets of the `btp` environment; a
  dedicated technical user with only the Space Developer role is preferable to a
  personal account.
- Conversations in the cloud are lost on restart (in-memory database); only the
  sample history is recreated.
- Adding models later means adding a database service and the deployer module
  back (the build already prepares `gen/pg` with the retrieval schema step) and
  either SAP AI Core adapters (ADR 0003) or the Cloud Connector.
- Trial resources expire if not renewed; the CD job then fails until they are.
