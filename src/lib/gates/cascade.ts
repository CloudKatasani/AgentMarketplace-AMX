/**
 * Cascade invalidation, in both directions.
 *
 *   1. An artifact is re-versioned  → gates that approved the old snapshot go STALE
 *   2. A bound product bumps a major → dependent bindings and certifications go STALE
 *
 * Both end the same way: a STALE marker with a plain-language cause, a
 * re-approval task addressed to a role, and an audit event. Nothing here can
 * approve anything — restoring a stale certification means going back through
 * `recordDecision`, which is the point.
 *
 * Direction 2 runs synchronously inside the version-bump transaction. It is the
 * demo's money moment: the banner has to be on screen at the next render, not
 * after a worker picks up a job.
 */
import { track } from "@/lib/analytics";
import { appendAuditEvent } from "@/lib/audit/append";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import type { ArtifactKind } from "@/lib/enums";
import { stageByKey } from "@/lib/lifecycle/stages";
import { roleName } from "@/lib/roles";

import { computeStageSnapshot } from "./snapshot";

// ───────────── Direction 1 · artifact re-version → downstream gates ─────────────

export type ArtifactCascadeInput = {
  organizationId: string;
  agentId: string;
  artifactKind: ArtifactKind;
  actorUserId: string | null;
};

/**
 * Any approved or open gate whose stage includes the changed artifact is now
 * approving something that no longer exists. Returns the ids it invalidated.
 */
export async function cascadeFromArtifactRevision(
  db: AmxPrismaClient,
  input: ArtifactCascadeInput,
): Promise<string[]> {
  const gates = await db.gate.findMany({
    where: { agentId: input.agentId, status: { in: ["APPROVED", "OPEN"] } },
    select: { id: true, stageId: true, stageRunId: true, snapshotHash: true, status: true },
  });

  const invalidated: string[] = [];

  for (const gate of gates) {
    const stage = stageByKey(gate.stageId);
    if (!stage.requiredArtifacts.includes(input.artifactKind)) continue;

    const snapshot = await computeStageSnapshot(db, input.agentId, gate.stageId);
    if (snapshot.hash === gate.snapshotHash) continue;

    const reason = `The ${input.artifactKind.replace(/-/g, " ")} changed after ${stage.name} was ${gate.status === "APPROVED" ? "approved" : "submitted"}.`;

    await db.$transaction(async (tx) => {
      await tx.gate.update({
        where: { id: gate.id },
        data: { status: "STALE", stalledAt: new Date(), staleReason: reason },
      });
      await tx.stageRun.update({
        where: { id: gate.stageRunId },
        data: { status: "STALE", stalledAt: new Date(), staleReason: reason },
      });

      const event = await appendAuditEvent(tx as AmxPrismaClient, {
        organizationId: input.organizationId,
        type: "cascade.artifact-revision",
        subjectType: "Gate",
        subjectId: gate.id,
        actorUserId: input.actorUserId,
        payload: {
          agentId: input.agentId,
          stageId: gate.stageId,
          artifactKind: input.artifactKind,
          previousSnapshot: gate.snapshotHash,
          currentSnapshot: snapshot.hash,
        },
      });

      for (const role of stage.requiredApproverRoles) {
        await tx.task.create({
          data: {
            organizationId: input.organizationId,
            agentId: input.agentId,
            kind: "RE_APPROVAL",
            title: `Re-approve ${stage.name}`,
            description: `${reason} ${roleName(role)} needs to review the new version and approve it again.`,
            assigneeRoleId: role,
            causeEventId: event.id,
          },
        });
      }
    });

    invalidated.push(gate.id);
  }

  if (invalidated.length > 0) {
    await track({
      name: "stale_triggered",
      organizationId: input.organizationId,
      userId: input.actorUserId ?? undefined,
      properties: {
        cause: "artifact-revision",
        artifactKind: input.artifactKind,
        gateCount: invalidated.length,
      },
    });
  }

  return invalidated;
}

// ───────── Direction 2 · data product major bump → certifications ─────────

export type ProductCascadeInput = {
  organizationId: string;
  dataProductId: string;
  previousVersion: string;
  newVersion: string;
  newMajor: number;
  actorUserId: string | null;
};

export type ProductCascadeResult = {
  staleBindingIds: string[];
  staleAgentIds: string[];
  taskCount: number;
};

/**
 * A major version bump is a breaking change by definition, so every binding
 * pinned to an older major is now standing on something that moved.
 *
 * Minor and patch bumps deliberately do not cascade — crying wolf on every
 * patch is how governance tooling gets switched off.
 */
export async function cascadeFromProductMajorBump(
  db: AmxPrismaClient,
  input: ProductCascadeInput,
): Promise<ProductCascadeResult> {
  const product = await db.dataProduct.findUnique({
    where: { id: input.dataProductId },
    select: { id: true, name: true },
  });
  if (!product) return { staleBindingIds: [], staleAgentIds: [], taskCount: 0 };

  const bindings = await db.binding.findMany({
    where: {
      dataProductId: input.dataProductId,
      archivedAt: null,
      status: { in: ["APPROVED", "PROPOSED", "DRAFT"] },
    },
    select: {
      id: true,
      agentId: true,
      currentVersion: { select: { boundContractMajor: true } },
      agent: { select: { id: true, name: true, certification: true } },
    },
  });

  const affected = bindings.filter(
    (binding) =>
      binding.currentVersion !== null &&
      binding.currentVersion.boundContractMajor < input.newMajor,
  );
  if (affected.length === 0) return { staleBindingIds: [], staleAgentIds: [], taskCount: 0 };

  const reason = `${product.name} moved from contract ${input.previousVersion} to ${input.newVersion}, which is a breaking change.`;
  const agentIds = [...new Set(affected.map((b) => b.agentId))];
  let taskCount = 0;

  await db.$transaction(async (tx) => {
    for (const binding of affected) {
      await tx.binding.update({
        where: { id: binding.id },
        data: { status: "STALE", staleReason: reason },
      });
    }

    for (const agentId of agentIds) {
      const agent = affected.find((b) => b.agentId === agentId)!.agent;

      await tx.agent.update({
        where: { id: agentId },
        data: {
          certification: "STALE",
          staleReason: `${reason} This agent's certification is pending re-approval against the new contract.`,
          staleAt: new Date(),
        },
      });

      // Stage 3 owned the binding decision, so that is the gate that has to be
      // re-run. Its approval no longer describes reality.
      const bindingGates = await tx.gate.findMany({
        where: { agentId, stageId: "3-data-product-binding", status: "APPROVED" },
        select: { id: true, stageRunId: true },
      });
      for (const gate of bindingGates) {
        await tx.gate.update({
          where: { id: gate.id },
          data: { status: "STALE", stalledAt: new Date(), staleReason: reason },
        });
        await tx.stageRun.update({
          where: { id: gate.stageRunId },
          data: { status: "STALE", stalledAt: new Date(), staleReason: reason },
        });
      }

      const event = await appendAuditEvent(tx as AmxPrismaClient, {
        organizationId: input.organizationId,
        type: "cascade.product-major-bump",
        subjectType: "Agent",
        subjectId: agentId,
        actorUserId: input.actorUserId,
        payload: {
          dataProductId: input.dataProductId,
          dataProductName: product.name,
          previousVersion: input.previousVersion,
          newVersion: input.newVersion,
          previousCertification: agent.certification,
        },
      });

      for (const role of ["data-product-owner", "governance-officer"] as const) {
        await tx.task.create({
          data: {
            organizationId: input.organizationId,
            agentId,
            kind: "RE_CERTIFICATION",
            title: `Re-certify ${agent.name} against ${product.name} ${input.newVersion}`,
            description: `${reason} Review what changed, update the binding's pinned contract version, and re-approve.`,
            assigneeRoleId: role,
            causeEventId: event.id,
          },
        });
        taskCount += 1;
      }
    }
  });

  await track({
    name: "stale_triggered",
    organizationId: input.organizationId,
    userId: input.actorUserId ?? undefined,
    properties: {
      cause: "product-major-bump",
      dataProductId: input.dataProductId,
      agentCount: agentIds.length,
      bindingCount: affected.length,
    },
  });

  return {
    staleBindingIds: affected.map((b) => b.id),
    staleAgentIds: agentIds,
    taskCount,
  };
}
