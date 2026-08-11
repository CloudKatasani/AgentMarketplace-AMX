import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { bumpContractVersion } from "@/lib/data-products/version-bump";
import { assembleEvidencePack } from "@/lib/evidence/pack";
import { renderPackDocx, renderPackPdf } from "@/lib/evidence/render";
import { toMermaid } from "@/lib/graph/binding-graph";
import { walkToPublished } from "@/lib/seed/showcase";

import { addMember, inOrg, makeOrg, type TestOrg } from "./helpers";

/**
 * The seven-minute demo arc, as a test.
 *
 * CLAUDE.md principle 2: demo mode is a first-class feature and cannot be
 * broken by a product change without a failing test. This walks the arc the
 * sales script walks — persona lens → question trace → binding graph → the
 * STALE flip → the evidence pack — using the *same* `walkToPublished` the
 * showcase seed uses, so the demo cannot drift from the product.
 */

let org: TestOrg;
let productOwnerId: string;
let dataOwnerId: string;
let governanceId: string;

beforeAll(async () => {
  org = await makeOrg({ ownerRoles: ["agent-builder"] });
  productOwnerId = await addMember(org.organizationId, ["agent-product-owner"]);
  dataOwnerId = await addMember(org.organizationId, ["data-product-owner"]);
  governanceId = await addMember(org.organizationId, ["governance-officer"]);

  const agent = await inOrg(org.organizationId, () =>
    db.agent.findUnique({ where: { id: org.agentId }, select: { slug: true } }),
  );

  const walk = await inOrg(org.organizationId, () =>
    walkToPublished(db, {
      organizationId: org.organizationId,
      agentId: org.agentId,
      agentSlug: agent!.slug,
      builderId: org.ownerUserId,
      productOwnerId,
      dataOwnerId,
      governanceId,
    }),
  );

  expect(
    walk.ok,
    `The showcase walk stopped at ${walk.failedAt}: ${walk.detail}. The demo arc is broken.`,
  ).toBe(true);
}, 120_000);

describe("0:30 — the agent is published and peer-certified", () => {
  it("reaches Stage 8 through the real gate engine", async () => {
    const agent = await inOrg(org.organizationId, () =>
      db.agent.findUnique({
        where: { id: org.agentId },
        select: { status: true, certification: true, currentStageId: true, sensitivity: true },
      }),
    );

    expect(agent).toMatchObject({
      status: "PUBLISHED",
      certification: "PEER_CERTIFIED",
      currentStageId: "8-publish-and-operate",
      sensitivity: "CONFIDENTIAL",
    });
  });

  it("has all eight gates approved, none self-attested", async () => {
    const gates = await inOrg(org.organizationId, () =>
      db.gate.findMany({
        where: { agentId: org.agentId },
        select: { stageId: true, status: true, mode: true },
      }),
    );

    expect(gates).toHaveLength(8);
    expect(gates.every((gate) => gate.status === "APPROVED")).toBe(true);
    expect(gates.every((gate) => gate.mode === "PEER")).toBe(true);
  });

  it("committed all nine artifacts", async () => {
    const artifacts = await inOrg(org.organizationId, () =>
      db.artifact.findMany({
        where: { agentId: org.agentId },
        select: { kind: true, currentVersionId: true },
      }),
    );
    expect(artifacts.filter((a) => a.currentVersionId)).toHaveLength(9);
  });
});

describe("1:00 — the persona lens", () => {
  it("ranks the agent for the persona whose questions it answers", async () => {
    const persona = await inOrg(org.organizationId, () =>
      db.persona.findFirst({
        where: { key: "revenue-assurance-analyst" },
        select: { id: true, name: true },
      }),
    );
    expect(persona?.name).toBe("Revenue Assurance Analyst");

    const questions = await inOrg(org.organizationId, () =>
      db.question.findMany({
        where: { agentId: org.agentId, personaId: persona!.id, archivedAt: null },
        select: { id: true, coverage: { select: { id: true } } },
      }),
    );

    expect(questions.length).toBeGreaterThanOrEqual(3);
    // 100% coverage for this persona — which is what puts it top of the lens.
    expect(questions.every((question) => question.coverage.length > 0)).toBe(true);
  });
});

describe("1:30 — the question trace", () => {
  it("resolves every question to a certified metric on a named product", async () => {
    const rows = await inOrg(org.organizationId, () =>
      db.questionCoverage.findMany({
        where: { question: { agentId: org.agentId } },
        select: {
          question: { select: { text: true } },
          certifiedMetric: { select: { key: true, certifiedAt: true } },
          binding: { select: { dataProduct: { select: { name: true } } } },
        },
      }),
    );

    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row.certifiedMetric, `"${row.question.text}" has no metric`).not.toBeNull();
      expect(row.certifiedMetric!.certifiedAt).not.toBeNull();
      expect(row.binding.dataProduct.name).toBeTruthy();
    }
  });
});

describe("2:30 — the binding graph and the product inversion", () => {
  it("renders a graph naming the product, its contract, and its metrics", async () => {
    const bindings = await inOrg(org.organizationId, () =>
      db.binding.findMany({
        where: { agentId: org.agentId, archivedAt: null },
        select: {
          id: true,
          bindingType: true,
          dataProduct: { select: { id: true, name: true, contractVersion: true } },
          currentVersion: {
            select: { metrics: { select: { certifiedMetric: { select: { id: true, key: true } } } } },
          },
        },
      }),
    );

    const mermaid = toMermaid({
      agentName: "Customer Churn Advisor",
      personas: [],
      questions: [],
      bindings: bindings.map((b) => ({
        id: b.id,
        type: b.bindingType as never,
        productId: b.dataProduct.id,
      })),
      products: bindings.map((b) => ({
        id: b.dataProduct.id,
        name: b.dataProduct.name,
        contractVersion: b.dataProduct.contractVersion,
      })),
      metrics: bindings.flatMap((b) =>
        (b.currentVersion?.metrics ?? []).map((m) => ({
          id: m.certifiedMetric.id,
          key: m.certifiedMetric.key,
          productId: b.dataProduct.id,
        })),
      ),
      coverage: [],
    });

    expect(mermaid).toContain("Customer 360");
    expect(mermaid).toContain("contract 2.1.0");
    expect(mermaid).toContain("residential_churn_rate");
  });

  it("inverts: from the product, every agent standing on it", async () => {
    const product = await inOrg(org.organizationId, () =>
      db.dataProduct.findFirst({
        where: { key: "customer-360" },
        select: { bindings: { select: { agent: { select: { id: true, name: true } } } } },
      }),
    );
    expect(product!.bindings.map((b) => b.agent.id)).toContain(org.agentId);
  });
});

describe("4:00 — the money moment: the STALE flip", () => {
  it("flips a peer-certified agent to STALE the instant the contract breaks", async () => {
    const product = await inOrg(org.organizationId, () =>
      db.dataProduct.findFirst({ where: { key: "customer-360" }, select: { id: true } }),
    );

    const before = await inOrg(org.organizationId, () =>
      db.agent.findUnique({ where: { id: org.agentId }, select: { certification: true } }),
    );
    expect(before?.certification).toBe("PEER_CERTIFIED");

    const result = await inOrg(org.organizationId, () =>
      bumpContractVersion(db, {
        organizationId: org.organizationId,
        dataProductId: product!.id,
        contractVersion: "3.0.0",
        changeSummary: "Removed the legacy premise identifier.",
        actorUserId: dataOwnerId,
      }),
    );
    expect(result.ok).toBe(true);

    // Synchronous: no worker, no polling. The banner is there on the next render.
    const after = await inOrg(org.organizationId, () =>
      db.agent.findUnique({
        where: { id: org.agentId },
        select: { certification: true, staleReason: true },
      }),
    );
    expect(after?.certification).toBe("STALE");
    expect(after?.staleReason).toContain("2.1.0");
    expect(after?.staleReason).toContain("3.0.0");

    const tasks = await inOrg(org.organizationId, () =>
      db.task.findMany({
        where: { agentId: org.agentId, kind: "RE_CERTIFICATION", status: "OPEN" },
        select: { assigneeRoleId: true },
      }),
    );
    expect(tasks.map((t) => t.assigneeRoleId).sort()).toEqual([
      "data-product-owner",
      "governance-officer",
    ]);

    // Stage 3's approval no longer describes reality either.
    const stageThree = await inOrg(org.organizationId, () =>
      db.gate.findFirst({
        where: { agentId: org.agentId, stageId: "3-data-product-binding" },
        orderBy: { round: "desc" },
        select: { status: true },
      }),
    );
    expect(stageThree?.status).toBe("STALE");
  });
});

describe("5:30 — the evidence pack", () => {
  it("assembles from committed versions, with a verifiable manifest", async () => {
    const pack = await inOrg(org.organizationId, () =>
      assembleEvidencePack(db, org.organizationId, org.agentId),
    );

    expect(pack).not.toBeNull();
    expect(pack!.certificationBasis).toBe("not certified"); // it went STALE a moment ago
    expect(pack!.artifacts).toHaveLength(9);
    expect(pack!.approvals.length).toBeGreaterThanOrEqual(14);
    expect(pack!.coverage.isComplete).toBe(true);
    expect(pack!.scorecard?.scores.length).toBeGreaterThan(0);

    // The manifest is what makes the pack checkable rather than merely readable.
    expect(pack!.manifest.auditChainVerified).toBe(true);
    expect(pack!.manifest.artifactHashes).toHaveLength(9);
    expect(pack!.manifest.auditChainHead).toBeTruthy();
    expect(pack!.manifest.packHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records how each gate was approved, not merely that it was", async () => {
    const pack = await inOrg(org.organizationId, () =>
      assembleEvidencePack(db, org.organizationId, org.agentId),
    );
    expect(pack!.approvals.every((approval) => approval.isSelfAttestation === false)).toBe(true);
    expect(pack!.approvals.some((approval) => approval.stageName === "Certification (DATSIS+V)")).toBe(
      true,
    );
  });

  it("renders a PDF and a Word document", async () => {
    const pack = await inOrg(org.organizationId, () =>
      assembleEvidencePack(db, org.organizationId, org.agentId),
    );

    const pdf = await renderPackPdf(pack!);
    expect(pdf.byteLength).toBeGreaterThan(2_000);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");

    const docx = await renderPackDocx(pack!);
    expect(docx.byteLength).toBeGreaterThan(5_000);
    // A .docx is a zip: "PK".
    expect(Buffer.from(docx.slice(0, 2)).toString()).toBe("PK");
  }, 60_000);
});

describe("7:00 — the showcase tenant is read-only", () => {
  it("refuses every mutation once the tenant is marked read-only", async () => {
    const showcase = await makeOrg({ ownerRoles: ["agent-builder", "agent-product-owner"] });
    await inOrg(showcase.organizationId, () =>
      db.organization.update({
        where: { id: showcase.organizationId },
        data: { isReadOnly: true, isShowcase: true },
      }),
    );

    const { requestTransition } = await import("@/lib/gates");
    const result = await inOrg(showcase.organizationId, () =>
      requestTransition(db, {
        organizationId: showcase.organizationId,
        agentId: showcase.agentId,
        stageId: "1-consumption-discovery",
        actorUserId: showcase.ownerUserId,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "NOT_PERMITTED") return;
    expect(result.detail).toContain("live demo workspace");
  });
});
