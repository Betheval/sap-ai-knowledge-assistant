import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { listPages, pageUrl, type CapireConfig } from '../../srv/lib/ingestion/capire-source'

const BASE = 'https://cap.cloud.sap/docs'

describe('pageUrl', () => {
  it.each([
    ['guides/services/custom-actions.md', `${BASE}/guides/services/custom-actions`],
    ['guides/querying/index.md', `${BASE}/guides/querying/`],
    ['node.js/cds-ql.md', `${BASE}/node.js/cds-ql`],
  ])('%s → %s', (rel, url) => {
    expect(pageUrl(`${BASE}/`, rel)).toBe(url)
  })
})

describe('listPages', () => {
  let root: string
  const config: CapireConfig = {
    repo: 'cap-js/docs',
    commit: 'abc',
    folders: ['guides', 'node.js'],
    baseUrl: BASE,
  }

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'capire-'))
    const files: Record<string, string> = {
      'guides/a.md': '# A\n<!--@include: ./assets/part.md-->',
      'guides/_menu.md': 'menu',
      'guides/assets/part.md': 'included',
      'guides/sub/index.md': '# Sub',
      'node.js/b.md': '# B',
      'java/c.md': '# C',
      'README.md': '# Readme',
      'outside.md': 'secret',
    }
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      writeFileSync(path.join(root, rel), content)
    }
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('lists pages of the configured folders, without partials and assets', () => {
    expect(listPages(root, config).map((p) => [p.path, p.url])).toEqual([
      ['guides/a.md', `${BASE}/guides/a`],
      ['guides/sub/index.md', `${BASE}/guides/sub/`],
      ['node.js/b.md', `${BASE}/node.js/b`],
    ])
  })

  it('loads includes relative to the page, but never outside the repository', () => {
    const page = listPages(root, config).find((p) => p.path === 'guides/a.md')!

    expect(page.loadInclude('./assets/part.md')).toBe('included')
    expect(page.loadInclude('../../../etc/passwd')).toBeUndefined()
    expect(page.loadInclude('./missing.md')).toBeUndefined()
  })
})
