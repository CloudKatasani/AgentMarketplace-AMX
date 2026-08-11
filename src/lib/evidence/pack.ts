/**
 * The evidence pack.
 *
 * This is the artifact AMX exists to produce: the thing you hand a regulator,
 * an auditor, or a procurement team when they ask "who approved this agent and
 * what does it stand on?".
 *
 * Two properties make it worth more than a PDF export:
 *
 *   1. Every section is assembled from *committed artifact versions*, with the
 *      content hash printed. Nothing in the pack is retyped prose.
 *   2. It carries a manifest — the hash of every included version plus the
 *      audit chain head — so a reader can verify the pack against the system
 *      it came from rather than trusting it.
 */
import { createHash } from "node:crypto";

import type { AmxPrismaClient } from "@/lib/db/tenancy";
import { verifyAuditChain } from "@/lib/audit/append";
import { sha256 } from "@/lib/hash";
import { stageByKey } from "@/lib/lifecycle/stages";
import { roleName } from "@/lib/roles";
import { toMermaid } from "@/lib/graph/binding-graph";
import { DATSISV_LABELS, type DatsisvScorecard } from "@/lib/artifacts/schemas";

export type PackApproval = {
  stageName: string;
  role: string;
  decision: string;
  isSelfAttestation: boolean;
  attestationStatement: string | null;
  comment: string | null;
  at: Date;
  approverName: string;
};

export type EvidencePack = {
  agent: {
    name: string;
    slug: string;
    summary: string;
    archetype: string | null;
    riskTier: string | null;
    sensitivity: string | null;
    certification: string;
    status: string;
    organizationName: string;
  };
  /** Peer-certified vs self-attested — the distinction the badge makes. */
  certificationBasis: "peer-certified" | "self-attested" | "not certified";
  artifacts: {
    kind: string;
    versionNumber: number;
    contentHash: string;
    content: unknown;
  }[];
  personas: { name: string; ownedDecisions: string }[];
  questions: { text: string; personaName: string; metricKey: string | null; productName: string | null }[];
  bindings: {
    productName: string;
    type: string;
    boundContractVersion: string;
    metricKeys: string[];
    status: string;
  }[];
  coverage: { covered: number; total: number; isComplete: boolean };
  evaluation: { summary: string } | null;
  scorecard: DatsisvScorecard | null;
  approvals: PackApproval[];
  auditEvents: { sequence: number; type: string; subjectType: string; at: Date; hash: string }[];
  mermaid: string;
  manifest: {
    generatedAt: string;
    artifactHashes: { kind: string; versionNumber: number; contentHash: string }[];
    auditChainHead: string | null;
    auditChainVerified: boolean;
    auditEventCount: number;
    /** sha256 over the manifest's own contents — the pack's identity. */
    packHash: string;
  };
};

export async function assembleEvidencePack(
  db: AmxPrismaClient,
  organizationId: string,
  agentId: string,
  generatedAt: Date = new Date(),
): Promise<EvidencePack | null> {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: {
      name: true,
      slug: true,
      summary: true,
      archetype: true,
      riskTier: true,
      sensitivity: true,
      certification: true,
      status: true,
      workspace: { select: { organization: { select: { name: true } } } },
    },
  });
  if (!agent) return null;

  const [artifacts, personas, questions, coverage, bindings, approvals, events, chain] =
    await Promise.all([
      db.artifact.findMany({
        where: { agentId },
        select: {
          kind: true,
          currentVersion: { select: { versionNumber: true, contentHash: true, content: true } },
        },
      }),
      db.persona.findMany({
        where: { agents: { some: { agentId } }, archivedAt: null },
        select: { id: true, name: true, ownedDecisions: true },
      }),
      db.question.findMany({
        where: { agentId, archivedAt: null },
        orderBy: { priority: "asc" },
        select: { id: true, text: true, personaId: true, persona: { select: { name: true } } },
      }),
      db.questionCoverage.findMany({
        where: { question: { agentId } },
        select: {
          questionId: true,
          certifiedMetric: { select: { key: true } },
          binding: { select: { dataProduct: { select: { name: true } } } },
        },
      }),
      db.binding.findMany({
        where: { agentId, archivedAt: null },
        select: {
          status: true,
          bindingType: true,
          dataProduct: { select: { id: true, name: true, contractVersion: true } },
          currentVersion: {
            select: {
              boundContractVersion: true,
              metrics: { select: { certifiedMetric: { select: { id: true, key: true } } } },
            },
          },
        },
      }),
      db.approval.findMany({
        orderBy: { createdAt: "asc" },
        where: { gate: { agentId } },
        select: {
          userId: true,
          roleId: true,
          decision: true,
          comment: true,
          isSelfAttestation: true,
          attestationStatement: true,
          createdAt: true,
          gate: { select: { stageId: true } },
        },
      }),
      db.auditEvent.findMany({
        where: {
          OR: [
            { subjectType: "Agent", subjectId: agentId },
            { payload: { contains: `"agentId":"${agentId}"` } },
          ],
        },
        orderBy: { sequence: "asc" },
        select: { sequence: true, type: true, subjectType: true, createdAt: true, hash: true },
      }),
      verifyAuditChain(db, organizationId),
    ]);

  const approverIds = [...new Set(approvals.map((a) => a.userId))];
  const approvers = await db.membership.findMany({
    where: { userId: { in: approverIds } },
    select: { userId: true, user: { select: { name: true } } },
  });
  const approverNames = new Map(approvers.map((m) => [m.userId, m.user.name]));

  const committed = artifacts
    .filter((a) => a.currentVersion !== null)
    .map((a) => ({
      kind: a.kind,
      versionNumber: a.currentVersion!.versionNumber,
      contentHash: a.currentVersion!.contentHash,
      content: JSON.parse(a.currentVersion!.content) as unknown,
    }));

  const scorecard =
    (committed.find((a) => a.kind === "datsisv-scorecard")?.content as DatsisvScorecard | undefined) ??
    null;

  const coveredIds = new Set(coverage.map((c) => c.questionId));
  const coverageByQuestion = new Map(coverage.map((c) => [c.questionId, c]));

  const certificationBasis: EvidencePack["certificationBasis"] =
    agent.certification === "PEER_CERTIFIED"
      ? "peer-certified"
      : agent.certification === "SELF_ATTESTED"
        ? "self-attested"
        : "not certified";

  const mermaid = toMermaid({
    agentName: agent.name,
    personas: personas.map((p) => ({ id: p.id, name: p.name })),
    questions: questions.map((q) => ({ id: q.id, text: q.text, personaId: q.personaId })),
    bindings: bindings.map((b, index) => ({
      id: String(index),
      type: b.bindingType as never,
      productId: b.dataProduct.id,
    })),
    products: bindings.map((b) => ({
      id: b.dataProduct.id,
      name: b.dataProduct.name,
      contractVersion: b.dataProduct.contractVersion,
    })),
    metrics: bindings.flatMap((b) =>
      (b.currentVersion?.metrics ?? []).map((m) => ({
        id: m.certifiedMetric.id,
        key: m.certifiedMetric.key,
        productId: b.dataProduct.id,
      })),
    ),
    coverage: [],
  });

  const artifactHashes = committed.map((a) => ({
    kind: a.kind,
    versionNumber: a.versionNumber,
    contentHash: a.contentHash,
  }));
  const auditChainHead = events.length > 0 ? events[events.length - 1].hash : null;

  const manifestBody = {
    generatedAt: generatedAt.toISOString(),
    agentSlug: agent.slug,
    artifactHashes,
    auditChainHead,
    auditEventCount: events.length,
    certificationBasis,
  };

  return {
    agent: {
      name: agent.name,
      slug: agent.slug,
      summary: agent.summary,
      archetype: agent.archetype,
      riskTier: agent.riskTier,
      sensitivity: agent.sensitivity,
      certification: agent.certification,
      status: agent.status,
      organizationName: agent.workspace.organization.name,
    },
    certificationBasis,
    artifacts: committed,
    personas: personas.map((p) => ({ name: p.name, ownedDecisions: p.ownedDecisions })),
    questions: questions.map((question) => {
      const row = coverageByQuestion.get(question.id);
      return {
        text: question.text,
        personaName: question.persona.name,
        metricKey: row?.certifiedMetric?.key ?? null,
        productName: row?.binding.dataProduct.name ?? null,
      };
    }),
    bindings: bindings.map((binding) => ({
      productName: binding.dataProduct.name,
      type: binding.bindingType,
      boundContractVersion: binding.currentVersion?.boundContractVersion ?? "—",
      metricKeys: (binding.currentVersion?.metrics ?? []).map((m) => m.certifiedMetric.key),
      status: binding.status,
    })),
    coverage: {
      covered: questions.filter((q) => coveredIds.has(q.id)).length,
      total: questions.length,
      isComplete: questions.length > 0 && questions.every((q) => coveredIds.has(q.id)),
    },
    evaluation: summariseEvalForPack(committed),
    scorecard,
    approvals: approvals.map((approval) => ({
      stageName: stageByKey(approval.gate.stageId).name,
      role: roleName(approval.roleId),
      decision: approval.decision,
      isSelfAttestation: approval.isSelfAttestation,
      attestationStatement: approval.attestationStatement,
      comment: approval.comment,
      at: approval.createdAt,
      approverName: approverNames.get(approval.userId) ?? "A member",
    })),
    auditEvents: events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      subjectType: event.subjectType,
      at: event.createdAt,
      hash: event.hash,
    })),
    mermaid,
    manifest: {
      generatedAt: manifestBody.generatedAt,
      artifactHashes,
      auditChainHead,
      auditChainVerified: chain.ok,
      auditEventCount: events.length,
      packHash: sha256(JSON.stringify(manifestBody)),
    },
  };
}

function summariseEvalForPack(
  artifacts: { kind: string; content: unknown }[],
): { summary: string } | null {
  const harness = artifacts.find((a) => a.kind === "eval-harness")?.content as
    | { cases?: unknown[]; scores?: unknown[] }
    | undefined;
  if (!harness) return null;
  return {
    summary: `${harness.cases?.length ?? 0} cases, ${harness.scores?.length ?? 0} scored.`,
  };
}

/** Short, stable fingerprint for display next to a download link. */
export function packFingerprint(pack: EvidencePack): string {
  return createHash("sha256").update(pack.manifest.packHash).digest("hex").slice(0, 12);
}

export { DATSISV_LABELS };
