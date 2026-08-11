/**
 * Performance sanity at the scale AMX is sold into.
 *
 * Not a benchmark — a tripwire. It builds ~50 organisations, ~200 agents, ~100
 * data products and ~2,000 questions in a throwaway database, then times the
 * queries behind the four heaviest screens *through the tenancy extension*,
 * which is the part most likely to turn a cheap query into an expensive one.
 *
 * Budgets are deliberately loose. The purpose is to catch the class of change
 * that turns a scan of one tenant into a scan of the table — an N+1 in the
 * marketplace, a missing `organizationId` index — not to police milliseconds.
 *
 *   pnpm perf
 */
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const DB_FILE = "perf.db";

process.env.DATABASE_URL = `file:./${DB_FILE}`;
process.env.ANALYTICS_DRIVER = "noop";

const ORGS = 50;
const PRODUCTS_PER_ORG = 2;
const METRICS_PER_PRODUCT = 3;
const PERSONAS_PER_ORG = 2;
const AGENTS_PER_ORG = 4;
const QUESTIONS_PER_AGENT = 10;
const AUDIT_EVENTS_PER_ORG = 40;

/** Budgets in milliseconds, measured as the p95 over the sampled runs. */
const BUDGETS: Record<string, number> = {
  "marketplace listing (persona lens)": 600,
  "agent detail (bindings, questions, coverage)": 350,
  "data product detail (the inversion)": 350,
  "audit trail page (50 events)": 200,
  "coverage matrix": 350,
};

type Timing = { name: string; p50: number; p95: number; budget: number; rows: number };

async function main(): Promise<void> {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(path.join(ROOT, "prisma", `${DB_FILE}${suffix}`), { force: true });
  }
  execSync("pnpm prisma migrate deploy", {
    cwd: ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });

  // Imported after DATABASE_URL is set: the client reads it at construction.
  const { PrismaClient } = await import("@prisma/client");
  const { withOrg } = await import("../src/lib/db/scope");

  const raw = new PrismaClient();
  const started = Date.now();
  const target = await generate(raw);
  const [orgs, agents, products, questions, heaviest] = await Promise.all([
    raw.organization.count(),
    raw.agent.count(),
    raw.dataProduct.count(),
    raw.question.count(),
    raw.agent.count({ where: { organizationId: target.organizationId } }),
  ]);
  console.info(
    `Generated ${orgs} organisations, ${agents} agents, ${products} products, ` +
      `${questions} questions in ${((Date.now() - started) / 1000).toFixed(1)}s — ` +
      `the measured tenant holds ${heaviest} of those agents.\n`,
  );

  const timings: Timing[] = [];

  timings.push(
    await time("marketplace listing (persona lens)", () =>
      withOrg(target.organizationId, (db) =>
        db.agent.findMany({
          where: { archivedAt: null, status: { in: ["PUBLISHED", "DEPRECATED", "IN_PROGRESS"] } },
          orderBy: { name: "asc" },
          select: {
            id: true,
            slug: true,
            name: true,
            summary: true,
            certification: true,
            questions: {
              where: { archivedAt: null },
              select: { id: true, personaId: true, coverage: { select: { id: true } } },
            },
            bindings: {
              where: { archivedAt: null },
              select: {
                status: true,
                dataProduct: { select: { name: true, qualityScore: true } },
              },
            },
          },
        }),
      ),
    ),
  );

  timings.push(
    await time("agent detail (bindings, questions, coverage)", () =>
      withOrg(target.organizationId, (db) =>
        db.agent.findMany({
          where: { id: target.agentId },
          select: {
            id: true,
            name: true,
            questions: {
              where: { archivedAt: null },
              select: {
                id: true,
                text: true,
                persona: { select: { name: true } },
                coverage: {
                  select: {
                    binding: { select: { bindingType: true, dataProduct: { select: { name: true } } } },
                    certifiedMetric: { select: { key: true, name: true } },
                  },
                },
              },
            },
            bindings: {
              where: { archivedAt: null },
              select: {
                id: true,
                status: true,
                bindingType: true,
                currentVersion: { select: { boundContractVersion: true, purpose: true } },
                dataProduct: { select: { name: true, contractVersion: true, qualityScore: true } },
              },
            },
          },
        }),
      ),
    ),
  );

  timings.push(
    await time("data product detail (the inversion)", () =>
      withOrg(target.organizationId, (db) =>
        db.dataProduct.findMany({
          where: { id: target.dataProductId },
          select: {
            id: true,
            name: true,
            metrics: {
              where: { archivedAt: null },
              select: {
                id: true,
                key: true,
                coverage: { select: { question: { select: { id: true, text: true } } } },
              },
            },
            bindings: {
              where: { archivedAt: null },
              select: {
                id: true,
                status: true,
                bindingType: true,
                currentVersion: { select: { boundContractMajor: true } },
                agent: { select: { id: true, slug: true, name: true, certification: true } },
              },
            },
          },
        }),
      ),
    ),
  );

  timings.push(
    await time("audit trail page (50 events)", () =>
      withOrg(target.organizationId, (db) =>
        db.auditEvent.findMany({
          orderBy: { sequence: "desc" },
          take: 50,
          select: { id: true, type: true, subjectType: true, subjectId: true, createdAt: true },
        }),
      ),
    ),
  );

  timings.push(
    await time("coverage matrix", () =>
      withOrg(target.organizationId, (db) =>
        db.question.findMany({
          where: { agentId: target.agentId, archivedAt: null },
          select: {
            id: true,
            text: true,
            intentClass: true,
            coverage: {
              select: {
                bindingId: true,
                certifiedMetric: { select: { key: true } },
              },
            },
          },
        }),
      ),
    ),
  );

  report(timings);

  // A leak at scale is worse than a slow query, so the same run checks it.
  const leaked = await withOrg(target.otherOrganizationId, (db) =>
    db.agent.count({ where: { id: target.agentId } }),
  );
  if (leaked !== 0) {
    console.error("\nFAIL: an agent was visible from another organisation.");
    process.exitCode = 1;
  } else {
    console.info("Tenant isolation holds at this scale (cross-org lookup returned nothing).");
  }

  await raw.$disconnect();

  const over = timings.filter((t) => t.p95 > t.budget);
  if (over.length > 0) {
    console.error(`\nFAIL: ${over.length} query/queries over budget.`);
    process.exitCode = 1;
  }
}

/** Builds the dataset with the raw client — generation is a system operation. */
async function generate(raw: InstanceType<typeof import("@prisma/client").PrismaClient>) {
  let targetOrganizationId = "";
  let otherOrganizationId = "";
  let targetAgentId = "";
  let targetDataProductId = "";

  for (let o = 0; o < ORGS; o += 1) {
    const org = await raw.organization.create({
      data: { slug: `perf-org-${o}`, name: `Perf Org ${o}`, planTier: "TEAM" },
      select: { id: true },
    });
    const workspace = await raw.workspace.create({
      data: { organizationId: org.id, slug: "main", name: "Main" },
      select: { id: true },
    });

    const productIds: string[] = [];
    for (let p = 0; p < PRODUCTS_PER_ORG; p += 1) {
      const product = await raw.dataProduct.create({
        data: {
          organizationId: org.id,
          workspaceId: workspace.id,
          key: `product-${p}`,
          name: `Product ${p}`,
          description: "Generated for the performance tripwire.",
          ownerName: "Perf Owner",
          contractVersion: "2.1.0",
          contractMajor: 2,
          contractMinor: 1,
          contractPatch: 0,
          semanticModelVersion: "2.1.0",
          qualityScore: 90 + p,
        },
        select: { id: true },
      });
      productIds.push(product.id);

      await raw.certifiedMetric.createMany({
        data: Array.from({ length: METRICS_PER_PRODUCT }, (_, m) => ({
          organizationId: org.id,
          dataProductId: product.id,
          key: `metric_${p}_${m}`,
          name: `Metric ${p}.${m}`,
          definition: "Generated metric.",
          grain: "customer / month",
          semanticRef: `semantic.model.metric_${p}_${m}`,
          certifiedAt: new Date(),
        })),
      });
    }

    const metrics = await raw.certifiedMetric.findMany({
      where: { organizationId: org.id },
      select: { id: true, dataProductId: true },
    });

    const personaIds: string[] = [];
    for (let s = 0; s < PERSONAS_PER_ORG; s += 1) {
      const persona = await raw.persona.create({
        data: {
          organizationId: org.id,
          workspaceId: workspace.id,
          key: `persona-${s}`,
          name: `Persona ${s}`,
          ownedDecisions: "Generated.",
          cadence: "weekly",
          currentWorkaround: "A spreadsheet.",
        },
        select: { id: true },
      });
      personaIds.push(persona.id);
    }

    // The first tenant is the heavy one. A per-tenant query is only interesting
    // when one tenant holds a disproportionate share of the rows — that is the
    // customer whose marketplace page gets slow first.
    const agentsHere = o === 0 ? AGENTS_PER_ORG * 10 : AGENTS_PER_ORG;
    for (let a = 0; a < agentsHere; a += 1) {
      const agent = await raw.agent.create({
        data: {
          organizationId: org.id,
          workspaceId: workspace.id,
          slug: `agent-${a}`,
          name: `Agent ${a}`,
          summary: "Generated for the performance tripwire.",
          currentStageId: "8-publish-operate",
          status: "PUBLISHED",
          certification: a % 3 === 0 ? "PEER_CERTIFIED" : "SELF_ATTESTED",
        },
        select: { id: true },
      });

      const dataProductId = productIds[a % productIds.length];
      const binding = await raw.binding.create({
        data: {
          organizationId: org.id,
          agentId: agent.id,
          dataProductId,
          bindingType: "GROUNDS_ON",
          status: "APPROVED",
        },
        select: { id: true },
      });
      const version = await raw.bindingVersion.create({
        data: {
          organizationId: org.id,
          bindingId: binding.id,
          versionNumber: 1,
          type: "GROUNDS_ON",
          purpose: "Grounds the generated agent on the generated product.",
          boundContractVersion: "2.1.0",
          boundContractMajor: 2,
          boundSemanticModelVersion: "2.1.0",
          contentHash: `perf-${org.id}-${agent.id}`,
          validationReport: "{}",
        },
        select: { id: true },
      });
      await raw.binding.update({
        where: { id: binding.id },
        data: { currentVersionId: version.id },
      });

      const productMetrics = metrics.filter((m) => m.dataProductId === dataProductId);

      for (let q = 0; q < QUESTIONS_PER_AGENT; q += 1) {
        const question = await raw.question.create({
          data: {
            organizationId: org.id,
            agentId: agent.id,
            personaId: personaIds[q % personaIds.length],
            text: `Generated question ${q} for agent ${a}?`,
            intentClass: "trend",
            consequenceOfNoAnswer: "The decision waits a week.",
            expectedAnswerShape: "A number with a trend.",
          },
          select: { id: true },
        });
        await raw.questionCoverage.create({
          data: {
            organizationId: org.id,
            questionId: question.id,
            bindingId: binding.id,
            certifiedMetricId: productMetrics[q % productMetrics.length].id,
          },
        });
      }

      if (o === 0 && a === 0) {
        targetAgentId = agent.id;
        targetDataProductId = dataProductId;
      }
    }

    await raw.auditEvent.createMany({
      data: Array.from({ length: AUDIT_EVENTS_PER_ORG }, (_, e) => ({
        organizationId: org.id,
        sequence: e + 1,
        type: "PERF_GENERATED",
        subjectType: "Agent",
        subjectId: targetAgentId || "generated",
        payload: "{}",
        hash: `perf-hash-${o}-${e}`,
      })),
    });

    if (o === 0) targetOrganizationId = org.id;
    if (o === 1) otherOrganizationId = org.id;
  }

  return {
    organizationId: targetOrganizationId,
    otherOrganizationId,
    agentId: targetAgentId,
    dataProductId: targetDataProductId,
  };
}

async function time(name: string, run: () => Promise<unknown>): Promise<Timing> {
  // One warm-up: the first query pays for the connection, not the query plan.
  const warm = await run();
  const rows = Array.isArray(warm) ? warm.length : 1;

  const samples: number[] = [];
  for (let i = 0; i < 20; i += 1) {
    const started = process.hrtime.bigint();
    await run();
    samples.push(Number(process.hrtime.bigint() - started) / 1_000_000);
  }
  samples.sort((a, b) => a - b);

  return {
    name,
    rows,
    p50: samples[Math.floor(samples.length * 0.5)],
    p95: samples[Math.floor(samples.length * 0.95)],
    budget: BUDGETS[name] ?? Number.POSITIVE_INFINITY,
  };
}

function report(timings: Timing[]): void {
  const width = Math.max(...timings.map((t) => t.name.length));
  console.info("query".padEnd(width), " rows    p50      p95    budget");
  for (const t of timings) {
    const verdict = t.p95 > t.budget ? "OVER" : "ok";
    console.info(
      t.name.padEnd(width),
      String(t.rows).padStart(5),
      `${t.p50.toFixed(1)}ms`.padStart(8),
      `${t.p95.toFixed(1)}ms`.padStart(8),
      `${t.budget}ms`.padStart(8),
      verdict,
    );
  }
  console.info("");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
