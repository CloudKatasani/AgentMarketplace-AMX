# 4. Content-hashed artifact versions, hash-chained audit

Date: 2026-08-04 · Status: Accepted

## Context

An evidence pack is only worth exporting if a regulator can be told what it means. "This agent
was approved" is worth little; "this *exact content* was approved by these people, and the
record has not been reordered since" is the claim AMX is selling.

## Decision

- An `ArtifactVersion` is immutable and identified by the SHA-256 of its canonical JSON. Editing
  an artifact commits a new version; nothing is updated in place.
- `Gate.snapshotHash` records the hashes the gate was opened against, so an approval is bound to
  content rather than to a row that may have moved on.
- `AuditEvent` is append-only, with a per-organisation monotonic `sequence`, a `prevHash` and a
  `hash` over the event and its predecessor. Deleting or reordering an event breaks the chain,
  and the chain is verified by a test.
- Nothing is deleted anywhere: `archivedAt` replaces `DELETE`.

## Consequences

- Re-committing identical content produces the same hash, which makes "nothing actually changed"
  a cheap check rather than a diff.
- Storage grows monotonically. At the volumes this product sees — governance artifacts, not
  telemetry — that is acceptable, and the alternative is not.
- The chain is per organisation. A cross-tenant chain would leak the existence and rate of other
  tenants' activity.

## Alternatives rejected

- **Row versioning with an `updatedAt`.** Cannot answer "what exactly was approved".
- **Signing each event.** Real cryptographic non-repudiation needs key custody the product does
  not yet have; the hash chain is the honest claim at this stage, and the schema leaves room.
