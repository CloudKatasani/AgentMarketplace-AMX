import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  acceptInvitation,
  createInvitation,
  pendingInvitations,
  resolveInvitation,
  revokeInvitation,
} from "@/lib/organizations/invitations";
import { listMembers, setCredentialPolicy, setMemberRole, setThemeOverride } from "@/lib/organizations/members";
import { parseThemeForm, readThemeOverride, toCssVariables } from "@/lib/theme/override";

import { addMember, inOrg, makeOrg, makeUser, raw } from "./helpers";

/**
 * Getting a second human into a workspace, and what they may sign for.
 *
 * These are governance-adjacent rather than governance: nothing here can
 * approve anything. What they must guarantee is that a role — which decides who
 * may sign a gate — cannot be granted by the wrong person, in the wrong tenant,
 * or without a trace.
 */
describe("invitations", () => {
  it("issues a token an admin can send, and records it without the token", async () => {
    const org = await makeOrg({ ownerRoles: ["org-admin"] });

    const result = await inOrg(org.organizationId, () =>
      createInvitation(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        email: "Colleague@Example.Test",
        roleKey: "governance-officer",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.acceptPath).toBe(`/invite/${result.token}`);
    expect(result.token).toHaveLength(64);

    const event = await raw.auditEvent.findFirst({
      where: { organizationId: org.organizationId, type: "invitation.created" },
      select: { payload: true },
    });
    // The token is the credential; it must never reach the audit trail.
    expect(event?.payload).not.toContain(result.token);
    expect(event?.payload).toContain("colleague@example.test");
  });

  it("refuses anyone who is not an org-admin", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder"] });

    const result = await inOrg(org.organizationId, () =>
      createInvitation(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        email: "colleague@example.test",
        roleKey: "agent-builder",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/Organisation Admin/);
  });

  it("replaces a pending invitation rather than issuing a second live token", async () => {
    const org = await makeOrg({ ownerRoles: ["org-admin"] });

    const first = await inOrg(org.organizationId, () =>
      createInvitation(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        email: "colleague@example.test",
        roleKey: "agent-builder",
      }),
    );
    const second = await inOrg(org.organizationId, () =>
      createInvitation(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        email: "colleague@example.test",
        roleKey: "governance-officer",
      }),
    );

    expect(first.ok && second.ok).toBe(true);
    const pending = await inOrg(org.organizationId, () =>
      pendingInvitations(db, org.organizationId),
    );
    expect(pending).toHaveLength(1);
    expect(pending[0].roleId).toBe("governance-officer");

    // And the superseded token is dead, not merely hidden.
    if (first.ok) {
      expect(await resolveInvitation(db, first.token)).toBeNull();
    }
  });

  it("adds the member with the invited role on accept, once", async () => {
    const org = await makeOrg({ ownerRoles: ["org-admin"] });
    const invitee = await raw.user.create({
      data: { email: "joiner@example.test", name: "Joiner", passwordHash: "x" },
      select: { id: true },
    });

    const invite = await inOrg(org.organizationId, () =>
      createInvitation(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        email: "joiner@example.test",
        roleKey: "governance-officer",
      }),
    );
    if (!invite.ok) throw new Error("invite failed");

    const accepted = await inOrg(org.organizationId, () =>
      acceptInvitation(db, {
        token: invite.token,
        userId: invitee.id,
        userEmail: "joiner@example.test",
      }),
    );
    expect(accepted.ok).toBe(true);

    const members = await inOrg(org.organizationId, () => listMembers(db, org.organizationId));
    const joined = members.find((m) => m.email === "joiner@example.test");
    expect(joined?.roleKeys).toEqual(["governance-officer"]);

    // A token is single-use.
    const again = await inOrg(org.organizationId, () =>
      acceptInvitation(db, {
        token: invite.token,
        userId: invitee.id,
        userEmail: "joiner@example.test",
      }),
    );
    expect(again.ok).toBe(false);
  });

  it("refuses a token presented by a different address", async () => {
    const org = await makeOrg({ ownerRoles: ["org-admin"] });
    const otherUserId = await makeUser("Someone Else");

    const invite = await inOrg(org.organizationId, () =>
      createInvitation(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        email: "intended@example.test",
        roleKey: "agent-builder",
      }),
    );
    if (!invite.ok) throw new Error("invite failed");

    const result = await inOrg(org.organizationId, () =>
      acceptInvitation(db, {
        token: invite.token,
        userId: otherUserId,
        userEmail: "someone.else@example.test",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/intended@example.test/);
  });

  it("refuses an expired token", async () => {
    const org = await makeOrg({ ownerRoles: ["org-admin"] });
    const userId = await makeUser("Late");
    await raw.user.update({ where: { id: userId }, data: { email: "late@example.test" } });

    const invite = await inOrg(org.organizationId, () =>
      createInvitation(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        email: "late@example.test",
        roleKey: "agent-builder",
      }),
    );
    if (!invite.ok) throw new Error("invite failed");

    await raw.invitation.update({
      where: { id: invite.invitationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await inOrg(org.organizationId, () =>
      acceptInvitation(db, { token: invite.token, userId, userEmail: "late@example.test" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/expired/i);
  });

  it("cannot be accepted after it is revoked", async () => {
    const org = await makeOrg({ ownerRoles: ["org-admin"] });
    const userId = await makeUser("Revoked");
    await raw.user.update({ where: { id: userId }, data: { email: "revoked@example.test" } });

    const invite = await inOrg(org.organizationId, () =>
      createInvitation(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        email: "revoked@example.test",
        roleKey: "agent-builder",
      }),
    );
    if (!invite.ok) throw new Error("invite failed");

    const revoked = await inOrg(org.organizationId, () =>
      revokeInvitation(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        invitationId: invite.invitationId,
      }),
    );
    expect(revoked.ok).toBe(true);

    const result = await inOrg(org.organizationId, () =>
      acceptInvitation(db, { token: invite.token, userId, userEmail: "revoked@example.test" }),
    );
    expect(result.ok).toBe(false);
  });

  it("a token issued by one organisation is invisible inside another", async () => {
    const alpha = await makeOrg({ ownerRoles: ["org-admin"] });
    const beta = await makeOrg({ ownerRoles: ["org-admin"] });

    const invite = await inOrg(alpha.organizationId, () =>
      createInvitation(db, {
        organizationId: alpha.organizationId,
        actorUserId: alpha.ownerUserId,
        email: "cross@example.test",
        roleKey: "agent-builder",
      }),
    );
    if (!invite.ok) throw new Error("invite failed");

    const userId = await makeUser("Cross");
    await raw.user.update({ where: { id: userId }, data: { email: "cross@example.test" } });

    const result = await inOrg(beta.organizationId, () =>
      acceptInvitation(db, { token: invite.token, userId, userEmail: "cross@example.test" }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("roles and workspace policy", () => {
  it("grants and revokes a role, and records both", async () => {
    const org = await makeOrg({ ownerRoles: ["org-admin"] });
    const memberUserId = await addMember(org.organizationId, ["agent-builder"], "Builder");

    const members = await inOrg(org.organizationId, () => listMembers(db, org.organizationId));
    const membershipId = members.find((m) => m.userId === memberUserId)!.membershipId;

    const granted = await inOrg(org.organizationId, () =>
      setMemberRole(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        membershipId,
        roleKey: "governance-officer",
        granted: true,
      }),
    );
    expect(granted.ok).toBe(true);

    const revoked = await inOrg(org.organizationId, () =>
      setMemberRole(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        membershipId,
        roleKey: "governance-officer",
        granted: false,
      }),
    );
    expect(revoked.ok).toBe(true);

    const events = await raw.auditEvent.findMany({
      where: {
        organizationId: org.organizationId,
        type: { in: ["member.role-granted", "member.role-revoked"] },
      },
      select: { type: true },
    });
    expect(events.map((e) => e.type).sort()).toEqual([
      "member.role-granted",
      "member.role-revoked",
    ]);
  });

  it("refuses to remove the last org-admin", async () => {
    const org = await makeOrg({ ownerRoles: ["org-admin"] });
    const members = await inOrg(org.organizationId, () => listMembers(db, org.organizationId));
    const own = members.find((m) => m.userId === org.ownerUserId)!;

    const result = await inOrg(org.organizationId, () =>
      setMemberRole(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        membershipId: own.membershipId,
        roleKey: "org-admin",
        granted: false,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/only Organisation Admin/i);
  });

  it("a non-admin cannot grant themselves an approver role", async () => {
    const org = await makeOrg({ ownerRoles: ["org-admin"] });
    const memberUserId = await addMember(org.organizationId, ["agent-builder"], "Builder");
    const members = await inOrg(org.organizationId, () => listMembers(db, org.organizationId));
    const membershipId = members.find((m) => m.userId === memberUserId)!.membershipId;

    const result = await inOrg(org.organizationId, () =>
      setMemberRole(db, {
        organizationId: org.organizationId,
        actorUserId: memberUserId,
        membershipId,
        roleKey: "governance-officer",
        granted: true,
      }),
    );

    expect(result.ok).toBe(false);
  });

  it("toggles the credential requirement and records it", async () => {
    const org = await makeOrg({ ownerRoles: ["org-admin"] });

    const result = await inOrg(org.organizationId, () =>
      setCredentialPolicy(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        required: true,
      }),
    );
    expect(result.ok).toBe(true);

    const organization = await raw.organization.findUnique({
      where: { id: org.organizationId },
      select: { requireApproverCredentials: true },
    });
    expect(organization?.requireApproverCredentials).toBe(true);
  });
});

describe("theme override", () => {
  it("accepts hex or channels for the tokens it allows", () => {
    const parsed = parseThemeForm("brand-primary: #0070AD\nbrand-accent: 18 171 219");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.theme["brand-primary"]).toEqual([0, 112, 173]);
    expect(parsed.theme["brand-accent"]).toEqual([18, 171, 219]);
  });

  it("refuses a token that is not overridable", () => {
    // Semantic states carry meaning and contrast guarantees a rebrand must not
    // be able to break.
    const parsed = parseThemeForm("danger: #00FF00");
    expect(parsed.ok).toBe(false);
  });

  it("refuses anything that is not a colour", () => {
    for (const line of [
      "brand-primary: red; } body { display: none",
      "brand-primary: expression(alert(1))",
      "brand-primary: 0 112 300",
      "brand-primary: url(https://example.test/x.css)",
    ]) {
      expect(parseThemeForm(line).ok).toBe(false);
    }
  });

  it("emits only numbers, so nothing a tenant typed reaches the page", () => {
    const parsed = parseThemeForm("brand-primary: #0070AD");
    if (!parsed.ok) throw new Error("expected a valid theme");
    const css = toCssVariables(parsed.theme);
    expect(css).toBe(":root{--brand-primary: 0 112 173;}");
    // Rebuilt from integers: the hex the tenant typed is nowhere in the output.
    expect(css).not.toContain("#");
    expect(css).not.toContain("0070AD");
  });

  it("treats a corrupt stored override as no override at all", () => {
    expect(readThemeOverride("not json")).toBeNull();
    expect(readThemeOverride('{"danger":[0,0,0]}')).toBeNull();
    expect(readThemeOverride("{}")).toBeNull();
  });

  it("stores a validated override and audits the change", async () => {
    const org = await makeOrg({ ownerRoles: ["org-admin"] });

    const result = await inOrg(org.organizationId, () =>
      setThemeOverride(db, {
        organizationId: org.organizationId,
        actorUserId: org.ownerUserId,
        theme: { "brand-primary": [10, 20, 30] },
      }),
    );
    expect(result.ok).toBe(true);

    const organization = await raw.organization.findUnique({
      where: { id: org.organizationId },
      select: { themeOverride: true },
    });
    expect(readThemeOverride(organization?.themeOverride ?? null)).toEqual({
      "brand-primary": [10, 20, 30],
    });

    const event = await raw.auditEvent.findFirst({
      where: { organizationId: org.organizationId, type: "theme.changed" },
      select: { id: true },
    });
    expect(event).not.toBeNull();
  });
});
