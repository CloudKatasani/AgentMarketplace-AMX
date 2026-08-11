-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "emailVerified" DATETIME,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isApprover" BOOLEAN NOT NULL DEFAULT false,
    "isVeto" BOOLEAN NOT NULL DEFAULT false,
    "requiresCredentialKey" TEXT,
    "ordinal" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Stage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ordinal" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Industry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "packVersion" TEXT NOT NULL,
    "summary" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "industryId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "Domain_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "planTier" TEXT NOT NULL DEFAULT 'FREE',
    "industryId" TEXT,
    "themeOverride" TEXT,
    "isShowcase" BOOLEAN NOT NULL DEFAULT false,
    "isReadOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME,
    CONSTRAINT "Organization_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME,
    CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MembershipRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MembershipRole_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MembershipRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME,
    CONSTRAINT "Workspace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "archetype" TEXT,
    "riskTier" TEXT,
    "domainId" TEXT,
    "ownerUserId" TEXT,
    "sensitivity" TEXT,
    "currentStageId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "certification" TEXT NOT NULL DEFAULT 'NONE',
    "staleReason" TEXT,
    "staleAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME,
    CONSTRAINT "Agent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Agent_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StageRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" DATETIME,
    "submittedAt" DATETIME,
    "approvedAt" DATETIME,
    "stalledAt" DATETIME,
    "staleReason" TEXT,
    CONSTRAINT "StageRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StageRun_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME,
    CONSTRAINT "Artifact_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artifact_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ArtifactVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArtifactVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "mirrorPath" TEXT NOT NULL,
    "authorUserId" TEXT,
    "isAiDraft" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArtifactVersion_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Gate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "stageRunId" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "mode" TEXT NOT NULL DEFAULT 'PEER',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "quorum" INTEGER NOT NULL DEFAULT 1,
    "snapshotHash" TEXT NOT NULL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "stalledAt" DATETIME,
    "staleReason" TEXT,
    CONSTRAINT "Gate_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Gate_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Gate_stageRunId_fkey" FOREIGN KEY ("stageRunId") REFERENCES "StageRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "isSelfAttestation" BOOLEAN NOT NULL DEFAULT false,
    "attestationStatement" TEXT,
    "snapshotHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Approval_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "Gate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Approval_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "artifactVersionId" TEXT,
    "fieldPath" TEXT,
    "body" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "isParkingLot" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Comment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Comment_artifactVersionId_fkey" FOREIGN KEY ("artifactVersionId") REFERENCES "ArtifactVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assigneeRoleId" TEXT,
    "assigneeUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "causeEventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Task_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneeRoleId_fkey" FOREIGN KEY ("assigneeRoleId") REFERENCES "Role" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "actorKind" TEXT NOT NULL DEFAULT 'USER',
    "actorUserId" TEXT,
    "type" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ChangeRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "requestedByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "ChangeRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DataProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "domainId" TEXT,
    "ownerName" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "contractVersion" TEXT NOT NULL,
    "contractMajor" INTEGER NOT NULL,
    "contractMinor" INTEGER NOT NULL,
    "contractPatch" INTEGER NOT NULL,
    "semanticModelVersion" TEXT NOT NULL,
    "layer" TEXT NOT NULL DEFAULT 'GOLD',
    "qualityScore" INTEGER NOT NULL,
    "lastRefreshedAt" DATETIME,
    "freshnessSlaHours" INTEGER,
    "sensitivity" TEXT NOT NULL DEFAULT 'INTERNAL',
    "importedFrom" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME,
    CONSTRAINT "DataProduct_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DataProduct_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DataProductVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "dataProductId" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "contractMajor" INTEGER NOT NULL,
    "contractMinor" INTEGER NOT NULL,
    "contractPatch" INTEGER NOT NULL,
    "semanticModelVersion" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataProductVersion_dataProductId_fkey" FOREIGN KEY ("dataProductId") REFERENCES "DataProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CertifiedMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "dataProductId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "grain" TEXT NOT NULL,
    "unit" TEXT,
    "semanticRef" TEXT NOT NULL,
    "certifiedAt" DATETIME,
    "certifiedBy" TEXT,
    "archivedAt" DATETIME,
    CONSTRAINT "CertifiedMetric_dataProductId_fkey" FOREIGN KEY ("dataProductId") REFERENCES "DataProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Binding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "dataProductId" TEXT NOT NULL,
    "bindingType" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "staleReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME,
    CONSTRAINT "Binding_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Binding_dataProductId_fkey" FOREIGN KEY ("dataProductId") REFERENCES "DataProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Binding_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "BindingVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BindingVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "boundContractVersion" TEXT NOT NULL,
    "boundContractMajor" INTEGER NOT NULL,
    "boundSemanticModelVersion" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "validationReport" TEXT NOT NULL,
    "authorUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BindingVersion_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "Binding" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BindingMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "bindingVersionId" TEXT NOT NULL,
    "certifiedMetricId" TEXT NOT NULL,
    CONSTRAINT "BindingMetric_bindingVersionId_fkey" FOREIGN KEY ("bindingVersionId") REFERENCES "BindingVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BindingMetric_certifiedMetricId_fkey" FOREIGN KEY ("certifiedMetricId") REFERENCES "CertifiedMetric" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BUSINESS',
    "ownedDecisions" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "currentWorkaround" TEXT NOT NULL,
    "packSourceKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME,
    CONSTRAINT "Persona_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentPersona" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "AgentPersona_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentPersona_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "intentClass" TEXT NOT NULL,
    "consequenceOfNoAnswer" TEXT NOT NULL,
    "expectedAnswerShape" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "packSourceKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME,
    CONSTRAINT "Question_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Question_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionCoverage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "certifiedMetricId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionCoverage_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuestionCoverage_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "Binding" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuestionCoverage_certifiedMetricId_fkey" FOREIGN KEY ("certifiedMetricId") REFERENCES "CertifiedMetric" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "distinctId" TEXT NOT NULL,
    "properties" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Stage_ordinal_key" ON "Stage"("ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_industryId_key_key" ON "Domain"("industryId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_isShowcase_idx" ON "Organization"("isShowcase");

-- CreateIndex
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "MembershipRole_organizationId_idx" ON "MembershipRole"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipRole_membershipId_roleId_key" ON "MembershipRole"("membershipId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_email_idx" ON "Invitation"("organizationId", "email");

-- CreateIndex
CREATE INDEX "Workspace_organizationId_idx" ON "Workspace"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_organizationId_slug_key" ON "Workspace"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "Agent_organizationId_status_idx" ON "Agent"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Agent_organizationId_certification_idx" ON "Agent"("organizationId", "certification");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_organizationId_workspaceId_slug_key" ON "Agent"("organizationId", "workspaceId", "slug");

-- CreateIndex
CREATE INDEX "StageRun_organizationId_idx" ON "StageRun"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StageRun_agentId_stageId_key" ON "StageRun"("agentId", "stageId");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_currentVersionId_key" ON "Artifact"("currentVersionId");

-- CreateIndex
CREATE INDEX "Artifact_organizationId_idx" ON "Artifact"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_agentId_kind_key" ON "Artifact"("agentId", "kind");

-- CreateIndex
CREATE INDEX "ArtifactVersion_organizationId_idx" ON "ArtifactVersion"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactVersion_artifactId_versionNumber_key" ON "ArtifactVersion"("artifactId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactVersion_artifactId_contentHash_key" ON "ArtifactVersion"("artifactId", "contentHash");

-- CreateIndex
CREATE INDEX "Gate_organizationId_status_idx" ON "Gate"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Gate_agentId_stageId_round_key" ON "Gate"("agentId", "stageId", "round");

-- CreateIndex
CREATE INDEX "Approval_organizationId_idx" ON "Approval"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_gateId_userId_roleId_key" ON "Approval"("gateId", "userId", "roleId");

-- CreateIndex
CREATE INDEX "Comment_organizationId_agentId_idx" ON "Comment"("organizationId", "agentId");

-- CreateIndex
CREATE INDEX "Task_organizationId_status_idx" ON "Task"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_subjectType_subjectId_idx" ON "AuditEvent"("organizationId", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_organizationId_sequence_key" ON "AuditEvent"("organizationId", "sequence");

-- CreateIndex
CREATE INDEX "ChangeRequest_organizationId_status_idx" ON "ChangeRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DataProduct_organizationId_idx" ON "DataProduct"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DataProduct_organizationId_workspaceId_key_key" ON "DataProduct"("organizationId", "workspaceId", "key");

-- CreateIndex
CREATE INDEX "DataProductVersion_organizationId_idx" ON "DataProductVersion"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DataProductVersion_dataProductId_contractVersion_key" ON "DataProductVersion"("dataProductId", "contractVersion");

-- CreateIndex
CREATE INDEX "CertifiedMetric_organizationId_idx" ON "CertifiedMetric"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CertifiedMetric_dataProductId_key_key" ON "CertifiedMetric"("dataProductId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Binding_currentVersionId_key" ON "Binding"("currentVersionId");

-- CreateIndex
CREATE INDEX "Binding_organizationId_status_idx" ON "Binding"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Binding_agentId_dataProductId_bindingType_key" ON "Binding"("agentId", "dataProductId", "bindingType");

-- CreateIndex
CREATE INDEX "BindingVersion_organizationId_idx" ON "BindingVersion"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BindingVersion_bindingId_versionNumber_key" ON "BindingVersion"("bindingId", "versionNumber");

-- CreateIndex
CREATE INDEX "BindingMetric_organizationId_idx" ON "BindingMetric"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BindingMetric_bindingVersionId_certifiedMetricId_key" ON "BindingMetric"("bindingVersionId", "certifiedMetricId");

-- CreateIndex
CREATE INDEX "Persona_organizationId_idx" ON "Persona"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Persona_organizationId_workspaceId_key_key" ON "Persona"("organizationId", "workspaceId", "key");

-- CreateIndex
CREATE INDEX "AgentPersona_organizationId_idx" ON "AgentPersona"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPersona_agentId_personaId_key" ON "AgentPersona"("agentId", "personaId");

-- CreateIndex
CREATE INDEX "Question_organizationId_agentId_idx" ON "Question"("organizationId", "agentId");

-- CreateIndex
CREATE INDEX "QuestionCoverage_organizationId_idx" ON "QuestionCoverage"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionCoverage_questionId_bindingId_key" ON "QuestionCoverage"("questionId", "bindingId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_organizationId_name_idx" ON "AnalyticsEvent"("organizationId", "name");
