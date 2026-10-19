import cds from '@sap/cds'
import { ask } from '#cds-models/KnowledgeService'
import { Conversations, Messages } from '#cds-models/knowledge'
import { ProviderError } from './lib/errors'
import type { ChatMessage, LLMProvider } from './lib/ports/llm'
import type { Retriever } from './lib/ports/retriever'
import { answerQuestion } from './lib/rag/answer-question'

const LOG = cds.log('knowledge')
const MAX_QUESTION_LENGTH = 2000

export default class KnowledgeService extends cds.ApplicationService {
  async init() {
    const llm = (await cds.connect.to('llm')) as unknown as LLMProvider
    const retriever = (await cds.connect.to('retriever')) as unknown as Retriever
    const config = cds.env.rag as { topK: number; historyMessages: number }
    const { SELECT, INSERT } = cds.ql

    this.on(ask, async (req) => {
      const { conversationId } = req.data
      const question = req.data.question?.trim()
      if (!question) return req.reject(400, 'The question must not be empty')
      if (question.length > MAX_QUESTION_LENGTH) {
        return req.reject(400, `The question must not exceed ${MAX_QUESTION_LENGTH} characters`)
      }
      const started = Date.now()

      // Load the conversation of the current user, or start a new one
      let history: ChatMessage[] = []
      const ID = conversationId || cds.utils.uuid()
      if (conversationId) {
        const conversation = await SELECT.one
          .from(Conversations)
          .where({ ID: conversationId, createdBy: req.user.id })
        if (!conversation) return req.reject(404, `Conversation ${conversationId} not found`)

        const previous = await SELECT.from(Messages)
          .columns('role', 'content')
          .where({ conversation_ID: conversationId })
          .orderBy('sequence')
        history = previous.map((m) => ({ role: m.role as ChatMessage['role'], content: m.content! }))
      } else {
        await INSERT.into(Conversations).entries({ ID, title: question.slice(0, 200) })
      }

      let result
      try {
        result = await answerQuestion({ llm, retriever, config, logger: LOG }, { question, history })
      } catch (error) {
        if (error instanceof ProviderError) {
          LOG.error(error.message)
          return req.reject(error.status, error.message)
        }
        throw error
      }

      const latencyMs = Date.now() - started
      const messageId = cds.utils.uuid()
      const sources = result.sources.map((s) => ({
        title: s.title,
        url: s.url,
        snippet: s.content,
        score: s.score,
        cited: s.cited,
      }))

      await INSERT.into(Messages).entries([
        { conversation_ID: ID, sequence: history.length, role: 'user', content: question },
        {
          ID: messageId,
          conversation_ID: ID,
          sequence: history.length + 1,
          role: 'assistant',
          content: result.answer,
          rewrittenQuery: result.rewrittenQuery,
          model: result.model,
          latencyMs,
          sources: sources.map((s, i) => ({ ...s, rank: i + 1 })),
        },
      ])

      return { conversationId: ID, messageId, answer: result.answer, sources, model: result.model, latencyMs }
    })

    return super.init()
  }
}
