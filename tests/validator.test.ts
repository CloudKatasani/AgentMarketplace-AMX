import { describe, expect, it } from "vitest";

import { computeCoverageMatrix, validateCoverage } from "@/lib/bindings/coverage";
import {
  validateBindingDraft,
  validateDocumentReferences,
  type BindingContext,
  type BindingDraft,
} from "@/lib/bindings/validate";

/**
 * Rejection-first.
 *
 * The validator's product value is the refusal, so the tests are written from
 * the refusals outward: one valid case, then every way it should say no. Each
 * assertion also checks that the message is usable — a rejection nobody can act
 * on is a failure even when the code is correct.
 */

const goldProduct = {
  id: "dp-c360",
  key: "customer-360",
  name: "Customer 360",
  layer: "GOLD",
  sensitivity: "CONFIDENTIAL",
  contractVersion: "2.1.0",
  contractMajor: 2,
  semanticModelVersion: "2.1.0",
  metrics: [
    {
      id: "m-churn",
      key: "residential_churn_rate",
      name: "Residential churn rate",
      dataProductId: "dp-c360",
      certifiedAt: new Date("2024-01-01"),
      semanticRef: "semantic.customer_360.residential_churn_rate",
    },
    {
      id: "m-uncertified",
      key: "draft_metric",
      name: "Draft metric",
      dataProductId: "dp-c360",
      certifiedAt: null,
      semanticRef: "semantic.customer_360.draft_metric",
    },
    {
      id: "m-on-table",
      key: "table_metric",
      name: "Table-backed metric",
      dataProductId: "dp-c360",
      certifiedAt: new Date("2024-01-01"),
      semanticRef: "silver.meter_reads",
    },
  ],
};

const silverProduct = {
  ...goldProduct,
  id: "dp-silver",
  key: "silver-meter-reads",
  name: "Silver meter reads",
  layer: "SILVER",
  metrics: [],
};

const ctx: BindingContext = {
  products: [goldProduct, silverProduct],
  hasToolSpecs: false,
  agentSensitivity: "INTERNAL",
};

const validQueriesDraft: BindingDraft = {
  id: "b1",
  dataProductId: "dp-c360",
  type: "QUERIES",
  purpose: "Reads the certified churn rate to rank accounts at risk of leaving.",
  metricIds: ["m-churn"],
  boundContractVersion: "2.1.0",
  boundContractMajor: 2,
};

describe("binding validator — the valid case", () => {
  it("accepts a QUERIES binding on a Gold product naming a certified metric", () => {
    const report = validateBindingDraft(validQueriesDraft, ctx);
    expect(report.ok).toBe(true);
    expect(report.findings.filter((f) => f.severity === "ERROR")).toEqual([]);
  });

  it("warns, without blocking, when the binding raises the agent's classification", () => {
    const report = validateBindingDraft(validQueriesDraft, ctx);
    const warning = report.findings.find((f) => f.code === "SENSITIVITY_ESCALATION");
    expect(warning?.severity).toBe("WARNING");
    expect(report.ok).toBe(true);
  });
});

describe("binding validator — the no-physical-table guardrail", () => {
  it("rejects binding to a Silver-layer product", () => {
    const report = validateBindingDraft({ ...validQueriesDraft, dataProductId: "dp-silver" }, ctx);
    expect(report.ok).toBe(false);
    const finding = report.findings.find((f) => f.code === "PHYSICAL_TABLE_REFERENCE");
    expect(finding).toBeDefined();
    expect(finding!.message).toContain("SILVER");
    expect(finding!.suggestedFix.length).toBeGreaterThan(20);
  });

  it("rejects a metric whose semantic reference is really a physical table", () => {
    const report = validateBindingDraft({ ...validQueriesDraft, metricIds: ["m-on-table"] }, ctx);
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.code === "PHYSICAL_TABLE_REFERENCE")).toBe(true);
  });

  it("rejects a SQL table reference hidden in the binding purpose", () => {
    const report = validateBindingDraft(
      { ...validQueriesDraft, purpose: "Reads churn by selecting from bronze.customer_events." },
      ctx,
    );
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.code === "PHYSICAL_TABLE_REFERENCE")).toBe(true);
  });
});

describe("binding validator — metrics", () => {
  it("rejects a QUERIES binding that names no metric", () => {
    const report = validateBindingDraft({ ...validQueriesDraft, metricIds: [] }, ctx);
    expect(report.ok).toBe(false);
    const finding = report.findings.find((f) => f.code === "QUERIES_REQUIRES_METRIC");
    expect(finding).toBeDefined();
    // The fix must name the alternatives, not just state the rule.
    expect(finding!.suggestedFix).toContain("residential_churn_rate");
  });

  it("accepts a GROUNDS_ON binding with no metric", () => {
    const report = validateBindingDraft(
      { ...validQueriesDraft, type: "GROUNDS_ON", metricIds: [] },
      ctx,
    );
    expect(report.ok).toBe(true);
  });

  it("rejects an uncertified metric", () => {
    const report = validateBindingDraft({ ...validQueriesDraft, metricIds: ["m-uncertified"] }, ctx);
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.code === "METRIC_NOT_CERTIFIED")).toBe(true);
  });

  it("rejects a metric that belongs to a different product, and says which", () => {
    const other = {
      ...goldProduct,
      id: "dp-other",
      key: "meter-to-cash",
      name: "Meter-to-Cash",
      metrics: [
        {
          id: "m-elsewhere",
          key: "unbilled_revenue",
          name: "Unbilled revenue",
          dataProductId: "dp-other",
          certifiedAt: new Date(),
          semanticRef: "semantic.meter_to_cash.unbilled_revenue",
        },
      ],
    };
    const report = validateBindingDraft(
      { ...validQueriesDraft, metricIds: ["m-elsewhere"] },
      { ...ctx, products: [goldProduct, other] },
    );
    expect(report.ok).toBe(false);
    const finding = report.findings.find((f) => f.code === "METRIC_NOT_ON_BOUND_PRODUCT");
    expect(finding!.message).toContain("Meter-to-Cash");
  });
});

describe("binding validator — version pins and actions", () => {
  it("rejects a binding pinned to a superseded major version", () => {
    const report = validateBindingDraft(
      { ...validQueriesDraft, boundContractMajor: 1, boundContractVersion: "1.9.0" },
      ctx,
    );
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.code === "CONTRACT_PIN_STALE")).toBe(true);
  });

  it("rejects an ACTS_VIA binding with no tool specification", () => {
    const report = validateBindingDraft(
      { ...validQueriesDraft, type: "ACTS_VIA", metricIds: [] },
      { ...ctx, hasToolSpecs: false },
    );
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.code === "ACTS_VIA_REQUIRES_TOOL_SPEC")).toBe(true);
  });
});

describe("grounding packs and tool specs", () => {
  it("accepts a pack that references only certified metrics", () => {
    const report = validateDocumentReferences(
      {
        glossary: [{ term: "churn", definition: "A residential account terminating service." }],
        metrics: ["residential_churn_rate", "high_bill_risk"],
      },
      "grounding-pack",
      "gp1",
      ctx,
    );
    expect(report.ok).toBe(true);
  });

  it("rejects a free-form sql field even when it is empty", () => {
    const report = validateDocumentReferences(
      { tools: [{ name: "lookup", sql: "" }] },
      "tool-spec",
      "ts1",
      ctx,
    );
    expect(report.ok).toBe(false);
    const finding = report.findings.find((f) => f.code === "FREEFORM_SQL_FIELD");
    expect(finding).toBeDefined();
    expect(finding!.message).toContain("write its own query");
  });

  it("finds a raw-table reference nested deep in the document", () => {
    const report = validateDocumentReferences(
      { hints: { disambiguation: [{ note: "join slv_meter_reads for detail" }] } },
      "grounding-pack",
      "gp2",
      ctx,
    );
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.code === "PHYSICAL_TABLE_REFERENCE")).toBe(true);
  });
});

describe("coverage", () => {
  const questions = [
    { id: "q1", text: "Which segments churn fastest?", personaId: "p1", personaName: "Analyst", intentClass: "trend" as const },
    { id: "q2", text: "Which accounts face a high bill?", personaId: "p1", personaName: "Analyst", intentClass: "forecast" as const },
  ];
  const bindings = [
    { id: "b1", productId: "dp-c360", productName: "Customer 360", type: "QUERIES" as const },
  ];

  it("rejects an orphan question by name", () => {
    const matrix = computeCoverageMatrix({
      questions,
      bindings,
      rows: [{ questionId: "q1", bindingId: "b1", metricKey: "residential_churn_rate" }],
    });
    expect(matrix.isComplete).toBe(false);

    const report = validateCoverage(matrix);
    expect(report.ok).toBe(false);
    expect(report.findings[0].message).toContain("Which accounts face a high bill?");
  });

  it("is complete only when every question has a cell", () => {
    const matrix = computeCoverageMatrix({
      questions,
      bindings,
      rows: [
        { questionId: "q1", bindingId: "b1", metricKey: "residential_churn_rate" },
        { questionId: "q2", bindingId: "b1", metricKey: "high_bill_risk" },
      ],
    });
    expect(matrix.isComplete).toBe(true);
    expect(matrix.coveredCount).toBe(2);
    expect(validateCoverage(matrix).ok).toBe(true);
  });

  it("is not complete when there are no questions at all", () => {
    const matrix = computeCoverageMatrix({ questions: [], bindings, rows: [] });
    expect(matrix.isComplete).toBe(false);
  });
});
