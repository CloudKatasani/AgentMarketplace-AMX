/**
 * Seed: reference data plus the showcase tenant.
 *
 * The showcase tenant is a product feature, not a fixture — it is what the
 * landing page's "Explore the live demo" opens, so it is seeded idempotently
 * and left read-only. Re-running this script converges on the same state
 * instead of duplicating it.
 *
 * The demo agent is walked through Stages 1 and 2 by the real gate engine
 * rather than written straight into an APPROVED row. A demo that bypasses the
 * engine would eventually diverge from it, and the divergence would show up on
 * stage.
 */
import { PrismaClient } from "@prisma/client";

import { db } from "../src/lib/db";
import { runAsOrg, runAsSystem } from "../src/lib/db/tenancy";
import { hashPassword } from "../src/lib/auth";
import { createOrganization } from "../src/lib/organizations/create";
import { recordDecision, requestTransition } from "../src/lib/gates";
import { STAGES } from "../src/lib/lifecycle/stages";
import { ROLES, type RoleKey } from "../src/lib/roles";

const raw = new PrismaClient();

const SHOWCASE_SLUG = "amx-demo-utility";
const DEMO_PASSWORD = "amx-demo-2024";

type SeedUser = { email: string; name: string; roles: RoleKey[] };

const DEMO_USERS: SeedUser[] = [
  { email: "alex.builder@amx.demo", name: "Alex Osei", roles: ["agent-builder"] },
  {
    email: "priya.owner@amx.demo",
    name: "Priya Raman",
    roles: ["org-admin", "agent-product-owner"],
  },
  { email: "sam.data@amx.demo", name: "Sam Whitfield", roles: ["data-product-owner"] },
  { email: "nora.gov@amx.demo", name: "Nora Lindqvist", roles: ["governance-officer"] },
  { email: "yusuf.privacy@amx.demo", name: "Yusuf Demir", roles: ["privacy-officer"] },
  { email: "kim.security@amx.demo", name: "Kim Sato", roles: ["security-officer"] },
  { email: "dana.consumer@amx.demo", name: "Dana Kovač", roles: ["business-consumer"] },
];

async function seedReferenceData(): Promise<void> {
  for (const role of ROLES) {
    await raw.role.upsert({
      where: { id: role.id },
      update: {
        name: role.name,
        description: role.description,
        isApprover: role.isApprover,
        isVeto: role.isVeto,
        requiresCredentialKey: role.requiresCredentialKey,
        ordinal: role.ordinal,
      },
      create: {
        id: role.id,
        name: role.name,
        description: role.description,
        isApprover: role.isApprover,
        isVeto: role.isVeto,
        requiresCredentialKey: role.requiresCredentialKey,
        ordinal: role.ordinal,
      },
    });
  }

  // The Stage table mirrors src/lib/lifecycle/stages.ts, which stays authoritative.
  for (const stage of STAGES) {
    await raw.stage.upsert({
      where: { id: stage.key },
      update: { ordinal: stage.ordinal, name: stage.name, purpose: stage.purpose },
      create: {
        id: stage.key,
        ordinal: stage.ordinal,
        name: stage.name,
        purpose: stage.purpose,
      },
    });
  }

  await raw.industry.upsert({
    where: { id: "_generic" },
    update: {},
    create: {
      id: "_generic",
      name: "Generic",
      packVersion: "1.0.0",
      summary: "Industry-agnostic vocabulary and roles. The default for a new organisation.",
    },
  });

  await raw.industry.upsert({
    where: { id: "utilities" },
    update: {},
    create: {
      id: "utilities",
      name: "Utilities & Energy",
      packVersion: "1.0.0",
      summary:
        "Customer → Account → Premise → Service Point → Meter, with retail, billing, and network domains.",
    },
  });

  const utilityDomains = [
    { key: "customer-experience", name: "Customer Experience" },
    { key: "meter-to-cash", name: "Meter to Cash" },
    { key: "network-operations", name: "Network Operations" },
    { key: "energy-trading", name: "Energy Trading" },
  ];
  for (const domain of utilityDomains) {
    await raw.domain.upsert({
      where: { industryId_key: { industryId: "utilities", key: domain.key } },
      update: {},
      create: {
        id: `utilities:${domain.key}`,
        industryId: "utilities",
        key: domain.key,
        name: domain.name,
      },
    });
  }
}

async function seedShowcase(): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const users = new Map<string, string>();
  for (const seed of DEMO_USERS) {
    const user = await raw.user.upsert({
      where: { email: seed.email },
      update: { name: seed.name },
      create: { email: seed.email, name: seed.name, passwordHash },
      select: { id: true },
    });
    users.set(seed.email, user.id);
  }

  const builderId = users.get("alex.builder@amx.demo")!;
  const productOwnerId = users.get("priya.owner@amx.demo")!;
  const governanceId = users.get("nora.gov@amx.demo")!;

  const existing = await raw.organization.findUnique({
    where: { slug: SHOWCASE_SLUG },
    select: { id: true },
  });

  if (existing) {
    // Idempotent re-seed: leave the walked-through history intact and just make
    // sure the tenant is still read-only.
    await raw.organization.update({
      where: { id: existing.id },
      data: { isReadOnly: true, isShowcase: true },
    });
    console.info(`Showcase tenant already seeded (${existing.id}); left as-is.`);
    return;
  }

  // The artifacts are authored by the builder, so the approvals below are real
  // peer reviews rather than the author signing their own work.
  const { organizationId } = await createOrganization({
    name: "Northwind Utility (demo)",
    slug: SHOWCASE_SLUG,
    ownerUserId: builderId,
    ownerName: "Alex Osei",
    planTier: "ENTERPRISE",
    industryId: "utilities",
    workspaceName: "Retail & Revenue",
    isShowcase: true,
    isReadOnly: false,
    ownerRoles: ["agent-builder"],
  });

  await runAsOrg(organizationId, async () => {
    for (const seed of DEMO_USERS) {
      if (seed.email === "alex.builder@amx.demo") continue;
      const userId = users.get(seed.email)!;
      const membership = await db.membership.create({
        data: { organizationId, userId },
        select: { id: true },
      });
      for (const roleId of seed.roles) {
        await db.membershipRole.create({
          data: { organizationId, membershipId: membership.id, roleId },
        });
      }
    }

    const agent = await db.agent.findFirst({
      where: { slug: "customer-churn-advisor" },
      select: { id: true },
    });
    if (!agent) throw new Error("Starter agent missing — seedStarterWorkspace did not run.");

    // Stage 1 · approved by the Agent Product Owner.
    const stage1 = await requestTransition(db, {
      organizationId,
      agentId: agent.id,
      stageId: "1-consumption-discovery",
      actorUserId: builderId,
    });
    if (stage1.ok) {
      await recordDecision(db, {
        organizationId,
        gateId: stage1.gateId,
        actorUserId: productOwnerId,
        roleKey: "agent-product-owner",
        decision: "APPROVE",
        comment: "Personas match the decisions this team actually owns.",
      });
    } else {
      console.warn("Stage 1 did not open:", stage1);
    }

    // Stage 2 · needs both the Agent Product Owner and the Governance Officer.
    const stage2 = await requestTransition(db, {
      organizationId,
      agentId: agent.id,
      stageId: "2-agent-charter",
      actorUserId: builderId,
    });
    if (stage2.ok) {
      await recordDecision(db, {
        organizationId,
        gateId: stage2.gateId,
        actorUserId: productOwnerId,
        roleKey: "agent-product-owner",
        decision: "APPROVE",
        comment: "Scope boundary and out-of-scope list are specific enough to hold.",
      });
      await recordDecision(db, {
        organizationId,
        gateId: stage2.gateId,
        actorUserId: governanceId,
        roleKey: "governance-officer",
        decision: "APPROVE",
        comment: "Decision-support tier is right; it advises and never contacts a customer.",
      });
    } else {
      console.warn("Stage 2 did not open:", stage2);
    }
  });

  // Read-only last: assertMutable refuses everything above once this is set.
  await raw.organization.update({
    where: { id: organizationId },
    data: { isReadOnly: true },
  });

  console.info(`Showcase tenant seeded: ${organizationId}`);
}

async function main(): Promise<void> {
  const showcaseOnly = process.argv.includes("--showcase-only");

  await runAsSystem(async () => {
    await seedReferenceData();
  });
  await seedShowcase();

  if (!showcaseOnly) {
    console.info("\nDemo sign-in:");
    for (const user of DEMO_USERS) {
      console.info(`  ${user.email}  ${DEMO_PASSWORD}   (${user.roles.join(", ")})`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await raw.$disconnect();
  });
