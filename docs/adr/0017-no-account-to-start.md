# 17. Starting a workspace asks for nothing, and the catalogue asks for less

Date: 2026-08-11 · Status: Accepted

## Context

Time-to-first-wow under ten minutes is the first product principle, and the
onboarding flow spent the first of those minutes on a form: name, email,
password, before anyone had seen a screen. Worse, the whole industry catalogue —
the thing that answers "what would this put in front of *my* analysts?" — sat
behind that form too, even though packs contain nothing tenant-specific.

Two separate asks fell out of that: let people read the catalogue, and let them
open a workspace without an account.

## Decision

**The catalogue is public.** `/catalog` and `/catalog/{industry}` render from
the packs on disk — personas, questions with the certified metric that answers
each one, data products with their contracts and metrics, regulatory prompts,
academy paths, glossary. No session, no tenant, no database. Nothing there
belongs to anybody, so nothing there needs protecting.

**The industry choice is the sign-up.** Onboarding is one screen. Picking an
industry mints a guest identity server-side — a reserved
`@guest.amx.local` address and a random password used once, in-process, to
establish the session — seeds the workspace exactly as before, and lands the
person on their own agent. Nobody is asked for anything.

**A guest workspace is an ordinary workspace.** FREE tier, real gates, real
audit trail, real artifacts. It is not a sandbox, a trial mode, or a preview; a
guest can author every stage and self-attest their way to a published agent, and
`e2e/full-walk.spec.ts` does exactly that.

**Claiming updates the same user row.** Adding a name, email and password sets
them on the existing `User`, so memberships, roles, authored artifacts and every
audit event that names that actor stay pointed at the same id. An approval signed
before the claim is still that person's approval afterwards — which is why the
audit trail records an actor id rather than an email.

**The one thing a guest cannot do is invite.** An invitation grants a role, and a
role decides who may sign a gate. Handing that out from an identity nobody can
contact would put a name in the audit trail that reaches no one. The refusal
says so and points at the claim form.

## Consequences

- The funnel is: read the catalogue → open a workspace → claim it when it starts
  to matter. Each step asks for exactly as much as it needs and no more.
- Guest workspaces accumulate. They are ordinary tenants, so archiving stale
  unclaimed ones is a housekeeping job a deployment will eventually want; none
  ships today, and that is named here rather than left to be discovered.
- The session context now reads name, email and guest status from the user row
  rather than the JWT, so a claim takes effect on the next render instead of the
  next sign-in.
- Sign-in is no longer the front door. It exists for people who already have an
  account and for invitees, and the page says so.

## Alternatives rejected

- **A read-only "try it" sandbox.** Cheaper, and it teaches people that what they
  did does not count — which is the opposite of the product's argument.
- **Email-only magic links.** Still asks for an email, and adds a mail transport
  to the critical path of the first minute.
- **Keeping the catalogue behind sign-up for lead capture.** The catalogue is the
  argument. Charging for it in email addresses is charging before the argument
  lands.
