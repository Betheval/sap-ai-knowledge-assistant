import cds from '@sap/cds'
import { traced } from '../../observability/tracing'
import type { EmbeddingProvider } from '../../ports/embeddings'
import type { RetrievedChunk, Retriever, Runtime, SearchOptions } from '../../ports/retriever'
import { hybridSearch, removeStopwords, type SearchMode } from './hybrid-search'

/** Capire folders that only apply to one runtime: searching for one runtime excludes the other's. */
export const OTHER_RUNTIME_PATHS: Record<Runtime, string> = { node: 'java/%', java: 'node.js/%' }

/** Configuration from cds.requires.retriever (`pg` profile). */
interface HybridRetrieverOptions {
  candidates: number
  rrfK: number
  /**
   * Abstention threshold (ADR 0008): if no result has at least this cosine
   * similarity to the query, the documentation is considered not to cover it.
   */
  minSimilarity: number
  stopwords: string[]
  mode?: SearchMode
}

/**
 * Retriever over the PostgreSQL knowledge base: semantic + full-text search
 * fused with RRF (ADR 0010).
 */
export default class HybridRetrieverService extends cds.Service implements Retriever {
  declare options: HybridRetrieverOptions

  private db!: cds.DatabaseService
  private embeddings!: EmbeddingProvider

  async init() {
    this.db = await cds.connect.to('db')
    this.embeddings = (await cds.connect.to('embeddings')) as unknown as EmbeddingProvider
    return super.init()
  }

  async search(query: string, k: number, options: SearchOptions = {}): Promise<RetrievedChunk[]> {
    const [vector] = await traced('retriever.embed', () => this.embeddings.embed([query]), {
      'gen_ai.request.model': this.embeddings.modelId,
    })
    const hits = await traced(
      'retriever.search',
      async (span) => {
        const result = await hybridSearch(this.db, {
          vector: vector!,
          text: removeStopwords(query, this.options.stopwords),
          embeddingModel: this.embeddings.modelId,
          limit: k,
          candidates: this.options.candidates,
          rrfK: this.options.rrfK,
          mode: this.options.mode,
          excludePaths: options.runtime && OTHER_RUNTIME_PATHS[options.runtime],
        })
        span.setAttributes({
          'retrieval.hits': result.length,
          'retrieval.best_similarity': Math.max(0, ...result.map((h) => h.similarity)),
        })
        return result
      },
      { 'retrieval.runtime': options.runtime ?? 'any', 'retrieval.k': k },
    )

    if (!hits.some((h) => h.similarity >= this.options.minSimilarity)) return []
    return hits.map((h) => ({
      id: h.id,
      title: h.breadcrumb,
      url: h.url,
      content: h.content,
      score: h.score,
    }))
  }
}
