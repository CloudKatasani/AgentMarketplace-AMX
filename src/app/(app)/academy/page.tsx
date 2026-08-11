import Link from "next/link";

import { Band, EmptyState, Muted, PageTitle, Panel, SectionTitle } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/status";
import { loadPathProgress } from "@/lib/academy";
import { requireSessionContext } from "@/lib/auth/session-context";
import { withOrg } from "@/lib/db/scope";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/**
 * The Academy.
 *
 * Five role paths, each ending in a credential that an organisation may
 * require before that role can approve anything. The labs point at live objects
 * in this workspace rather than at screenshots, which is what stops the
 * training drifting from the product.
 */
export default async function AcademyPage() {
  const session = await requireSessionContext();

  const organization = await db.organization.findUnique({
    where: { id: session.organizationId },
    select: { industryId: true, requireApproverCredentials: true },
  });

  const progress = await withOrg(session.organizationId, (client) =>
    loadPathProgress(client, {
      organizationId: session.organizationId,
      userId: session.userId,
      packKey: organization?.industryId ?? "_generic",
    }),
  );

  const held = progress.filter((p) => p.credentialHeld);

  return (
    <div className="space-y-6">
      <div>
        <PageTitle>Academy</PageTitle>
        <Muted className="mt-1 max-w-prose">
          Five role paths. Each one ends in a credential, and every lab points at a live object in
          this workspace rather than a screenshot.
        </Muted>
      </div>

      {organization?.requireApproverCredentials ? (
        <Band>
          This organisation requires the matching credential before an approver role can be
          exercised. You hold {held.length} of {progress.length}.
        </Band>
      ) : null}

      {progress.length === 0 ? (
        <EmptyState
          title="No paths in this pack"
          body="This industry pack ships no academy content yet. The generic pack has five role paths you can start from."
        />
      ) : (
        <ul className="space-y-3">
          {progress.map((entry) => (
            <li key={entry.path.key}>
              <Panel>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/academy/${entry.path.key}`} className="text-section-title no-underline">
                      {entry.path.title}
                    </Link>
                    <p className="mt-1 max-w-prose text-muted">{entry.path.summary}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {entry.credentialHeld ? (
                      <Badge tone="success">credential held</Badge>
                    ) : entry.started ? (
                      <Badge tone="brand">in progress</Badge>
                    ) : (
                      <Badge tone="neutral">not started</Badge>
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex items-baseline justify-between text-muted">
                    <span>
                      {entry.completedModules} of {entry.totalModules} modules
                    </span>
                    {entry.unlocksRoles.length > 0 ? (
                      <span>unlocks {entry.unlocksRoles.join(", ")}</span>
                    ) : null}
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded bg-band">
                    <div
                      className="h-1.5 rounded bg-brand-accent"
                      style={{
                        width: `${entry.totalModules === 0 ? 0 : Math.round((entry.completedModules / entry.totalModules) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}

      {held.length > 0 ? (
        <Panel>
          <SectionTitle>Your credentials</SectionTitle>
          <Muted className="mt-1">
            Each one is an audit event: evidence that you demonstrated something, on a date, in
            this organisation.
          </Muted>
          <ul className="mt-3 flex flex-wrap gap-2">
            {held.map((entry) => (
              <li key={entry.path.credentialKey}>
                <Badge tone="success">{entry.path.credentialKey.replace(/-/g, " ")}</Badge>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
