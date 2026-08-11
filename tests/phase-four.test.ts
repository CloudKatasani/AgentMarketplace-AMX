import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { proposeBindings, proposeQuestions, proposeAdversarialProbes, critiqueAgainstCriteria, assistDriver } from "@/lib/ai/assist";
import { academyPaths, completeModule, loadPathProgress, assertCredentialForRole } from "@/lib/academy";
import { countCertifiedAgents, createMemoryDriver, upgradePromptFor } from "@/lib/billing";
import { db } from "@/lib/db";
import { buildExport } from "@/lib/exports";
import { loadAllPacks, loadPack, packKeys } from "@/lib/packs/load";
import { packSchema, validatePackReferences } from "@/lib/packs/schema";
import { PLAN_FEATURES } from "@/lib/plans/features";

import { addMember, inOrg, makeOrg } from "./helpers";

// ───────────────────────────── Packs ─────────────────────────────

describe("industry packs", () => {
  it("ships the generic pack plus seven industries", () => {
    const keys = packKeys();
    expect(keys).toContain("_generic");
    expect(keys).toContain("utilities");
    expect(keys.length).toBeGreaterThanOrEqual(8);
  });

  it("every pack on disk validates", () => {
    const { loaded, failed } = loadAllPacks();
    expect(
      failed.map((f) => (f.ok ? "" : `${f.key}: ${f.issues[0]?.message}`)),
      "A malformed pack should fail the build, not a customer's first workspace.",
    ).toEqual([]);
    expect(loaded.length).toBeGreaterThanOrEqual(8);
  });

  it("no pack ships a data product an agent could never bind to", () => {
    for (const pack of loadAllPacks().loaded) {
      for (const product of pack.dataProducts) {
        expect(
          ["GOLD", "PLATINUM", "SEMANTIC"],
          `${pack.key}/${product.key} is served from ${product.layer}`,
        ).toContain(product.layer);
        for (const metric of product.metrics) {
          expect(/^(bronze|silver|raw|stg)[._]/i.test(metric.semanticRef)).toBe(false);
        }
      }
    }
  });

  it("every starter agent's questions are answerable by its own bindings", () => {
    for (const pack of loadAllPacks().loaded) {
      expect(validatePackReferences(pack), `pack ${pack.key}`).toEqual([]);
    }
  });

  it("catches a starter agent pointing at a question that does not exist", () => {
    const base = loadPack("_generic");
    expect(base.ok).toBe(true);
    if (!base.ok) return;

    const broken = packSchema.parse({
      ...base.pack,
      starterAgents: [
        { ...base.pack.starterAgents[0], questionKeys: ["q-does-not-exist", "q-nope", "q-neither"] },
      ],
    });
    const issues = validatePackReferences(broken);
    expect(issues.some((i) => i.message.includes("coverage gap"))).toBe(true);
  });

  it("catches a QUERIES binding with no metric before it ever reaches the validator", () => {
    const base = loadPack("utilities");
    if (!base.ok) return;

    const broken = packSchema.parse({
      ...base.pack,
      starterAgents: [
        {
          ...base.pack.starterAgents[0],
          bindings: [
            { dataProductKey: "customer-360", type: "QUERIES", purpose: "Reads the numbers.", metricKeys: [] },
          ],
        },
      ],
    });
    const issues = validatePackReferences(broken);
    expect(issues.some((i) => i.message.includes("names no metric"))).toBe(true);
  });

  it("seeds a workspace in the chosen industry's vocabulary", async () => {
    const banking = await makeOrg({ packKey: "banking" });

    const products = await inOrg(banking.organizationId, () =>
      db.dataProduct.findMany({ select: { key: true } }),
    );
    expect(products.map((p) => p.key)).toContain("credit-risk-360");

    const personas = await inOrg(banking.organizationId, () =>
      db.persona.findMany({ select: { key: true } }),
    );
    expect(personas.map((p) => p.key)).toContain("credit-risk-analyst");
  });

  it("seeds a starter agent with complete coverage on day one", async () => {
    const telecom = await makeOrg({ packKey: "telecom" });

    const questions = await inOrg(telecom.organizationId, () =>
      db.question.findMany({
        where: { agentId: telecom.agentId },
        select: { id: true, coverage: { select: { id: true } } },
      }),
    );
    expect(questions.length).toBeGreaterThanOrEqual(3);
    expect(questions.every((q) => q.coverage.length > 0)).toBe(true);
  });
});

// ───────────────────────────── Academy ─────────────────────────────

describe("the academy", () => {
  it("ships five role paths", () => {
    const { paths } = academyPaths("_generic");
    expect(paths).toHaveLength(5);
    expect(paths.map((p) => p.roleKey)).toContain("governance-officer");
  });

  it("every lab points at a live object rather than a screenshot", () => {
    for (const pack of loadAllPacks().loaded) {
      for (const path of pack.academy) {
        for (const course of path.courses) {
          for (const module of course.modules) {
            if (!module.lab) continue;
            expect(
              ["agent", "data-product", "coverage-matrix", "audit", "evidence-pack"],
            ).toContain(module.lab.target);
          }
        }
      }
    }
  });

  it("refuses a near-miss on an assessment", async () => {
    const org = await makeOrg();
    const { paths } = academyPaths("utilities");
    const path = paths.find((p) => p.key === "governance-officer")!;
    const course = path.courses[0];
    const module = course.modules[0];

    const result = await inOrg(org.organizationId, () =>
      completeModule(db, {
        organizationId: org.organizationId,
        userId: org.ownerUserId,
        packKey: "utilities",
        pathKey: path.key,
        courseKey: course.key,
        moduleKey: module.key,
        // First right, second wrong.
        answers: [module.assessment[0].correctIndex, (module.assessment[1].correctIndex + 1) % 2],
      }),
    );

    expect(result?.passed).toBe(false);
    expect(result?.credentialAwarded).toBeNull();
  });

  it("awards a credential — as an audit event — when a path is finished", async () => {
    const org = await makeOrg();
    const { paths } = academyPaths("utilities");
    const path = paths.find((p) => p.key === "governance-officer")!;

    let awarded: string | null = null;
    for (const course of path.courses) {
      for (const module of course.modules) {
        const result = await inOrg(org.organizationId, () =>
          completeModule(db, {
            organizationId: org.organizationId,
            userId: org.ownerUserId,
            packKey: "utilities",
            pathKey: path.key,
            courseKey: course.key,
            moduleKey: module.key,
            answers: module.assessment.map((item) => item.correctIndex),
          }),
        );
        awarded = result?.credentialAwarded ?? awarded;
      }
    }

    expect(awarded).toBe("governance-officer-credential");

    const [credential, event] = await inOrg(org.organizationId, async () => [
      await db.credential.findFirst({ where: { userId: org.ownerUserId } }),
      await db.auditEvent.findFirst({ where: { type: "academy.credential-awarded" } }),
    ]);
    expect(credential?.credentialKey).toBe("governance-officer-credential");
    expect(event).not.toBeNull();
    expect(credential?.auditEventId).toBe(event!.id);

    const progress = await inOrg(org.organizationId, () =>
      loadPathProgress(db, {
        organizationId: org.organizationId,
        userId: org.ownerUserId,
        packKey: "utilities",
      }),
    );
    expect(progress.find((p) => p.path.key === path.key)?.credentialHeld).toBe(true);
  });

  it("does not gate approver roles unless the organisation asks for it", async () => {
    const org = await makeOrg();
    const gate = await inOrg(org.organizationId, () =>
      assertCredentialForRole(db, {
        organizationId: org.organizationId,
        userId: org.ownerUserId,
        roleKey: "governance-officer",
      }),
    );
    expect(gate.ok).toBe(true);
  });

  it("blocks an uncredentialled approver once the organisation requires it", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder"] });
    const governance = await addMember(org.organizationId, ["governance-officer"]);

    await inOrg(org.organizationId, () =>
      db.organization.update({
        where: { id: org.organizationId },
        data: { requireApproverCredentials: true },
      }),
    );

    const gate = await inOrg(org.organizationId, () =>
      assertCredentialForRole(db, {
        organizationId: org.organizationId,
        userId: governance,
        roleKey: "governance-officer",
      }),
    );

    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.detail).toContain("Academy");
  });

  it("only gates roles that actually name a credential", async () => {
    const org = await makeOrg();
    await inOrg(org.organizationId, () =>
      db.organization.update({
        where: { id: org.organizationId },
        data: { requireApproverCredentials: true },
      }),
    );

    // agent-product-owner names no required credential.
    const gate = await inOrg(org.organizationId, () =>
      assertCredentialForRole(db, {
        organizationId: org.organizationId,
        userId: org.ownerUserId,
        roleKey: "agent-product-owner",
      }),
    );
    expect(gate.ok).toBe(true);
  });
});

// ───────────────────────────── Exports ─────────────────────────────

describe("exports", () => {
  it("builds a question catalogue with a coverage summary", async () => {
    const org = await makeOrg();
    const result = await inOrg(org.organizationId, () =>
      buildExport(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        format: "question-catalog-xlsx",
      }),
    );

    expect(result?.filename).toContain(".xlsx");
    // An .xlsx is a zip with two named sheets in it.
    const zip = await JSZip.loadAsync(Buffer.from(result!.bytes));
    const workbook = await zip.file("xl/workbook.xml")?.async("string");
    expect(workbook).toContain("Questions");
    expect(workbook).toContain("Coverage summary");
  }, 30_000);

  it("exports the binding graph as Mermaid and SVG", async () => {
    const org = await makeOrg();
    const mermaid = await inOrg(org.organizationId, () =>
      buildExport(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        format: "binding-graph-mmd",
      }),
    );
    expect(Buffer.from(mermaid!.bytes).toString()).toContain("flowchart LR");

    const svg = await inOrg(org.organizationId, () =>
      buildExport(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        format: "binding-graph-svg",
      }),
    );
    expect(Buffer.from(svg!.bytes).toString().startsWith("<svg")).toBe(true);
  });

  it("bundles everything, with a manifest", async () => {
    const org = await makeOrg();
    const result = await inOrg(org.organizationId, () =>
      buildExport(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        format: "agent-bundle-zip",
      }),
    );

    const zip = await JSZip.loadAsync(Buffer.from(result!.bytes));
    const names = Object.keys(zip.files);
    expect(names).toContain("question-catalog.xlsx");
    expect(names).toContain("binding-graph.mmd");
    expect(names).toContain("evidence-pack.pdf");
    expect(names).toContain("manifest.json");
    expect(names.some((n) => n.startsWith("artifacts/"))).toBe(true);

    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.packHash).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);
});

// ───────────────────────────── Billing ─────────────────────────────

describe("billing and upgrade prompts", () => {
  it("meters certified agents, not seats", () => {
    expect(
      countCertifiedAgents([
        { certification: "PEER_CERTIFIED", status: "PUBLISHED" },
        { certification: "SELF_ATTESTED", status: "PUBLISHED" },
        { certification: "NONE", status: "IN_PROGRESS" },
        { certification: "STALE", status: "PUBLISHED" },
        { certification: "PEER_CERTIFIED", status: "RETIRED" },
      ]),
    ).toBe(2);
  });

  it("says nothing until a capability actually ends", () => {
    expect(upgradePromptFor({ planTier: "FREE", action: "create-agent", currentCount: 1 })).toBeNull();
    expect(upgradePromptFor({ planTier: "TEAM", action: "bulk-export" })).toBeNull();
    expect(upgradePromptFor({ planTier: "ENTERPRISE", action: "white-label" })).toBeNull();
  });

  it("prompts at the boundary, naming what was blocked", () => {
    const prompt = upgradePromptFor({
      planTier: "FREE",
      action: "create-agent",
      currentCount: PLAN_FEATURES.FREE.maxAgents,
    });
    expect(prompt?.upgradeTo).toBe("TEAM");
    expect(prompt?.blockedAction).toBe("chartering another agent");
  });

  it("never offers to sell solo attestation back to a Free-tier user", () => {
    const prompt = upgradePromptFor({ planTier: "FREE", action: "peer-review" });
    expect(prompt?.reason).toContain("available on every plan");
  });

  it("runs a full upgrade through the in-memory driver", async () => {
    const driver = createMemoryDriver();
    expect(await driver.getSubscription("org_1")).toBeNull();

    const session = await driver.createCheckoutSession({
      organizationId: "org_1",
      tier: "TEAM",
      returnUrl: "https://example.test/settings",
    });
    expect(session.url).toContain("checkout=");

    await driver.reportUsage({ organizationId: "org_1", certifiedAgents: 4 });
    const subscription = await driver.getSubscription("org_1");
    expect(subscription).toMatchObject({ tier: "TEAM", certifiedAgents: 4 });
  });
});

// ───────────────────────────── AI assist ─────────────────────────────

describe("AI assist", () => {
  it("is off unless configured", () => {
    const previous = process.env.AMX_AI_DRIVER;
    delete process.env.AMX_AI_DRIVER;
    expect(assistDriver().enabled).toBe(false);
    if (previous) process.env.AMX_AI_DRIVER = previous;
  });

  it("drafts question shapes without inventing the consequence", () => {
    const proposal = proposeQuestions({
      decision: "Which residential accounts get a retention offer",
      personaName: "Revenue Assurance Analyst",
    });

    expect(proposal.proposalOnly).toBe(true);
    expect(proposal.value.length).toBeGreaterThan(0);
    // A made-up consequence reads as if someone thought about it.
    expect(proposal.value.every((q) => q.consequenceOfNoAnswer === "")).toBe(true);
    expect(proposal.rationale).toContain("invented one reads as if");
  });

  it("matches uncovered questions to certified metrics", async () => {
    const org = await makeOrg();
    const persona = await inOrg(org.organizationId, () =>
      db.persona.findFirst({ select: { id: true } }),
    );

    await inOrg(org.organizationId, () =>
      db.question.create({
        data: {
          organizationId: org.organizationId,
          agentId: org.agentId,
          personaId: persona!.id,
          text: "What is the residential churn rate for the coastal segment?",
          intentClass: "lookup",
          consequenceOfNoAnswer: "The segment review runs on a guess.",
          expectedAnswerShape: "A churn rate with the comparison period",
        },
      }),
    );

    const proposal = await inOrg(org.organizationId, () => proposeBindings(db, org.agentId));

    expect(proposal.proposalOnly).toBe(true);
    expect(proposal.value.length).toBeGreaterThan(0);
    expect(proposal.value[0].metricKeys).toContain("residential_churn_rate");
    expect(proposal.rationale).toContain("Crude on purpose");
  });

  it("says so plainly when no metric matches", async () => {
    const org = await makeOrg();
    const persona = await inOrg(org.organizationId, () =>
      db.persona.findFirst({ select: { id: true } }),
    );

    await inOrg(org.organizationId, () =>
      db.question.create({
        data: {
          organizationId: org.organizationId,
          agentId: org.agentId,
          personaId: persona!.id,
          text: "Zzzz qqqq wwww vvvv?",
          intentClass: "lookup",
          consequenceOfNoAnswer: "Nothing sensible.",
          expectedAnswerShape: "Nothing",
        },
      }),
    );

    const proposal = await inOrg(org.organizationId, () => proposeBindings(db, org.agentId));
    expect(proposal.rationale).toContain("the metric does not exist yet");
  });

  it("builds probes from this agent's own boundary", () => {
    const proposal = proposeAdversarialProbes({
      outOfScope: ["Commercial and industrial accounts"],
      boundProductNames: ["Customer 360"],
    });
    expect(proposal.value.some((p) => p.question.includes("commercial and industrial"))).toBe(true);
    expect(proposal.value.some((p) => p.question.includes("Customer 360"))).toBe(true);
  });

  it("critiques against the stage's own criteria, so it cannot disagree with the gate", () => {
    const proposal = critiqueAgainstCriteria({
      criteria: [
        { key: "stage3.question-coverage-complete", label: "Coverage", satisfied: false, detail: "2 of 3." },
        { key: "stage3.has-binding", label: "Bindings", satisfied: true, detail: "1 binding." },
      ],
    });
    expect(proposal.value).toHaveLength(1);
    expect(proposal.value[0].suggestion).toContain("Map the uncovered questions");
  });
});
