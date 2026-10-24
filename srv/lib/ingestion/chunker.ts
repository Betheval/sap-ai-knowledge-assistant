import { estimateTokens } from '../rag/tokens'
import { decodeText } from './markdown'

/**
 * Splits a normalized page into chunks by H2/H3 sections (ADR 0009). Code
 * blocks are never split; long sections are split at block boundaries.
 */

export interface ChunkerOptions {
  maxTokens: number
}

export interface PageChunk {
  position: number
  /** Heading path, e.g. "Custom Actions and Functions › Implementing Actions". */
  breadcrumb: string
  /** Page URL plus the anchor of the section heading. */
  url: string
  content: string
  tokenCount: number
}

export interface ChunkedPage {
  title: string
  chunks: PageChunk[]
}

const FENCE = /^\s*(`{3,}|~{3,})/
const HEADING = /^(#{1,3})\s+(.*?)\s*(?:\{\s*#([^\s}]+)\s*\})?\s*$/
const SEPARATOR = ' › '
/** Chunks below this size carry no information (e.g. a lone "See CQN"). */
const MIN_TOKENS = 4

interface Section {
  path: string[]
  anchor?: string
  lines: string[]
}

export function chunkPage(
  markdown: string,
  pageUrl: string,
  fallbackTitle: string,
  options: ChunkerOptions,
): ChunkedPage {
  const sections = splitSections(markdown)
  const title = sections.title ?? fallbackTitle

  const chunks: PageChunk[] = []
  for (const section of sections.list) {
    const blocks = splitBlocks(section.lines)
    if (blocks.length === 0) continue

    const breadcrumb = [title, ...section.path].join(SEPARATOR)
    const url = section.anchor ? `${pageUrl}#${section.anchor}` : pageUrl
    for (const content of packBlocks(blocks, options.maxTokens)) {
      const tokenCount = estimateTokens(content)
      if (tokenCount < MIN_TOKENS) continue
      chunks.push({ position: chunks.length, breadcrumb, url, content, tokenCount })
    }
  }
  return { title, chunks }
}

function splitSections(markdown: string): { title?: string; list: Section[] } {
  let title: string | undefined
  let h2: string | undefined
  let current: Section = { path: [], lines: [] }
  const list: Section[] = [current]
  let fence: string | undefined

  for (const line of markdown.split('\n')) {
    const fenceMatch = FENCE.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]!
      if (!fence) fence = marker
      else if (line.trim().startsWith(fence) && /^(`+|~+)$/.test(line.trim())) fence = undefined
    }

    const heading = fence || fenceMatch ? undefined : HEADING.exec(line)
    if (!heading) {
      current.lines.push(line)
      continue
    }

    const level = heading[1]!.length
    // Anchors come from the heading as written; the breadcrumb shows it decoded
    const source = stripInlineMarkdown(heading[2]!)
    const anchor = heading[3] ?? slugify(source)
    const text = decodeText(source).replace(/\s+/g, ' ').trim()
    if (level === 1) {
      title ??= text
      continue
    }
    if (level === 2) h2 = text
    current = { path: level === 2 || !h2 ? [text] : [h2, text], anchor, lines: [] }
    list.push(current)
  }
  return { title, list }
}

/** Splits section lines into paragraphs and whole code blocks. */
function splitBlocks(lines: string[]): string[] {
  const blocks: string[] = []
  let buffer: string[] = []
  let fence: string | undefined

  const flush = () => {
    const text = buffer.join('\n').trim()
    if (text) blocks.push(text)
    buffer = []
  }

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line)
    if (fence) {
      buffer.push(line)
      if (fenceMatch && line.trim().startsWith(fence) && /^(`+|~+)$/.test(line.trim())) {
        fence = undefined
        flush()
      }
      continue
    }
    if (fenceMatch) {
      // A code block is its own block, together with a short lead-in line such as "File `x`:"
      const lead = buffer.length && buffer.at(-1)!.trim().endsWith(':') ? buffer.pop() : undefined
      flush()
      if (lead) buffer.push(lead)
      fence = fenceMatch[1]
      buffer.push(line)
      continue
    }
    if (line.trim() === '') flush()
    else buffer.push(line)
  }
  flush()
  return blocks
}

/**
 * Greedily packs blocks into chunks of at most maxTokens. Oversized tables are
 * split by rows, repeating the header; other oversized blocks (code) stay whole.
 */
function packBlocks(blocks: string[], maxTokens: number): string[] {
  const chunks: string[] = []
  let current: string[] = []
  let tokens = 0

  for (const block of blocks.flatMap((b) => splitTable(b, maxTokens))) {
    const cost = estimateTokens(block)
    if (current.length && tokens + cost > maxTokens) {
      chunks.push(current.join('\n\n'))
      current = []
      tokens = 0
    }
    current.push(block)
    tokens += cost
  }
  if (current.length) chunks.push(current.join('\n\n'))
  return chunks
}

/** Splits a Markdown table larger than maxTokens into row groups that each repeat the header. */
function splitTable(block: string, maxTokens: number): string[] {
  const lines = block.split('\n')
  const isTable =
    lines.length > 2 && lines.every((l) => l.trim().startsWith('|')) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[1]!)
  if (!isTable || estimateTokens(block) <= maxTokens) return [block]

  const header = lines.slice(0, 2)
  const budget = maxTokens - estimateTokens(header.join('\n'))
  const parts: string[] = []
  let rows: string[] = []
  let tokens = 0
  for (const row of lines.slice(2)) {
    const cost = estimateTokens(row) + 1
    if (rows.length && tokens + cost > budget) {
      parts.push([...header, ...rows].join('\n'))
      rows = []
      tokens = 0
    }
    rows.push(row)
    tokens += cost
  }
  if (rows.length) parts.push([...header, ...rows].join('\n'))
  return parts
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1$2') // _emphasis_, not snake_case
    .trim()
}

/**
 * Anchor slugs as generated by Capire: the GitHub/VS Code-style slugifier of its
 * VitePress configuration (.vitepress/lib/slugify.ts in cap-js/docs).
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-')
}
