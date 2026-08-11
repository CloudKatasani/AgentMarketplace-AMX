/**
 * `recordDecision` — the ONLY path to APPROVED.
 *
 * Nothing else in this codebase may write an `Approval`, set a gate to
 * APPROVED, advance an agent's stage, or change a certification. That is not a
 * convention: `no-path-to-approved.test.ts` greps the source tree and fails the
 * build if any other file does. Governance is structural or it is decoration.
 */
import { track } from "@/lib/analytics";
import { appendAuditEvent } from "@/lib/audit/append";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import type { Decision } from "@/lib/enums";
import { nextStage, stageByKey } from "@/lib/lifecycle/stages";
import { roleName, type RoleKey } from "@/lib/roles";

import { assertMutable, requireMembership } from "./authorization";
import { computeStageSnapshot } from "./snapshot";

export type DecisionInput = {
  organizationId: string;
  gateId: string;
  actorUserId: string;
  roleKey: RoleKey;
  decision: Decision;
  comment?: string;
  /** Required in solo mode. Boilerplate is rejected by length. */
  attestationStatement?: string;
};

export type DecisionResult =
  | {
      ok: true;
      gateStatus: "OPEN" | "APPROVED" | "CHANGES_REQUESTED" | "VETOED";
      approvalId: string;
      /** Distinct approver roles still needed before the gate closes. */
      outstandingRoles: RoleKey[];
      advancedToStageId: string | null;
      certification: string | null;
    }
  | { ok: false; reason: "NOT_PERMITTED"; detail: string }
  | { ok: false; reason: "GATE_NOT_OPEN"; detail: string }
  | { ok: false; reason: "SNAPSHOT_STALE"; detail: string }
  | { ok: false; reason: "ATTESTATION_REQUIRED"; detail: string };

export async function recordDecision(
  db: AmxPrismaClient,
  input: DecisionInput,
): Promise<DecisionResult> {
  const guard = await assertMutable(db, input.organizationId);
  if (!guard.ok) return { ok: false, reason: "NOT_PERMITTED", detail: guard.detail };

  const membership = await requireMembership(db, input.organizationId, input.actorUserId);
  if (!membership.ok) return { ok: false, reason: "NOT_PERMITTED", detail: membership.detail };

  if (!membership.roleKeys.includes(input.roleKey)) {
    return {
      ok: false,
      reason: "NOT_PERMITTED",
      detail: `You do not hold the ${roleName(input.roleKey)} role in this organisation.`,
    };
  }

  const gate = await db.gate.findUnique({
    where: { id: input.gateId },
    select: {
      id: true,
      agentId: true,
      stageId: true,
      stageRunId: true,
      round: true,
      mode: true,
      status: true,
      quorum: true,
      snapshotHash: true,
    },
  });
  if (!gate) return { ok: false, reason: "NOT_PERMITTED", detail: "Gate not found." };
  if (gate.status !== "OPEN") {
    return {
      ok: false,
      reason: "GATE_NOT_OPEN",
      detail: `This gate is ${gate.status.toLowerCase().replace("_", " ")} and no longer accepting decisions.`,
    };
  }

  const stage = stageByKey(gate.stageId);
  const isVetoRole = stage.vetoRoles.includes(input.roleKey);
  const isApproverRole = stage.requiredApproverRoles.includes(input.roleKey);
  if (!isVetoRole && !isApproverRole) {
    return {
      ok: false,
      reason: "NOT_PERMITTED",
      detail: `${roleName(input.roleKey)} is not an approver at ${stage.name}.`,
    };
  }
  if (input.decision === "VETO" && !isVetoRole) {
    return {
      ok: false,
      reason: "NOT_PERMITTED",
      detail: `Only ${stage.vetoRoles.map(roleName).join(" or ") || "a veto-holding role"} can veto at ${stage.name}.`,
    };
  }

  // What was submitted must still be what exists. If an artifact was re-versioned
  // after the gate opened, the decision would be signing something nobody read.
  const snapshot = await computeStageSnapshot(db, gate.agentId, gate.stageId);
  if (snapshot.hash !== gate.snapshotHash) {
    await db.$transaction(async (tx) => {
      await tx.gate.update({
        where: { id: gate.id },
        data: {
          status: "STALE",
          stalledAt: new Date(),
          staleReason: "An artifact changed after this review was requested.",
        },
      });
      await appendAuditEvent(tx as AmxPrismaClient, {
        organizationId: input.organizationId,
        type: "gate.stale",
        subjectType: "Gate",
        subjectId: gate.id,
        actorUserId: input.actorUserId,
        payload: { expected: gate.snapshotHash, found: snapshot.hash },
      });
    });
    return {
      ok: false,
      reason: "SNAPSHOT_STALE",
      detail:
        "An artifact changed after this review was requested, so this decision would apply to something you did not read. Re-submit the stage to open a fresh review.",
    };
  }

  // Solo mode: author and approver are the same person. Always allowed to exist,
  // always labelled, never silent.
  const isSolo = gate.mode === "SOLO_ATTESTATION";
  const statement = input.attestationStatement?.trim() ?? "";
  if (isSolo && input.decision === "APPROVE") {
    if (statement.length < stage.soloAttestation.minStatementLength) {
      return {
        ok: false,
        reason: "ATTESTATION_REQUIRED",
        detail: `A self-review needs an attestation in your own words — at least ${stage.soloAttestation.minStatementLength} characters saying what you checked and what you accept.`,
      };
    }
  }

  // Peer mode: someone who wrote everything under review cannot also be the
  // peer who reviewed it. Solo mode exists precisely so this is not a dead end.
  if (!isSolo && input.decision === "APPROVE") {
    const authored = await db.artifactVersion.findMany({
      where: { id: { in: snapshot.versionIds } },
      select: { authorUserId: true },
    });
    const allByActor =
      authored.length > 0 && authored.every((v) => v.authorUserId === input.actorUserId);
    if (allByActor) {
      return {
        ok: false,
        reason: "NOT_PERMITTED",
        detail:
          "You wrote everything under review, so this would not be a peer review. Ask a colleague to approve it, or re-submit as a self-review — which is allowed, and shows on the badge as self-attested.",
      };
    }
  }

  const outcome = await db.$transaction(async (tx) => {
    const approval = await tx.approval.create({
      data: {
        organizationId: input.organizationId,
        gateId: gate.id,
        userId: input.actorUserId,
        roleId: input.roleKey,
        decision: input.decision,
        comment: input.comment ?? null,
        isSelfAttestation: isSolo,
        attestationStatement: isSolo ? statement : null,
        snapshotHash: gate.snapshotHash,
      },
      select: { id: true },
    });

    let gateStatus: "OPEN" | "APPROVED" | "CHANGES_REQUESTED" | "VETOED" = "OPEN";
    let advancedToStageId: string | null = null;
    let certification: string | null = null;
    let outstandingRoles: RoleKey[] = [];

    if (input.decision === "VETO") {
      gateStatus = "VETOED";
      await tx.gate.update({
        where: { id: gate.id },
        data: { status: "VETOED", decidedAt: new Date() },
      });
      await tx.stageRun.update({
        where: { id: gate.stageRunId },
        data: { status: "CHANGES_REQUESTED" },
      });
      await tx.task.create({
        data: {
          organizationId: input.organizationId,
          agentId: gate.agentId,
          kind: "REVIEW_CHANGES",
          title: `${roleName(input.roleKey)} vetoed ${stage.name}`,
          description:
            input.comment ??
            `${roleName(input.roleKey)} blocked this stage. Resolve the objection before re-submitting.`,
          assigneeRoleId: "agent-product-owner",
        },
      });
    } else if (input.decision === "REQUEST_CHANGES") {
      gateStatus = "CHANGES_REQUESTED";
      await tx.gate.update({
        where: { id: gate.id },
        data: { status: "CHANGES_REQUESTED", decidedAt: new Date() },
      });
      await tx.stageRun.update({
        where: { id: gate.stageRunId },
        data: { status: "CHANGES_REQUESTED" },
      });
      await tx.task.create({
        data: {
          organizationId: input.organizationId,
          agentId: gate.agentId,
          kind: "REVIEW_CHANGES",
          title: `Changes requested at ${stage.name}`,
          description: input.comment ?? `${roleName(input.roleKey)} asked for changes.`,
          assigneeRoleId: "agent-builder",
        },
      });
    } else {
      const approvals = await tx.approval.findMany({
        where: { gateId: gate.id, decision: "APPROVE" },
        select: { roleId: true },
      });
      const approvingRoles = new Set(approvals.map((a) => a.roleId as RoleKey));
      const satisfied = isSolo
        ? approvingRoles.size >= 1
        : stage.requiredApproverRoles.every((role) => approvingRoles.has(role)) &&
          approvingRoles.size >= gate.quorum;

      outstandingRoles = isSolo
        ? []
        : stage.requiredApproverRoles.filter((role) => !approvingRoles.has(role));

      if (satisfied) {
        gateStatus = "APPROVED";
        await tx.gate.update({
          where: { id: gate.id },
          data: { status: "APPROVED", decidedAt: new Date() },
        });
        await tx.stageRun.update({
          where: { id: gate.stageRunId },
          data: { status: "APPROVED", approvedAt: new Date() },
        });

        const following = nextStage(stage.key);
        const agentUpdate: Record<string, unknown> = { status: "IN_PROGRESS" };
        if (following) {
          agentUpdate.currentStageId = following.key;
          advancedToStageId = following.key;
          await tx.stageRun.upsert({
            where: { agentId_stageId: { agentId: gate.agentId, stageId: following.key } },
            update: { status: "DRAFT", startedAt: new Date() },
            create: {
              organizationId: input.organizationId,
              agentId: gate.agentId,
              stageId: following.key,
              status: "DRAFT",
              startedAt: new Date(),
            },
          });
        }

        // Stage 7 is where a certification comes into existence, and the badge
        // distinguishes how it was earned.
        if (stage.key === "7-certification") {
          certification = isSolo ? "SELF_ATTESTED" : "PEER_CERTIFIED";
          agentUpdate.certification = certification;
          agentUpdate.staleReason = null;
          agentUpdate.staleAt = null;
        }
        if (stage.key === "8-publish-and-operate") {
          agentUpdate.status = "PUBLISHED";
        }

        await tx.agent.update({ where: { id: gate.agentId }, data: agentUpdate });

        await appendAuditEvent(tx as AmxPrismaClient, {
          organizationId: input.organizationId,
          type: "stage.approved",
          subjectType: "StageRun",
          subjectId: gate.stageRunId,
          actorUserId: input.actorUserId,
          payload: {
            agentId: gate.agentId,
            stageId: gate.stageId,
            mode: gate.mode,
            approvingRoles: [...approvingRoles],
            snapshotHash: gate.snapshotHash,
          },
        });

        if (certification) {
          await appendAuditEvent(tx as AmxPrismaClient, {
            organizationId: input.organizationId,
            type: "certification.changed",
            subjectType: "Agent",
            subjectId: gate.agentId,
            actorUserId: input.actorUserId,
            payload: { certification, basis: isSolo ? "self-attestation" : "peer review" },
          });
        }
      }
    }

    await appendAuditEvent(tx as AmxPrismaClient, {
      organizationId: input.organizationId,
      type: "gate.decided",
      subjectType: "Approval",
      subjectId: approval.id,
      actorUserId: input.actorUserId,
      payload: {
        gateId: gate.id,
        agentId: gate.agentId,
        stageId: gate.stageId,
        round: gate.round,
        role: input.roleKey,
        decision: input.decision,
        isSelfAttestation: isSolo,
        resultingGateStatus: gateStatus,
      },
    });

    return { approvalId: approval.id, gateStatus, advancedToStageId, certification, outstandingRoles };
  });

  await track({
    name: "gate_decided",
    organizationId: input.organizationId,
    userId: input.actorUserId,
    properties: {
      stageId: gate.stageId,
      decision: input.decision,
      mode: gate.mode,
      isSelfAttestation: isSolo,
      resultingGateStatus: outcome.gateStatus,
    },
  });

  return { ok: true, ...outcome };
}
