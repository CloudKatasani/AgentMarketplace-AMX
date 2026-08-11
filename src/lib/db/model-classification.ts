/**
 * Every Prisma model is classified here. Nothing else decides tenancy.
 *
 * A model that appears in neither list is a hole in tenant isolation, so
 * `tenancy.test.ts` enumerates the datamodel and fails when one is unclassified.
 * Adding a model without deciding its tenancy is a build break, not a leak.
 * See docs/phase-1-design.md §1.1.
 */

/** Not tenant-scoped: reference data, or the identity of a person across orgs. */
export const GLOBAL_MODELS = new Set([
  "User",
  "Account",
  "Session",
  "VerificationToken",
  "Role",
  "Stage",
  "Industry",
  "Domain",
]);

/** The tenant root. Filtered on `id`, not on `organizationId`. */
export const TENANT_ROOT_MODEL = "Organization";

/**
 * Immutable once written. The extension rejects update/delete/upsert on these
 * so "append-only" is a property of the client, not a convention in handlers.
 */
export const APPEND_ONLY_MODELS = new Set([
  "ArtifactVersion",
  "BindingVersion",
  "Approval",
  "AuditEvent",
]);

/** Carries `organizationId`; every query is filtered, every write is stamped. */
export const TENANT_SCOPED_MODELS = new Set([
  "Workspace",
  "Membership",
  "MembershipRole",
  "Invitation",
  "Agent",
  "StageRun",
  "Artifact",
  "ArtifactVersion",
  "Gate",
  "Approval",
  "Comment",
  "Task",
  "AuditEvent",
  "ChangeRequest",
  "DataProduct",
  "DataProductVersion",
  "CertifiedMetric",
  "Binding",
  "BindingVersion",
  "BindingMetric",
  "Persona",
  "AgentPersona",
  "Question",
  "QuestionCoverage",
  "Invocation",
  "Feedback",
  "AnalyticsEvent",
]);

export function isGlobalModel(model: string | undefined): boolean {
  return model === undefined || GLOBAL_MODELS.has(model);
}

export function isTenantScoped(model: string | undefined): boolean {
  return model !== undefined && TENANT_SCOPED_MODELS.has(model);
}

export function isAppendOnly(model: string | undefined): boolean {
  return model !== undefined && APPEND_ONLY_MODELS.has(model);
}

export function isClassified(model: string): boolean {
  return (
    GLOBAL_MODELS.has(model) ||
    TENANT_SCOPED_MODELS.has(model) ||
    model === TENANT_ROOT_MODEL
  );
}
