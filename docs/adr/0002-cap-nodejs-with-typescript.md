# 2. SAP CAP on Node.js with TypeScript

Date: 2026-10-18
Status: Accepted

## Context

The assistant answers questions about SAP CAP development, and is itself meant to
showcase SAP BTP development skills. We need a backend framework that provides
data modeling, an OData API consumable by SAPUI5, authentication hooks and a
path to deployment on SAP BTP Cloud Foundry.

## Decision

- We will build the backend with the SAP Cloud Application Programming Model
  (CAP 10) on Node.js 22 or later, the minimum CAP 10 supports.
- We will write all service code in TypeScript with `strict` mode enabled.
- TypeScript is pinned to 6.0.x: TypeScript 7 (the native compiler) is not yet
  supported by `typescript-eslint` and `ts-jest`. Upgrading is a separate change
  once they support it.
- We will use `@cap-js/cds-typer` to generate types from the CDS model, so
  entity types used in handlers stay in sync with the model.
- In development we run the server with `cds-tsx watch`; for production the
  TypeScript sources are compiled before `cds build`.
- The project follows the standard CAP layout: `db/` (domain model), `srv/`
  (services and business logic), `app/` (SAPUI5 frontend, phase 3).

## Consequences

- Strong typing for provider interfaces (see [ADR 0003](0003-provider-abstraction-via-cap-services.md)) and for CDS entities.
- Extra build step and some friction: generated types must be regenerated when
  the CDS model changes (`cds-typer` runs in watch mode during development).
- The stack matches what SAP itself recommends for BTP extensions, which is
  relevant for the portfolio audience.
