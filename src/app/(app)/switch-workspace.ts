"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireSessionContext, ORG_COOKIE } from "@/lib/auth/session-context";

/**
 * Switching workspaces is a preference, not a permission.
 *
 * The cookie only ever names an organisation the signed-in user is already a
 * member of — re-checked here, and again on every read in
 * `getSessionContext()`. A forged cookie changes nothing.
 */
export async function switchWorkspaceAction(formData: FormData): Promise<void> {
  const target = String(formData.get("organizationId") ?? "");
  const session = await requireSessionContext();

  if (!session.memberships.some((m) => m.id === target)) {
    redirect("/agents");
  }

  (await cookies()).set(ORG_COOKIE, target, { path: "/", sameSite: "lax" });
  redirect("/agents");
}
