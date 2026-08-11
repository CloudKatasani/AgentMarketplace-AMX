"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { trackTourStepAction } from "@/app/(app)/agents/[id]/stages/[stage]/actions";

/**
 * The five-step tour that follows onboarding.
 *
 * It ends on the coverage matrix deliberately: that is the first screen where
 * the product's claim becomes visible — this question, this metric, this
 * certified product — and the whole time-to-first-wow budget exists to get
 * someone there.
 *
 * The agent id travels in the URL so the tour needs no server state and no
 * session flag to resume; closing it is simply navigating without `?tour=`.
 */
const STEPS = [
  {
    key: "workspace",
    title: "Your workspace is not empty",
    body: "You already have an agent part-way through its lifecycle and two certified data products. Nothing here is a placeholder — it is the worked example the rest of the tour walks through.",
    href: (agent: string) => `/agents/${agent}?tour=2&agent=${agent}`,
    cta: "Open the agent",
  },
  {
    key: "agent",
    title: "Agents are chartered, not deployed",
    body: "Eight gated stages, a named owner, and an explicit list of what this agent must never do. The rail at the top shows how far it has got.",
    href: (agent: string) => `/agents/${agent}/stages/1-consumption-discovery?tour=3&agent=${agent}`,
    cta: "See where it started",
  },
  {
    key: "consumption",
    title: "It starts with a blocked decision",
    body: "Not a model, not a framework — a named role, the decision they own, and the questions they cannot answer today. Everything downstream is accountable to this list.",
    href: (agent: string) => `/data-products?tour=4&agent=${agent}`,
    cta: "See what it stands on",
  },
  {
    key: "products",
    title: "Certified data products, with their dependents",
    body: "Each product shows its contract version, quality score, and every agent bound to it. Publish a breaking version here and dependent certifications go stale immediately.",
    href: (agent: string) => `/agents/${agent}/stages/3-data-product-binding?tour=5&agent=${agent}#matrix`,
    cta: "See the coverage matrix",
  },
  {
    key: "coverage",
    title: "This is the part nothing else does",
    body: "Every question, the binding that answers it, and the certified metric behind the number. Stage 3 will not close until every row is covered — which is how an agent proves it can answer what it claims.",
    href: () => "/agents",
    cta: "Finish the tour",
  },
] as const;

export function GuidedTour() {
  const params = useSearchParams();
  const step = Number(params.get("tour") ?? "0");
  const agent = params.get("agent") ?? "";
  const index = step - 1;
  const current = STEPS[index];

  useEffect(() => {
    if (!current) return;
    void trackTourStepAction(current.key, step);
  }, [current, step]);

  if (!current) return null;

  const isLast = index === STEPS.length - 1;

  return (
    <aside className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-panel shadow-lg">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-start gap-4 px-6 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-deep">
            Step {step} of {STEPS.length}
          </p>
          <p className="mt-1 text-section-title">{current.title}</p>
          <p className="mt-1 max-w-prose text-brand-ink">{current.body}</p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={agent ? current.href(agent) : "/agents"}
            className="inline-flex h-10 items-center rounded bg-brand-primary px-4 font-medium text-surface no-underline hover:bg-brand-deep"
          >
            {isLast ? "Finish" : current.cta}
          </Link>
          <Link href={agent ? `/agents/${agent}` : "/agents"} className="text-muted">
            Skip
          </Link>
        </div>
      </div>
    </aside>
  );
}
