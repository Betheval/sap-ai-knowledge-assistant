# 12. Mocked authentication now, XSUAA in phase 4

Date: 2026-10-18
Status: Accepted

## Context

Conversations are personal: a user must only see their own history. Production
on SAP BTP will use XSUAA, but setting it up early would slow down phases 1–3
without adding value to local development.

## Decision

- During development and tests we use CAP's `mocked` authentication with two
  users (`alice`, `bob`), both with the role `KnowledgeUser`.
- The service requires `KnowledgeUser` (`@requires`), and `Conversations` and
  `Messages` are restricted to their creator (`@restrict` with
  `where: createdBy = $user`).
- In phase 4 we switch the production profile to `auth: xsuaa` and add
  `xs-security.json` with the same role. The authorization annotations do not change.

## Consequences

- Per-user isolation is designed and tested from phase 1.
- Moving to XSUAA is a configuration change plus a role collection, not a code change.
- Mocked credentials exist only in the development and test profiles.
