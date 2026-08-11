import { describe, expect, it } from "vitest";

import { hashToken, issueApiToken, listApiTokens, revokeApiToken, verifyApiToken } from "@/lib/api/tokens";
import { db } from "@/lib/db";

import { inOrg, makeOrg, raw } from "./helpers";

/**
 * API tokens.
 *
 * The token is a credential that names a tenant, so the things worth testing
 * are the ways it could betray one: being stored recoverably, outliving its
 * revocation, surviving a downgrade off the plan that granted it, or reading
 * somebody else's workspace.
 */
async function enterpriseOrg() {
  const org = await makeOrg({ ownerRoles: ["org-admin"] });
  await raw.organization.update({
    where: { id: org.organizationId },
    data: { planTier: "ENTERPRISE" },
  });
  return org;
}

describe("api tokens", () => {
  it("returns the token once and stores only its hash", async () => {
    const org = await enterpriseOrg();

    const result = await inOrg(org.organizationId, () =>
      issueApiToken(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        name: "Governance dashboard",
        planTier: "ENTERPRISE",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await raw.apiToken.findUnique({
      where: { id: result.issued.id },
      select: { tokenHash: true, prefix: true },
    });
    expect(row?.tokenHash).toBe(hashToken(result.issued.token));
    expect(row?.tokenHash).not.toBe(result.issued.token);
    // The prefix is kept so a person can tell two tokens apart; it is not enough
    // to reconstruct one.
    expect(result.issued.token.startsWith(row!.prefix)).toBe(true);
    expect(row!.prefix.length).toBeLessThan(result.issued.token.length / 2);

    const event = await raw.auditEvent.findFirst({
      where: { organizationId: org.organizationId, type: "api-token.issued" },
      select: { payload: true },
    });
    expect(event?.payload).not.toContain(result.issued.token);
  });

  it("refuses to issue below Enterprise, and refuses a non-admin", async () => {
    const free = await makeOrg({ ownerRoles: ["org-admin"] });
    const onFree = await inOrg(free.organizationId, () =>
      issueApiToken(db, {
        organizationId: free.organizationId,
        actorUserId: free.ownerUserId,
        name: "Nope",
        planTier: "FREE",
      }),
    );
    expect(onFree.ok).toBe(false);

    const enterprise = await makeOrg({ ownerRoles: ["agent-builder"] });
    await raw.organization.update({
      where: { id: enterprise.organizationId },
      data: { planTier: "ENTERPRISE" },
    });
    const asBuilder = await inOrg(enterprise.organizationId, () =>
      issueApiToken(db, {
        organizationId: enterprise.organizationId,
        actorUserId: enterprise.ownerUserId,
        name: "Nope",
        planTier: "ENTERPRISE",
      }),
    );
    expect(asBuilder.ok).toBe(false);
    if (asBuilder.ok) return;
    expect(asBuilder.detail).toMatch(/Organisation Admin/);
  });

  it("verifies a bearer token into its own organisation", async () => {
    const org = await enterpriseOrg();
    const issued = await inOrg(org.organizationId, () =>
      issueApiToken(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        name: "Reader",
        planTier: "ENTERPRISE",
      }),
    );
    if (!issued.ok) throw new Error("issue failed");

    const caller = await verifyApiToken(db, `Bearer ${issued.issued.token}`);
    expect(caller.ok).toBe(true);
    if (!caller.ok) return;
    expect(caller.organizationId).toBe(org.organizationId);
  });

  it("refuses a missing, malformed or unknown token with 401", async () => {
    for (const header of [null, "", "Token abc", "Bearer", "Bearer amx_not-a-real-token"]) {
      const caller = await verifyApiToken(db, header);
      expect(caller.ok).toBe(false);
      if (caller.ok) continue;
      expect(caller.status).toBe(401);
    }
  });

  it("stops answering the moment a token is revoked", async () => {
    const org = await enterpriseOrg();
    const issued = await inOrg(org.organizationId, () =>
      issueApiToken(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        name: "Short-lived",
        planTier: "ENTERPRISE",
      }),
    );
    if (!issued.ok) throw new Error("issue failed");

    await inOrg(org.organizationId, () =>
      revokeApiToken(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        tokenId: issued.issued.id,
      }),
    );

    const caller = await verifyApiToken(db, `Bearer ${issued.issued.token}`);
    expect(caller.ok).toBe(false);
    if (caller.ok) return;
    expect(caller.status).toBe(401);
  });

  it("stops answering when the workspace leaves Enterprise, without revocation", async () => {
    const org = await enterpriseOrg();
    const issued = await inOrg(org.organizationId, () =>
      issueApiToken(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        name: "Downgraded",
        planTier: "ENTERPRISE",
      }),
    );
    if (!issued.ok) throw new Error("issue failed");

    await raw.organization.update({
      where: { id: org.organizationId },
      data: { planTier: "TEAM" },
    });

    const caller = await verifyApiToken(db, `Bearer ${issued.issued.token}`);
    expect(caller.ok).toBe(false);
    if (caller.ok) return;
    // 403, not 401: the token is real, the plan is not.
    expect(caller.status).toBe(403);
  });

  it("reads only its own tenant's rows", async () => {
    const mine = await enterpriseOrg();
    const theirs = await enterpriseOrg();

    const issued = await inOrg(mine.organizationId, () =>
      issueApiToken(db, {
        organizationId: mine.organizationId,
        actorUserId: mine.ownerUserId,
        name: "Mine",
        planTier: "ENTERPRISE",
      }),
    );
    if (!issued.ok) throw new Error("issue failed");

    const caller = await verifyApiToken(db, `Bearer ${issued.issued.token}`);
    if (!caller.ok) throw new Error("verify failed");

    // The handler enters exactly this organisation, so the other tenant's
    // starter agent is not reachable through it.
    const agents = await inOrg(caller.organizationId, () =>
      db.agent.findMany({ select: { id: true } }),
    );
    expect(agents.some((agent) => agent.id === theirs.agentId)).toBe(false);
    expect(agents.some((agent) => agent.id === mine.agentId)).toBe(true);

    // And a token cannot even be listed from another workspace.
    const listedElsewhere = await inOrg(theirs.organizationId, () =>
      listApiTokens(db, theirs.organizationId),
    );
    expect(listedElsewhere).toHaveLength(0);
  });

  it("records the last time a token was used", async () => {
    const org = await enterpriseOrg();
    const issued = await inOrg(org.organizationId, () =>
      issueApiToken(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        name: "Touched",
        planTier: "ENTERPRISE",
      }),
    );
    if (!issued.ok) throw new Error("issue failed");

    await verifyApiToken(db, `Bearer ${issued.issued.token}`);

    // The touch is deliberately fire-and-forget, so give it a moment rather
    // than making every request wait on a write it does not need.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const row = await raw.apiToken.findUnique({
      where: { id: issued.issued.id },
      select: { lastUsedAt: true },
    });
    expect(row?.lastUsedAt).not.toBeNull();
  });
});
