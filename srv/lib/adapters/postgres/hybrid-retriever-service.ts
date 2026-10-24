import cds from '@sap/cds'
import type { EmbeddingProvider } from '../../ports/embeddings'
import type { RetrievedChunk, Retriever } from '../../ports/retriever'
import { hybridSearch, removeStopwords, type SearchMode } from './hybrid-search'

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

  async search(query: string, k: number): Promise<RetrievedChunk[]> {
    const [vector] = await this.embeddings.embed([query])
    const hits = await hybridSearch(this.db, {
      vector: vector!,
      text: removeStopwords(query, this.options.stopwords),
      embeddingModel: this.embeddings.modelId,
      limit: k,
      candidates: this.options.candidates,
      rrfK: this.options.rrfK,
      mode: this.options.mode,
    })

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
