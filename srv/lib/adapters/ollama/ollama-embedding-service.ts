import cds from '@sap/cds'
import { LLMUnavailableError } from '../../errors'
import type { EmbeddingProvider } from '../../ports/embeddings'
import { ollamaBaseUrl, ollamaRequest } from './ollama-client'

/** Configuration from cds.requires.embeddings; OLLAMA_* environment variables take precedence. */
interface OllamaEmbeddingOptions {
  url?: string
  embeddingModel: string
  dimensions: number
  numCtx: number
  timeoutMs: number
}

/**
 * Embedding adapter for bge-m3 on the Ollama host (ADR 0005).
 */
export default class OllamaEmbeddingService extends cds.Service implements EmbeddingProvider {
  declare options: OllamaEmbeddingOptions

  private baseUrl?: string
  private numCtx!: number
  private timeoutMs!: number
  modelId!: string
  dimensions!: number

  async init() {
    this.baseUrl = ollamaBaseUrl(this.options.url)
    this.modelId = process.env.OLLAMA_EMBEDDING_MODEL ?? this.options.embeddingModel
    this.dimensions = this.options.dimensions
    this.numCtx = this.options.numCtx
    this.timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? this.options.timeoutMs)
    return super.init()
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const { embeddings } = await ollamaRequest<{ embeddings: number[][] }>(
      this.baseUrl,
      '/api/embed',
      this.timeoutMs,
      {
        method: 'POST',
        body: JSON.stringify({
          model: this.modelId,
          input: texts,
          // Fail instead of silently embedding a truncated text
          truncate: false,
          options: { num_ctx: this.numCtx },
        }),
      },
    )

    if (embeddings.length !== texts.length || embeddings.some((v) => v.length !== this.dimensions)) {
      throw new LLMUnavailableError(
        `Ollama returned ${embeddings.length} embeddings of ${embeddings[0]?.length} dimensions, ` +
          `expected ${texts.length} of ${this.dimensions}`,
      )
    }
    return embeddings
  }
}
