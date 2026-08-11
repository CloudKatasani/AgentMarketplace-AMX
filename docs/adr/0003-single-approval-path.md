# 3. `recordDecision()` is the only writer of `Approval`

Date: 2026-08-04 · Status: Accepted

## Context

"Governance is structural, not procedural" only means something if there is no second way to
approve. A helper added in a hurry that writes an `Approval` row directly would not look wrong
in review, and would quietly bypass quorum, veto, credential checks and the audit chain.

## Decision

Two functions own the lifecycle: `requestTransition()` opens a gate, `recordDecision()` closes
one. `recordDecision()` is the only code in the repository that creates an `Approval` row, and
in one transaction it: checks the approver's role and (where the workspace requires it) their
credential, applies quorum and veto, snapshots the gate's inputs into `snapshotHash`, moves the
stage, and appends the audit event.

`requestTransition()` also refuses a stage whose earlier stages are not yet approved — the
sequential rule that keeps stage 8 from being reachable while stage 2 is open.

A test scans the source of `src/` and fails if any file other than the gate engine imports
`db.approval` or calls `approval.create`. It strips comments first, so a file that *describes*
the rule does not trip it.

## Consequences

- Every approval carries the same evidence, because there is only one place that writes one.
- Tests that need an approved stage have to go through the engine. That is slower than writing
  the row, and it is why the seeded demo can be trusted: it walked the same path a customer
  will.
- The engine is a chokepoint for performance too — but a gate decision is a human-speed action.

## Alternatives rejected

- **A code-review convention.** Conventions survive until the first deadline.
- **Database triggers.** Not portable across SQLite and Postgres, and invisible to the reader.
