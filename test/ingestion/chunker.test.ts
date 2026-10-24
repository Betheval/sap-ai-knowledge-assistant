import { chunkPage, slugify } from '../../srv/lib/ingestion/chunker'

const URL = 'https://cap.cloud.sap/docs/guides/services/custom-actions'
const chunk = (markdown: string, maxTokens = 800) => chunkPage(markdown, URL, 'fallback', { maxTokens })

describe('chunkPage', () => {
  it('splits by H2 and H3 with breadcrumbs and anchored URLs', () => {
    const page = chunk(
      [
        '# Custom Actions',
        'Intro text about actions.',
        '## Implementing Actions { #implementing }',
        'Register an on handler.',
        '### In `Node.js`',
        'Use this.on in the service.',
        '#### Details stay in the section',
        'More details here.',
      ].join('\n'),
    )

    expect(page.title).toBe('Custom Actions')
    expect(page.chunks.map((c) => [c.breadcrumb, c.url])).toEqual([
      ['Custom Actions', URL],
      ['Custom Actions › Implementing Actions', `${URL}#implementing`],
      ['Custom Actions › Implementing Actions › In Node.js', `${URL}#in-nodejs`],
    ])
    expect(page.chunks[2]!.content).toContain('#### Details stay in the section\nMore details here.')
    expect(page.chunks.map((c) => c.position)).toEqual([0, 1, 2])
  })

  it('never treats lines inside code blocks as headings and never splits code', () => {
    const code = ['```sh', '# not a heading', '', 'echo a', '```'].join('\n')
    const page = chunk(['# T', '## S', 'Some text here.', '', code].join('\n'), 5)

    expect(page.chunks.map((c) => c.content)).toEqual(['Some text here.', code])
  })

  it('keeps a lead-in line such as "File `x`:" with its code block', () => {
    const page = chunk(['# T', 'Paragraph one.', 'File `srv/x.js`:', '```js', 'a()', '```'].join('\n'), 5)

    expect(page.chunks.map((c) => c.content)).toEqual(['Paragraph one.', 'File `srv/x.js`:\n```js\na()\n```'])
  })

  it('packs paragraphs up to maxTokens', () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ${'x'.repeat(60)}`)
    const page = chunk(['# T', paragraphs.join('\n\n')].join('\n'), 40)

    expect(page.chunks).toHaveLength(3)
    expect(page.chunks.every((c) => c.tokenCount <= 40)).toBe(true)
  })

  it('splits large tables by rows and repeats the header', () => {
    const rows = Array.from({ length: 20 }, (_, i) => `| row${i} | ${'v'.repeat(20)} |`)
    const page = chunk(['# T', '| Name | Value |', '|---|---|', ...rows].join('\n'), 60)

    expect(page.chunks.length).toBeGreaterThan(1)
    for (const c of page.chunks) expect(c.content.startsWith('| Name | Value |\n|---|---|\n| row')).toBe(true)
    expect(page.chunks.flatMap((c) => c.content.split('\n').slice(2))).toEqual(rows)
  })

  it('skips empty sections and near-empty chunks, and falls back to the given title', () => {
    const page = chunk(['## Empty', '## Tiny', 'See', '## Real', 'Real content here.'].join('\n'))

    expect(page.title).toBe('fallback')
    expect(page.chunks.map((c) => c.breadcrumb)).toEqual(['fallback › Real'])
  })
})

describe('slugify', () => {
  it.each([
    ['Implementing Actions', 'implementing-actions'],
    ['@restrict', 'restrict'],
    ['Introduction & Overview', 'introduction--overview'],
    ['2. Optional: Auto-Create SAP Event Mesh Instances', '2-optional-auto-create-sap-event-mesh-instances'],
    ['cds.ql — Query API', 'cdsql--query-api'],
    ["What's new?", 'whats-new'],
    ['Have a Look Into _~/.cds-msg-box_', 'have-a-look-into-cds-msg-box'],
    ['`upgrade` _(tenant)_', 'upgrade-tenant'],
  ])('%s → %s', (text, slug) => {
    const page = chunkPage(`## ${text}\nSome content here.`, URL, 'T', { maxTokens: 800 })
    expect(page.chunks[0]!.url).toBe(`${URL}#${slug}`)
    if (!text.includes('_') && !text.includes('`')) expect(slugify(text)).toBe(slug)
  })
})
