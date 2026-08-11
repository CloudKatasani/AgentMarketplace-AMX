/**
 * The starter workspace.
 *
 * CLAUDE.md principle 1: a new organisation never lands on an empty screen. It
 * lands on a real agent, mid-lifecycle, standing on real data products with
 * real certified metrics — so the first thing a practitioner sees is the
 * product working, not a form.
 *
 * The same function seeds the showcase tenant, which is deliberate: the demo
 * cannot drift from what a new user actually gets.
 */
import { commitArtifact } from "@/lib/artifacts/commit";
import { declareBinding, setQuestionCoverage } from "@/lib/bindings/service";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import { appendAuditEvent } from "@/lib/audit/append";

export type StarterSeedInput = {
  organizationId: string;
  workspaceId: string;
  ownerUserId: string;
  ownerName: string;
  /** Domain to file the agent and products under, when the industry has one. */
  domainId?: string | null;
};

export type StarterSeedResult = {
  agentId: string;
  agentSlug: string;
  customer360Id: string;
  meterToCashId: string;
  churnMetricId: string;
  highBillMetricId: string;
};

/**
 * Customer 360 and Meter-to-Cash, with the two metrics PROMPT.md names.
 *
 * Contract 2.1.0 on Customer 360 is chosen so the demo can bump it to 3.0.0 and
 * fire the cascade — the STALE flip needs a major boundary to cross.
 */
export async function seedStarterWorkspace(
  db: AmxPrismaClient,
  input: StarterSeedInput,
): Promise<StarterSeedResult> {
  const now = new Date();

  const customer360 = await db.dataProduct.upsert({
    where: {
      organizationId_workspaceId_key: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        key: "customer-360",
      },
    },
    update: {},
    create: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      domainId: input.domainId ?? null,
      key: "customer-360",
      name: "Customer 360",
      description:
        "Conformed customer view across accounts, premises, and service points. Serves residential retention and billing analytics.",
      ownerName: "Retail Analytics",
      ownerUserId: input.ownerUserId,
      contractVersion: "2.1.0",
      contractMajor: 2,
      contractMinor: 1,
      contractPatch: 0,
      semanticModelVersion: "2.1.0",
      layer: "GOLD",
      qualityScore: 94,
      lastRefreshedAt: now,
      freshnessSlaHours: 24,
      sensitivity: "CONFIDENTIAL",
    },
    select: { id: true },
  });

  const meterToCash = await db.dataProduct.upsert({
    where: {
      organizationId_workspaceId_key: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        key: "meter-to-cash",
      },
    },
    update: {},
    create: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      domainId: input.domainId ?? null,
      key: "meter-to-cash",
      name: "Meter-to-Cash",
      description:
        "Certified billing lifecycle metrics from meter read through invoice and payment.",
      ownerName: "Revenue Operations",
      ownerUserId: input.ownerUserId,
      contractVersion: "1.4.2",
      contractMajor: 1,
      contractMinor: 4,
      contractPatch: 2,
      semanticModelVersion: "1.4.0",
      layer: "GOLD",
      qualityScore: 88,
      lastRefreshedAt: now,
      freshnessSlaHours: 12,
      sensitivity: "INTERNAL",
    },
    select: { id: true },
  });

  await db.dataProductVersion.upsert({
    where: { dataProductId_contractVersion: { dataProductId: customer360.id, contractVersion: "2.1.0" } },
    update: {},
    create: {
      organizationId: input.organizationId,
      dataProductId: customer360.id,
      contractVersion: "2.1.0",
      contractMajor: 2,
      contractMinor: 1,
      contractPatch: 0,
      semanticModelVersion: "2.1.0",
      changeSummary: "Added premise-level churn attributes and a certified retention grain.",
      contentHash: "seed-customer-360-2.1.0",
    },
  });

  const churn = await db.certifiedMetric.upsert({
    where: { dataProductId_key: { dataProductId: customer360.id, key: "residential_churn_rate" } },
    update: {},
    create: {
      organizationId: input.organizationId,
      dataProductId: customer360.id,
      key: "residential_churn_rate",
      name: "Residential churn rate",
      definition:
        "Share of residential accounts that terminate service in a rolling 90-day window, excluding moves within the service territory.",
      grain: "account / month",
      unit: "percent",
      semanticRef: "semantic.customer_360.residential_churn_rate",
      certifiedAt: now,
      certifiedBy: "Retail Analytics",
    },
    select: { id: true },
  });

  const highBill = await db.certifiedMetric.upsert({
    where: { dataProductId_key: { dataProductId: customer360.id, key: "high_bill_risk" } },
    update: {},
    create: {
      organizationId: input.organizationId,
      dataProductId: customer360.id,
      key: "high_bill_risk",
      name: "High-bill risk score",
      definition:
        "Modelled likelihood that an account's next invoice exceeds its trailing 12-month average by more than 40%.",
      grain: "account / billing cycle",
      unit: "score 0-1",
      semanticRef: "semantic.customer_360.high_bill_risk",
      certifiedAt: now,
      certifiedBy: "Retail Analytics",
    },
    select: { id: true },
  });

  await db.certifiedMetric.upsert({
    where: { dataProductId_key: { dataProductId: meterToCash.id, key: "unbilled_revenue" } },
    update: {},
    create: {
      organizationId: input.organizationId,
      dataProductId: meterToCash.id,
      key: "unbilled_revenue",
      name: "Unbilled revenue",
      definition: "Consumption recorded but not yet invoiced, at the close of each billing cycle.",
      grain: "billing cycle",
      unit: "currency",
      semanticRef: "semantic.meter_to_cash.unbilled_revenue",
      certifiedAt: now,
      certifiedBy: "Revenue Operations",
    },
  });

  // ── The starter agent, mid-lifecycle at Stage 3 ──
  const agent = await db.agent.upsert({
    where: {
      organizationId_workspaceId_slug: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        slug: "customer-churn-advisor",
      },
    },
    update: {},
    create: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      domainId: input.domainId ?? null,
      slug: "customer-churn-advisor",
      name: "Customer Churn Advisor",
      summary:
        "Tells a retention analyst which residential accounts are about to leave, and what the certified numbers say about why.",
      archetype: "Advisor",
      riskTier: "decision-support",
      ownerUserId: input.ownerUserId,
      sensitivity: "CONFIDENTIAL",
      currentStageId: "3-data-product-binding",
      status: "IN_PROGRESS",
      certification: "NONE",
    },
    select: { id: true, slug: true },
  });

  const persona = await db.persona.upsert({
    where: {
      organizationId_workspaceId_key: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        key: "revenue-assurance-analyst",
      },
    },
    update: {},
    create: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      key: "revenue-assurance-analyst",
      name: "Revenue Assurance Analyst",
      kind: "BUSINESS",
      ownedDecisions:
        "Which residential accounts get a retention offer this cycle, and which billing anomalies get investigated before they become complaints.",
      cadence: "Weekly, with a daily exception review",
      currentWorkaround:
        "Exports three dashboards to a spreadsheet every Monday and reconciles them by hand.",
    },
    select: { id: true },
  });

  await db.agentPersona.upsert({
    where: { agentId_personaId: { agentId: agent.id, personaId: persona.id } },
    update: {},
    create: {
      organizationId: input.organizationId,
      agentId: agent.id,
      personaId: persona.id,
      isPrimary: true,
    },
  });

  const questionSeeds = [
    {
      key: "q-churn-rising",
      text: "Which residential segments are churning faster than last quarter?",
      intentClass: "trend",
      consequenceOfNoAnswer:
        "Retention budget goes to the loudest segment rather than the one actually leaving.",
      expectedAnswerShape: "Ranked segment list with churn rate and change versus prior quarter",
      metricKey: "residential_churn_rate",
    },
    {
      key: "q-high-bill",
      text: "Which accounts are at risk of a high bill next cycle?",
      intentClass: "forecast",
      consequenceOfNoAnswer:
        "The first the analyst hears about it is the complaint, after the invoice has gone out.",
      expectedAnswerShape: "Account list with risk score and the driver behind it",
      metricKey: "high_bill_risk",
    },
    {
      key: "q-why-leaving",
      text: "Why is churn rising in the accounts we already flagged?",
      intentClass: "diagnosis",
      consequenceOfNoAnswer:
        "Retention offers are generic, so they are expensive and they do not work.",
      expectedAnswerShape: "Contributing factors ranked by effect, each traceable to a metric",
      metricKey: "residential_churn_rate",
    },
  ] as const;

  const questionIds: Record<string, string> = {};
  for (const [index, seed] of questionSeeds.entries()) {
    const existing = await db.question.findFirst({
      where: { agentId: agent.id, text: seed.text },
      select: { id: true },
    });
    const question =
      existing ??
      (await db.question.create({
        data: {
          organizationId: input.organizationId,
          agentId: agent.id,
          personaId: persona.id,
          text: seed.text,
          intentClass: seed.intentClass,
          consequenceOfNoAnswer: seed.consequenceOfNoAnswer,
          expectedAnswerShape: seed.expectedAnswerShape,
          priority: index,
          packSourceKey: seed.key,
        },
        select: { id: true },
      }));
    questionIds[seed.key] = question.id;
  }

  // ── Stage 1 and 2 artifacts, committed ──
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
      personas: [
        {
          key: "revenue-assurance-analyst",
          name: "Revenue Assurance Analyst",
          kind: "BUSINESS",
          ownedDecisions:
            "Which residential accounts get a retention offer this cycle, and which billing anomalies get investigated before they become complaints.",
          cadence: "Weekly, with a daily exception review",
          currentWorkaround:
            "Exports three dashboards to a spreadsheet every Monday and reconciles them by hand.",
          questions: questionSeeds.map((seed, index) => ({
            key: seed.key,
            text: seed.text,
            intentClass: seed.intentClass,
            consequenceOfNoAnswer: seed.consequenceOfNoAnswer,
            expectedAnswerShape: seed.expectedAnswerShape,
            priority: index,
          })),
        },
      ],
    },
  });

  await commitArtifact(db, {
    organizationId: input.organizationId,
    agentId: agent.id,
    stageId: "2-agent-charter",
    kind: "agent-charter",
    authorUserId: input.ownerUserId,
    runCascade: false,
    content: {
      schemaVersion: "1.0.0",
      archetype: "Advisor",
      mission:
        "Help retention analysts find the residential accounts most likely to leave, and explain why using certified numbers.",
      scopeBoundary:
        "Residential accounts in the retail book, using Customer 360 and Meter-to-Cash only. Advises; never contacts a customer and never applies a credit.",
      outOfScope: [
        "Commercial and industrial accounts",
        "Making or approving retention offers",
        "Any customer-facing communication",
        "Answering questions about individual employees",
      ],
      valueHypothesis:
        "Analysts stop reconciling three dashboards by hand and start the week with a ranked, explainable list.",
      successMeasures: [
        "Time from cycle open to a reviewed retention list under one hour",
        "Every recommendation traceable to a certified metric",
      ],
      riskTier: "decision-support",
      ownerName: input.ownerName,
      escalationContact: "Head of Retail Analytics",
    },
  });

  // ── Stage 3 in progress: bindings declared, coverage mapped ──
  await declareBinding(db, {
    organizationId: input.organizationId,
    agentId: agent.id,
    dataProductId: customer360.id,
    type: "GROUNDS_ON",
    purpose:
      "Customer 360 provides the account, premise, and service-point context every answer is framed in.",
    metricIds: [],
    actorUserId: input.ownerUserId,
  });

  const queries = await declareBinding(db, {
    organizationId: input.organizationId,
    agentId: agent.id,
    dataProductId: customer360.id,
    type: "QUERIES",
    purpose:
      "Reads the certified churn rate and high-bill risk score to produce the numbers behind each recommendation.",
    metricIds: [churn.id, highBill.id],
    actorUserId: input.ownerUserId,
  });

  if (queries.ok) {
    for (const seed of questionSeeds) {
      const metricId = seed.metricKey === "residential_churn_rate" ? churn.id : highBill.id;
      await setQuestionCoverage(db, {
        organizationId: input.organizationId,
        questionId: questionIds[seed.key],
        bindingId: queries.bindingId,
        certifiedMetricId: metricId,
      });
    }
  }

  await appendAuditEvent(db, {
    organizationId: input.organizationId,
    type: "agent.created",
    subjectType: "Agent",
    subjectId: agent.id,
    actorUserId: input.ownerUserId,
    payload: { slug: agent.slug, source: "starter-workspace" },
  });

  return {
    agentId: agent.id,
    agentSlug: agent.slug,
    customer360Id: customer360.id,
    meterToCashId: meterToCash.id,
    churnMetricId: churn.id,
    highBillMetricId: highBill.id,
  };
}
