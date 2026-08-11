# Phase 5 Design — hardening: the browser, the scale, and the record

Per `PROMPT.md`: *"Playwright e2e: full 8-stage path to published; rejection loop; both cascade
paths; onboarding under 10 minutes; the complete 7-minute showcase arc; one academy path to
credential; tenant isolation probes. README with five-minute quickstart. ADRs for significant
choices. Performance sanity at ~50 orgs, ~200 agents, ~100 products, ~2,000 questions.
`DEMO.md`: the scripted 7-minute arc with per-step screen, talk track cue, and fallback."*

Phase 5 wrote very little product code on purpose. What it did was **run** the product, at scale
and in a browser, and fix what that found. Five product defects came out of it, which is the
whole argument for the phase.

---

## 1 · What belongs in a browser test, and what does not

Both. `tests/demo-arc.test.ts` walks all eight stages against the engine with a full cast —
author, product owner, data owner, governance officer — which is where the *peer* path lives and
where twenty-four approvals cost nothing. `e2e/full-walk.spec.ts` walks the same eight stages in
Chromium as **one person**, authoring every artifact in the real forms and approving each gate on
a written self-attestation.

They prove different things. The engine test proves the governance holds. The browser walk proves
the forms in front of the criteria can actually be filled in — which is exactly what the last two
defects in §2 were hiding.

So the split is:

| Layer | Proves | Where |
|---|---|---|
| Vitest, real SQLite | the governance holds | `tests/` (194 tests) |
| Playwright, real build | a person can actually do it | `e2e/` (17 tests) |
| `scripts/perf-sanity.ts` | it still holds at 50 tenants | `pnpm perf` |

`e2e/` covers exactly what a human touches with their hands: onboarding inside the ten-minute
budget, the guided tour landing on the coverage matrix, the validator's rejection *and its
suggested fix*, the eight-stage solo walk to published, both cascade directions, a
changes-requested round unlocking the stage, the two isolation probes, one academy path to a
credential, and the seven-minute demo arc step by step.

Both cascade paths are asserted in the browser, not only in the engine: a data product's major
bump invalidating the certifications standing on it (the demo arc's 4:00 step), and an approved
artifact being re-versioned, which makes its own gate stale with the cause in plain language.

Two deliberate choices in that suite:

- **The e2e database is seeded by `pnpm seed`, not a fixture.** The showcase tenant these tests
  walk is the one a customer gets. A fixture would drift from the seed, and the drift would
  surface on stage.
- **`pnpm test:e2e` builds first.** `next start` serves the last build; without the build step
  the suite silently tests stale pages. That cost an hour of debugging a page that was already
  fixed.

## 2 · The five defects the browser found

**The product-view inversion double-counted.** `Everything standing on this` listed one row per
*binding*. An agent that both grounds on and queries Customer 360 — the seeded one does — appeared
twice, and the drift banner counted bindings while calling them agents. It now groups by agent,
showing each binding type as a badge on one row. Playwright's strict mode found this: two links
with the same accessible name is exactly the ambiguity a screen reader user would hit.

**A member of two workspaces could not reach the second.** `SessionContext.memberships` had been
carried since Phase 1, with a comment saying *for the switcher*. Nothing rendered it. The header
now has a switcher; the cookie naming the active workspace is re-checked against `Membership` on
write and on every read, so a forged cookie changes nothing.

**The money moment could not be performed.** The demo's centrepiece is a write — publish a
breaking contract version — and the showcase tenant is read-only server-side, so the publish
control is not rendered at all. This is a genuine collision between two product principles, and
it is recorded as [ADR 8](adr/0008-read-only-showcase-with-sandbox-twin.md). The resolution:
`pnpm seed` now builds the same utility tenant twice from one function — the showcase, sealed
read-only, and `amx-demo-utility-sandbox`, identical and mutable. The public demo account is a
member of the read-only tenant only, so "Explore the live demo" can never land a stranger
somewhere writable.

The end-to-end test asserts both halves of that: the certification goes STALE in the sandbox,
**and** the showcase one tenant over is untouched. A demo that a demo can break is not a demo.

**A published agent never said it was published.** The agent page carried archetype, risk tier,
sensitivity and the certification badge — and nothing at all about lifecycle status. Certification
and lifecycle are genuinely different (an agent can be certified but not yet published, or
published and stale), so they are now two badges, never one.

**The lock promised an edit path that did not exist.** `stageLockState` says, in its own words,
that a locked stage is not frozen: editing re-versions the artifact, cascades the approval to
STALE and raises a re-approval task, and the lock exists to make that consequence visible *before*
someone types. The screen disabled every field and offered no way through — so the second cascade
direction had no user-facing trigger at all. An approved or in-review stage now carries an
**Edit anyway** link that unlocks the forms, alongside the sentence explaining what committing
will cost. It is a deliberate act with its own URL, and the banner offers the way back.

## 3 · Performance sanity

`pnpm perf` builds a throwaway database — 50 organisations, 236 agents, 100 data products, 2,360
questions, with the *measured* tenant deliberately holding 40 of those agents — and times the
queries behind the heaviest screens **through the tenancy extension**, twenty samples each.

| Query | p50 | p95 | Budget |
|---|---|---|---|
| marketplace listing (persona lens, 40 agents) | 9.4 ms | 12.1 ms | 600 ms |
| agent detail (bindings, questions, coverage) | 2.4 ms | 3.0 ms | 350 ms |
| data product detail (the inversion) | 5.2 ms | 6.0 ms | 350 ms |
| audit trail page (50 events) | 1.1 ms | 1.3 ms | 200 ms |
| coverage matrix | 1.2 ms | 4.0 ms | 350 ms |

The same run re-checks isolation at scale: an agent id from the heavy tenant, looked up from
another organisation, returns nothing.

The budgets are loose by an order of magnitude on purpose. This is a tripwire for the class of
change that turns a scan of one tenant into a scan of a table — an N+1 in the marketplace, a
dropped `organizationId` index — not a stopwatch. A skewed tenant is used because the customer
whose marketplace page gets slow first is the one with a disproportionate share of the rows.

Two things this does *not* prove, and they are named here rather than implied away: SQLite hides
write contention that Postgres will not, and no test here exercises concurrent gate decisions
under load.

## 4 · The record

Twelve ADRs in `docs/adr/`, each with context, decision, consequences and what was rejected.
They cover the decisions a reader would otherwise have to reconstruct from the code: the tenancy
extension, the absence of database enums, the single approval path, content hashing and the audit
chain, version-pinned bindings, the validator's heuristic and its limits, the token system, the
showcase/sandbox split, solo attestation, declarative packs, the adapters, and SQLite-vs-Postgres.

They are dated and immutable — a decision that changes gets a new record that supersedes the old
one, because the reasoning that was true then is what makes the change legible now.

`DEMO.md` is the seven-minute arc: per step, the screen, the click, the line, what to watch for,
and a fallback if it does not appear. Its section titles match the test names in
`e2e/demo-arc.spec.ts`, so a failing test points at the slide it ruins.

## 5 · CI

`.github/workflows/ci.yml` runs three jobs on every push and pull request: `pnpm verify`
(typecheck, lint, pack validation, 194 tests, build), the Playwright suite with failure artefacts
retained for seven days, and the performance tripwire.

## 6 · Verification

`pnpm typecheck`, `pnpm lint`, `pnpm pack:validate` (9 packs), `pnpm test` (**194 tests, 12
files**), `pnpm build`, `pnpm test:e2e` (**17 tests, Chromium, against a production build**) and
`pnpm perf` all pass.

**Not verified:** Postgres — the schema is written for both and the docker-compose file is there,
but every test run in this repository has been against SQLite. Firefox and WebKit: the e2e suite
runs Chromium only. Anything involving a live payment provider or a live model API, both of which
remain behind their adapters. And accessibility beyond what Playwright's role-based locators
incidentally assert — there has been no audit with a screen reader.
