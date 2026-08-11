/**
 * The binding validator.
 *
 * Its job is to say *no* in a sentence a business person can act on. Every
 * finding carries a plain-language message and a suggested fix; none of them
 * may render a schema path, a regex, or an exception. A rejection here is a
 * demo moment — the guardrail everyone claims, actually enforced.
 *
 * Three layers of check for the no-physical-table rule:
 *   1. structural  — the bound product's serving layer
 *   2. lexical     — SQL-ish table references and denied identifier patterns
 *   3. resolution  — every reference must resolve to a certified metric or a
 *                    named semantic entity, or it fails closed
 *
 * Layers 1 and 2 catch the obvious case loudly. Layer 3 is what actually
 * enforces "semantic layer only".
 */
import type { BindingType } from "@/lib/enums";

import {
  DEFAULT_REFERENCE_RULES,
  SQL_TABLE_REFERENCE,
  compileRules,
  matchesDeniedIdentifier,
  type CompiledRules,
  type PhysicalReferenceRules,
} from "./rules";

export type ValidationCode =
  | "QUERIES_REQUIRES_METRIC"
  | "PHYSICAL_TABLE_REFERENCE"
  | "QUESTION_NOT_COVERED"
  | "METRIC_NOT_ON_BOUND_PRODUCT"
  | "METRIC_NOT_CERTIFIED"
  | "CONTRACT_PIN_STALE"
  | "ACTS_VIA_REQUIRES_TOOL_SPEC"
  | "FREEFORM_SQL_FIELD"
  | "SENSITIVITY_ESCALATION";

export type ValidationFinding = {
  code: ValidationCode;
  severity: "ERROR" | "WARNING";
  /** Plain language. Names the thing that is wrong, in the user's vocabulary. */
  message: string;
  /** Always actionable, and specific to what is on screen. */
  suggestedFix: string;
  subject: {
    kind: "binding" | "question" | "grounding-pack" | "tool-spec";
    id: string;
    field?: string;
  };
};

export type ValidationReport = {
  /** No ERROR findings. Warnings do not block. */
  ok: boolean;
  findings: ValidationFinding[];
  checkedAt: string;
};

// ─────────────────────────── Inputs ───────────────────────────

export type MetricRef = {
  id: string;
  key: string;
  name: string;
  dataProductId: string;
  certifiedAt: Date | null;
  semanticRef: string;
};

export type ProductRef = {
  id: string;
  key: string;
  name: string;
  layer: string;
  sensitivity: string;
  contractVersion: string;
  contractMajor: number;
  semanticModelVersion: string;
  /** Entities and dimensions the semantic model exposes by name. */
  semanticEntities?: string[];
  metrics: MetricRef[];
};

export type BindingDraft = {
  /** Stable id for message anchoring; a temporary id is fine for an unsaved draft. */
  id: string;
  dataProductId: string;
  type: BindingType;
  purpose: string;
  metricIds: string[];
  /** Contract version the author is binding against. */
  boundContractVersion: string;
  boundContractMajor: number;
};

export type BindingContext = {
  products: ProductRef[];
  rules?: PhysicalReferenceRules;
  /** Present when the agent has committed a tool specification. */
  hasToolSpecs?: boolean;
  /** Agent's declared sensitivity, for the escalation warning. */
  agentSensitivity?: string | null;
};

const SENSITIVITY_RANK: Record<string, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  RESTRICTED: 3,
};

function report(findings: ValidationFinding[]): ValidationReport {
  return {
    ok: findings.every((f) => f.severity !== "ERROR"),
    findings,
    checkedAt: new Date().toISOString(),
  };
}

// ───────────────────── Binding validation ─────────────────────

export function validateBindingDraft(
  draft: BindingDraft,
  ctx: BindingContext,
): ValidationReport {
  const rules = compileRules(ctx.rules ?? DEFAULT_REFERENCE_RULES);
  const findings: ValidationFinding[] = [];
  const product = ctx.products.find((p) => p.id === draft.dataProductId);

  if (!product) {
    return report([
      {
        code: "METRIC_NOT_ON_BOUND_PRODUCT",
        severity: "ERROR",
        message: "This binding points at a data product that is not registered in this workspace.",
        suggestedFix:
          "Pick a registered data product, or register the one you meant from its DPF export first.",
        subject: { kind: "binding", id: draft.id, field: "dataProductId" },
      },
    ]);
  }

  // Layer 1 — structural. The product's own serving layer.
  if (rules.deniedLayers.has(product.layer.toUpperCase())) {
    findings.push({
      code: "PHYSICAL_TABLE_REFERENCE",
      severity: "ERROR",
      message: `${product.name} is served from the ${product.layer} layer, which holds physical tables rather than certified data.`,
      suggestedFix: `Bind to the Gold or semantic-layer product built on top of ${product.name}. If there isn't one yet, that is the work — an agent cannot be the first consumer of raw data.`,
      subject: { kind: "binding", id: draft.id, field: "dataProductId" },
    });
  } else if (!rules.allowedLayers.has(product.layer.toUpperCase())) {
    findings.push({
      code: "PHYSICAL_TABLE_REFERENCE",
      severity: "ERROR",
      message: `${product.name} is served from an unrecognised layer (${product.layer}), so we cannot tell whether it is certified.`,
      suggestedFix: `Set the product's layer to one of: ${[...rules.allowedLayers].join(", ")}.`,
      subject: { kind: "binding", id: draft.id, field: "dataProductId" },
    });
  }

  // Layer 2 — lexical, on the one free-text field a binding has.
  findings.push(
    ...scanText(draft.purpose, rules, {
      kind: "binding",
      id: draft.id,
      field: "purpose",
    }),
  );

  // QUERIES must name at least one certified metric.
  if (draft.type === "QUERIES" && draft.metricIds.length === 0) {
    findings.push({
      code: "QUERIES_REQUIRES_METRIC",
      severity: "ERROR",
      message: `This binding queries ${product.name} but doesn't name a certified metric, so there is no agreed number behind the agent's answers.`,
      suggestedFix:
        product.metrics.length > 0
          ? `Pick one of the ${product.metrics.length} certified metrics on ${product.name} (${product.metrics.slice(0, 3).map((m) => m.key).join(", ")}), or change the binding type to "Grounds on" if this product is context rather than numbers.`
          : `${product.name} has no certified metrics yet. Certify one on the product first, or change the binding type to "Grounds on".`,
      subject: { kind: "binding", id: draft.id, field: "metricIds" },
    });
  }

  // Layer 3 — resolution. Every named metric must exist on the bound product
  // and be certified. Unresolvable references fail closed.
  for (const metricId of draft.metricIds) {
    const metric = product.metrics.find((m) => m.id === metricId);
    if (!metric) {
      const elsewhere = ctx.products
        .flatMap((p) => p.metrics.map((m) => ({ product: p, metric: m })))
        .find((entry) => entry.metric.id === metricId);
      findings.push({
        code: "METRIC_NOT_ON_BOUND_PRODUCT",
        severity: "ERROR",
        message: elsewhere
          ? `${elsewhere.metric.name} belongs to ${elsewhere.product.name}, not to ${product.name}.`
          : `This binding names a metric that does not exist on ${product.name}.`,
        suggestedFix: elsewhere
          ? `Add a second binding to ${elsewhere.product.name} for that metric, or choose a metric that ${product.name} actually certifies.`
          : `Choose a metric from ${product.name}'s certified list.`,
        subject: { kind: "binding", id: draft.id, field: "metricIds" },
      });
      continue;
    }
    if (!metric.certifiedAt) {
      findings.push({
        code: "METRIC_NOT_CERTIFIED",
        severity: "ERROR",
        message: `${metric.name} is defined on ${product.name} but has not been certified, so nobody has signed off on what it means.`,
        suggestedFix: `Ask ${product.name}'s owner to certify ${metric.key}, or bind to a metric that is already certified.`,
        subject: { kind: "binding", id: draft.id, field: "metricIds" },
      });
    }
    if (matchesDeniedIdentifier(metric.semanticRef, rules)) {
      findings.push({
        code: "PHYSICAL_TABLE_REFERENCE",
        severity: "ERROR",
        message: `${metric.name} resolves to "${metric.semanticRef}", which is a physical table rather than a semantic-model reference.`,
        suggestedFix: `Point the metric at its semantic-model entity. Agents answer through the semantic layer, so a metric defined directly on a table cannot be bound.`,
        subject: { kind: "binding", id: draft.id, field: "metricIds" },
      });
    }
  }

  // The version pin must be a version the product actually has.
  if (draft.boundContractMajor < product.contractMajor) {
    findings.push({
      code: "CONTRACT_PIN_STALE",
      severity: "ERROR",
      message: `This binding is pinned to ${product.name} contract ${draft.boundContractVersion}, but the product is now on ${product.contractVersion} — a breaking change.`,
      suggestedFix: `Review what changed in ${product.contractVersion}, then re-approve the binding against the new contract.`,
      subject: { kind: "binding", id: draft.id, field: "boundContractVersion" },
    });
  }

  if (draft.type === "ACTS_VIA" && ctx.hasToolSpecs === false) {
    findings.push({
      code: "ACTS_VIA_REQUIRES_TOOL_SPEC",
      severity: "ERROR",
      message: `This agent acts through ${product.name}, but no tool specification says what it is allowed to do.`,
      suggestedFix:
        "Add a tool specification at Stage 4 with the function's inputs, outputs, refusal rules, and escalation path.",
      subject: { kind: "binding", id: draft.id, field: "type" },
    });
  }

  // Advisory: the agent will inherit this product's classification.
  const agentRank = SENSITIVITY_RANK[ctx.agentSensitivity ?? "PUBLIC"] ?? 0;
  const productRank = SENSITIVITY_RANK[product.sensitivity] ?? 0;
  if (productRank > agentRank) {
    findings.push({
      code: "SENSITIVITY_ESCALATION",
      severity: "WARNING",
      message: `Binding to ${product.name} raises this agent's classification to ${product.sensitivity}.`,
      suggestedFix:
        "Expect the Privacy Officer's review at Stage 6. Nothing to change now — this is a heads-up, not a rejection.",
      subject: { kind: "binding", id: draft.id, field: "dataProductId" },
    });
  }

  return report(findings);
}

// ───────────────── Grounding packs and tool specs ─────────────────

/**
 * Scans an arbitrary document for physical-table references.
 *
 * Walks every string in the structure rather than checking known fields —
 * a guardrail that only inspects the fields you remembered is not a guardrail.
 */
export function validateDocumentReferences(
  document: unknown,
  subjectKind: "grounding-pack" | "tool-spec",
  subjectId: string,
  ctx: BindingContext = { products: [] },
): ValidationReport {
  const rules = compileRules(ctx.rules ?? DEFAULT_REFERENCE_RULES);
  const findings: ValidationFinding[] = [];

  walk(document, "", (path, key, value) => {
    if (rules.forbiddenFields.has(key.toLowerCase())) {
      findings.push({
        code: "FREEFORM_SQL_FIELD",
        severity: "ERROR",
        message: `This ${subjectKind === "tool-spec" ? "tool specification" : "grounding pack"} has a free-form "${key}" field, which lets the agent write its own query at runtime.`,
        suggestedFix:
          "Remove the field and name a certified metric instead. Whatever is in it today, a query field is a text-to-SQL surface — that is the one thing an agent may not have.",
        subject: { kind: subjectKind, id: subjectId, field: path },
      });
      return;
    }
    if (typeof value === "string") {
      findings.push(...scanText(value, rules, { kind: subjectKind, id: subjectId, field: path }));
    }
  });

  return report(findings);
}

/** Lexical scan of one string: SQL table references and denied identifiers. */
function scanText(
  text: string,
  rules: CompiledRules,
  subject: ValidationFinding["subject"],
): ValidationFinding[] {
  if (!text) return [];
  const findings: ValidationFinding[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(SQL_TABLE_REFERENCE)) {
    const identifier = match[1];
    if (!identifier || seen.has(identifier)) continue;
    seen.add(identifier);
    findings.push({
      code: "PHYSICAL_TABLE_REFERENCE",
      severity: "ERROR",
      message: `This reads from "${identifier}" with a SQL query. Agents answer through certified metrics, not by querying tables directly.`,
      suggestedFix: `Replace the query with a certified metric that already encodes this logic — and has an owner and a contract behind it.`,
      subject,
    });
  }

  for (const token of text.split(/[\s,;()'"`\[\]]+/)) {
    if (!token || seen.has(token)) continue;
    if (matchesDeniedIdentifier(token, rules)) {
      seen.add(token);
      findings.push({
        code: "PHYSICAL_TABLE_REFERENCE",
        severity: "ERROR",
        message: `"${token}" is a physical table in a raw or intermediate layer, not a certified metric.`,
        suggestedFix: `Use the certified metric built on top of it. If none exists, certifying one is the prerequisite — an agent cannot be the first consumer of an uncertified table.`,
        subject,
      });
    }
  }

  return findings;
}

function walk(
  value: unknown,
  path: string,
  visit: (path: string, key: string, value: unknown) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}/${index}`, visit));
    return;
  }
  if (value === null || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}/${key}`;
    visit(childPath, key, child);
    walk(child, childPath, visit);
  }
}

/** Merges several reports, preserving order. */
export function mergeReports(...reports: ValidationReport[]): ValidationReport {
  return report(reports.flatMap((r) => r.findings));
}
