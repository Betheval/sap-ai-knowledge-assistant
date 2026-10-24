/**
 * Evaluates retrieval against the golden set (ADR 0013) for semantic, lexical
 * and hybrid search, against the PostgreSQL knowledge base of the `pg` profile.
 *
 *   npm run eval:retrieval              print metrics
 *   npm run eval:retrieval -- --save    also store them as the new baseline
 *   npm run eval:retrieval -- --verbose show the top results per question
 *   npm run eval:retrieval -- --no-runtime-filter  search all runtimes, for comparison
 */
import './pg-profile'
import cds from '@sap/cds'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { OTHER_RUNTIME_PATHS } from '../srv/lib/adapters/postgres/hybrid-retriever-service'
import { hybridSearch, removeStopwords, type SearchMode } from '../srv/lib/adapters/postgres/hybrid-search'
import { pageUrl } from '../srv/lib/ingestion/capire-source'
import type { EmbeddingProvider } from '../srv/lib/ports/embeddings'
import { detectRuntime } from '../srv/lib/rag/runtime'

const GOLDEN = path.join(__dirname, '..', 'test', 'golden', 'retrieval.json')
const BASELINE = path.join(__dirname, '..', 'test', 'golden', 'retrieval-baseline.json')
const MODES: SearchMode[] = ['semantic', 'lexical', 'hybrid']
const DEPTH = 6

interface Golden {
  questions: { id: string; question: string; expected: string[] }[]
  negatives: { id: string; question: string }[]
}

interface RetrieverConfig {
  candidates: number
  rrfK: number
  minSimilarity: number
  stopwords: string[]
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const noFilter = args.has('--no-runtime-filter')
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden
  const config = cds.env.requires.retriever as unknown as RetrieverConfig
  const baseUrl = (cds.env.ingestion as { capire: { baseUrl: string } }).capire.baseUrl

  const db = await cds.connect.to('db')
  const embeddings = (await cds.connect.to('embeddings')) as unknown as EmbeddingProvider

  const all = [...golden.questions, ...golden.negatives]
  const vectors = await embeddings.embed(all.map((q) => q.question))
  const vectorOf = new Map(all.map((q, i) => [q.id, vectors[i]!]))

  const search = (question: string, id: string, mode: SearchMode) =>
    hybridSearch(db, {
      vector: vectorOf.get(id)!,
      text: removeStopwords(question, config.stopwords),
      embeddingModel: embeddings.modelId,
      limit: DEPTH,
      candidates: config.candidates,
      rrfK: config.rrfK,
      mode,
      // Same runtime filter as the assistant: Node.js unless the question is about Java
      excludePaths: noFilter ? undefined : OTHER_RUNTIME_PATHS[detectRuntime(question)],
    })

  const results: Record<string, unknown> = {}
  console.log(
    `candidates=${config.candidates} rrfK=${config.rrfK} stopwords=[${config.stopwords}] depth=${DEPTH} ` +
      `runtime filter=${noFilter ? 'off' : 'on'}\n`,
  )
  console.log('mode       hit@1  hit@3  hit@6  MRR@6')

  for (const mode of MODES) {
    const ranks: (number | null)[] = []
    for (const q of golden.questions) {
      const pages = new Set(q.expected.map((p) => pageUrl(baseUrl, p)))
      const hits = await search(q.question, q.id, mode)
      const index = hits.findIndex((h) => pages.has(h.url.split('#')[0]!))
      ranks.push(index < 0 ? null : index + 1)
      if (args.has('--verbose')) {
        console.log(`  [${mode}] ${q.id}: ${index < 0 ? 'miss' : `rank ${index + 1}`}`)
        for (const h of hits.slice(0, 3))
          console.log(`      ${h.similarity.toFixed(3)} ${h.breadcrumb.slice(0, 80)}`)
      }
    }
    const hitAt = (n: number) => ranks.filter((r) => r !== null && r <= n).length / ranks.length
    const mrr = ranks.reduce<number>((sum, r) => sum + (r ? 1 / r : 0), 0) / ranks.length
    const metrics = { hitAt1: hitAt(1), hitAt3: hitAt(3), hitAt6: hitAt(6), mrr }
    results[mode] = {
      ...metrics,
      misses: golden.questions.filter((_, i) => ranks[i] === null).map((q) => q.id),
    }
    const pct = (v: number) => `${(v * 100).toFixed(0)}%`.padStart(5)
    console.log(
      `${mode.padEnd(9)} ${pct(metrics.hitAt1)}  ${pct(metrics.hitAt3)}  ${pct(metrics.hitAt6)}  ${mrr.toFixed(3)}`,
    )
  }

  // Abstention: best cosine similarity of covered vs. uncovered questions
  const best = async (q: { id: string; question: string }) =>
    Math.max(...(await search(q.question, q.id, 'semantic')).map((h) => h.similarity))
  const positives = await Promise.all(golden.questions.map(best))
  const negatives = await Promise.all(golden.negatives.map(best))
  const minPositive = Math.min(...positives)
  const maxNegative = Math.max(...negatives)
  console.log(
    `\nBest similarity: covered questions min ${minPositive.toFixed(3)}, uncovered max ${maxNegative.toFixed(3)} ` +
      `(minSimilarity=${config.minSimilarity}: ` +
      `${positives.filter((s) => s < config.minSimilarity).length} covered would abstain, ` +
      `${negatives.filter((s) => s >= config.minSimilarity).length} uncovered would be answered)`,
  )
  results.abstention = { minSimilarity: config.minSimilarity, minPositive, maxNegative }

  if (args.has('--save')) {
    const commit = (cds.env.ingestion as { capire: { commit: string } }).capire.commit
    const baseline = {
      date: new Date().toISOString().slice(0, 10),
      corpusCommit: commit,
      config,
      depth: DEPTH,
      results,
    }
    writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n')
    console.log(`Saved ${path.relative(process.cwd(), BASELINE)}`)
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
