# 1. Tenant isolation through a Prisma client extension, deny by default

Date: 2026-08-04 · Status: Accepted

## Context

AMX is multi-tenant and sold on the promise that one organisation's agents, bindings and audit
trail are invisible to another. The usual approach — remember to add `where: { organizationId }`
at every call site — fails the day someone forgets, and the failure is silent.

Prisma's `$use` middleware is deprecated in Prisma 5+. Row-level security in Postgres would
work in production but not in the SQLite development database, so the rule would be enforced in
one environment and not the other.

## Decision

A Prisma client extension (`$extends`, `$allOperations`) is the single choke-point. The active
organisation is carried in an `AsyncLocalStorage` scope entered by `runAsOrg()` / `withOrg()`,
never passed through the call stack.

Every model is explicitly classified as **global** or **tenant-scoped**:

- tenant-scoped reads get `organizationId` injected into `where`;
- tenant-scoped writes get it injected into `data`, and a write that *names* a different
  organisation throws `CrossTenantWriteError` rather than being silently rewritten;
- a tenant-scoped operation with no organisation in scope **throws**;
- `findUnique` by an id belonging to another tenant returns `null` for reads and throws for
  writes — the id is a valid id, it just is not yours;
- a model that is in the schema but in neither list fails a test.

`runAsOrg` is `async` and awaits inside the scope. Prisma promises are lazy: without the await
the query would execute after the ALS scope had already closed, and the tenant would be lost.

## Consequences

- Adding a model is a decision about tenancy, enforced at test time rather than review time.
- The scope is invisible at the call site, so `withOrg(orgId, db => ...)` exists to make it
  visible in review even though the extension is what enforces it.
- System work (seeding, reference data) has to say so explicitly with `runAsSystem()`.
- The Prisma client is cached on `globalThis` only in development. Caching it in test caused
  one Vitest module registry to hand its client — and its ALS binding — to another.

## Alternatives rejected

- **Postgres RLS.** Right answer for a Postgres-only product; wrong one for a product whose
  five-minute quickstart is a SQLite file.
- **A repository layer.** Enforces isolation only for code that goes through it.
- **Passing `organizationId` everywhere.** One forgotten parameter is a breach.
