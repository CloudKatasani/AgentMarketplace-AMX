/**
 * Who is in the workspace, and what they may sign for.
 *
 * Roles decide who can approve what, so granting one is a governed act: only an
 * org-admin, never in a read-only tenant, always audited, and never the last
 * admin removing their own admin role — a workspace with no admin cannot invite
 * anyone or fix itself.
 *
 * This module grants *roles*. It never writes an `Approval`; whether a role
 * holder may actually decide a given gate is re-derived by the gate engine at
 * decision time, against the database, every time.
 */
import { track } from "@/lib/analytics";
import { appendAuditEvent } from "@/lib/audit/append";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import { assertMutable, requireMembership } from "@/lib/gates/authorization";
import { ROLES, roleKeySchema, type RoleKey } from "@/lib/roles";

export type Member = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleKeys: RoleKey[];
  credentialKeys: string[];
  joinedAt: Date;
};

export async function listMembers(
  db: AmxPrismaClient,
  organizationId: string,
): Promise<Member[]> {
  const memberships = await db.membership.findMany({
    where: { organizationId, archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      roles: { select: { roleId: true } },
      user: { select: { name: true, email: true } },
    },
  });

  const credentials = await db.credential.findMany({
    where: { organizationId },
    select: { userId: true, credentialKey: true },
  });

  return memberships.map((membership) => ({
    membershipId: membership.id,
    userId: membership.userId,
    name: membership.user.name ?? "",
    email: membership.user.email,
    roleKeys: membership.roles.map((role) => role.roleId as RoleKey),
    credentialKeys: credentials
      .filter((credential) => credential.userId === membership.userId)
      .map((credential) => credential.credentialKey),
    joinedAt: membership.createdAt,
  }));
}

export async function setMemberRole(
  db: AmxPrismaClient,
  input: {
    organizationId: string;
    actorUserId: string;
    membershipId: string;
    roleKey: string;
    granted: boolean;
  },
): Promise<{ ok: boolean; detail: string }> {
  const mutable = await assertMutable(db, input.organizationId);
  if (!mutable.ok) return { ok: false, detail: mutable.detail };

  const actor = await requireMembership(db, input.organizationId, input.actorUserId);
  if (!actor.ok) return { ok: false, detail: actor.detail };
  if (!actor.roleKeys.includes("org-admin")) {
    return { ok: false, detail: "Only an Organisation Admin can change who holds a role." };
  }

  const role = roleKeySchema.safeParse(input.roleKey);
  if (!role.success) return { ok: false, detail: "That is not a role this product knows about." };

  const target = await db.membership.findUnique({
    where: { id: input.membershipId },
    select: {
      id: true,
      archivedAt: true,
      user: { select: { name: true, email: true } },
      roles: { select: { roleId: true } },
    },
  });
  if (!target || target.archivedAt) {
    return { ok: false, detail: "That person is not a member of this workspace." };
  }

  const holds = target.roles.some((r) => r.roleId === role.data);
  if (holds === input.granted) {
    return { ok: true, detail: "No change — they already have it that way." };
  }

  // A workspace that loses its last admin cannot invite, cannot fix its roles,
  // and cannot even undo this. Refuse before it happens, not after.
  if (!input.granted && role.data === "org-admin") {
    const admins = await db.membershipRole.count({
      where: { organizationId: input.organizationId, roleId: "org-admin" },
    });
    if (admins <= 1) {
      return {
        ok: false,
        detail:
          "This is the only Organisation Admin. Give someone else the role first — a workspace without an admin cannot manage itself.",
      };
    }
  }

  await db.$transaction(async (tx) => {
    if (input.granted) {
      await tx.membershipRole.create({
        data: {
          organizationId: input.organizationId,
          membershipId: target.id,
          roleId: role.data,
        },
      });
    } else {
      await tx.membershipRole.deleteMany({
        where: { membershipId: target.id, roleId: role.data },
      });
    }

    await appendAuditEvent(tx as AmxPrismaClient, {
      organizationId: input.organizationId,
      type: input.granted ? "member.role-granted" : "member.role-revoked",
      subjectType: "Membership",
      subjectId: target.id,
      actorUserId: input.actorUserId,
      payload: { roleId: role.data, subjectEmail: target.user.email },
    });
  });

  await track({
    name: "member_role_changed",
    organizationId: input.organizationId,
    userId: input.actorUserId,
    properties: { roleId: role.data, granted: input.granted },
  });

  const person = target.user.name || target.user.email;
  const roleLabel = ROLES.find((r) => r.id === role.data)!.name;
  return {
    ok: true,
    detail: input.granted
      ? `${person} now holds ${roleLabel}.`
      : `${person} no longer holds ${roleLabel}.`,
  };
}

/**
 * Storing a validated theme override.
 *
 * The parsing and the guarantees live in `src/lib/theme/override.ts`; this is
 * only the governed write — admin, mutable tenant, audited like any other
 * workspace setting, because "the product changed colour and nobody knows who
 * did it" is a support call.
 */
export async function setThemeOverride(
  db: AmxPrismaClient,
  input: {
    organizationId: string;
    actorUserId: string;
    /** Already validated. `null` clears the override. */
    theme: Record<string, [number, number, number]> | null;
  },
): Promise<{ ok: boolean; detail: string }> {
  const mutable = await assertMutable(db, input.organizationId);
  if (!mutable.ok) return { ok: false, detail: mutable.detail };

  const actor = await requireMembership(db, input.organizationId, input.actorUserId);
  if (!actor.ok) return { ok: false, detail: actor.detail };
  if (!actor.roleKeys.includes("org-admin")) {
    return { ok: false, detail: "Only an Organisation Admin can change the theme." };
  }

  const stored = input.theme && Object.keys(input.theme).length > 0 ? JSON.stringify(input.theme) : null;

  await db.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: input.organizationId },
      data: { themeOverride: stored },
    });
    await appendAuditEvent(tx as AmxPrismaClient, {
      organizationId: input.organizationId,
      type: "theme.changed",
      subjectType: "Organization",
      subjectId: input.organizationId,
      actorUserId: input.actorUserId,
      payload: { tokens: input.theme ? Object.keys(input.theme).sort() : [] },
    });
  });

  await track({
    name: "theme_override_saved",
    organizationId: input.organizationId,
    userId: input.actorUserId,
    properties: { tokenCount: input.theme ? Object.keys(input.theme).length : 0 },
  });

  return {
    ok: true,
    detail: stored
      ? "Theme saved. Every screen in this workspace now uses these tokens."
      : "Theme cleared. This workspace is back on the default palette.",
  };
}

/**
 * The workspace policy that turns an academy credential into a prerequisite for
 * signing. Off by default: it is a choice a governance officer makes, not a
 * default the product imposes.
 */
export async function setCredentialPolicy(
  db: AmxPrismaClient,
  input: { organizationId: string; actorUserId: string; required: boolean },
): Promise<{ ok: boolean; detail: string }> {
  const mutable = await assertMutable(db, input.organizationId);
  if (!mutable.ok) return { ok: false, detail: mutable.detail };

  const actor = await requireMembership(db, input.organizationId, input.actorUserId);
  if (!actor.ok) return { ok: false, detail: actor.detail };
  if (!actor.roleKeys.includes("org-admin")) {
    return { ok: false, detail: "Only an Organisation Admin can change workspace policy." };
  }

  await db.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: input.organizationId },
      data: { requireApproverCredentials: input.required },
    });
    await appendAuditEvent(tx as AmxPrismaClient, {
      organizationId: input.organizationId,
      type: "policy.credential-requirement-changed",
      subjectType: "Organization",
      subjectId: input.organizationId,
      actorUserId: input.actorUserId,
      payload: { requireApproverCredentials: input.required },
    });
  });

  return {
    ok: true,
    detail: input.required
      ? "Approver roles now require the matching academy credential."
      : "Approver roles no longer require a credential.",
  };
}
