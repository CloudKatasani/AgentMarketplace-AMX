import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { inOrg } from "./helpers";
import { createInvitation } from "@/lib/organizations/invitations";
import {
  GUEST_EMAIL_DOMAIN,
  claimWorkspace,
  createGuestWorkspace,
  isGuestEmail,
} from "@/lib/organizations/guest";
import { catalogIndustries, catalogIndustry } from "@/lib/packs/catalog";
import { loadPack } from "@/lib/packs/load";

import { raw } from "./helpers";

/**
 * Getting in without an account, and the public catalogue.
 *
 * The governance question hiding inside "no sign-up" is what a nameless
 * identity is allowed to do. The answer here is: everything a solo practitioner
 * does — author, submit, self-attest — and nothing that grants somebody else a
 * role. Claiming the workspace is what closes that gap, and it must not move a
 * single artifact while doing it.
 */
describe("starting without an account", () => {
  it("mints a seeded workspace with no details asked for", async () => {
    const guest = await createGuestWorkspace({ industryId: "utilities" });

    expect(guest.starterAgentId).toBeTruthy();
    expect(isGuestEmail(guest.email)).toBe(true);
    expect(guest.email.endsWith(`@${GUEST_EMAIL_DOMAIN}`)).toBe(true);

    const user = await raw.user.findUnique({
      where: { id: guest.userId },
      select: { isGuest: true, name: true },
    });
    expect(user?.isGuest).toBe(true);

    // An ordinary FREE tenant — not a second-class one.
    const organization = await raw.organization.findUnique({
      where: { id: guest.organizationId },
      select: { planTier: true, isReadOnly: true, isShowcase: true },
    });
    expect(organization).toMatchObject({
      planTier: "FREE",
      isReadOnly: false,
      isShowcase: false,
    });

    // Seeded from the chosen pack, so nobody lands on an empty screen.
    const agents = await inOrg(guest.organizationId, () =>
      db.agent.findMany({ select: { id: true } }),
    );
    const questions = await inOrg(guest.organizationId, () =>
      db.question.count({ where: { archivedAt: null } }),
    );
    expect(agents.length).toBeGreaterThan(0);
    expect(questions).toBeGreaterThanOrEqual(3);
  });

  it("cannot invite anyone until it is claimed", async () => {
    const guest = await createGuestWorkspace({ industryId: "utilities" });

    const attempt = await inOrg(guest.organizationId, () =>
      createInvitation(db, {
        organizationId: guest.organizationId,
        actorUserId: guest.userId,
        email: "colleague@example.test",
        roleKey: "governance-officer",
      }),
    );

    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    // The refusal has to explain itself and offer the next action.
    expect(attempt.detail).toMatch(/settings/i);
  });

  it("claiming keeps the same identity, so nothing changes hands", async () => {
    const guest = await createGuestWorkspace({ industryId: "utilities" });

    const before = await inOrg(guest.organizationId, () =>
      db.membership.findMany({ select: { id: true, userId: true } }),
    );
    const auditBefore = await inOrg(guest.organizationId, () =>
      db.auditEvent.count(),
    );

    const email = `claimed-${guest.userId.slice(-8)}@example.test`;
    const claimed = await claimWorkspace({
      userId: guest.userId,
      name: "Dana Founder",
      email,
      password: "correct-horse-battery",
    });
    expect(claimed.ok).toBe(true);

    const user = await raw.user.findUnique({
      where: { id: guest.userId },
      select: { email: true, name: true, isGuest: true },
    });
    expect(user).toMatchObject({ email, name: "Dana Founder", isGuest: false });

    const after = await inOrg(guest.organizationId, () =>
      db.membership.findMany({ select: { id: true, userId: true } }),
    );
    const auditAfter = await inOrg(guest.organizationId, () => db.auditEvent.count());

    // Same membership rows, same actor, same history: the claim is an update to
    // one user row, not a migration.
    expect(after).toEqual(before);
    expect(auditAfter).toBe(auditBefore);

    // And now they can invite.
    const invite = await inOrg(guest.organizationId, () =>
      createInvitation(db, {
        organizationId: guest.organizationId,
        actorUserId: guest.userId,
        email: "colleague@example.test",
        roleKey: "governance-officer",
      }),
    );
    expect(invite.ok).toBe(true);
  });

  it("refuses a claim that would take over another account, or reuse a guest address", async () => {
    const guest = await createGuestWorkspace({ industryId: "utilities" });
    const other = await createGuestWorkspace({ industryId: "_generic" });
    const taken = `taken-${other.userId.slice(-8)}@example.test`;

    await claimWorkspace({
      userId: other.userId,
      name: "Someone Else",
      email: taken,
      password: "correct-horse-battery",
    });

    const collision = await claimWorkspace({
      userId: guest.userId,
      name: "Dana",
      email: taken,
      password: "correct-horse-battery",
    });
    expect(collision.ok).toBe(false);

    const guestAddress = await claimWorkspace({
      userId: guest.userId,
      name: "Dana",
      email: `someone@${GUEST_EMAIL_DOMAIN}`,
      password: "correct-horse-battery",
    });
    expect(guestAddress.ok).toBe(false);

    // A workspace can only be claimed once.
    const second = await claimWorkspace({
      userId: other.userId,
      name: "Someone Else Again",
      email: `again-${other.userId.slice(-8)}@example.test`,
      password: "correct-horse-battery",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.detail).toMatch(/already been claimed/i);
  });
});

describe("the public catalogue", () => {
  it("lists every shipped pack, with the generic one last", () => {
    const industries = catalogIndustries();
    expect(industries.length).toBeGreaterThanOrEqual(9);
    expect(industries[industries.length - 1].key).toBe("_generic");
    expect(industries.some((industry) => industry.hasLiveDemo)).toBe(true);
  });

  it("resolves an agent's questions to the metric and product that answer them", () => {
    const utilities = catalogIndustry("utilities");
    expect(utilities).not.toBeNull();
    if (!utilities) return;

    const advisor = utilities.agents.find((agent) => agent.key === "customer-churn-advisor");
    expect(advisor).toBeTruthy();
    if (!advisor) return;

    expect(advisor.questions.length).toBeGreaterThanOrEqual(3);
    const churn = advisor.questions.find((q) => q.metricKey === "residential_churn_rate");
    expect(churn?.dataProductName).toBe("Customer 360");
    expect(churn?.metricName).toBeTruthy();

    // Bindings resolve to a real product with its contract version.
    expect(advisor.bindings.length).toBeGreaterThan(0);
    expect(advisor.bindings[0].contractVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("carries enough products per industry to be worth browsing", () => {
    // A catalogue with two products per industry is a screenshot, not a
    // catalogue. Each pack ships at least eight, across its own declared
    // domains, with metric keys unique inside the pack — the catalogue resolves
    // a question to its metric by key, so a duplicate would answer the wrong
    // question with the right number.
    for (const industry of catalogIndustries()) {
      const view = catalogIndustry(industry.key)!;
      const loaded = loadPack(industry.key);
      if (!loaded.ok) throw new Error(`${industry.key} failed to load`);

      expect(view.dataProducts.length, `${industry.key} data products`).toBeGreaterThanOrEqual(8);

      const domains = new Set(view.domains.map((domain) => domain.key));
      const metricKeys = new Set<string>();

      for (const product of loaded.pack.dataProducts) {
        expect(domains.has(product.domainKey), `${product.key} domain`).toBe(true);
        expect(product.metrics.length, `${product.key} metrics`).toBeGreaterThan(0);
        for (const metric of product.metrics) {
          expect(metricKeys.has(metric.key), `${industry.key}: duplicate ${metric.key}`).toBe(false);
          metricKeys.add(metric.key);
        }
      }
    }
  });

  it("never exposes a product an agent could not legally bind to", () => {
    for (const industry of catalogIndustries()) {
      const pack = catalogIndustry(industry.key);
      expect(pack).not.toBeNull();
      for (const product of pack!.dataProducts) {
        expect(["GOLD", "PLATINUM", "SEMANTIC"]).toContain(product.layer);
      }
    }
  });

  it("returns nothing for an unknown industry rather than guessing", () => {
    expect(catalogIndustry("not-an-industry")).toBeNull();
  });
});
