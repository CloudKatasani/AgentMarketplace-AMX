# Phase 6 Design — the multi-player gaps

`PROMPT.md` defines five phases and they are all built. This phase came from
auditing the finished product against its own specifications rather than from a
new instruction, and it closes the three places where a feature existed in the
schema, in a plan flag, or in a documented mechanism — but nowhere a person
could reach it.

That is the honest description of what was missing, so it is worth being blunt
about each one.

| Promised in | What existed | What was missing |
|---|---|---|
| `PROMPT.md` Phase 1: *"org invite flow (email stubbed to console)"* | the `Invitation` model | every workspace was permanently single-player |
| `CLAUDE.md` layout: `(app)/ … admin …` | nothing | no members screen, no role management, no policy toggle |
| `CLAUDE.md`: *"white-label ready"*, and ADR 7 | `Organization.themeOverride`, unread | rebranding did nothing |

The first of those is not a cosmetic gap. Peer review is the product's central
claim, and with no way to add a second person to an organisation, every
certification a customer could produce would have been self-attested by
construction. The single-player promise was fully built; the multi-player one
had no door.

---

## 1 · Invitations

One narrow path, described in full in
[ADR 13](adr/0013-invitations-and-the-second-human.md): an org-admin issues an
invitation for one email and one role, which produces a 32-byte token with a
14-day expiry; accepting it creates the membership and grants exactly that role,
once.

What the tests pin, each separately, is the set of ways this could go wrong:

- a non-admin cannot invite;
- the token never enters the audit trail — it is the credential, so the event
  records the email, role and expiry instead;
- re-inviting the same address *replaces* the pending invitation, so there is
  never a second live token to forget to revoke;
- a token presented by a different address is refused, naming the address it was
  sent to;
- expired, revoked and already-used tokens are all refused;
- **a token issued by one organisation is invisible inside another.** Resolving
  the token is the one system-scoped lookup in the product outside seeding,
  because the holder is by definition not yet a member of anything. Everything
  the acceptance writes then happens inside the organisation that token names.

Delivery is stubbed to the console as specified — and the link is also shown to
the admin who created it, because a deployment without mail configured must
still be able to invite someone.

## 2 · The settings screen

`/admin`, visible in the nav only to an org-admin and refusing everyone else at
the route (a 404, asserted in the browser). It carries four things:

- **People** — every member, the roles they hold as toggles, and any academy
  credentials they have earned. Granting a role is audited. Removing the *last*
  org-admin is refused: a workspace with no admin cannot invite anyone, cannot
  fix its own roles, and cannot undo the change that stranded it.
- **Invitations** — the form, and the pending list with each link and a revoke.
- **Approver credentials** — the `requireApproverCredentials` policy, which had
  been enforced by the gate engine since Phase 4 with no way to turn it on.
- **Rebranding** — on Enterprise; an upgrade prompt at the boundary otherwise.

Nothing on this screen can approve anything. Roles decide who *may* sign; whether
a role holder may decide a given gate is still re-derived by the gate engine at
decision time, against the database.

## 3 · White-label

[ADR 14](adr/0014-theme-override-is-data.md). The override is data, not CSS:
nine overridable token names, values that must parse to three integers 0–255,
and an emitted string rebuilt entirely from those integers, so no character a
tenant typed reaches the page. Semantic states — success, warning, danger, the
`AI_DRAFT` marker — are deliberately **not** overridable: they carry meaning and
contrast guarantees a rebrand must not be able to repaint.

The end-to-end test asserts both halves, because only one of them is a feature:
the header band changes colour across every screen, and
`red; } body { display: none }` is refused in words.

## 4 · What this changed elsewhere

- `SessionContext` gained `themeOverride`, so the shell can apply it without a
  second query.
- Four analytics events (`org_invited`, `org_joined`, `member_role_changed`,
  `theme_override_saved`) and five audit event types.
- The workspace switcher built in Phase 5 stopped being demo-only furniture:
  someone who accepts an invitation while already signed in genuinely has two
  workspaces now.

## 5 · Verification

`pnpm verify` (typecheck, lint, 9 packs, **212 tests in 13 files**, build) and
`pnpm test:e2e` (**21 tests, Chromium, against a production build**) pass.

Phase 6 adds 18 unit tests — invitation lifecycle, cross-tenant token rejection,
role grant and revoke with audit, the last-admin refusal, non-admin rejection,
the policy toggle, and the theme parser including the injection attempts — plus
four browser tests: the invite, the accept-and-create-account, a genuine peer
approval by the person who accepted, and the rebrand.

**Not verified:** email delivery, which is a stub by specification. SSO, which is
a flag with no implementation behind it and is named as such. `apiAccess` is in
the same position — the flag exists and there is no API; it is listed here rather
than left to be discovered. And, as before: Postgres, non-Chromium browsers, and
a real accessibility audit.
