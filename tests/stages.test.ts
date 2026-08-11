import { describe, expect, it } from "vitest";

import { evaluateExitCriteria, STAGES, stageByKey, summariseCoverage } from "@/lib/lifecycle/stages";
import type { StageContext } from "@/lib/lifecycle/types";
import { ROLE_KEYS } from "@/lib/roles";

import { asSystem, raw } from "./helpers";

/**
 * Exit criteria are pure functions, so they are tested against hand-built
 * contexts rather than against a database. Every blocking criterion gets both
 * cases: the one that passes and the one that must not.
 */

function context(overrides: Partial<StageContext> = {}): StageContext {
  return {
    organization: { id: "org", planTier: "FREE", isReadOnly: false },
    agent: {
      id: "agent",
      slug: "agent",
      name: "Agent",
      summary: "",
      archetype: null,
      riskTier: null,
      ownerUserId: null,
      sensitivity: null,
      currentStageId: "1-consumption-discovery",
      status: "DRAFT",
      certification: "NONE",
    },
    stageRun: { id: "run", stageId: "1-consumption-discovery", status: "DRAFT" },
    artifacts: {},
    personas: [],
    questions: [],
    bindings: [],
    coverage: [],
    dataProducts: [],
    approvals: [],
    ...overrides,
  };
}

function question(id: string, intentClass: StageContext["questions"][number]["intentClass"] = "trend") {
  return {
    id,
    personaId: "p1",
    text: `Question ${id}`,
    intentClass,
    consequenceOfNoAnswer: "The decision gets made on a hunch.",
    expectedAnswerShape: "A ranked list",
  };
}

function persona(questionCount: number) {
  return {
    id: "p1",
    key: "analyst",
    name: "Revenue Assurance Analyst",
    kind: "BUSINESS",
    ownedDecisions: "Which accounts get a retention offer.",
    cadence: "Weekly",
    currentWorkaround: "Three dashboards and a spreadsheet.",
    questions: Array.from({ length: questionCount }, (_, i) => question(`q${i}`)),
  };
}

const charterVersion = {
  id: "v1",
  artifactId: "a1",
  kind: "agent-charter" as const,
  versionNumber: 1,
  contentHash: "h",
  isAiDraft: false,
  createdAt: new Date(),
  content: {
    schemaVersion: "1.0.0",
    archetype: "Advisor",
    mission: "Help analysts find accounts likely to leave.",
    scopeBoundary: "Residential retail accounts only.",
    outOfScope: ["Commercial accounts"],
    valueHypothesis: "Analysts stop reconciling dashboards by hand.",
    successMeasures: ["Reviewed list within an hour"],
    riskTier: "decision-support",
    ownerName: "Priya Raman",
    escalationContact: "Head of Retail Analytics",
  },
};

const registerVersion = { ...charterVersion, kind: "persona-question-register" as const, content: {} };
const bindingSetVersion = { ...charterVersion, kind: "binding-set" as const, content: {} };

describe("the stage registry", () => {
  it("has eight stages with contiguous ordinals", () => {
    expect(STAGES).toHaveLength(8);
    expect(STAGES.map((s) => s.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("names only roles that exist", () => {
    for (const stage of STAGES) {
      for (const role of [...stage.requiredApproverRoles, ...stage.vetoRoles]) {
        expect(ROLE_KEYS, `${stage.key} names an unknown role: ${role}`).toContain(role);
      }
    }
  });

  it("never sets a quorum higher than the number of approver roles", () => {
    for (const stage of STAGES) {
      expect(stage.quorum).toBeLessThanOrEqual(stage.requiredApproverRoles.length);
    }
  });

  it("matches the seeded Stage table", async () => {
    const rows = await asSystem(() => raw.stage.findMany({ orderBy: { ordinal: "asc" } }));
    expect(rows.map((r) => r.id)).toEqual(STAGES.map((s) => s.key));
    expect(rows.map((r) => r.name)).toEqual(STAGES.map((s) => s.name));
  });
});

describe("Stage 1 · consumption discovery", () => {
  it("blocks with no personas, and says why in plain language", () => {
    const evaluation = evaluateExitCriteria(stageByKey("1-consumption-discovery"), context());
    expect(evaluation.canSubmit).toBe(false);
    const floor = evaluation.results.find((r) => r.key === "persona.question-floor")!;
    expect(floor.detail).toContain("No personas yet");
    expect(floor.fix).toBeDefined();
  });

  it("blocks when a persona has fewer than three complete questions", () => {
    const evaluation = evaluateExitCriteria(
      stageByKey("1-consumption-discovery"),
      context({
        personas: [persona(2)],
        questions: [question("q0"), question("q1")],
        artifacts: { "persona-question-register": registerVersion },
      }),
    );
    expect(evaluation.canSubmit).toBe(false);
    const floor = evaluation.results.find((r) => r.key === "persona.question-floor")!;
    expect(floor.detail).toContain("2 of 3");
  });

  it("passes with one complete persona and three questions", () => {
    const evaluation = evaluateExitCriteria(
      stageByKey("1-consumption-discovery"),
      context({
        personas: [persona(3)],
        questions: [question("q0"), question("q1", "lookup"), question("q2", "diagnosis")],
        artifacts: { "persona-question-register": registerVersion },
      }),
    );
    expect(evaluation.canSubmit).toBe(true);
  });

  it("treats a single-intent register as advisory, not blocking", () => {
    const evaluation = evaluateExitCriteria(
      stageByKey("1-consumption-discovery"),
      context({
        personas: [persona(3)],
        questions: [question("q0"), question("q1"), question("q2")],
        artifacts: { "persona-question-register": registerVersion },
      }),
    );
    const spread = evaluation.results.find((r) => r.key === "stage1.intent-spread")!;
    expect(spread.satisfied).toBe(false);
    expect(spread.blocking).toBe(false);
    expect(evaluation.canSubmit).toBe(true);
  });
});

describe("Stage 2 · the hard block", () => {
  it("cannot be satisfied without a Stage 1 persona, however complete the charter", () => {
    const evaluation = evaluateExitCriteria(
      stageByKey("2-agent-charter"),
      context({ artifacts: { "agent-charter": charterVersion } }),
    );
    expect(evaluation.canSubmit).toBe(false);
    expect(evaluation.blockers.map((b) => b.key)).toContain("stage2.persona-question-floor");
  });

  it("blocks a charter with an empty out-of-scope list", () => {
    const evaluation = evaluateExitCriteria(
      stageByKey("2-agent-charter"),
      context({
        personas: [persona(3)],
        questions: [question("q0"), question("q1"), question("q2")],
        artifacts: {
          "agent-charter": {
            ...charterVersion,
            content: { ...charterVersion.content, outOfScope: [] },
          },
        },
      }),
    );
    expect(evaluation.canSubmit).toBe(false);
    const finding = evaluation.blockers.find((b) => b.key === "stage2.out-of-scope-declared")!;
    expect(finding.detail).toContain("aspiration");
  });

  it("passes with a persona and a complete charter", () => {
    const evaluation = evaluateExitCriteria(
      stageByKey("2-agent-charter"),
      context({
        personas: [persona(3)],
        questions: [question("q0"), question("q1"), question("q2")],
        artifacts: { "agent-charter": charterVersion },
      }),
    );
    expect(evaluation.canSubmit).toBe(true);
  });
});

describe("Stage 3 · 100% question coverage", () => {
  const binding = {
    id: "b1",
    status: "PROPOSED",
    dataProductId: "dp1",
    bindingType: "QUERIES" as const,
    currentVersion: {
      id: "bv1",
      versionNumber: 1,
      type: "QUERIES" as const,
      purpose: "Reads the certified metric.",
      boundContractVersion: "2.1.0",
      boundContractMajor: 2,
      metricIds: ["m1"],
    },
  };

  const base = {
    personas: [persona(3)],
    questions: [question("q0"), question("q1"), question("q2")],
    bindings: [binding],
    artifacts: { "binding-set": bindingSetVersion },
  };

  it("blocks at 2 of 3 questions covered and names the uncovered one", () => {
    const evaluation = evaluateExitCriteria(
      stageByKey("3-data-product-binding"),
      context({
        ...base,
        coverage: [
          { questionId: "q0", bindingId: "b1", certifiedMetricId: "m1" },
          { questionId: "q1", bindingId: "b1", certifiedMetricId: "m1" },
        ],
      }),
    );
    expect(evaluation.canSubmit).toBe(false);
    const coverage = evaluation.blockers.find(
      (b) => b.key === "stage3.question-coverage-complete",
    )!;
    expect(coverage.detail).toContain("2 of 3");
    expect(coverage.detail).toContain("Question q2");
  });

  it("passes at 100% coverage", () => {
    const evaluation = evaluateExitCriteria(
      stageByKey("3-data-product-binding"),
      context({
        ...base,
        coverage: ["q0", "q1", "q2"].map((questionId) => ({
          questionId,
          bindingId: "b1",
          certifiedMetricId: "m1",
        })),
      }),
    );
    expect(evaluation.canSubmit).toBe(true);
  });

  it("blocks a QUERIES binding that names no metric", () => {
    const evaluation = evaluateExitCriteria(
      stageByKey("3-data-product-binding"),
      context({
        ...base,
        bindings: [{ ...binding, currentVersion: { ...binding.currentVersion, metricIds: [] } }],
        coverage: ["q0", "q1", "q2"].map((questionId) => ({
          questionId,
          bindingId: "b1",
          certifiedMetricId: null,
        })),
      }),
    );
    expect(evaluation.blockers.map((b) => b.key)).toContain("stage3.queries-name-metrics");
  });

  it("blocks while any binding is stale", () => {
    const evaluation = evaluateExitCriteria(
      stageByKey("3-data-product-binding"),
      context({
        ...base,
        bindings: [{ ...binding, status: "STALE" }],
        coverage: ["q0", "q1", "q2"].map((questionId) => ({
          questionId,
          bindingId: "b1",
          certifiedMetricId: "m1",
        })),
      }),
    );
    expect(evaluation.blockers.map((b) => b.key)).toContain("stage3.no-stale-bindings");
  });
});

describe("coverage arithmetic", () => {
  it("agrees with the Stage 3 criterion", () => {
    const ctx = context({
      questions: [question("q0"), question("q1")],
      coverage: [{ questionId: "q0", bindingId: "b1", certifiedMetricId: null }],
    });
    const summary = summariseCoverage(ctx);
    expect(summary).toMatchObject({ total: 2, covered: 1, isComplete: false });
    expect(summary.uncovered.map((q) => q.id)).toEqual(["q1"]);
  });
});
