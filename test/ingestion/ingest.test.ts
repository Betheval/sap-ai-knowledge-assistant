import type { SourcePage } from '../../srv/lib/ingestion/capire-source'
import {
  embeddingText,
  ingestPages,
  preparePages,
  type DocumentInput,
  type KnowledgeStore,
  type StoredDocument,
} from '../../srv/lib/ingestion/ingest'
import type { EmbeddingProvider } from '../../srv/lib/ports/embeddings'

function page(path: string, raw: string): SourcePage {
  return { path, url: `https://docs/${path}`, raw, loadInclude: () => undefined }
}

const PAGES = [
  page('guides/a.md', '# A\n## One\nFirst section text.\n## Two\nSecond section text.'),
  page('guides/b.md', '# B\nOnly an intro paragraph.'),
]

function fakeStore(stored: Record<string, StoredDocument> = {}, bytes = 1000) {
  const written: DocumentInput[] = []
  const deleted: string[] = []
  const store: KnowledgeStore = {
    documents: async () => new Map(Object.entries(stored)),
    databaseBytes: async () => bytes,
    replaceDocument: async (doc) => void written.push(doc),
    deleteDocuments: async (IDs) => void deleted.push(...IDs),
  }
  return { store, written, deleted }
}

function fakeEmbeddings(): EmbeddingProvider & { embed: jest.Mock } {
  return {
    modelId: 'bge-m3',
    dimensions: 3,
    embed: jest.fn(async (texts: string[]) => texts.map(() => [1, 0, 0])),
  }
}

const options = { sourceCommit: 'abc', maxChunkTokens: 800, maxDatabaseBytes: 5 * 1024 ** 3, batchSize: 2 }

describe('preparePages', () => {
  it('chunks pages and hashes content together with model and chunker settings', () => {
    const [a] = preparePages(PAGES, 800, 'bge-m3')

    expect(a!.chunks.map((c) => c.breadcrumb)).toEqual(['A › One', 'A › Two'])
    expect(a!.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(preparePages(PAGES, 800, 'other-model')[0]!.contentHash).not.toBe(a!.contentHash)
    expect(preparePages(PAGES, 400, 'bge-m3')[0]!.contentHash).not.toBe(a!.contentHash)
  })
})

describe('ingestPages', () => {
  const prepared = preparePages(PAGES, 800, 'bge-m3')

  it('embeds and stores every new page, in batches', async () => {
    const { store, written } = fakeStore()
    const embeddings = fakeEmbeddings()

    const report = await ingestPages(prepared, { store, embeddings }, options)

    expect(written.map((d) => [d.path, d.chunks.length, d.embeddingModel, d.sourceCommit])).toEqual([
      ['guides/a.md', 2, 'bge-m3', 'abc'],
      ['guides/b.md', 1, 'bge-m3', 'abc'],
    ])
    expect(embeddings.embed).toHaveBeenCalledWith(prepared[0]!.chunks.map(embeddingText))
    expect(written[0]!.chunks[0]!.embedding).toEqual([1, 0, 0])
    expect(report).toMatchObject({ pages: 2, ingested: 2, unchanged: 0, deleted: 0, chunks: 3 })
  })

  it('skips unchanged pages, replaces changed ones and deletes removed ones', async () => {
    const { store, written, deleted } = fakeStore({
      'guides/a.md': { ID: 'id-a', contentHash: prepared[0]!.contentHash },
      'guides/b.md': { ID: 'id-b', contentHash: 'outdated' },
      'guides/gone.md': { ID: 'id-gone', contentHash: 'x' },
    })
    const replace = jest.spyOn(store, 'replaceDocument')

    const report = await ingestPages(prepared, { store, embeddings: fakeEmbeddings() }, options)

    expect(written.map((d) => d.path)).toEqual(['guides/b.md'])
    expect(replace).toHaveBeenCalledWith(expect.anything(), 'id-b')
    expect(deleted).toEqual(['id-gone'])
    expect(report).toMatchObject({ ingested: 1, unchanged: 1, deleted: 1 })
  })

  it('re-embeds unchanged pages with reindex', async () => {
    const { store, written } = fakeStore({
      'guides/a.md': { ID: 'id-a', contentHash: prepared[0]!.contentHash },
    })

    await ingestPages(prepared, { store, embeddings: fakeEmbeddings() }, { ...options, reindex: true })

    expect(written.map((d) => d.path)).toEqual(['guides/a.md', 'guides/b.md'])
  })

  it('aborts before writing anything when the storage budget would be exceeded', async () => {
    const { store, written } = fakeStore({}, 5 * 1024 ** 3 - 10)
    const embeddings = fakeEmbeddings()

    await expect(ingestPages(prepared, { store, embeddings }, options)).rejects.toThrow(
      /Storage budget exceeded/,
    )
    expect(embeddings.embed).not.toHaveBeenCalled()
    expect(written).toEqual([])
  })
})
