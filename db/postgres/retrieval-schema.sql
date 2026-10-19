-- Retrieval columns and indexes on knowledge_Chunks (ADR 0010, ADR 0011).
-- Applied after `cds deploy` by scripts/apply-retrieval-schema.ts. Idempotent.
--
-- These columns live outside the CDS model on purpose: @cap-js/postgres cannot
-- write cds.Vector columns through CQL, and CAP schema evolution never drops
-- columns it does not know about.

-- Semantic search: bge-m3 embeddings (ADR 0005)
ALTER TABLE knowledge_Chunks ADD COLUMN IF NOT EXISTS embedding vector(1024);

-- Lexical search: computed by PostgreSQL from the heading path and the content
ALTER TABLE knowledge_Chunks ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english'::regconfig, coalesce(breadcrumb, '') || ' ' || content)
  ) STORED;

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw
  ON knowledge_Chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS knowledge_chunks_search_gin
  ON knowledge_Chunks USING gin (search_vector);
