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
