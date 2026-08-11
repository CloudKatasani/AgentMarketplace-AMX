/**
 * The audit trail.
 *
 * `AuditEvent` is append-only at the client level (the tenancy extension
 * rejects update/delete) and hash-chained per organisation: every row carries
 * the hash of its predecessor. That turns "we don't modify the audit log" from
 * a claim into something an auditor can verify with the evidence pack's
 * manifest — which is the whole point of shipping one.
 */
import { auditHash, canonicalize } from "@/lib/hash";
import type { ActorKind, AuditEventType } from "@/lib/enums";

import type { AmxPrismaClient } from "../db/tenancy";

export type AuditInput = {
  organizationId: string;
  type: AuditEventType;
  subjectType: string;
  subjectId: string;
  actorUserId?: string | null;
  actorKind?: ActorKind;
  /** Canonicalised before hashing. Never put PII here beyond the actor id. */
  payload?: Record<string, unknown>;
};

export type AuditRecord = {
  id: string;
  sequence: number;
  hash: string;
};

/**
 * Appends one link to an organisation's chain.
 *
 * Always call inside the same transaction as the change being recorded — an
 * audit event that can be committed without its subject (or vice versa) is
 * worse than no audit event, because it looks authoritative.
 */
export async function appendAuditEvent(
  tx: AmxPrismaClient,
  input: AuditInput,
): Promise<AuditRecord> {
  const previous = await tx.auditEvent.findFirst({
    where: { organizationId: input.organizationId },
    orderBy: { sequence: "desc" },
    select: { sequence: true, hash: true },
  });

  const sequence = (previous?.sequence ?? 0) + 1;
  const payload = canonicalize(input.payload ?? {});
  const prevHash = previous?.hash ?? null;

  const hash = auditHash({
    organizationId: input.organizationId,
    sequence,
    type: input.type,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    payload,
    prevHash,
  });

  const created = await tx.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      sequence,
      actorKind: input.actorKind ?? (input.actorUserId ? "USER" : "SYSTEM"),
      actorUserId: input.actorUserId ?? null,
      type: input.type,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      payload,
      prevHash,
      hash,
    },
    select: { id: true, sequence: true, hash: true },
  });

  return created;
}

export type ChainVerification =
  | { ok: true; length: number }
  | { ok: false; length: number; brokenAtSequence: number; reason: string };

/**
 * Recomputes an organisation's chain from scratch.
 *
 * Used by the audit view and, from Phase 3, by the evidence pack's manifest.
 */
export async function verifyAuditChain(
  client: AmxPrismaClient,
  organizationId: string,
): Promise<ChainVerification> {
  const events = await client.auditEvent.findMany({
    where: { organizationId },
    orderBy: { sequence: "asc" },
  });

  let prevHash: string | null = null;
  for (const [index, event] of events.entries()) {
    if (event.sequence !== index + 1) {
      return {
        ok: false,
        length: events.length,
        brokenAtSequence: event.sequence,
        reason: `Expected sequence ${index + 1}, found ${event.sequence} — an event is missing.`,
      };
    }
    if (event.prevHash !== prevHash) {
      return {
        ok: false,
        length: events.length,
        brokenAtSequence: event.sequence,
        reason: "Recorded previous-hash does not match the preceding event.",
      };
    }
    const expected = auditHash({
      organizationId,
      sequence: event.sequence,
      type: event.type,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      payload: event.payload,
      prevHash,
    });
    if (expected !== event.hash) {
      return {
        ok: false,
        length: events.length,
        brokenAtSequence: event.sequence,
        reason: "Event content does not match its recorded hash — it was altered after the fact.",
      };
    }
    prevHash = event.hash;
  }

  return { ok: true, length: events.length };
}
