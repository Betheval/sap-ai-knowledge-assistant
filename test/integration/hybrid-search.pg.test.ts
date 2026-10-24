/**
 * Integration test against the PostgreSQL `knowledge_test` database (ADR 0013).
 * Uses synthetic vectors, so no embedding model is needed. Skipped when no
 * database is configured (CDS_REQUIRES_DB_CREDENTIALS_* in .env).
 */
import cds from '@sap/cds'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { hybridSearch, removeStopwords } from '../../srv/lib/adapters/postgres/hybrid-search'
import { PostgresKnowledgeStore } from '../../srv/lib/adapters/postgres/knowledge-store'
import { applyRetrievalSchema } from '../../srv/lib/adapters/postgres/retrieval-schema'
import type { DocumentInput } from '../../srv/lib/ingestion/ingest'

const envFile = path.join(__dirname, '..', '..', '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)
const env = process.env
const configured = Boolean(env.CDS_REQUIRES_DB_CREDENTIALS_HOST && env.CDS_REQUIRES_DB_CREDENTIALS_PASSWORD)

const DIMS = 1024
const unit = (...dims: number[]) => Array.from({ length: DIMS }, (_, i) => (dims.includes(i) ? 1 : 0))

function doc(
  path: string,
  model: string,
  chunks: { breadcrumb: string; content: string; embedding: number[] }[],
): DocumentInput {
  return {
    path,
    title: path,
    url: `https://docs/${path}`,
    sourceCommit: 'test',
    contentHash: 'hash',
    embeddingModel: model,
    chunks: chunks.map((c, position) => ({
      ...c,
      position,
      url: `https://docs/${path}#${position}`,
      tokenCount: 10,
    })),
  }
}

;(configured ? describe : describe.skip)('hybridSearch on PostgreSQL', () => {
  let db: cds.DatabaseService
  const search = (vector: number[], text: string, mode: 'hybrid' | 'semantic' | 'lexical' = 'hybrid') =>
    hybridSearch(db, { vector, text, embeddingModel: 'test-model', limit: 5, candidates: 10, rrfK: 60, mode })

  beforeAll(async () => {
    cds.model = cds.compile.for.nodejs(await cds.load('*'))
    db = await cds.connect.to('db', {
      kind: 'postgres',
      impl: '@cap-js/postgres',
      credentials: {
        host: env.CDS_REQUIRES_DB_CREDENTIALS_HOST,
        port: Number(env.CDS_REQUIRES_DB_CREDENTIALS_PORT ?? 5432),
        user: 'knowledge_app',
        password: env.CDS_REQUIRES_DB_CREDENTIALS_PASSWORD,
        database: 'knowledge_test',
      },
    } as never)
    // Recreate the schema in the dedicated test database. The test profile uses SQLite,
    // so the DDL is compiled explicitly for PostgreSQL.
    const ddl = cds.compile.to.sql(await cds.load('*'), {
      dialect: 'postgres',
    } as never) as unknown as string[]
    const existing: { name: string; kind: string }[] = await db.run(
      `SELECT table_name AS name, table_type AS kind FROM information_schema.tables
        WHERE table_schema = 'public' AND (table_name LIKE 'knowledge%' OR table_name LIKE 'cds_%')`,
    )
    for (const { name, kind } of existing) {
      await db.run(`DROP ${kind === 'VIEW' ? 'VIEW' : 'TABLE'} IF EXISTS "${name}" CASCADE`)
    }
    for (const statement of ddl) await db.run(statement)
    await applyRetrievalSchema(db)
    await db.run('DELETE FROM knowledge_Chunks')
    await db.run('DELETE FROM knowledge_Documents')

    const store = new PostgresKnowledgeStore(db)
    await store.replaceDocument(
      doc('actions.md', 'test-model', [
        {
          breadcrumb: 'Custom Actions › Implementing Actions',
          content: 'Register an on handler.',
          embedding: unit(0),
        },
        { breadcrumb: 'Custom Actions › Calling Actions', content: 'Send requests.', embedding: unit(1) },
      ]),
    )
    await store.replaceDocument(
      doc('deploy.md', 'test-model', [
        {
          breadcrumb: 'Deploy to Cloud Foundry',
          content: 'Use mbt build and cf deploy.',
          embedding: unit(2),
        },
      ]),
    )
    await store.replaceDocument(
      doc('other-model.md', 'other-model', [
        {
          breadcrumb: 'Implementing Actions elsewhere',
          content: 'Same words, other model.',
          embedding: unit(0),
        },
      ]),
    )
  }, 60_000)

  afterAll(async () => {
    if (!db) return
    await db.run('DELETE FROM knowledge_Chunks')
    await db.run('DELETE FROM knowledge_Documents')
    await (db as unknown as { disconnect(): Promise<void> }).disconnect()
  })

  it('stores every chunk with its vector', async () => {
    const [row] = await db.run(
      'SELECT count(*)::int AS total, count(embedding)::int AS embedded FROM knowledge_Chunks',
    )
    expect(row).toEqual({ total: 4, embedded: 4 })
  })

  it('ranks by cosine similarity in semantic mode', async () => {
    const hits = await search(unit(2), '', 'semantic')

    expect(hits[0]).toMatchObject({
      breadcrumb: 'Deploy to Cloud Foundry',
      semanticRank: 1,
      lexicalRank: null,
    })
    expect(hits[0]!.similarity).toBeCloseTo(1)
  })

  it('matches any query word in lexical mode, weighting heading matches', async () => {
    const hits = await search(unit(5), 'how to implement actions', 'lexical')

    expect(hits.map((h) => h.breadcrumb)).toEqual([
      'Custom Actions › Implementing Actions',
      'Custom Actions › Calling Actions',
    ])
  })

  it('fuses both rankings: a chunk found by both searches comes first', async () => {
    // Semantically closest to "Calling", lexically matching "Implementing"
    const vector = unit(1).map((v, i) => (i === 0 ? 0.6 : v))
    const hits = await search(vector, 'implementing')

    expect(hits[0]).toMatchObject({
      breadcrumb: 'Custom Actions › Implementing Actions',
      semanticRank: 2,
      lexicalRank: 1,
    })
    expect(hits[0]!.score).toBeCloseTo(1 / 62 + 1 / 61)
  })

  it('only searches chunks embedded with the given model', async () => {
    const hits = await search(unit(0), 'implementing actions')

    expect(hits.some((h) => h.breadcrumb.includes('elsewhere'))).toBe(false)
  })

  it('handles queries without searchable words', async () => {
    const hits = await search(unit(2), removeStopwords('CAP', ['cap']))

    expect(hits[0]!.breadcrumb).toBe('Deploy to Cloud Foundry')
    expect(hits.every((h) => h.lexicalRank === null)).toBe(true)
  })
})
