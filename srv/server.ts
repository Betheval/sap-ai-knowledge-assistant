import cds from '@sap/cds'
import type { LLMProvider } from './lib/ports/llm'

// CAP serves /health as a liveness probe. LLM availability is reported separately,
// so an unreachable model host never makes the platform restart the app (ADR 0004).
cds.on('bootstrap', (app) => {
  app.get('/health/llm', async (_req, res) => {
    const llm = (await cds.connect.to('llm')) as unknown as LLMProvider
    const health = await llm.checkHealth()
    res.status(health.status === 'up' ? 200 : 503).json(health)
  })
})

// Deployments without a model host run on an in-memory SQLite database (ADR 0019).
// CAP only creates in-memory schemas in development, so do it here when it is empty.
cds.on('served', async () => {
  const db = cds.db
  const credentials = cds.env.requires.db?.credentials as { url?: string; database?: string } | undefined
  if (db?.kind !== 'sqlite' || ![credentials?.url, credentials?.database].includes(':memory:')) return

  const tables = await db.run(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_Conversations'",
  )
  if (tables.length) return
  await (cds as unknown as { deploy(model: string): { to(db: unknown): Promise<void> } }).deploy('*').to(db)
  cds.log('knowledge').info('Deployed the schema to the in-memory database')
})
