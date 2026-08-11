/**
 * Artifact schemas.
 *
 * The artifacts are the product: what a gate approves is a *version of one of
 * these documents*, not a database row someone edited. Each schema is versioned
 * independently (`schemaVersion` on `ArtifactVersion`) so an evidence pack
 * exported today stays readable after the shape moves on.
 *
 * Phase 1 defines the three kinds it actually commits. Stage 4's grounding-pack
 * and tool-specs land with their authoring UI in Phase 2.
 */
import { z } from "zod";

import { AGENT_ARCHETYPES, INTENT_CLASSES, PERSONA_KINDS, RISK_TIERS, BINDING_TYPES } from "@/lib/enums";

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

// ─────────────────────────────── Registry ───────────────────────────────

/** Schema per artifact kind, for `commit.ts` and the stage authoring forms. */
export const ARTIFACT_SCHEMAS = {
  "persona-question-register": personaQuestionRegisterSchema,
  "agent-charter": agentCharterSchema,
  "binding-set": bindingSetSchema,
} as const;

export type SchemaBackedArtifactKind = keyof typeof ARTIFACT_SCHEMAS;

export function isSchemaBacked(kind: string): kind is SchemaBackedArtifactKind {
  return kind in ARTIFACT_SCHEMAS;
}
