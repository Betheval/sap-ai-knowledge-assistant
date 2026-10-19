# 11. Persistence: SQLite first, PostgreSQL with pgvector from phase 2

Date: 2026-10-18
Status: Accepted

## Context

Phase 1 needs to persist conversations and messages but has no vectors. Phase 2
needs vector search and full-text search, which require PostgreSQL with the
pgvector extension.

`@cap-js/postgres` 3.1.2 declares `cds.Vector` and translates it to a
`VECTOR(n)` column, but it cannot write such columns through CQL: every INSERT
on the entity converts the vector value as binary (`DECODE(..., 'base64')` →
`bytea`), and fails with "column is of type vector but expression is of type
bytea" even when the vector is not set. This was verified against the target
database.

The development laptop does not host services: the Windows machine on the local
network that runs Ollama ([ADR 0004](0004-ollama-on-remote-host.md)) also hosts
the database. The database must stay below **5 GB** on that host.

## Decision

**Engines and profiles**

- **Tests and the `fake-ai` profile:** in-memory SQLite through `@cap-js/sqlite`.
  No external dependencies.
- **Development with real data (`pg` profile, `npm run watch`):** the PostgreSQL
  18 server already running on the Windows host (Docker Desktop, image
  `pgvector/pgvector:pg18`, port 5432), accessed through `@cap-js/postgres`.
  The image is the official `postgres:18` image with pgvector built in, so no
  extra installation is needed and we avoid running a second PostgreSQL on the
  inference host.
- Connection settings: database and user in `package.json` (`[pg]` profile);
  host, port and password in `.env` as `CDS_REQUIRES_DB_CREDENTIALS_*`, which CAP
  reads natively.

**Database setup**

- `infra/postgres/setup.sql` (run once as the server's superuser) creates two
  databases, `knowledge` (development) and `knowledge_test` (integration
  tests), owned by the role `knowledge_app`, and enables the `vector` extension
  in both. The application never connects as a superuser; enabling extensions is
  the only step that needs it.
- The knowledge databases share the server with other databases on the host;
  isolation relies on the dedicated role, which owns only its own databases and
  cannot create objects in the others (verified).
- Credentials live in `.env` files that are never committed. Network access to
  port 5432 should be restricted to the local subnet (Windows firewall and
  `pg_hba.conf`).

**Schema**

- All entities (`Conversations`, `Messages`, `MessageSources`, `Documents`,
  `Chunks`) are modeled in CDS and deployed by CAP (`npm run db:deploy`), with
  CAP's automatic schema evolution.
- The retrieval columns of `knowledge_Chunks` are **not** in the CDS model.
  `db/postgres/retrieval-schema.sql`, applied by `db:deploy` right after
  `cds deploy`, idempotently adds:
  - `embedding vector(1024)` with an HNSW index (`vector_cosine_ops`);
  - `search_vector tsvector`, a generated column over breadcrumb and content
    (`english` configuration), with a GIN index.
- Chunks are inserted with CQL; their embeddings are written and queried with
  parameterized SQL (`$1::vector`, `<=>`) inside the PostgreSQL adapters. The
  hybrid query needs SQL anyway: the HNSW index is only used by the `<=>`
  operator, and the full-text and RRF parts have no CQL equivalent.

**Storage budget**

- Expected size for the whole Capire corpus: about 5,000 chunks, around 100 MB
  including indexes (text ~10 MB, 1024-dim float vectors ~20 MB, indexes
  ~50 MB). The hard limit is 5 GB; ingestion checks the database size and stops
  before exceeding it.

## Consequences

- Tests and `npm run watch:fake` need nothing but Node.js.
- Two database engines exist during development; behavior specific to
  PostgreSQL is confined to its adapters and covered by integration tests.
- CAP schema evolution refuses to drop columns and never touches columns it does
  not know, so the SQL-managed columns survive later `cds deploy` runs
  (verified). Dropping a CDS element requires a manual migration.
- Part of the schema lives outside CDS. If a later `@cap-js/postgres` release
  writes `cds.Vector` correctly, the `embedding` column can move into the model
  through a new ADR.
- Development with real retrieval requires the Windows host to be on and
  reachable.
- The `pg18` image tag is not pinned to a pgvector version; upgrading the
  container can upgrade pgvector (`ALTER EXTENSION vector UPDATE` afterwards).
- CI (phase 4) does not depend on the host: it uses the same
  `pgvector/pgvector` image with the same setup scripts.
