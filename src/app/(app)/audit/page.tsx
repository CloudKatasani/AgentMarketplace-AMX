import { PrismaClient } from "@prisma/client";

import { AuditTrail } from "@/components/audit-trail";
import { Muted, PageTitle, Panel } from "@/components/ui/primitives";
import { requireSessionContext } from "@/lib/auth/session-context";
import { verifyAuditChain } from "@/lib/audit/append";
import { withOrg } from "@/lib/db/scope";

const users = new PrismaClient();

export default async function AuditPage() {
  const session = await requireSessionContext();

  const { events, verification } = await withOrg(session.organizationId, async (db) => {
    const [events, verification] = await Promise.all([
      db.auditEvent.findMany({ orderBy: { sequence: "desc" }, take: 200 }),
      verifyAuditChain(db, session.organizationId),
    ]);
    return { events, verification };
  });

  const actorIds = [...new Set(events.map((e) => e.actorUserId).filter(Boolean))] as string[];
  const actors = await users.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <PageTitle>Audit trail</PageTitle>
        <Muted className="mt-1">
          Everything that happened in this organisation, in order, append-only.
        </Muted>
      </div>
      <Panel>
        <AuditTrail
          events={events}
          verification={verification}
          actorNames={Object.fromEntries(actors.map((a) => [a.id, a.name]))}
        />
      </Panel>
    </div>
  );
}
