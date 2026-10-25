import cds from '@sap/cds'
import OllamaLLMService from '../../srv/lib/adapters/ollama/ollama-llm-service'
import { LLMTimeoutError, LLMUnavailableError } from '../../srv/lib/errors'

const options = {
  kind: 'ollama-llm',
  impl: 'srv/lib/adapters/ollama/ollama-llm-service',
  url: 'http://ollama.test:11434/',
  chatModel: 'qwen2.5:7b',
  numCtx: 16384,
  maxOutputTokens: 1024,
  temperature: 0.2,
  timeoutMs: 1000,
}

async function createService(overrides: Partial<typeof options> = {}) {
  const service = new OllamaLLMService('llm', undefined, { ...options, ...overrides })
  await service.init()
  return service
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('OllamaLLMService', () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch')

  beforeEach(() => {
    fetchMock.mockReset()
    delete process.env.OLLAMA_BASE_URL
    delete process.env.OLLAMA_CHAT_MODEL
    delete process.env.OLLAMA_NUM_CTX
  })

  describe('chat', () => {
    it('sends the model, messages and context options to /api/chat', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ model: 'qwen2.5:7b', message: { content: 'Hi' } }))
      const service = await createService()

      const result = await service.chat([{ role: 'user', content: 'Hello' }])

      expect(result).toEqual({ content: 'Hi', model: 'qwen2.5:7b' })
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe('http://ollama.test:11434/api/chat')
      expect(JSON.parse(init!.body as string)).toEqual({
        model: 'qwen2.5:7b',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
        options: { num_ctx: 16384, num_predict: 1024, temperature: 0.2 },
      })
    })

    it('reports token usage and logs when the model had to be loaded first', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          model: 'qwen2.5:7b',
          message: { content: 'Hi' },
          prompt_eval_count: 812,
          eval_count: 37,
          load_duration: 4_200_000_000,
        }),
      )
      const service = await createService()
      const info = jest.spyOn(cds.log('ollama'), 'info').mockImplementation(() => undefined as never)

      const result = await service.chat([{ role: 'user', content: 'Hello' }])

      expect(result.usage).toEqual({ promptTokens: 812, outputTokens: 37 })
      expect(info).toHaveBeenCalledWith('Model qwen2.5:7b was loaded in 4200 ms before answering')
      info.mockRestore()
    })

    it('lets environment variables override the configuration', async () => {
      process.env.OLLAMA_BASE_URL = 'http://other:11434'
      process.env.OLLAMA_CHAT_MODEL = 'mistral-nemo:12b'
      process.env.OLLAMA_NUM_CTX = '8192'
      fetchMock.mockResolvedValue(jsonResponse({ model: 'mistral-nemo:12b', message: { content: '' } }))
      const service = await createService()

      await service.chat([])

      const [url, init] = fetchMock.mock.calls[0]!
      const body = JSON.parse(init!.body as string)
      expect(url).toBe('http://other:11434/api/chat')
      expect(body.model).toBe('mistral-nemo:12b')
      expect(body.options.num_ctx).toBe(8192)
      expect(service.contextWindow).toBe(8192)
    })

    it('fails with LLMUnavailableError when no host is configured', async () => {
      const service = await createService({ url: undefined })

      await expect(service.chat([])).rejects.toBeInstanceOf(LLMUnavailableError)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('maps network errors to LLMUnavailableError (HTTP 503)', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'))
      const service = await createService()

      const error = await service.chat([]).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(LLMUnavailableError)
      expect((error as LLMUnavailableError).status).toBe(503)
    })

    it('maps timeouts to LLMTimeoutError (HTTP 504)', async () => {
      fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))
      const service = await createService()

      const error = await service.chat([]).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(LLMTimeoutError)
      expect((error as LLMTimeoutError).status).toBe(504)
    })

    it('maps error responses, e.g. a model that is not pulled, to LLMUnavailableError', async () => {
      fetchMock.mockResolvedValue(new Response('model "qwen2.5:7b" not found', { status: 404 }))
      const service = await createService()

      await expect(service.chat([])).rejects.toThrow(/HTTP 404: model "qwen2.5:7b" not found/)
    })
  })

  describe('checkHealth', () => {
    function mockHost(ps: unknown[], tags: unknown[] = [{ name: 'qwen2.5:7b', model: 'qwen2.5:7b' }]) {
      fetchMock.mockImplementation(async (url) =>
        String(url).endsWith('/api/tags') ? jsonResponse({ models: tags }) : jsonResponse({ models: ps }),
      )
    }

    it('is up when the model is pulled and fully on the GPU', async () => {
      mockHost([{ name: 'qwen2.5:7b', model: 'qwen2.5:7b', size: 100, size_vram: 100 }])
      const health = await (await createService()).checkHealth()

      expect(health.status).toBe('up')
      expect(health.details).toMatchObject({ pulled: true, loaded: true, fullyOnGpu: true })
    })

    it('is up when the model is pulled but not loaded yet', async () => {
      mockHost([])
      const health = await (await createService()).checkHealth()

      expect(health.status).toBe('up')
      expect(health.details).toMatchObject({ pulled: true, loaded: false, fullyOnGpu: null })
    })

    it('is down when the model is partially offloaded to the CPU', async () => {
      mockHost([{ name: 'qwen2.5:7b', model: 'qwen2.5:7b', size: 100, size_vram: 80 }])
      const health = await (await createService()).checkHealth()

      expect(health.status).toBe('down')
      expect(health.details.fullyOnGpu).toBe(false)
    })

    it('is down when the model is not pulled', async () => {
      mockHost([], [{ name: 'bge-m3:latest', model: 'bge-m3:latest' }])
      const health = await (await createService()).checkHealth()

      expect(health.status).toBe('down')
      expect(health.details.pulled).toBe(false)
    })

    it('is down when the host is unreachable', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'))
      const health = await (await createService()).checkHealth()

      expect(health.status).toBe('down')
      expect(health.details.error).toMatch(/unreachable/)
    })
  })
})
