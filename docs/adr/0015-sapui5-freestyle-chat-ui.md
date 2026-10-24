# 15. SAPUI5 freestyle chat UI

Date: 2026-10-24
Status: Accepted

## Context

Phase 3 adds the user interface: a chat that shows answers with their cited
sources, conversation history, loading states and errors. The backend is an
OData V4 service with an `ask` action and read-only conversation entities
([ADR 0006](0006-odata-v4-api-with-ask-action.md)). Answers take several
seconds ([ADR 0004](0004-ollama-on-remote-host.md)) and are Markdown with
citation markers ([ADR 0008](0008-grounded-answers-citations-and-abstention.md)).

## Decision

- **Freestyle SAPUI5 app in TypeScript** in `app/assistant`. Fiori elements
  floorplans (list report, object page) fit entity maintenance, not a chat.
- **SAPUI5 1.148**, the current long-term maintenance release (until Q3/2027),
  theme `sap_horizon`. Type definitions from `@sapui5/types` of the same version.
- **One development server:** `cds-plugin-ui5` serves the app inside `cds watch`
  at `/assistant/`, and `ui5-tooling-transpile` compiles TypeScript on the fly.
  The app is an npm workspace with its own `ui5.yaml`.
- **Layout:** `sap.m.SplitApp` with the user's conversations on the left and the
  chat on the right; it collapses to one column on phones.
- **Data:** the default OData V4 model reads conversations and messages; `ask`
  is invoked as an unbound action. A JSON view model holds the chat currently on
  screen, so a sent question appears at once and the answer is appended when it
  arrives.
- **Answers:** Markdown is converted to HTML by a small pure-TypeScript renderer
  (`util/markdown.ts`): input is HTML-escaped first, then a fixed subset is
  rendered (paragraphs, lists, headings, emphasis, inline code, fenced code),
  and `[n]` markers become links to the cited Capire section. The result is
  shown in `sap.m.FormattedText`, which sanitizes HTML again. Sources are listed
  under each answer, cited ones first.
- **States:**
  - while waiting, a "Thinking…" item with a busy indicator and the elapsed
    seconds; the input is disabled;
  - errors from `ask` map to specific messages: 503 (model unavailable), 504
    (timeout), 404 (conversation not found), 400 (invalid question), with a retry
    action that re-sends the question;
  - at start-up `/health/llm` is checked and a warning is shown when the model
    host is down;
  - abstentions (no sources) are shown as normal answers, not as errors.
- **Notice:** the footer shows "Independent portfolio project. Not affiliated
  with or endorsed by SAP SE." ([ADR 0009](0009-capire-as-corpus.md)). No SAP
  logos are used.
- **Language:** English texts in `i18n/i18n.properties` ([ADR 0014](0014-project-conventions.md)).

## Consequences

- Backend and UI run with `npm run watch`; no separate UI server or proxy.
- The Markdown renderer is plain TypeScript without UI5 dependencies, so it is
  unit-tested with Jest like the backend.
- The renderer supports only the subset the model produces; tables or nested
  lists are shown as plain text.
- Development uses the mocked basic authentication of the backend
  ([ADR 0012](0012-mocked-auth-now-xsuaa-later.md)): the browser asks for
  `alice`/`alice` on first use. XSUAA and the approuter come in phase 4.
- Answers are not streamed; the elapsed-time indicator covers the wait
  ([ADR 0006](0006-odata-v4-api-with-ask-action.md)).
