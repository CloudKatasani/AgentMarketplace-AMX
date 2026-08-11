import { describe, expect, it } from "vitest";

import { diffArtifacts } from "@/lib/artifacts/diff";
import { db } from "@/lib/db";
import { registerDataProductFromImport } from "@/lib/data-products/import";
import { recordDecision, requestTransition } from "@/lib/gates";
import { saveCharter } from "@/lib/stages/charter";
import { addStageComment, loadStageComments, resolveComment, stageLockState } from "@/lib/stages/review";

import { addMember, inOrg, makeOrg } from "./helpers";

describe("artifact diff", () => {
  it("reports no change for identical content", () => {
    const diff = diffArtifacts({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 });
    expect(diff.identical).toBe(true);
    expect(diff.added).toBe(0);
  });

  it("reports added and removed lines", () => {
    const diff = diffArtifacts(
      { outOfScope: ["Commercial accounts"] },
      { outOfScope: ["Commercial accounts", "Customer contact"] },
    );
    expect(diff.identical).toBe(false);
    expect(diff.added).toBeGreaterThan(0);
    expect(diff.lines.some((l) => l.kind === "added" && l.text.includes("Customer contact"))).toBe(
      true,
    );
  });

  it("shows a replaced value as one removal and one addition", () => {
    const diff = diffArtifacts({ riskTier: "informational" }, { riskTier: "action-taking" });
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
  });
});

describe("the review loop", () => {
  it("anchors a comment to the version under review", async () => {
    const org = await makeOrg();

    await inOrg(org.organizationId, () =>
      addStageComment(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        stageId: "2-agent-charter",
        authorUserId: org.ownerUserId,
        body: "The out-of-scope list should name commercial accounts explicitly.",
        fieldPath: "/outOfScope",
      }),
    );

    const comments = await inOrg(org.organizationId, () =>
      loadStageComments(db, org.agentId, "2-agent-charter", { [org.ownerUserId]: "Owner" }),
    );

    expect(comments).toHaveLength(1);
    expect(comments[0].fieldPath).toBe("/outOfScope");
    expect(comments[0].versionNumber).not.toBeNull();
    expect(comments[0].authorName).toBe("Owner");
  });

  it("keeps parking-lot items out of the review list and off any version", async () => {
    const org = await makeOrg();

    await inOrg(org.organizationId, () =>
      addStageComment(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        stageId: "1-consumption-discovery",
        authorUserId: org.ownerUserId,
        body: "Worth asking whether field ops needs its own agent later.",
        isParkingLot: true,
      }),
    );

    const comments = await inOrg(org.organizationId, () =>
      loadStageComments(db, org.agentId, "1-consumption-discovery"),
    );
    const parked = comments.filter((c) => c.isParkingLot);

    expect(parked).toHaveLength(1);
    expect(parked[0].artifactVersionId).toBeNull();
  });

  it("resolves a comment and records it in the audit trail", async () => {
    const org = await makeOrg();
    const comment = await inOrg(org.organizationId, () =>
      addStageComment(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        stageId: "2-agent-charter",
        authorUserId: org.ownerUserId,
        body: "Mission reads like two agents.",
      }),
    );

    await inOrg(org.organizationId, () =>
      resolveComment(db, org.organizationId, comment.id, org.ownerUserId),
    );

    const [row, event] = await inOrg(org.organizationId, async () => [
      await db.comment.findUnique({ where: { id: comment.id }, select: { resolvedAt: true } }),
      await db.auditEvent.findFirst({ where: { type: "comment.resolved" } }),
    ]);

    expect(row?.resolvedAt).toBeTruthy();
    expect(event).not.toBeNull();
  });

  it("only surfaces comments belonging to the stage asked for", async () => {
    const org = await makeOrg();
    await inOrg(org.organizationId, () =>
      addStageComment(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        stageId: "1-consumption-discovery",
        authorUserId: org.ownerUserId,
        body: "Add the arrears question.",
      }),
    );

    const stageTwo = await inOrg(org.organizationId, () =>
      loadStageComments(db, org.agentId, "2-agent-charter"),
    );
    expect(stageTwo).toHaveLength(0);
  });
});

describe("the stage lock", () => {
  it("is unlocked before anything is submitted", async () => {
    const org = await makeOrg();
    const lock = await inOrg(org.organizationId, () =>
      stageLockState(db, org.agentId, "1-consumption-discovery"),
    );
    expect(lock.locked).toBe(false);
  });

  it("locks while a stage is out for review, and explains the consequence", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder"] });
    await inOrg(org.organizationId, () =>
      requestTransition(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        stageId: "1-consumption-discovery",
        actorUserId: org.ownerUserId,
      }),
    );

    const lock = await inOrg(org.organizationId, () =>
      stageLockState(db, org.agentId, "1-consumption-discovery"),
    );
    expect(lock.locked).toBe(true);
    expect(lock.reason).toContain("out for review");
    expect(lock.nextAction.length).toBeGreaterThan(20);
  });

  it("locks after approval, and says editing will make it stale", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder"] });
    const approver = await addMember(org.organizationId, ["agent-product-owner"]);

    await inOrg(org.organizationId, async () => {
      const opened = await requestTransition(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        stageId: "1-consumption-discovery",
        actorUserId: org.ownerUserId,
      });
      if (!opened.ok) throw new Error("gate did not open");
      await recordDecision(db, {
        organizationId: org.organizationId,
        gateId: opened.gateId,
        actorUserId: approver,
        roleKey: "agent-product-owner",
        decision: "APPROVE",
      });
    });

    const lock = await inOrg(org.organizationId, () =>
      stageLockState(db, org.agentId, "1-consumption-discovery"),
    );
    expect(lock.locked).toBe(true);
    expect(lock.reason).toContain("approved");
    expect(lock.nextAction).toContain("stale");
  });

  it("unlocks again when changes are requested", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder"] });
    const approver = await addMember(org.organizationId, ["agent-product-owner"]);

    await inOrg(org.organizationId, async () => {
      const opened = await requestTransition(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        stageId: "1-consumption-discovery",
        actorUserId: org.ownerUserId,
      });
      if (!opened.ok) throw new Error("gate did not open");
      await recordDecision(db, {
        organizationId: org.organizationId,
        gateId: opened.gateId,
        actorUserId: approver,
        roleKey: "agent-product-owner",
        decision: "REQUEST_CHANGES",
        comment: "Second persona has no owned decisions.",
      });
    });

    const lock = await inOrg(org.organizationId, () =>
      stageLockState(db, org.agentId, "1-consumption-discovery"),
    );
    expect(lock.locked).toBe(false);
  });
});

describe("the changes-requested loop", () => {
  it("re-versions, re-submits, and opens a fresh round", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder"] });
    const approver = await addMember(org.organizationId, ["agent-product-owner"]);
    const governance = await addMember(org.organizationId, ["governance-officer"]);

    // Stage 1 first: the engine refuses to open a gate while an earlier stage
    // is unapproved, which is the point of a gated lifecycle.
    await inOrg(org.organizationId, async () => {
      const stageOne = await requestTransition(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        stageId: "1-consumption-discovery",
        actorUserId: org.ownerUserId,
      });
      if (!stageOne.ok) throw new Error("stage 1 gate did not open");
      await recordDecision(db, {
        organizationId: org.organizationId,
        gateId: stageOne.gateId,
        actorUserId: approver,
        roleKey: "agent-product-owner",
        decision: "APPROVE",
      });
    });

    // Round 1 · changes requested on the charter.
    const first = await inOrg(org.organizationId, async () => {
      const opened = await requestTransition(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        stageId: "2-agent-charter",
        actorUserId: org.ownerUserId,
      });
      if (!opened.ok) throw new Error("gate did not open");
      await recordDecision(db, {
        organizationId: org.organizationId,
        gateId: opened.gateId,
        actorUserId: approver,
        roleKey: "agent-product-owner",
        decision: "REQUEST_CHANGES",
        comment: "Name the customer-contact exclusion explicitly.",
      });
      return opened.gateId;
    });

    // The author addresses it by committing a new version.
    await inOrg(org.organizationId, async () => {
      const artifact = await db.artifact.findFirst({
        where: { agentId: org.agentId, kind: "agent-charter" },
        select: { currentVersion: { select: { content: true } } },
      });
      const charter = JSON.parse(artifact!.currentVersion!.content) as {
        outOfScope: string[];
      };
      charter.outOfScope.push("Any customer-facing communication of any kind");

      await saveCharter(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        actorUserId: org.ownerUserId,
        charter,
      });
    });

    // Round 2 · approved by both roles.
    const second = await inOrg(org.organizationId, async () => {
      const opened = await requestTransition(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        stageId: "2-agent-charter",
        actorUserId: org.ownerUserId,
      });
      if (!opened.ok) throw new Error("second gate did not open");
      await recordDecision(db, {
        organizationId: org.organizationId,
        gateId: opened.gateId,
        actorUserId: approver,
        roleKey: "agent-product-owner",
        decision: "APPROVE",
      });
      await recordDecision(db, {
        organizationId: org.organizationId,
        gateId: opened.gateId,
        actorUserId: governance,
        roleKey: "governance-officer",
        decision: "APPROVE",
      });
      return opened;
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.round).toBe(2);
    expect(second.gateId).not.toBe(first);

    const gates = await inOrg(org.organizationId, () =>
      db.gate.findMany({
        where: { agentId: org.agentId, stageId: "2-agent-charter" },
        orderBy: { round: "asc" },
        select: { round: true, status: true },
      }),
    );
    expect(gates).toEqual([
      { round: 1, status: "CHANGES_REQUESTED" },
      { round: 2, status: "APPROVED" },
    ]);
  });
});

describe("registering a data product from an export", () => {
  const validExport = {
    listing: {
      key: "network-reliability",
      name: "Network Reliability",
      description: "Certified outage and restoration metrics by feeder and premise.",
      owner: "Network Operations",
      layer: "GOLD",
      qualityScore: 91,
      sensitivity: "INTERNAL",
    },
    contract: { version: "1.0.0", changeSummary: "Initial import." },
    semanticModel: {
      version: "1.0.0",
      entities: ["feeder", "premise"],
      metrics: [
        {
          key: "saidi_minutes",
          name: "SAIDI",
          definition: "Average interruption duration per customer served, in minutes.",
          grain: "feeder / month",
          semanticRef: "semantic.network_reliability.saidi_minutes",
          certified: true,
        },
      ],
    },
  };

  it("registers the product, its version, and its metrics", async () => {
    const org = await makeOrg();
    const result = await inOrg(org.organizationId, () =>
      registerDataProductFromImport(db, {
        organizationId: org.organizationId,
        workspaceId: org.workspaceId,
        actorUserId: org.ownerUserId,
        payload: validExport,
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metricCount).toBe(1);

    const product = await inOrg(org.organizationId, () =>
      db.dataProduct.findFirst({
        where: { key: "network-reliability" },
        select: {
          contractMajor: true,
          metrics: { select: { key: true, certifiedAt: true } },
          versions: { select: { contractVersion: true } },
        },
      }),
    );
    expect(product?.contractMajor).toBe(1);
    expect(product?.metrics[0].certifiedAt).toBeTruthy();
    expect(product?.versions.map((v) => v.contractVersion)).toEqual(["1.0.0"]);
  });

  it("refuses a Silver-layer product with a usable explanation", async () => {
    const org = await makeOrg();
    const result = await inOrg(org.organizationId, () =>
      registerDataProductFromImport(db, {
        organizationId: org.organizationId,
        workspaceId: org.workspaceId,
        actorUserId: org.ownerUserId,
        payload: { ...validExport, listing: { ...validExport.listing, layer: "SILVER" } },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toContain("SILVER");
    expect(result.errors[0].message).toContain("Gold");
  });

  it("refuses a metric defined on a physical table", async () => {
    const org = await makeOrg();
    const result = await inOrg(org.organizationId, () =>
      registerDataProductFromImport(db, {
        organizationId: org.organizationId,
        workspaceId: org.workspaceId,
        actorUserId: org.ownerUserId,
        payload: {
          ...validExport,
          semanticModel: {
            ...validExport.semanticModel,
            metrics: [
              { ...validExport.semanticModel.metrics[0], semanticRef: "bronze.outage_events" },
            ],
          },
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toContain("physical table");
  });

  it("refuses a duplicate key rather than shadowing the existing product", async () => {
    const org = await makeOrg();
    const payload = {
      ...validExport,
      listing: { ...validExport.listing, key: "customer-360" },
    };

    const result = await inOrg(org.organizationId, () =>
      registerDataProductFromImport(db, {
        organizationId: org.organizationId,
        workspaceId: org.workspaceId,
        actorUserId: org.ownerUserId,
        payload,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toContain("already registered");
  });
});
