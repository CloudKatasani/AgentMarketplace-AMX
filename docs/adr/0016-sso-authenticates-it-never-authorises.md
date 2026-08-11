# 16. SSO authenticates; it never authorises

Date: 2026-08-11 · Status: Accepted

## Context

`ssoStub` was an Enterprise flag with nothing behind it, and the name was
honest about that. Enterprise buyers do ask for SSO — but the interesting design
question is not the protocol, it is what a successful sign-in is allowed to
mean.

The tempting answer is the usual one: map IdP groups to roles, so the buyer's
directory drives who can approve. That would put AMX's approval authority inside
a system AMX does not govern. Someone added to `AMX-Approvers` in a directory
would become a signer of certifications, and the audit trail would say a human
approved something when what actually happened was a group membership change.

## Decision

An optional generic OIDC provider, configured per deployment by three
environment variables, and **absent entirely** when they are unset — a sign-in
screen never advertises a door that is not there.

What a successful SSO sign-in does: proves who someone is, and signs them into
an AMX account that already exists with that verified address.

What it does not do: create an account, create a membership, or grant a role.
Joining a workspace is still an invitation ([ADR 13](0013-invitations-and-the-second-human.md));
roles are still granted by an org-admin and recorded. AMX requests
`openid email profile` and nothing about groups, because it would not honour
them if it got them — and asking for a claim you intend to ignore is worse than
not asking.

Account linking on unverified email is off. That is precisely how a
misconfigured directory takes over an existing account.

## Consequences

- A buyer gets the sign-in experience they asked for without gaining a way to
  mint approvers.
- Provisioning is not solved: someone must still be invited. For a product whose
  claim is that a named human approved each thing, that is the right friction.
- Configuration is per deployment, not per tenant. Per-tenant IdP routing is a
  real feature with real discovery requirements; pretending otherwise in a plan
  flag would be worse than saying so.
- **Unverified against a live identity provider.** The wiring, the absence when
  unconfigured, and the scope and linking rules are tested; no test in this
  repository has completed a round trip with a real IdP.

## Alternatives rejected

- **Group-to-role mapping.** The whole point of the product is that a named
  person approved something. Directory membership is not that.
- **Just-in-time account creation.** Silently converts "anyone in the buyer's
  directory" into "member of this workspace".
- **Leaving it a stub.** A flag that promises a feature nobody built is worse
  than a documented boundary.
