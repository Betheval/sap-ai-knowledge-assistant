import { renderInline, renderMarkdown } from '../../app/assistant/webapp/util/markdown'

const sources = [
  {
    url: 'https://cap.cloud.sap/docs/guides/services/custom-actions#implementing-actions',
    title: 'Implementing Actions',
  },
  { url: 'javascript:alert(1)', title: 'Malicious' },
]

describe('renderMarkdown', () => {
  it('escapes HTML from the model before adding markup', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)"> and <b>bold</b>')

    expect(html).toBe('<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; and &lt;b&gt;bold&lt;/b&gt;</p>')
  })

  it('renders paragraphs, line breaks, emphasis and inline code', () => {
    expect(renderMarkdown('First **bold** and *em*\nwith `this.on()`\n\nSecond')).toBe(
      '<p>First <strong>bold</strong> and <em>em</em><br>with <code>this.on()</code></p><p>Second</p>',
    )
  })

  it('keeps fenced code verbatim, escaped and with its indentation, also when indented in a list', () => {
    const md = ['1. Define it:', '   ```cds', '   service S {', '     action a();', '   }', '   ```'].join(
      '\n',
    )

    expect(renderMarkdown(md)).toBe(
      '<p>1. Define it:</p><pre><code>   service S {\n     action a();\n   }</code></pre>',
    )
    expect(renderMarkdown('```html\n<b>**not bold**</b>\n```')).toBe(
      '<pre><code>&lt;b&gt;**not bold**&lt;/b&gt;</code></pre>',
    )
  })

  it('renders bullet and numbered lists and headings', () => {
    expect(renderMarkdown('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>')
    expect(renderMarkdown('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>')
    expect(renderMarkdown('## Steps')).toBe('<h4>Steps</h4>')
  })

  it('keeps citations written on their own line with the preceding block', () => {
    expect(renderMarkdown('Install it:\n\n```sh\nnpm add x\n```\n\n[1]', sources)).toBe(
      '<p>Install it:</p><pre><code>npm add x</code></pre>' +
        '<p><a href="https://cap.cloud.sap/docs/guides/services/custom-actions#implementing-actions" ' +
        'target="_blank" title="Implementing Actions">[1]</a></p>',
    )
  })

  it('links citation markers to their sources', () => {
    expect(renderInline('Use an on handler [1].', sources)).toBe(
      'Use an on handler <a href="https://cap.cloud.sap/docs/guides/services/custom-actions#implementing-actions" ' +
        'target="_blank" title="Implementing Actions">[1]</a>.',
    )
  })

  it('never links unsafe URLs or markers without a source', () => {
    expect(renderInline('See [2] and [7].', sources)).toBe('See [2] and [7].')
  })
})
