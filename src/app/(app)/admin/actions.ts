"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/app/(app)/agents/[id]/actions";
import { requireSessionContext } from "@/lib/auth/session-context";
import { withOrg } from "@/lib/db/scope";
import { createInvitation, revokeInvitation } from "@/lib/organizations/invitations";
import {
  setCredentialPolicy,
  setMemberRole,
  setThemeOverride,
} from "@/lib/organizations/members";
import { can } from "@/lib/plans/features";
import type { PlanTier } from "@/lib/enums";
import { parseThemeForm } from "@/lib/theme/override";

/**
 * Workspace administration.
 *
 * Every action re-derives the session and the organisation server-side; the
 * form is never asked which workspace it belongs to, and never trusted about
 * who is asking. Authorisation lives in the library functions, against the
 * database, so hiding a control in the UI is a courtesy rather than the
 * enforcement.
 */

export async function inviteMemberAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSessionContext();

  const result = await withOrg(session.organizationId, (db) =>
    createInvitation(db, {
      organizationId: session.organizationId,
      actorUserId: session.userId,
      email: String(formData.get("email") ?? ""),
      roleKey: String(formData.get("roleKey") ?? ""),
    }),
  );

  if (!result.ok) return { ok: false, message: result.detail };

  revalidatePath("/admin");
  return {
    ok: true,
    message:
      `Invitation created. Email delivery is stubbed in this deployment, so send them this link: ` +
      `${result.acceptPath}`,
  };
}

export async function revokeInvitationAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSessionContext();

  const result = await withOrg(session.organizationId, (db) =>
    revokeInvitation(db, {
      organizationId: session.organizationId,
      actorUserId: session.userId,
      invitationId: String(formData.get("invitationId") ?? ""),
    }),
  );

  revalidatePath("/admin");
  return { ok: result.ok, message: result.detail };
}

export async function setRoleAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSessionContext();

  const result = await withOrg(session.organizationId, (db) =>
    setMemberRole(db, {
      organizationId: session.organizationId,
      actorUserId: session.userId,
      membershipId: String(formData.get("membershipId") ?? ""),
      roleKey: String(formData.get("roleKey") ?? ""),
      granted: formData.get("granted") === "1",
    }),
  );

  revalidatePath("/admin");
  return { ok: result.ok, message: result.detail };
}

export async function setCredentialPolicyAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSessionContext();

  const result = await withOrg(session.organizationId, (db) =>
    setCredentialPolicy(db, {
      organizationId: session.organizationId,
      actorUserId: session.userId,
      required: formData.get("required") === "1",
    }),
  );

  revalidatePath("/admin");
  return { ok: result.ok, message: result.detail };
}

export async function saveThemeAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSessionContext();

  // White-label is a plan feature, so the flag is checked here — and the role,
  // the tenant's mutability and the audit event are enforced in the library.
  if (!can(session.planTier as PlanTier, "whiteLabel")) {
    return { ok: false, message: "Rebranding a workspace is part of Enterprise." };
  }

  const parsed = parseThemeForm(String(formData.get("theme") ?? ""));
  if (!parsed.ok) return { ok: false, message: parsed.detail };

  const result = await withOrg(session.organizationId, (db) =>
    setThemeOverride(db, {
      organizationId: session.organizationId,
      actorUserId: session.userId,
      theme: parsed.theme as Record<string, [number, number, number]>,
    }),
  );

  revalidatePath("/", "layout");
  return { ok: result.ok, message: result.detail };
}
