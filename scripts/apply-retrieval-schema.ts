/**
 * Applies db/postgres/retrieval-schema.sql to the PostgreSQL database of the
 * `pg` profile. Runs after `cds deploy` (npm run db:deploy).
 */
import './pg-profile'
import cds from '@sap/cds'
import path from 'node:path'
import { applyRetrievalSchema, RETRIEVAL_SCHEMA_FILE } from '../srv/lib/adapters/postgres/retrieval-schema'

async function main() {
  const db = await cds.connect.to('db')
  if (db.kind !== 'postgres') throw new Error(`Expected a PostgreSQL database, got '${db.kind}'`)

  const count = await applyRetrievalSchema(db)
  console.log(`Applied ${count} statements from ${path.relative(process.cwd(), RETRIEVAL_SCHEMA_FILE)}`)
  cds.exit()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
