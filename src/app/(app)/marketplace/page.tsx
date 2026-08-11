import Link from "next/link";

import { EmptyState, Band, Muted, PageTitle, Panel, SectionTitle } from "@/components/ui/primitives";
import { Badge, CertificationBadge } from "@/components/ui/status";
import { requireSessionContext } from "@/lib/auth/session-context";
import { withOrg } from "@/lib/db/scope";
import type { CertificationStatus } from "@/lib/enums";

/**
 * The marketplace — the front door.
 *
 * The persona lens is the primary control, not a filter buried in a sidebar.
 * "I am a Revenue Assurance Analyst" is how a business user actually arrives,
 * and ranking by *question coverage for that persona* answers the only
 * question they have: can this thing answer what I need to know?
 */
export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    persona?: string;
    archetype?: string;
    risk?: string;
    certification?: string;
  }>;
}) {
  const session = await requireSessionContext();
  const filters = await searchParams;

  const data = await withOrg(session.organizationId, async (db) => {
    const [agents, personas] = await Promise.all([
      db.agent.findMany({
        where: { archivedAt: null, status: { in: ["PUBLISHED", "DEPRECATED", "IN_PROGRESS"] } },
        orderBy: { name: "asc" },
        select: {
          id: true,
          slug: true,
          name: true,
          summary: true,
          archetype: true,
          riskTier: true,
          sensitivity: true,
          status: true,
          certification: true,
          staleReason: true,
          domain: { select: { name: true } },
          personas: { select: { persona: { select: { id: true, name: true } } } },
          questions: {
            where: { archivedAt: null },
            select: { id: true, personaId: true, coverage: { select: { id: true } } },
          },
          bindings: {
            where: { archivedAt: null },
            select: {
              status: true,
              dataProduct: {
                select: { name: true, qualityScore: true, lastRefreshedAt: true },
              },
            },
          },
        },
      }),
      db.persona.findMany({
        where: { archivedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
    return { agents, personas };
  });

  const query = (filters.q ?? "").trim().toLowerCase();

  const scored = data.agents
    .map((agent) => {
      const relevant = filters.persona
        ? agent.questions.filter((q) => q.personaId === filters.persona)
        : agent.questions;
      const covered = relevant.filter((q) => q.coverage.length > 0).length;

      return {
        agent,
        personaQuestionCount: relevant.length,
        coveredCount: covered,
        coverageShare: relevant.length === 0 ? 0 : covered / relevant.length,
        quality:
          agent.bindings.length === 0
            ? 0
            : Math.round(
                agent.bindings.reduce((sum, b) => sum + b.dataProduct.qualityScore, 0) /
                  agent.bindings.length,
              ),
      };
    })
    .filter((row) => {
      const agent = row.agent;
      if (filters.persona && row.personaQuestionCount === 0) return false;
      if (filters.archetype && agent.archetype !== filters.archetype) return false;
      if (filters.risk && agent.riskTier !== filters.risk) return false;
      if (filters.certification && agent.certification !== filters.certification) return false;
      if (query) {
        const haystack = `${agent.name} ${agent.summary} ${agent.archetype ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (filters.persona) {
        if (b.coverageShare !== a.coverageShare) return b.coverageShare - a.coverageShare;
        if (b.coveredCount !== a.coveredCount) return b.coveredCount - a.coveredCount;
      }
      const rank = (status: string) =>
        status === "PEER_CERTIFIED" ? 0 : status === "SELF_ATTESTED" ? 1 : status === "STALE" ? 2 : 3;
      return rank(a.agent.certification) - rank(b.agent.certification);
    });

  const activePersona = data.personas.find((p) => p.id === filters.persona);

  const link = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...filters, ...next };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `/marketplace?${qs}` : "/marketplace";
  };

  return (
    <div className="space-y-6">
      <div>
        <PageTitle>Marketplace</PageTitle>
        <Muted className="mt-1 max-w-prose">
          Every agent in this organisation, what it answers, and what it stands on.
        </Muted>
      </div>

      <Panel>
        <SectionTitle>I am a…</SectionTitle>
        <Muted className="mt-1">
          Pick your role and agents are ranked by how much of what <em>you</em> need to know they
          can actually answer.
        </Muted>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={link({ persona: undefined })}
            className={
              filters.persona
                ? "rounded border border-border px-3 py-1.5 no-underline hover:bg-panel"
                : "rounded bg-brand-primary px-3 py-1.5 text-surface no-underline"
            }
          >
            Anyone
          </Link>
          {data.personas.map((persona) => (
            <Link
              key={persona.id}
              href={link({ persona: persona.id })}
              className={
                filters.persona === persona.id
                  ? "rounded bg-brand-primary px-3 py-1.5 text-surface no-underline"
                  : "rounded border border-border px-3 py-1.5 no-underline hover:bg-panel"
              }
            >
              {persona.name}
            </Link>
          ))}
        </div>

        <form className="mt-4 flex flex-wrap items-end gap-3" action="/marketplace">
          {filters.persona ? (
            <input type="hidden" name="persona" value={filters.persona} />
          ) : null}
          <div className="min-w-48 flex-1">
            <label htmlFor="q" className="mb-1 block font-medium">
              Search
            </label>
            <input
              id="q"
              name="q"
              defaultValue={filters.q}
              placeholder="churn, billing, outage…"
              className="h-10 w-full rounded border border-border bg-surface px-3 text-body"
            />
          </div>
          {(
            [
              ["archetype", "Archetype", ["Analyst", "Advisor", "Monitor", "Operator", "Navigator", "Educator"]],
              ["risk", "Risk tier", ["informational", "decision-support", "action-taking"]],
              [
                "certification",
                "Certification",
                ["PEER_CERTIFIED", "SELF_ATTESTED", "STALE", "NONE"],
              ],
            ] as const
          ).map(([name, label, values]) => (
            <div key={name}>
              <label htmlFor={name} className="mb-1 block font-medium">
                {label}
              </label>
              <select
                id={name}
                name={name}
                defaultValue={filters[name as keyof typeof filters] ?? ""}
                className="h-10 rounded border border-border bg-surface px-3 text-body"
              >
                <option value="">Any</option>
                {values.map((value) => (
                  <option key={value} value={value}>
                    {value.toLowerCase().replace(/_/g, "-")}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <button
            type="submit"
            className="h-10 rounded bg-brand-primary px-4 font-medium text-surface"
          >
            Apply
          </button>
        </form>
      </Panel>

      {activePersona ? (
        <Band>
          Ranked for <span className="font-medium">{activePersona.name}</span> by how many of their
          questions have a certified answer behind them.
        </Band>
      ) : null}

      {scored.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          body="No agent in this organisation matches those filters yet. Clear the persona lens, or charter an agent for this role."
        />
      ) : (
        <ul className="space-y-3">
          {scored.map(({ agent, coveredCount, personaQuestionCount, coverageShare, quality }) => (
            <li key={agent.id}>
              <Panel>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/marketplace/${agent.slug}`} className="text-section-title no-underline">
                      {agent.name}
                    </Link>
                    <p className="mt-1 max-w-prose text-muted">{agent.summary}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {agent.archetype ? <Badge tone="neutral">{agent.archetype}</Badge> : null}
                    <CertificationBadge status={agent.certification as CertificationStatus} />
                    {agent.status === "DEPRECATED" ? <Badge tone="warning">deprecated</Badge> : null}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-muted">
                  <span>
                    {coveredCount} of {personaQuestionCount} question
                    {personaQuestionCount === 1 ? "" : "s"} answered
                    {activePersona ? ` for ${activePersona.name}` : ""}
                    {personaQuestionCount > 0 ? ` (${Math.round(coverageShare * 100)}%)` : ""}
                  </span>
                  <span>
                    {agent.bindings.length} product{agent.bindings.length === 1 ? "" : "s"}
                    {quality > 0 ? ` · avg quality ${quality}` : ""}
                  </span>
                  {agent.riskTier ? <span>{agent.riskTier}</span> : null}
                  {agent.sensitivity ? <span>{agent.sensitivity}</span> : null}
                </div>

                {agent.staleReason ? (
                  <p className="mt-3 rounded bg-warning-tint px-3 py-2 text-warning">
                    {agent.staleReason}
                  </p>
                ) : null}
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
