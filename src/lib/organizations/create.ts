/**
 * Creating an organisation.
 *
 * Runs in system context because there is no organisation to scope to until
 * this function has made one — then immediately drops into that organisation's
 * scope for everything else. That is the whole legitimate use of `runAsSystem`
 * outside seeding.
 */
import { track } from "@/lib/analytics";
import { appendAuditEvent } from "@/lib/audit/append";
import { db } from "@/lib/db";
import { runAsOrg, runAsSystem } from "@/lib/db/tenancy";
import type { PlanTier } from "@/lib/enums";
import { ROLES, type RoleKey } from "@/lib/roles";
import { seedStarterWorkspace } from "@/lib/seed/starter-workspace";

export type CreateOrganizationInput = {
  name: string;
  slug: string;
  ownerUserId: string;
  ownerName: string;
  planTier?: PlanTier;
  industryId?: string | null;
  workspaceName?: string;
  isShowcase?: boolean;
  isReadOnly?: boolean;
  /** Roles the creating user holds. Defaults to every approver role — see below. */
  ownerRoles?: RoleKey[];
  seedStarter?: boolean;
};

export type CreateOrganizationResult = {
  organizationId: string;
  workspaceId: string;
  starterAgentId: string | null;
};

/**
 * A solo founder holds every approver role by default.
 *
 * This is not a governance shortcut: holding a role lets you *cast* a decision,
 * and a decision cast by the author of the work is recorded as a
 * self-attestation and shows as "self-attested" on the badge. Single-player
 * value before multi-player, without pretending a peer reviewed anything.
 */
const DEFAULT_OWNER_ROLES = ROLES.filter((role) => role.isApprover || role.id === "org-admin").map(
  (role) => role.id,
);

export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResult> {
  const organization = await runAsSystem(async () => {
    const created = await db.organization.create({
      data: {
        name: input.name,
        slug: input.slug,
        planTier: input.planTier ?? "FREE",
        industryId: input.industryId ?? null,
        isShowcase: input.isShowcase ?? false,
        isReadOnly: input.isReadOnly ?? false,
      },
      select: { id: true },
    });
    return created;
  });

  return runAsOrg(organization.id, async () => {
    const workspace = await db.workspace.create({
      data: {
        organizationId: organization.id,
        slug: "default",
        name: input.workspaceName ?? `${input.name} workspace`,
      },
      select: { id: true },
    });

    const membership = await db.membership.create({
      data: { organizationId: organization.id, userId: input.ownerUserId },
      select: { id: true },
    });

    for (const roleId of input.ownerRoles ?? DEFAULT_OWNER_ROLES) {
      await db.membershipRole.create({
        data: { organizationId: organization.id, membershipId: membership.id, roleId },
      });
    }

    await appendAuditEvent(db, {
      organizationId: organization.id,
      type: "organization.created",
      subjectType: "Organization",
      subjectId: organization.id,
      actorUserId: input.ownerUserId,
      payload: { name: input.name, planTier: input.planTier ?? "FREE" },
    });

    let starterAgentId: string | null = null;
    if (input.seedStarter !== false) {
      // The industry IS the pack key: picking Utilities seeds utility
      // personas, questions, products, and a starter agent in that vocabulary.
      const starter = await seedStarterWorkspace(db, {
        organizationId: organization.id,
        workspaceId: workspace.id,
        ownerUserId: input.ownerUserId,
        ownerName: input.ownerName,
        packKey: input.industryId ?? "_generic",
      });
      starterAgentId = starter?.agentId ?? null;
    }

    await track({
      name: "org_created",
      organizationId: organization.id,
      userId: input.ownerUserId,
      properties: { planTier: input.planTier ?? "FREE", seeded: input.seedStarter !== false },
    });

    return { organizationId: organization.id, workspaceId: workspace.id, starterAgentId };
  });
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "workspace"
  );
}
