# 9. Solo mode is a recorded self-attestation, never a silent approval

Date: 2026-08-05 · Status: Accepted

## Context

Single-player value has to come before multi-player: one practitioner must be able to charter
an agent, see the coverage matrix and export an evidence pack before a second human is
involved. But gates exist precisely so that one person cannot sign off their own work, and
weakening that for the Free tier would make every certification meaningless.

## Decision

A gate may be satisfied by the author alone only if they tick a solo attestation and write a
statement in their own words. That produces a real `Approval` row through the same
`recordDecision()` path, marked as a self-attestation, and the agent's certification is
`SELF_ATTESTED` — a visually distinct badge from `PEER_CERTIFIED`, everywhere it appears,
including the marketplace listing and the evidence pack.

Feature flags gate *features* by plan tier. They never gate governance rules: a Free-tier
attestation is recorded exactly as an Enterprise one is.

## Consequences

- A solo practitioner reaches a published agent in one sitting, and the artifact says out loud
  what kind of review it got.
- "Self-attested" is a first-class certification state, so every screen, filter and export has
  to handle it — which is the point.
- Workspaces that require more can set `requireApproverCredentials`, at which point an approver
  role that names a credential may only be exercised by a member holding it. That is why the
  academy path to a credential is tested end to end.

## Alternatives rejected

- **Let Free-tier gates auto-approve.** Produces certifications that mean nothing.
- **Block publication without a second human.** Kills single-player value, which kills adoption.
