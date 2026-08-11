import Link from "next/link";
import { notFound } from "next/navigation";

import { CriteriaList } from "@/components/criteria-list";
import { StageRail } from "@/components/stage-rail";
import { Button } from "@/components/ui/button";
import { Band, Muted, PageTitle, Panel, SectionTitle } from "@/components/ui/primitives";
import { Badge, CertificationBadge, LifecycleBadge, StaleBanner } from "@/components/ui/status";
import { requireSessionContext } from "@/lib/auth/session-context";
import { withOrg } from "@/lib/db/scope";
import type { CertificationStatus } from "@/lib/enums";
import { loadStageContext } from "@/lib/lifecycle/context";
import { evaluateExitCriteria, stageByKey } from "@/lib/lifecycle/stages";
import { roleName } from "@/lib/roles";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSessionContext();

  const data = await withOrg(session.organizationId, async (db) => {
    const agent = await db.agent.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        summary: true,
        archetype: true,
        riskTier: true,
        sensitivity: true,
        currentStageId: true,
        status: true,
        certification: true,
        staleReason: true,
      },
    });
    if (!agent) return null;

    const [stageRuns, gates, tasks, ctx] = await Promise.all([
      db.stageRun.findMany({
        where: { agentId: id },
        select: { stageId: true, status: true },
      }),
      db.gate.findMany({
        where: { agentId: id },
        orderBy: [{ stageId: "asc" }, { round: "desc" }],
        select: {
          id: true,
          stageId: true,
          round: true,
          mode: true,
          status: true,
          approvals: { select: { roleId: true, decision: true, isSelfAttestation: true } },
        },
      }),
      db.task.findMany({
        where: { agentId: id, status: "OPEN" },
        orderBy: { createdAt: "desc" },
        select: { id: true, kind: true, title: true, description: true, assigneeRoleId: true },
      }),
      loadStageContext(db, session.organizationId, id, agent.currentStageId as never),
    ]);

    return { agent, stageRuns, gates, tasks, ctx };
  });

  if (!data?.agent) notFound();

  const { agent, stageRuns, gates, tasks, ctx } = data;
  const stage = stageByKey(agent.currentStageId);
  const evaluation = ctx ? evaluateExitCriteria(stage, ctx) : null;
  const openGate = gates.find((g) => g.status === "OPEN");
  const statusByStage = Object.fromEntries(stageRuns.map((run) => [run.stageId, run.status]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <PageTitle>{agent.name}</PageTitle>
          <Muted className="mt-1 max-w-prose">{agent.summary}</Muted>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {agent.archetype ? <Badge tone="neutral">{agent.archetype}</Badge> : null}
            {agent.riskTier ? <Badge tone="neutral">{agent.riskTier}</Badge> : null}
            {agent.sensitivity ? <Badge tone="neutral">{agent.sensitivity}</Badge> : null}
            <LifecycleBadge status={agent.status} />
            <CertificationBadge status={agent.certification as CertificationStatus} />
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href={`/agents/${agent.id}/audit`}>Audit trail</Link>
        </Button>
      </div>

      {agent.staleReason ? (
        <StaleBanner
          title="Re-certification pending"
          cause={agent.staleReason}
          action={
            <Button asChild size="sm">
              <Link href={`/agents/${agent.id}/stages/3-data-product-binding`}>
                Review the bindings
              </Link>
            </Button>
          }
        />
      ) : null}

      <StageRail
        agentId={agent.id}
        currentStageId={agent.currentStageId}
        statusByStage={statusByStage}
      />

      <Panel>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>
            Stage {stage.ordinal} · {stage.name}
          </SectionTitle>
          <Muted>{stage.purpose}</Muted>
        </div>

        <div className="mt-4">
          {evaluation ? <CriteriaList results={evaluation.results} /> : null}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link href={`/agents/${agent.id}/stages/${stage.key}`}>Open stage {stage.ordinal}</Link>
          </Button>
          {openGate ? (
            <Button asChild variant="outline">
              <Link href={`/agents/${agent.id}/gates/${openGate.id}`}>
                Review the open gate
              </Link>
            </Button>
          ) : null}
        </div>
      </Panel>

      {tasks.length > 0 ? (
        <Panel>
          <SectionTitle>Open tasks</SectionTitle>
          <Band className="mt-3">
            Every task here was raised by a cascade or a review decision — each one traces back
            to an audit event.
          </Band>
          <ul className="mt-3 divide-y divide-border">
            {tasks.map((task) => (
              <li key={task.id} className="py-3">
                <p className="font-medium">{task.title}</p>
                <p className="mt-0.5 text-muted">{task.description}</p>
                {task.assigneeRoleId ? (
                  <p className="mt-1 text-xs text-muted">For {roleName(task.assigneeRoleId)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel>
        <SectionTitle>Gates</SectionTitle>
        {gates.length === 0 ? (
          <Muted className="mt-2">
            Nothing has been submitted for review yet. Gates appear here as soon as a stage is
            submitted.
          </Muted>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {gates.map((gate) => (
              <li key={gate.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <Link href={`/agents/${agent.id}/gates/${gate.id}`} className="font-medium">
                    {stageByKey(gate.stageId).name}
                  </Link>
                  <span className="ml-2 text-muted">round {gate.round}</span>
                </span>
                {gate.mode === "SOLO_ATTESTATION" ? (
                  <Badge tone="brand">Self-review</Badge>
                ) : null}
                <GateStatusBadge status={gate.status} />
                <span className="text-muted">
                  {gate.approvals.length} decision{gate.approvals.length === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function GateStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "APPROVED":
      return <Badge tone="success">Approved</Badge>;
    case "VETOED":
      return <Badge tone="danger">Vetoed</Badge>;
    case "CHANGES_REQUESTED":
      return <Badge tone="warning">Changes requested</Badge>;
    case "STALE":
      return <Badge tone="warning">Stale</Badge>;
    default:
      return <Badge tone="brand">Open</Badge>;
  }
}
