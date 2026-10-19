# 9. Capire as the documentation corpus

Date: 2026-10-18
Status: Accepted

## Context

The assistant needs a documentation corpus that covers CAP development,
authentication with XSUAA and deployment to Cloud Foundry, and that we are
legally allowed to process and quote.

- Capire, the official CAP documentation, is published at
  [github.com/cap-js/docs](https://github.com/cap-js/docs) under the
  **Apache License 2.0** (`Files: *` in its REUSE metadata, copyright SAP SE and
  contributors). It covers CAP, XSUAA-based authentication and Cloud Foundry deployment.
- Content on help.sap.com is not open source and is not covered by that license.
- Apache 2.0 grants no trademark rights (section 6).

## Decision

**Source and licensing**

- The corpus is Capire only. We will not scrape help.sap.com or other SAP
  properties.
- Capire is **not vendored** into this repository. The ingestion script clones
  `cap-js/docs` at a pinned commit, and each document records the commit SHA.
- Every answer links to the original page on `cap.cloud.sap/docs/...`. The README
  credits the corpus, its license and copyright holders.
- The README and the UI show the notice: _"Independent portfolio project. Not
  affiliated with or endorsed by SAP SE."_

**Processing**

- Markdown is split by headings (H2/H3) into chunks of roughly 300–800 tokens.
  Code blocks are never split.
- Each chunk keeps its heading breadcrumb (for example
  `Providing Services › Actions`), source path and public URL.
- VitePress-specific syntax (`::: tip`, code groups, custom components) is
  normalized to plain Markdown before chunking.

## Consequences

- The use of the corpus complies with its license; attribution happens naturally
  through the displayed sources.
- Indexing is reproducible from the pinned commit; updating the corpus is a
  deliberate change of that commit.
- Topics covered only on help.sap.com (for example some BTP cockpit procedures)
  are out of scope, and the assistant abstains on them ([ADR 0008](0008-grounded-answers-citations-and-abstention.md)).
- The project name "SAP AI Knowledge Assistant" is final. Because it contains the
  SAP trademark, the non-affiliation notice is mandatory in the README and the UI,
  and no SAP logos or visual branding are used.
