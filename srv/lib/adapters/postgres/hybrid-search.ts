import type cds from '@sap/cds'

/**
 * Hybrid retrieval over knowledge_Chunks (ADR 0010): pgvector cosine distance
 * and PostgreSQL full-text search, fused with Reciprocal Rank Fusion.
 */

export type SearchMode = 'hybrid' | 'semantic' | 'lexical'

export interface HybridSearchParams {
  vector: number[]
  /** Query text for full-text search; words are OR-ed ("any of them"). */
  text: string
  embeddingModel: string
  limit: number
  /** Candidates taken from each search before fusion. */
  candidates: number
  /** RRF constant: score = Σ 1 / (rrfK + rank). */
  rrfK: number
  mode?: SearchMode
}

export interface HybridHit {
  id: string
  breadcrumb: string
  url: string
  content: string
  /** Fused RRF score; only comparable within one query. */
  score: number
  /** Cosine similarity to the query, independent of the mode. */
  similarity: number
  semanticRank: number | null
  lexicalRank: number | null
}

// Each candidate list is limited before ranking, so the HNSW and GIN indexes can be used
const SQL = `
WITH sem AS (
  SELECT ID, row_number() OVER (ORDER BY distance) AS rank FROM (
    SELECT ID, embedding <=> $1::vector AS distance
      FROM knowledge_Chunks
     WHERE $7 <> 'lexical' AND embeddingModel = $2
     ORDER BY embedding <=> $1::vector
     LIMIT $4) s
),
lex AS (
  SELECT ID, row_number() OVER (ORDER BY relevance DESC) AS rank FROM (
    SELECT c.ID, ts_rank(c.search_vector, q) AS relevance
      FROM knowledge_Chunks c,
           to_tsquery('english', replace(plainto_tsquery('english', $3)::text, '&', '|')) q
     WHERE $7 <> 'semantic' AND c.embeddingModel = $2 AND c.search_vector @@ q
     ORDER BY relevance DESC
     LIMIT $4) l
),
fused AS (
  SELECT coalesce(sem.ID, lex.ID) AS ID, sem.rank AS semantic_rank, lex.rank AS lexical_rank,
         coalesce(1.0 / ($5 + sem.rank), 0) + coalesce(1.0 / ($5 + lex.rank), 0) AS score
    FROM sem FULL JOIN lex ON sem.ID = lex.ID
)
SELECT f.ID AS id, c.breadcrumb, c.url, c.content, f.score, f.semantic_rank, f.lexical_rank,
       1 - (c.embedding <=> $1::vector) AS similarity
  FROM fused f JOIN knowledge_Chunks c ON c.ID = f.ID
 ORDER BY f.score DESC, similarity DESC
 LIMIT $6`

interface Row {
  id: string
  breadcrumb: string
  url: string
  content: string
  score: string | number
  similarity: string | number
  semantic_rank: string | number | null
  lexical_rank: string | number | null
}

export async function hybridSearch(
  db: cds.DatabaseService,
  params: HybridSearchParams,
): Promise<HybridHit[]> {
  const rows: Row[] = await db.run(SQL, [
    `[${params.vector.join(',')}]`,
    params.embeddingModel,
    params.text,
    params.candidates,
    params.rrfK,
    params.limit,
    params.mode ?? 'hybrid',
  ])
  const rank = (r: Row['semantic_rank']) => (r === null ? null : Number(r))
  return rows.map((r) => ({
    id: r.id,
    breadcrumb: r.breadcrumb,
    url: r.url,
    content: r.content,
    score: Number(r.score),
    similarity: Number(r.similarity),
    semanticRank: rank(r.semantic_rank),
    lexicalRank: rank(r.lexical_rank),
  }))
}

/** Removes corpus-wide words (e.g. "CAP" in the CAP documentation) that carry no signal for full-text search. */
export function removeStopwords(text: string, stopwords: string[]): string {
  if (stopwords.length === 0) return text
  const pattern = new RegExp(
    `\\b(${stopwords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
    'gi',
  )
  return text.replace(pattern, ' ').replace(/\s+/g, ' ').trim()
}
