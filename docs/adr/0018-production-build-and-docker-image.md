# 18. Production build and Docker image

Date: 2026-10-25
Status: Accepted

## Context

Development runs TypeScript through `tsx` and serves the UI through
`cds-plugin-ui5`, which downloads SAPUI5 into a local cache. Neither belongs in
production. The app also needs a runnable artifact outside SAP BTP, and the
production configuration had gaps: the retriever fell back to the fake one,
the database name and user were only set for development, and authentication
expected XSUAA.

While building, a real issue appeared: `cds build` writes the resolved database
configuration into `gen/pg/package.json`, **including credentials taken from the
environment of whoever runs the build**. A build on the development machine
produced an artifact containing the database password.

## Decision

**Build** (`npm run build`)

- `cds build --production` compiles TypeScript to JavaScript into `gen/srv`. The
  build uses `tsconfig.json`, which contains production sources only; tests and
  Jest use `tsconfig.test.json`.
- The UI is built with `ui5 build` (app only, about 180 KB, TypeScript sources
  omitted). Production loads **SAPUI5 1.148.13 from the versioned SAP CDN**
  (`ui5.sap.com`); `use-cdn.mjs` rewrites the bootstrap of `index.html`. A
  self-contained build was evaluated: with all libraries it is 155 MB, without
  them it lacks themes and texts.
- `scripts/check-build-secrets.ts` fails the build when the output contains
  credentials: secret-like keys inside any `credentials` object, or the value of
  any secret-like environment variable.

**Configuration**

- `[production]` uses the hybrid PostgreSQL retriever and defaults to database
  `knowledge` and user `knowledge_app`; host, port and password come from the
  environment (`CDS_REQUIRES_DB_CREDENTIALS_*`) or a service binding.
- Production authentication stays `jwt` (XSUAA, phase 4 step 4). The
  `standalone` profile, for running the image outside BTP, uses basic
  authentication with users from `CDS_REQUIRES_AUTH_USERS`; no user or password
  is part of the code or the image.
- `@cap-js/sqlite` is a development dependency only.

**Docker image** (`Dockerfile`)

- Multi-stage on `node:22-bookworm-slim`. The build stage runs `npm run build`
  steps including the credentials check; it never sees local secrets, because
  `.dockerignore` excludes `.env` files.
- The runtime stage installs production dependencies only, copies `gen/srv` and
  the built UI (served statically by CAP at `/assistant/`), runs as the
  unprivileged `node` user, and has a health check on `/health`.
- `NO_TELEMETRY=true` by default until an exporter is configured
  ([ADR 0017](0017-observability.md)).
- CI builds the image, starts it against its PostgreSQL service container and
  checks health, the UI, the CDN bootstrap and authentication.

## Consequences

- One artifact runs anywhere: `docker run` with database, model host and users
  as environment variables. Verified end to end against the real Ollama and
  PostgreSQL hosts.
- Builds must happen in a clean environment (Docker, CI). A local
  `npm run build` in a shell that has database credentials is rejected by the
  check instead of producing a leaking artifact.
- The browser needs access to `ui5.sap.com`; a Content Security Policy must
  allow it.
- The image is about 460 MB, mostly Node.js and the base system. Some design-time
  peer dependencies of `@sap/cds` (ESLint, tar, ~7 MB) are installed because npm
  installs peer dependencies; omitting them was not effective with the lockfile.
- The PostgreSQL deployer in `gen/pg` does not yet apply the SQL-managed
  retrieval columns ([ADR 0011](0011-persistence-sqlite-then-postgres.md)); the
  schema is deployed with `npm run db:deploy`. Deployment to BTP addresses this.
