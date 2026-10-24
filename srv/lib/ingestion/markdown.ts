/**
 * Normalizes Capire (VitePress) Markdown into plain Markdown for chunking and
 * embedding (ADR 0009). Code blocks are kept verbatim, except for VitePress
 * code annotations; everything else is cleaned outside code only.
 */

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/
const INCLUDE = /<!--\s*@include:\s*(\S+?)\s*-->/g
const CODE_MARKER = /\s*(?:\/\/|#|--|<!--|\/\*)?\s*\[!code [^\]]+\]\s*(?:-->|\*\/)?/g
const CONTAINER = /^\s*:::+\s*([a-z-]*)\s*(.*)$/
const CALLOUTS: Record<string, string> = {
  tip: 'Tip',
  info: 'Info',
  note: 'Note',
  warning: 'Warning',
  caution: 'Caution',
  important: 'Important',
  danger: 'Danger',
  details: 'Details',
}
const DROPPED_BLOCKS = ['script', 'style', 'svg']
const ENTITIES: Record<string, string> = {
  emsp: ' ',
  ensp: ' ',
  nbsp: ' ',
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
}

export type IncludeLoader = (path: string) => string | undefined

export interface NormalizedPage {
  /** Title from the front matter, if any. */
  title?: string
  markdown: string
}

interface Line {
  text: string
  code: boolean
}

export function normalizeMarkdown(raw: string, loadInclude: IncludeLoader = () => undefined): NormalizedPage {
  const { frontMatter, body } = splitFrontMatter(raw.replace(/\r\n/g, '\n'))
  const lines = structureLines(resolveIncludes(body, loadInclude).split('\n'))

  // Clean consecutive text lines together, so links and tags spanning lines are handled
  const out: string[] = []
  let text: string[] = []
  const flushText = () => {
    if (text.length) out.push(cleanText(text.join('\n'), frontMatter))
    text = []
  }
  for (const line of lines) {
    if (line.code) {
      flushText()
      out.push(line.text)
    } else text.push(line.text)
  }
  flushText()

  const markdown = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { title: frontMatter.title, markdown }
}

/** Separates code from text and drops VitePress-only constructs line by line. */
function structureLines(lines: string[]): Line[] {
  const out: Line[] = []
  let fence: string | undefined
  let droppedBlock: string | undefined

  for (const line of lines) {
    if (fence) {
      if (isClosingFence(line, fence)) {
        fence = undefined
        out.push({ text: line.trim(), code: true })
      } else if (!line.includes('[!code --')) {
        out.push({ text: line.replace(CODE_MARKER, ''), code: true })
      }
      continue
    }

    if (droppedBlock) {
      if (new RegExp(`</${droppedBlock}>`, 'i').test(line)) droppedBlock = undefined
      continue
    }

    const opening = FENCE.exec(line)
    if (opening) {
      fence = opening[1]!
      const [lang = '', ...rest] = opening[2]!.trim().split(/\s+/)
      const fileTitle = /\[([^\]]+)\]/.exec(rest.join(' '))?.[1]
      if (fileTitle) out.push({ text: `File \`${fileTitle}\`:`, code: false })
      out.push({ text: `${fence}${lang.replace(/[{:].*$/, '')}`, code: true })
      continue
    }

    const block = DROPPED_BLOCKS.find((tag) => new RegExp(`^\\s*<${tag}[\\s>]`, 'i').test(line))
    if (block) {
      if (!new RegExp(`</${block}>`, 'i').test(line)) droppedBlock = block
      continue
    }

    const container = CONTAINER.exec(line)
    if (container) {
      const label = CALLOUTS[container[1]!]
      const heading = container[2]!.trim()
      if (label) out.push({ text: heading ? `**${label}: ${heading}**` : `**${label}:**`, code: false })
      continue
    }

    if (
      /^\s*\[[^\]]+\]:\s*\S+/.test(line) || // link reference definition
      /^\s*\[\[toc\]\]\s*$/.test(line) ||
      line.includes('{.learn-more}') // "Learn more" links are meaningless without the link
    ) {
      continue
    }

    if (/^\s*<div class="impl node">/.test(line)) out.push({ text: '**Node.js:**', code: false })
    else if (/^\s*<div class="impl java">/.test(line)) out.push({ text: '**Java:**', code: false })
    else out.push({ text: line, code: false })
  }
  return out
}

/** Cleans a run of text lines (never code blocks). */
function cleanText(text: string, frontMatter: FrontMatter): string {
  const cleaned = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{\s*\$frontmatter\??\.description\s*\}\}/g, frontMatter.description ?? '')
    .replace(/\{\{[\s\S]*?\}\}/g, '')
    .replace(/^(\s*>\s*)\[!(\w+)\]\s*(.*)$/gm, (_, quote: string, kind: string, title: string) => {
      const label = CALLOUTS[kind.toLowerCase()] ?? kind
      return `${quote}**${title ? `${label}: ${title}` : `${label}:`}**`
    })
    .replace(/<Config[^>]*>([\s\S]*?)<\/Config>/g, (_, config: string) => `\`${config.trim()}\``) // configuration snippets are code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[((?:[^[\]]|\[[^\]]*\])+)\]\([^)\s]*\s*(?:"[^"]*")?\s*\)/g, '$1') // links → text, may span lines
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1') // reference links → text

  return cleaned
    .split('\n')
    .map((line) => (/^\s*#{1,6}\s/.test(line) ? cleanHeading(line) : cleanLine(line)))
    .join('\n')
}

function cleanHeading(line: string): string {
  // Keep custom anchors for the chunker as {#id}, also from mixed lists like {.method #id}; drop other attributes.
  // Entities and escapes stay as written: Capire derives heading anchors from them.
  return outsideInlineCode(line, (part) =>
    stripTags(part).replace(/\{([^}]*)\}/g, (_, attrs: string) => {
      const id = /#([^\s}]+)/.exec(attrs)?.[1]
      return id ? `{#${id}}` : ''
    }),
  ).trimEnd()
}

function cleanLine(line: string): string {
  const cleaned = outsideInlineCode(
    line,
    (part) =>
      decodeText(stripTags(part))
        .replace(/\{\s*(?:\.[\w-]|style=)[^}]*\}/g, '')
        .replace(/(\S) {2,}/g, '$1 '), // spaces left behind by removed tags
  )
  // Markdown tables: drop the alignment padding, which costs many tokens
  return /^\s*\|/.test(cleaned) ? cleaned.replace(/ {2,}/g, ' ').replace(/-{3,}/g, '---') : cleaned.trimEnd()
}

function stripTags(text: string): string {
  // \<x\> is escaped text, not a tag
  return text.replace(/<br\s*\/?>/gi, ' ').replace(/(?<!\\)<\/?[A-Za-z][\w-]*(?:\s[^>]*)?\/?>/g, '')
}

/** Decodes HTML entities and Markdown backslash escapes. */
export function decodeText(text: string): string {
  return text
    .replace(/&(\w+);/g, (entity, name: string) => ENTITIES[name] ?? entity)
    .replace(/\\([\\`*_{}[\]()<>#+\-.!|])/g, '$1')
}

function outsideInlineCode(line: string, clean: (part: string) => string): string {
  return line
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : clean(part)))
    .join('')
}

interface FrontMatter {
  title?: string
  description?: string
}

function splitFrontMatter(text: string): { frontMatter: FrontMatter; body: string } {
  if (!text.startsWith('---\n')) return { frontMatter: {}, body: text }
  const end = text.indexOf('\n---', 4)
  if (end < 0) return { frontMatter: {}, body: text }
  const yaml = text.slice(4, end)
  return {
    frontMatter: { title: yamlString(yaml, 'title'), description: yamlString(yaml, 'description') },
    body: text.slice(text.indexOf('\n', end + 1) + 1),
  }
}

/** Reads a top-level string from simple YAML, including folded (>) and literal (|) blocks. */
function yamlString(yaml: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(yaml)
  if (!match) return undefined
  const inline = match[1]!.trim()
  if (inline && !/^[>|][-+]?$/.test(inline)) return inline.replace(/^["']|["']$/g, '')

  const following = yaml.slice(match.index + match[0].length + 1).split('\n')
  const block: string[] = []
  for (const line of following) {
    if (!/^\s+\S/.test(line)) break
    block.push(line.trim())
  }
  return block.join(' ') || undefined
}

function resolveIncludes(text: string, load: IncludeLoader, depth = 0): string {
  if (depth > 3) return text
  return text.replace(INCLUDE, (_, path: string) => {
    const included = load(path)
    return included === undefined ? '' : resolveIncludes(splitFrontMatter(included).body, load, depth + 1)
  })
}

function isClosingFence(line: string, fence: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith(fence) && new RegExp(`^\\${fence[0]}+$`).test(trimmed)
}
