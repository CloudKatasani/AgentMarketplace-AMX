import { beforeAll, describe, expect, it } from "vitest";

import { commitArtifact } from "@/lib/artifacts/commit";
import { db } from "@/lib/db";
import { recordDecision, requestTransition } from "@/lib/gates";

import { addMember, inOrg, makeOrg, type TestOrg } from "./helpers";

/**
 * The gate engine.
 *
 * These tests are the credibility of the product: role enforcement, quorum,
 * self-attestation labelling, and the refusal to approve a snapshot that has
 * moved. Each one is written as the thing a sceptical buyer would try.
 */

async function openStage1(org: TestOrg, options: { solo?: boolean; actorUserId?: string } = {}) {
  return inOrg(org.organizationId, () =>
    requestTransition(db, {
      organizationId: org.organizationId,
      agentId: org.agentId,
      stageId: "1-consumption-discovery",
      actorUserId: options.actorUserId ?? org.ownerUserId,
      requestSoloAttestation: options.solo,
    }),
  );
}

describe("requestTransition", () => {
  let org: TestOrg;
  beforeAll(async () => {
    org = await makeOrg({ ownerRoles: ["agent-builder"] });
  });

  it("opens a gate when the exit criteria are met", async () => {
    const result = await openStage1(org);
    expect(result.ok).toBe(true);
  });

  it("refuses a second open gate for the same stage", async () => {
    const result = await openStage1(org);
    expect(result).toMatchObject({ ok: false, reason: "ALREADY_OPEN" });
  });

  it("refuses when the exit criteria are unmet, and returns the blockers", async () => {
    const empty = await makeOrg({ seedStarter: false, ownerRoles: ["agent-product-owner"] });
    const workspace = await inOrg(empty.organizationId, () =>
      db.workspace.findFirst({ select: { id: true } }),
    );
    const agent = await inOrg(empty.organizationId, () =>
      db.agent.create({
        data: {
          organizationId: empty.organizationId,
          workspaceId: workspace!.id,
          slug: "bare",
          name: "Bare agent",
          currentStageId: "1-consumption-discovery",
        },
        select: { id: true },
      }),
    );

    const result = await inOrg(empty.organizationId, () =>
      requestTransition(db, {
        organizationId: empty.organizationId,
        agentId: agent.id,
        stageId: "1-consumption-discovery",
        actorUserId: empty.ownerUserId,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("CRITERIA_UNMET");
    if (result.reason !== "CRITERIA_UNMET") return;
    expect(result.blockers.map((b) => b.key)).toContain("persona.question-floor");
  });

  it("refuses a solo review from someone with no approver role for the stage", async () => {
    const builderOnly = await makeOrg({ ownerRoles: ["agent-builder"] });
    const result = await openStage1(builderOnly, { solo: true });
    expect(result).toMatchObject({ ok: false, reason: "NOT_PERMITTED" });
  });

  it("refuses every transition in a read-only organisation", async () => {
    const readOnly = await makeOrg();
    await inOrg(readOnly.organizationId, () =>
      db.organization.update({
        where: { id: readOnly.organizationId },
        data: { isReadOnly: true, isShowcase: true },
      }),
    );

    const result = await openStage1(readOnly);
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "NOT_PERMITTED") return;
    expect(result.detail).toContain("live demo workspace");
  });
});

describe("sequential gating", () => {
  it("refuses to open a stage while an earlier one is unapproved", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder"] });

    const result = await inOrg(org.organizationId, () =>
      requestTransition(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        stageId: "3-data-product-binding",
        actorUserId: org.ownerUserId,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "NOT_PERMITTED") return;
    // Without this, an agent can be walked straight to publication with an
    // unsigned charter — eight forms rather than eight gates.
    expect(result.detail).toContain("Consumption Discovery");
    expect(result.detail).toContain("Agent Charter");
  });

  it("opens the next stage once the previous one is approved", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder"] });
    const approver = await addMember(org.organizationId, ["agent-product-owner"]);

    const opened = await openStage1(org);
    if (!opened.ok) throw new Error("stage 1 gate did not open");
    await inOrg(org.organizationId, () =>
      recordDecision(db, {
        organizationId: org.organizationId,
        gateId: opened.gateId,
        actorUserId: approver,
        roleKey: "agent-product-owner",
        decision: "APPROVE",
      }),
    );

    const stageTwo = await inOrg(org.organizationId, () =>
      requestTransition(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        stageId: "2-agent-charter",
        actorUserId: org.ownerUserId,
      }),
    );
    expect(stageTwo.ok).toBe(true);
  });
});

describe("recordDecision · role enforcement", () => {
  it("refuses a decision from a role the user does not hold", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder"] });
    const opened = await openStage1(org);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await inOrg(org.organizationId, () =>
      recordDecision(db, {
        organizationId: org.organizationId,
        gateId: opened.gateId,
        actorUserId: org.ownerUserId,
        roleKey: "agent-product-owner",
        decision: "APPROVE",
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "NOT_PERMITTED" });
  });

  it("refuses a decision from a role that is not an approver at this stage", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder"] });
    const consumer = await addMember(org.organizationId, ["business-consumer"]);
    const opened = await openStage1(org);
    if (!opened.ok) throw new Error("gate did not open");

    const result = await inOrg(org.organizationId, () =>
      recordDecision(db, {
        organizationId: org.organizationId,
        gateId: opened.gateId,
        actorUserId: consumer,
        roleKey: "business-consumer",
        decision: "APPROVE",
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "NOT_PERMITTED" });
  });

  it("refuses a veto from a role that holds no veto", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder"] });
    const owner = await addMember(org.organizationId, ["agent-product-owner"]);
    const opened = await openStage1(org);
    if (!opened.ok) throw new Error("gate did not open");

    const result = await inOrg(org.organizationId, () =>
      recordDecision(db, {
        organizationId: org.organizationId,
        gateId: opened.gateId,
        actorUserId: owner,
        roleKey: "agent-product-owner",
        decision: "VETO",
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "NOT_PERMITTED" });
  });

  it("refuses a peer approval from the person who authored everything", async () => {
    // The owner authored the starter artifacts and also holds the approver role.
    const org = await makeOrg({ ownerRoles: ["agent-builder", "agent-product-owner"] });
    const opened = await openStage1(org);
    if (!opened.ok) throw new Error("gate did not open");

    const result = await inOrg(org.organizationId, () =>
      recordDecision(db, {
        organizationId: org.organizationId,
        gateId: opened.gateId,
        actorUserId: org.ownerUserId,
        roleKey: "agent-product-owner",
        decision: "APPROVE",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "NOT_PERMITTED") return;
    expect(result.detail).toContain("self-review");
  });
});

describe("recordDecision · quorum and outcomes", () => {
  it("holds a two-role gate open until both roles have approved", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder"] });
    const productOwner = await addMember(org.organizationId, ["agent-product-owner"]);
    const governance = await addMember(org.organizationId, ["governance-officer"]);

    const stage1 = await openStage1(org);
    if (!stage1.ok) throw new Error("stage 1 gate did not open");
    await inOrg(org.organizationId, () =>
      recordDecision(db, {
        organizationId: org.organizationId,
        gateId: stage1.gateId,
        actorUserId: productOwner,
        roleKey: "agent-product-owner",
        decision: "APPROVE",
      }),
    );

    const stage2 = await inOrg(org.organizationId, () =>
      requestTransition(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        stageId: "2-agent-charter",
        actorUserId: org.ownerUserId,
      }),
    );
    if (!stage2.ok) throw new Error("stage 2 gate did not open");

    const first = await inOrg(org.organizationId, () =>
      recordDecision(db, {
        organizationId: org.organizationId,
        gateId: stage2.gateId,
        actorUserId: productOwner,
        roleKey: "agent-product-owner",
        decision: "APPROVE",
      }),
    );
    expect(first).toMatchObject({ ok: true, gateStatus: "OPEN" });
    if (first.ok) expect(first.outstandingRoles).toEqual(["governance-officer"]);

    const second = await inOrg(org.organizationId, () =>
      recordDecision(db, {
        organizationId: org.organizationId,
        gateId: stage2.gateId,
        actorUserId: governance,
        roleKey: "governance-officer",
        decision: "APPROVE",
      }),
    );
    expect(second).toMatchObject({ ok: true, gateStatus: "APPROVED" });
    if (second.ok) expect(second.advancedToStageId).toBe("3-data-product-binding");
  });

  it("records changes-requested and raises a task", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder"] });
    const productOwner = await addMember(org.organizationId, ["agent-product-owner"]);
    const opened = await openStage1(org);
    if (!opened.ok) throw new Error("gate did not open");

    const result = await inOrg(org.organizationId, () =>
      recordDecision(db, {
        organizationId: org.organizationId,
        gateId: opened.gateId,
        actorUserId: productOwner,
        roleKey: "agent-product-owner",
        decision: "REQUEST_CHANGES",
        comment: "The second persona has no owned decisions.",
      }),
    );
    expect(result).toMatchObject({ ok: true, gateStatus: "CHANGES_REQUESTED" });

    const tasks = await inOrg(org.organizationId, () =>
      db.task.findMany({ where: { agentId: org.agentId, kind: "REVIEW_CHANGES" } }),
    );
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].description).toContain("owned decisions");
  });

  it("refuses a decision once the gate is closed", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder"] });
    const productOwner = await addMember(org.organizationId, ["agent-product-owner"]);
    const opened = await openStage1(org);
    if (!opened.ok) throw new Error("gate did not open");

    await inOrg(org.organizationId, () =>
      recordDecision(db, {
        organizationId: org.organizationId,
        gateId: opened.gateId,
        actorUserId: productOwner,
        roleKey: "agent-product-owner",
        decision: "APPROVE",
      }),
    );

    const again = await inOrg(org.organizationId, () =>
      recordDecision(db, {
        organizationId: org.organizationId,
        gateId: opened.gateId,
        actorUserId: productOwner,
        roleKey: "agent-product-owner",
        decision: "APPROVE",
      }),
    );
    expect(again).toMatchObject({ ok: false, reason: "GATE_NOT_OPEN" });
  });
});

describe("solo attestation", () => {
  it("requires a substantive statement", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder", "agent-product-owner"] });
    const opened = await openStage1(org, { solo: true });
    if (!opened.ok) throw new Error("gate did not open");
    expect(opened.mode).toBe("SOLO_ATTESTATION");

    const tooShort = await inOrg(org.organizationId, () =>
      recordDecision(db, {
        organizationId: org.organizationId,
        gateId: opened.gateId,
        actorUserId: org.ownerUserId,
        roleKey: "agent-product-owner",
        decision: "APPROVE",
        attestationStatement: "looks fine",
      }),
    );
    expect(tooShort).toMatchObject({ ok: false, reason: "ATTESTATION_REQUIRED" });
  });

  it("closes the gate on one signature and labels it self-attested", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder", "agent-product-owner"] });
    const opened = await openStage1(org, { solo: true });
    if (!opened.ok) throw new Error("gate did not open");

    const statement =
      "I have reviewed the persona register against the decisions this team owns and I accept it.";
    const result = await inOrg(org.organizationId, () =>
      recordDecision(db, {
        organizationId: org.organizationId,
        gateId: opened.gateId,
        actorUserId: org.ownerUserId,
        roleKey: "agent-product-owner",
        decision: "APPROVE",
        attestationStatement: statement,
      }),
    );
    expect(result).toMatchObject({ ok: true, gateStatus: "APPROVED" });

    const approval = await inOrg(org.organizationId, () =>
      db.approval.findFirst({ where: { gateId: opened.gateId } }),
    );
    expect(approval?.isSelfAttestation).toBe(true);
    expect(approval?.attestationStatement).toBe(statement);

    // The audit trail must record HOW it was approved, not merely that it was.
    const event = await inOrg(org.organizationId, () =>
      db.auditEvent.findFirst({
        where: { type: "gate.decided", subjectId: approval!.id },
      }),
    );
    expect(event?.payload).toContain('"isSelfAttestation":true');
  });
});

describe("snapshot integrity", () => {
  it("refuses a decision after the artifacts under review have changed", async () => {
    const org = await makeOrg({ ownerRoles: ["agent-builder"] });
    const productOwner = await addMember(org.organizationId, ["agent-product-owner"]);
    const opened = await openStage1(org);
    if (!opened.ok) throw new Error("gate did not open");

    // Someone edits the register while it is out for review.
    await inOrg(org.organizationId, async () => {
      const current = await db.artifact.findFirst({
        where: { agentId: org.agentId, kind: "persona-question-register" },
        select: { currentVersion: { select: { content: true } } },
      });
      const content = JSON.parse(current!.currentVersion!.content) as {
        personas: { questions: unknown[] }[];
      };
      content.personas[0].questions.push({
        key: "q-late",
        text: "A question added after the review started",
        intentClass: "lookup",
        consequenceOfNoAnswer: "The reviewer approves something they never read.",
        expectedAnswerShape: "A value",
        priority: 9,
      });
      await commitArtifact(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        stageId: "1-consumption-discovery",
        kind: "persona-question-register",
        content,
        authorUserId: org.ownerUserId,
      });
    });

    const result = await inOrg(org.organizationId, () =>
      recordDecision(db, {
        organizationId: org.organizationId,
        gateId: opened.gateId,
        actorUserId: productOwner,
        roleKey: "agent-product-owner",
        decision: "APPROVE",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(["SNAPSHOT_STALE", "GATE_NOT_OPEN"]).toContain(result.reason);

    const gate = await inOrg(org.organizationId, () =>
      db.gate.findUnique({ where: { id: opened.gateId }, select: { status: true } }),
    );
    expect(gate?.status).toBe("STALE");
  });
});
