import { describe, expect, it } from "vitest";

import { commitArtifact } from "@/lib/artifacts/commit";
import { bumpContractVersion } from "@/lib/data-products/version-bump";
import { db } from "@/lib/db";
import { recordDecision, requestTransition } from "@/lib/gates";

import { addMember, inOrg, makeOrg, type TestOrg } from "./helpers";

/**
 * Cascade invalidation, both directions.
 *
 * Direction 2 — a bound product bumping a major version — is the demo's money
 * moment, so it is tested for the things a buyer would check on stage: it
 * happens immediately, it says why in words, and it raises the work needed to
 * put it right.
 */

/** Walks an agent to an approved Stage 1 so there is an approval to invalidate. */
async function withApprovedStage1(): Promise<{ org: TestOrg; productOwnerId: string }> {
  const org = await makeOrg({ ownerRoles: ["agent-builder"] });
  const productOwnerId = await addMember(org.organizationId, ["agent-product-owner"]);

  await inOrg(org.organizationId, async () => {
    const opened = await requestTransition(db, {
      organizationId: org.organizationId,
      agentId: org.agentId,
      stageId: "1-consumption-discovery",
      actorUserId: org.ownerUserId,
    });
    if (!opened.ok) throw new Error("stage 1 gate did not open");
    await recordDecision(db, {
      organizationId: org.organizationId,
      gateId: opened.gateId,
      actorUserId: productOwnerId,
      roleKey: "agent-product-owner",
      decision: "APPROVE",
    });
  });

  return { org, productOwnerId };
}

describe("direction 1 · artifact re-version invalidates downstream gates", () => {
  it("flips an approved gate to STALE and raises a re-approval task", async () => {
    const { org } = await withApprovedStage1();

    const before = await inOrg(org.organizationId, () =>
      db.gate.findFirst({
        where: { agentId: org.agentId, stageId: "1-consumption-discovery" },
        select: { id: true, status: true },
      }),
    );
    expect(before?.status).toBe("APPROVED");

    await inOrg(org.organizationId, async () => {
      const artifact = await db.artifact.findFirst({
        where: { agentId: org.agentId, kind: "persona-question-register" },
        select: { currentVersion: { select: { content: true } } },
      });
      const content = JSON.parse(artifact!.currentVersion!.content) as {
        personas: { cadence: string }[];
      };
      content.personas[0].cadence = "Daily";

      await commitArtifact(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        stageId: "1-consumption-discovery",
        kind: "persona-question-register",
        content,
        authorUserId: org.ownerUserId,
      });
    });

    const after = await inOrg(org.organizationId, () =>
      db.gate.findUnique({
        where: { id: before!.id },
        select: { status: true, staleReason: true },
      }),
    );
    expect(after?.status).toBe("STALE");
    expect(after?.staleReason).toContain("persona question register");

    const tasks = await inOrg(org.organizationId, () =>
      db.task.findMany({ where: { agentId: org.agentId, kind: "RE_APPROVAL" } }),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].assigneeRoleId).toBe("agent-product-owner");
    // Every task must trace to the audit event that caused it.
    expect(tasks[0].causeEventId).toBeTruthy();
  });

  it("does not invalidate anything when the content is unchanged", async () => {
    const { org } = await withApprovedStage1();

    const result = await inOrg(org.organizationId, async () => {
      const artifact = await db.artifact.findFirst({
        where: { agentId: org.agentId, kind: "persona-question-register" },
        select: { currentVersion: { select: { content: true } } },
      });
      return commitArtifact(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        stageId: "1-consumption-discovery",
        kind: "persona-question-register",
        content: JSON.parse(artifact!.currentVersion!.content),
        authorUserId: org.ownerUserId,
      });
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unchanged).toBe(true);
    expect(result.staleGateIds).toEqual([]);

    const gate = await inOrg(org.organizationId, () =>
      db.gate.findFirst({
        where: { agentId: org.agentId, stageId: "1-consumption-discovery" },
        select: { status: true },
      }),
    );
    expect(gate?.status).toBe("APPROVED");
  });
});

describe("direction 2 · a bound product's major bump invalidates certifications", () => {
  async function certifiedAgent() {
    const org = await makeOrg({ ownerRoles: ["agent-builder"] });
    // Simulate a completed lifecycle: this test is about the cascade, not the walk.
    await inOrg(org.organizationId, () =>
      db.agent.update({
        where: { id: org.agentId },
        data: { certification: "PEER_CERTIFIED", status: "PUBLISHED" },
      }),
    );
    await inOrg(org.organizationId, () =>
      db.binding.updateMany({ where: { agentId: org.agentId }, data: { status: "APPROVED" } }),
    );
    const product = await inOrg(org.organizationId, () =>
      db.dataProduct.findFirst({ where: { key: "customer-360" }, select: { id: true } }),
    );
    return { org, productId: product!.id };
  }

  it("flips certification to STALE with a cause naming both versions", async () => {
    const { org, productId } = await certifiedAgent();

    const result = await inOrg(org.organizationId, () =>
      bumpContractVersion(db, {
        organizationId: org.organizationId,
        dataProductId: productId,
        contractVersion: "3.0.0",
        changeSummary: "Removed the legacy premise identifier.",
        actorUserId: org.ownerUserId,
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isMajorBump).toBe(true);
    expect(result.cascade.staleAgentIds).toContain(org.agentId);

    const agent = await inOrg(org.organizationId, () =>
      db.agent.findUnique({
        where: { id: org.agentId },
        select: { certification: true, staleReason: true, staleAt: true },
      }),
    );
    expect(agent?.certification).toBe("STALE");
    expect(agent?.staleReason).toContain("2.1.0");
    expect(agent?.staleReason).toContain("3.0.0");
    expect(agent?.staleAt).toBeTruthy();
  });

  it("marks the dependent bindings stale", async () => {
    const { org, productId } = await certifiedAgent();
    await inOrg(org.organizationId, () =>
      bumpContractVersion(db, {
        organizationId: org.organizationId,
        dataProductId: productId,
        contractVersion: "3.0.0",
        changeSummary: "Breaking change to the customer grain.",
        actorUserId: org.ownerUserId,
      }),
    );

    const bindings = await inOrg(org.organizationId, () =>
      db.binding.findMany({ where: { dataProductId: productId }, select: { status: true } }),
    );
    expect(bindings.length).toBeGreaterThan(0);
    expect(bindings.every((b) => b.status === "STALE")).toBe(true);
  });

  it("raises re-certification tasks for the data and governance owners", async () => {
    const { org, productId } = await certifiedAgent();
    await inOrg(org.organizationId, () =>
      bumpContractVersion(db, {
        organizationId: org.organizationId,
        dataProductId: productId,
        contractVersion: "3.0.0",
        changeSummary: "Breaking change.",
        actorUserId: org.ownerUserId,
      }),
    );

    const tasks = await inOrg(org.organizationId, () =>
      db.task.findMany({
        where: { agentId: org.agentId, kind: "RE_CERTIFICATION" },
        select: { assigneeRoleId: true, causeEventId: true },
      }),
    );
    expect(tasks.map((t) => t.assigneeRoleId).sort()).toEqual([
      "data-product-owner",
      "governance-officer",
    ]);
    expect(tasks.every((t) => t.causeEventId)).toBe(true);
  });

  it("writes a cascade audit event", async () => {
    const { org, productId } = await certifiedAgent();
    await inOrg(org.organizationId, () =>
      bumpContractVersion(db, {
        organizationId: org.organizationId,
        dataProductId: productId,
        contractVersion: "3.0.0",
        changeSummary: "Breaking change.",
        actorUserId: org.ownerUserId,
      }),
    );

    const event = await inOrg(org.organizationId, () =>
      db.auditEvent.findFirst({
        where: { type: "cascade.product-major-bump", subjectId: org.agentId },
      }),
    );
    expect(event).not.toBeNull();
    expect(event!.payload).toContain("Customer 360");
  });

  it("does NOT cascade on a minor bump", async () => {
    const { org, productId } = await certifiedAgent();

    const result = await inOrg(org.organizationId, () =>
      bumpContractVersion(db, {
        organizationId: org.organizationId,
        dataProductId: productId,
        contractVersion: "2.2.0",
        changeSummary: "Added an optional attribute.",
        actorUserId: org.ownerUserId,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isMajorBump).toBe(false);
    expect(result.cascade.staleAgentIds).toEqual([]);

    const agent = await inOrg(org.organizationId, () =>
      db.agent.findUnique({ where: { id: org.agentId }, select: { certification: true } }),
    );
    expect(agent?.certification).toBe("PEER_CERTIFIED");
  });

  it("refuses a version that moves backwards", async () => {
    const { org, productId } = await certifiedAgent();
    const result = await inOrg(org.organizationId, () =>
      bumpContractVersion(db, {
        organizationId: org.organizationId,
        dataProductId: productId,
        contractVersion: "1.0.0",
        changeSummary: "Reverting.",
        actorUserId: org.ownerUserId,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("only move forward");
  });

  it("leaves other tenants untouched", async () => {
    const { org, productId } = await certifiedAgent();
    const bystander = await makeOrg();

    await inOrg(org.organizationId, () =>
      bumpContractVersion(db, {
        organizationId: org.organizationId,
        dataProductId: productId,
        contractVersion: "3.0.0",
        changeSummary: "Breaking change.",
        actorUserId: org.ownerUserId,
      }),
    );

    const other = await inOrg(bystander.organizationId, () =>
      db.agent.findUnique({
        where: { id: bystander.agentId },
        select: { certification: true, staleReason: true },
      }),
    );
    expect(other?.certification).toBe("NONE");
    expect(other?.staleReason).toBeNull();
  });
});
