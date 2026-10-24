import { normalizeMarkdown } from '../../srv/lib/ingestion/markdown'

const md = (lines: string[]) => lines.join('\n')

describe('normalizeMarkdown', () => {
  it('drops the front matter but uses its description and title', () => {
    const { title, markdown } = normalizeMarkdown(
      md([
        '---',
        'title: Deploy',
        'description: >',
        '  How to deploy',
        '  to Cloud Foundry.',
        '---',
        '# Deploy',
        '',
        '{{ $frontmatter.description }}',
      ]),
    )

    expect(title).toBe('Deploy')
    expect(markdown).toBe('# Deploy\n\nHow to deploy to Cloud Foundry.')
  })

  it('keeps code blocks verbatim, removing only VitePress code annotations', () => {
    const { markdown } = normalizeMarkdown(
      md([
        '```js [srv/cat-service.js]',
        "const x = '<b>{{ not a template }}</b>' // [!code focus]",
        'old() // [!code --]',
        'next() // [!code ++]',
        '```',
      ]),
    )

    expect(markdown).toBe(
      md(['File `srv/cat-service.js`:', '```js', "const x = '<b>{{ not a template }}</b>'", 'next()', '```']),
    )
  })

  it('turns containers and alerts into labels and drops code groups', () => {
    const { markdown } = normalizeMarkdown(
      md([
        '::: tip Use aspects',
        'Text',
        ':::',
        '',
        '::: code-group',
        'Code',
        ':::',
        '',
        '> [!warning] Careful',
        '> Body',
      ]),
    )

    expect(markdown).toBe(
      md(['**Tip: Use aspects**', 'Text', '', 'Code', '', '> **Warning: Careful**', '> Body']),
    )
  })

  it('replaces links by their text, also when they contain code or span lines', () => {
    const { markdown } = normalizeMarkdown(
      md([
        'See [the `annotate` directive',
        'below](#annotate) and [docs](./x "title").',
        '![diagram](img.png)',
      ]),
    )

    expect(markdown).toBe('See the `annotate` directive\nbelow and docs.')
  })

  it('removes HTML, Vue components, attributes, tables of contents and "learn more" links', () => {
    const { markdown } = normalizeMarkdown(
      md([
        '<script setup> import x from "./x" </script>',
        '<svg viewBox="0 0 1 1">',
        '<path d="M0"/>',
        '</svg>',
        '[[toc]]',
        'Since <Since version="9" /> it is <b>bold</b>{.indent} with <Config>cds.requires.db</Config>.',
        '[Learn more about it.](./x){.learn-more}',
        'Keep `Array<String>` in code&emsp;spans.',
      ]),
    )

    expect(markdown).toBe('Since it is bold with `cds.requires.db`.\nKeep `Array<String>` in code spans.')
  })

  it('keeps custom heading anchors and drops other heading attributes', () => {
    expect(normalizeMarkdown('## Actions { #actions } {.class}').markdown).toBe('## Actions {#actions}')
    expect(normalizeMarkdown('### cds. parse. expr() {.method #parse-cxl }').markdown).toBe(
      '### cds. parse. expr() {#parse-cxl}',
    )
  })

  it('labels implementation variants', () => {
    const { markdown } = normalizeMarkdown(md(['<div class="impl node">', 'Node text', '</div>']))

    expect(markdown).toBe('**Node.js:**\nNode text')
  })

  it('compacts table padding', () => {
    const { markdown } = normalizeMarkdown(
      md(['| Name    | Type   |', '|---------|--------|', '| ID      | UUID   |']),
    )

    expect(markdown).toBe(md(['| Name | Type |', '|---|---|', '| ID | UUID |']))
  })

  it('resolves includes relative to the page', () => {
    const files: Record<string, string> = { './assets/help.out.md': '---\nx: 1\n---\nUsage: cds init' }

    const { markdown } = normalizeMarkdown(
      'Before\n<!--@include: ./assets/help.out.md-->\nAfter',
      (p) => files[p],
    )

    expect(markdown).toBe('Before\nUsage: cds init\nAfter')
  })
})
