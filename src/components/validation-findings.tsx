import type { ValidationFinding } from "@/lib/bindings/validate";

/**
 * Validator output.
 *
 * This is a demo moment, not an error log: the message says what is wrong in
 * the reader's vocabulary, the fix says what to do about it, and the rule code
 * is present but quiet — enough for an auditor, not enough to frighten a
 * business user.
 */
export function ValidationFindings({ findings }: { findings: ValidationFinding[] }) {
  if (findings.length === 0) return null;

  return (
    <ul className="space-y-3">
      {findings.map((finding, index) => {
        const isError = finding.severity === "ERROR";
        return (
          <li
            key={`${finding.code}-${finding.subject.field ?? ""}-${index}`}
            className={
              isError
                ? "rounded-lg border-l-4 border-danger bg-danger/5 px-4 py-3"
                : "rounded-lg border-l-4 border-warning bg-warning-tint px-4 py-3"
            }
          >
            <p className={isError ? "font-medium text-danger" : "font-medium text-warning"}>
              {finding.message}
            </p>
            <p className="mt-1 text-brand-ink">
              <span className="font-medium">Fix:</span> {finding.suggestedFix}
            </p>
            <p className="mt-1 text-xs text-muted">
              Rule {finding.code.toLowerCase().replace(/_/g, " ")}
              {finding.subject.field ? ` · ${finding.subject.field}` : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
