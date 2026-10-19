/**
 * Applies db/postgres/retrieval-schema.sql to the PostgreSQL database of the
 * `pg` profile. Runs after `cds deploy` (npm run db:deploy).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SQL_FILE = path.join(__dirname, '..', 'db', 'postgres', 'retrieval-schema.sql')

async function main() {
  // Select the profile before CAP reads its configuration
  process.env.CDS_ENV ??= 'development,pg'
  const { default: cds } = await import('@sap/cds')

  const db = await cds.connect.to('db')
  if (db.kind !== 'postgres') throw new Error(`Expected a PostgreSQL database, got '${db.kind}'`)

  const statements = readFileSync(SQL_FILE, 'utf8')
    .replace(/^\s*--.*$/gm, '')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean)

  for (const statement of statements) await db.run(statement)
  console.log(`Applied ${statements.length} statements from ${path.relative(process.cwd(), SQL_FILE)}`)
  cds.exit()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
