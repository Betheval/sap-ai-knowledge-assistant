# 17. Observability: structured logs, correlation IDs, stage timings and traces

Date: 2026-10-25
Status: Accepted

## Context

An answer takes 7–15 seconds, split across query rewriting, embedding, hybrid
search and generation, on a remote model host ([ADR 0004](0004-ollama-on-remote-host.md)).
Without measurements it is unclear where the time goes, and in production an
error must be traceable from the user's report to the log lines of that request.

## Decision

**Logs**

- Production uses CAP's JSON log format (`[production].log.format = json`). CAP
  adds the `correlation_id` to every record and masks sensitive headers
  (`authorization`, `cookie`, certificates, API keys) by default; user IDs are
  not logged.
- Each question produces one structured record from the `knowledge` logger:
  `message: "answered"` plus conversation and message IDs, follow-up and
  abstention flags, model, number of sources and citations, total latency,
  `rewriteMs`, `retrievalMs`, `generationMs`, and prompt/output tokens. The
  fields are top-level JSON fields, so a log platform can filter on them.
- The Ollama adapter logs when a request had to wait for the model to be loaded
  into the GPU, which explains slow first requests.

**Correlation IDs**

- CAP takes the request ID from `X-Correlation-ID` (or `X-Request-ID`, or Cloud
  Foundry's `X-Vcap-Request-ID`), generates one otherwise, and returns it in the
  `X-Correlation-ID` response header.
- The UI sends its own ID with every question and shows it in error messages
  ("Reference: …"), so a user's report leads directly to the log lines.

**Traces**

- `@cap-js/telemetry` (OpenTelemetry) traces HTTP requests, CAP services and
  database statements. The assistant adds its own spans: `rag.rewrite`,
  `rag.retrieve` (with `retriever.embed` and `retriever.search`) and
  `rag.generate` (with `llm.chat`, carrying model and token counts as
  `gen_ai.*` attributes).
- The use case does not depend on OpenTelemetry: it accepts an optional stage
  runner and measures timings itself; the service passes a runner that opens a
  span per stage.
- Telemetry prints traces to the console by default. It is off in everyday
  development (`NO_TELEMETRY=true` in `npm run watch`) and on with
  `npm run watch:trace` and in production; the exporter for SAP BTP (Cloud
  Logging) is chosen with the deployment ([ADR 0004](0004-ollama-on-remote-host.md), phase 4).

### First measurement

One question with a cold embedding model: retrieval 2,049 ms, of which
embedding 2,017 ms and hybrid SQL search 32 ms; generation 11,016 ms; database
writes ~75 ms. With warm models: retrieval 1,551 ms, generation 6,036 ms
(2,680 prompt and 310 output tokens).

## Consequences

- Latency can be attributed to a stage per request, and compared between
  providers in phase 5.
- In development, `cds-plugin-ui5` replaces CAP's log formatter with a colored
  one, so JSON logs only appear without it (production installs no dev
  dependencies; locally `CDS_PLUGIN_UI5_NO_CUSTOM_LOGGER=1`).
- The "answered" record relies on CAP's JSON formatter merging objects that have
  a `message` property; a change in that behavior would put the fields back into
  the message text, without losing them.
