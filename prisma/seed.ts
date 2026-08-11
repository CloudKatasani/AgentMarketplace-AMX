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
import { DEMO_VIEWER_EMAIL } from "../src/lib/demo";
import { recordDecision, requestTransition } from "../src/lib/gates";
import { loadAllPacks } from "../src/lib/packs/load";
import { walkToPublished } from "../src/lib/seed/showcase";
import { STAGES } from "../src/lib/lifecycle/stages";
import { ROLES, type RoleKey } from "../src/lib/roles";

const raw = new PrismaClient();

const SHOWCASE_SLUG = "amx-demo-utility";
const SANDBOX_SLUG = "amx-demo-utility-sandbox";
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
  // The account behind "Explore the live demo" on the landing page.
  { email: "demo.viewer@amx.demo", name: "Demo Visitor", roles: ["business-consumer"] },
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

  // Industries and domains come from the packs on disk, so adding a pack adds
  // an industry without touching this file.
  const { loaded, failed } = loadAllPacks();
  for (const failure of failed) {
    if (!failure.ok) {
      console.warn(`Pack ${failure.key} failed to load:`, failure.issues[0]?.message);
    }
  }

  for (const pack of loaded) {
    await raw.industry.upsert({
      where: { id: pack.key },
      update: { name: pack.name, packVersion: pack.version, summary: pack.summary },
      create: {
        id: pack.key,
        name: pack.name,
        packVersion: pack.version,
        summary: pack.summary,
      },
    });

    for (const domain of pack.domains) {
      await raw.domain.upsert({
        where: { industryId_key: { industryId: pack.key, key: domain.key } },
        update: { name: domain.name },
        create: {
          id: `${pack.key}:${domain.key}`,
          industryId: pack.key,
          key: domain.key,
          name: domain.name,
        },
      });
    }
  }
}

async function seedDemoUsers(): Promise<Map<string, string>> {
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
  return users;
}

/**
 * Builds one fully-walked utility tenant: eight approved stages, a published
 * agent, and enough operating history for the telemetry screens to say
 * something.
 *
 * It is called twice. The showcase copy is sealed read-only at the end and is
 * what "Explore the live demo" opens. The sandbox copy is left mutable, because
 * the demo's money moment — publish a breaking contract version, watch the
 * certification go STALE — is a *write*, and the showcase must never be
 * writable. Same seed, same script, one of them disposable.
 */
async function seedUtilityTenant(options: {
  name: string;
  slug: string;
  isShowcase: boolean;
  sealReadOnly: boolean;
  users: Map<string, string>;
}): Promise<void> {
  const { name, slug, isShowcase, sealReadOnly, users } = options;

  const builderId = users.get("alex.builder@amx.demo")!;
  const productOwnerId = users.get("priya.owner@amx.demo")!;
  const governanceId = users.get("nora.gov@amx.demo")!;

  const existing = await raw.organization.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (existing) {
    // Idempotent re-seed: leave the walked-through history intact and just make
    // sure the tenant's demo flags still say what they should.
    await raw.organization.update({
      where: { id: existing.id },
      data: { isReadOnly: sealReadOnly, isShowcase },
    });
    console.info(`Tenant ${slug} already seeded (${existing.id}); left as-is.`);
    return;
  }

  // The artifacts are authored by the builder, so the approvals below are real
  // peer reviews rather than the author signing their own work.
  const { organizationId } = await createOrganization({
    name,
    slug,
    ownerUserId: builderId,
    ownerName: "Alex Osei",
    planTier: "ENTERPRISE",
    industryId: "utilities",
    workspaceName: "Retail & Revenue",
    isShowcase,
    isReadOnly: false,
    ownerRoles: ["agent-builder"],
  });

  await runAsOrg(organizationId, async () => {
    for (const seed of DEMO_USERS) {
      if (seed.email === "alex.builder@amx.demo") continue;
      // The public "Explore the live demo" account belongs to the read-only
      // showcase only: a visitor must never land somewhere writable.
      if (!isShowcase && seed.email === DEMO_VIEWER_EMAIL) continue;
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
      select: { id: true, slug: true },
    });
    if (!agent) throw new Error("Starter agent missing — seedStarterWorkspace did not run.");

    const persona = await db.persona.findFirst({
      where: { key: "revenue-assurance-analyst" },
      select: { id: true },
    });

    const dataOwnerId = users.get("sam.data@amx.demo")!;

    // ── The full eight-stage walk, through the real engine ──
    //
    // Shared with the demo-arc test (src/lib/seed/showcase.ts), so a change
    // that breaks the arc fails a test rather than a sales call.
    const walk = await walkToPublished(db, {
      organizationId,
      agentId: agent.id,
      agentSlug: agent.slug,
      builderId,
      productOwnerId,
      dataOwnerId,
      governanceId,
    });
    if (!walk.ok) {
      console.warn(`${slug}: stopped at ${walk.failedAt} — ${walk.detail}`);
    }

    await seedOperations(agent.id, organizationId, persona?.id ?? null);
  });

  if (sealReadOnly) {
    // Read-only last: assertMutable refuses everything above once this is set.
    await raw.organization.update({
      where: { id: organizationId },
      data: { isReadOnly: true },
    });
  }

  console.info(`Tenant ${slug} seeded: ${organizationId}`);
}

/**
 * A published agent that has never been used is not a demo, it is a diagram.
 * These invocations give the operate screens something to say.
 */
async function seedOperations(
  agentId: string,
  organizationId: string,
  personaId: string | null,
): Promise<void> {
  const existing = await db.invocation.count({ where: { agentId } });
  if (existing > 0) return;

  const pattern: { intentClass: string; outcome: string; metricKey: string | null }[] = [
    ...Array.from({ length: 34 }, () => ({
      intentClass: "trend",
      outcome: "answered",
      metricKey: "residential_churn_rate",
    })),
    ...Array.from({ length: 21 }, () => ({
      intentClass: "forecast",
      outcome: "answered",
      metricKey: "high_bill_risk",
    })),
    ...Array.from({ length: 12 }, () => ({
      intentClass: "diagnosis",
      outcome: "answered",
      metricKey: "residential_churn_rate",
    })),
    // Refusals are a health signal: the boundary is doing its job.
    ...Array.from({ length: 7 }, () => ({
      intentClass: "lookup",
      outcome: "refused",
      metricKey: null,
    })),
    ...Array.from({ length: 3 }, () => ({
      intentClass: "recommendation",
      outcome: "escalated",
      metricKey: null,
    })),
  ];

  const now = Date.now();
  for (const [index, row] of pattern.entries()) {
    await db.invocation.create({
      data: {
        organizationId,
        agentId,
        personaId,
        intentClass: row.intentClass,
        outcome: row.outcome,
        metricKey: row.metricKey,
        latencyMs: 800 + (index % 17) * 90,
        createdAt: new Date(now - index * 5 * 3_600_000),
      },
    });
  }

  await db.feedback.create({
    data: {
      organizationId,
      agentId,
      rating: 1,
      body: "Saves me the Monday morning reconciliation. The metric name next to each number is what makes it usable in the review.",
      personaId,
    },
  });
  await db.feedback.create({
    data: {
      organizationId,
      agentId,
      rating: 0,
      body: "Refused a commercial-account question, which is correct, but the message could point at who does own that.",
      personaId,
    },
  });
}

async function main(): Promise<void> {
  const showcaseOnly = process.argv.includes("--showcase-only");

  await runAsSystem(async () => {
    await seedReferenceData();
  });

  const users = await seedDemoUsers();
  await seedUtilityTenant({
    name: "Northwind Utility (demo)",
    slug: SHOWCASE_SLUG,
    isShowcase: true,
    sealReadOnly: true,
    users,
  });
  await seedUtilityTenant({
    name: "Northwind Utility (sandbox)",
    slug: SANDBOX_SLUG,
    isShowcase: false,
    sealReadOnly: false,
    users,
  });

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
