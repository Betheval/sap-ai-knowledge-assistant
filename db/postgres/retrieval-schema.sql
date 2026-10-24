-- Retrieval columns and indexes on knowledge_Chunks (ADR 0010, ADR 0011).
-- Applied after `cds deploy` by scripts/apply-retrieval-schema.ts. Idempotent.
--
-- These columns live outside the CDS model on purpose: @cap-js/postgres cannot
-- write cds.Vector columns through CQL, and CAP schema evolution never drops
-- columns it does not know about.

-- Semantic search: bge-m3 embeddings (ADR 0005)
ALTER TABLE knowledge_Chunks ADD COLUMN IF NOT EXISTS embedding vector(1024);

-- Lexical search: computed by PostgreSQL. Matches in the heading path (weight A)
-- count more than matches in the content (weight D); measured on the golden set.
-- A generated column cannot change its expression in place, so an outdated one is dropped first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'knowledge_chunks' AND column_name = 'search_vector'
                AND generation_expression NOT LIKE '%setweight%') THEN
    ALTER TABLE knowledge_Chunks DROP COLUMN search_vector;
  END IF;
END $$;

ALTER TABLE knowledge_Chunks ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english'::regconfig, coalesce(breadcrumb, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, content), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw
  ON knowledge_Chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS knowledge_chunks_search_gin
  ON knowledge_Chunks USING gin (search_vector);
