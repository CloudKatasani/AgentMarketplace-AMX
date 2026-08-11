/**
 * The 8-stage lifecycle, as data.
 *
 * Stage behaviour is declared here and nowhere else: required artifacts,
 * approver roles, veto roles, quorum, solo-attestation policy, and exit
 * criteria. The `Stage` table is a seeded mirror of this registry so foreign
 * keys work; `stages.test.ts` asserts the two agree.
 *
 * Every exit criterion is a pure function over a pre-fetched `StageContext`.
 * No database access, no I/O, no clock — so they can be tested exhaustively and
 * rendered on every page load without cost.
 */
import type { ArtifactKind, StageKey } from "@/lib/enums";
import type { AgentCharter } from "@/lib/artifacts/schemas";

import type { CriterionResult, StageContext, StageDefinition } from "./types";

// ─────────────────────────── Criterion helpers ───────────────────────────

const stagePath = (ctx: StageContext, stage: number) =>
  `/agents/${ctx.agent.id}/stages/${stage}`;

function artifactCommitted(ctx: StageContext, kind: ArtifactKind): boolean {
  return Boolean(ctx.artifacts[kind]);
}

function artifactCriterion(
  ctx: StageContext,
  kind: ArtifactKind,
  label: string,
  stage: number,
): CriterionResult {
  const version = ctx.artifacts[kind];
  return {
    key: `${kind}.committed`,
    label,
    satisfied: Boolean(version),
    detail: version
      ? `Version ${version.versionNumber} committed${version.isAiDraft ? " (AI draft — needs a human edit before approval)" : ""}.`
      : "Nothing has been committed yet.",
    fix: version ? undefined : { label: "Open the form", href: stagePath(ctx, stage) },
    blocking: true,
  };
}

/** A persona counts as complete when every narrative field is filled in. */
function isPersonaComplete(persona: StageContext["personas"][number]): boolean {
  return (
    persona.name.trim().length > 0 &&
    persona.ownedDecisions.trim().length > 0 &&
    persona.cadence.trim().length > 0 &&
    persona.currentWorkaround.trim().length > 0
  );
}

/** A question counts as complete when it says what breaks without an answer. */
function isQuestionComplete(question: StageContext["questions"][number]): boolean {
  return (
    question.text.trim().length > 0 &&
    question.consequenceOfNoAnswer.trim().length > 0 &&
    question.expectedAnswerShape.trim().length > 0
  );
}

const MINIMUM_QUESTIONS_PER_PERSONA = 3;

function personasMeetingFloor(ctx: StageContext) {
  return ctx.personas.filter(
    (persona) =>
      isPersonaComplete(persona) &&
      persona.questions.filter(isQuestionComplete).length >= MINIMUM_QUESTIONS_PER_PERSONA,
  );
}

function list(values: string[], max = 3): string {
  if (values.length <= max) return values.join(", ");
  return `${values.slice(0, max).join(", ")} and ${values.length - max} more`;
}

/** Shared by the Stage 2 hard block and the Stage 1 exit gate. */
function personaQuestionFloorCriterion(ctx: StageContext): CriterionResult {
  const qualifying = personasMeetingFloor(ctx);
  const shortfalls = ctx.personas
    .map((persona) => ({
      name: persona.name,
      complete: persona.questions.filter(isQuestionComplete).length,
    }))
    .filter((p) => p.complete < MINIMUM_QUESTIONS_PER_PERSONA);

  return {
    key: "persona.question-floor",
    label: `At least one persona with ${MINIMUM_QUESTIONS_PER_PERSONA} or more complete questions`,
    satisfied: qualifying.length >= 1,
    detail:
      qualifying.length >= 1
        ? `${qualifying.length} persona${qualifying.length === 1 ? "" : "s"} ready: ${list(qualifying.map((p) => p.name))}.`
        : ctx.personas.length === 0
          ? "No personas yet. An agent starts with the person whose decision is blocked, not with the model."
          : `${shortfalls.map((p) => `${p.name} has ${p.complete} of ${MINIMUM_QUESTIONS_PER_PERSONA}`).join("; ")}. A question is complete when it names the consequence of having no answer and the shape of the answer.`,
    fix: { label: "Open the persona register", href: stagePath(ctx, 1) },
    blocking: true,
  };
}

// ─────────────────────────── Coverage ───────────────────────────

export type CoverageSummary = {
  total: number;
  covered: number;
  uncovered: { id: string; text: string }[];
  isComplete: boolean;
};

/** Pure coverage arithmetic — the Stage 3 exit gate and the matrix agree by construction. */
export function summariseCoverage(ctx: StageContext): CoverageSummary {
  const coveredIds = new Set(ctx.coverage.map((row) => row.questionId));
  const uncovered = ctx.questions
    .filter((question) => !coveredIds.has(question.id))
    .map((question) => ({ id: question.id, text: question.text }));

  return {
    total: ctx.questions.length,
    covered: ctx.questions.length - uncovered.length,
    uncovered,
    isComplete: ctx.questions.length > 0 && uncovered.length === 0,
  };
}

// ─────────────────────────── Stage definitions ───────────────────────────

/**
 * Solo attestation defaults.
 *
 * Available structurally at every tier — a single practitioner must be able to
 * get value before a second human is involved (CLAUDE.md principle 3) — and
 * always labelled. `allowedForPlans` lets a paying org *require* peer review;
 * it can never make an unapproved gate look approved.
 */
function solo(statementTemplate: string): StageDefinition["soloAttestation"] {
  return {
    allowed: true,
    allowedForPlans: ["FREE", "TEAM", "ENTERPRISE"],
    statementTemplate,
    minStatementLength: 40,
  };
}

export const STAGES: readonly StageDefinition[] = [
  {
    key: "1-consumption-discovery",
    ordinal: 1,
    name: "Consumption Discovery",
    purpose:
      "Name the person whose decision is blocked, and the questions they cannot answer today.",
    requiredArtifacts: ["persona-question-register"],
    requiredApproverRoles: ["agent-product-owner"],
    vetoRoles: [],
    quorum: 1,
    soloAttestation: solo(
      "I have reviewed this persona and question register against the decisions these people actually own, and I accept it as the basis for the agent's scope.",
    ),
    exitCriteria: (ctx) => [
      artifactCriterion(ctx, "persona-question-register", "Persona and question register committed", 1),
      personaQuestionFloorCriterion(ctx),
      {
        key: "stage1.intent-spread",
        label: "Questions cover more than one intent class",
        satisfied: new Set(ctx.questions.map((q) => q.intentClass)).size > 1,
        detail:
          new Set(ctx.questions.map((q) => q.intentClass)).size > 1
            ? "The register mixes intent classes, which usually means the agent is worth building."
            : "Every question has the same intent. Agents that only do lookups are usually a report in disguise — worth a second look, but not a blocker.",
        blocking: false,
      },
    ],
  },

  {
    key: "2-agent-charter",
    ordinal: 2,
    name: "Agent Charter",
    purpose:
      "Commit to a mission, an explicit out-of-scope list, a risk tier, and a named human owner.",
    requiredArtifacts: ["agent-charter"],
    requiredApproverRoles: ["agent-product-owner", "governance-officer"],
    vetoRoles: [],
    quorum: 2,
    soloAttestation: solo(
      "I have reviewed this charter, I accept the scope boundary and out-of-scope list as written, and I am the accountable owner for this agent.",
    ),
    exitCriteria: (ctx) => {
      // The Stage 2 hard block: no charter work until Stage 1 has produced a
      // persona with real questions. Consumption-first, enforced structurally.
      const floor = personaQuestionFloorCriterion(ctx);
      const charter = ctx.artifacts["agent-charter"]?.content as AgentCharter | undefined;

      return [
        { ...floor, key: "stage2.persona-question-floor" },
        artifactCriterion(ctx, "agent-charter", "Charter committed", 2),
        {
          key: "stage2.out-of-scope-declared",
          label: "Out-of-scope list is not empty",
          satisfied: (charter?.outOfScope?.length ?? 0) > 0,
          detail:
            (charter?.outOfScope?.length ?? 0) > 0
              ? `${charter!.outOfScope.length} exclusion${charter!.outOfScope.length === 1 ? "" : "s"} declared.`
              : "An agent with no stated exclusions has no scope boundary — it has an aspiration. Name at least one thing it must not do.",
          fix: { label: "Edit the charter", href: stagePath(ctx, 2) },
          blocking: true,
        },
        {
          key: "stage2.owner-named",
          label: "A named human owner and escalation contact",
          satisfied: Boolean(charter?.ownerName && charter?.escalationContact),
          detail: charter?.ownerName
            ? `Owner: ${charter.ownerName}. Escalation: ${charter.escalationContact}.`
            : "Agents are chartered, not deployed. Someone has to be accountable by name.",
          fix: { label: "Edit the charter", href: stagePath(ctx, 2) },
          blocking: true,
        },
        {
          key: "stage2.risk-tier-set",
          label: "Risk tier assigned",
          satisfied: Boolean(charter?.riskTier),
          detail: charter?.riskTier
            ? `Declared ${charter.riskTier}.`
            : "The risk tier decides which guardrails and vetoes apply at Stage 6.",
          fix: { label: "Edit the charter", href: stagePath(ctx, 2) },
          blocking: true,
        },
      ];
    },
  },

  {
    key: "3-data-product-binding",
    ordinal: 3,
    name: "Data Product Binding",
    purpose:
      "Bind the agent to certified data products, and prove every question has something certified to answer it.",
    requiredArtifacts: ["binding-set"],
    requiredApproverRoles: ["data-product-owner", "agent-product-owner"],
    vetoRoles: [],
    quorum: 2,
    soloAttestation: solo(
      "I have reviewed every binding and the coverage matrix, and I accept that each question is answered by the certified metric named against it.",
    ),
    exitCriteria: (ctx) => {
      const coverage = summariseCoverage(ctx);
      const withoutVersion = ctx.bindings.filter((b) => !b.currentVersion);
      const staleBindings = ctx.bindings.filter((b) => b.status === "STALE");
      const queriesWithoutMetric = ctx.bindings.filter(
        (b) => b.currentVersion?.type === "QUERIES" && b.currentVersion.metricIds.length === 0,
      );

      return [
        artifactCriterion(ctx, "binding-set", "Binding set committed", 3),
        {
          key: "stage3.has-binding",
          label: "At least one data product binding",
          satisfied: ctx.bindings.length > 0,
          detail:
            ctx.bindings.length > 0
              ? `${ctx.bindings.length} binding${ctx.bindings.length === 1 ? "" : "s"} declared.`
              : "An agent with no bindings stands on nothing that has been certified.",
          fix: { label: "Add a binding", href: stagePath(ctx, 3) },
          blocking: true,
        },
        {
          key: "stage3.bindings-versioned",
          label: "Every binding has a committed version",
          satisfied: withoutVersion.length === 0,
          detail:
            withoutVersion.length === 0
              ? "All bindings are committed and validated."
              : `${withoutVersion.length} binding${withoutVersion.length === 1 ? " is" : "s are"} still a draft. A draft binding has not been through the validator.`,
          fix: { label: "Open bindings", href: stagePath(ctx, 3) },
          blocking: true,
        },
        {
          key: "stage3.queries-name-metrics",
          label: "Every QUERIES binding names a certified metric",
          satisfied: queriesWithoutMetric.length === 0,
          detail:
            queriesWithoutMetric.length === 0
              ? "All query bindings resolve to certified metrics."
              : `${queriesWithoutMetric.length} query binding${queriesWithoutMetric.length === 1 ? "" : "s"} name no metric, so there is no certified number behind the answer.`,
          fix: { label: "Open bindings", href: stagePath(ctx, 3) },
          blocking: true,
        },
        {
          key: "stage3.question-coverage-complete",
          label: "Every question is answered by at least one binding",
          satisfied: coverage.isComplete,
          detail: coverage.isComplete
            ? `${coverage.covered} of ${coverage.total} questions covered.`
            : coverage.total === 0
              ? "There are no questions to cover yet — go back to Stage 1."
              : `${coverage.covered} of ${coverage.total} covered. Still uncovered: ${list(coverage.uncovered.map((q) => q.text))}.`,
          fix: { label: "Open the coverage matrix", href: `${stagePath(ctx, 3)}#matrix` },
          blocking: true,
        },
        {
          key: "stage3.no-stale-bindings",
          label: "No binding is waiting on a re-certification",
          satisfied: staleBindings.length === 0,
          detail:
            staleBindings.length === 0
              ? "All bound products are on the contract version this agent was approved against."
              : `${staleBindings.length} binding${staleBindings.length === 1 ? " is" : "s are"} stale because a bound product changed its contract. Re-approve before advancing.`,
          fix: { label: "Review stale bindings", href: stagePath(ctx, 3) },
          blocking: true,
        },
      ];
    },
  },

  {
    key: "4-grounding-and-tools",
    ordinal: 4,
    name: "Grounding & Tool Design",
    purpose:
      "Design what the agent knows and what it can call — through the semantic layer, never raw tables.",
    requiredArtifacts: ["grounding-pack", "tool-specs"],
    requiredApproverRoles: ["data-product-owner", "governance-officer"],
    vetoRoles: ["security-officer"],
    quorum: 2,
    soloAttestation: solo(
      "I have reviewed the grounding pack and tool specifications, and I accept that the agent reads only through certified metrics and the semantic layer.",
    ),
    exitCriteria: (ctx) => {
      const actsVia = ctx.bindings.filter((b) => b.currentVersion?.type === "ACTS_VIA");
      const hasToolSpecs = artifactCommitted(ctx, "tool-specs");

      return [
        artifactCriterion(ctx, "grounding-pack", "Grounding pack committed", 4),
        artifactCriterion(ctx, "tool-specs", "Tool specifications committed", 4),
        {
          key: "stage4.acts-via-has-tools",
          label: "Every action-taking binding has a tool specification",
          satisfied: actsVia.length === 0 || hasToolSpecs,
          detail:
            actsVia.length === 0
              ? "This agent takes no actions, so no tool specification is required."
              : hasToolSpecs
                ? `${actsVia.length} action binding${actsVia.length === 1 ? "" : "s"} covered by the tool specification.`
                : "This agent acts through a data product but has no tool specification, so nothing constrains what it may do.",
          fix: { label: "Open tool specs", href: stagePath(ctx, 4) },
          blocking: true,
        },
      ];
    },
  },

  // Stages 5–8: definitions ship in Phase 1 because the lifecycle rail and the
  // Stage table need them. Their exit criteria land with their authoring UI in
  // Phase 3 — no speculative criteria. See docs/phase-1-design.md §5.6.
  {
    key: "5-evaluation-harness",
    ordinal: 5,
    name: "Evaluation Harness",
    purpose: "Prove the agent answers its own questions, and refuses what it should refuse.",
    requiredArtifacts: ["eval-harness"],
    requiredApproverRoles: ["agent-product-owner", "governance-officer"],
    vetoRoles: [],
    quorum: 2,
    soloAttestation: solo(
      "I have reviewed the evaluation results against the golden set and the adversarial probes, and I accept them as evidence of fitness.",
    ),
    exitCriteria: () => [],
  },
  {
    key: "6-governance-and-guardrails",
    ordinal: 6,
    name: "Governance & Guardrails",
    purpose: "Decide who may invoke it, what it inherits, and who can switch it off.",
    requiredArtifacts: ["governance-review"],
    requiredApproverRoles: ["governance-officer"],
    vetoRoles: ["privacy-officer", "security-officer"],
    quorum: 1,
    soloAttestation: solo(
      "I have reviewed the access policy, sensitivity inheritance, and rollback runbook, and I accept them as sufficient for this agent's risk tier.",
    ),
    exitCriteria: () => [],
  },
  {
    key: "7-certification",
    ordinal: 7,
    name: "Certification (DATSIS+V)",
    purpose: "Score every dimension against cited evidence, and produce the pack you hand an auditor.",
    requiredArtifacts: ["datsisv-scorecard"],
    requiredApproverRoles: ["governance-officer", "data-product-owner", "agent-product-owner"],
    vetoRoles: ["privacy-officer", "security-officer"],
    quorum: 3,
    soloAttestation: solo(
      "I have scored every DATSIS+V dimension against cited artifact evidence, and I accept this certification on my own attestation.",
    ),
    exitCriteria: () => [],
  },
  {
    key: "8-publish-and-operate",
    ordinal: 8,
    name: "Publish & Operate",
    purpose: "List it, watch it, and retire it deliberately when its time comes.",
    requiredArtifacts: ["agent-listing"],
    requiredApproverRoles: ["agent-product-owner", "governance-officer"],
    vetoRoles: ["privacy-officer", "security-officer"],
    quorum: 2,
    soloAttestation: solo(
      "I have reviewed the listing, the telemetry plan, and the retirement path, and I accept publication on my own attestation.",
    ),
    exitCriteria: () => [],
  },
];

// ─────────────────────────────── Helpers ───────────────────────────────

const byKey = new Map(STAGES.map((stage) => [stage.key, stage]));

export function stageByKey(key: string): StageDefinition {
  const stage = byKey.get(key as StageKey);
  if (!stage) throw new Error(`Unknown stage: ${key}`);
  return stage;
}

export function stageByOrdinal(ordinal: number): StageDefinition | undefined {
  return STAGES.find((stage) => stage.ordinal === ordinal);
}

export function nextStage(key: StageKey): StageDefinition | null {
  return stageByOrdinal(stageByKey(key).ordinal + 1) ?? null;
}

export function previousStage(key: StageKey): StageDefinition | null {
  return stageByOrdinal(stageByKey(key).ordinal - 1) ?? null;
}

export type ExitEvaluation = {
  results: CriterionResult[];
  /** Every blocking criterion is satisfied. */
  canSubmit: boolean;
  blockers: CriterionResult[];
};

export function evaluateExitCriteria(
  stage: StageDefinition,
  ctx: StageContext,
): ExitEvaluation {
  const results = stage.exitCriteria(ctx);
  const blockers = results.filter((r) => r.blocking && !r.satisfied);
  return { results, canSubmit: blockers.length === 0, blockers };
}
