/**
 * Declaring a binding.
 *
 * Validation happens before anything is written, and the report is stored on
 * the version — so an evidence pack can show not just that a binding was
 * approved, but what the validator said at the moment it was approved.
 */
import { track } from "@/lib/analytics";
import { commitArtifact } from "@/lib/artifacts/commit";
import { appendAuditEvent } from "@/lib/audit/append";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import type { BindingType } from "@/lib/enums";
import { contentHash } from "@/lib/hash";

import { validateBindingDraft, type BindingContext, type ValidationReport } from "./validate";

export type DeclareBindingInput = {
  organizationId: string;
  agentId: string;
  dataProductId: string;
  type: BindingType;
  purpose: string;
  metricIds: string[];
  actorUserId: string | null;
};

export type DeclareBindingResult =
  | {
      ok: true;
      bindingId: string;
      versionId: string;
      versionNumber: number;
      report: ValidationReport;
    }
  | { ok: false; report: ValidationReport };

/** Loads the products and rules the validator needs for one agent's workspace. */
export async function loadBindingContext(
  db: AmxPrismaClient,
  agentId: string,
): Promise<BindingContext> {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { workspaceId: true, sensitivity: true },
  });
  if (!agent) return { products: [] };

  const [products, toolSpecs] = await Promise.all([
    db.dataProduct.findMany({
      where: { workspaceId: agent.workspaceId, archivedAt: null },
      select: {
        id: true,
        key: true,
        name: true,
        layer: true,
        sensitivity: true,
        contractVersion: true,
        contractMajor: true,
        semanticModelVersion: true,
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
    db.artifact.findFirst({
      where: { agentId, kind: "tool-specs" },
      select: { currentVersionId: true },
    }),
  ]);

  return {
    products,
    hasToolSpecs: Boolean(toolSpecs?.currentVersionId),
    agentSensitivity: agent.sensitivity,
  };
}

/**
 * Validates and commits a binding version.
 *
 * A binding that fails validation is not written at all — the rejection is the
 * product feature, so there is nothing half-saved to explain afterwards.
 */
export async function declareBinding(
  db: AmxPrismaClient,
  input: DeclareBindingInput,
): Promise<DeclareBindingResult> {
  const ctx = await loadBindingContext(db, input.agentId);
  const product = ctx.products.find((p) => p.id === input.dataProductId);

  const draft = {
    id: `${input.agentId}:${input.dataProductId}:${input.type}`,
    dataProductId: input.dataProductId,
    type: input.type,
    purpose: input.purpose,
    metricIds: input.metricIds,
    boundContractVersion: product?.contractVersion ?? "0.0.0",
    boundContractMajor: product?.contractMajor ?? 0,
  };

  const report = validateBindingDraft(draft, ctx);

  await track({
    name: "binding_validated",
    organizationId: input.organizationId,
    userId: input.actorUserId ?? undefined,
    properties: {
      bindingType: input.type,
      ok: report.ok,
      findingCodes: report.findings.map((f) => f.code),
    },
  });

  if (!report.ok) return { ok: false, report };

  const result = await db.$transaction(async (tx) => {
    const binding = await tx.binding.upsert({
      where: {
        agentId_dataProductId_bindingType: {
          agentId: input.agentId,
          dataProductId: input.dataProductId,
          bindingType: input.type,
        },
      },
      update: { status: "PROPOSED", staleReason: null },
      create: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        dataProductId: input.dataProductId,
        bindingType: input.type,
        status: "PROPOSED",
      },
      select: { id: true },
    });

    const previous = await tx.bindingVersion.findFirst({
      where: { bindingId: binding.id },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const versionNumber = (previous?.versionNumber ?? 0) + 1;

    const version = await tx.bindingVersion.create({
      data: {
        organizationId: input.organizationId,
        bindingId: binding.id,
        versionNumber,
        type: input.type,
        purpose: input.purpose,
        boundContractVersion: draft.boundContractVersion,
        boundContractMajor: draft.boundContractMajor,
        boundSemanticModelVersion: product?.semanticModelVersion ?? "0.0.0",
        contentHash: contentHash({ ...draft, metricIds: [...input.metricIds].sort() }),
        validationReport: JSON.stringify(report),
        authorUserId: input.actorUserId,
      },
      select: { id: true, versionNumber: true },
    });

    for (const metricId of input.metricIds) {
      await tx.bindingMetric.create({
        data: {
          organizationId: input.organizationId,
          bindingVersionId: version.id,
          certifiedMetricId: metricId,
        },
      });
    }

    await tx.binding.update({
      where: { id: binding.id },
      data: { currentVersionId: version.id },
    });

    await appendAuditEvent(tx as AmxPrismaClient, {
      organizationId: input.organizationId,
      type: "binding.committed",
      subjectType: "BindingVersion",
      subjectId: version.id,
      actorUserId: input.actorUserId,
      payload: {
        agentId: input.agentId,
        dataProductId: input.dataProductId,
        type: input.type,
        versionNumber: version.versionNumber,
        boundContractVersion: draft.boundContractVersion,
        metricCount: input.metricIds.length,
      },
    });

    return { bindingId: binding.id, versionId: version.id, versionNumber: version.versionNumber };
  });

  // The Stage 3 artifact is the bindings, serialised. Keep them in step.
  await commitBindingSet(db, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    actorUserId: input.actorUserId,
  });

  return { ok: true, ...result, report };
}

/**
 * Serialises the agent's bindings and coverage into the Stage 3 artifact.
 *
 * The binding set is not a separate document someone remembers to write — it
 * *is* the current bindings and coverage, committed. Regenerating it after
 * every change is what keeps the artifact a gate can approve honest: approve
 * the artifact, and you have approved exactly the bindings that exist.
 */
export async function commitBindingSet(
  db: AmxPrismaClient,
  input: { organizationId: string; agentId: string; actorUserId: string | null },
): Promise<void> {
  const agent = await db.agent.findUnique({
    where: { id: input.agentId },
    select: { slug: true },
  });
  if (!agent) return;

  const bindings = await db.binding.findMany({
    where: { agentId: input.agentId, archivedAt: null },
    select: {
      id: true,
      dataProduct: { select: { key: true } },
      currentVersion: {
        select: {
          type: true,
          purpose: true,
          boundContractVersion: true,
          metrics: { select: { certifiedMetric: { select: { key: true } } } },
        },
      },
    },
  });

  const committed = bindings.filter((binding) => binding.currentVersion !== null);
  if (committed.length === 0) return;

  const coverage = await db.questionCoverage.findMany({
    where: { question: { agentId: input.agentId } },
    select: {
      questionId: true,
      binding: { select: { dataProduct: { select: { key: true } } } },
      certifiedMetric: { select: { key: true } },
    },
  });

  await commitArtifact(db, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    stageId: "3-data-product-binding",
    kind: "binding-set",
    authorUserId: input.actorUserId,
    content: {
      schemaVersion: "1.0.0",
      agentSlug: agent.slug,
      bindings: committed.map((binding) => ({
        dataProductKey: binding.dataProduct.key,
        type: binding.currentVersion!.type,
        purpose: binding.currentVersion!.purpose,
        boundContractVersion: binding.currentVersion!.boundContractVersion,
        metricKeys: binding.currentVersion!.metrics.map((m) => m.certifiedMetric.key),
      })),
      coverage: coverage.map((row) => ({
        questionKey: row.questionId,
        dataProductKey: row.binding.dataProduct.key,
        metricKey: row.certifiedMetric?.key ?? null,
      })),
    },
  });
}

/** Maps a question to a binding — one cell of the coverage matrix. */
export async function setQuestionCoverage(
  db: AmxPrismaClient,
  input: {
    organizationId: string;
    questionId: string;
    bindingId: string;
    certifiedMetricId: string | null;
  },
): Promise<void> {
  await db.questionCoverage.upsert({
    where: {
      questionId_bindingId: { questionId: input.questionId, bindingId: input.bindingId },
    },
    update: { certifiedMetricId: input.certifiedMetricId },
    create: {
      organizationId: input.organizationId,
      questionId: input.questionId,
      bindingId: input.bindingId,
      certifiedMetricId: input.certifiedMetricId,
    },
  });

  const binding = await db.binding.findUnique({
    where: { id: input.bindingId },
    select: { agentId: true },
  });
  if (binding) {
    await commitBindingSet(db, {
      organizationId: input.organizationId,
      agentId: binding.agentId,
      actorUserId: null,
    });
  }
}
