# 14. Project conventions

Date: 2026-10-18
Status: Accepted

## Context

The repository is a public portfolio piece and should be readable by an
international audience and consistent across phases.

## Decision

- **Language:** English only: code, comments, README, ADRs, commit messages, UI
  and supported questions. UI texts still live in SAPUI5 i18n files (English
  only), following Fiori practice.
- **Formatting and linting:** ESLint (with `@sap/eslint-plugin-cds`) and Prettier.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:` ...).
- **Configuration:** secrets and host-specific values in `.env` (ignored by git);
  `.env.example` documents every variable.
- **Documentation:** README with architecture overview, setup steps, corpus
  attribution and the non-affiliation notice; decisions in `docs/adr/`.

## Consequences

- Consistent, reviewable history and code style.
- A clean commit history doubles as a changelog for the portfolio.
