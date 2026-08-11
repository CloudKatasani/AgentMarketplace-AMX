/**
 * Starting without an account.
 *
 * The old flow asked for a name, an email and a password before anyone had seen
 * a single screen of the product. That is a wall in front of a ten-minute
 * time-to-first-wow, and it buys nothing: a workspace with no members but its
 * creator has nothing to protect yet.
 *
 * So the industry choice *is* the sign-up. A guest identity is minted
 * server-side, the workspace is seeded exactly as it always was, and the person
 * lands on their own agent. Claiming the workspace later — adding a real name,
 * email and password — upgrades the same user and keeps every artifact,
 * approval and audit event, because nothing was ever attached to the email in
 * the first place.
 *
 * Two things this deliberately does not do. It does not create a *second-class*
 * workspace: a guest workspace is an ordinary FREE tenant, with the same gates
 * and the same audit trail. And it does not let a guest invite anyone — see
 * `canInviteFrom` below — because an unclaimed identity cannot be held to an
 * approval it granted somebody else.
 */
import { randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { track } from "@/lib/analytics";
import { hashPassword } from "@/lib/auth/password";

import { createOrganization, slugify } from "./create";

/**
 * Un-extended client: minting the identity happens before any organisation
 * exists, exactly as at sign-in. `User` is a global model.
 */
const users = new PrismaClient();

/** Reserved so a guest placeholder can never collide with a real address. */
export const GUEST_EMAIL_DOMAIN = "guest.amx.local";

export type GuestWorkspace = {
  organizationId: string;
  workspaceId: string;
  starterAgentId: string | null;
  userId: string;
  /** Used once, server-side, to establish the session. Never shown. */
  email: string;
  password: string;
};

export function isGuestEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${GUEST_EMAIL_DOMAIN}`);
}

export async function createGuestWorkspace(input: {
  industryId: string;
  organizationName?: string;
}): Promise<GuestWorkspace> {
  const handle = randomBytes(9).toString("base64url").toLowerCase();
  const email = `guest-${handle}@${GUEST_EMAIL_DOMAIN}`;
  const password = randomBytes(24).toString("base64url");

  const user = await users.user.create({
    data: {
      email,
      name: "Guest",
      passwordHash: await hashPassword(password),
      isGuest: true,
    },
    select: { id: true },
  });

  const name = (input.organizationName ?? "").trim() || "My workspace";
  let slug = slugify(name);
  if (await users.organization.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${slug}-${handle.slice(0, 6)}`;
  }

  const created = await createOrganization({
    name,
    slug,
    ownerUserId: user.id,
    ownerName: "Guest",
    planTier: "FREE",
    industryId: input.industryId,
  });

  await track({
    name: "org_created",
    organizationId: created.organizationId,
    userId: user.id,
    properties: { industryId: input.industryId, entry: "no-account" },
  });

  return {
    organizationId: created.organizationId,
    workspaceId: created.workspaceId,
    starterAgentId: created.starterAgentId,
    userId: user.id,
    email,
    password,
  };
}

export type ClaimResult = { ok: true } | { ok: false; detail: string };

/**
 * Turning a guest into a person.
 *
 * The user row is updated in place, so memberships, roles, authored artifacts
 * and every audit event that names this actor stay pointed at the same id. An
 * approval signed as a guest is still that person's approval afterwards — which
 * is the honest outcome, and the reason the audit trail records the actor id
 * rather than an email.
 */
export async function claimWorkspace(input: {
  userId: string;
  name: string;
  email: string;
  password: string;
}): Promise<ClaimResult> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();

  if (name.length < 2) return { ok: false, detail: "Tell us your name." };
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return { ok: false, detail: "That doesn't look like an email address." };
  }
  if (isGuestEmail(email)) {
    return { ok: false, detail: "Use your own email address." };
  }
  if (input.password.length < 8) {
    return { ok: false, detail: "Use a password of at least 8 characters." };
  }

  const current = await users.user.findUnique({
    where: { id: input.userId },
    select: { id: true, isGuest: true },
  });
  if (!current) return { ok: false, detail: "That account no longer exists." };
  if (!current.isGuest) {
    return { ok: false, detail: "This workspace has already been claimed." };
  }

  const taken = await users.user.findUnique({ where: { email }, select: { id: true } });
  if (taken && taken.id !== input.userId) {
    return {
      ok: false,
      detail: "That email already has an account. Sign in with it and ask to be invited here.",
    };
  }

  await users.user.update({
    where: { id: input.userId },
    data: {
      name,
      email,
      passwordHash: await hashPassword(input.password),
      isGuest: false,
    },
  });

  return { ok: true };
}

/**
 * Inviting someone is the one thing a guest cannot do.
 *
 * Not a plan limit and not friction for its own sake: an invitation grants a
 * role, and a role decides who may sign a gate. An identity nobody can be
 * contacted at should not be handing those out.
 */
export function canInviteFrom(isGuest: boolean): boolean {
  return !isGuest;
}
