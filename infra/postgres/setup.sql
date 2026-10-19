-- One-time setup of the knowledge base on an existing PostgreSQL server (ADR 0011).
-- Requires pgvector to be installed on the server. Run as the postgres superuser:
--
--   psql -U postgres -v app_password=<password> -f setup.sql
--
-- Creates the application role and two databases, and enables pgvector in both.
-- The app connects as knowledge_app, never as postgres.

\set ON_ERROR_STOP on

CREATE ROLE knowledge_app LOGIN PASSWORD :'app_password';
CREATE DATABASE knowledge OWNER knowledge_app;
CREATE DATABASE knowledge_test OWNER knowledge_app;

-- CREATE EXTENSION needs superuser rights, so it runs here and not in app migrations
\connect knowledge
CREATE EXTENSION IF NOT EXISTS vector;

\connect knowledge_test
CREATE EXTENSION IF NOT EXISTS vector;

SELECT current_database() AS database, extversion AS pgvector
FROM pg_extension
WHERE extname = 'vector';
