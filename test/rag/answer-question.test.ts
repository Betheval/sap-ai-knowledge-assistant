import type { ChatMessage, LLMProvider } from '../../srv/lib/ports/llm'
import type { RetrievedChunk, Retriever } from '../../srv/lib/ports/retriever'
import { answerQuestion } from '../../srv/lib/rag/answer-question'
import {
  ANSWER_REMINDER,
  ANSWER_SYSTEM_PROMPT,
  NO_ANSWER,
  REWRITE_SYSTEM_PROMPT,
} from '../../srv/lib/rag/prompts'

function chunk(id: string, content = `Content of ${id}`): RetrievedChunk {
  return { id, title: `Title ${id}`, url: `https://example.org/${id}`, content, score: 1 }
}

function stubLLM(replies: string[], contextWindow = 16384): LLMProvider & { chat: jest.Mock } {
  const chat = jest.fn(async () => ({ content: replies.shift() ?? '', model: 'stub-model' }))
  return {
    contextWindow,
    maxOutputTokens: 1024,
    chat,
    checkHealth: async () => ({ status: 'up', details: {} }),
  }
}

function stubRetriever(chunks: RetrievedChunk[]): Retriever & { search: jest.Mock } {
  return { search: jest.fn(async () => chunks) }
}

const config = { topK: 6, historyMessages: 6 }

describe('answerQuestion', () => {
  it('answers a first question without rewriting it', async () => {
    const llm = stubLLM(['Register an on handler [1].'])
    const retriever = stubRetriever([chunk('a'), chunk('b')])

    const result = await answerQuestion({ llm, retriever, config }, { question: 'How?', history: [] })

    expect(llm.chat).toHaveBeenCalledTimes(1)
    expect(retriever.search).toHaveBeenCalledWith('How?', 6, { runtime: 'node' })
    expect(result).toMatchObject({
      answer: 'Register an on handler [1].',
      rewrittenQuery: 'How?',
      model: 'stub-model',
    })
    expect(result.sources.map((s) => [s.id, s.cited])).toEqual([
      ['a', true],
      ['b', false],
    ])
  })

  it('numbers the excerpts in the prompt and sends the system prompt first', async () => {
    const llm = stubLLM(['ok'])
    await answerQuestion(
      { llm, retriever: stubRetriever([chunk('a'), chunk('b')]), config },
      { question: 'Q', history: [] },
    )

    const messages: ChatMessage[] = llm.chat.mock.calls[0][0]
    expect(messages[0]).toEqual({ role: 'system', content: ANSWER_SYSTEM_PROMPT })
    expect(messages.at(-1)?.content).toContain('[1] Title a')
    expect(messages.at(-1)?.content).toContain('[2] Title b')
    expect(messages.at(-1)?.content).toContain(`Question: Q\n\n${ANSWER_REMINDER}`)
  })

  it('rewrites follow-up questions and retrieves with the rewritten query', async () => {
    const llm = stubLLM(['"How to deploy a CAP app to Cloud Foundry"\nextra line', 'Use cf deploy [1].'])
    const retriever = stubRetriever([chunk('a')])
    const history: ChatMessage[] = [
      { role: 'user', content: 'What is CAP?' },
      { role: 'assistant', content: 'A framework.' },
    ]

    const result = await answerQuestion(
      { llm, retriever, config },
      { question: 'How do I deploy it?', history },
    )

    expect(llm.chat.mock.calls[0][0][0].content).toBe(REWRITE_SYSTEM_PROMPT)
    expect(retriever.search).toHaveBeenCalledWith('How to deploy a CAP app to Cloud Foundry', 6, {
      runtime: 'node',
    })
    expect(result.rewrittenQuery).toBe('How to deploy a CAP app to Cloud Foundry')
  })

  it('answers for Node.js by default and for Java when the conversation is about Java', async () => {
    const llm = stubLLM(['answer [1]', 'How do I register an event handler in CAP Java?', 'answer [1]'])
    const retriever = stubRetriever([chunk('a')])

    await answerQuestion(
      { llm, retriever, config },
      { question: 'How do I register a handler?', history: [] },
    )
    expect(retriever.search).toHaveBeenLastCalledWith('How do I register a handler?', 6, { runtime: 'node' })
    expect(llm.chat.mock.calls[0][0].at(-1).content).toMatch(/Answer for CAP Node\.js\.$/)

    // The follow-up does not say "Java", but its rewrite from a Java conversation does
    const history: ChatMessage[] = [{ role: 'user', content: 'I use CAP Java with Spring Boot.' }]
    await answerQuestion({ llm, retriever, config }, { question: 'How do I register a handler?', history })
    expect(retriever.search).toHaveBeenLastCalledWith('How do I register an event handler in CAP Java?', 6, {
      runtime: 'java',
    })
    expect(llm.chat.mock.calls[2][0].at(-1).content).toMatch(/Answer for CAP Java\.$/)
  })

  it('falls back to the original question when the rewrite is empty', async () => {
    const llm = stubLLM(['   ', 'answer'])
    const retriever = stubRetriever([chunk('a')])
    const history: ChatMessage[] = [{ role: 'user', content: 'Earlier' }]

    await answerQuestion({ llm, retriever, config }, { question: 'Follow-up?', history })

    expect(retriever.search).toHaveBeenCalledWith('Follow-up?', 6, { runtime: 'node' })
  })

  it('abstains without calling the model when nothing relevant is retrieved', async () => {
    const llm = stubLLM([])

    const result = await answerQuestion(
      { llm, retriever: stubRetriever([]), config },
      { question: 'Weather?', history: [] },
    )

    expect(llm.chat).not.toHaveBeenCalled()
    expect(result).toEqual({ answer: NO_ANSWER, rewrittenQuery: 'Weather?', sources: [], model: null })
  })

  it('removes citations without a matching source and logs them', async () => {
    const logger = { warn: jest.fn() }
    const llm = stubLLM(['Claim [1]. Invented [7].'])

    const result = await answerQuestion(
      { llm, retriever: stubRetriever([chunk('a')]), config, logger },
      { question: 'Q', history: [] },
    )

    expect(result.answer).toBe('Claim [1]. Invented.')
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), [7])
  })

  it('only considers the configured number of history messages', async () => {
    const llm = stubLLM(['rewritten', 'answer'])
    const history: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: `message ${i}`,
    }))

    await answerQuestion(
      { llm, retriever: stubRetriever([chunk('a')]), config: { ...config, historyMessages: 4 } },
      { question: 'Q', history },
    )

    const answerMessages: ChatMessage[] = llm.chat.mock.calls[1][0]
    expect(answerMessages.map((m) => m.content).filter((c) => c.startsWith('message'))).toEqual([
      'message 6',
      'message 7',
      'message 8',
      'message 9',
    ])
  })

  describe('token budget', () => {
    // Budget = (2000 - 1024) * 0.9 = 878 tokens, about 3500 characters
    const smallWindow = 2000

    it('drops excerpts that do not fit, keeping the system prompt and the question', async () => {
      const llm = stubLLM(['answer [1]'], smallWindow)
      const big = chunk('big', 'x'.repeat(2400))

      const result = await answerQuestion(
        { llm, retriever: stubRetriever([big, chunk('second', 'y'.repeat(2400)), chunk('small')]), config },
        { question: 'Q', history: [] },
      )

      expect(result.sources.map((s) => s.id)).toEqual(['big', 'small'])
      const messages: ChatMessage[] = llm.chat.mock.calls[0][0]
      expect(messages[0]?.content).toBe(ANSWER_SYSTEM_PROMPT)
      expect(messages.at(-1)?.content).toContain(`Question: Q\n\n${ANSWER_REMINDER}`)
    })

    it('trims history from the oldest message first', async () => {
      const llm = stubLLM(['rewritten', 'answer'], smallWindow)
      const history: ChatMessage[] = [
        { role: 'user', content: 'old '.repeat(300) },
        { role: 'assistant', content: 'recent' },
      ]

      await answerQuestion(
        { llm, retriever: stubRetriever([chunk('a', 'z'.repeat(2000))]), config },
        { question: 'Q', history },
      )

      const contents = (llm.chat.mock.calls[1][0] as ChatMessage[]).map((m) => m.content)
      expect(contents).toContain('recent')
      expect(contents.some((c) => c.startsWith('old'))).toBe(false)
    })

    it('abstains when not even one excerpt fits', async () => {
      const llm = stubLLM([], smallWindow)

      const result = await answerQuestion(
        { llm, retriever: stubRetriever([chunk('huge', 'x'.repeat(10000))]), config },
        { question: 'Q', history: [] },
      )

      expect(llm.chat).not.toHaveBeenCalled()
      expect(result.answer).toBe(NO_ANSWER)
    })
  })
})
