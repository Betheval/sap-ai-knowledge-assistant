/**
 * Renders the Markdown subset produced by the assistant into HTML for
 * sap.m.FormattedText (ADR 0015). Input is HTML-escaped before any markup is
 * added, so model output can never inject tags or attributes.
 * Pure TypeScript without UI5 dependencies, so it is unit-tested with Jest.
 */

export interface CitationTarget {
  url: string
  title: string
}

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Only http(s) links are rendered, whatever the source data contains. */
const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? escapeHtml(url) : undefined)

export function renderMarkdown(markdown: string, citations: CitationTarget[] = []): string {
  const codeBlocks: string[] = []
  // Fenced code blocks are taken out first (replaced by private-use markers) so nothing inside them is interpreted
  const withoutCode = markdown
    .replace(/\r\n/g, '\n')
    .replace(/^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm, (_, code: string) => {
      codeBlocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`)
      return `\uE000${codeBlocks.length - 1}\uE000`
    })

  const html = attachLoneCitations(withoutCode.split(/\n{2,}/).map((block) => block.trim()))
    .map((block) => renderBlock(block, citations))
    .filter(Boolean)
    .join('')

  return html.replace(/\uE000(\d+)\uE000/g, (_, i: string) => codeBlocks[Number(i)]!)
}

/** The model often puts citations on their own line after a code block; keep them with that block. */
function attachLoneCitations(blocks: string[]): string[] {
  const out: string[] = []
  for (const block of blocks) {
    if (out.length && /^(\[\d+\]\s*)+\.?$/.test(block)) out[out.length - 1] += `\n${block}`
    else out.push(block)
  }
  return out
}

function renderBlock(block: string, citations: CitationTarget[]): string {
  if (!block) return ''
  if (/^\uE000\d+\uE000$/.test(block)) return block

  const lines = block.split('\n')
  const heading = /^(#{1,6})\s+(.*)$/.exec(block)
  if (heading && lines.length === 1) {
    const level = Math.min(6, heading[1]!.length + 2) // keep headings smaller than the page title
    return `<h${level}>${renderInline(heading[2]!, citations)}</h${level}>`
  }
  if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
    return `<ul>${lines.map((l) => `<li>${renderInline(l.replace(/^\s*[-*]\s+/, ''), citations)}</li>`).join('')}</ul>`
  }
  if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
    return `<ol>${lines.map((l) => `<li>${renderInline(l.replace(/^\s*\d+\.\s+/, ''), citations)}</li>`).join('')}</ol>`
  }
  // Paragraph, possibly with a code block inside it: keep block markup outside <p>
  return block
    .split(/(\uE000\d+\uE000)/)
    .map((part) =>
      /^\uE000\d+\uE000$/.test(part)
        ? part
        : part.trim() && `<p>${renderInline(part.trim(), citations).replace(/\n/g, '<br>')}</p>`,
    )
    .join('')
}

export function renderInline(text: string, citations: CitationTarget[] = []): string {
  return escapeHtml(text)
    .split(/(`[^`]+`)/)
    .map((part, i) => {
      if (i % 2 === 1) return `<code>${part.slice(1, -1)}</code>`
      return part
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>')
        .replace(/\[(\d+)\]/g, (marker, n: string) => {
          const target = citations[Number(n) - 1]
          const href = target && safeUrl(target.url)
          return href
            ? `<a href="${href}" target="_blank" title="${escapeHtml(target.title)}">[${n}]</a>`
            : marker
        })
    })
    .join('')
}
