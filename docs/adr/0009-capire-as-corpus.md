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

- Pages come from `get-started`, `guides`, `cds`, `node.js`, `java`, `tools`
  and `plugins`. Partials (`_*.md`, `assets/`) are only used through the
  `@include` directives that pull them into pages, and the files Capire excludes
  from its site (`srcExclude`) are skipped.
- Only pages that are **live on the published site** are ingested: the
  repository can be ahead of the deployment (5 pages returned 404 at the pinned
  commit), and an answer must never cite a broken link.
- VitePress-specific syntax is normalized before chunking, outside code blocks
  only: front matter (its `description` replaces `{{ $frontmatter.description }}`),
  `:::` containers and GitHub alerts become labels such as "**Tip:**", links
  become their text, HTML, Vue components, SVG, `[[toc]]` and "Learn more" links
  are removed, `<Config>` snippets become inline code, Node.js/Java variants are
  labeled, and table padding is compacted. Inside code, only `[!code ...]`
  annotations are removed (lines marked `--` are dropped).
- Pages are split by H2/H3 sections into chunks of at most ~800 tokens. Code
  blocks are never split (13 chunks exceed the limit because of a single code
  block, all far below the 8192-token input of bge-m3); large tables are split by
  rows, repeating the header. Near-empty chunks are dropped.
- Each chunk keeps its heading breadcrumb (for example
  `Custom Actions and Functions › Implementing Actions`) and the public URL of
  its section. Anchors use Capire's own slugifier (GitHub style, from its
  VitePress configuration) and custom `{#id}` anchors; 2,625 of 2,628 generated
  anchors were verified against the live site.
- Result at the pinned commit: 206 pages, ~2,950 chunks, median ~170 tokens.
- `npm run ingest -- --dry-run` writes a review report to `.cache/` without
  embedding or storing anything.

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
