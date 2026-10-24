import OllamaEmbeddingService from '../../srv/lib/adapters/ollama/ollama-embedding-service'
import { LLMUnavailableError } from '../../srv/lib/errors'

const options = {
  kind: 'ollama-embeddings',
  impl: 'srv/lib/adapters/ollama/ollama-embedding-service',
  url: 'http://ollama.test:11434',
  embeddingModel: 'bge-m3',
  dimensions: 3,
  numCtx: 8192,
  timeoutMs: 1000,
}

async function createService() {
  const service = new OllamaEmbeddingService('embeddings', undefined, options)
  await service.init()
  return service
}

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

describe('OllamaEmbeddingService', () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch')

  beforeEach(() => {
    fetchMock.mockReset()
    delete process.env.OLLAMA_BASE_URL
    delete process.env.OLLAMA_EMBEDDING_MODEL
  })

  it('embeds a batch through /api/embed without silent truncation', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        embeddings: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      }),
    )
    const service = await createService()

    const vectors = await service.embed(['a', 'b'])

    expect(vectors).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ])
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://ollama.test:11434/api/embed')
    expect(JSON.parse(init!.body as string)).toEqual({
      model: 'bge-m3',
      input: ['a', 'b'],
      truncate: false,
      options: { num_ctx: 8192 },
    })
    expect(service.modelId).toBe('bge-m3')
  })

  it('does not call the host for an empty batch', async () => {
    expect(await (await createService()).embed([])).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects vectors with unexpected dimensions or count', async () => {
    const service = await createService()

    fetchMock.mockResolvedValueOnce(jsonResponse({ embeddings: [[1, 2]] }))
    await expect(service.embed(['a'])).rejects.toBeInstanceOf(LLMUnavailableError)

    fetchMock.mockResolvedValueOnce(jsonResponse({ embeddings: [[1, 2, 3]] }))
    await expect(service.embed(['a', 'b'])).rejects.toThrow(/expected 2 of 3/)
  })
})
