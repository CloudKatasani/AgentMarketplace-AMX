import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState, Muted, PageTitle, Panel } from "@/components/ui/primitives";
import { Badge, CertificationBadge } from "@/components/ui/status";
import { requireSessionContext } from "@/lib/auth/session-context";
import { withOrg } from "@/lib/db/scope";
import type { CertificationStatus } from "@/lib/enums";
import { stageByKey } from "@/lib/lifecycle/stages";

export default async function AgentsPage() {
  const session = await requireSessionContext();

  const agents = await withOrg(session.organizationId, (db) =>
    db.agent.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        summary: true,
        archetype: true,
        riskTier: true,
        currentStageId: true,
        status: true,
        certification: true,
        staleReason: true,
        _count: { select: { questions: true, bindings: true } },
      },
    }),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <PageTitle>Agents</PageTitle>
          <Muted className="mt-1">
            Every agent in this workspace, and how far through the lifecycle it has got.
          </Muted>
        </div>
      </div>

      {agents.length === 0 ? (
        <EmptyState
          title="No agents yet"
          body="An agent starts with the person whose decision is blocked — not with a model. Begin by naming that persona and the questions they cannot answer today."
          action={
            <Button asChild>
              <Link href="/agents/new">Charter an agent</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {agents.map((agent) => {
            const stage = stageByKey(agent.currentStageId);
            return (
              <li key={agent.id}>
                <Panel className="transition-colors hover:bg-panel">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/agents/${agent.id}`}
                        className="text-section-title no-underline"
                      >
                        {agent.name}
                      </Link>
                      <p className="mt-1 max-w-prose text-muted">{agent.summary}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {agent.archetype ? <Badge tone="neutral">{agent.archetype}</Badge> : null}
                      <CertificationBadge
                        status={agent.certification as CertificationStatus}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-muted">
                    <span>
                      Stage {stage.ordinal} of 8 · <span className="text-brand-ink">{stage.name}</span>
                    </span>
                    <span>{agent._count.questions} questions</span>
                    <span>{agent._count.bindings} bindings</span>
                    {agent.riskTier ? <span>{agent.riskTier}</span> : null}
                  </div>

                  {agent.staleReason ? (
                    <p className="mt-3 rounded bg-warning-tint px-3 py-2 text-warning">
                      {agent.staleReason}
                    </p>
                  ) : null}
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
