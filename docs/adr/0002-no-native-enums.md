# 2. No database enums; Zod owns every domain

Date: 2026-08-04 · Status: Accepted

## Context

The domain is full of closed sets: binding types, certification statuses, gate decisions, plan
tiers, sensitivity levels. Prisma models these as native enums — but SQLite has no enum type,
so `prisma migrate` refuses them on the development database.

## Decision

Every closed set is a `String` column, with the allowed values defined once in
`src/lib/enums.ts` as Zod schemas, and the doc comment above the column naming them. Zod
validates at the boundary; TypeScript unions are derived from the Zod schemas, so a new value
is added in exactly one place.

## Consequences

- The same schema migrates on SQLite and Postgres unchanged, which is what makes the
  five-minute quickstart possible.
- The database will accept a bad string if something writes around Zod. Two things keep that
  honest: the boundary validation, and the fact that governance-relevant sets (`Approval`
  decisions, gate statuses) are only written by one function.
- Doc comments in `schema.prisma` list the permitted values so the schema still reads as the
  documentation of the domain.

## Alternatives rejected

- **Native enums plus a Postgres-only dev setup.** Costs the quickstart.
- **Lookup tables with foreign keys.** Correct, and heavy: five extra joins to render a badge.
