import Link from "next/link";
import { notFound } from "next/navigation";
import { PrismaClient } from "@prisma/client";

import { AuditTrail } from "@/components/audit-trail";
import { Muted, PageTitle, Panel } from "@/components/ui/primitives";
import { requireSessionContext } from "@/lib/auth/session-context";
import { verifyAuditChain } from "@/lib/audit/append";
import { withOrg } from "@/lib/db/scope";

const users = new PrismaClient();

/**
 * The agent-scoped view of the trail: every event whose subject is this agent,
 * or whose payload names it. The chain is verified across the whole
 * organisation, because a chain checked in slices proves nothing.
 */
export default async function AgentAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSessionContext();

  const data = await withOrg(session.organizationId, async (db) => {
    const agent = await db.agent.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!agent) return null;

    const [events, verification] = await Promise.all([
      db.auditEvent.findMany({ orderBy: { sequence: "desc" }, take: 400 }),
      verifyAuditChain(db, session.organizationId),
    ]);

    return {
      agent,
      verification,
      events: events.filter(
        (event) =>
          (event.subjectType === "Agent" && event.subjectId === id) ||
          event.payload.includes(`"agentId":"${id}"`),
      ),
    };
  });

  if (!data) notFound();

  const actorIds = [...new Set(data.events.map((e) => e.actorUserId).filter(Boolean))] as string[];
  const actors = await users.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/agents/${data.agent.id}`} className="text-muted">
          ← {data.agent.name}
        </Link>
        <PageTitle className="mt-1">Audit trail</PageTitle>
        <Muted className="mt-1">
          Every decision, commit, and cascade that touched this agent.
        </Muted>
      </div>
      <Panel>
        <AuditTrail
          events={data.events}
          verification={data.verification}
          actorNames={Object.fromEntries(actors.map((a) => [a.id, a.name]))}
        />
      </Panel>
    </div>
  );
}
