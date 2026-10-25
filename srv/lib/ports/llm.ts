export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface TokenUsage {
  promptTokens: number
  outputTokens: number
}

export interface ChatResult {
  content: string
  /** Model that produced the answer, as reported by the provider. */
  model: string
  /** Token counts, when the provider reports them. */
  usage?: TokenUsage
}

export interface HealthStatus {
  status: 'up' | 'down'
  details: Record<string, unknown>
}

/**
 * Text generation port (ADR 0003). Implemented by the Ollama adapter now and by
 * an SAP AI Core adapter in phase 5.
 */
export interface LLMProvider {
  /** Maximum number of tokens (prompt + answer) the model accepts per request. */
  readonly contextWindow: number
  /** Tokens reserved for the generated answer. */
  readonly maxOutputTokens: number

  chat(messages: ChatMessage[]): Promise<ChatResult>
  checkHealth(): Promise<HealthStatus>
}
