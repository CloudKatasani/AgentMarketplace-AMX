/**
 * The starter workspace, seeded from an industry pack.
 *
 * CLAUDE.md principle 1: a new organisation never lands on an empty screen. It
 * lands on a real agent, mid-lifecycle, standing on real data products with
 * real certified metrics — in the vocabulary of its own industry.
 *
 * The same function seeds the showcase tenant, which is deliberate: the demo
 * cannot drift from what a new user actually gets.
 */
import { commitArtifact } from "@/lib/artifacts/commit";
import { appendAuditEvent } from "@/lib/audit/append";
import { declareBinding, setQuestionCoverage } from "@/lib/bindings/service";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import { loadPack } from "@/lib/packs/load";
import type { Pack } from "@/lib/packs/schema";

export type StarterSeedInput = {
  organizationId: string;
  workspaceId: string;
  ownerUserId: string;
  ownerName: string;
  /** Pack key; falls back to `_generic` when the industry has no pack. */
  packKey?: string | null;
};

export type StarterSeedResult = {
  agentId: string;
  agentSlug: string;
  packKey: string;
  dataProductIds: Record<string, string>;
  metricIds: Record<string, string>;
};

export async function seedStarterWorkspace(
  db: AmxPrismaClient,
  input: StarterSeedInput,
): Promise<StarterSeedResult | null> {
  const wanted = input.packKey ?? "_generic";
  const loaded = loadPack(wanted);
  const result = loaded.ok ? loaded : loadPack("_generic");
  if (!result.ok) return null;

  return seedFromPack(db, input, result.pack);
}

async function seedFromPack(
  db: AmxPrismaClient,
  input: StarterSeedInput,
  pack: Pack,
): Promise<StarterSeedResult | null> {
  const starter = pack.starterAgents[0];
  if (!starter) return null;

  const now = new Date();
  const dataProductIds: Record<string, string> = {};
  const metricIds: Record<string, string> = {};

  // ── Data products and their certified metrics ──
  for (const product of pack.dataProducts) {
    const domain = await db.domain.findFirst({
      where: { industryId: pack.key, key: product.domainKey },
      select: { id: true },
    });

    const [major, minor, patch] = product.contractVersion.split(".").map(Number);

    const created = await db.dataProduct.upsert({
      where: {
        organizationId_workspaceId_key: {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          key: product.key,
        },
      },
      update: {},
      create: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        domainId: domain?.id ?? null,
        key: product.key,
        name: product.name,
        description: product.description,
        ownerName: product.owner,
        ownerUserId: input.ownerUserId,
        contractVersion: product.contractVersion,
        contractMajor: major,
        contractMinor: minor,
        contractPatch: patch,
        semanticModelVersion: product.semanticModelVersion,
        layer: product.layer,
        qualityScore: product.qualityScore,
        lastRefreshedAt: now,
        freshnessSlaHours: product.freshnessSlaHours ?? null,
        sensitivity: product.sensitivity,
      },
      select: { id: true },
    });
    dataProductIds[product.key] = created.id;

    await db.dataProductVersion.upsert({
      where: {
        dataProductId_contractVersion: {
          dataProductId: created.id,
          contractVersion: product.contractVersion,
        },
      },
      update: {},
      create: {
        organizationId: input.organizationId,
        dataProductId: created.id,
        contractVersion: product.contractVersion,
        contractMajor: major,
        contractMinor: minor,
        contractPatch: patch,
        semanticModelVersion: product.semanticModelVersion,
        changeSummary: `Seeded from the ${pack.name} pack.`,
        contentHash: `seed-${pack.key}-${product.key}-${product.contractVersion}`,
      },
    });

    for (const metric of product.metrics) {
      const createdMetric = await db.certifiedMetric.upsert({
        where: { dataProductId_key: { dataProductId: created.id, key: metric.key } },
        update: {},
        create: {
          organizationId: input.organizationId,
          dataProductId: created.id,
          key: metric.key,
          name: metric.name,
          definition: metric.definition,
          grain: metric.grain,
          unit: metric.unit || null,
          semanticRef: metric.semanticRef,
          certifiedAt: now,
          certifiedBy: product.owner,
        },
        select: { id: true },
      });
      metricIds[metric.key] = createdMetric.id;
    }
  }

  // ── The starter agent, mid-lifecycle at Stage 3 ──
  const domain = await db.domain.findFirst({
    where: { industryId: pack.key, key: starter.domainKey },
    select: { id: true },
  });

  const agent = await db.agent.upsert({
    where: {
      organizationId_workspaceId_slug: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        slug: starter.key,
      },
    },
    update: {},
    create: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      domainId: domain?.id ?? null,
      slug: starter.key,
      name: starter.name,
      summary: starter.summary,
      archetype: starter.archetype,
      riskTier: starter.riskTier,
      ownerUserId: input.ownerUserId,
      sensitivity: highestSensitivity(
        starter.bindings
          .map((b) => pack.dataProducts.find((p) => p.key === b.dataProductKey)?.sensitivity)
          .filter(Boolean) as string[],
      ),
      currentStageId: "3-data-product-binding",
      status: "IN_PROGRESS",
      certification: "NONE",
    },
    select: { id: true, slug: true },
  });

  // ── Personas and questions ──
  const personaIds: Record<string, string> = {};
  const usedPersonaKeys = new Set(
    starter.questionKeys
      .map((questionKey) => pack.questionLibrary.find((q) => q.key === questionKey)?.personaKey)
      .filter(Boolean) as string[],
  );
  usedPersonaKeys.add(starter.primaryPersonaKey);

  for (const personaKey of usedPersonaKeys) {
    const persona = pack.personas.find((p) => p.key === personaKey);
    if (!persona) continue;

    const created = await db.persona.upsert({
      where: {
        organizationId_workspaceId_key: {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          key: persona.key,
        },
      },
      update: {},
      create: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        key: persona.key,
        name: persona.name,
        kind: persona.kind,
        ownedDecisions: persona.ownedDecisions,
        cadence: persona.cadence,
        currentWorkaround: persona.currentWorkaround,
        packSourceKey: `${pack.key}:${persona.key}`,
      },
      select: { id: true },
    });
    personaIds[persona.key] = created.id;

    await db.agentPersona.upsert({
      where: { agentId_personaId: { agentId: agent.id, personaId: created.id } },
      update: {},
      create: {
        organizationId: input.organizationId,
        agentId: agent.id,
        personaId: created.id,
        isPrimary: persona.key === starter.primaryPersonaKey,
      },
    });
  }

  const questionIds: Record<string, string> = {};
  for (const [index, questionKey] of starter.questionKeys.entries()) {
    const question = pack.questionLibrary.find((q) => q.key === questionKey);
    if (!question) continue;
    const personaId = personaIds[question.personaKey];
    if (!personaId) continue;

    const existing = await db.question.findFirst({
      where: { agentId: agent.id, packSourceKey: question.key },
      select: { id: true },
    });

    const created =
      existing ??
      (await db.question.create({
        data: {
          organizationId: input.organizationId,
          agentId: agent.id,
          personaId,
          text: question.text,
          intentClass: question.intentClass,
          consequenceOfNoAnswer: question.consequenceOfNoAnswer,
          expectedAnswerShape: question.expectedAnswerShape,
          priority: index,
          packSourceKey: question.key,
        },
        select: { id: true },
      }));
    questionIds[question.key] = created.id;
  }

  // ── Stage 1 and 2 artifacts, committed ──
  const personaEntries = [...usedPersonaKeys]
    .map((personaKey) => pack.personas.find((p) => p.key === personaKey))
    .filter(Boolean);

  await commitArtifact(db, {
    organizationId: input.organizationId,
    agentId: agent.id,
    stageId: "1-consumption-discovery",
    kind: "persona-question-register",
    authorUserId: input.ownerUserId,
    runCascade: false,
    content: {
      schemaVersion: "1.0.0",
      agentSlug: agent.slug,
      personas: personaEntries.map((persona) => ({
        key: persona!.key,
        name: persona!.name,
        kind: persona!.kind,
        ownedDecisions: persona!.ownedDecisions,
        cadence: persona!.cadence,
        currentWorkaround: persona!.currentWorkaround,
        questions: starter.questionKeys
          .map((questionKey) => pack.questionLibrary.find((q) => q.key === questionKey))
          .filter((question) => question?.personaKey === persona!.key)
          .map((question, index) => ({
            key: question!.key,
            text: question!.text,
            intentClass: question!.intentClass,
            consequenceOfNoAnswer: question!.consequenceOfNoAnswer,
            expectedAnswerShape: question!.expectedAnswerShape,
            priority: index,
          })),
      })),
    },
  });

  await commitArtifact(db, {
    organizationId: input.organizationId,
    agentId: agent.id,
    stageId: "2-agent-charter",
    kind: "agent-charter",
    authorUserId: input.ownerUserId,
    content: {
      schemaVersion: "1.0.0",
      archetype: starter.archetype,
      mission: starter.summary,
      scopeBoundary: `Answers only the catalogued questions for ${
        pack.personas.find((p) => p.key === starter.primaryPersonaKey)?.name ?? "its persona"
      }, using ${starter.bindings
        .map((b) => pack.dataProducts.find((p) => p.key === b.dataProductKey)?.name)
        .filter(Boolean)
        .join(" and ")} only. Advises; it does not act on anyone's behalf.`,
      outOfScope: [
        "Anything outside the catalogued question list",
        "Taking an action in any operational system",
        "Answering questions about individual employees",
        "Speculating beyond what the certified metrics support",
      ],
      valueHypothesis: `${
        pack.personas.find((p) => p.key === starter.primaryPersonaKey)?.name ?? "The persona"
      } stops reconciling reports by hand and starts the cycle with a ranked, explainable list.`,
      successMeasures: [
        "Every recommendation traceable to a certified metric",
        "Time from cycle open to a reviewed list under one hour",
      ],
      riskTier: starter.riskTier,
      ownerName: input.ownerName,
      escalationContact: pack.dataProducts[0]?.owner ?? "The data platform team",
    },
  });

  // ── Stage 3 in progress: bindings declared, coverage mapped ──
  const bindingIdByProduct: Record<string, string> = {};
  for (const binding of starter.bindings) {
    const dataProductId = dataProductIds[binding.dataProductKey];
    if (!dataProductId) continue;

    const declared = await declareBinding(db, {
      organizationId: input.organizationId,
      agentId: agent.id,
      dataProductId,
      type: binding.type,
      purpose: binding.purpose,
      metricIds: binding.metricKeys.map((key) => metricIds[key]).filter(Boolean),
      actorUserId: input.ownerUserId,
    });
    if (declared.ok && binding.type === "QUERIES") {
      bindingIdByProduct[binding.dataProductKey] = declared.bindingId;
    }
  }

  for (const questionKey of starter.questionKeys) {
    const question = pack.questionLibrary.find((q) => q.key === questionKey);
    const questionId = questionIds[questionKey];
    if (!question || !questionId) continue;

    // Map the question to the QUERIES binding that provides its metric.
    const owningBinding = starter.bindings.find(
      (binding) => binding.type === "QUERIES" && binding.metricKeys.includes(question.metricKey),
    );
    const bindingId = owningBinding ? bindingIdByProduct[owningBinding.dataProductKey] : undefined;
    if (!bindingId) continue;

    await setQuestionCoverage(db, {
      organizationId: input.organizationId,
      questionId,
      bindingId,
      certifiedMetricId: metricIds[question.metricKey] ?? null,
    });
  }

  await appendAuditEvent(db, {
    organizationId: input.organizationId,
    type: "agent.created",
    subjectType: "Agent",
    subjectId: agent.id,
    actorUserId: input.ownerUserId,
    payload: { slug: agent.slug, source: "starter-workspace", pack: pack.key },
  });

  return {
    agentId: agent.id,
    agentSlug: agent.slug,
    packKey: pack.key,
    dataProductIds,
    metricIds,
  };
}

const SENSITIVITY_ORDER = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"];

function highestSensitivity(levels: string[]): string {
  let highest = "PUBLIC";
  for (const level of levels) {
    if (SENSITIVITY_ORDER.indexOf(level) > SENSITIVITY_ORDER.indexOf(highest)) highest = level;
  }
  return highest;
}
