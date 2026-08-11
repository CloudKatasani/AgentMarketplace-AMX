/**
 * `requestTransition` — the only way a gate opens.
 *
 * It evaluates the stage's exit criteria and refuses with the failing criteria
 * when anything blocking is unsatisfied. It never approves anything: opening a
 * gate and deciding a gate are separate functions on purpose, so there is
 * exactly one place in the codebase where an approval can be written.
 */
import { appendAuditEvent } from "@/lib/audit/append";
import { track } from "@/lib/analytics";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import type { StageKey } from "@/lib/enums";
import { loadStageContext } from "@/lib/lifecycle/context";
import { STAGES, evaluateExitCriteria, stageByKey } from "@/lib/lifecycle/stages";
import type { CriterionResult } from "@/lib/lifecycle/types";

import { computeStageSnapshot } from "./snapshot";
import { assertMutable, requireMembership } from "./authorization";

export type TransitionRequest = {
  organizationId: string;
  agentId: string;
  stageId: StageKey;
  actorUserId: string;
  /**
   * Solo self-review. Permitted only when the stage allows it and the actor
   * holds an approver role for that stage; always labelled in the audit trail.
   */
  requestSoloAttestation?: boolean;
};

export type TransitionResult =
  | { ok: true; gateId: string; round: number; mode: "PEER" | "SOLO_ATTESTATION"; snapshotHash: string }
  | { ok: false; reason: "CRITERIA_UNMET"; blockers: CriterionResult[]; results: CriterionResult[] }
  | { ok: false; reason: "ARTIFACTS_MISSING"; missingKinds: string[] }
  | { ok: false; reason: "ALREADY_OPEN"; gateId: string }
  | { ok: false; reason: "NOT_PERMITTED"; detail: string };

export async function requestTransition(
  db: AmxPrismaClient,
  input: TransitionRequest,
): Promise<TransitionResult> {
  const stage = stageByKey(input.stageId);

  const guard = await assertMutable(db, input.organizationId);
  if (!guard.ok) return { ok: false, reason: "NOT_PERMITTED", detail: guard.detail };

  const membership = await requireMembership(db, input.organizationId, input.actorUserId);
  if (!membership.ok) return { ok: false, reason: "NOT_PERMITTED", detail: membership.detail };

  const ctx = await loadStageContext(db, input.organizationId, input.agentId, input.stageId);
  if (!ctx) return { ok: false, reason: "NOT_PERMITTED", detail: "Agent not found." };

  // Every earlier stage must already be approved.
  //
  // Without this, an agent can be walked straight to Stage 8 and published
  // while its charter was never signed — the lifecycle would be eight forms
  // rather than eight gates. Checked here because requestTransition is the
  // only way a gate opens.
  const earlier = STAGES.filter((candidate) => candidate.ordinal < stage.ordinal);
  if (earlier.length > 0) {
    const approvedStageIds = new Set(
      (
        await db.gate.findMany({
          where: { agentId: input.agentId, status: "APPROVED" },
          select: { stageId: true },
        })
      ).map((gate) => gate.stageId),
    );
    const unapproved = earlier.filter((candidate) => !approvedStageIds.has(candidate.key));
    if (unapproved.length > 0) {
      return {
        ok: false,
        reason: "NOT_PERMITTED",
        detail: `${stage.name} cannot be submitted until the earlier stages are approved. Still open: ${unapproved.map((candidate) => candidate.name).join(", ")}.`,
      };
    }
  }

  const evaluation = evaluateExitCriteria(stage, ctx);
  if (!evaluation.canSubmit) {
    return {
      ok: false,
      reason: "CRITERIA_UNMET",
      blockers: evaluation.blockers,
      results: evaluation.results,
    };
  }

  const snapshot = await computeStageSnapshot(db, input.agentId, input.stageId);
  if (snapshot.missingKinds.length > 0) {
    return { ok: false, reason: "ARTIFACTS_MISSING", missingKinds: snapshot.missingKinds };
  }

  const existing = await db.gate.findFirst({
    where: { agentId: input.agentId, stageId: input.stageId, status: "OPEN" },
    select: { id: true },
  });
  if (existing) return { ok: false, reason: "ALREADY_OPEN", gateId: existing.id };

  // Solo mode requires the stage to allow it, the plan to allow it, and the
  // actor to actually hold an approver role for this stage.
  let mode: "PEER" | "SOLO_ATTESTATION" = "PEER";
  if (input.requestSoloAttestation) {
    const policy = stage.soloAttestation;
    if (!policy.allowed) {
      return {
        ok: false,
        reason: "NOT_PERMITTED",
        detail: `${stage.name} cannot be satisfied by a self-review.`,
      };
    }
    if (!policy.allowedForPlans.includes(ctx.organization.planTier)) {
      return {
        ok: false,
        reason: "NOT_PERMITTED",
        detail: `This organisation requires peer review at ${stage.name}.`,
      };
    }
    const holdsApproverRole = membership.roleKeys.some((role) =>
      stage.requiredApproverRoles.includes(role),
    );
    if (!holdsApproverRole) {
      return {
        ok: false,
        reason: "NOT_PERMITTED",
        detail: `A self-review at ${stage.name} requires one of: ${stage.requiredApproverRoles.join(", ")}.`,
      };
    }
    mode = "SOLO_ATTESTATION";
  }

  const result = await db.$transaction(async (tx) => {
    const stageRun = await tx.stageRun.upsert({
      where: { agentId_stageId: { agentId: input.agentId, stageId: input.stageId } },
      update: { status: "SUBMITTED", submittedAt: new Date() },
      create: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        stageId: input.stageId,
        status: "SUBMITTED",
        startedAt: new Date(),
        submittedAt: new Date(),
      },
      select: { id: true },
    });

    const lastRound = await tx.gate.findFirst({
      where: { agentId: input.agentId, stageId: input.stageId },
      orderBy: { round: "desc" },
      select: { round: true },
    });
    const round = (lastRound?.round ?? 0) + 1;

    const gate = await tx.gate.create({
      data: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        stageId: input.stageId,
        stageRunId: stageRun.id,
        round,
        mode,
        status: "OPEN",
        quorum: mode === "SOLO_ATTESTATION" ? 1 : stage.quorum,
        snapshotHash: snapshot.hash,
      },
      select: { id: true, round: true },
    });

    await appendAuditEvent(tx as AmxPrismaClient, {
      organizationId: input.organizationId,
      type: "gate.opened",
      subjectType: "Gate",
      subjectId: gate.id,
      actorUserId: input.actorUserId,
      payload: {
        agentId: input.agentId,
        stageId: input.stageId,
        round: gate.round,
        mode,
        snapshotHash: snapshot.hash,
        artifactVersionIds: snapshot.versionIds,
      },
    });

    return gate;
  });

  await track({
    name: "gate_opened",
    organizationId: input.organizationId,
    userId: input.actorUserId,
    properties: { stageId: input.stageId, mode, round: result.round },
  });

  return {
    ok: true,
    gateId: result.id,
    round: result.round,
    mode,
    snapshotHash: snapshot.hash,
  };
}
