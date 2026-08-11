/**
 * The vocabulary of the gate engine.
 *
 * Exit criteria are pure functions over a pre-fetched context: no database
 * access inside a criterion. That makes them unit-testable without a database
 * and cheap enough to render as a live checklist on every page load.
 */
import type {
  ArtifactKind,
  BindingType,
  CertificationStatus,
  IntentClass,
  PlanTier,
  StageKey,
  StageRunStatus,
} from "@/lib/enums";
import type { RoleKey } from "@/lib/roles";

/**
 * One line of the stage checklist.
 *
 * `detail` is shown to a business user, so it names the thing that is missing —
 * never a schema path, never an exception. `fix` becomes the inline primary
 * action, which is what makes a blocked gate feel like guidance rather than a
 * wall (CLAUDE.md principle 4).
 */
export type CriterionResult = {
  /** Stable across releases: used by tests and analytics. */
  key: string;
  label: string;
  satisfied: boolean;
  detail: string;
  fix?: { label: string; href: string };
  /** Advisory criteria inform the reviewer but never block submission. */
  blocking: boolean;
};

export type ArtifactVersionSummary = {
  id: string;
  artifactId: string;
  kind: ArtifactKind;
  versionNumber: number;
  contentHash: string;
  content: unknown;
  isAiDraft: boolean;
  createdAt: Date;
};

export type QuestionSummary = {
  id: string;
  personaId: string;
  text: string;
  intentClass: IntentClass;
  consequenceOfNoAnswer: string;
  expectedAnswerShape: string;
};

export type PersonaWithQuestions = {
  id: string;
  key: string;
  name: string;
  kind: string;
  ownedDecisions: string;
  cadence: string;
  currentWorkaround: string;
  questions: QuestionSummary[];
};

export type CertifiedMetricSummary = {
  id: string;
  key: string;
  name: string;
  dataProductId: string;
  certifiedAt: Date | null;
  semanticRef: string;
};

export type DataProductSummary = {
  id: string;
  key: string;
  name: string;
  layer: string;
  sensitivity: string;
  qualityScore: number;
  contractVersion: string;
  contractMajor: number;
  semanticModelVersion: string;
  lastRefreshedAt: Date | null;
  metrics: CertifiedMetricSummary[];
};

export type BindingWithVersion = {
  id: string;
  status: string;
  dataProductId: string;
  bindingType: BindingType;
  currentVersion: {
    id: string;
    versionNumber: number;
    type: BindingType;
    purpose: string;
    boundContractVersion: string;
    boundContractMajor: number;
    metricIds: string[];
  } | null;
};

export type QuestionCoverageRow = {
  questionId: string;
  bindingId: string;
  certifiedMetricId: string | null;
};

export type ApprovalSummary = {
  gateId: string;
  stageId: StageKey;
  userId: string;
  roleId: RoleKey;
  decision: string;
  isSelfAttestation: boolean;
};

export type AgentSummary = {
  id: string;
  slug: string;
  name: string;
  summary: string;
  archetype: string | null;
  riskTier: string | null;
  ownerUserId: string | null;
  sensitivity: string | null;
  currentStageId: StageKey;
  status: string;
  certification: CertificationStatus;
};

export type StageRunSummary = {
  id: string;
  stageId: StageKey;
  status: StageRunStatus;
};

/** Everything a criterion may read, loaded once per evaluation. */
export type StageContext = {
  organization: { id: string; planTier: PlanTier; isReadOnly: boolean };
  agent: AgentSummary;
  stageRun: StageRunSummary;
  /** Current committed version per artifact kind; `null` when never committed. */
  artifacts: Partial<Record<ArtifactKind, ArtifactVersionSummary | null>>;
  personas: PersonaWithQuestions[];
  questions: QuestionSummary[];
  bindings: BindingWithVersion[];
  coverage: QuestionCoverageRow[];
  dataProducts: DataProductSummary[];
  approvals: ApprovalSummary[];
};

export type SoloAttestationPolicy = {
  allowed: boolean;
  /**
   * Tiers where a solo self-review satisfies the gate.
   *
   * This is a *restriction* knob, never a governance bypass: solo mode is
   * always recorded and always labelled "self-attested". A TEAM or ENTERPRISE
   * org can require peer review as policy; nothing here can make an unapproved
   * gate look approved.
   */
  allowedForPlans: PlanTier[];
  statementTemplate: string;
  minStatementLength: number;
};

export type StageDefinition = {
  key: StageKey;
  ordinal: number;
  name: string;
  purpose: string;
  requiredArtifacts: ArtifactKind[];
  requiredApproverRoles: RoleKey[];
  /** Any one of these blocks the gate outright. */
  vetoRoles: RoleKey[];
  /** Distinct approver roles needed to satisfy the gate. */
  quorum: number;
  soloAttestation: SoloAttestationPolicy;
  /** Pure: same context in, same results out. */
  exitCriteria: (ctx: StageContext) => CriterionResult[];
};
