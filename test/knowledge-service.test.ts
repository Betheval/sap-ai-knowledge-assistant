import cds from '@sap/cds'
import path from 'node:path'
import { LLMTimeoutError, LLMUnavailableError } from '../srv/lib/errors'
import type { LLMProvider } from '../srv/lib/ports/llm'
import { NO_ANSWER } from '../srv/lib/rag/prompts'

const { GET, POST } = cds.test(path.join(__dirname, '..'))

const alice = { auth: { username: 'alice', password: 'alice' } }
const bob = { auth: { username: 'bob', password: 'bob' } }
const BASE = '/odata/v4/knowledge'

async function ask(body: { question: string; conversationId?: string }, user = alice) {
  const { data } = await POST(`${BASE}/ask`, body, user)
  return data
}

async function status(request: Promise<unknown>): Promise<number | undefined> {
  try {
    await request
    return 200
  } catch (error) {
    return (error as { response?: { status: number } }).response?.status
  }
}

describe('KnowledgeService', () => {
  describe('ask', () => {
    it('starts a conversation and returns the answer with its sources', async () => {
      const result = await ask({ question: 'How do I implement an action?' })

      expect(result.conversationId).toEqual(expect.any(String))
      expect(result.messageId).toEqual(expect.any(String))
      expect(result.model).toBe('fake-llm')
      expect(result.answer).toContain('[1]')
      expect(result.sources[0]).toMatchObject({
        title: 'Custom Actions and Functions › Implementing Actions',
        url: 'https://cap.cloud.sap/docs/guides/services/custom-actions#implementing-actions',
        cited: true,
      })
    })

    it('continues an existing conversation and stores the history in order', async () => {
      const first = await ask({ question: 'How do I implement an action?' })
      await ask({ conversationId: first.conversationId, question: 'How do I deploy to Cloud Foundry?' })

      const { data } = await GET(
        `${BASE}/Conversations(${first.conversationId})?$expand=messages($orderby=sequence;$expand=sources)`,
        alice,
      )
      expect(data.title).toBe('How do I implement an action?')
      expect(data.messages.map((m: { sequence: number; role: string }) => [m.sequence, m.role])).toEqual([
        [0, 'user'],
        [1, 'assistant'],
        [2, 'user'],
        [3, 'assistant'],
      ])
      const lastAnswer = data.messages[3]
      expect(lastAnswer.rewrittenQuery).toBe('How do I deploy to Cloud Foundry?')
      expect(lastAnswer.sources[0]).toMatchObject({
        rank: 1,
        title: 'Deploy to Cloud Foundry › Build and Deploy',
      })
    })

    it('treats an empty conversationId as a new conversation', async () => {
      const result = await ask({ conversationId: '', question: 'How do I configure XSUAA?' })

      expect(result.conversationId).toEqual(expect.any(String))
      expect(result.conversationId).not.toBe('')
    })

    it('abstains when the documentation has nothing relevant', async () => {
      const result = await ask({ question: 'What is the weather in Madrid?' })

      expect(result.answer).toBe(NO_ANSWER)
      expect(result.sources).toEqual([])
      expect(result.model).toBeNull()
    })

    it('rejects an empty question', async () => {
      expect(await status(POST(`${BASE}/ask`, { question: '   ' }, alice))).toBe(400)
    })

    it('rejects an overly long question', async () => {
      expect(await status(POST(`${BASE}/ask`, { question: 'x'.repeat(2001) }, alice))).toBe(400)
    })

    it('returns 404 for an unknown conversation', async () => {
      const body = { conversationId: cds.utils.uuid(), question: 'How do I deploy?' }
      expect(await status(POST(`${BASE}/ask`, body, alice))).toBe(404)
    })

    it.each([
      ['LLMUnavailableError', new LLMUnavailableError('down'), 503],
      ['LLMTimeoutError', new LLMTimeoutError('slow'), 504],
    ])('maps %s to HTTP %i and stores nothing', async (_name, error, expected) => {
      const llm = (await cds.connect.to('llm')) as unknown as LLMProvider
      jest.spyOn(llm, 'chat').mockRejectedValueOnce(error)
      const question = `Failing question ${expected}: how do I implement an action?`

      expect(await status(POST(`${BASE}/ask`, { question }, alice))).toBe(expected)

      const { data } = await GET(`${BASE}/Conversations?$filter=title eq '${question}'`, alice)
      expect(data.value).toEqual([])
    })
  })

  describe('authorization', () => {
    it('requires an authenticated user', async () => {
      expect(await status(POST(`${BASE}/ask`, { question: 'How do I implement an action?' }))).toBe(401)
    })

    it("hides other users' conversations, messages and sources", async () => {
      const { conversationId } = await ask({ question: 'How do I implement an action?' })

      expect(await status(GET(`${BASE}/Conversations(${conversationId})`, bob))).toBe(404)

      const filter = `$filter=conversation_ID eq ${conversationId}`
      expect((await GET(`${BASE}/Messages?${filter}`, bob)).data.value).toEqual([])
      expect((await GET(`${BASE}/MessageSources`, bob)).data.value).toEqual([])
    })

    it("does not let a user continue another user's conversation", async () => {
      const { conversationId } = await ask({ question: 'How do I implement an action?' })

      expect(await status(POST(`${BASE}/ask`, { conversationId, question: 'And then?' }, bob))).toBe(404)
    })

    it('keeps the API read-only apart from ask', async () => {
      const result = await status(POST(`${BASE}/Conversations`, { title: 'injected' }, alice))
      expect(result).toBe(405)
    })
  })
})
