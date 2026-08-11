-- CreateTable
CREATE TABLE "LearningEnrolment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pathKey" TEXT NOT NULL,
    "packKey" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ModuleCompletion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pathKey" TEXT NOT NULL,
    "courseKey" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "outOf" INTEGER NOT NULL DEFAULT 0,
    "completedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialKey" TEXT NOT NULL,
    "pathKey" TEXT NOT NULL,
    "awardedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditEventId" TEXT
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "planTier" TEXT NOT NULL DEFAULT 'FREE',
    "industryId" TEXT,
    "themeOverride" TEXT,
    "isShowcase" BOOLEAN NOT NULL DEFAULT false,
    "isReadOnly" BOOLEAN NOT NULL DEFAULT false,
    "requireApproverCredentials" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME,
    CONSTRAINT "Organization_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Organization" ("archivedAt", "createdAt", "id", "industryId", "isReadOnly", "isShowcase", "name", "planTier", "slug", "themeOverride") SELECT "archivedAt", "createdAt", "id", "industryId", "isReadOnly", "isShowcase", "name", "planTier", "slug", "themeOverride" FROM "Organization";
DROP TABLE "Organization";
ALTER TABLE "new_Organization" RENAME TO "Organization";
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE INDEX "Organization_isShowcase_idx" ON "Organization"("isShowcase");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "LearningEnrolment_organizationId_pathKey_idx" ON "LearningEnrolment"("organizationId", "pathKey");

-- CreateIndex
CREATE UNIQUE INDEX "LearningEnrolment_organizationId_userId_pathKey_key" ON "LearningEnrolment"("organizationId", "userId", "pathKey");

-- CreateIndex
CREATE INDEX "ModuleCompletion_organizationId_userId_idx" ON "ModuleCompletion"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleCompletion_organizationId_userId_pathKey_courseKey_moduleKey_key" ON "ModuleCompletion"("organizationId", "userId", "pathKey", "courseKey", "moduleKey");

-- CreateIndex
CREATE INDEX "Credential_organizationId_credentialKey_idx" ON "Credential"("organizationId", "credentialKey");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_organizationId_userId_credentialKey_key" ON "Credential"("organizationId", "userId", "credentialKey");
