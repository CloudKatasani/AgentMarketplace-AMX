/**
 * Artifact schemas.
 *
 * The artifacts are the product: what a gate approves is a *version of one of
 * these documents*, not a database row someone edited. Each schema is versioned
 * independently (`schemaVersion` on `ArtifactVersion`) so an evidence pack
 * exported today stays readable after the shape moves on.
 *
 */
import { z } from "zod";

import {
  AGENT_ARCHETYPES,
  ARTIFACT_KINDS,
  BINDING_TYPES,
  INTENT_CLASSES,
  PERSONA_KINDS,
  RISK_TIERS,
  SENSITIVITY_LEVELS,
} from "@/lib/enums";

const nonEmpty = (label: string, min = 1) =>
  z.string().trim().min(min, `${label} is required.`);

// ───────────────── Stage 1 · persona-question-register ─────────────────

export const questionSchema = z.object({
  key: nonEmpty("Question key"),
  text: nonEmpty("Question text", 8),
  intentClass: INTENT_CLASSES.schema,
  consequenceOfNoAnswer: nonEmpty("Consequence of no answer", 8),
  expectedAnswerShape: nonEmpty("Expected answer shape"),
  priority: z.number().int().min(0).default(0),
});

export const personaSchema = z.object({
  key: nonEmpty("Persona key"),
  name: nonEmpty("Persona name"),
  kind: PERSONA_KINDS.schema.default("BUSINESS"),
  ownedDecisions: nonEmpty("Owned decisions", 8),
  cadence: nonEmpty("Cadence"),
  currentWorkaround: nonEmpty("Current workaround", 8),
  questions: z.array(questionSchema),
});

export const personaQuestionRegisterSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  agentSlug: nonEmpty("Agent slug"),
  personas: z.array(personaSchema).min(1, "At least one persona is required."),
});
export type PersonaQuestionRegister = z.infer<typeof personaQuestionRegisterSchema>;

// ───────────────────────── Stage 2 · agent-charter ─────────────────────────

export const agentCharterSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  archetype: AGENT_ARCHETYPES.schema,
  /** One sentence. Enforced as a length ceiling, not a period count. */
  mission: nonEmpty("Mission", 20).max(240, "Keep the mission to one sentence."),
  scopeBoundary: nonEmpty("Scope boundary", 20),
  outOfScope: z
    .array(nonEmpty("Out-of-scope item"))
    .min(1, "Name at least one thing this agent must not do."),
  valueHypothesis: nonEmpty("Value hypothesis", 20),
  successMeasures: z.array(nonEmpty("Success measure")).min(1, "Add at least one success measure."),
  riskTier: RISK_TIERS.schema,
  ownerName: nonEmpty("Owner name"),
  escalationContact: nonEmpty("Escalation contact"),
});
export type AgentCharter = z.infer<typeof agentCharterSchema>;

// ─────────────────────── Stage 3 · binding-set ───────────────────────

export const bindingSetEntrySchema = z.object({
  dataProductKey: nonEmpty("Data product key"),
  type: BINDING_TYPES.schema,
  purpose: nonEmpty("Binding purpose", 10),
  boundContractVersion: nonEmpty("Bound contract version"),
  metricKeys: z.array(nonEmpty("Metric key")).default([]),
});

export const bindingSetSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  agentSlug: nonEmpty("Agent slug"),
  bindings: z.array(bindingSetEntrySchema).min(1, "An agent must bind to at least one data product."),
  /** questionKey → the bindings that answer it. */
  coverage: z.array(
    z.object({
      questionKey: nonEmpty("Question key"),
      dataProductKey: nonEmpty("Data product key"),
      metricKey: z.string().nullable().default(null),
    }),
  ),
});
export type BindingSet = z.infer<typeof bindingSetSchema>;

// ──────────────────── Stage 4 · grounding-pack ────────────────────

/**
 * Field-compatible with the DPF Stage 10 grounding pack, so a pack authored
 * there imports without translation.
 *
 * Note what is absent: there is no field for a query, a template, or a table.
 * An agent's knowledge is sample questions, vocabulary, certified metric
 * definitions, and named joins between semantic entities — never SQL.
 */
export const groundingPackSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  agentSlug: nonEmpty("Agent slug"),
  /** Seeded from the Stage 1 register; the agent's worked examples. */
  sampleQuestions: z
    .array(
      z.object({
        question: nonEmpty("Question"),
        metricKey: z.string().trim().default(""),
        expectedAnswerShape: z.string().trim().default(""),
      }),
    )
    .min(1, "Ground the agent in at least one worked example."),
  glossary: z
    .array(
      z.object({
        term: nonEmpty("Term"),
        definition: nonEmpty("Definition", 10),
      }),
    )
    .default([]),
  /** Mirrors the certified metrics the bindings name; the agent's numbers. */
  metricDefinitions: z
    .array(
      z.object({
        key: nonEmpty("Metric key"),
        definition: nonEmpty("Definition", 10),
        grain: z.string().trim().default(""),
      }),
    )
    .default([]),
  /** Joins between named semantic entities. Physical tables are rejected. */
  allowedJoins: z
    .array(
      z.object({
        from: nonEmpty("From entity"),
        to: nonEmpty("To entity"),
        on: nonEmpty("Join key"),
      }),
    )
    .default([]),
  disambiguationHints: z
    .array(
      z.object({
        ambiguousTerm: nonEmpty("Ambiguous term"),
        resolution: nonEmpty("Resolution", 10),
      }),
    )
    .default([]),
});
export type GroundingPack = z.infer<typeof groundingPackSchema>;

// ──────────────────── Stage 4 · tool-specs ────────────────────

/**
 * A JSON-Schema-ish field descriptor. Deliberately structural: a tool whose
 * inputs are "a string" is a tool nobody can review.
 */
const toolFieldSchema = z.object({
  name: nonEmpty("Field name"),
  type: z.enum(["string", "number", "boolean", "date", "enum", "array"]),
  description: nonEmpty("Field description", 5),
  required: z.boolean().default(true),
});

export const toolSpecSchema = z.object({
  name: nonEmpty("Tool name"),
  description: nonEmpty("Tool description", 10),
  /** Which binding this tool acts through — a tool with no binding is ungoverned. */
  bindingRef: nonEmpty("Binding reference"),
  inputs: z.array(toolFieldSchema).default([]),
  outputs: z.array(toolFieldSchema).default([]),
  /** When the agent must decline rather than answer. */
  refusalRules: z
    .array(nonEmpty("Refusal rule", 10))
    .min(1, "Say when this tool must refuse. A tool that never refuses has no scope."),
  escalationPath: nonEmpty("Escalation path", 5),
});

export const toolSpecsSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  agentSlug: nonEmpty("Agent slug"),
  tools: z.array(toolSpecSchema).default([]),
});
export type ToolSpecs = z.infer<typeof toolSpecsSchema>;

// ──────────────────── Stage 5 · eval-harness ────────────────────

/**
 * Manual scoring must fully work without a live model.
 *
 * Most enterprises evaluating an agent do it by reading answers, not by wiring
 * a judge model into their governance tool. So a score is a number a human
 * typed with a note beside it; running the set against a model is an optional
 * accelerant, added in Phase 4.
 */
export const evalCaseSchema = z.object({
  key: nonEmpty("Case key"),
  /** Traces back to the Stage 1 register, so the golden set is not invented. */
  questionKey: z.string().trim().default(""),
  question: nonEmpty("Question", 8),
  expectedAnswer: nonEmpty("What a good answer says", 10),
  /** Which certified metric the answer must rest on. */
  metricKey: z.string().trim().default(""),
  /** "golden" | "adversarial" */
  kind: z.enum(["golden", "adversarial"]).default("golden"),
  /** Only for adversarial cases: what the probe is trying to make it do. */
  probeClass: z
    .enum(["out-of-scope", "prompt-injection", "raw-data-access", "over-claiming", "none"])
    .default("none"),
});

export const evalScoreSchema = z.object({
  caseKey: nonEmpty("Case key"),
  /** 0–5, scored by a human against the rubric. */
  groundedness: z.number().int().min(0).max(5),
  faithfulness: z.number().int().min(0).max(5),
  citationCorrectness: z.number().int().min(0).max(5),
  /** Adversarial cases pass by *refusing*. */
  refusedCorrectly: z.boolean().default(false),
  note: z.string().trim().default(""),
  scoredBy: z.string().trim().default(""),
});

export const evalHarnessSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  agentSlug: nonEmpty("Agent slug"),
  cases: z.array(evalCaseSchema).min(1, "An evaluation with no cases proves nothing."),
  scores: z.array(evalScoreSchema).default([]),
  thresholds: z
    .object({
      minGroundedness: z.number().min(0).max(5).default(4),
      minFaithfulness: z.number().min(0).max(5).default(4),
      minCitationCorrectness: z.number().min(0).max(5).default(4),
      /** Share of adversarial probes that must be refused. */
      minAdversarialRefusalRate: z.number().min(0).max(1).default(1),
    })
    .default({}),
});
export type EvalHarness = z.infer<typeof evalHarnessSchema>;

// ──────────────────── Stage 6 · governance-review ────────────────────

export const governanceReviewSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  agentSlug: nonEmpty("Agent slug"),
  /** Who may invoke it. Named roles or groups, never "everyone". */
  invocationAccess: z
    .array(nonEmpty("Audience"))
    .min(1, "Say who may invoke this agent. 'Anyone' is not an access policy."),
  /** Computed from the bound products, recorded here as the agent's own. */
  inheritedSensitivity: SENSITIVITY_LEVELS.schema,
  /** Constraints from the industry pack's regulatory library. */
  regulatoryConstraints: z
    .array(
      z.object({
        key: nonEmpty("Constraint key"),
        name: nonEmpty("Constraint name"),
        howAddressed: nonEmpty("How this agent addresses it", 10),
      }),
    )
    .default([]),
  incidentRunbook: nonEmpty("Incident runbook", 20),
  rollbackPlan: nonEmpty("Rollback plan", 20),
  killSwitchOwner: nonEmpty("Kill-switch owner"),
});
export type GovernanceReview = z.infer<typeof governanceReviewSchema>;

// ──────────────────── Stage 7 · datsisv-scorecard ────────────────────

export const DATSISV_DIMENSIONS = [
  "discoverable",
  "addressable",
  "trustworthy",
  "self-describing",
  "interoperable",
  "secure",
  "valuable",
] as const;
export type DatsisvDimension = (typeof DATSISV_DIMENSIONS)[number];

export const DATSISV_LABELS: Record<DatsisvDimension, string> = {
  discoverable: "Discoverable — can the right person find it?",
  addressable: "Addressable — can it be reached and invoked predictably?",
  trustworthy: "Trustworthy — is what it stands on certified and current?",
  "self-describing": "Self-describing — does it explain its own scope and limits?",
  interoperable: "Interoperable — does it use conformed entities and metrics?",
  secure: "Secure — is access, sensitivity, and action risk controlled?",
  valuable: "Valuable — does it move the decision it was chartered for?",
};

/**
 * Evidence is a *citation*, never free text.
 *
 * A dimension is scored against an artifact version and a field inside it, so
 * a reader can go and look. That is the difference between a certification and
 * an opinion — and it is why the scorecard cannot be filled in before the
 * artifacts exist.
 */
export const evidenceCitationSchema = z.object({
  artifactKind: ARTIFACT_KINDS.schema,
  versionNumber: z.number().int().positive(),
  fieldPath: nonEmpty("Field path"),
  /** Copied at citation time so the pack reads without the database. */
  excerpt: nonEmpty("Excerpt", 5),
});

export const datsisvScoreSchema = z.object({
  dimension: z.enum(DATSISV_DIMENSIONS),
  score: z.number().int().min(0).max(5),
  citations: z
    .array(evidenceCitationSchema)
    .min(1, "Cite the artifact and field this score rests on."),
  note: z.string().trim().default(""),
});

export const datsisvScorecardSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  agentSlug: nonEmpty("Agent slug"),
  scores: z.array(datsisvScoreSchema),
  /** The +V: an explicit statement of the value delivered, with its measure. */
  valueStatement: nonEmpty("Value statement", 20),
  minimumScore: z.number().int().min(0).max(5).default(3),
});
export type DatsisvScorecard = z.infer<typeof datsisvScorecardSchema>;

// ──────────────────── Stage 8 · agent-listing ────────────────────

export const agentListingSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  agentSlug: nonEmpty("Agent slug"),
  headline: nonEmpty("Headline", 10).max(140, "Keep the headline to one line."),
  /** Who this is for, in their own words. */
  audience: z.array(nonEmpty("Audience")).min(1, "Name who this listing is for."),
  howToInvoke: nonEmpty("How to invoke it", 10),
  supportContact: nonEmpty("Support contact"),
  /** Set when the agent is deprecated, so consumers get a reason and a date. */
  deprecation: z
    .object({
      reason: nonEmpty("Deprecation reason", 10),
      retireAfter: nonEmpty("Retire-after date"),
      replacement: z.string().trim().default(""),
    })
    .nullable()
    .default(null),
});
export type AgentListing = z.infer<typeof agentListingSchema>;

// ─────────────────────────────── Registry ───────────────────────────────

/** Schema per artifact kind, for `commit.ts` and the stage authoring forms. */
export const ARTIFACT_SCHEMAS = {
  "persona-question-register": personaQuestionRegisterSchema,
  "agent-charter": agentCharterSchema,
  "binding-set": bindingSetSchema,
  "grounding-pack": groundingPackSchema,
  "tool-specs": toolSpecsSchema,
  "eval-harness": evalHarnessSchema,
  "governance-review": governanceReviewSchema,
  "datsisv-scorecard": datsisvScorecardSchema,
  "agent-listing": agentListingSchema,
} as const;

export type SchemaBackedArtifactKind = keyof typeof ARTIFACT_SCHEMAS;

export function isSchemaBacked(kind: string): kind is SchemaBackedArtifactKind {
  return kind in ARTIFACT_SCHEMAS;
}
