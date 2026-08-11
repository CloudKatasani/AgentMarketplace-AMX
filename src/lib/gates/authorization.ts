/**
 * Server-side authorisation for the gate engine.
 *
 * Every check here runs on the server against the database, never against
 * anything the client sent. A UI that hides a button is a courtesy; this is the
 * enforcement.
 */
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import type { RoleKey } from "@/lib/roles";

export type Guard = { ok: true } | { ok: false; detail: string };

export type MembershipGuard =
  | { ok: true; membershipId: string; roleKeys: RoleKey[] }
  | { ok: false; detail: string };

/**
 * Read-only organisations refuse every mutation regardless of role.
 *
 * The showcase tenant is read-only, which is what makes "demo mode can never be
 * broken by a visitor" a server-side fact rather than a hope.
 */
export async function assertMutable(
  db: AmxPrismaClient,
  organizationId: string,
): Promise<Guard> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { isReadOnly: true, isShowcase: true, archivedAt: true },
  });
  if (!organization) return { ok: false, detail: "Organisation not found." };
  if (organization.archivedAt) return { ok: false, detail: "This organisation is archived." };
  if (organization.isReadOnly) {
    return {
      ok: false,
      detail: organization.isShowcase
        ? "This is the live demo workspace, so it stays exactly as it is. Create your own workspace to make changes."
        : "This organisation is read-only.",
    };
  }
  return { ok: true };
}

export async function requireMembership(
  db: AmxPrismaClient,
  organizationId: string,
  userId: string,
): Promise<MembershipGuard> {
  const membership = await db.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: {
      id: true,
      archivedAt: true,
      roles: { select: { roleId: true } },
    },
  });
  if (!membership || membership.archivedAt) {
    return { ok: false, detail: "You are not a member of this organisation." };
  }
  return {
    ok: true,
    membershipId: membership.id,
    roleKeys: membership.roles.map((r) => r.roleId as RoleKey),
  };
}
