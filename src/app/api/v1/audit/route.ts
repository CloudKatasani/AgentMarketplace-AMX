import { apiRoute } from "@/lib/api/handler";
import { fail, ok, readPage } from "@/lib/api/respond";
import type { PlanTier } from "@/lib/enums";
import { can } from "@/lib/plans/features";

/**
 * The audit trail, in order, with the chain intact.
 *
 * Gated on `auditExport` rather than on `apiAccess`: a token that can read the
 * catalogue is not automatically a token that can pull the organisation's
 * entire decision history into someone else's system. Both are Enterprise
 * today, and they are separate flags because they are separate decisions.
 */
export const GET = apiRoute(async ({ scoped, url, organizationId }) => {
  const organization = await scoped.organization.findUnique({
    where: { id: organizationId },
    select: { planTier: true },
  });
  if (!can((organization?.planTier ?? "FREE") as PlanTier, "auditExport")) {
    return fail(403, "Audit export is part of Enterprise.");
  }

  const page = readPage(url);
  const since = url.searchParams.get("since");
  const sinceSequence = Number(since ?? 0);

  const where = Number.isFinite(sinceSequence) && sinceSequence > 0
    ? { sequence: { gt: Math.trunc(sinceSequence) } }
    : {};

  const [rows, total] = await Promise.all([
    scoped.auditEvent.findMany({
      where,
      orderBy: { sequence: "asc" },
      take: page.limit,
      skip: page.offset,
      select: {
        sequence: true,
        type: true,
        subjectType: true,
        subjectId: true,
        actorKind: true,
        actorUserId: true,
        payload: true,
        prevHash: true,
        hash: true,
        createdAt: true,
      },
    }),
    scoped.auditEvent.count({ where }),
  ]);

  return ok(
    rows.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      subject: { type: event.subjectType, id: event.subjectId },
      actor: { kind: event.actorKind, userId: event.actorUserId },
      // Payloads are canonical JSON on the way in; they stay JSON on the way out
      // rather than becoming a quoted string an integration has to re-parse.
      payload: safeParse(event.payload),
      prevHash: event.prevHash,
      hash: event.hash,
      at: event.createdAt,
    })),
    { total, limit: page.limit, offset: page.offset },
  );
});

function safeParse(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}
