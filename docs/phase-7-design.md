# Phase 7 Design — the Enterprise surface, and the gaps we named

Phase 6 ended by listing what was still missing rather than leaving it to be
discovered: `apiAccess` was a flag with no API, `ssoStub` was a flag with no
implementation, no accessibility audit had been done, and no test had ever run
against Postgres. This phase takes those four in order.

Three of them are now built. The fourth — running against a live Postgres — is
partly closed, and this document is explicit about which part.

---

## 1 · A read-only API

Five endpoints under `/api/v1`, authenticated by a bearer token, described in
[ADR 15](adr/0015-a-read-only-api-with-hashed-tokens.md).

The two decisions that shaped it:

**There are no write endpoints, and that is the feature.** An approval is an act
by a named human at a gate, with a role, a comment, and a place in a hash chain.
A bearer token is not a person. The router answers 405 to every write shape and
a test asserts it, so "we could add POST later" cannot happen by accident.

**A token is a credential, so it is treated like one.** 32 random bytes, shown
once to the admin who issued it, stored only as SHA-256 with a 12-character
prefix kept in clear so two tokens can be told apart. Comparison is
constant-time. The plan is re-checked per request, so a workspace that leaves
Enterprise stops answering with a 403 — a real token, an unentitled plan — while
a revoked token gets a 401.

`/api/v1/audit` is gated on `auditExport`, not `apiAccess`: reading the
catalogue and exporting the organisation's entire decision history are different
decisions, and they have different flags even though both are Enterprise today.
Approvals come back as role, decision and self-attestation flag — never names.

What an integration gets that it could not get before: every agent with its
certification state, and every binding with *both* the contract version it was
approved against and the product's current one, so drift is computable without a
second call.

## 2 · Accessibility

`e2e/accessibility.spec.ts` runs axe against WCAG 2.1 A and AA on thirteen
screens — the landing page, the whole demo surface, sign-in, onboarding, the
agents list, an agent, the coverage matrix, the certification scorecard, and
workspace settings — and fails on any violation rather than reporting a score.

It found four real defects, two of them in the design system itself:

**`--muted` failed AA where it is actually used.** `#5B7A94` clears 4.5:1 on
white and was presumably checked there — but muted text mostly sits on `--panel`
(4.0:1) and `--band` (3.7:1), which is a fail. It is now `#4C667C`: 6.0 on white,
5.4 on panel, 4.9 on band.

**Links were distinguished by colour alone**, which WCAG 1.4.1 does not allow
and a reader with low colour vision cannot use. Links are now underlined by
default, with buttons and nav opting out through the shape they already have.
On tinted surfaces links use `--brand-deep` (6.1:1) instead of `--brand-primary`
(4.4:1), through a `:where()` rule so a call-to-action styled as a button still
wins.

**The primary button had been rendering with the wrong text colour.**
`tailwind-merge` resolves conflicts by class group and only knows Tailwind's own
groups. The design system adds `text-page-title`, `text-section-title` and
`text-body`; out of the box the merger reads those as text *colours* — the other
thing `text-…` can mean — so `cn("… text-surface …", "text-body")` silently
dropped `text-surface`, and the primary button rendered ink-on-blue. Teaching
`cn()` the three custom sizes fixes the whole class of bug rather than one
button. Nothing but an automated contrast scan was ever going to catch this.

**The header put the signed-in user's name at 70% opacity** on the brand band,
below AA. De-emphasis is not worth an unreadable name.

Automated scanning catches perhaps half of what a real audit would. This is a
floor, not a certificate — no screen reader has been used, and keyboard-only
navigation has not been walked by a person.

## 3 · SSO

An optional generic OIDC provider, configured per deployment, absent entirely
when unconfigured. [ADR 16](adr/0016-sso-authenticates-it-never-authorises.md)
carries the reasoning; the short version is in the title.

The tempting design — map IdP groups to roles — would put AMX's approval
authority inside a system AMX does not govern, and would make the audit trail
say "a human approved this" when what happened was a group membership change.
So a successful SSO sign-in proves identity and nothing else: joining a
workspace is still an invitation, roles are still granted by an admin, and AMX
asks for `openid email profile` and nothing about groups, because it would not
honour them if it got them.

**Unverified against a live identity provider.** The wiring, the absence when
unconfigured, and the scope and linking rules are tested; no round trip with a
real IdP has been performed in this repository.

## 4 · Postgres

`pnpm check:postgres` rewrites the datasource block to `postgresql` in a temp
copy of the schema, validates it, and renders the full DDL — 40 tables, 68
indexes, 955 lines — failing if Prisma cannot. It needs no running database,
which is why it is cheap enough to sit inside `pnpm verify`.

That closes the *schema* half of ADR 12's claim and keeps it closed: a
SQLite-only feature added on a Tuesday would now fail the build instead of
failing a production deploy.

It does not close the runtime half, and this environment cannot: there is no
Docker daemon available here, so no live Postgres run has happened. Concurrency,
isolation levels and driver differences remain unexercised. `docker-compose.yml`
is in the repository for a machine that can.

## 5 · Verification

`pnpm verify` — typecheck, lint, 9 packs, the Postgres schema check, **224 tests
in 15 files**, build — and `pnpm test:e2e` (**30 tests, Chromium, against a
production build**) both pass.

Phase 7 adds 12 unit tests (token issuance, hashing, revocation, plan downgrade,
cross-tenant isolation, last-used tracking; SSO presence, absence, scopes and
linking) and 9 browser tests (issuing a token and the once-only display, reading
the catalogue, the 401/403/404/405 surface, the audit chain, revocation taking
effect immediately, and three accessibility sweeps).

**Not verified:** a live Postgres run; a live identity provider; email delivery,
which remains a console stub by specification; non-Chromium browsers; and a
human accessibility audit with a screen reader.
