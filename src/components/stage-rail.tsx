import Link from "next/link";

import { cn } from "@/lib/cn";
import { STAGES } from "@/lib/lifecycle/stages";

/**
 * The eight stages, always visible.
 *
 * Showing the whole path — including the stages not reached yet — is what makes
 * the lifecycle feel like a route rather than a series of surprises.
 */
export function StageRail({
  agentId,
  currentStageId,
  statusByStage,
}: {
  agentId: string;
  currentStageId: string;
  statusByStage: Record<string, string>;
}) {
  return (
    <ol className="flex flex-wrap gap-2">
      {STAGES.map((stage) => {
        const status = statusByStage[stage.key] ?? "NOT_STARTED";
        const isCurrent = stage.key === currentStageId;

        return (
          <li key={stage.key}>
            <Link
              href={`/agents/${agentId}/stages/${stage.key}`}
              className={cn(
                "flex items-center gap-2 rounded border px-3 py-2 no-underline transition-colors",
                isCurrent
                  ? "border-brand-primary bg-brand-primary text-surface"
                  : "border-border bg-surface text-brand-ink hover:bg-panel",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold",
                  isCurrent ? "bg-brand-deep text-surface" : statusStyle(status),
                )}
              >
                {status === "APPROVED" ? "✓" : stage.ordinal}
              </span>
              <span className="text-xs font-medium">{stage.name}</span>
              {status === "STALE" && !isCurrent ? (
                <span className="text-xs text-warning">stale</span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function statusStyle(status: string): string {
  switch (status) {
    case "APPROVED":
      return "bg-success/10 text-success";
    case "STALE":
      return "bg-warning-tint text-warning";
    case "SUBMITTED":
      return "bg-brand-accent/20 text-brand-deep";
    case "CHANGES_REQUESTED":
      return "bg-danger/10 text-danger";
    default:
      return "bg-band text-muted";
  }
}
