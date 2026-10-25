# 16. Continuous integration with GitHub Actions

Date: 2026-10-25
Status: Accepted

## Context

The project has unit, service, UI and PostgreSQL integration tests
([ADR 0013](0013-testing-strategy-and-golden-set.md)), plus lint, formatting and
type checks for backend and UI. So far they only ran on the development laptop,
and the integration tests depend on the database host on the local network
([ADR 0011](0011-persistence-sqlite-then-postgres.md)).

## Decision

- A GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and
  pull request to `main`: install with `npm ci`, lint, format check, type check
  of backend and UI, and the whole Jest suite.
- It runs on the two supported Node.js lines, **22 and 24** (`engines: >=22`).
- PostgreSQL integration tests run against a **`pgvector/pgvector:0.8.7-pg18`
  service container**, prepared with the same `infra/postgres/setup.sql` as the
  real host. CI never depends on the local network.
- The integration tests skip themselves when no database is configured, so that
  `npm test` works anywhere. In CI a dedicated step fails the build if they did
  not all run, so a broken database setup cannot pass silently.
- Retrieval evaluation (`npm run eval:retrieval`) needs the embedding model and
  the ingested corpus; it stays a manual step before retrieval changes are merged.
- Actions are pinned to major versions (`actions/checkout@v7`,
  `actions/setup-node@v7`); the workflow only gets read access to the repository.

## Consequences

- Every change on `main` is verified the same way, and the README shows the
  build status.
- Pull requests that break tests or types are visible before merging.
- Retrieval quality is not guarded automatically; a regression would only show
  up in the manual evaluation against the saved baseline.
