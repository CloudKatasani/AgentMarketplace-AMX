import Link from "next/link";

import type { CriterionResult } from "@/lib/lifecycle/types";

/**
 * The stage checklist.
 *
 * A blocked gate should read as guidance, not as a wall — so every unsatisfied
 * criterion shows its plain-language detail and its one next action inline,
 * rather than a red cross and a support ticket.
 */
export function CriteriaList({ results }: { results: CriterionResult[] }) {
  if (results.length === 0) {
    return (
      <p className="text-muted">
        This stage&rsquo;s exit criteria arrive with its authoring screens in a later phase.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {results.map((criterion) => (
        <li key={criterion.key} className="flex gap-3 py-3">
          <Marker satisfied={criterion.satisfied} blocking={criterion.blocking} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {criterion.label}
              {!criterion.blocking ? (
                <span className="ml-2 text-xs font-normal text-muted">advisory</span>
              ) : null}
            </p>
            <p className="mt-0.5 text-muted">{criterion.detail}</p>
            {!criterion.satisfied && criterion.fix ? (
              <Link
                href={criterion.fix.href}
                className="mt-1 inline-block font-medium text-brand-primary underline underline-offset-2"
              >
                {criterion.fix.label}
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Marker({ satisfied, blocking }: { satisfied: boolean; blocking: boolean }) {
  if (satisfied) {
    return (
      <span aria-label="Satisfied" className="mt-0.5 font-semibold text-success">
        ✓
      </span>
    );
  }
  return (
    <span
      aria-label={blocking ? "Blocking" : "Advisory"}
      className={blocking ? "mt-0.5 font-semibold text-warning" : "mt-0.5 font-semibold text-muted"}
    >
      {blocking ? "!" : "·"}
    </span>
  );
}
