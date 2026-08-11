/**
 * Who is asking, and on behalf of which organisation.
 *
 * The organisation comes from a cookie, but is always re-checked against
 * `Membership` — a cookie is a preference, never a permission. An unknown or
 * revoked organisation silently falls back to the user's first membership.
 */
import { cookies } from "next/headers";
import { PrismaClient } from "@prisma/client";

import { auth } from "./index";

export const ORG_COOKIE = "amx-org";

const db = new PrismaClient();

export type SessionContext = {
  userId: string;
  userName: string;
  userEmail: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  planTier: string;
  isReadOnly: boolean;
  isShowcase: boolean;
  /** Raw JSON from `Organization.themeOverride`; parsed by the shell. */
  themeOverride: string | null;
  roleKeys: string[];
  /** Every organisation the user belongs to, for the switcher. */
  memberships: { id: string; name: string; slug: string; isShowcase: boolean }[];
};

export async function getSessionContext(): Promise<SessionContext | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const memberships = await db.membership.findMany({
    where: { userId, archivedAt: null },
    select: {
      organizationId: true,
      roles: { select: { roleId: true } },
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          planTier: true,
          isReadOnly: true,
          isShowcase: true,
          themeOverride: true,
          archivedAt: true,
        },
      },
    },
  });

  const active = memberships.filter((m) => !m.organization.archivedAt);
  if (active.length === 0) return null;

  const preferred = (await cookies()).get(ORG_COOKIE)?.value;
  const chosen = active.find((m) => m.organizationId === preferred) ?? active[0];

  return {
    userId,
    userName: session.user?.name ?? "",
    userEmail: session.user?.email ?? "",
    organizationId: chosen.organization.id,
    organizationName: chosen.organization.name,
    organizationSlug: chosen.organization.slug,
    planTier: chosen.organization.planTier,
    isReadOnly: chosen.organization.isReadOnly,
    isShowcase: chosen.organization.isShowcase,
    themeOverride: chosen.organization.themeOverride,
    roleKeys: chosen.roles.map((r) => r.roleId),
    memberships: active.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      isShowcase: m.organization.isShowcase,
    })),
  };
}

/** Throws where a page must not render without a session. */
export async function requireSessionContext(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("UNAUTHENTICATED");
  return ctx;
}
