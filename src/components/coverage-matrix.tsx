import { Band } from "@/components/ui/primitives";
import type { CoverageMatrix as Matrix } from "@/lib/bindings/coverage";
import { BINDING_TYPE_LABELS } from "@/lib/enums";

/**
 * Questions down the side, bindings across the top, the certified metric in the
 * cell. This is the screen that answers "what does this agent stand on?" one
 * row at a time — and the one Stage 3 will not close without.
 */
export function CoverageMatrix({ matrix }: { matrix: Matrix }) {
  if (matrix.totalCount === 0 || matrix.bindings.length === 0) {
    return (
      <Band>
        The matrix fills in once this agent has both questions and bindings. Questions come from
        Stage 1; bindings are declared above.
      </Band>
    );
  }

  return (
    <div className="space-y-3">
      <Band>
        {matrix.isComplete ? (
          <>
            <span className="font-medium">All {matrix.totalCount} questions are covered.</span>{" "}
            Every question has a certified metric behind it, so Stage 3 can close.
          </>
        ) : (
          <>
            <span className="font-medium">
              {matrix.coveredCount} of {matrix.totalCount} questions covered.
            </span>{" "}
            Stage 3 does not close until every question has at least one binding that answers it.
          </>
        )}
      </Band>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-band">
              <th scope="col" className="px-3 py-row font-semibold">
                Question
              </th>
              {matrix.bindings.map((binding) => (
                <th key={binding.id} scope="col" className="px-3 py-row font-semibold">
                  <span className="block">{binding.productName}</span>
                  <span
                    className="block text-xs font-normal text-muted"
                    title={BINDING_TYPE_LABELS[binding.type]}
                  >
                    {binding.type.replace(/_/g, " ").toLowerCase()}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.questions.map((question) => {
              const covered = !matrix.uncoveredQuestionIds.includes(question.id);
              return (
                <tr
                  key={question.id}
                  className={covered ? "border-b border-border" : "border-b border-border bg-warning-tint/40"}
                >
                  <th scope="row" className="max-w-md px-3 py-row font-normal align-top">
                    <span className="block">{question.text}</span>
                    <span className="block text-xs text-muted">
                      {question.personaName} · {question.intentClass}
                    </span>
                  </th>
                  {matrix.bindings.map((binding) => {
                    const cell = matrix.cells[question.id]?.[binding.id];
                    return (
                      <td key={binding.id} className="px-3 py-row align-top">
                        {cell ? (
                          <span className="text-success">
                            ✓{" "}
                            <span className="text-brand-ink">
                              {cell.metricKeys.length > 0
                                ? cell.metricKeys.join(", ")
                                : "context only"}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
