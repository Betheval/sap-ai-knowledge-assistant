import cds from '@sap/cds'
import type { RetrievedChunk, Retriever } from '../../ports/retriever'
import { SAMPLE_CHUNKS } from './sample-chunks'

// "cap" appears in every chunk, so it carries no signal here
const STOPWORDS = new Set(
  'the and for with how what when where which who why does can into from that this are use using about its cap'.split(
    ' ',
  ),
)

/** Lowercase words without stopwords, with a crude suffix stemming ("implementing" → "implement"). */
function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map((t) => t.replace(/(ing|ed|s)$/, ''))
}

/**
 * In-memory keyword retriever over a handful of sample chunks. Stands in for
 * the PostgreSQL hybrid retriever until phase 2.
 */
export default class FakeRetrieverService extends cds.Service implements Retriever {
  declare options: { minScore?: number }

  async search(query: string, k: number): Promise<RetrievedChunk[]> {
    const queryTerms = [...new Set(terms(query))]
    if (queryTerms.length === 0) return []
    const minScore = this.options.minScore ?? 0.2

    return SAMPLE_CHUNKS.map((chunk) => {
      const chunkTerms = new Set(terms(`${chunk.title} ${chunk.content}`))
      const hits = queryTerms.filter((t) => chunkTerms.has(t)).length
      return { ...chunk, score: hits / queryTerms.length }
    })
      .filter((chunk) => chunk.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
  }
}
