/**
 * Getting the second human into the workspace.
 *
 * Peer review is the product's whole argument, and until Phase 6 there was no
 * way to add a second person to an organisation at all — every workspace was
 * permanently single-player. An invitation is the join path, and it is
 * deliberately narrow: one email, one role, one token, an expiry, and a single
 * accept that creates the membership.
 *
 * The token is the credential, so it is compared in full and never guessable.
 * Delivery is stubbed to the console, as specified — the buyer wires their own
 * transport behind `deliverInvitation`.
 */
import { randomBytes } from "node:crypto";

import { track } from "@/lib/analytics";
import { appendAuditEvent } from "@/lib/audit/append";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import { runAsSystem } from "@/lib/db/tenancy";
import { assertMutable, requireMembership } from "@/lib/gates/authorization";
import { roleKeySchema, roleName, type RoleKey } from "@/lib/roles";

/** Long enough that guessing is not a strategy, short enough to paste. */
const TOKEN_BYTES = 32;
export const INVITATION_TTL_DAYS = 14;

export type InviteResult =
  | { ok: true; invitationId: string; token: string; acceptPath: string }
  | { ok: false; detail: string };

export type AcceptResult =
  | { ok: true; organizationId: string; roleKey: RoleKey }
  | { ok: false; detail: string };

export type PendingInvitation = {
  id: string;
  email: string;
  roleId: RoleKey;
  roleName: string;
  expiresAt: Date;
  expired: boolean;
  acceptPath: string;
};

/**
 * Only an org-admin may invite, and only into a mutable organisation.
 *
 * Re-inviting an address with a pending invitation replaces it rather than
 * accumulating tokens — two live tokens for one person is a revocation bug
 * waiting to happen.
 */
export async function createInvitation(
  db: AmxPrismaClient,
  input: {
    organizationId: string;
    actorUserId: string;
    email: string;
    roleKey: string;
  },
): Promise<InviteResult> {
  const mutable = await assertMutable(db, input.organizationId);
  if (!mutable.ok) return { ok: false, detail: mutable.detail };

  const membership = await requireMembership(db, input.organizationId, input.actorUserId);
  if (!membership.ok) return { ok: false, detail: membership.detail };
  if (!membership.roleKeys.includes("org-admin")) {
    return {
      ok: false,
      detail: "Only an Organisation Admin can invite people into this workspace.",
    };
  }

  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return { ok: false, detail: "That doesn't look like an email address." };
  }

  const role = roleKeySchema.safeParse(input.roleKey);
  if (!role.success) return { ok: false, detail: "Pick a role from the list." };

  const already = await db.membership.findFirst({
    where: { organizationId: input.organizationId, user: { email }, archivedAt: null },
    select: { id: true },
  });
  if (already) {
    return { ok: false, detail: `${email} is already a member of this workspace.` };
  }

  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const invitation = await db.$transaction(async (tx) => {
    await tx.invitation.deleteMany({
      where: { organizationId: input.organizationId, email, acceptedAt: null },
    });
    const created = await tx.invitation.create({
      data: {
        organizationId: input.organizationId,
        email,
        roleId: role.data,
        token,
        expiresAt,
      },
      select: { id: true },
    });
    await appendAuditEvent(tx as AmxPrismaClient, {
      organizationId: input.organizationId,
      type: "invitation.created",
      subjectType: "Invitation",
      subjectId: created.id,
      actorUserId: input.actorUserId,
      // The token is the credential, so it never enters the audit payload.
      payload: { email, roleId: role.data, expiresAt: expiresAt.toISOString() },
    });
    return created;
  });

  const acceptPath = `/invite/${token}`;
  deliverInvitation({ email, roleKey: role.data, acceptPath });

  await track({
    name: "org_invited",
    organizationId: input.organizationId,
    userId: input.actorUserId,
    properties: { roleId: role.data },
  });

  return { ok: true, invitationId: invitation.id, token, acceptPath };
}

export async function revokeInvitation(
  db: AmxPrismaClient,
  input: { organizationId: string; actorUserId: string; invitationId: string },
): Promise<{ ok: boolean; detail: string }> {
  const mutable = await assertMutable(db, input.organizationId);
  if (!mutable.ok) return { ok: false, detail: mutable.detail };

  const membership = await requireMembership(db, input.organizationId, input.actorUserId);
  if (!membership.ok) return { ok: false, detail: membership.detail };
  if (!membership.roleKeys.includes("org-admin")) {
    return { ok: false, detail: "Only an Organisation Admin can revoke an invitation." };
  }

  const invitation = await db.invitation.findUnique({
    where: { id: input.invitationId },
    select: { id: true, email: true, acceptedAt: true },
  });
  if (!invitation) return { ok: false, detail: "That invitation no longer exists." };
  if (invitation.acceptedAt) {
    return { ok: false, detail: "That invitation has already been accepted." };
  }

  await db.$transaction(async (tx) => {
    await tx.invitation.delete({ where: { id: invitation.id } });
    await appendAuditEvent(tx as AmxPrismaClient, {
      organizationId: input.organizationId,
      type: "invitation.revoked",
      subjectType: "Invitation",
      subjectId: invitation.id,
      actorUserId: input.actorUserId,
      payload: { email: invitation.email },
    });
  });

  return { ok: true, detail: `The invitation to ${invitation.email} has been revoked.` };
}

/**
 * Which organisation a token belongs to — the one lookup that cannot be
 * tenant-scoped, because the person holding the token is by definition not yet
 * a member of anything.
 *
 * It runs system-scoped and returns nothing but the organisation id and the
 * facts the accept screen needs. Everything the acceptance then writes happens
 * inside that organisation, through `runAsOrg`.
 */
export async function resolveInvitation(
  db: AmxPrismaClient,
  token: string,
): Promise<{
  organizationId: string;
  organizationName: string;
  email: string;
  roleId: RoleKey;
  expiresAt: Date;
  acceptedAt: Date | null;
} | null> {
  const invitation = await runAsSystem(() =>
    db.invitation.findUnique({
      where: { token },
      select: {
        organizationId: true,
        email: true,
        roleId: true,
        expiresAt: true,
        acceptedAt: true,
        organization: { select: { name: true } },
      },
    }),
  );
  if (!invitation) return null;

  return {
    organizationId: invitation.organizationId,
    organizationName: invitation.organization.name,
    email: invitation.email,
    roleId: invitation.roleId as RoleKey,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
  };
}

/**
 * Accepts a token inside the organisation it names.
 *
 * Call it under `runAsOrg(organizationId)` with the id from
 * `resolveInvitation` — the token lookup below is then tenant-scoped too, so a
 * token can only ever add someone to the workspace it was issued for.
 */
export async function acceptInvitation(
  db: AmxPrismaClient,
  input: { token: string; userId: string; userEmail: string },
): Promise<AcceptResult> {
  const invitation = await db.invitation.findUnique({
    where: { token: input.token },
    select: {
      id: true,
      organizationId: true,
      email: true,
      roleId: true,
      expiresAt: true,
      acceptedAt: true,
    },
  });
  if (!invitation) return { ok: false, detail: "This invitation link is not valid." };
  if (invitation.acceptedAt) {
    return { ok: false, detail: "This invitation has already been used." };
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    return {
      ok: false,
      detail: `This invitation expired on ${invitation.expiresAt.toISOString().slice(0, 10)}. Ask an admin for a new one.`,
    };
  }
  if (invitation.email !== input.userEmail.trim().toLowerCase()) {
    return {
      ok: false,
      detail: `This invitation was sent to ${invitation.email}. Sign in as that address to accept it.`,
    };
  }

  const existing = await db.membership.findUnique({
    where: {
      organizationId_userId: { organizationId: invitation.organizationId, userId: input.userId },
    },
    select: { id: true, archivedAt: true },
  });

  await db.$transaction(async (tx) => {
    const membershipId =
      existing?.id ??
      (
        await tx.membership.create({
          data: { organizationId: invitation.organizationId, userId: input.userId },
          select: { id: true },
        })
      ).id;

    if (existing?.archivedAt) {
      await tx.membership.update({ where: { id: membershipId }, data: { archivedAt: null } });
    }

    await tx.membershipRole.upsert({
      where: { membershipId_roleId: { membershipId, roleId: invitation.roleId } },
      update: {},
      create: {
        organizationId: invitation.organizationId,
        membershipId,
        roleId: invitation.roleId,
      },
    });

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });

    await appendAuditEvent(tx as AmxPrismaClient, {
      organizationId: invitation.organizationId,
      type: "invitation.accepted",
      subjectType: "Membership",
      subjectId: membershipId,
      actorUserId: input.userId,
      payload: { email: invitation.email, roleId: invitation.roleId },
    });
  });

  await track({
    name: "org_joined",
    organizationId: invitation.organizationId,
    userId: input.userId,
    properties: { roleId: invitation.roleId },
  });

  return {
    ok: true,
    organizationId: invitation.organizationId,
    roleKey: invitation.roleId as RoleKey,
  };
}

export async function pendingInvitations(
  db: AmxPrismaClient,
  organizationId: string,
): Promise<PendingInvitation[]> {
  const rows = await db.invitation.findMany({
    where: { organizationId, acceptedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, roleId: true, expiresAt: true, token: true },
  });

  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    roleId: row.roleId as RoleKey,
    roleName: roleName(row.roleId as RoleKey),
    expiresAt: row.expiresAt,
    expired: row.expiresAt.getTime() < now,
    acceptPath: `/invite/${row.token}`,
  }));
}

/**
 * Delivery, stubbed to the console as specified.
 *
 * The link is also shown to the admin who created it, so a workspace without
 * mail configured is not a workspace that cannot invite anyone.
 */
function deliverInvitation(input: { email: string; roleKey: RoleKey; acceptPath: string }): void {
  console.info(
    `[invite] to=${input.email} role=${input.roleKey} link=${input.acceptPath}\n` +
      `         (email delivery is stubbed — wire a transport here to send it for real)`,
  );
}
