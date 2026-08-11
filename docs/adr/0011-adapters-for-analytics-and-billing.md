# 11. Analytics and billing sit behind adapters

Date: 2026-08-04 · Status: Accepted

## Context

The product must be instrumented by default and Stripe-ready, without either dependency
reaching into feature code — a buyer with their own analytics stack or billing relationship
should not be doing surgery.

## Decision

Analytics is a PostHog-shaped interface with `noop` and `console` drivers selected by
`ANALYTICS_DRIVER`. Emission is fire-and-forget: a failing analytics call can never block or
break a request, and payloads carry no PII — the distinct id is a salted hash of the user id,
never an email, and the organisation is identified by its opaque id.

Billing is an interface with a stub implementation covering plan tiers, entitlements and the
upgrade path. Plan tiers drive `src/lib/plans/features.ts`, which gates features only —
never governance rules.

## Consequences

- Tests and end-to-end runs use the `noop` driver, so no test writes to anyone's analytics.
- The stub billing adapter means the upgrade path is designed and demonstrable before a
  payment provider is connected.
- Two indirections exist with one implementation each, which is normally a smell. Here the
  second implementation is the buyer's, and the interface is the deliverable.

## Alternatives rejected

- **Call the vendor SDK directly and swap later.** "Later" means every call site.
- **No analytics until a vendor is chosen.** The events are a product decision, not a vendor
  one, and deciding them late means never having the history.
