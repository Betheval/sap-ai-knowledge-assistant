import { LLMTimeoutError, LLMUnavailableError } from '../../errors'

/** Base URL of the Ollama host: OLLAMA_BASE_URL, else the adapter configuration. */
export function ollamaBaseUrl(configured?: string): string | undefined {
  return (process.env.OLLAMA_BASE_URL ?? configured)?.replace(/\/+$/, '')
}

/**
 * Calls the Ollama HTTP API and maps failures to typed provider errors (ADR 0004):
 * missing host, unreachable host or HTTP errors → LLMUnavailableError, timeout → LLMTimeoutError.
 */
export async function ollamaRequest<T>(
  baseUrl: string | undefined,
  path: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<T> {
  if (!baseUrl) throw new LLMUnavailableError('The Ollama host is not configured (OLLAMA_BASE_URL)')

  try {
    const response = await fetch(baseUrl + path, {
      ...init,
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new LLMUnavailableError(`Ollama returned HTTP ${response.status}: ${detail}`)
    }
    return (await response.json()) as T
  } catch (error) {
    if (error instanceof LLMUnavailableError) throw error
    if ((error as Error).name === 'TimeoutError') {
      throw new LLMTimeoutError(`Ollama did not answer within ${timeoutMs} ms`, { cause: error })
    }
    throw new LLMUnavailableError(`The Ollama host ${baseUrl} is unreachable`, { cause: error })
  }
}
