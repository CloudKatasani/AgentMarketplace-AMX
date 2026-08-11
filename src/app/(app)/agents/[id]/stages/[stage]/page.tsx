import Link from "next/link";
import { notFound } from "next/navigation";
import { PrismaClient } from "@prisma/client";

import { ActionForm, SubmitButton } from "@/components/action-form";
import { CriteriaList } from "@/components/criteria-list";
import { ReviewPanel } from "@/components/review-panel";
import { StageRail } from "@/components/stage-rail";
import { StageOne } from "@/components/stages/stage-one";
import { StageTwo } from "@/components/stages/stage-two";
import { StageThree } from "@/components/stages/stage-three";
import { StageFour } from "@/components/stages/stage-four";
import {
  StageEight,
  StageFive,
  StageSeven,
  StageSix,
} from "@/components/stages/stage-five-to-eight";
import { Button } from "@/components/ui/button";
import { Band, Muted, PageTitle, Panel, SectionTitle } from "@/components/ui/primitives";
import { Badge, InfoBanner, StaleBanner } from "@/components/ui/status";
import { VersionHistory } from "@/components/version-history";
import { diffArtifacts } from "@/lib/artifacts/diff";
import type {
  AgentCharter,
  AgentListing,
  DatsisvScorecard,
  EvalHarness,
  GovernanceReview,
  GroundingPack,
  ToolSpecs,
} from "@/lib/artifacts/schemas";
import { requireSessionContext } from "@/lib/auth/session-context";
import { computeCoverageMatrix } from "@/lib/bindings/coverage";
import { withOrg } from "@/lib/db/scope";
import { STAGE_KEYS, type BindingType, type IntentClass } from "@/lib/enums";
import { loadStageContext } from "@/lib/lifecycle/context";
import { evaluateExitCriteria, stageByKey } from "@/lib/lifecycle/stages";
import { roleName } from "@/lib/roles";
import { hasQualifyingPersona } from "@/lib/stages/charter";
import { draftScorecard, loadEvidenceSources } from "@/lib/stages/certification";
import { draftEvalHarness, summariseEvaluation } from "@/lib/stages/evaluation";
import { loadGovernanceContext } from "@/lib/stages/governance";
import { draftGroundingPack } from "@/lib/stages/grounding";
import { loadStaleness, loadTelemetry } from "@/lib/stages/publish";
import { loadStageComments, stageLockState } from "@/lib/stages/review";

import { submitStageAction } from "../../actions";

const users = new PrismaClient();

export default async function StagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; stage: string }>;
  searchParams: Promise<{ diff?: string; from?: string; to?: string }>;
}) {
  const { id, stage: stageParam } = await params;
  const query = await searchParams;

  const parsedStage = STAGE_KEYS.schema.safeParse(stageParam);
  if (!parsedStage.success) notFound();
  const stage = stageByKey(parsedStage.data);
  const stageId = parsedStage.data;

  const session = await requireSessionContext();

  const data = await withOrg(session.organizationId, async (db) => {
    const agent = await db.agent.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, currentStageId: true, workspaceId: true },
    });
    if (!agent) return null;

    const [ctx, stageRuns, openGate, lock, versions, personaFloorMet] = await Promise.all([
      loadStageContext(db, session.organizationId, id, stageId),
      db.stageRun.findMany({ where: { agentId: id }, select: { stageId: true, status: true } }),
      db.gate.findFirst({
        where: { agentId: id, stageId, status: "OPEN" },
        select: { id: true, mode: true },
      }),
      stageLockState(db, id, stageId),
      db.artifactVersion.findMany({
        where: { artifact: { agentId: id, kind: { in: [...stage.requiredArtifacts] } } },
        orderBy: [{ artifactId: "asc" }, { versionNumber: "desc" }],
        select: {
          id: true,
          versionNumber: true,
          contentHash: true,
          content: true,
          isAiDraft: true,
          authorUserId: true,
          createdAt: true,
          artifact: { select: { kind: true, currentVersionId: true } },
        },
      }),
      hasQualifyingPersona(db, id),
    ]);

    const stageThree =
      stageId === "3-data-product-binding"
        ? await loadStageThree(db, id, agent.workspaceId)
        : null;

    const stageFour =
      stageId === "4-grounding-and-tools" ? await loadStageFour(db, id) : null;

    const stageFive =
      stageId === "5-evaluation-harness" ? await draftEvalHarness(db, id) : null;
    const stageSix =
      stageId === "6-governance-and-guardrails" ? await loadGovernanceContext(db, id) : null;
    const stageSeven =
      stageId === "7-certification"
        ? { sources: await loadEvidenceSources(db, id) }
        : null;
    const stageEight =
      stageId === "8-publish-and-operate"
        ? {
            telemetry: await loadTelemetry(db, id),
            staleness: await loadStaleness(db, id),
            status: (await db.agent.findUnique({ where: { id }, select: { status: true } }))
              ?.status ?? "DRAFT",
          }
        : null;

    return {
      agent,
      ctx,
      stageRuns,
      openGate,
      lock,
      versions,
      personaFloorMet,
      stageThree,
      stageFour,
      stageFive,
      stageSix,
      stageSeven,
      stageEight,
    };
  });

  if (!data?.agent) notFound();
  const { agent, ctx, stageRuns, openGate, lock, versions, personaFloorMet } = data;

  const authorIds = [...new Set(versions.map((v) => v.authorUserId).filter(Boolean))] as string[];
  const authors = await users.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, name: true },
  });
  const authorNames = Object.fromEntries(authors.map((a) => [a.id, a.name]));

  const comments = await withOrg(session.organizationId, (db) =>
    loadStageComments(db, id, stageId, authorNames),
  );

  const evaluation = ctx ? evaluateExitCriteria(stage, ctx) : null;
  const statusByStage = Object.fromEntries(stageRuns.map((r) => [r.stageId, r.status]));
  const stageStatus = statusByStage[stageId] ?? "NOT_STARTED";
  const readOnly = session.isReadOnly;
  const editingLocked = readOnly || lock.locked;

  const diff = buildDiff(versions, query);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/agents/${agent.id}`} className="text-muted">
          ← {agent.name}
        </Link>
        <PageTitle className="mt-1">
          Stage {stage.ordinal} · {stage.name}
        </PageTitle>
        <Muted className="mt-1 max-w-prose">{stage.purpose}</Muted>
      </div>

      <StageRail
        agentId={agent.id}
        currentStageId={agent.currentStageId}
        statusByStage={statusByStage}
      />

      {stageStatus === "STALE" ? (
        <StaleBanner
          title="This stage needs re-approval"
          cause={
            ctx?.stageRun.staleReason ??
            "Something this stage approved has changed since the approval was given."
          }
        />
      ) : null}

      {lock.locked && !readOnly ? (
        <InfoBanner>
          <span className="font-medium">{lock.reason}</span> {lock.nextAction}
        </InfoBanner>
      ) : null}

      {stageId === "1-consumption-discovery" ? (
        <StageOne
          agentId={agent.id}
          locked={editingLocked}
          personas={(ctx?.personas ?? []).map((persona) => ({
            id: persona.id,
            name: persona.name,
            kind: persona.kind,
            ownedDecisions: persona.ownedDecisions,
            cadence: persona.cadence,
            currentWorkaround: persona.currentWorkaround,
            questions: persona.questions.map((question) => ({
              id: question.id,
              text: question.text,
              intentClass: question.intentClass as IntentClass,
              consequenceOfNoAnswer: question.consequenceOfNoAnswer,
              expectedAnswerShape: question.expectedAnswerShape,
            })),
          }))}
        />
      ) : null}

      {stageId === "2-agent-charter" ? (
        <StageTwo
          agentId={agent.id}
          locked={editingLocked}
          personaFloorMet={personaFloorMet}
          charter={(ctx?.artifacts["agent-charter"]?.content as AgentCharter | undefined) ?? null}
        />
      ) : null}

      {stageId === "3-data-product-binding" && data.stageThree ? (
        <StageThree
          agentId={agent.id}
          locked={editingLocked}
          bindings={data.stageThree.bindings}
          products={data.stageThree.products}
          matrix={data.stageThree.matrix}
        />
      ) : null}

      {stageId === "4-grounding-and-tools" && data.stageFour ? (
        <StageFour
          agentId={agent.id}
          agentSlug={agent.slug}
          locked={editingLocked}
          pack={
            (ctx?.artifacts["grounding-pack"]?.content as GroundingPack | undefined) ??
            data.stageFour.draft
          }
          specs={(ctx?.artifacts["tool-specs"]?.content as ToolSpecs | undefined) ?? null}
          bindingRefs={data.stageFour.bindingRefs}
        />
      ) : null}

      {stageId === "5-evaluation-harness" && data.stageFive ? (
        (() => {
          const committed = ctx?.artifacts["eval-harness"]?.content as EvalHarness | undefined;
          const harness = committed ?? data.stageFive!;
          return (
            <StageFive
              agentId={agent.id}
              agentSlug={agent.slug}
              locked={editingLocked}
              harness={harness}
              summary={committed ? summariseEvaluation(committed) : null}
            />
          );
        })()
      ) : null}

      {stageId === "6-governance-and-guardrails" && data.stageSix ? (
        <StageSix
          agentId={agent.id}
          agentSlug={agent.slug}
          locked={editingLocked}
          review={
            (ctx?.artifacts["governance-review"]?.content as GovernanceReview | undefined) ?? null
          }
          inheritance={data.stageSix.inheritance}
          constraints={data.stageSix.constraints}
        />
      ) : null}

      {stageId === "7-certification" && data.stageSeven ? (
        <StageSeven
          agentId={agent.id}
          agentSlug={agent.slug}
          locked={editingLocked}
          sources={data.stageSeven.sources}
          scorecard={
            (ctx?.artifacts["datsisv-scorecard"]?.content as DatsisvScorecard | undefined) ??
            draftScorecard(agent.slug, data.stageSeven.sources)
          }
          evidenceHref={`/api/agents/${agent.id}/evidence`}
        />
      ) : null}

      {stageId === "8-publish-and-operate" && data.stageEight ? (
        <StageEight
          agentId={agent.id}
          agentSlug={agent.slug}
          locked={editingLocked}
          listing={(ctx?.artifacts["agent-listing"]?.content as AgentListing | undefined) ?? null}
          telemetry={data.stageEight.telemetry}
          staleness={data.stageEight.staleness}
          status={data.stageEight.status}
        />
      ) : null}

      <VersionHistory
        versions={versions.map((version) => ({
          id: version.id,
          kind: version.artifact.kind,
          versionNumber: version.versionNumber,
          contentHash: version.contentHash,
          isAiDraft: version.isAiDraft,
          authorName: version.authorUserId ? (authorNames[version.authorUserId] ?? "A member") : "System",
          createdAt: version.createdAt,
          isCurrent: version.artifact.currentVersionId === version.id,
        }))}
        diff={diff?.diff ?? null}
        compare={diff?.compare ?? null}
        basePath={`/agents/${agent.id}/stages/${stageId}`}
      />

      <ReviewPanel
        agentId={agent.id}
        stageId={stageId}
        comments={comments}
        readOnly={readOnly}
        fieldOptions={fieldOptionsFor(stageId)}
      />

      <Panel>
        <SectionTitle>Exit criteria</SectionTitle>
        <div className="mt-3">
          {evaluation ? <CriteriaList results={evaluation.results} /> : null}
        </div>

        <Band className="mt-4">
          Approved by {stage.requiredApproverRoles.map(roleName).join(" and ")}
          {stage.vetoRoles.length > 0
            ? `. ${stage.vetoRoles.map(roleName).join(" and ")} hold a blocking veto.`
            : "."}
        </Band>

        {openGate ? (
          <div className="mt-4 flex items-center gap-3">
            <Badge tone="brand">Open for review</Badge>
            <Button asChild variant="outline" size="sm">
              <Link href={`/agents/${agent.id}/gates/${openGate.id}`}>Go to the gate</Link>
            </Button>
          </div>
        ) : readOnly ? (
          <Muted className="mt-4">
            This is the read-only demo workspace, so stages cannot be submitted here.
          </Muted>
        ) : (
          <ActionForm action={submitStageAction} className="mt-4 space-y-3">
            <input type="hidden" name="agentId" value={agent.id} />
            <input type="hidden" name="stageId" value={stageId} />

            {stage.soloAttestation.allowed ? (
              <label className="flex items-start gap-2">
                <input type="checkbox" name="soloAttestation" className="mt-1" />
                <span>
                  Review this myself
                  <span className="block text-muted">
                    Allowed, recorded, and labelled &ldquo;self-attested&rdquo; on the badge —
                    never presented as a peer review.
                  </span>
                </span>
              </label>
            ) : null}

            <SubmitButton disabled={evaluation ? !evaluation.canSubmit : true}>
              Submit stage {stage.ordinal} for review
            </SubmitButton>

            {evaluation && !evaluation.canSubmit ? (
              <Muted>
                {evaluation.blockers.length} criteri{evaluation.blockers.length === 1 ? "on" : "a"}{" "}
                still to satisfy before this can be submitted.
              </Muted>
            ) : null}
          </ActionForm>
        )}
      </Panel>
    </div>
  );
}

// ───────────────────────── Loaders ─────────────────────────

type Db = Parameters<Parameters<typeof withOrg>[1]>[0];

async function loadStageThree(db: Db, agentId: string, workspaceId: string) {
  const [products, questions, bindings, coverageRows] = await Promise.all([
    db.dataProduct.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        contractVersion: true,
        qualityScore: true,
        layer: true,
        metrics: {
          where: { archivedAt: null },
          select: { id: true, key: true, name: true, certifiedAt: true },
        },
      },
    }),
    db.question.findMany({
      where: { agentId, archivedAt: null },
      orderBy: { priority: "asc" },
      select: {
        id: true,
        text: true,
        intentClass: true,
        personaId: true,
        persona: { select: { name: true } },
      },
    }),
    db.binding.findMany({
      where: { agentId, archivedAt: null },
      select: {
        id: true,
        status: true,
        bindingType: true,
        staleReason: true,
        dataProduct: { select: { id: true, name: true, contractVersion: true } },
        currentVersion: {
          select: {
            purpose: true,
            boundContractVersion: true,
            metrics: { select: { certifiedMetric: { select: { key: true } } } },
          },
        },
      },
    }),
    db.questionCoverage.findMany({
      where: { question: { agentId } },
      select: { questionId: true, bindingId: true, certifiedMetric: { select: { key: true } } },
    }),
  ]);

  const matrix = computeCoverageMatrix({
    questions: questions.map((q) => ({
      id: q.id,
      text: q.text,
      personaId: q.personaId,
      personaName: q.persona.name,
      intentClass: q.intentClass as IntentClass,
    })),
    bindings: bindings.map((b) => ({
      id: b.id,
      productId: b.dataProduct.id,
      productName: b.dataProduct.name,
      type: b.bindingType as BindingType,
    })),
    rows: coverageRows.map((row) => ({
      questionId: row.questionId,
      bindingId: row.bindingId,
      metricKey: row.certifiedMetric?.key ?? null,
    })),
  });

  return {
    products,
    matrix,
    bindings: bindings.map((binding) => ({
      id: binding.id,
      status: binding.status,
      bindingType: binding.bindingType,
      staleReason: binding.staleReason,
      productName: binding.dataProduct.name,
      productContractVersion: binding.dataProduct.contractVersion,
      purpose: binding.currentVersion?.purpose ?? null,
      pinnedContractVersion: binding.currentVersion?.boundContractVersion ?? null,
      metricKeys: binding.currentVersion?.metrics.map((m) => m.certifiedMetric.key) ?? [],
    })),
  };
}

async function loadStageFour(db: Db, agentId: string) {
  const [draft, bindings] = await Promise.all([
    draftGroundingPack(db, agentId),
    db.binding.findMany({
      where: { agentId, archivedAt: null },
      select: { bindingType: true, dataProduct: { select: { key: true, name: true } } },
    }),
  ]);

  return {
    draft: draft ?? {
      schemaVersion: "1.0.0" as const,
      agentSlug: "",
      sampleQuestions: [],
      glossary: [],
      metricDefinitions: [],
      allowedJoins: [],
      disambiguationHints: [],
    },
    bindingRefs: bindings.map((binding) => ({
      ref: `${binding.dataProduct.key}:${binding.bindingType}`,
      label: `${binding.dataProduct.name} · ${binding.bindingType.replace(/_/g, " ").toLowerCase()}`,
    })),
  };
}

// ───────────────────────── Diff ─────────────────────────

function buildDiff(
  versions: { versionNumber: number; content: string; artifact: { kind: string } }[],
  query: { diff?: string; from?: string; to?: string },
) {
  if (!query.diff || !query.from || !query.to) return null;

  const inKind = versions.filter((v) => v.artifact.kind === query.diff);
  const from = inKind.find((v) => v.versionNumber === Number(query.from));
  const to = inKind.find((v) => v.versionNumber === Number(query.to));
  if (!from || !to) return null;

  return {
    diff: diffArtifacts(safeParse(from.content), safeParse(to.content)),
    compare: {
      fromVersion: from.versionNumber,
      toVersion: to.versionNumber,
      kind: query.diff,
    },
  };
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/** Anchors a reviewer can attach a comment to, per stage. */
function fieldOptionsFor(stageId: string): { path: string; label: string }[] {
  switch (stageId) {
    case "1-consumption-discovery":
      return [
        { path: "/personas", label: "The personas" },
        { path: "/personas/0/ownedDecisions", label: "Owned decisions" },
        { path: "/personas/0/questions", label: "The questions" },
      ];
    case "2-agent-charter":
      return [
        { path: "/mission", label: "Mission" },
        { path: "/scopeBoundary", label: "Scope boundary" },
        { path: "/outOfScope", label: "Out-of-scope list" },
        { path: "/riskTier", label: "Risk tier" },
        { path: "/ownerName", label: "Accountable owner" },
      ];
    case "3-data-product-binding":
      return [
        { path: "/bindings", label: "The bindings" },
        { path: "/coverage", label: "Question coverage" },
      ];
    case "4-grounding-and-tools":
      return [
        { path: "/sampleQuestions", label: "Sample questions" },
        { path: "/glossary", label: "Glossary" },
        { path: "/allowedJoins", label: "Allowed joins" },
        { path: "/tools", label: "Tool specifications" },
      ];
    default:
      return [];
  }
}
