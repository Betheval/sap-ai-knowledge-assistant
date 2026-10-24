import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

/**
 * Capire sources at a pinned commit of cap-js/docs (ADR 0009). The repository is
 * downloaded into a local cache, never copied into this project.
 */

export interface CapireConfig {
  /** GitHub repository, e.g. "cap-js/docs". */
  repo: string
  commit: string
  /** Top-level folders that contain documentation pages. */
  folders: string[]
  /** Public base URL of the published documentation. */
  baseUrl: string
}

export interface SourcePage {
  /** Path inside the repository, e.g. guides/services/custom-actions.md */
  path: string
  url: string
  /** Raw Markdown with VitePress includes resolvable through `loadInclude`. */
  raw: string
  loadInclude: (includePath: string) => string | undefined
}

/** Downloads the pinned commit unless it is already cached; returns its root directory. */
export async function fetchCapire(config: CapireConfig, cacheDir: string): Promise<string> {
  const root = path.join(cacheDir, config.commit)
  if (existsSync(root)) return root

  const response = await fetch(`https://codeload.github.com/${config.repo}/tar.gz/${config.commit}`)
  if (!response.ok || !response.body)
    throw new Error(`Download of ${config.repo}@${config.commit} failed: ${response.status}`)

  const staging = `${root}.download`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  await extractTarGz(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), staging)

  // The archive contains a single top-level folder named <repo>-<commit>
  const [top] = readdirSync(staging)
  if (!top) throw new Error('Downloaded archive is empty')
  renameSync(path.join(staging, top), root)
  rmSync(staging, { recursive: true, force: true })
  return root
}

function extractTarGz(input: Readable, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-xzf', '-', '-C', targetDir], { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    tar.stderr.on('data', (d) => (stderr += d))
    tar.on('error', reject)
    tar.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`tar exited with ${code}: ${stderr}`)),
    )
    input.on('error', reject)
    input.pipe(tar.stdin)
  })
}

/** Pages Capire does not publish (srcExclude in its VitePress config), plus partials (_*.md). */
const EXCLUDED = /^(_.*|-.*|menu|internal|FIXME|README|LICENSE|CONTRIBUTING|CODE_OF_CONDUCT|redirects)\.md$/

/**
 * Lists the documentation pages: Markdown files in the configured folders,
 * excluding partials (`_*.md`, `assets/`) that pages pull in through includes.
 */
export function listPages(root: string, config: CapireConfig): SourcePage[] {
  const pages: SourcePage[] = []

  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'assets' && !entry.name.startsWith('.')) walk(rel)
      } else if (entry.name.endsWith('.md') && !EXCLUDED.test(entry.name)) {
        pages.push(toPage(root, rel, config))
      }
    }
  }
  for (const folder of config.folders) if (existsSync(path.join(root, folder))) walk(folder)

  return pages.sort((a, b) => a.path.localeCompare(b.path))
}

function toPage(root: string, rel: string, config: CapireConfig): SourcePage {
  const file = path.join(root, rel)
  return {
    path: rel,
    url: pageUrl(config.baseUrl, rel),
    raw: readFileSync(file, 'utf8'),
    loadInclude: (includePath) => {
      const target = path.resolve(path.dirname(file), includePath.replace(/[{#].*$/, ''))
      // Only files inside the downloaded repository
      if (!target.startsWith(root + path.sep) || !existsSync(target)) return undefined
      return readFileSync(target, 'utf8')
    },
  }
}

/** guides/services/custom-actions.md → <base>/guides/services/custom-actions; foo/index.md → <base>/foo/ */
export function pageUrl(baseUrl: string, rel: string): string {
  const slug = rel.replace(/\.md$/, '').replace(/(^|\/)index$/, '$1')
  return `${baseUrl.replace(/\/+$/, '')}/${slug}`
}

/**
 * Keeps only pages that are live on the published site. The repository can be
 * ahead of the deployment, and answers must never cite a page that returns 404.
 */
export async function filterPublished(
  pages: SourcePage[],
  concurrency = 8,
): Promise<{ published: SourcePage[]; unpublished: SourcePage[] }> {
  const status = new Map<SourcePage, boolean>()
  const queue = [...pages]
  const worker = async () => {
    for (let page = queue.shift(); page; page = queue.shift()) {
      const response = await fetch(page.url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      })
      status.set(page, response.ok)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return {
    published: pages.filter((p) => status.get(p)),
    unpublished: pages.filter((p) => !status.get(p)),
  }
}
