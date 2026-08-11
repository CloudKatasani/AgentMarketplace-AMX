/**
 * Every enum in the product, in one place.
 *
 * Prisma cannot express native enums on SQLite, so enum columns are `String`
 * and their domain is owned here — validated by Zod at every boundary. One
 * source of truth, and the schema stays portable to Postgres unchanged.
 * See docs/phase-1-design.md §5.1.
 */
import { z } from "zod";

/** Builds a Zod enum plus the readonly tuple, from one declaration. */
function enumOf<const T extends readonly [string, ...string[]]>(values: T) {
  return { values, schema: z.enum(values) } as const;
}

// ───────────────────────────── Tenancy & plans ─────────────────────────────

export const PLAN_TIERS = enumOf(["FREE", "TEAM", "ENTERPRISE"] as const);
export type PlanTier = z.infer<typeof PLAN_TIERS.schema>;

// ───────────────────────────── Agent lifecycle ─────────────────────────────

export const STAGE_KEYS = enumOf([
  "1-consumption-discovery",
  "2-agent-charter",
  "3-data-product-binding",
  "4-grounding-and-tools",
  "5-evaluation-harness",
  "6-governance-and-guardrails",
  "7-certification",
  "8-publish-and-operate",
] as const);
export type StageKey = z.infer<typeof STAGE_KEYS.schema>;

export const AGENT_STATUSES = enumOf([
  "DRAFT",
  "IN_PROGRESS",
  "PUBLISHED",
  "DEPRECATED",
  "RETIRED",
] as const);
export type AgentStatus = z.infer<typeof AGENT_STATUSES.schema>;

export const CERTIFICATION_STATUSES = enumOf([
  "NONE",
  "SELF_ATTESTED",
  "PEER_CERTIFIED",
  "STALE",
] as const);
export type CertificationStatus = z.infer<typeof CERTIFICATION_STATUSES.schema>;

export const AGENT_ARCHETYPES = enumOf([
  "Analyst",
  "Advisor",
  "Monitor",
  "Operator",
  "Navigator",
  "Educator",
] as const);
export type AgentArchetype = z.infer<typeof AGENT_ARCHETYPES.schema>;

export const RISK_TIERS = enumOf([
  "informational",
  "decision-support",
  "action-taking",
] as const);
export type RiskTier = z.infer<typeof RISK_TIERS.schema>;

export const STAGE_RUN_STATUSES = enumOf([
  "NOT_STARTED",
  "DRAFT",
  "SUBMITTED",
  "CHANGES_REQUESTED",
  "APPROVED",
  "STALE",
] as const);
export type StageRunStatus = z.infer<typeof STAGE_RUN_STATUSES.schema>;

// ───────────────────────────── Artifacts & gates ─────────────────────────────

export const ARTIFACT_KINDS = enumOf([
  "persona-question-register",
  "agent-charter",
  "binding-set",
  "grounding-pack",
  "tool-specs",
  "eval-harness",
  "governance-review",
  "datsisv-scorecard",
  "agent-listing",
] as const);
export type ArtifactKind = z.infer<typeof ARTIFACT_KINDS.schema>;

export const ARTIFACT_FORMATS = enumOf(["yaml", "json", "markdown"] as const);
export type ArtifactFormat = z.infer<typeof ARTIFACT_FORMATS.schema>;

export const GATE_MODES = enumOf(["PEER", "SOLO_ATTESTATION"] as const);
export type GateMode = z.infer<typeof GATE_MODES.schema>;

export const GATE_STATUSES = enumOf([
  "OPEN",
  "APPROVED",
  "CHANGES_REQUESTED",
  "VETOED",
  "STALE",
] as const);
export type GateStatus = z.infer<typeof GATE_STATUSES.schema>;

export const DECISIONS = enumOf(["APPROVE", "REQUEST_CHANGES", "VETO"] as const);
export type Decision = z.infer<typeof DECISIONS.schema>;

export const TASK_KINDS = enumOf([
  "RE_APPROVAL",
  "RE_CERTIFICATION",
  "FIX_VALIDATION",
  "REVIEW_CHANGES",
] as const);
export type TaskKind = z.infer<typeof TASK_KINDS.schema>;

export const TASK_STATUSES = enumOf(["OPEN", "DONE", "CANCELLED"] as const);
export type TaskStatus = z.infer<typeof TASK_STATUSES.schema>;

// ───────────────────────────── Bindings & products ─────────────────────────────

export const BINDING_TYPES = enumOf([
  "GROUNDS_ON",
  "QUERIES",
  "RETRIEVES",
  "ACTS_VIA",
  "CITES",
] as const);
export type BindingType = z.infer<typeof BINDING_TYPES.schema>;

/** What each binding type means, in the words used on screen. */
export const BINDING_TYPE_LABELS: Record<BindingType, string> = {
  GROUNDS_ON: "Grounds on — uses the product as context for its answers",
  QUERIES: "Queries — reads certified metrics to produce numbers",
  RETRIEVES: "Retrieves — fetches documents or records from the product",
  ACTS_VIA: "Acts via — takes an action through the product's interface",
  CITES: "Cites — references the product as a source without reading it",
};

export const BINDING_STATUSES = enumOf([
  "DRAFT",
  "PROPOSED",
  "APPROVED",
  "STALE",
  "RETIRED",
] as const);
export type BindingStatus = z.infer<typeof BINDING_STATUSES.schema>;

export const SENSITIVITY_LEVELS = enumOf([
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
] as const);
export type SensitivityLevel = z.infer<typeof SENSITIVITY_LEVELS.schema>;

/** Ordered least → most sensitive; Stage 6 inherits the maximum. */
export const SENSITIVITY_ORDER: readonly SensitivityLevel[] = SENSITIVITY_LEVELS.values;

// ───────────────────────────── Consumption ─────────────────────────────

export const PERSONA_KINDS = enumOf(["BUSINESS", "IT"] as const);
export type PersonaKind = z.infer<typeof PERSONA_KINDS.schema>;

export const INTENT_CLASSES = enumOf([
  "lookup",
  "trend",
  "comparison",
  "diagnosis",
  "forecast",
  "recommendation",
  "navigation",
] as const);
export type IntentClass = z.infer<typeof INTENT_CLASSES.schema>;

// ───────────────────────────── Audit ─────────────────────────────

export const ACTOR_KINDS = enumOf(["USER", "SYSTEM"] as const);
export type ActorKind = z.infer<typeof ACTOR_KINDS.schema>;

/**
 * Audit event types. Append new values; never repurpose an existing one —
 * the audit trail is read by evidence packs that outlive this codebase.
 */
export const AUDIT_EVENT_TYPES = enumOf([
  "organization.created",
  "membership.created",
  "invitation.created",
  "invitation.accepted",
  "agent.created",
  "artifact.committed",
  "binding.validated",
  "binding.committed",
  "gate.opened",
  "gate.decided",
  "gate.stale",
  "stage.approved",
  "cascade.artifact-revision",
  "cascade.product-major-bump",
  "certification.changed",
  "comment.added",
  "comment.resolved",
  "dataproduct.registered",
  "dataproduct.version-bumped",
  "task.created",
] as const);
export type AuditEventType = z.infer<typeof AUDIT_EVENT_TYPES.schema>;
