/**
 * The review loop: field-anchored comments, the parking lot, and the lock.
 *
 * A reviewer's objection has to attach to the *field* it is about, or the
 * changes-requested round becomes a game of guessing which sentence upset
 * someone. The parking lot is the pressure valve: things worth remembering
 * that must not block a gate.
 */
import { appendAuditEvent } from "@/lib/audit/append";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import type { StageKey } from "@/lib/enums";
import { stageByKey } from "@/lib/lifecycle/stages";

export type StageComment = {
  id: string;
  fieldPath: string | null;
  body: string;
  authorUserId: string;
  authorName: string;
  isParkingLot: boolean;
  resolvedAt: Date | null;
  createdAt: Date;
  artifactVersionId: string | null;
  versionNumber: number | null;
  artifactKind: string | null;
};

export type StageLock = {
  locked: boolean;
  /** Plain language, and always paired with the way forward. */
  reason: string;
  nextAction: string;
};

/**
 * A stage locks once its gate is approved.
 *
 * Locked does not mean frozen: editing is still possible, and doing so
 * re-versions the artifact, which cascades the approval to STALE and raises a
 * re-approval task. The lock exists to make that consequence visible *before*
 * someone types, not to prevent the edit.
 */
export async function stageLockState(
  db: AmxPrismaClient,
  agentId: string,
  stageId: StageKey,
): Promise<StageLock> {
  const gate = await db.gate.findFirst({
    where: { agentId, stageId },
    orderBy: { round: "desc" },
    select: { status: true, mode: true },
  });

  const stage = stageByKey(stageId);

  if (!gate || gate.status === "CHANGES_REQUESTED" || gate.status === "STALE") {
    return {
      locked: false,
      reason: "",
      nextAction: "",
    };
  }

  if (gate.status === "APPROVED") {
    return {
      locked: true,
      reason: `${stage.name} has been approved${gate.mode === "SOLO_ATTESTATION" ? " on a self-attestation" : ""}, and the approval covers this exact version.`,
      nextAction:
        "You can still edit it. Doing so creates a new version, marks the approval stale, and raises a re-approval task for the roles that signed it.",
    };
  }

  if (gate.status === "OPEN") {
    return {
      locked: true,
      reason: `${stage.name} is out for review right now.`,
      nextAction:
        "Editing while it is under review would change what the reviewers are looking at, so the review is cancelled and has to be re-submitted.",
    };
  }

  return {
    locked: true,
    reason: `${stage.name} was vetoed.`,
    nextAction: "Resolve the objection in the comments, then re-submit the stage.",
  };
}

export async function loadStageComments(
  db: AmxPrismaClient,
  agentId: string,
  stageId: StageKey,
  userNames: Record<string, string> = {},
): Promise<StageComment[]> {
  const stage = stageByKey(stageId);

  const comments = await db.comment.findMany({
    where: {
      agentId,
      OR: [
        { artifactVersion: { artifact: { kind: { in: [...stage.requiredArtifacts] } } } },
        { artifactVersionId: null, fieldPath: { startsWith: `${stageId}:` } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fieldPath: true,
      body: true,
      authorUserId: true,
      isParkingLot: true,
      resolvedAt: true,
      createdAt: true,
      artifactVersionId: true,
      artifactVersion: {
        select: { versionNumber: true, artifact: { select: { kind: true } } },
      },
    },
  });

  return comments.map((comment) => ({
    id: comment.id,
    fieldPath: comment.fieldPath,
    body: comment.body,
    authorUserId: comment.authorUserId,
    authorName: userNames[comment.authorUserId] ?? "A reviewer",
    isParkingLot: comment.isParkingLot,
    resolvedAt: comment.resolvedAt,
    createdAt: comment.createdAt,
    artifactVersionId: comment.artifactVersionId,
    versionNumber: comment.artifactVersion?.versionNumber ?? null,
    artifactKind: comment.artifactVersion?.artifact.kind ?? null,
  }));
}

export type AddCommentInput = {
  organizationId: string;
  agentId: string;
  stageId: StageKey;
  authorUserId: string;
  body: string;
  /** JSON-pointer path into the artifact, e.g. "/personas/0/ownedDecisions". */
  fieldPath?: string | null;
  isParkingLot?: boolean;
};

export async function addStageComment(
  db: AmxPrismaClient,
  input: AddCommentInput,
): Promise<{ id: string }> {
  const stage = stageByKey(input.stageId);

  // Anchor to the version being reviewed, so a comment keeps meaning after the
  // artifact moves on: it stays attached to the text it was written about.
  const artifact = await db.artifact.findFirst({
    where: { agentId: input.agentId, kind: { in: [...stage.requiredArtifacts] } },
    select: { currentVersionId: true },
  });

  const comment = await db.comment.create({
    data: {
      organizationId: input.organizationId,
      agentId: input.agentId,
      artifactVersionId: input.isParkingLot ? null : (artifact?.currentVersionId ?? null),
      fieldPath: input.isParkingLot
        ? `${input.stageId}:parking-lot`
        : (input.fieldPath ?? `${input.stageId}:general`),
      body: input.body,
      authorUserId: input.authorUserId,
      isParkingLot: input.isParkingLot ?? false,
    },
    select: { id: true },
  });

  return comment;
}

export async function resolveComment(
  db: AmxPrismaClient,
  organizationId: string,
  commentId: string,
  actorUserId: string,
): Promise<void> {
  const comment = await db.comment.update({
    where: { id: commentId },
    data: { resolvedAt: new Date() },
    select: { id: true, agentId: true },
  });

  await appendAuditEvent(db, {
    organizationId,
    type: "comment.resolved",
    subjectType: "Comment",
    subjectId: comment.id,
    actorUserId,
    payload: { agentId: comment.agentId },
  });
}
