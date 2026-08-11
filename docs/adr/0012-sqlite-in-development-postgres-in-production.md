# 12. SQLite in development, Postgres in production

Date: 2026-08-04 · Status: Accepted

## Context

Time-to-first-wow under ten minutes applies to the engineer evaluating the repository as much
as to the buyer. Requiring a database server before `pnpm dev` costs more of that budget than
anything else in the stack.

## Decision

The development and test default is a SQLite file. `docker-compose.yml` provides Postgres, and
the same `schema.prisma` targets both — which is what forces the no-enum decision (ADR 2) and
rules out Postgres-only isolation mechanisms (ADR 1).

Tests run against real SQLite rather than mocks, in a single fork, because the thing most worth
testing is the tenancy extension's interaction with the driver. End-to-end tests get their own
`e2e.db`, seeded from scratch by the product's own seed script.

## Consequences

- Clone, install, seed, run: no services.
- Some Postgres capabilities are off the table by construction: native enums, `citext`, RLS,
  JSONB operators. Every one of those has an in-application equivalent already.
- Anything relying on database-level concurrency behaviour has to be validated on Postgres
  before it is relied on. SQLite's single-writer model hides contention that Postgres will not.
- Prisma's CLI refuses destructive commands for automated agents, so the reset path in
  development is "delete the file and migrate", which happens to be the fastest path anyway.

## Alternatives rejected

- **Postgres everywhere via Docker.** Buys fidelity, spends the ten-minute budget.
- **An in-memory database for tests.** Different driver, so the one thing most worth testing —
  the extension against the real driver — would go untested.
