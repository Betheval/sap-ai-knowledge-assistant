import cds from '@sap/cds'
import { Conversations, Role } from '#cds-models/knowledge'

/**
 * Sample conversations for deployments without a model host (`btp-no-model`
 * profile, ADR 0019). Each user gets them on first access, owned by that user,
 * so the per-user access rules (ADR 0012) apply unchanged. Answers follow the
 * format of real ones: grounded in Capire, with [n] citations.
 */

interface DemoSource {
  title: string
  url: string
  snippet: string
  cited: boolean
}

interface DemoConversation {
  title: string
  question: string
  answer: string
  sources: DemoSource[]
}

const CAPIRE = 'https://cap.cloud.sap/docs'

export const DEMO_CONVERSATIONS: DemoConversation[] = [
  {
    title: 'How do I implement an action in CAP?',
    question: 'How do I implement an action in CAP?',
    answer:
      'Declare the action in your CDS service definition [1]:\n\n' +
      '```cds\nservice CatalogService {\n  action submitOrder (book: Books:ID, quantity: Integer);\n}\n```\n\n' +
      'Then register an `on` handler with the action name in the service implementation; the parameters arrive in `req.data` [2]:\n\n' +
      "```js\nthis.on('submitOrder', async req => {\n  const { book, quantity } = req.data\n  // ...\n})\n```",
    sources: [
      {
        title: 'Custom Actions and Functions › Defining Custom Actions',
        url: `${CAPIRE}/guides/services/custom-actions#defining-custom-actions`,
        snippet:
          'Actions and functions are declared in a CDS service definition with the action and function keywords.',
        cited: true,
      },
      {
        title: 'Custom Actions and Functions › Implementing Actions',
        url: `${CAPIRE}/guides/services/custom-actions#implementing-actions`,
        snippet: 'In Node.js, actions are implemented by registering an on handler with the action name.',
        cited: true,
      },
    ],
  },
  {
    title: 'How do I configure XSUAA authentication?',
    question: 'How do I configure XSUAA authentication?',
    answer:
      'Run `cds add xsuaa`: it adds the `@sap/xssec` dependency, sets `cds.requires.auth` to `xsuaa` for production and generates an `xs-security.json` with the scopes and role templates derived from the roles in your CDS model [1].\n\n' +
      'During development, mocked authentication with predefined users such as alice and bob is used instead [2].',
    sources: [
      {
        title: 'Authentication › XSUAA Authentication › Adding XSUAA',
        url: `${CAPIRE}/guides/security/authentication#adding-xsuaa`,
        snippet:
          'cds add xsuaa adds the dependency, configures the authentication kind and generates xs-security.json.',
        cited: true,
      },
      {
        title: 'Authentication › Mock User Authentication',
        url: `${CAPIRE}/guides/security/authentication#mock-user-authentication`,
        snippet: 'During development CAP uses mocked authentication with preconfigured users.',
        cited: true,
      },
    ],
  },
  {
    title: 'How do I deploy a CAP application to Cloud Foundry?',
    question: 'How do I deploy a CAP application to Cloud Foundry?',
    answer:
      'Deploy it as a multi-target application: `cds add mta` generates the `mta.yaml`, `mbt build` assembles the archive and `cf deploy` deploys it, creating the required service instances [1]:\n\n' +
      '```sh\ncds add mta\nmbt build -t gen --mtar mta.tar\ncf deploy gen/mta.tar\n```\n\n' +
      '`cds up` combines build and deploy in one command [1].',
    sources: [
      {
        title: 'Deploy to Cloud Foundry › Build and Deploy',
        url: `${CAPIRE}/guides/deploy/to-cf#build-and-deploy`,
        snippet: 'mbt build assembles the archive and cf deploy deploys it; cds up combines both.',
        cited: true,
      },
    ],
  },
]

/** Creates the sample conversations for a user who has none yet. Idempotent. */
export async function seedDemoHistory(userId: string): Promise<boolean> {
  const { SELECT, INSERT } = cds.ql
  const existing = await SELECT.one.from(Conversations).columns('ID').where({ createdBy: userId })
  if (existing) return false

  const now = Date.now()
  const entries = DEMO_CONVERSATIONS.map((c, i) => {
    // Spread the samples over the last days, newest first in the list
    const at = new Date(now - (i + 1) * 86_400_000).toISOString()
    const managed = { createdAt: at, createdBy: userId, modifiedAt: at, modifiedBy: userId }
    return {
      ID: cds.utils.uuid(),
      title: c.title,
      ...managed,
      messages: [
        { sequence: 0, role: Role.user, content: c.question, ...managed },
        {
          sequence: 1,
          role: Role.assistant,
          content: c.answer,
          model: 'demo',
          latencyMs: 0,
          ...managed,
          sources: c.sources.map((s, rank) => ({ ...s, rank: rank + 1, score: 1 })),
        },
      ],
    }
  })
  await INSERT.into(Conversations).entries(entries)
  return true
}
