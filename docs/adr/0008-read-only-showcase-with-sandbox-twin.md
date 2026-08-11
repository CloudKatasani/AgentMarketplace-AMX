# 8. The showcase tenant is read-only; a sandbox twin carries the writes

Date: 2026-08-11 · Status: Accepted

## Context

Two product principles collide. Demo mode is a first-class feature: a fully seeded showcase
tenant exists at all times and cannot be broken. And the demo's money moment is a *write* —
publish a breaking contract version, watch the certification go STALE in front of the customer.

The first cut had the presenter sign in as a data-product owner and bump the contract in the
showcase tenant. It could not work: the tenant is read-only server-side, so the publish control
is not rendered at all. The end-to-end test caught it, which is the argument for having one.

## Decision

`pnpm seed` builds the same utility tenant twice from one function:

- **`amx-demo-utility`** — sealed read-only at the end of the walk. This is what
  "Explore the live demo" opens, and the public demo account is a member of this tenant only.
- **`amx-demo-utility-sandbox`** — identical seed, identical eight-stage walk through the real
  gate engine, left mutable. The demo users are members; the public viewer is not.

The header gained a workspace switcher, so the presenter changes workspace on screen rather
than signing out. The cookie naming the active workspace is re-checked against `Membership` on
write and on every read, so it can only ever be a preference.

## Consequences

- The demo can be run destructively, live, every day, and reset with `pnpm seed` on a fresh
  database — while the showcase stays pristine for anyone browsing the same deployment.
- The end-to-end test asserts both halves: the certification goes STALE in the sandbox, *and*
  the showcase one tenant over is untouched.
- Seeding takes roughly twice as long. It is a seed.

## Alternatives rejected

- **Make the showcase writable and reset it on a timer.** Two demos at once break each other,
  and a principle with a timer on it is not a principle.
- **Fake the cascade for the demo.** The reason the money moment lands is that it is real.
