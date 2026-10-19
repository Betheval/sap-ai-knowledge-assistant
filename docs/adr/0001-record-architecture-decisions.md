# 1. Record architecture decisions

Date: 2026-10-18
Status: Accepted

## Context

This is a portfolio project that will evolve through five phases (minimal backend,
RAG, SAPUI5 frontend, production readiness, SAP AI Core integration). Several
decisions are made up front and will be revisited later. Reviewers of the
repository should be able to understand not only _what_ was built but _why_.

## Decision

We record significant architectural decisions as Architecture Decision Records
(ADRs), following Michael Nygard's format, in `docs/adr/`.

- One decision per file, numbered sequentially: `NNNN-short-title.md`.
- Each ADR has: Status, Context, Decision, Consequences.
- Status is one of `Proposed`, `Accepted`, `Deprecated`, `Superseded by NNNN`.
- Accepted ADRs are immutable. When a decision changes, a new ADR supersedes the
  old one, and only the old ADR's status line is updated.
- New ADRs start from [`template.md`](template.md).

## Consequences

- The reasoning behind the architecture is versioned next to the code.
- Phase 5 (replacing Ollama with SAP AI Core) will be documented as a new ADR
  superseding [ADR 0004](0004-ollama-on-remote-host.md).
- Small overhead for every significant decision.
