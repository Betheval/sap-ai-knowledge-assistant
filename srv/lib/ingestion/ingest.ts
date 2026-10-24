import { createHash } from 'node:crypto'
import type { EmbeddingProvider } from '../ports/embeddings'
import type { SourcePage } from './capire-source'
import { chunkPage, type PageChunk } from './chunker'
import { normalizeMarkdown } from './markdown'

/** Bump when normalization or chunking changes, so unchanged pages are re-chunked too. */
export const CHUNKER_VERSION = 1

/** Rough on-disk cost per chunk on top of its text: vector (4 bytes/dim), row and index overhead. */
const INDEX_OVERHEAD_FACTOR = 2.5

export interface StoredDocument {
  ID: string
  contentHash?: string
}

export interface DocumentInput {
  path: string
  title: string
  url: string
  sourceCommit: string
  contentHash: string
  embeddingModel: string
  chunks: (PageChunk & { embedding: number[] })[]
}

/** Persistence used by the ingestion (implemented for PostgreSQL). */
export interface KnowledgeStore {
  documents(): Promise<Map<string, StoredDocument>>
  databaseBytes(): Promise<number>
  replaceDocument(doc: DocumentInput, existingID?: string): Promise<void>
  deleteDocuments(IDs: string[]): Promise<void>
}

export interface PreparedPage {
  path: string
  url: string
  title: string
  contentHash: string
  chunks: PageChunk[]
}

export interface IngestOptions {
  sourceCommit: string
  maxChunkTokens: number
  /** Hard limit for the whole database (ADR 0011). */
  maxDatabaseBytes: number
  batchSize: number
  /** Re-embed every page, even if unchanged (e.g. after changing the embedding model). */
  reindex?: boolean
  log?: (message: string) => void
}

export interface IngestReport {
  pages: number
  ingested: number
  unchanged: number
  deleted: number
  chunks: number
  databaseBytes: number
}

/** Normalizes and chunks every page; no network or database access. */
export function preparePages(
  pages: SourcePage[],
  maxChunkTokens: number,
  embeddingModel: string,
): PreparedPage[] {
  return pages.map((page) => {
    const { title, markdown } = normalizeMarkdown(page.raw, page.loadInclude)
    const fallback = title ?? page.path.split('/').at(-1)!.replace(/\.md$/, '')
    const chunked = chunkPage(markdown, page.url, fallback, { maxTokens: maxChunkTokens })
    const contentHash = createHash('sha256')
      .update(`${CHUNKER_VERSION}\n${embeddingModel}\n${maxChunkTokens}\n${markdown}`)
      .digest('hex')
    return { path: page.path, url: page.url, title: chunked.title, contentHash, chunks: chunked.chunks }
  })
}

/**
 * Embeds and stores changed pages, and removes pages that no longer exist
 * (ADR 0005, ADR 0009). Checks the storage budget before writing anything.
 */
export async function ingestPages(
  prepared: PreparedPage[],
  deps: { store: KnowledgeStore; embeddings: EmbeddingProvider },
  options: IngestOptions,
): Promise<IngestReport> {
  const { store, embeddings } = deps
  const log = options.log ?? (() => {})

  const stored = await store.documents()
  const changed = prepared.filter((p) => options.reindex || stored.get(p.path)?.contentHash !== p.contentHash)
  const current = new Set(prepared.map((p) => p.path))
  const removed = [...stored].filter(([path]) => !current.has(path)).map(([, doc]) => doc.ID)

  const sizeBefore = await store.databaseBytes()
  const estimate = estimateBytes(changed, embeddings.dimensions)
  if (sizeBefore + estimate > options.maxDatabaseBytes) {
    throw new Error(
      `Storage budget exceeded: database ${formatBytes(sizeBefore)} + estimated ${formatBytes(estimate)} ` +
        `> limit ${formatBytes(options.maxDatabaseBytes)}. Nothing was written.`,
    )
  }
  log(
    `${changed.length} of ${prepared.length} pages to ingest, ${removed.length} to delete (estimated +${formatBytes(estimate)})`,
  )

  let chunks = 0
  for (const [i, page] of changed.entries()) {
    const vectors: number[][] = []
    for (let start = 0; start < page.chunks.length; start += options.batchSize) {
      const batch = page.chunks.slice(start, start + options.batchSize)
      vectors.push(...(await embeddings.embed(batch.map(embeddingText))))
    }

    await store.replaceDocument(
      {
        path: page.path,
        title: page.title,
        url: page.url,
        sourceCommit: options.sourceCommit,
        contentHash: page.contentHash,
        embeddingModel: embeddings.modelId,
        chunks: page.chunks.map((c, j) => ({ ...c, embedding: vectors[j]! })),
      },
      stored.get(page.path)?.ID,
    )
    chunks += page.chunks.length
    log(`[${i + 1}/${changed.length}] ${page.path}: ${page.chunks.length} chunks`)
  }

  await store.deleteDocuments(removed)

  return {
    pages: prepared.length,
    ingested: changed.length,
    unchanged: prepared.length - changed.length,
    deleted: removed.length,
    chunks,
    databaseBytes: await store.databaseBytes(),
  }
}

/** Text sent to the embedding model: heading path for context, then the content. */
export function embeddingText(chunk: PageChunk): string {
  return `${chunk.breadcrumb}\n\n${chunk.content}`
}

function estimateBytes(pages: PreparedPage[], dimensions: number): number {
  const perChunk = (c: PageChunk) =>
    (Buffer.byteLength(c.content) + Buffer.byteLength(c.breadcrumb) + 4 * dimensions) * INDEX_OVERHEAD_FACTOR
  return Math.ceil(pages.flatMap((p) => p.chunks).reduce((sum, c) => sum + perChunk(c), 0))
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}
