# 19. Deployment to SAP BTP, Cloud Foundry

Date: 2026-10-25
Status: Accepted

## Context

The app has to run on SAP BTP, Cloud Foundry, with real authentication
([ADR 0012](0012-mocked-auth-now-xsuaa-later.md)), on a free SAP BTP trial
account. Two constraints shape the deployment:

- The language and embedding models run on a host in the local network
  ([ADR 0004](0004-ollama-on-remote-host.md)), which SAP BTP cannot reach. Real
  models in the cloud come with SAP AI Core in phase 5.
- The schema deployment needs the `vector` extension, which PostgreSQL on SAP BTP
  only enables through its service API, after the instance exists.

## Decision

**Multi-target application** (`mta.yaml`, built with `mbt build`):

| Module / resource       | Content                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `knowledge-srv`         | CAP service from `gen/srv`, health check on `/health`                   |
| `knowledge-db-deployer` | Task: `cds-deploy`, then the SQL-managed retrieval schema (ADR 0011)    |
| `knowledge-assistant`   | Approuter: XSUAA login, the built UI, routes `/odata` and `/health/llm` |
| `knowledge-auth`        | XSUAA (`application` plan), role `KnowledgeUser`, role collection       |
| `knowledge-db`          | PostgreSQL (`postgresql-db`, `trial` plan), an existing service         |

- **Build once, deploy that archive:** the CI job `mta` builds the archive on a
  clean runner (`npm ci`, `npm run build` with the credentials check of ADR 0018,
  then `scripts/prepare-cf.ts`, which writes a production-only `package.json` and
  lockfile for `gen/srv`, adds the retrieval schema step to the deployer and
  copies the UI into the approuter), checks the unpacked archive for credentials
  again, and publishes it as a workflow artifact for 7 days. Deployments use that
  artifact, so every deployed archive comes from a tested commit and never passed
  through a machine holding credentials. Deployment itself stays manual
  (`cf deploy`): continuous deployment would need BTP credentials in GitHub and
  brings nothing while the cloud runs the fake model on an expiring trial account.
- **Database:** created once with `cf create-service postgresql-db trial
knowledge-db`, then the `vector` extension is enabled with the service API
  (`PUT …/postgresql-db/instances/<id>/extensions/vector`). Declared in the MTA
  as an existing service, so deployments do not race the extension.
- **Authentication:** production uses XSUAA; `xs-security.json` defines the
  `KnowledgeUser` scope and role template, and the MTA creates a role collection
  that is assigned to users in the BTP cockpit.
- **Models:** until SAP AI Core, the service runs with `CDS_ENV=production,btp-demo`:
  the fake model and the sample documents. Login, UI, conversations in
  PostgreSQL, authorization and logs are real.
- **Telemetry:** `NO_TELEMETRY=true` until an exporter (SAP Cloud Logging) is set
  up ([ADR 0017](0017-observability.md)).
- **Approuter timeout:** 120 s for the service destination, since answers take
  several seconds.

## Consequences

- The deployment architecture (XSUAA, approuter, PostgreSQL with pgvector,
  schema deployer) is exercised in the cloud before phase 5; switching to real
  models is a configuration change plus SAP AI Core adapters.
- Answers in the cloud are not useful until then; this is stated in the README.
- The trial account's resources expire if not renewed; the database can be
  recreated with the commands above.
- The `vector` extension step is manual and done once per database instance.
