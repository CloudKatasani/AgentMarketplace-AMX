/**
 * Loads everything the exit criteria may read, once.
 *
 * Criteria are pure functions; this is the only place that touches the
 * database on their behalf. Keeping the two apart is what lets the criteria be
 * tested exhaustively against hand-built contexts.
 */
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import type {
  ArtifactKind,
  BindingType,
  CertificationStatus,
  IntentClass,
  PlanTier,
  StageKey,
  StageRunStatus,
} from "@/lib/enums";
import type { RoleKey } from "@/lib/roles";

import type { StageContext } from "./types";

export async function loadStageContext(
  db: AmxPrismaClient,
  organizationId: string,
  agentId: string,
  stageId: StageKey,
): Promise<StageContext | null> {
  const [organization, agent] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, planTier: true, isReadOnly: true },
    }),
    db.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        slug: true,
        name: true,
        summary: true,
        workspaceId: true,
        archetype: true,
        riskTier: true,
        ownerUserId: true,
        sensitivity: true,
        currentStageId: true,
        status: true,
        certification: true,
      },
    }),
  ]);
  if (!organization || !agent) return null;

  const [stageRun, artifacts, personas, questions, bindings, coverage, dataProducts, approvals] =
    await Promise.all([
      db.stageRun.findUnique({
        where: { agentId_stageId: { agentId, stageId } },
        select: { id: true, stageId: true, status: true, staleReason: true },
      }),
      db.artifact.findMany({
        where: { agentId },
        select: {
          id: true,
          kind: true,
          currentVersion: {
            select: {
              id: true,
              versionNumber: true,
              contentHash: true,
              content: true,
              isAiDraft: true,
              createdAt: true,
            },
          },
        },
      }),
      db.persona.findMany({
        where: { agents: { some: { agentId } } },
        select: {
          id: true,
          key: true,
          name: true,
          kind: true,
          ownedDecisions: true,
          cadence: true,
          currentWorkaround: true,
          questions: {
            where: { agentId, archivedAt: null },
            select: {
              id: true,
              personaId: true,
              text: true,
              intentClass: true,
              consequenceOfNoAnswer: true,
              expectedAnswerShape: true,
            },
          },
        },
      }),
      db.question.findMany({
        where: { agentId, archivedAt: null },
        select: {
          id: true,
          personaId: true,
          text: true,
          intentClass: true,
          consequenceOfNoAnswer: true,
          expectedAnswerShape: true,
        },
      }),
      db.binding.findMany({
        where: { agentId, archivedAt: null },
        select: {
          id: true,
          status: true,
          dataProductId: true,
          bindingType: true,
          currentVersion: {
            select: {
              id: true,
              versionNumber: true,
              type: true,
              purpose: true,
              boundContractVersion: true,
              boundContractMajor: true,
              metrics: { select: { certifiedMetricId: true } },
            },
          },
        },
      }),
      db.questionCoverage.findMany({
        where: { question: { agentId } },
        select: { questionId: true, bindingId: true, certifiedMetricId: true },
      }),
      db.dataProduct.findMany({
        where: { workspaceId: agent.workspaceId, archivedAt: null },
        select: {
          id: true,
          key: true,
          name: true,
          layer: true,
          sensitivity: true,
          qualityScore: true,
          contractVersion: true,
          contractMajor: true,
          semanticModelVersion: true,
          lastRefreshedAt: true,
          metrics: {
            where: { archivedAt: null },
            select: {
              id: true,
              key: true,
              name: true,
              dataProductId: true,
              certifiedAt: true,
              semanticRef: true,
            },
          },
        },
      }),
      db.approval.findMany({
        where: { gate: { agentId } },
        select: {
          gateId: true,
          userId: true,
          roleId: true,
          decision: true,
          isSelfAttestation: true,
          gate: { select: { stageId: true } },
        },
      }),
    ]);

  const artifactMap: StageContext["artifacts"] = {};
  for (const artifact of artifacts) {
    artifactMap[artifact.kind as ArtifactKind] = artifact.currentVersion
      ? {
          id: artifact.currentVersion.id,
          artifactId: artifact.id,
          kind: artifact.kind as ArtifactKind,
          versionNumber: artifact.currentVersion.versionNumber,
          contentHash: artifact.currentVersion.contentHash,
          content: safeParse(artifact.currentVersion.content),
          isAiDraft: artifact.currentVersion.isAiDraft,
          createdAt: artifact.currentVersion.createdAt,
        }
      : null;
  }

  return {
    organization: {
      id: organization.id,
      planTier: organization.planTier as PlanTier,
      isReadOnly: organization.isReadOnly,
    },
    agent: {
      ...agent,
      currentStageId: agent.currentStageId as StageKey,
      certification: agent.certification as CertificationStatus,
    },
    stageRun: stageRun
      ? {
          id: stageRun.id,
          stageId: stageRun.stageId as StageKey,
          status: stageRun.status as StageRunStatus,
          staleReason: stageRun.staleReason,
        }
      : { id: "", stageId, status: "NOT_STARTED", staleReason: null },
    artifacts: artifactMap,
    personas: personas.map((persona) => ({
      ...persona,
      questions: persona.questions.map((q) => ({
        ...q,
        intentClass: q.intentClass as IntentClass,
      })),
    })),
    questions: questions.map((q) => ({ ...q, intentClass: q.intentClass as IntentClass })),
    bindings: bindings.map((binding) => ({
      id: binding.id,
      status: binding.status,
      dataProductId: binding.dataProductId,
      bindingType: binding.bindingType as BindingType,
      currentVersion: binding.currentVersion
        ? {
            id: binding.currentVersion.id,
            versionNumber: binding.currentVersion.versionNumber,
            type: binding.currentVersion.type as BindingType,
            purpose: binding.currentVersion.purpose,
            boundContractVersion: binding.currentVersion.boundContractVersion,
            boundContractMajor: binding.currentVersion.boundContractMajor,
            metricIds: binding.currentVersion.metrics.map((m) => m.certifiedMetricId),
          }
        : null,
    })),
    coverage,
    dataProducts,
    approvals: approvals.map((approval) => ({
      gateId: approval.gateId,
      stageId: approval.gate.stageId as StageKey,
      userId: approval.userId,
      roleId: approval.roleId as RoleKey,
      decision: approval.decision,
      isSelfAttestation: approval.isSelfAttestation,
    })),
  };
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
