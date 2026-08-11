# Phase 1 Design Proposal — awaiting sign-off

Per `PROMPT.md`: *"Before writing code, give me your proposed Prisma schema (tenancy included),
the shape of `stages.ts` and `bindings/validate.ts`, and the token → Tailwind wiring plan, and
wait for my sign-off on those four things."*

No application code has been written. This document is the deliverable for that gate.
Section 5 lists conflicts and judgement calls that need a decision — flagged, not silently resolved,
per `CLAUDE.md`.

---

## 0 · Design stance

Three commitments shape every decision below.

**Governance lives in the schema, not in the handlers.** The uniqueness constraints, the
append-only tables, the nullable-vs-required columns *are* the enforcement. If a rule can be
expressed as a constraint, it is a constraint. The gate engine then has one job: be the only
writer of `Approval` rows.

**Tenant isolation is deny-by-default.** A tenant-scoped query with no organisation in context
throws rather than returning rows. New models must be explicitly classified as tenant-scoped or
global; forgetting to classify one fails a test rather than leaking.

**Version pins are what make cascade possible.** `BindingVersion` records the *exact* contract
version it was approved against. Cascade invalidation is then a comparison, not a heuristic —
which is why the STALE flip can be trusted on stage in a demo.

---

## 1 · Prisma schema

### 1.1 Model classification (drives the tenancy extension)

| Class | Models |
|---|---|
| **Global** (no `organizationId`) | `User`, `Role`, `Stage`, `Industry`, `Domain`, `Account`, `Session`, `VerificationToken` |
| **Tenant-scoped** (`organizationId` required, auto-filtered) | `Workspace`, `Membership`, `MembershipRole`, `Invitation`, `Agent`, `StageRun`, `Artifact`, `ArtifactVersion`, `Gate`, `Approval`, `Comment`, `Task`, `AuditEvent`, `ChangeRequest`, `DataProduct`, `DataProductVersion`, `CertifiedMetric`, `Binding`, `BindingVersion`, `BindingMetric`, `Persona`, `AgentPersona`, `Question`, `QuestionCoverage`, `AnalyticsEvent` |
| **Tenant root** | `Organization` (filtered by id, not by `organizationId`) |
| **Append-only** (extension blocks `update`/`delete`/`upsert`) | `ArtifactVersion`, `BindingVersion`, `Approval`, `AuditEvent` |

`User` is global because one person may belong to several organisations. All access to a user
*within* a tenant goes through `Membership`, which is scoped.

### 1.2 Proposed `prisma/schema.prisma`

```prisma
// ─────────────────────────────────────────────────────────────
// Datasource — SQLite by default, Postgres via docker-compose.
// See §5.1: SQLite forbids Prisma native enums, so every enum is a
// String column whose domain is owned by a Zod schema in src/lib/enums.
// ─────────────────────────────────────────────────────────────
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// ══════════════════ Global reference data ══════════════════

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String
  passwordHash  String?          // Auth.js credentials provider
  emailVerified DateTime?
  image         String?
  createdAt     DateTime @default(now())
  archivedAt    DateTime?

  memberships   Membership[]
  accounts      Account[]
  sessions      Session[]
}

// Auth.js adapter tables — minimal, unused fields omitted.
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

/// Seeded from packs/_generic/roles.yaml. Global: role vocabulary is
/// product-level, assignment is tenant-level (see MembershipRole).
model Role {
  id          String  @id                    // stable key, e.g. "governance-officer"
  name        String
  description String
  /// May sign approvals at a gate that names this role.
  isApprover  Boolean @default(false)
  /// May cast a blocking veto (Privacy / Security Officer).
  isVeto      Boolean @default(false)
  /// Requires an Academy credential before the role may be held (Phase 4).
  requiresCredentialKey String?
  ordinal     Int

  memberships MembershipRole[]
  approvals   Approval[]
  tasks       Task[]
}

/// Lookup mirror of src/lib/lifecycle/stages.ts, seeded from it so that
/// StageRun/Artifact/Gate can carry a real foreign key. stages.ts stays the
/// single source of truth for behaviour; a test asserts the table matches it.
model Stage {
  id       String @id                        // "1-consumption-discovery"
  ordinal  Int    @unique
  name     String
  purpose  String

  stageRuns StageRun[]
  artifacts Artifact[]
  gates     Gate[]
}

model Industry {
  id          String  @id                    // "utilities", "_generic"
  name        String
  packVersion String
  summary     String

  domains       Domain[]
  organizations Organization[]
}

model Domain {
  id         String   @id                    // "utilities:customer-experience"
  industryId String
  key        String
  name       String
  industry   Industry @relation(fields: [industryId], references: [id])

  agents       Agent[]
  dataProducts DataProduct[]

  @@unique([industryId, key])
}

// ══════════════════ Tenancy ══════════════════

model Organization {
  id            String   @id @default(cuid())
  slug          String   @unique
  name          String
  /// "FREE" | "TEAM" | "ENTERPRISE" — feature flags only, never governance.
  planTier      String   @default("FREE")
  industryId    String?
  /// ENTERPRISE white-label: JSON overriding the same CSS variables as tokens.css.
  themeOverride String?
  /// Showcase tenant: demo mode entry point, seeded idempotently.
  isShowcase    Boolean  @default(false)
  /// Blocks every mutating path server-side, independent of role.
  isReadOnly    Boolean  @default(false)
  createdAt     DateTime @default(now())
  archivedAt    DateTime?

  industry    Industry?    @relation(fields: [industryId], references: [id])
  memberships Membership[]
  workspaces  Workspace[]
  invitations Invitation[]

  @@index([isShowcase])
}

model Membership {
  id             String   @id @default(cuid())
  organizationId String
  userId         String
  createdAt      DateTime @default(now())
  archivedAt     DateTime?

  organization Organization     @relation(fields: [organizationId], references: [id])
  user         User             @relation(fields: [userId], references: [id])
  roles        MembershipRole[]

  @@unique([organizationId, userId])
  @@index([organizationId])
}

model MembershipRole {
  id             String   @id @default(cuid())
  organizationId String
  membershipId   String
  roleId         String
  grantedAt      DateTime @default(now())

  membership Membership @relation(fields: [membershipId], references: [id])
  role       Role       @relation(fields: [roleId], references: [id])

  @@unique([membershipId, roleId])
  @@index([organizationId])
}

model Invitation {
  id             String   @id @default(cuid())
  organizationId String
  email          String
  roleId         String
  token          String   @unique
  expiresAt      DateTime
  acceptedAt     DateTime?
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id])

  @@index([organizationId, email])
}

model Workspace {
  id             String   @id @default(cuid())
  organizationId String
  slug           String
  name           String
  createdAt      DateTime @default(now())
  archivedAt     DateTime?

  organization Organization  @relation(fields: [organizationId], references: [id])
  agents       Agent[]
  dataProducts DataProduct[]
  personas     Persona[]

  @@unique([organizationId, slug])
  @@index([organizationId])
}

// ══════════════════ Agent lifecycle ══════════════════

model Agent {
  id             String   @id @default(cuid())
  organizationId String
  workspaceId    String
  slug           String
  name           String
  /// "Analyst" | "Advisor" | "Monitor" | "Operator" | "Navigator" | "Educator"
  archetype      String?
  /// "informational" | "decision-support" | "action-taking"
  riskTier       String?
  domainId       String?
  ownerUserId    String?
  /// Highest classification inherited from bound products (Stage 6).
  sensitivity    String?
  /// Stage the agent is currently working in.
  currentStageId String
  /// "DRAFT" | "IN_PROGRESS" | "PUBLISHED" | "DEPRECATED" | "RETIRED"
  status         String   @default("DRAFT")
  /// "NONE" | "SELF_ATTESTED" | "PEER_CERTIFIED" | "STALE"
  certification  String   @default("NONE")
  /// Plain-language reason shown in the STALE banner; null unless STALE.
  staleReason    String?
  staleAt        DateTime?
  createdAt      DateTime @default(now())
  archivedAt     DateTime?

  workspace  Workspace     @relation(fields: [workspaceId], references: [id])
  domain     Domain?       @relation(fields: [domainId], references: [id])
  stageRuns  StageRun[]
  artifacts  Artifact[]
  gates      Gate[]
  bindings   Binding[]
  questions  Question[]
  personas   AgentPersona[]
  tasks      Task[]
  comments   Comment[]
  changeRequests ChangeRequest[]

  @@unique([organizationId, workspaceId, slug])
  @@index([organizationId, status])
  @@index([organizationId, certification])
}

model StageRun {
  id             String   @id @default(cuid())
  organizationId String
  agentId        String
  stageId        String
  /// "NOT_STARTED" | "DRAFT" | "SUBMITTED" | "CHANGES_REQUESTED" | "APPROVED" | "STALE"
  status         String   @default("NOT_STARTED")
  startedAt      DateTime?
  submittedAt    DateTime?
  approvedAt     DateTime?
  /// Set when a cascade invalidates a previously-approved stage.
  stalledAt      DateTime?
  staleReason    String?

  agent Agent @relation(fields: [agentId], references: [id])
  stage Stage @relation(fields: [stageId], references: [id])
  gates Gate[]

  @@unique([agentId, stageId])
  @@index([organizationId])
}

// ══════════════════ Artifacts (immutable versions) ══════════════════

model Artifact {
  id             String   @id @default(cuid())
  organizationId String
  agentId        String
  stageId        String
  /// "persona-question-register" | "agent-charter" | "binding-set" |
  /// "grounding-pack" | "tool-specs" | "eval-harness" | "governance-review" |
  /// "datsisv-scorecard" | "agent-listing"
  kind           String
  /// Denormalised pointer for cheap reads; every version is still in the table.
  currentVersionId String? @unique
  createdAt      DateTime @default(now())
  archivedAt     DateTime?

  agent          Agent             @relation(fields: [agentId], references: [id])
  stage          Stage             @relation(fields: [stageId], references: [id])
  versions       ArtifactVersion[] @relation("ArtifactVersions")
  currentVersion ArtifactVersion?  @relation("CurrentVersion", fields: [currentVersionId], references: [id])

  @@unique([agentId, kind])
  @@index([organizationId])
}

/// APPEND-ONLY. Written exclusively by src/lib/artifacts/commit.ts.
model ArtifactVersion {
  id             String   @id @default(cuid())
  organizationId String
  artifactId     String
  versionNumber  Int
  /// sha256 of canonicalised content; identity of the version.
  contentHash    String
  /// Canonical JSON. YAML/Markdown mirrors are derived, not stored.
  content        String
  /// Semver of the Zod schema that validated this content.
  schemaVersion  String
  /// "yaml" | "json" | "markdown" — serialisation used for the workspace/ mirror.
  format         String
  /// Path of the mirrored file under workspace/.
  mirrorPath     String
  authorUserId   String?
  /// Produced by AI assist: propose-only, rendered with the AI_DRAFT treatment.
  isAiDraft      Boolean  @default(false)
  createdAt      DateTime @default(now())

  artifact       Artifact  @relation("ArtifactVersions", fields: [artifactId], references: [id])
  currentOf      Artifact? @relation("CurrentVersion")
  comments       Comment[]

  @@unique([artifactId, versionNumber])
  @@unique([artifactId, contentHash])
  @@index([organizationId])
}

// ══════════════════ Gates and approvals ══════════════════

model Gate {
  id             String   @id @default(cuid())
  organizationId String
  agentId        String
  stageId        String
  stageRunId     String
  /// Re-opened after CHANGES_REQUESTED or a cascade: round increments.
  round          Int      @default(1)
  /// "PEER" | "SOLO_ATTESTATION"
  mode           String   @default("PEER")
  /// "OPEN" | "APPROVED" | "CHANGES_REQUESTED" | "VETOED" | "STALE"
  status         String   @default("OPEN")
  /// Distinct approver roles required to satisfy this gate.
  quorum         Int      @default(1)
  /// sha256 over the sorted contentHashes of the artifact versions under review.
  /// A gate approves a *snapshot*, so any re-version provably invalidates it.
  snapshotHash   String
  openedAt       DateTime @default(now())
  decidedAt      DateTime?
  stalledAt      DateTime?
  staleReason    String?

  agent     Agent      @relation(fields: [agentId], references: [id])
  stage     Stage      @relation(fields: [stageId], references: [id])
  stageRun  StageRun   @relation(fields: [stageRunId], references: [id])
  approvals Approval[]

  @@unique([agentId, stageId, round])
  @@index([organizationId, status])
}

/// APPEND-ONLY. Written exclusively by src/lib/gates/recordDecision.ts.
/// This table is the sole evidence that a human approved anything.
model Approval {
  id             String   @id @default(cuid())
  organizationId String
  gateId         String
  userId         String
  roleId         String
  /// "APPROVE" | "REQUEST_CHANGES" | "VETO"
  decision       String
  comment        String?
  /// Free tier: approver and author are the same person. Requires a non-null,
  /// non-boilerplate attestation statement; surfaces as "self-attested".
  isSelfAttestation  Boolean @default(false)
  attestationStatement String?
  /// Snapshot the decision was cast against — proves what was actually approved.
  snapshotHash   String
  createdAt      DateTime @default(now())

  gate Gate @relation(fields: [gateId], references: [id])
  role Role @relation(fields: [roleId], references: [id])

  /// One decision per role per gate round; supersede by opening a new round.
  @@unique([gateId, userId, roleId])
  @@index([organizationId])
}

model Comment {
  id                String   @id @default(cuid())
  organizationId    String
  agentId           String
  artifactVersionId String?
  /// JSON-pointer-ish path into the artifact, e.g. "/personas/0/questions/2/text".
  fieldPath         String?
  body              String
  authorUserId      String
  /// Parking-lot items are per-stage notes that never block a gate.
  isParkingLot      Boolean  @default(false)
  resolvedAt        DateTime?
  createdAt         DateTime @default(now())

  agent           Agent            @relation(fields: [agentId], references: [id])
  artifactVersion ArtifactVersion? @relation(fields: [artifactVersionId], references: [id])

  @@index([organizationId, agentId])
}

model Task {
  id             String   @id @default(cuid())
  organizationId String
  agentId        String
  /// "RE_APPROVAL" | "RE_CERTIFICATION" | "FIX_VALIDATION" | "REVIEW_CHANGES"
  kind           String
  title          String
  description    String
  assigneeRoleId String?
  assigneeUserId String?
  /// "OPEN" | "DONE" | "CANCELLED"
  status         String   @default("OPEN")
  /// The audit event that created this task — every task traces to a cause.
  causeEventId   String?
  createdAt      DateTime @default(now())
  completedAt    DateTime?

  agent Agent @relation(fields: [agentId], references: [id])
  role  Role? @relation(fields: [assigneeRoleId], references: [id])

  @@index([organizationId, status])
}

/// APPEND-ONLY, hash-chained per organisation. `prevHash` + `hash` make
/// tampering detectable, which is what the evidence pack's manifest signs.
model AuditEvent {
  id             String   @id @default(cuid())
  organizationId String
  /// Monotonic per organisation; gives the chain a deterministic order.
  sequence       Int
  /// "USER" | "SYSTEM"
  actorKind      String   @default("USER")
  actorUserId    String?
  /// "gate.decided" | "artifact.committed" | "binding.validated" | "cascade.stale" | ...
  type           String
  subjectType    String
  subjectId      String
  payload        String   // canonical JSON, no PII beyond actor id
  prevHash       String?
  hash           String
  createdAt      DateTime @default(now())

  @@unique([organizationId, sequence])
  @@index([organizationId, subjectType, subjectId])
}

model ChangeRequest {
  id             String   @id @default(cuid())
  organizationId String
  agentId        String
  title          String
  body           String
  /// "OPEN" | "ACCEPTED" | "REJECTED"
  status         String   @default("OPEN")
  requestedByUserId String
  createdAt      DateTime @default(now())
  resolvedAt     DateTime?

  agent Agent @relation(fields: [agentId], references: [id])

  @@index([organizationId, status])
}

// ══════════════════ Data products ══════════════════

model DataProduct {
  id             String   @id @default(cuid())
  organizationId String
  workspaceId    String
  key            String
  name           String
  description    String
  domainId       String?
  ownerName      String
  ownerUserId    String?
  /// Current contract semver, split for cheap major-bump comparison.
  contractVersion      String
  contractMajor        Int
  contractMinor        Int
  contractPatch        Int
  semanticModelVersion String
  /// Serving layer. Anything not in the allowed set is rejected by the validator.
  /// "GOLD" | "PLATINUM" | "SEMANTIC" (allowed) — "RAW"|"BRONZE"|"SILVER" (denied)
  layer          String   @default("GOLD")
  qualityScore   Int
  lastRefreshedAt DateTime?
  freshnessSlaHours Int?
  /// "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED" — inherited by agents.
  sensitivity    String   @default("INTERNAL")
  /// Raw DPF/ADPM import (marketplace-listing.json + semantic-model.yaml + data-contract.yaml).
  importedFrom   String?
  createdAt      DateTime @default(now())
  archivedAt     DateTime?

  workspace Workspace            @relation(fields: [workspaceId], references: [id])
  domain    Domain?              @relation(fields: [domainId], references: [id])
  metrics   CertifiedMetric[]
  versions  DataProductVersion[]
  bindings  Binding[]

  @@unique([organizationId, workspaceId, key])
  @@index([organizationId])
}

/// History of contract/semantic versions. A new row with a higher `contractMajor`
/// than a BindingVersion's pin is exactly what fires cascade invalidation.
model DataProductVersion {
  id             String   @id @default(cuid())
  organizationId String
  dataProductId  String
  contractVersion      String
  contractMajor        Int
  contractMinor        Int
  contractPatch        Int
  semanticModelVersion String
  changeSummary  String
  contentHash    String
  createdAt      DateTime @default(now())

  dataProduct DataProduct @relation(fields: [dataProductId], references: [id])

  @@unique([dataProductId, contractVersion])
  @@index([organizationId])
}

model CertifiedMetric {
  id             String   @id @default(cuid())
  organizationId String
  dataProductId  String
  key            String                     // "residential_churn_rate"
  name           String
  definition     String
  grain          String
  unit           String?
  /// Reference into the semantic model — never a physical table.
  semanticRef    String
  certifiedAt    DateTime?
  certifiedBy    String?
  archivedAt     DateTime?

  dataProduct DataProduct     @relation(fields: [dataProductId], references: [id])
  bindings    BindingMetric[]
  coverage    QuestionCoverage[]

  @@unique([dataProductId, key])
  @@index([organizationId])
}

// ══════════════════ The Binding (first-class, versioned, gated) ══════════════════

model Binding {
  id             String   @id @default(cuid())
  organizationId String
  agentId        String
  dataProductId  String
  currentVersionId String? @unique
  /// "DRAFT" | "PROPOSED" | "APPROVED" | "STALE" | "RETIRED"
  status         String   @default("DRAFT")
  staleReason    String?
  createdAt      DateTime @default(now())
  archivedAt     DateTime?

  agent          Agent            @relation(fields: [agentId], references: [id])
  dataProduct    DataProduct      @relation(fields: [dataProductId], references: [id])
  versions       BindingVersion[] @relation("BindingVersions")
  currentVersion BindingVersion?  @relation("CurrentBindingVersion", fields: [currentVersionId], references: [id])
  coverage       QuestionCoverage[]

  /// One binding per (agent, product) pair; the *type* lives on the version,
  /// so changing type is a re-version that re-opens the gate — not an edit.
  @@unique([agentId, dataProductId])
  @@index([organizationId, status])
}

/// APPEND-ONLY. The version pins the contract it was approved against.
model BindingVersion {
  id             String   @id @default(cuid())
  organizationId String
  bindingId      String
  versionNumber  Int
  /// "GROUNDS_ON" | "QUERIES" | "RETRIEVES" | "ACTS_VIA" | "CITES"
  type           String
  purpose        String
  /// Version pin — cascade compares boundContractMajor to the product's current major.
  boundContractVersion String
  boundContractMajor   Int
  boundSemanticModelVersion String
  contentHash    String
  /// Serialised ValidationReport at commit time — the evidence pack cites this.
  validationReport String
  authorUserId   String?
  createdAt      DateTime @default(now())

  binding   Binding         @relation("BindingVersions", fields: [bindingId], references: [id])
  currentOf Binding?        @relation("CurrentBindingVersion")
  metrics   BindingMetric[]

  @@unique([bindingId, versionNumber])
  @@index([organizationId])
}

/// Metrics named by a QUERIES binding version.
model BindingMetric {
  id               String @id @default(cuid())
  organizationId   String
  bindingVersionId String
  certifiedMetricId String

  bindingVersion  BindingVersion  @relation(fields: [bindingVersionId], references: [id])
  certifiedMetric CertifiedMetric @relation(fields: [certifiedMetricId], references: [id])

  @@unique([bindingVersionId, certifiedMetricId])
  @@index([organizationId])
}

// ══════════════════ Consumption: personas, questions, coverage ══════════════════

/// Workspace-scoped and reusable across agents — this is what makes the
/// marketplace persona lens ("I am a Revenue Assurance Analyst") possible.
model Persona {
  id             String   @id @default(cuid())
  organizationId String
  workspaceId    String
  key            String
  name           String
  /// "BUSINESS" | "IT"
  kind           String   @default("BUSINESS")
  ownedDecisions String
  cadence        String
  currentWorkaround String
  /// Provenance when seeded from an industry pack.
  packSourceKey  String?
  createdAt      DateTime @default(now())
  archivedAt     DateTime?

  workspace Workspace      @relation(fields: [workspaceId], references: [id])
  agents    AgentPersona[]
  questions Question[]

  @@unique([organizationId, workspaceId, key])
  @@index([organizationId])
}

model AgentPersona {
  id             String @id @default(cuid())
  organizationId String
  agentId        String
  personaId      String
  isPrimary      Boolean @default(false)

  agent   Agent   @relation(fields: [agentId], references: [id])
  persona Persona @relation(fields: [personaId], references: [id])

  @@unique([agentId, personaId])
  @@index([organizationId])
}

model Question {
  id             String   @id @default(cuid())
  organizationId String
  agentId        String
  personaId      String
  text           String
  /// "lookup" | "trend" | "comparison" | "diagnosis" | "forecast" |
  /// "recommendation" | "navigation"
  intentClass    String
  consequenceOfNoAnswer String
  expectedAnswerShape   String
  priority       Int      @default(0)
  packSourceKey  String?
  createdAt      DateTime @default(now())
  archivedAt     DateTime?

  agent    Agent              @relation(fields: [agentId], references: [id])
  persona  Persona            @relation(fields: [personaId], references: [id])
  coverage QuestionCoverage[]

  @@index([organizationId, agentId])
}

/// One cell of the coverage matrix: this question is answered by this binding,
/// via this certified metric. Stage 3 exits only when every question has ≥1 row.
model QuestionCoverage {
  id                String @id @default(cuid())
  organizationId    String
  questionId        String
  bindingId         String
  certifiedMetricId String?
  note              String?
  createdAt         DateTime @default(now())

  question        Question         @relation(fields: [questionId], references: [id])
  binding         Binding          @relation(fields: [bindingId], references: [id])
  certifiedMetric CertifiedMetric? @relation(fields: [certifiedMetricId], references: [id])

  @@unique([questionId, bindingId])
  @@index([organizationId])
}

// ══════════════════ Analytics ══════════════════

/// Local driver's sink. No PII: `distinctId` is a salted hash of the user id.
model AnalyticsEvent {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  distinctId     String
  properties     String
  createdAt      DateTime @default(now())

  @@index([organizationId, name])
}
```

### 1.3 Tenancy enforcement

`src/lib/db/tenancy.ts` — an `AsyncLocalStorage<OrgContext>` plus one Prisma **client extension**
(see §5.2 for why an extension rather than `$use` middleware):

```ts
export const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (isGlobalModel(model)) return query(args)
        if (isAppendOnly(model) && MUTATING_OPS.has(operation)) {
          throw new AppendOnlyViolation(model, operation)
        }
        const ctx = orgContext.getStore()
        if (!ctx) throw new MissingOrgContext(model, operation)   // deny by default
        return query(withOrgScope(model, operation, args, ctx.organizationId))
      },
    },
  },
})
```

- **Reads** (`findMany`/`findFirst`/`count`/`aggregate`/`groupBy`): `AND` an
  `organizationId` predicate. `findUnique` is rewritten to `findFirst` so the
  predicate survives.
- **Writes** (`create`/`createMany`): inject `organizationId`; throw if the caller
  supplied a different one.
- **`update`/`delete`**: scoped `updateMany`/`deleteMany` semantics, and a zero-row
  result throws rather than silently no-oping.
- **Model classification** lives in one exported map. A test enumerates
  `Prisma.dmmf.datamodel.models` and fails if any model is unclassified — so adding
  a model without deciding its tenancy is a build break, not a leak.
- `runAsOrg(orgId, fn)` establishes context; `runAsSystem(fn)` is the *only* escape
  hatch (seeding, cascade sweeps) and is itself audited.

Tests: cross-org read returns empty; cross-org write throws; `findUnique` on a
foreign id returns null; no-context query throws; `AuditEvent.update` throws.

---

## 2 · `src/lib/lifecycle/stages.ts`

**The registry is data.** Exit criteria are pure functions over a *pre-fetched* context —
no database access inside a criterion. That is what makes them unit-testable without a
database and what lets the UI render a live checklist cheaply.

```ts
// ── Results ─────────────────────────────────────────────
export type CriterionResult = {
  key: string                  // "stage2.persona-complete" — stable, used in tests + analytics
  label: string                // "At least one persona with 3+ complete questions"
  satisfied: boolean
  /// Plain language, always. Never a stack trace, never a schema path.
  detail: string               // "Revenue Assurance Analyst has 2 of 3 required questions."
  /// Rendered as the inline primary action on the blocked stage — principle 4.
  fix?: { label: string; href: string }
  /// Advisory criteria inform but do not block the gate.
  blocking: boolean
}

// ── Context: everything a criterion may read, loaded once ──
export type StageContext = {
  organization: { id: string; planTier: PlanTier; isReadOnly: boolean }
  agent: AgentSummary
  stageRun: StageRunSummary
  artifacts: Record<ArtifactKind, ArtifactVersionSummary | null>
  personas: PersonaWithQuestions[]
  questions: QuestionSummary[]
  bindings: BindingWithVersionAndMetrics[]
  coverage: QuestionCoverageRow[]
  dataProducts: DataProductSummary[]
  approvals: ApprovalSummary[]
}

// ── Stage definition ────────────────────────────────────
export type StageDefinition = {
  key: StageKey                        // "3-data-product-binding"
  ordinal: number                      // 1..8
  name: string
  purpose: string
  requiredArtifacts: ArtifactKind[]
  /// Roles that must sign for a PEER gate.
  requiredApproverRoles: RoleKey[]
  /// Any one of these blocks the gate outright.
  vetoRoles: RoleKey[]
  /// Distinct approver roles needed; ≤ requiredApproverRoles.length.
  quorum: number
  soloAttestation: {
    allowed: boolean
    /// Tiers where solo satisfies the gate. Governance is not a paid feature:
    /// solo mode is always *labelled*, and higher tiers may forbid it by policy.
    allowedForPlans: PlanTier[]
    statementTemplate: string          // shown verbatim above the signature box
    minStatementLength: number         // rejects "ok" as an attestation
  }
  /// Pure. Same context in, same results out.
  exitCriteria: (ctx: StageContext) => CriterionResult[]
}

export const STAGES: readonly StageDefinition[] = [ /* 8 entries */ ]

// ── Helpers ─────────────────────────────────────────────
export function stageByKey(key: StageKey): StageDefinition
export function nextStage(key: StageKey): StageDefinition | null
export function evaluateExitCriteria(stage, ctx): {
  results: CriterionResult[]
  canSubmit: boolean               // every blocking criterion satisfied
}
```

Phase 1 implements all eight definitions; the exit criteria for stages 5–8 land with
their UI in Phase 3, declared now as explicit `blocking` criteria returning
`satisfied: false, detail: "Not yet available"` **only if** signed off — otherwise
stages 5–8 ship with `exitCriteria: () => []` and are wired in Phase 3. See §5.6.

The two criteria that carry the product:

```ts
// Stage 2 hard-block
{
  key: "stage2.persona-question-floor",
  label: "At least one persona with 3 or more complete questions",
  satisfied: personasWithCompleteQuestions(ctx).length >= 1,
  detail: /* names the persona and the shortfall */,
  fix: { label: "Add questions", href: `/agents/${id}/stages/1` },
  blocking: true,
}

// Stage 3 exit — 100% coverage, no exceptions
{
  key: "stage3.question-coverage-complete",
  label: "Every question is answered by at least one approved binding",
  satisfied: uncovered.length === 0,
  detail: `${covered}/${total} questions covered. Uncovered: ${names}`,
  fix: { label: "Open coverage matrix", href: `/agents/${id}/stages/3#matrix` },
  blocking: true,
}
```

### Transition engine — the single path

`src/lib/gates/index.ts` exports exactly two mutating functions:

```ts
requestTransition({ agentId, stageKey, actorUserId }): Promise<TransitionResult>
recordDecision({ gateId, actorUserId, roleKey, decision, comment, attestationStatement })
```

- `requestTransition` loads the `StageContext`, evaluates exit criteria, refuses with
  the `CriterionResult[]` if anything blocking fails, computes `snapshotHash` over the
  stage's artifact versions, and opens a `Gate` — never approves.
- `recordDecision` is the **only** writer of `Approval` and the only code that may set
  `Gate.status = "APPROVED"` or advance `Agent.currentStageId`.
- Enforcement inside it: server session → membership in org → role held → role listed
  in `requiredApproverRoles` or `vetoRoles` → `snapshotHash` still current (else the
  gate is stale and the decision is refused) → `organization.isReadOnly === false`.
- Solo mode: if author and approver are the same user, requires
  `soloAttestation.allowed`, a statement over `minStatementLength`, sets
  `isSelfAttestation`, and the resulting certification badge reads **self-attested**.
- Everything runs in one transaction with the `AuditEvent` write.

**Test that guards the invariant:** static analysis over `src/` asserting that
`prisma.approval.create`, `gate.update({status:"APPROVED"})`, and
`agent.update({certification:"PEER_CERTIFIED"})` appear in no file other than
`src/lib/gates/recordDecision.ts` — the "no path to APPROVED" assertion from `PROMPT.md`.

### Cascade invalidation — both directions

`src/lib/gates/cascade.ts`, both paths ending in `STALE` + a `Task` + an `AuditEvent`:

1. **Artifact re-version → downstream gates.** `commit.ts` bumps a version; any
   `Gate` whose `snapshotHash` no longer matches the recomputed snapshot for its stage
   flips to `STALE`, its `StageRun` flips to `STALE`, and a `RE_APPROVAL` task is
   raised for each `requiredApproverRoles` entry.
2. **DataProduct major bump → certifications.** A new `DataProductVersion` with
   `contractMajor > BindingVersion.boundContractMajor` flips every dependent
   `Binding` to `STALE`, cascades to the agent's `certification = "STALE"` with a
   `staleReason` naming the product and both versions, raises `RE_CERTIFICATION`
   tasks, and emits `stale_triggered`. This is the demo's money moment, so it runs
   synchronously in the same transaction as the version bump — the banner is there on
   the next render, not after a job queue.

---

## 3 · `src/lib/bindings/validate.ts`

**Rejection-first.** The validator's job is to say no in a sentence a business person can
act on. Every finding carries a plain-language message *and* a suggested fix; no finding
may render a code path, a schema pointer, or an exception.

```ts
export type ValidationCode =
  | "QUERIES_REQUIRES_METRIC"       // B001
  | "PHYSICAL_TABLE_REFERENCE"      // B002 — the guardrail
  | "QUESTION_NOT_COVERED"          // B003 — orphan question
  | "METRIC_NOT_ON_BOUND_PRODUCT"   // B004
  | "METRIC_NOT_CERTIFIED"          // B005
  | "CONTRACT_PIN_STALE"            // B006
  | "ACTS_VIA_REQUIRES_TOOL_SPEC"   // B007
  | "FREEFORM_SQL_FIELD"            // B008 — text-to-SQL surface
  | "SENSITIVITY_ESCALATION"        // B009 — warning

export type ValidationFinding = {
  code: ValidationCode
  severity: "ERROR" | "WARNING"
  /// Plain language. "This binding queries Customer 360 but doesn't name a
  /// certified metric, so we can't show which number answers each question."
  message: string
  /// Always actionable. "Pick one of the 4 certified metrics on Customer 360,
  /// or change the binding type to GROUNDS_ON if it's context, not numbers."
  suggestedFix: string
  subject: { kind: "binding" | "question" | "grounding-pack" | "tool-spec"; id: string; field?: string }
}

export type CoverageMatrix = {
  questions: { id: string; text: string; personaName: string; intentClass: string }[]
  bindings:  { id: string; productName: string; type: BindingType }[]
  /// cells[questionId][bindingId] → metric names, or absent
  cells: Record<string, Record<string, { metricKeys: string[] }>>
  coveredCount: number
  totalCount: number
  /// The Stage 3 exit gate reads exactly this.
  isComplete: boolean
  uncoveredQuestionIds: string[]
}

export type ValidationReport = {
  ok: boolean                       // no ERROR findings
  findings: ValidationFinding[]
  coverage?: CoverageMatrix
  checkedAt: string
}

// Entry points
export function validateBindingVersion(draft: BindingDraft, ctx: BindingContext): ValidationReport
export function validateGroundingPack(pack: GroundingPack, ctx: BindingContext): ValidationReport
export function validateToolSpecs(specs: ToolSpec[], ctx: BindingContext): ValidationReport
export function computeCoverageMatrix(ctx: BindingContext): CoverageMatrix
```

### The no-physical-table guardrail

Pack-configurable, because "what counts as a raw table" is industry and platform dialect:

```ts
export type PhysicalReferenceRules = {
  deniedLayers: string[]            // ["RAW","BRONZE","SILVER","STAGING"]
  /// Identifier patterns treated as physical references.
  deniedIdentifierPatterns: string[]  // ["^bronze[._]", "^slv_", "_raw$", "^stg_", "^dbo\\."]
  /// Fields that must never contain free-form query text.
  forbiddenFreeformFields: string[]   // ["sql","query","statement","rawQuery"]
  /// A reference is allowed only if it resolves here.
  allowedReferenceKinds: ("certified_metric" | "semantic_entity" | "semantic_dimension")[]
}
```

Loaded from the industry pack, defaulted in `_generic`. Three layers of check:

1. **Structural** — the bound `DataProduct.layer` must not be in `deniedLayers`.
2. **Lexical** — every string field in a grounding pack or tool spec is scanned for
   `FROM|JOIN <identifier>` and for bare identifiers matching
   `deniedIdentifierPatterns`; presence of any `forbiddenFreeformFields` key is an
   error on its own (B008), because a free-form SQL field is the text-to-SQL surface
   regardless of what is currently in it.
3. **Positive resolution** — every reference must resolve to a `CertifiedMetric.key`
   or a named entity in the bound product's semantic model. Unresolvable references
   fail closed. This is the rule that actually enforces "semantic layer only";
   1 and 2 catch the obvious cases loudly for the demo.

Rejection message, for reference:

> **This grounding pack reads from a Silver table.** `slv_meter_reads` is a physical
> table in the Silver layer, not a certified metric. Agents may only answer through
> the semantic layer, so this binding can't be approved.
> **Fix:** use the certified metric `high_bill_risk` on Customer 360, which is built
> from that table and already has an owner and a contract. — *Rule: semantic layer
> only (`_generic` pack, B002)*

Tests are written rejection-first: one valid pack passes; a Silver-table reference
fails with B002; an orphan question fails with B003; a `QUERIES` binding with no
metric fails with B001; a tool spec with a `sql` field fails with B008 even when empty.

---

## 4 · Token → Tailwind wiring

**One file holds every hex in the product.** `src/styles/tokens.css`.

### 4.1 `src/styles/tokens.css`

Values are stored as **space-separated RGB channels**, not hex strings, so Tailwind's
alpha modifiers (`bg-panel/60`, `ring-brand-accent/40`) work. The hex from `CLAUDE.md`
is kept in a comment on every line so the table stays readable and auditable.

```css
:root {
  /* Brand — Capgemini light theme */
  --brand-primary: 0 112 173;      /* #0070AD  buttons, header band, active nav, links */
  --brand-accent:  18 171 219;     /* #12ABDB  progress, highlights, selected, focus ring */
  --brand-ink:     0 55 95;        /* #00375F  headings and body on light surfaces */
  --brand-deep:    0 90 135;       /* #005A87  primary hover/pressed, chart depth */

  /* Surfaces */
  --surface: 255 255 255;          /* #FFFFFF  page background */
  --panel:   234 243 251;          /* #EAF3FB  cards, hero panels, onboarding */
  --band:    220 234 246;          /* #DCEAF6  synthesis strips, table headers, info banners */

  /* Semantic states — outside the brand palette, WCAG AA on white */
  --success:        30 123 52;     /* #1E7B34 */
  --warning:        180 83 9;      /* #B45309  also STALE */
  --warning-tint:  254 243 199;    /* #FEF3C7  STALE background */
  --danger:        185 28 28;      /* #B91C1C  veto */
  --ai-draft:      109 40 217;     /* #6D28D9  with dashed border treatment */

  /* Typography — Inter variable, injected by next/font */
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --text-page-title:    1.75rem;  --leading-page-title:    2.25rem;  /* 28/36 semibold */
  --text-section-title: 1.125rem; --leading-section-title: 1.75rem;  /* 18/28 semibold */
  --text-body:          0.875rem; --leading-body:          1.375rem; /* 14/22 */

  /* Density — the compact table toggle flips this on a container */
  --row-py: 0.75rem;
}
[data-density="compact"] { --row-py: 0.375rem; }
```

White-label (ENTERPRISE): `Organization.themeOverride` is a validated
`Record<TokenName, RgbTriplet>` rendered as a scoped `<style>` block in the app shell.
It can only override names that already exist in `tokens.css` — a buyer rebrands by
editing one file; a tenant rebrands by overriding the same names. No new surface.

### 4.2 `tailwind.config.ts`

```ts
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  theme: {
    extend: {
      colors: {
        brand: {
          primary: token("brand-primary"),
          accent:  token("brand-accent"),
          ink:     token("brand-ink"),
          deep:    token("brand-deep"),
        },
        surface: token("surface"),
        panel:   token("panel"),
        band:    token("band"),
        success: token("success"),
        warning: { DEFAULT: token("warning"), tint: token("warning-tint") },
        danger:  token("danger"),
        "ai-draft": token("ai-draft"),
      },
      fontFamily: { sans: "var(--font-sans)" },
      fontSize: {
        "page-title":    ["var(--text-page-title)",    { lineHeight: "var(--leading-page-title)",    fontWeight: "600" }],
        "section-title": ["var(--text-section-title)", { lineHeight: "var(--leading-section-title)", fontWeight: "600" }],
        body:            ["var(--text-body)",          { lineHeight: "var(--leading-body)" }],
      },
      ringColor: { DEFAULT: token("brand-accent") },
    },
  },
}
```

shadcn/ui is installed with its own variables **re-pointed at these tokens** rather than
its default palette, so `Button`, `Badge`, `Dialog` inherit the brand with no per-component
overrides. `--primary → var(--brand-primary)`, `--background → var(--surface)`,
`--card → var(--panel)`, `--ring → var(--brand-accent)`, `--destructive → var(--danger)`.

### 4.3 Enforcing "never hard-code a hex"

An ESLint rule — `no-restricted-syntax` matching string literals against
`/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/` and raw `rgb(`/`hsl(` calls —
scoped to `src/app/**`, `src/components/**`, and `tailwind.config.ts`, with
`src/styles/**` exempted. The rule fails CI. Without it, "never hard-code a hex" is a
wish; with it, it is a build error.

State treatments, defined once as component variants so they are consistent everywhere:
**STALE** → `bg-warning-tint text-warning` + left border + cause sentence + re-approval
link. **AI_DRAFT** → dashed `border-ai-draft` + a marker chip. **Veto** → `text-danger`
with the vetoing role named.

---

## 5 · Conflicts and judgement calls — decisions needed

`CLAUDE.md` requires flagging rather than silently resolving. Nine items; **5.1–5.4 change
the schema and I'd like an explicit yes**, the rest are stated defaults I'll proceed with
unless you object.

**5.1 · SQLite forbids Prisma enums.** `CLAUDE.md` specifies SQLite as the default
datasource. Prisma does not support native `enum` on SQLite, and `PROMPT.md` lists
`PlanTier` and `Role` among the models. **Proposal:** every enum becomes a `String`
column whose domain is owned by a Zod schema in `src/lib/enums.ts` — one source of
truth, portable to Postgres unchanged. `Role` becomes a real table (gates reference
approver roles by foreign key, and Phase 4 credential-gating needs the row);
`PlanTier` stays a string column, since the feature flags already live in
`src/lib/plans/features.ts` and a lookup table would be a second home for the same
facts. **Alternative if you prefer native enums: make Postgres the default and drop
SQLite.** Your call.

**5.2 · Prisma middleware is deprecated.** `PROMPT.md` step 2 says "a single Prisma
middleware". `$use` is deprecated as of Prisma 5 and slated for removal; client
extensions are the supported successor. **Proposal:** implement the same single
choke-point as one `$extends` query extension (§1.3). Same guarantee, same test
surface, one file — just not the deprecated API. Flagging because it is a literal
deviation from the written instruction.

**5.3 · Four models added beyond the listed set.** `PROMPT.md` step 2 enumerates the
schema; I need four more to make the stated behaviour possible:
`QuestionCoverage` (the coverage matrix is a many-to-many between questions and
bindings with a metric per cell — Stage 3's 100% rule has nowhere to live without it),
`DataProductVersion` (cascade needs version history to detect a major bump),
`BindingMetric` (a `QUERIES` binding names ≥1 metric), and `AgentPersona` (personas
are reusable across agents, which is what the marketplace persona lens ranks over).
Plus `Invitation` for the org invite flow in step 7. Confirm these are welcome.

**5.4 · `Stage` as both a table and a registry.** `PROMPT.md` lists `Stage` as a Prisma
model *and* specifies `stages.ts` as the 8-stage registry. **Proposal:** `stages.ts` is
the source of truth for all behaviour; the `Stage` table is a seeded lookup so
`StageRun`/`Gate`/`Artifact` carry real foreign keys, with a test asserting the table
matches the registry. Flagging the duplication rather than quietly picking one.

**5.5 · Binding type lives on the version, not the binding.** `PROMPT.md` says to build
the Binding "as an entity with its own lifecycle, never as a join table with a type
column" — so I put `type` on `BindingVersion` and made `(agentId, dataProductId)`
unique on `Binding`. Consequence: changing a binding's type is a re-version that
re-opens the gate, which I believe is the intent. It also means an agent cannot hold
two *different* binding types to the same product simultaneously (e.g. both `QUERIES`
and `ACTS_VIA` on Customer 360). If that combination is real, I'd make the unique key
`(agentId, dataProductId, type)` instead. **Which do you want?**

**5.6 · Stages 5–8 in Phase 1.** The registry ships all eight stage *definitions* in
Phase 1 (names, purposes, required artifacts, approver roles) because `Stage` seeding
and the lifecycle nav need them. Their `exitCriteria` return `[]` until their UI lands
in Phase 3 — no speculative criteria. Stages 1–4 get real criteria now.

**5.7 · Solo attestation and plan tiers.** `CLAUDE.md` says flags gate features, never
governance. Solo attestation is therefore *always available* structurally and always
*labelled* in the audit trail and badge; `allowedForPlans` exists so a TEAM/ENTERPRISE
org can require peer review as policy — a restriction, never a governance bypass. Free
tier's 3-agent cap is a feature flag; nothing in the gate engine reads the plan tier
to decide whether an approval is valid.

**5.8 · Audit hash chain.** `PROMPT.md` requires append-only; I've added `sequence` +
`prevHash` + `hash` per organisation so the evidence pack can ship a verifiable
manifest. Slightly beyond the letter of the spec, cheap to build, and it is what makes
"append-only" demonstrable to an auditor rather than merely asserted.

**5.9 · Seed data reading.** `PROMPT.md` step 7 names `residential_churn_rate v2.1` and
`high_bill_risk` as certified metrics on Customer 360, with a starter agent at stage 3.
I read "v2.1" as the metric's own version and will model Customer 360's *contract* at
`2.1.0` so the Phase 3 demo can bump it to `3.0.0` and fire the cascade. Say if you
meant something else.

---

## 6 · What Phase 1 delivers once signed off

Files, in build order:

1. `package.json`, `tsconfig.json` (strict), `tailwind.config.ts`, `next.config.ts`,
   `vitest.config.ts`, `playwright.config.ts`, `docker-compose.yml`, `.env.example`
2. `src/styles/tokens.css` · `src/app/layout.tsx` · app shell (top nav, org switcher, stage rail)
3. `prisma/schema.prisma` + initial migration
4. `src/lib/enums.ts` · `src/lib/db/tenancy.ts` · `src/lib/audit/append.ts`
5. `src/lib/lifecycle/stages.ts`
6. `src/lib/gates/{requestTransition,recordDecision,cascade}.ts`
7. `src/lib/bindings/{validate,rules,coverage}.ts`
8. `src/lib/artifacts/commit.ts`
9. `src/lib/analytics/{index,console,noop}.ts` · `src/lib/plans/features.ts`
10. Auth.js credentials + invite flow · `prisma/seed.ts` (showcase tenant)
11. Tests: tenant isolation · exit criteria · role enforcement · both cascade paths ·
    audit immutability · validator rejections · solo-attestation labelling ·
    "no path to APPROVED except `recordDecision()`"

Acceptance, from `PROMPT.md`: create an org → land in a seeded workspace → declare a
binding → watch the validator reject a bad one with a helpful message → pass a gate solo
with attestation → see the audit trail, all in the branded shell.

Verification before I call Phase 1 done: `pnpm typecheck && pnpm lint && pnpm test &&
pnpm build`, with anything unverified stated explicitly.
