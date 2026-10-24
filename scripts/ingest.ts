/**
 * Ingests Capire into the knowledge base (ADR 0005, ADR 0009, ADR 0011).
 *
 *   npm run ingest -- --dry-run   chunk only, write a review report to .cache/
 *   npm run ingest                embed and store changed pages
 *   npm run ingest -- --reindex   re-embed every page
 */
import './pg-profile'
import cds from '@sap/cds'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PostgresKnowledgeStore } from '../srv/lib/adapters/postgres/knowledge-store'
import {
  fetchCapire,
  filterPublished,
  listPages,
  type CapireConfig,
} from '../srv/lib/ingestion/capire-source'
import { formatBytes, ingestPages, preparePages, type PreparedPage } from '../srv/lib/ingestion/ingest'
import type { EmbeddingProvider } from '../srv/lib/ports/embeddings'

const CACHE_DIR = path.join(__dirname, '..', '.cache')

interface IngestionConfig {
  capire: CapireConfig
  maxChunkTokens: number
  maxDatabaseBytes: number
  batchSize: number
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const dryRun = args.has('--dry-run')

  const config = cds.env.ingestion as IngestionConfig
  const embeddingModel = (cds.env.requires.embeddings as { embeddingModel: string }).embeddingModel

  console.log(`Capire ${config.capire.repo}@${config.capire.commit.slice(0, 7)}`)
  const root = await fetchCapire(config.capire, path.join(CACHE_DIR, 'capire'))
  const { published, unpublished } = await filterPublished(listPages(root, config.capire))
  if (unpublished.length) {
    console.log(
      `Skipping ${unpublished.length} pages not live on ${config.capire.baseUrl}: ${unpublished.map((p) => p.path).join(', ')}`,
    )
  }
  const prepared = preparePages(published, config.maxChunkTokens, embeddingModel)
  console.log(`${prepared.length} pages, ${prepared.reduce((n, p) => n + p.chunks.length, 0)} chunks`)

  if (dryRun) {
    const file = writeReport(
      prepared,
      config,
      unpublished.map((p) => p.path),
    )
    console.log(`Dry run: nothing embedded or stored. Review ${path.relative(process.cwd(), file)}`)
    return
  }

  // Scripts do not boot a CAP server, so load the model the generated entity types rely on
  cds.model = cds.compile.for.nodejs(await cds.load('*'))
  const db = await cds.connect.to('db')
  const embeddings = (await cds.connect.to('embeddings')) as unknown as EmbeddingProvider

  const report = await ingestPages(
    prepared,
    { store: new PostgresKnowledgeStore(db), embeddings },
    {
      sourceCommit: config.capire.commit,
      maxChunkTokens: config.maxChunkTokens,
      maxDatabaseBytes: config.maxDatabaseBytes,
      batchSize: config.batchSize,
      reindex: args.has('--reindex'),
      log: console.log,
    },
  )
  console.log(
    `Done: ${report.ingested} ingested, ${report.unchanged} unchanged, ${report.deleted} deleted, ` +
      `${report.chunks} chunks written. Database size ${formatBytes(report.databaseBytes)} ` +
      `(limit ${formatBytes(config.maxDatabaseBytes)}).`,
  )
}

/** Markdown report to review chunk quality before embedding. */
function writeReport(pages: PreparedPage[], config: IngestionConfig, unpublished: string[]): string {
  const chunks = pages.flatMap((p) => p.chunks.map((c) => ({ ...c, page: p.path })))
  const sizes = chunks.map((c) => c.tokenCount).sort((a, b) => a - b)
  const pct = (q: number) => sizes[Math.min(sizes.length - 1, Math.floor(q * sizes.length))]
  const over = chunks.filter((c) => c.tokenCount > config.maxChunkTokens)
  const empty = pages.filter((p) => p.chunks.length === 0)
  const sample = chunks.filter((_, i) => i % Math.max(1, Math.floor(chunks.length / 12)) === 0).slice(0, 12)

  const block = (c: (typeof chunks)[number]) =>
    `### ${c.breadcrumb}\n\n${c.url} · ${c.tokenCount} tokens\n\n\`\`\`\`text\n${c.content}\n\`\`\`\`\n`

  const report = [
    `# Ingestion dry run: ${config.capire.repo}@${config.capire.commit.slice(0, 7)}`,
    '',
    `- Skipped, not published: ${unpublished.length ? unpublished.join(', ') : 'none'}`,
    `- Pages: ${pages.length} (${empty.length} without chunks${empty.length ? `: ${empty.map((p) => p.path).join(', ')}` : ''})`,
    `- Chunks: ${chunks.length}`,
    `- Tokens per chunk: min ${sizes[0]}, median ${pct(0.5)}, p95 ${pct(0.95)}, max ${sizes.at(-1)}`,
    `- Total tokens: ${sizes.reduce((a, b) => a + b, 0)}`,
    `- Chunks over ${config.maxChunkTokens} tokens (single oversized blocks): ${over.length}`,
    '',
    '## Largest chunks',
    '',
    ...[...chunks]
      .sort((a, b) => b.tokenCount - a.tokenCount)
      .slice(0, 10)
      .map((c) => `- ${c.tokenCount} · ${c.page} · ${c.breadcrumb}`),
    '',
    '## Sample chunks',
    '',
    ...sample.map(block),
  ].join('\n')

  mkdirSync(CACHE_DIR, { recursive: true })
  const file = path.join(CACHE_DIR, `ingest-report-${config.capire.commit.slice(0, 7)}.md`)
  writeFileSync(file, report)
  return file
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
