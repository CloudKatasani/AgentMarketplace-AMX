import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/action-form";
import { CoverageMatrix } from "@/components/coverage-matrix";
import { CriteriaList } from "@/components/criteria-list";
import { StageRail } from "@/components/stage-rail";
import { Button } from "@/components/ui/button";
import {
  Band,
  EmptyState,
  Label,
  Muted,
  PageTitle,
  Panel,
  SectionTitle,
  Textarea,
} from "@/components/ui/primitives";
import { Badge, StaleBanner } from "@/components/ui/status";
import { requireSessionContext } from "@/lib/auth/session-context";
import { computeCoverageMatrix } from "@/lib/bindings/coverage";
import { withOrg } from "@/lib/db/scope";
import { BINDING_TYPES, BINDING_TYPE_LABELS, STAGE_KEYS, type IntentClass } from "@/lib/enums";
import { loadStageContext } from "@/lib/lifecycle/context";
import { evaluateExitCriteria, stageByKey } from "@/lib/lifecycle/stages";
import { roleName } from "@/lib/roles";

import { declareBindingAction, submitStageAction } from "../../actions";

export default async function StagePage({
  params,
}: {
  params: Promise<{ id: string; stage: string }>;
}) {
  const { id, stage: stageParam } = await params;
  const parsedStage = STAGE_KEYS.schema.safeParse(stageParam);
  if (!parsedStage.success) notFound();
  const stage = stageByKey(parsedStage.data);

  const session = await requireSessionContext();

  const data = await withOrg(session.organizationId, async (db) => {
    const agent = await db.agent.findUnique({
      where: { id },
      select: { id: true, name: true, currentStageId: true, workspaceId: true },
    });
    if (!agent) return null;

    const [ctx, stageRuns, openGate, products, questions, bindings, coverageRows] =
      await Promise.all([
        loadStageContext(db, session.organizationId, id, parsedStage.data),
        db.stageRun.findMany({ where: { agentId: id }, select: { stageId: true, status: true } }),
        db.gate.findFirst({
          where: { agentId: id, stageId: parsedStage.data, status: "OPEN" },
          select: { id: true, mode: true },
        }),
        db.dataProduct.findMany({
          where: { workspaceId: agent.workspaceId, archivedAt: null },
          select: {
            id: true,
            name: true,
            contractVersion: true,
            qualityScore: true,
            layer: true,
            lastRefreshedAt: true,
            metrics: {
              where: { archivedAt: null },
              select: { id: true, key: true, name: true, certifiedAt: true },
            },
          },
        }),
        db.question.findMany({
          where: { agentId: id, archivedAt: null },
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
          where: { agentId: id, archivedAt: null },
          select: {
            id: true,
            status: true,
            bindingType: true,
            staleReason: true,
            dataProduct: { select: { id: true, name: true, contractVersion: true } },
            currentVersion: {
              select: {
                versionNumber: true,
                purpose: true,
                boundContractVersion: true,
                metrics: { select: { certifiedMetric: { select: { key: true } } } },
              },
            },
          },
        }),
        db.questionCoverage.findMany({
          where: { question: { agentId: id } },
          select: {
            questionId: true,
            bindingId: true,
            certifiedMetric: { select: { key: true } },
          },
        }),
      ]);

    return { agent, ctx, stageRuns, openGate, products, questions, bindings, coverageRows };
  });

  if (!data?.agent) notFound();
  const { agent, ctx, stageRuns, openGate, products, questions, bindings, coverageRows } = data;
  const evaluation = ctx ? evaluateExitCriteria(stage, ctx) : null;
  const statusByStage = Object.fromEntries(stageRuns.map((r) => [r.stageId, r.status]));
  const stageStatus = statusByStage[stage.key] ?? "NOT_STARTED";

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
      type: b.bindingType as (typeof BINDING_TYPES.values)[number],
    })),
    rows: coverageRows.map((row) => ({
      questionId: row.questionId,
      bindingId: row.bindingId,
      metricKey: row.certifiedMetric?.key ?? null,
    })),
  });

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
            ctx?.stageRun.status === "STALE"
              ? "Something this stage approved has changed since the approval was given."
              : "A dependency changed after this stage was approved."
          }
        />
      ) : null}

      {stage.key === "3-data-product-binding" ? (
        <>
          <Panel>
            <SectionTitle>Bindings</SectionTitle>
            <Muted className="mt-1">
              What this agent stands on. Each binding is versioned and pinned to the contract
              version it was approved against.
            </Muted>

            {bindings.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title="No bindings yet"
                  body="An agent with no bindings stands on nothing that has been certified. Bind it to a data product below."
                  action={undefined}
                />
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {bindings.map((binding) => (
                  <li key={binding.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{binding.dataProduct.name}</span>
                      <Badge tone="neutral">
                        {binding.bindingType.replace(/_/g, " ").toLowerCase()}
                      </Badge>
                      {binding.status === "STALE" ? (
                        <Badge tone="warning">Stale</Badge>
                      ) : (
                        <Badge tone="brand">{binding.status.toLowerCase()}</Badge>
                      )}
                      <span className="text-muted">
                        pinned to contract {binding.currentVersion?.boundContractVersion ?? "—"}
                        {binding.currentVersion &&
                        binding.currentVersion.boundContractVersion !==
                          binding.dataProduct.contractVersion
                          ? ` · product is now ${binding.dataProduct.contractVersion}`
                          : ""}
                      </span>
                    </div>
                    <p className="mt-1 max-w-prose text-muted">
                      {binding.currentVersion?.purpose}
                    </p>
                    {binding.currentVersion && binding.currentVersion.metrics.length > 0 ? (
                      <p className="mt-1 text-muted">
                        Metrics:{" "}
                        {binding.currentVersion.metrics
                          .map((m) => m.certifiedMetric.key)
                          .join(", ")}
                      </p>
                    ) : null}
                    {binding.staleReason ? (
                      <p className="mt-2 rounded bg-warning-tint px-3 py-2 text-warning">
                        {binding.staleReason}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <SectionTitle>Declare a binding</SectionTitle>
            <Muted className="mt-1">
              The validator runs before anything is saved. A binding that fails is not written at
              all — you will see why, and what to do instead.
            </Muted>

            <ActionForm action={declareBindingAction} className="mt-4 space-y-4">
              <input type="hidden" name="agentId" value={agent.id} />

              <div>
                <Label htmlFor="dataProductId">Data product</Label>
                <select
                  id="dataProductId"
                  name="dataProductId"
                  required
                  className="h-10 w-full rounded border border-border bg-surface px-3 text-body"
                >
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · contract {product.contractVersion} · quality{" "}
                      {product.qualityScore} · {product.layer}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="type">Binding type</Label>
                <select
                  id="type"
                  name="type"
                  required
                  className="h-10 w-full rounded border border-border bg-surface px-3 text-body"
                >
                  {BINDING_TYPES.values.map((type) => (
                    <option key={type} value={type}>
                      {BINDING_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="purpose" hint="one sentence">
                  What is this binding for?
                </Label>
                <Textarea id="purpose" name="purpose" rows={2} required minLength={10} />
              </div>

              <fieldset>
                <legend className="mb-1 font-medium">
                  Certified metrics{" "}
                  <span className="font-normal text-muted">required for a QUERIES binding</span>
                </legend>
                <div className="space-y-1">
                  {products.flatMap((product) =>
                    product.metrics.map((metric) => (
                      <label key={metric.id} className="flex items-center gap-2">
                        <input type="checkbox" name="metricIds" value={metric.id} />
                        <span>
                          {metric.name}{" "}
                          <span className="text-muted">
                            ({product.name} · {metric.key}
                            {metric.certifiedAt ? "" : " · not certified"})
                          </span>
                        </span>
                      </label>
                    )),
                  )}
                </div>
              </fieldset>

              <SubmitButton pendingLabel="Validating…">Validate and commit</SubmitButton>
            </ActionForm>
          </Panel>

          <Panel id="matrix">
            <SectionTitle>Question coverage</SectionTitle>
            <div className="mt-3">
              <CoverageMatrix matrix={matrix} />
            </div>
          </Panel>
        </>
      ) : (
        <Panel>
          <SectionTitle>Artifacts</SectionTitle>
          <Muted className="mt-2">
            {stage.requiredArtifacts.join(", ")} —{" "}
            {stage.ordinal <= 4
              ? "the authoring form for this stage arrives in Phase 2."
              : "this stage's authoring screens arrive in Phase 3."}
          </Muted>
        </Panel>
      )}

      <Panel>
        <SectionTitle>Exit criteria</SectionTitle>
        <div className="mt-3">{evaluation ? <CriteriaList results={evaluation.results} /> : null}</div>

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
        ) : (
          <ActionForm action={submitStageAction} className="mt-4 space-y-3">
            <input type="hidden" name="agentId" value={agent.id} />
            <input type="hidden" name="stageId" value={stage.key} />

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
