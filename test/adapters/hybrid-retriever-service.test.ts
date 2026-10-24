import HybridRetrieverService from '../../srv/lib/adapters/postgres/hybrid-retriever-service'
import * as search from '../../srv/lib/adapters/postgres/hybrid-search'
import { removeStopwords, type HybridHit } from '../../srv/lib/adapters/postgres/hybrid-search'
import { splitStatements } from '../../srv/lib/adapters/postgres/retrieval-schema'

const hit = (breadcrumb: string, similarity: number): HybridHit => ({
  id: breadcrumb,
  breadcrumb,
  url: `https://docs/${breadcrumb}`,
  content: `${breadcrumb} content`,
  score: 0.03,
  similarity,
  semanticRank: 1,
  lexicalRank: 1,
})

describe('HybridRetrieverService', () => {
  const options = { candidates: 30, rrfK: 60, minSimilarity: 0.5, stopwords: ['cap'] }
  const embed = jest.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2]))

  function createService() {
    const service = new HybridRetrieverService('retriever', undefined, {
      kind: 'hybrid-pg-retriever',
      ...options,
    } as never)
    Object.assign(service, { db: {}, embeddings: { modelId: 'bge-m3', dimensions: 2, embed } })
    return service
  }

  afterEach(() => jest.restoreAllMocks())

  it('embeds the query and searches without corpus-wide stopwords', async () => {
    const spy = jest.spyOn(search, 'hybridSearch').mockResolvedValue([hit('Actions', 0.7)])

    const chunks = await createService().search('How do I implement an action in CAP?', 6)

    expect(embed).toHaveBeenCalledWith(['How do I implement an action in CAP?'])
    expect(spy).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        text: 'How do I implement an action in ?',
        embeddingModel: 'bge-m3',
        limit: 6,
        rrfK: 60,
      }),
    )
    expect(chunks).toEqual([
      {
        id: 'Actions',
        title: 'Actions',
        url: 'https://docs/Actions',
        content: 'Actions content',
        score: 0.03,
      },
    ])
  })

  it('abstains when no result is similar enough to the question (ADR 0008)', async () => {
    jest.spyOn(search, 'hybridSearch').mockResolvedValue([hit('Weather', 0.42), hit('Other', 0.31)])

    expect(await createService().search('What is the capital of France?', 6)).toEqual([])
  })
})

describe('removeStopwords', () => {
  it('removes whole words only, case-insensitively', () => {
    expect(removeStopwords('Deploy a CAP app with cap and capire', ['cap'])).toBe(
      'Deploy a app with and capire',
    )
  })
})

describe('splitStatements', () => {
  it('splits on semicolons but keeps dollar-quoted blocks together', () => {
    const sql = [
      '-- comment',
      'ALTER TABLE t ADD COLUMN a int;',
      'DO $$',
      'BEGIN',
      '  IF true THEN SELECT 1; END IF;',
      'END $$;',
      'CREATE INDEX i ON t (a);',
    ].join('\n')

    expect(splitStatements(sql)).toEqual([
      'ALTER TABLE t ADD COLUMN a int',
      'DO $$\nBEGIN\n  IF true THEN SELECT 1; END IF;\nEND $$',
      'CREATE INDEX i ON t (a)',
    ])
  })
})
