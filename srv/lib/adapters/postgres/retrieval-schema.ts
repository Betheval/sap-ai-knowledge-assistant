import type cds from '@sap/cds'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const RETRIEVAL_SCHEMA_FILE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'db',
  'postgres',
  'retrieval-schema.sql',
)

/** Splits a SQL script into statements; `;` inside dollar-quoted blocks (DO $$ ... $$) does not end a statement. */
export function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current: string[] = []
  let inDollarQuote = false

  for (const line of sql.split('\n')) {
    if (!inDollarQuote && /^\s*--/.test(line)) continue
    current.push(line)
    if ((line.match(/\$\$/g)?.length ?? 0) % 2 === 1) inDollarQuote = !inDollarQuote
    if (!inDollarQuote && /;\s*$/.test(line)) {
      statements.push(current.join('\n').trim().replace(/;$/, ''))
      current = []
    }
  }
  const rest = current.join('\n').trim()
  if (rest) statements.push(rest)
  return statements.filter(Boolean)
}

/** Applies the SQL-managed retrieval columns and indexes (ADR 0011). Idempotent. */
export async function applyRetrievalSchema(db: cds.DatabaseService): Promise<number> {
  const statements = splitStatements(readFileSync(RETRIEVAL_SCHEMA_FILE, 'utf8'))
  for (const statement of statements) await db.run(statement)
  return statements.length
}
