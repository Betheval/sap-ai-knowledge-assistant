import cds from '@sap/cds'
import { traced } from '../../observability/tracing'
import type { ChatMessage, ChatResult, HealthStatus, LLMProvider } from '../../ports/llm'
import { ollamaBaseUrl, ollamaRequest } from './ollama-client'

const LOG = cds.log('ollama')
const HEALTH_TIMEOUT_MS = 5000

/** Configuration from cds.requires.llm; OLLAMA_* environment variables take precedence. */
interface OllamaOptions {
  url?: string
  chatModel: string
  numCtx: number
  maxOutputTokens: number
  temperature: number
  timeoutMs: number
}

interface OllamaChatResponse {
  model: string
  message: { role: string; content: string }
  prompt_eval_count?: number
  eval_count?: number
  /** Nanoseconds spent loading the model into memory before answering. */
  load_duration?: number
}

interface OllamaModel {
  name: string
  model: string
  size?: number
  size_vram?: number
}

/**
 * LLM adapter for an Ollama host on the local network (ADR 0004).
 */
export default class OllamaLLMService extends cds.Service implements LLMProvider {
  declare options: OllamaOptions

  private baseUrl?: string
  private chatModel!: string
  private timeoutMs!: number
  private temperature!: number
  contextWindow!: number
  maxOutputTokens!: number

  async init() {
    const env = process.env
    this.baseUrl = ollamaBaseUrl(this.options.url)
    this.chatModel = env.OLLAMA_CHAT_MODEL ?? this.options.chatModel
    this.contextWindow = Number(env.OLLAMA_NUM_CTX ?? this.options.numCtx)
    this.timeoutMs = Number(env.OLLAMA_TIMEOUT_MS ?? this.options.timeoutMs)
    this.maxOutputTokens = this.options.maxOutputTokens
    this.temperature = this.options.temperature

    if (!this.baseUrl) LOG.warn('OLLAMA_BASE_URL is not set; questions will fail until it is configured.')
    return super.init()
  }

  chat(messages: ChatMessage[]): Promise<ChatResult> {
    return traced('llm.chat', async (span) => {
      const data = await this.request<OllamaChatResponse>('/api/chat', this.timeoutMs, {
        method: 'POST',
        body: JSON.stringify({
          model: this.chatModel,
          messages,
          stream: false,
          options: {
            // Ollama's default context is far smaller than the model's and truncates silently
            num_ctx: this.contextWindow,
            num_predict: this.maxOutputTokens,
            temperature: this.temperature,
          },
        }),
      })

      // Ollama reports how many prompt tokens it processed. Close to the limit means
      // it most likely dropped part of the prompt to make it fit.
      const promptLimit = this.contextWindow - this.maxOutputTokens
      if (data.prompt_eval_count !== undefined && data.prompt_eval_count >= promptLimit) {
        LOG.warn(`Prompt likely truncated: ${data.prompt_eval_count} tokens processed, limit ${promptLimit}`)
      }

      // The first request after the model was unloaded pays for loading it into the GPU
      const loadMs = Math.round((data.load_duration ?? 0) / 1e6)
      if (loadMs >= 1000) LOG.info(`Model ${data.model} was loaded in ${loadMs} ms before answering`)

      const usage =
        data.prompt_eval_count !== undefined && data.eval_count !== undefined
          ? { promptTokens: data.prompt_eval_count, outputTokens: data.eval_count }
          : undefined
      span.setAttributes({
        'gen_ai.request.model': this.chatModel,
        'gen_ai.response.model': data.model,
        ...(usage && {
          'gen_ai.usage.input_tokens': usage.promptTokens,
          'gen_ai.usage.output_tokens': usage.outputTokens,
        }),
        'llm.model_load_ms': loadMs,
      })
      return { content: data.message.content, model: data.model, usage }
    })
  }

  async checkHealth(): Promise<HealthStatus> {
    const details: Record<string, unknown> = {
      url: this.baseUrl,
      model: this.chatModel,
      numCtx: this.contextWindow,
    }
    try {
      const [tags, ps] = await Promise.all([
        this.request<{ models: OllamaModel[] }>('/api/tags', HEALTH_TIMEOUT_MS),
        this.request<{ models: OllamaModel[] }>('/api/ps', HEALTH_TIMEOUT_MS),
      ])
      const matches = (m: OllamaModel) => m.name === this.chatModel || m.model === this.chatModel
      const loaded = ps.models.find(matches)

      details.pulled = tags.models.some(matches)
      details.loaded = Boolean(loaded)
      // Only known once the model is loaded; partial GPU offload multiplies latency
      details.fullyOnGpu = loaded ? (loaded.size_vram ?? 0) >= (loaded.size ?? 0) : null

      const up = details.pulled === true && details.fullyOnGpu !== false
      return { status: up ? 'up' : 'down', details }
    } catch (error) {
      return { status: 'down', details: { ...details, error: (error as Error).message } }
    }
  }

  private request<T>(path: string, timeoutMs: number, init?: RequestInit): Promise<T> {
    return ollamaRequest<T>(this.baseUrl, path, timeoutMs, init)
  }
}
