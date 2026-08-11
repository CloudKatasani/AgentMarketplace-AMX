-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "lastUsedAt" DATETIME,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_organizationId_idx" ON "ApiToken"("organizationId");
