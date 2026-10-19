import cds from '@sap/cds'
import type { ChatMessage, ChatResult, HealthStatus, LLMProvider } from '../../ports/llm'
import { CONTEXT_HEADER } from '../../rag/prompts'

/**
 * Deterministic LLM for tests and for running the app without an Ollama host
 * (profile `fake-ai`). It answers by pointing at the first excerpt it receives.
 */
export default class FakeLLMService extends cds.Service implements LLMProvider {
  contextWindow = 16384
  maxOutputTokens = 1024

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    const last = messages.at(-1)?.content ?? ''

    // Rewrite step: return the follow-up question unchanged
    if (!last.startsWith(CONTEXT_HEADER)) {
      return { content: last.split('Follow-up question:').pop()!.trim(), model: 'fake-llm' }
    }

    const firstTitle = /^\[1\] (.+)$/m.exec(last)?.[1] ?? 'unknown'
    return {
      content: `This is a fake answer for local development. The most relevant excerpt is "${firstTitle}" [1].`,
      model: 'fake-llm',
    }
  }

  async checkHealth(): Promise<HealthStatus> {
    return { status: 'up', details: { kind: 'fake-llm' } }
  }
}
