/**
 * The question-coverage matrix.
 *
 * Questions down the side, bindings across the top, the certified metric in the
 * cell. Stage 3 does not exit until every row has at least one cell — which is
 * the structural version of "prove this agent can actually answer what you
 * said it would answer".
 */
import type { BindingType, IntentClass } from "@/lib/enums";

import type { ValidationFinding, ValidationReport } from "./validate";

export type CoverageQuestion = {
  id: string;
  text: string;
  personaId: string;
  personaName: string;
  intentClass: IntentClass;
};

export type CoverageBinding = {
  id: string;
  productName: string;
  productId: string;
  type: BindingType;
};

export type CoverageCell = { metricKeys: string[] };

export type CoverageMatrix = {
  questions: CoverageQuestion[];
  bindings: CoverageBinding[];
  /** cells[questionId][bindingId] — absent means no coverage. */
  cells: Record<string, Record<string, CoverageCell>>;
  coveredCount: number;
  totalCount: number;
  /** Exactly what the Stage 3 exit criterion reads. */
  isComplete: boolean;
  uncoveredQuestionIds: string[];
};

export type CoverageInput = {
  questions: CoverageQuestion[];
  bindings: CoverageBinding[];
  rows: { questionId: string; bindingId: string; metricKey: string | null }[];
};

export function computeCoverageMatrix(input: CoverageInput): CoverageMatrix {
  const cells: Record<string, Record<string, CoverageCell>> = {};

  for (const row of input.rows) {
    const byBinding = (cells[row.questionId] ??= {});
    const cell = (byBinding[row.bindingId] ??= { metricKeys: [] });
    if (row.metricKey && !cell.metricKeys.includes(row.metricKey)) {
      cell.metricKeys.push(row.metricKey);
    }
  }

  const uncoveredQuestionIds = input.questions
    .filter((question) => Object.keys(cells[question.id] ?? {}).length === 0)
    .map((question) => question.id);

  return {
    questions: input.questions,
    bindings: input.bindings,
    cells,
    coveredCount: input.questions.length - uncoveredQuestionIds.length,
    totalCount: input.questions.length,
    isComplete: input.questions.length > 0 && uncoveredQuestionIds.length === 0,
    uncoveredQuestionIds,
  };
}

/**
 * A question is valid only when it is mapped to at least one binding on the
 * same agent. An orphan question is the most common reason Stage 3 refuses to
 * close, so the message names the question rather than counting them.
 */
export function validateCoverage(matrix: CoverageMatrix): ValidationReport {
  const findings: ValidationFinding[] = matrix.uncoveredQuestionIds.map((questionId) => {
    const question = matrix.questions.find((q) => q.id === questionId);
    return {
      code: "QUESTION_NOT_COVERED" as const,
      severity: "ERROR" as const,
      message: `Nothing answers "${question?.text ?? questionId}" yet.`,
      suggestedFix:
        matrix.bindings.length === 0
          ? "Add a data product binding first, then map this question to it."
          : `Map it to one of the ${matrix.bindings.length} bindings on this agent, or remove the question if the agent is not meant to answer it.`,
      subject: { kind: "question" as const, id: questionId },
    };
  });

  return {
    ok: findings.length === 0,
    findings,
    checkedAt: new Date().toISOString(),
  };
}
