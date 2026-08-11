# 13. An invitation is a single-use token, and the only way into a workspace

Date: 2026-08-11 · Status: Accepted

## Context

Peer review is the product's central claim, and until Phase 6 there was no way
to add a second person to an organisation at all. `Invitation` had been in the
schema since Phase 1 with nothing reading or writing it, so every workspace was
permanently single-player and every certification in a customer tenant would
have been self-attested by construction.

The join path is also the most security-sensitive surface in the product: it
grants a role, and roles decide who may sign a gate.

## Decision

One narrow path. An org-admin issues an invitation for one email address and one
role; that produces a 32-byte token with a 14-day expiry. Accepting it creates
the membership and grants exactly that role, once.

The constraints are what make it safe to be the join path:

- **Only an org-admin, only in a mutable tenant.** Both re-checked server-side
  in the library, not in the screen that renders the form.
- **The token never enters the audit trail.** It is the credential; the audit
  event records the email, the role and the expiry.
- **Re-inviting replaces.** Two live tokens for one person is a revocation bug
  waiting to happen, so a new invitation deletes the pending one.
- **The address is checked at accept.** A token presented by a different signed-in
  address is refused, naming the address it was sent to.
- **Single-use, revocable, and expiring**, each tested separately.
- **Tenant-scoped acceptance.** Resolving the token is the one system-scoped
  lookup in the product outside seeding — the holder is by definition not yet a
  member of anything. Everything the acceptance writes happens inside the
  organisation that token names, so a token can only ever add someone to the
  workspace it was issued for.

Delivery is stubbed to the console, as specified, *and* the link is shown to the
admin who created it. A deployment without mail configured must still be able to
invite someone.

## Consequences

- A workspace can reach genuine peer certification, which is the difference
  between the TEAM tier and a demo.
- Granting a role is now an ordinary, audited administrative act — and still
  cannot approve anything: whether a role holder may decide a given gate is
  re-derived by the gate engine at decision time.
- Removing the last org-admin is refused. A workspace with no admin cannot
  invite anyone, cannot fix its own roles, and cannot undo the change that
  stranded it.

## Alternatives rejected

- **Open sign-up by email domain.** Convenient, and it makes "who approved this"
  answerable only as "someone with a company address".
- **Admin creates the account and sets a password.** Means an admin knows a
  reviewer's credentials — which quietly undermines every approval that reviewer
  signs.
