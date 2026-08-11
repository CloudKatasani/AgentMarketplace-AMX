import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { db } from "@/lib/db";
import { runAsOrg, runAsSystem } from "@/lib/db/tenancy";
import { createOrganization } from "@/lib/organizations/create";
import type { RoleKey } from "@/lib/roles";

export const raw = new PrismaClient();

export async function makeUser(name = "Test User"): Promise<string> {
  const user = await raw.user.create({
    data: { email: `${randomUUID()}@example.test`, name, passwordHash: "x" },
    select: { id: true },
  });
  return user.id;
}

export type TestOrg = {
  organizationId: string;
  workspaceId: string;
  ownerUserId: string;
  agentId: string;
};

/**
 * A seeded organisation with a starter workspace, so tests exercise real data.
 *
 * Defaults to the utilities pack because that is the worked example the
 * governance and demo tests are written against — Customer 360 at CONFIDENTIAL
 * with the churn and high-bill metrics. Pass `packKey` for anything else.
 */
export async function makeOrg(
  options: {
    ownerRoles?: RoleKey[];
    seedStarter?: boolean;
    name?: string;
    packKey?: string;
  } = {},
): Promise<TestOrg> {
  const ownerUserId = await makeUser("Owner");
  const slug = `org-${randomUUID().slice(0, 8)}`;

  const created = await createOrganization({
    name: options.name ?? slug,
    slug,
    ownerUserId,
    ownerName: "Owner",
    ownerRoles: options.ownerRoles,
    seedStarter: options.seedStarter,
    industryId: options.packKey ?? "utilities",
  });

  return {
    organizationId: created.organizationId,
    workspaceId: created.workspaceId,
    ownerUserId,
    agentId: created.starterAgentId ?? "",
  };
}

/** Adds a member holding specific roles. */
export async function addMember(
  organizationId: string,
  roles: RoleKey[],
  name = "Member",
): Promise<string> {
  const userId = await makeUser(name);
  await runAsOrg(organizationId, async () => {
    const membership = await db.membership.create({
      data: { organizationId, userId },
      select: { id: true },
    });
    for (const roleId of roles) {
      await db.membershipRole.create({
        data: { organizationId, membershipId: membership.id, roleId },
      });
    }
  });
  return userId;
}

export function inOrg<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
  return runAsOrg(organizationId, fn);
}

export function asSystem<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}
