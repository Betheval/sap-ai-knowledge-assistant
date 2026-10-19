import type { RetrievedChunk } from '../../ports/retriever'

/**
 * Short summaries of a few Capire sections, written for this project, so the
 * app can show sources before real retrieval exists (phase 2). The links point
 * to the original documentation (Apache-2.0, SAP SE and contributors).
 */
export const SAMPLE_CHUNKS: Omit<RetrievedChunk, 'score'>[] = [
  {
    id: 'custom-actions-defining',
    title: 'Custom Actions and Functions › Defining Custom Actions',
    url: 'https://cap.cloud.sap/docs/guides/services/custom-actions#defining-custom-actions',
    content:
      'Actions and functions are declared in a CDS service definition with the `action` and `function` ' +
      'keywords. Actions may change data, functions only read. They can be unbound (part of the service) ' +
      'or bound to an entity, declared in an `actions { ... }` block.\n\n' +
      '```cds\nservice CatalogService {\n  action submitOrder(book: Books:ID, quantity: Integer);\n}\n```',
  },
  {
    id: 'custom-actions-implementing',
    title: 'Custom Actions and Functions › Implementing Actions',
    url: 'https://cap.cloud.sap/docs/guides/services/custom-actions#implementing-actions',
    content:
      'In Node.js, actions are implemented by registering an `on` handler with the action name in the ' +
      'service implementation. Parameters arrive in `req.data`; the handler returns the result.\n\n' +
      "```js\nthis.on('submitOrder', async req => {\n  const { book, quantity } = req.data\n  // ...\n})\n```",
  },
  {
    id: 'authentication-xsuaa',
    title: 'Authentication › XSUAA Authentication',
    url: 'https://cap.cloud.sap/docs/guides/security/authentication#xsuaa-auth',
    content:
      'For production on SAP BTP, a CAP application can use XSUAA for authentication. Running ' +
      '`cds add xsuaa` adds the `@sap/xssec` dependency, sets `cds.requires.auth` to `xsuaa` and generates ' +
      'an `xs-security.json` with scopes and role templates derived from the roles used in the CDS model.',
  },
  {
    id: 'authentication-mocked',
    title: 'Authentication › Mock User Authentication',
    url: 'https://cap.cloud.sap/docs/guides/security/authentication#mock-user-authentication',
    content:
      'During development CAP uses mocked authentication with preconfigured users such as alice and bob. ' +
      'Custom mock users with passwords and roles are defined under `cds.requires.auth.users` in the ' +
      'project configuration.',
  },
  {
    id: 'authorization-restrict',
    title: 'CAP-level Authorization › @restrict',
    url: 'https://cap.cloud.sap/docs/guides/security/authorization#restrict-annotation',
    content:
      'The `@restrict` annotation grants events (READ, CREATE, ...) to roles and can add instance-based ' +
      "conditions with `where`, for example `@restrict: [{ grant: 'READ', where: 'createdBy = $user' }]` " +
      'so users only see their own records. `@requires` restricts a whole service to a role.',
  },
  {
    id: 'deploy-cf-build-and-deploy',
    title: 'Deploy to Cloud Foundry › Build and Deploy',
    url: 'https://cap.cloud.sap/docs/guides/deploy/to-cf#build-and-deploy',
    content:
      'A CAP application is deployed to Cloud Foundry as a multi-target application. `cds add mta` ' +
      'generates an `mta.yaml`; `mbt build` assembles the archive and `cf deploy` deploys it, creating the ' +
      'required service instances such as the database and XSUAA. `cds up` combines build and deploy.',
  },
]
