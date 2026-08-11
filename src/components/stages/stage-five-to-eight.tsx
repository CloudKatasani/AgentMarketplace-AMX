import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/action-form";
import {
  Band,
  Input,
  Label,
  Muted,
  Panel,
  SectionTitle,
  Textarea,
} from "@/components/ui/primitives";
import { Badge, StaleBanner } from "@/components/ui/status";
import {
  deprecateAgentAction,
  saveEvalHarnessAction,
  saveGovernanceAction,
  saveListingAction,
  saveScorecardAction,
} from "@/app/(app)/agents/[id]/stages/[stage]/actions";
import {
  DATSISV_DIMENSIONS,
  DATSISV_LABELS,
  type AgentListing,
  type DatsisvScorecard,
  type EvalHarness,
  type GovernanceReview,
} from "@/lib/artifacts/schemas";
import type { EvalSummary } from "@/lib/stages/evaluation";
import type { RegulatoryConstraint, SensitivityInheritance } from "@/lib/stages/governance";
import type { EvidenceSource } from "@/lib/stages/certification";
import type { StalenessRow, UsageTelemetry } from "@/lib/stages/publish";

const selectClass = "h-10 w-full rounded border border-border bg-surface px-3 text-body";

// ───────────────────────────── Stage 5 ─────────────────────────────

/**
 * Scoring by hand is the primary path, not a fallback.
 *
 * Adversarial cases get a single checkbox rather than three sliders, because
 * their pass condition is different in kind: they pass by being refused.
 */
export function StageFive({
  agentId,
  agentSlug,
  harness,
  summary,
  locked,
}: {
  agentId: string;
  agentSlug: string;
  harness: EvalHarness;
  summary: EvalSummary | null;
  locked: boolean;
}) {
  const golden = harness.cases.filter((c) => c.kind === "golden");
  const adversarial = harness.cases.filter((c) => c.kind === "adversarial");
  const scoreFor = (key: string) => harness.scores.find((s) => s.caseKey === key);

  return (
    <Panel>
      <SectionTitle>Evaluation harness</SectionTitle>
      <Muted className="mt-1 max-w-prose">
        The golden set comes from the questions this agent was chartered to answer; the adversarial
        set probes the boundary. Score by reading the answers — no model required.
      </Muted>

      {summary ? (
        <Band className="mt-3">
          {summary.meetsThresholds ? (
            <>
              <span className="font-medium">Thresholds met.</span> Groundedness{" "}
              {summary.averages.groundedness.toFixed(1)}, faithfulness{" "}
              {summary.averages.faithfulness.toFixed(1)}, citations{" "}
              {summary.averages.citationCorrectness.toFixed(1)};{" "}
              {Math.round(summary.adversarialRefusalRate * 100)}% of probes refused.
            </>
          ) : summary.unscored.length > 0 ? (
            <>
              <span className="font-medium">
                {summary.unscored.length} of {harness.cases.length} cases still unscored.
              </span>{" "}
              A partial evaluation is not evidence.
            </>
          ) : (
            <>
              <span className="font-medium">Below threshold.</span> {summary.failures[0]?.reason}
            </>
          )}
        </Band>
      ) : null}

      <ActionForm action={saveEvalHarnessAction} className="mt-5 space-y-6">
        <input type="hidden" name="agentId" value={agentId} />
        <input type="hidden" name="agentSlug" value={agentSlug} />

        <fieldset disabled={locked} className="space-y-6 disabled:opacity-60">
          {harness.cases.map((testCase, index) => (
            <input
              key={`case-${index}`}
              type="hidden"
              name={`case.${index}.key`}
              value={testCase.key}
              // The remaining case fields ride along as hidden inputs below.
            />
          ))}
          {harness.cases.map((testCase, index) => (
            <div key={`meta-${index}`} className="hidden">
              <input type="hidden" name={`case.${index}.questionKey`} value={testCase.questionKey} />
              <input type="hidden" name={`case.${index}.question`} value={testCase.question} />
              <input
                type="hidden"
                name={`case.${index}.expectedAnswer`}
                value={testCase.expectedAnswer}
              />
              <input type="hidden" name={`case.${index}.metricKey`} value={testCase.metricKey} />
              <input type="hidden" name={`case.${index}.kind`} value={testCase.kind} />
              <input type="hidden" name={`case.${index}.probeClass`} value={testCase.probeClass} />
            </div>
          ))}

          <div>
            <p className="font-medium">Golden set — {golden.length} cases</p>
            <ul className="mt-2 divide-y divide-border">
              {golden.map((testCase) => {
                const index = harness.cases.indexOf(testCase);
                const score = scoreFor(testCase.key);
                return (
                  <li key={testCase.key} className="py-3">
                    <p className="font-medium">{testCase.question}</p>
                    <p className="mt-0.5 text-muted">{testCase.expectedAnswer}</p>
                    {testCase.metricKey ? (
                      <p className="mt-0.5 text-muted">
                        Should rest on <code className="text-xs">{testCase.metricKey}</code>
                      </p>
                    ) : null}
                    <input type="hidden" name={`score.${index}.caseKey`} value={testCase.key} />
                    <div className="mt-2 grid gap-2 sm:grid-cols-4">
                      {(
                        [
                          ["groundedness", "Groundedness"],
                          ["faithfulness", "Faithfulness"],
                          ["citationCorrectness", "Citations"],
                        ] as const
                      ).map(([field, label]) => (
                        <div key={field}>
                          <Label htmlFor={`s-${index}-${field}`} hint="0–5">
                            {label}
                          </Label>
                          <Input
                            id={`s-${index}-${field}`}
                            name={`score.${index}.${field}`}
                            type="number"
                            min={0}
                            max={5}
                            defaultValue={score?.[field] ?? ""}
                          />
                        </div>
                      ))}
                      <div>
                        <Label htmlFor={`s-${index}-note`} hint="optional">
                          Note
                        </Label>
                        <Input
                          id={`s-${index}-note`}
                          name={`score.${index}.note`}
                          defaultValue={score?.note ?? ""}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <p className="font-medium">Adversarial probes — {adversarial.length} cases</p>
            <Muted className="mb-2">These pass by being refused.</Muted>
            <ul className="divide-y divide-border">
              {adversarial.map((testCase) => {
                const index = harness.cases.indexOf(testCase);
                const score = scoreFor(testCase.key);
                return (
                  <li key={testCase.key} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{testCase.question}</span>
                      <Badge tone="warning">{testCase.probeClass.replace(/-/g, " ")}</Badge>
                    </div>
                    <p className="mt-0.5 text-muted">{testCase.expectedAnswer}</p>
                    <input type="hidden" name={`score.${index}.caseKey`} value={testCase.key} />
                    <label className="mt-2 flex items-center gap-2">
                      <input
                        type="checkbox"
                        name={`score.${index}.refusedCorrectly`}
                        defaultChecked={score?.refusedCorrectly ?? false}
                      />
                      <span>The agent refused or qualified correctly</span>
                    </label>
                    <Input
                      name={`score.${index}.note`}
                      defaultValue={score?.note ?? ""}
                      placeholder="What it actually said"
                      className="mt-2"
                    />
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            {(
              [
                ["minGroundedness", "Min groundedness", harness.thresholds.minGroundedness],
                ["minFaithfulness", "Min faithfulness", harness.thresholds.minFaithfulness],
                ["minCitationCorrectness", "Min citations", harness.thresholds.minCitationCorrectness],
              ] as const
            ).map(([field, label, value]) => (
              <div key={field}>
                <Label htmlFor={field}>{label}</Label>
                <Input id={field} name={field} type="number" min={0} max={5} defaultValue={value} />
              </div>
            ))}
            <div>
              <Label htmlFor="minAdversarialRefusalRate" hint="0–1">
                Min refusal rate
              </Label>
              <Input
                id="minAdversarialRefusalRate"
                name="minAdversarialRefusalRate"
                type="number"
                min={0}
                max={1}
                step={0.1}
                defaultValue={harness.thresholds.minAdversarialRefusalRate}
              />
            </div>
          </div>
        </fieldset>

        <SubmitButton disabled={locked} pendingLabel="Committing…">
          Commit the evaluation
        </SubmitButton>
      </ActionForm>
    </Panel>
  );
}

// ───────────────────────────── Stage 6 ─────────────────────────────

export function StageSix({
  agentId,
  agentSlug,
  review,
  inheritance,
  constraints,
  locked,
}: {
  agentId: string;
  agentSlug: string;
  review: GovernanceReview | null;
  inheritance: SensitivityInheritance;
  constraints: RegulatoryConstraint[];
  locked: boolean;
}) {
  const addressed = new Map(
    (review?.regulatoryConstraints ?? []).map((c) => [c.key, c.howAddressed]),
  );

  return (
    <Panel>
      <SectionTitle>Governance &amp; guardrails</SectionTitle>
      <Muted className="mt-1 max-w-prose">
        Who may invoke it, what it inherits, which rules apply, and who can switch it off.
      </Muted>

      <Band className="mt-3">
        This agent inherits <span className="font-medium">{inheritance.inherited}</span>
        {inheritance.drivenBy.length > 0
          ? ` from ${inheritance.drivenBy.map((d) => d.productName).join(", ")}`
          : ""}
        . Sensitivity is inherited, not chosen — bind to less sensitive products if you need a
        lower classification.
      </Band>

      <ActionForm action={saveGovernanceAction} className="mt-5 space-y-4">
        <input type="hidden" name="agentId" value={agentId} />
        <input type="hidden" name="agentSlug" value={agentSlug} />
        <input type="hidden" name="inheritedSensitivity" value={inheritance.inherited} />

        <fieldset disabled={locked} className="space-y-4 disabled:opacity-60">
          <div>
            <Label htmlFor="invocationAccess" hint="one audience per line">
              Who may invoke it
            </Label>
            <Textarea
              id="invocationAccess"
              name="invocationAccess"
              rows={3}
              required
              defaultValue={review?.invocationAccess.join("\n")}
              placeholder={"Retail Analytics team\nRevenue Assurance duty analysts"}
            />
          </div>

          <div>
            <p className="font-medium">
              Regulatory constraints{" "}
              <span className="font-normal text-muted">
                {constraints.length} apply at {inheritance.inherited}
              </span>
            </p>
            <div className="mt-2 space-y-3">
              {constraints.map((constraint, index) => (
                <div key={constraint.key} className="rounded border border-border p-3">
                  <input
                    type="hidden"
                    name={`constraint.${index}.key`}
                    value={constraint.key}
                  />
                  <input
                    type="hidden"
                    name={`constraint.${index}.name`}
                    value={constraint.name}
                  />
                  <Label htmlFor={`c-${index}`}>{constraint.name}</Label>
                  <Muted className="mb-1">{constraint.prompt}</Muted>
                  <Textarea
                    id={`c-${index}`}
                    name={`constraint.${index}.howAddressed`}
                    rows={2}
                    required
                    defaultValue={addressed.get(constraint.key) ?? ""}
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="incidentRunbook">Incident runbook</Label>
            <Textarea
              id="incidentRunbook"
              name="incidentRunbook"
              rows={3}
              required
              defaultValue={review?.incidentRunbook}
              placeholder="Who is paged, what they check first, and how consumers are told."
            />
          </div>

          <div>
            <Label htmlFor="rollbackPlan">Rollback plan</Label>
            <Textarea
              id="rollbackPlan"
              name="rollbackPlan"
              rows={3}
              required
              defaultValue={review?.rollbackPlan}
              placeholder="How the agent is withdrawn, and what people use in the meantime."
            />
          </div>

          <div>
            <Label htmlFor="killSwitchOwner" hint="a person, not a rota">
              Kill-switch owner
            </Label>
            <Input
              id="killSwitchOwner"
              name="killSwitchOwner"
              required
              defaultValue={review?.killSwitchOwner}
            />
          </div>
        </fieldset>

        <SubmitButton disabled={locked} pendingLabel="Committing…">
          Commit the governance review
        </SubmitButton>
      </ActionForm>
    </Panel>
  );
}

// ───────────────────────────── Stage 7 ─────────────────────────────

export function StageSeven({
  agentId,
  agentSlug,
  scorecard,
  sources,
  locked,
  evidenceHref,
}: {
  agentId: string;
  agentSlug: string;
  scorecard: DatsisvScorecard | null;
  sources: EvidenceSource[];
  locked: boolean;
  evidenceHref: string;
}) {
  const byDimension = new Map((scorecard?.scores ?? []).map((s) => [s.dimension, s]));
  const options = sources.flatMap((source) =>
    source.fields.map((field) => ({
      value: `${source.artifactKind}::${source.versionNumber}::${field.path}`,
      label: `${source.artifactKind} v${source.versionNumber} ${field.path}`,
      excerpt: field.excerpt,
      artifactKind: source.artifactKind,
      versionNumber: source.versionNumber,
      fieldPath: field.path,
    })),
  );

  return (
    <div className="space-y-6">
      <Panel>
        <SectionTitle>DATSIS+V scorecard</SectionTitle>
        <Muted className="mt-1 max-w-prose">
          Each dimension is scored against a field of a committed artifact. A score with no
          citation is an opinion, so the form will not accept one.
        </Muted>

        {options.length === 0 ? (
          <Band className="mt-3">
            Nothing is committed yet, so there is no evidence to cite. Finish the earlier stages
            first.
          </Band>
        ) : null}

        <ActionForm action={saveScorecardAction} className="mt-5 space-y-4">
          <input type="hidden" name="agentId" value={agentId} />
          <input type="hidden" name="agentSlug" value={agentSlug} />

          <fieldset disabled={locked} className="space-y-4 disabled:opacity-60">
            {DATSISV_DIMENSIONS.map((dimension, index) => {
              const existing = byDimension.get(dimension);
              const citation = existing?.citations[0];
              const selected = citation
                ? `${citation.artifactKind}::${citation.versionNumber}::${citation.fieldPath}`
                : "";

              return (
                <div key={dimension} className="rounded border border-border p-3">
                  <input type="hidden" name={`dim.${index}.dimension`} value={dimension} />
                  <p className="font-medium">{DATSISV_LABELS[dimension]}</p>

                  <div className="mt-2 grid gap-3 sm:grid-cols-[80px_1fr]">
                    <div>
                      <Label htmlFor={`d-${index}-score`} hint="0–5">
                        Score
                      </Label>
                      <Input
                        id={`d-${index}-score`}
                        name={`dim.${index}.score`}
                        type="number"
                        min={0}
                        max={5}
                        defaultValue={existing?.score ?? ""}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`d-${index}-cite`}>Evidence</Label>
                      {/* Posts "kind::version::path"; the action splits it and
                          looks the excerpt up server-side, so no client state
                          is needed to keep four fields in step. */}
                      <select
                        id={`d-${index}-cite`}
                        name={`dim.${index}.citation`}
                        defaultValue={selected}
                        className={selectClass}
                      >
                        <option value="">— cite an artifact field —</option>
                        {options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label} — {option.excerpt.slice(0, 60)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <Input
                    name={`dim.${index}.note`}
                    defaultValue={existing?.note ?? ""}
                    placeholder="Why this score"
                    className="mt-2"
                  />
                </div>
              );
            })}

            <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
              <div>
                <Label htmlFor="minimumScore">Minimum</Label>
                <Input
                  id="minimumScore"
                  name="minimumScore"
                  type="number"
                  min={0}
                  max={5}
                  defaultValue={scorecard?.minimumScore ?? 3}
                />
              </div>
              <div>
                <Label htmlFor="valueStatement" hint="the +V">
                  What value this delivers
                </Label>
                <Textarea
                  id="valueStatement"
                  name="valueStatement"
                  rows={2}
                  required
                  defaultValue={scorecard?.valueStatement}
                  placeholder="Retention analysts start the week with a ranked, explainable list instead of three dashboards."
                />
              </div>
            </div>
          </fieldset>

          <SubmitButton disabled={locked} pendingLabel="Committing…">
            Commit the scorecard
          </SubmitButton>
        </ActionForm>
      </Panel>

      <Panel>
        <SectionTitle>Evidence pack</SectionTitle>
        <Muted className="mt-1 max-w-prose">
          Everything above, assembled from committed artifact versions, with a manifest of content
          hashes and the audit chain head so a reader can verify it rather than trust it.
        </Muted>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href={`${evidenceHref}?format=pdf`}
            className="inline-flex h-10 items-center rounded bg-brand-primary px-4 font-medium text-surface no-underline hover:bg-brand-deep"
          >
            Download PDF
          </Link>
          <Link
            href={`${evidenceHref}?format=docx`}
            className="inline-flex h-10 items-center rounded border border-border px-4 font-medium no-underline hover:bg-panel"
          >
            Download Word
          </Link>
        </div>
      </Panel>
    </div>
  );
}

// ───────────────────────────── Stage 8 ─────────────────────────────

const EXPORTS: { format: string; label: string; note: string; teamOnly: boolean }[] = [
  { format: "evidence-pack-pdf", label: "Evidence pack (PDF)", note: "The one you hand an auditor.", teamOnly: false },
  { format: "evidence-pack-docx", label: "Evidence pack (Word)", note: "Same content, editable.", teamOnly: false },
  { format: "question-catalog-xlsx", label: "Question catalogue (Excel)", note: "Dropdowns and a COUNTIFS coverage summary.", teamOnly: true },
  { format: "grounding-pack-json", label: "Grounding pack (JSON)", note: "DPF Stage 10 compatible.", teamOnly: true },
  { format: "listing-json", label: "Listing (JSON)", note: "For your own catalogue.", teamOnly: true },
  { format: "binding-graph-mmd", label: "Binding graph (Mermaid)", note: "Paste into your own docs.", teamOnly: true },
  { format: "binding-graph-svg", label: "Binding graph (SVG)", note: "For a slide.", teamOnly: true },
  { format: "agent-bundle-zip", label: "Full bundle (zip)", note: "Everything above, with a manifest.", teamOnly: true },
];

export function StageEight({
  agentId,
  agentSlug,
  listing,
  telemetry,
  staleness,
  status,
  locked,
  exportsEnabled,
}: {
  agentId: string;
  agentSlug: string;
  listing: AgentListing | null;
  telemetry: UsageTelemetry;
  staleness: StalenessRow[];
  status: string;
  locked: boolean;
  exportsEnabled: boolean;
}) {
  const problems = staleness.filter((row) => row.problem);

  return (
    <div className="space-y-6">
      <Panel>
        <SectionTitle>Exports</SectionTitle>
        <Muted className="mt-1 max-w-prose">
          Every export is assembled from committed artifact versions, so it is a view of the record
          rather than a second copy that can drift.
        </Muted>

        <ul className="mt-4 space-y-2">
          {EXPORTS.map((item) => {
            const blocked = item.teamOnly && !exportsEnabled;
            return (
              <li key={item.format} className="flex flex-wrap items-center gap-3">
                {blocked ? (
                  <span className="text-muted">{item.label}</span>
                ) : (
                  <Link href={`/api/agents/${agentId}/export?format=${item.format}`}>
                    {item.label}
                  </Link>
                )}
                <span className="text-muted">{item.note}</span>
                {blocked ? <Badge tone="neutral">Team</Badge> : null}
              </li>
            );
          })}
        </ul>

        {!exportsEnabled ? (
          <Band className="mt-4">
            The evidence pack is on every plan — that is the one you hand an auditor. The bulk
            exports are part of Team.
          </Band>
        ) : null}
      </Panel>

      <Panel>
        <SectionTitle>Marketplace listing</SectionTitle>
        <Muted className="mt-1">
          How this agent introduces itself to someone who has never met it.
        </Muted>

        <ActionForm action={saveListingAction} className="mt-4 space-y-4">
          <input type="hidden" name="agentId" value={agentId} />
          <input type="hidden" name="agentSlug" value={agentSlug} />

          <fieldset disabled={locked} className="space-y-4 disabled:opacity-60">
            <div>
              <Label htmlFor="headline" hint="one line">
                Headline
              </Label>
              <Input
                id="headline"
                name="headline"
                required
                defaultValue={listing?.headline}
                placeholder="Find the residential accounts most likely to leave — and why."
              />
            </div>
            <div>
              <Label htmlFor="audience" hint="one per line">
                Who it is for
              </Label>
              <Textarea
                id="audience"
                name="audience"
                rows={3}
                required
                defaultValue={listing?.audience.join("\n")}
                placeholder={"Revenue Assurance Analysts\nRetention campaign managers"}
              />
            </div>
            <div>
              <Label htmlFor="howToInvoke">How to invoke it</Label>
              <Textarea
                id="howToInvoke"
                name="howToInvoke"
                rows={2}
                required
                defaultValue={listing?.howToInvoke}
              />
            </div>
            <div>
              <Label htmlFor="supportContact">Support contact</Label>
              <Input
                id="supportContact"
                name="supportContact"
                required
                defaultValue={listing?.supportContact}
              />
            </div>
          </fieldset>

          <SubmitButton disabled={locked} pendingLabel="Committing…">
            Commit the listing
          </SubmitButton>
        </ActionForm>
      </Panel>

      <Panel>
        <SectionTitle>Staleness</SectionTitle>
        <Muted className="mt-1">
          Two ways a published agent decays: the contract moves, or the data stops arriving.
        </Muted>

        {problems.length > 0 ? (
          <div className="mt-3">
            <StaleBanner
              title={`${problems.length} problem${problems.length === 1 ? "" : "s"} with what this agent stands on`}
              cause={problems.map((p) => p.problem).join(" ")}
            />
          </div>
        ) : null}

        <ul className="mt-3 divide-y divide-border">
          {staleness.map((row) => (
            <li key={row.productName} className="flex flex-wrap items-center gap-x-4 py-2">
              <span className="font-medium">{row.productName}</span>
              <span className="text-muted">
                pinned {row.pinnedVersion ?? "—"} · product {row.contractVersion}
              </span>
              {row.hoursSinceRefresh !== null ? (
                <span className="text-muted">
                  refreshed {Math.round(row.hoursSinceRefresh)}h ago
                  {row.freshnessSlaHours ? ` (SLA ${row.freshnessSlaHours}h)` : ""}
                </span>
              ) : null}
              {row.isStale ? (
                <Badge tone="warning">stale</Badge>
              ) : (
                <Badge tone="success">current</Badge>
              )}
            </li>
          ))}
          {staleness.length === 0 ? <li className="py-2 text-muted">No bindings.</li> : null}
        </ul>
      </Panel>

      <Panel>
        <SectionTitle>Usage</SectionTitle>
        {telemetry.total === 0 ? (
          <Muted className="mt-2">
            No invocations recorded yet. AMX does not execute agents — the runtime reports back.
          </Muted>
        ) : (
          <>
            <Band className="mt-3">
              {telemetry.total} invocations, {telemetry.last30Days} in the last 30 days.{" "}
              {Math.round(telemetry.refusalRate * 100)}% refused — a healthy refusal rate means the
              boundary is real.
            </Band>
            <div className="mt-4 grid gap-6 sm:grid-cols-3">
              <Mix title="Intent mix" rows={telemetry.intentMix.map((r) => [r.intentClass, r.count, r.share])} />
              <Mix title="Persona mix" rows={telemetry.personaMix.map((r) => [r.personaName, r.count, r.share])} />
              <Mix title="Outcomes" rows={telemetry.outcomeMix.map((r) => [r.outcome, r.count, r.share])} />
            </div>
          </>
        )}
      </Panel>

      {status === "PUBLISHED" && !locked ? (
        <Panel>
          <SectionTitle>Deprecate</SectionTitle>
          <Muted className="mt-1">
            A retired agent keeps its listing, its evidence pack, and its audit trail. Consumers
            get a reason and a date rather than a 404.
          </Muted>
          <ActionForm action={deprecateAgentAction} className="mt-4 space-y-3">
            <input type="hidden" name="agentId" value={agentId} />
            <div>
              <Label htmlFor="reason">Why</Label>
              <Textarea id="reason" name="reason" rows={2} required minLength={10} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="retireAfter">Retire after</Label>
                <Input id="retireAfter" name="retireAfter" required placeholder="2026-12-31" />
              </div>
              <div>
                <Label htmlFor="replacementSlug" hint="optional">
                  Replacement agent
                </Label>
                <Input id="replacementSlug" name="replacementSlug" />
              </div>
            </div>
            <SubmitButton variant="outline" pendingLabel="Deprecating…">
              Deprecate this agent
            </SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}
    </div>
  );
}

function Mix({ title, rows }: { title: string; rows: [string, number, number][] }) {
  return (
    <div>
      <p className="font-medium">{title}</p>
      <ul className="mt-2 space-y-1">
        {rows.map(([label, count, share]) => (
          <li key={label}>
            <div className="flex items-baseline justify-between gap-2">
              <span>{label}</span>
              <span className="text-muted">{count}</span>
            </div>
            <div className="mt-0.5 h-1.5 w-full rounded bg-band">
              <div
                className="h-1.5 rounded bg-brand-accent"
                style={{ width: `${Math.round(share * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
