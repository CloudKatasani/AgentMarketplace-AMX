/**
 * Stage 8 · Publish & Operate.
 *
 * Publishing is not the end of the lifecycle, it is the start of the part that
 * has consequences. So this module is mostly about what happens *after*: what
 * the agent is being asked, whether what it stands on is still fresh, and how
 * it is retired deliberately rather than quietly abandoned.
 */
import { commitArtifact } from "@/lib/artifacts/commit";
import { agentListingSchema, type AgentListing } from "@/lib/artifacts/schemas";
import { appendAuditEvent } from "@/lib/audit/append";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import type { IntentClass } from "@/lib/enums";

export type UsageTelemetry = {
  total: number;
  last30Days: number;
  intentMix: { intentClass: IntentClass; count: number; share: number }[];
  personaMix: { personaName: string; count: number; share: number }[];
  outcomeMix: { outcome: string; count: number; share: number }[];
  /** Refusals are a health signal, not a failure: an agent that never refuses has no scope. */
  refusalRate: number;
};

export async function loadTelemetry(
  db: AmxPrismaClient,
  agentId: string,
  now: Date = new Date(),
): Promise<UsageTelemetry> {
  const invocations = await db.invocation.findMany({
    where: { agentId },
    select: {
      intentClass: true,
      outcome: true,
      createdAt: true,
      persona: { select: { name: true } },
    },
  });

  const total = invocations.length;
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const share = (count: number) => (total === 0 ? 0 : count / total);

  const tally = <T extends string>(values: T[]) => {
    const counts = new Map<T, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count, share: share(count) }))
      .sort((a, b) => b.count - a.count);
  };

  return {
    total,
    last30Days: invocations.filter((i) => i.createdAt >= cutoff).length,
    intentMix: tally(invocations.map((i) => i.intentClass as IntentClass)).map((row) => ({
      intentClass: row.key,
      count: row.count,
      share: row.share,
    })),
    personaMix: tally(invocations.map((i) => i.persona?.name ?? "Unattributed")).map((row) => ({
      personaName: row.key,
      count: row.count,
      share: row.share,
    })),
    outcomeMix: tally(invocations.map((i) => i.outcome)).map((row) => ({
      outcome: row.key,
      count: row.count,
      share: row.share,
    })),
    refusalRate: share(invocations.filter((i) => i.outcome === "refused").length),
  };
}

export type StalenessRow = {
  productName: string;
  contractVersion: string;
  pinnedVersion: string | null;
  /** Hours since the product last refreshed, against its own SLA. */
  hoursSinceRefresh: number | null;
  freshnessSlaHours: number | null;
  isVersionDrifted: boolean;
  isStale: boolean;
  problem: string | null;
};

/**
 * The staleness dashboard.
 *
 * Two ways a published agent decays: the contract moves (version drift) or the
 * data stops arriving (freshness). Both are shown against the product's own
 * stated SLA rather than a number AMX invented.
 */
export async function loadStaleness(
  db: AmxPrismaClient,
  agentId: string,
  now: Date = new Date(),
): Promise<StalenessRow[]> {
  const bindings = await db.binding.findMany({
    where: { agentId, archivedAt: null },
    select: {
      status: true,
      currentVersion: { select: { boundContractVersion: true, boundContractMajor: true } },
      dataProduct: {
        select: {
          name: true,
          contractVersion: true,
          contractMajor: true,
          lastRefreshedAt: true,
          freshnessSlaHours: true,
        },
      },
    },
  });

  return bindings.map((binding) => {
    const product = binding.dataProduct;
    const hoursSinceRefresh = product.lastRefreshedAt
      ? (now.getTime() - product.lastRefreshedAt.getTime()) / 3_600_000
      : null;

    const isVersionDrifted =
      binding.currentVersion !== null &&
      binding.currentVersion.boundContractMajor < product.contractMajor;

    const breachesFreshness =
      product.freshnessSlaHours !== null &&
      hoursSinceRefresh !== null &&
      hoursSinceRefresh > product.freshnessSlaHours;

    let problem: string | null = null;
    if (isVersionDrifted) {
      problem = `Bound to contract ${binding.currentVersion?.boundContractVersion}, but ${product.name} is now on ${product.contractVersion} — a breaking change.`;
    } else if (breachesFreshness) {
      problem = `${product.name} last refreshed ${Math.round(hoursSinceRefresh!)}h ago, against a ${product.freshnessSlaHours}h SLA.`;
    }

    return {
      productName: product.name,
      contractVersion: product.contractVersion,
      pinnedVersion: binding.currentVersion?.boundContractVersion ?? null,
      hoursSinceRefresh,
      freshnessSlaHours: product.freshnessSlaHours,
      isVersionDrifted,
      isStale: binding.status === "STALE" || isVersionDrifted || breachesFreshness,
      problem,
    };
  });
}

export type SaveListingResult =
  | { ok: true; versionNumber: number }
  | { ok: false; errors: { path: string; message: string }[] };

export async function saveListing(
  db: AmxPrismaClient,
  input: {
    organizationId: string;
    agentId: string;
    actorUserId: string | null;
    listing: unknown;
  },
): Promise<SaveListingResult> {
  const parsed = agentListingSchema.safeParse(input.listing);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: `/${issue.path.join("/")}`,
        message: issue.message,
      })),
    };
  }

  const result = await commitArtifact(db, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    stageId: "8-publish-and-operate",
    kind: "agent-listing",
    authorUserId: input.actorUserId,
    content: parsed.data satisfies AgentListing,
  });
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, versionNumber: result.versionNumber };
}

/**
 * Deprecation and retirement.
 *
 * A retired agent keeps its listing, its evidence pack, and its audit trail —
 * "archivedAt instead of deletes" applies most to the thing someone will later
 * be asked about. Consumers are notified through a task addressed to the
 * business-consumer role, which is the closest thing to a notification channel
 * the product has before Phase 4.
 */
export async function deprecateAgent(
  db: AmxPrismaClient,
  input: {
    organizationId: string;
    agentId: string;
    actorUserId: string | null;
    reason: string;
    retireAfter: string;
    replacementSlug?: string;
  },
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const agent = await db.agent.findUnique({
    where: { id: input.agentId },
    select: { id: true, name: true, status: true },
  });
  if (!agent) return { ok: false, detail: "Agent not found." };
  if (agent.status !== "PUBLISHED") {
    return {
      ok: false,
      detail: "Only a published agent can be deprecated. An unpublished one can simply be archived.",
    };
  }

  await db.$transaction(async (tx) => {
    await tx.agent.update({
      where: { id: input.agentId },
      data: { status: "DEPRECATED" },
    });

    const event = await appendAuditEvent(tx as AmxPrismaClient, {
      organizationId: input.organizationId,
      type: "certification.changed",
      subjectType: "Agent",
      subjectId: input.agentId,
      actorUserId: input.actorUserId,
      payload: {
        action: "deprecated",
        reason: input.reason,
        retireAfter: input.retireAfter,
        replacement: input.replacementSlug ?? null,
      },
    });

    await tx.task.create({
      data: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        kind: "REVIEW_CHANGES",
        title: `${agent.name} is deprecated — tell its consumers`,
        description: `${input.reason} It retires after ${input.retireAfter}.${
          input.replacementSlug ? ` Replacement: ${input.replacementSlug}.` : ""
        }`,
        assigneeRoleId: "agent-product-owner",
        causeEventId: event.id,
      },
    });
  });

  return { ok: true };
}
