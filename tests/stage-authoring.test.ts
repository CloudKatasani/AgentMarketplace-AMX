import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { saveCharter, hasQualifyingPersona } from "@/lib/stages/charter";
import { archiveQuestion, savePersona, saveQuestion } from "@/lib/stages/consumption";
import { draftGroundingPack, saveGroundingPack, saveToolSpecs } from "@/lib/stages/grounding";

import { inOrg, makeOrg, type TestOrg } from "./helpers";

/**
 * Stage authoring.
 *
 * The load-bearing property throughout: rows are the truth and the artifact is
 * derived, so a reviewer approving the artifact is approving what the workspace
 * actually contains. Each test checks both sides.
 */

const validCharter = {
  schemaVersion: "1.0.0",
  archetype: "Advisor",
  mission: "Help analysts find the accounts most likely to leave, with certified numbers.",
  scopeBoundary: "Residential retail accounts only. Advises; never contacts a customer.",
  outOfScope: ["Commercial accounts", "Approving retention offers"],
  valueHypothesis: "Analysts start the week with a ranked, explainable list.",
  successMeasures: ["Reviewed list within an hour"],
  riskTier: "decision-support",
  ownerName: "Priya Raman",
  escalationContact: "Head of Retail Analytics",
};

async function currentRegister(org: TestOrg) {
  return inOrg(org.organizationId, async () => {
    const artifact = await db.artifact.findFirst({
      where: { agentId: org.agentId, kind: "persona-question-register" },
      select: { currentVersion: { select: { versionNumber: true, content: true } } },
    });
    return artifact?.currentVersion
      ? {
          versionNumber: artifact.currentVersion.versionNumber,
          content: JSON.parse(artifact.currentVersion.content) as {
            personas: { name: string; questions: { text: string }[] }[];
          },
        }
      : null;
  });
}

describe("Stage 1 · personas and questions", () => {
  it("adds a persona, links it to the agent, and re-derives the artifact", async () => {
    const org = await makeOrg();
    const before = await currentRegister(org);

    const personaId = await inOrg(org.organizationId, () =>
      savePersona(
        db,
        { organizationId: org.organizationId, agentId: org.agentId, actorUserId: org.ownerUserId },
        {
          name: "Field Operations Lead",
          kind: "BUSINESS",
          ownedDecisions: "Which crews are dispatched to which outages first.",
          cadence: "Daily",
          currentWorkaround: "A whiteboard and three phone calls.",
        },
      ),
    );

    const link = await inOrg(org.organizationId, () =>
      db.agentPersona.findUnique({
        where: { agentId_personaId: { agentId: org.agentId, personaId } },
      }),
    );
    expect(link).not.toBeNull();

    const after = await currentRegister(org);
    expect(after!.versionNumber).toBeGreaterThan(before!.versionNumber);
    expect(after!.content.personas.map((p) => p.name)).toContain("Field Operations Lead");
  });

  it("gives two personas with the same name distinct keys", async () => {
    const org = await makeOrg();
    const ctx = {
      organizationId: org.organizationId,
      agentId: org.agentId,
      actorUserId: org.ownerUserId,
    };
    const persona = {
      name: "Duty Manager",
      kind: "BUSINESS" as const,
      ownedDecisions: "Who is called out overnight.",
      cadence: "Nightly",
      currentWorkaround: "A rota in a shared inbox.",
    };

    const first = await inOrg(org.organizationId, () => savePersona(db, ctx, persona));
    const second = await inOrg(org.organizationId, () => savePersona(db, ctx, persona));

    const keys = await inOrg(org.organizationId, () =>
      db.persona.findMany({ where: { id: { in: [first, second] } }, select: { key: true } }),
    );
    expect(new Set(keys.map((k) => k.key)).size).toBe(2);
  });

  it("adds a question and re-derives the artifact", async () => {
    const org = await makeOrg();
    const persona = await inOrg(org.organizationId, () =>
      db.persona.findFirst({ select: { id: true } }),
    );

    await inOrg(org.organizationId, () =>
      saveQuestion(
        db,
        { organizationId: org.organizationId, agentId: org.agentId, actorUserId: org.ownerUserId },
        {
          personaId: persona!.id,
          text: "Which accounts moved into arrears this week?",
          intentClass: "lookup",
          consequenceOfNoAnswer: "Collections calls the wrong people and misses the new cases.",
          expectedAnswerShape: "Account list with days in arrears",
        },
      ),
    );

    const register = await currentRegister(org);
    const questions = register!.content.personas.flatMap((p) => p.questions.map((q) => q.text));
    expect(questions).toContain("Which accounts moved into arrears this week?");
  });

  it("archives a question rather than deleting it, and clears its coverage", async () => {
    const org = await makeOrg();
    const question = await inOrg(org.organizationId, () =>
      db.question.findFirst({ where: { agentId: org.agentId }, select: { id: true } }),
    );

    await inOrg(org.organizationId, () =>
      archiveQuestion(
        db,
        { organizationId: org.organizationId, agentId: org.agentId, actorUserId: org.ownerUserId },
        question!.id,
      ),
    );

    const row = await inOrg(org.organizationId, () =>
      db.question.findUnique({ where: { id: question!.id }, select: { archivedAt: true } }),
    );
    expect(row?.archivedAt).toBeTruthy();

    const coverage = await inOrg(org.organizationId, () =>
      db.questionCoverage.findMany({ where: { questionId: question!.id } }),
    );
    expect(coverage).toEqual([]);
  });
});

describe("Stage 2 · the hard block, enforced at authoring", () => {
  it("refuses a charter when no persona qualifies — even a perfect one", async () => {
    const org = await makeOrg({ seedStarter: false });
    const workspace = await inOrg(org.organizationId, () =>
      db.workspace.findFirst({ select: { id: true } }),
    );
    const agent = await inOrg(org.organizationId, () =>
      db.agent.create({
        data: {
          organizationId: org.organizationId,
          workspaceId: workspace!.id,
          slug: "bare",
          name: "Bare agent",
          currentStageId: "2-agent-charter",
        },
        select: { id: true },
      }),
    );

    const result = await inOrg(org.organizationId, () =>
      saveCharter(db, {
        organizationId: org.organizationId,
        agentId: agent.id,
        actorUserId: org.ownerUserId,
        charter: validCharter,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toContain("Finish Stage 1 first");

    const artifact = await inOrg(org.organizationId, () =>
      db.artifact.findFirst({ where: { agentId: agent.id, kind: "agent-charter" } }),
    );
    expect(artifact).toBeNull();
  });

  it("commits a valid charter and mirrors archetype and risk tier onto the agent", async () => {
    const org = await makeOrg();
    expect(await inOrg(org.organizationId, () => hasQualifyingPersona(db, org.agentId))).toBe(true);

    const result = await inOrg(org.organizationId, () =>
      saveCharter(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        actorUserId: org.ownerUserId,
        charter: { ...validCharter, archetype: "Monitor", riskTier: "informational" },
      }),
    );
    expect(result.ok).toBe(true);

    const agent = await inOrg(org.organizationId, () =>
      db.agent.findUnique({
        where: { id: org.agentId },
        select: { archetype: true, riskTier: true },
      }),
    );
    expect(agent).toMatchObject({ archetype: "Monitor", riskTier: "informational" });
  });

  it("refuses a charter with an empty out-of-scope list", async () => {
    const org = await makeOrg();
    const result = await inOrg(org.organizationId, () =>
      saveCharter(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        actorUserId: org.ownerUserId,
        charter: { ...validCharter, outOfScope: [] },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes("must not do"))).toBe(true);
  });
});

describe("Stage 4 · grounding pack and tool specs", () => {
  async function baseDraft(org: TestOrg) {
    const draft = await inOrg(org.organizationId, () => draftGroundingPack(db, org.agentId));
    return draft!;
  }

  it("drafts the pack from the register and the bound metrics", async () => {
    const org = await makeOrg();
    const draft = await baseDraft(org);

    expect(draft.sampleQuestions).toHaveLength(3);
    expect(draft.metricDefinitions.map((m) => m.key).sort()).toEqual([
      "high_bill_risk",
      "residential_churn_rate",
    ]);
    // Every sample question arrives with the metric that answers it.
    expect(draft.sampleQuestions.every((q) => q.metricKey.length > 0)).toBe(true);
  });

  it("commits a clean pack", async () => {
    const org = await makeOrg();
    const draft = await baseDraft(org);

    const result = await inOrg(org.organizationId, () =>
      saveGroundingPack(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        actorUserId: org.ownerUserId,
        document: {
          ...draft,
          glossary: [{ term: "churn", definition: "An account terminating service." }],
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a pack that mentions a Silver table", async () => {
    const org = await makeOrg();
    const draft = await baseDraft(org);

    const result = await inOrg(org.organizationId, () =>
      saveGroundingPack(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        actorUserId: org.ownerUserId,
        document: {
          ...draft,
          disambiguationHints: [
            { ambiguousTerm: "reads", resolution: "join slv_meter_reads for detail" },
          ],
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.report?.findings.some((f) => f.code === "PHYSICAL_TABLE_REFERENCE")).toBe(true);
  });

  it("refuses a free-form sql field out loud rather than stripping it", async () => {
    const org = await makeOrg();
    const draft = await baseDraft(org);

    const result = await inOrg(org.organizationId, () =>
      saveGroundingPack(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        actorUserId: org.ownerUserId,
        document: { ...draft, sql: "" },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.report?.findings.some((f) => f.code === "FREEFORM_SQL_FIELD")).toBe(true);
  });

  it("refuses a tool that acts through a binding this agent does not have", async () => {
    const org = await makeOrg();

    const result = await inOrg(org.organizationId, () =>
      saveToolSpecs(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        actorUserId: org.ownerUserId,
        document: {
          schemaVersion: "1.0.0",
          agentSlug: "customer-churn-advisor",
          tools: [
            {
              name: "issue_credit",
              description: "Applies a goodwill credit to an account.",
              bindingRef: "billing-system:ACTS_VIA",
              inputs: [],
              outputs: [],
              refusalRules: ["Refuse for commercial accounts, which are out of scope."],
              escalationPath: "Duty analyst",
            },
          ],
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toContain("ungoverned");
  });

  it("refuses a tool with no refusal rules", async () => {
    const org = await makeOrg();

    const result = await inOrg(org.organizationId, () =>
      saveToolSpecs(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        actorUserId: org.ownerUserId,
        document: {
          schemaVersion: "1.0.0",
          agentSlug: "customer-churn-advisor",
          tools: [
            {
              name: "lookup_risk",
              description: "Reads the high-bill risk score for an account.",
              bindingRef: "customer-360:QUERIES",
              inputs: [],
              outputs: [],
              refusalRules: [],
              escalationPath: "Duty analyst",
            },
          ],
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes("no scope"))).toBe(true);
  });

  it("commits a tool bound to a real binding", async () => {
    const org = await makeOrg();

    const result = await inOrg(org.organizationId, () =>
      saveToolSpecs(db, {
        organizationId: org.organizationId,
        agentId: org.agentId,
        actorUserId: org.ownerUserId,
        document: {
          schemaVersion: "1.0.0",
          agentSlug: "customer-churn-advisor",
          tools: [
            {
              name: "lookup_risk",
              description: "Reads the high-bill risk score for an account.",
              bindingRef: "customer-360:QUERIES",
              inputs: [
                { name: "account_id", type: "string", description: "Billing account", required: true },
              ],
              outputs: [
                { name: "risk", type: "number", description: "Risk 0 to 1", required: true },
              ],
              refusalRules: ["Refuse for commercial accounts, which are out of charter scope."],
              escalationPath: "Revenue Assurance duty analyst",
            },
          ],
        },
      }),
    );

    expect(result.ok).toBe(true);
  });
});
