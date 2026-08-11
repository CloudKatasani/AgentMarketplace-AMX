import { redirect } from "next/navigation";
import { PrismaClient } from "@prisma/client";

import { cookies } from "next/headers";

import { signIn } from "@/lib/auth";
import { ORG_COOKIE } from "@/lib/auth/session-context";

import { DEMO_VIEWER_EMAIL, DEMO_VIEWER_PASSWORD } from "@/lib/demo";

const db = new PrismaClient();

/**
 * "Explore the live demo".
 *
 * Signs the visitor into the showcase tenant as a read-only viewer. Nothing is
 * gated behind a form, because the demo is the pitch — and the tenant is
 * read-only server-side, so there is nothing a visitor can break.
 */
export async function GET() {
  const showcase = await db.organization.findFirst({
    where: { isShowcase: true },
    select: { id: true },
  });
  if (!showcase) redirect("/signin");

  const viewer = await db.membership.findFirst({
    where: { organizationId: showcase.id, user: { email: DEMO_VIEWER_EMAIL } },
    select: { user: { select: { email: true } } },
  });
  if (!viewer) redirect("/signin");

  (await cookies()).set(ORG_COOKIE, showcase.id, { path: "/", sameSite: "lax" });

  await signIn("credentials", {
    email: DEMO_VIEWER_EMAIL,
    password: DEMO_VIEWER_PASSWORD,
    redirectTo: "/marketplace",
  });
}
