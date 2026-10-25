// Sample conversations of the `btp-no-model` profile (ADR 0019); the flag is set
// before CAP loads its configuration.
process.env.CDS_DEMO_HISTORY = 'true'

import cds from '@sap/cds'
import path from 'node:path'
import { DEMO_CONVERSATIONS } from '../srv/lib/demo/demo-history'

const { GET } = cds.test(path.join(__dirname, '..'))

const alice = { auth: { username: 'alice', password: 'alice' } }
const bob = { auth: { username: 'bob', password: 'bob' } }
const BASE = '/odata/v4/knowledge'

describe('demo history', () => {
  it('gives each user the sample conversations on first access, once', async () => {
    const first = await GET(`${BASE}/Conversations?$orderby=createdAt desc`, alice)
    const again = await GET(`${BASE}/Conversations`, alice)

    expect(first.data.value.map((c: { title: string }) => c.title)).toEqual(
      DEMO_CONVERSATIONS.map((c) => c.title),
    )
    expect(again.data.value).toHaveLength(DEMO_CONVERSATIONS.length)
  })

  it('stores question, cited answer and sources, owned by the user', async () => {
    const { data } = await GET(
      `${BASE}/Conversations?$expand=messages($orderby=sequence;$expand=sources($orderby=rank))`,
      bob,
    )

    expect(data.value).toHaveLength(DEMO_CONVERSATIONS.length)
    for (const conversation of data.value) {
      expect(conversation.createdBy).toBe('bob')
      const [question, answer] = conversation.messages
      expect(question.role).toBe('user')
      expect(answer).toMatchObject({ role: 'assistant', model: 'demo' })
      expect(answer.content).toMatch(/\[1\]/)
      expect(answer.sources[0].url).toMatch(/^https:\/\/cap\.cloud\.sap\/docs\//)
    }
  })

  it('keeps conversations private per user', async () => {
    const { data } = await GET(`${BASE}/Conversations`, alice)

    expect(data.value.every((c: { createdBy: string }) => c.createdBy === 'alice')).toBe(true)
  })
})
