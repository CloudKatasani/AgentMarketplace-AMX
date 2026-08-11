import Link from "next/link";
import { notFound } from "next/navigation";

import { Band, Muted, PageTitle, Panel, SectionTitle } from "@/components/ui/primitives";
import { Badge, CertificationBadge } from "@/components/ui/status";
import { requireSessionContext } from "@/lib/auth/session-context";
import { withOrg } from "@/lib/db/scope";
import type { CertificationStatus } from "@/lib/enums";

type Dependant = {
  agent: { id: string; slug: string; name: string; certification: string };
  bindingTypes: string[];
  pinnedTo: string;
  stale: boolean;
  drifted: boolean;
  staleReasons: string[];
};

/**
 * The product-view inversion.
 *
 * From an agent you can see what it stands on. This is the other direction —
 * from a data product, everything standing on it — and it is the question
 * executives actually ask: "if we change Customer 360, what breaks?"
 */
export default async function DataProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSessionContext();

  const product = await withOrg(session.organizationId, (db) =>
    db.dataProduct.findUnique({
      where: { id },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        layer: true,
        sensitivity: true,
        qualityScore: true,
        contractVersion: true,
        contractMajor: true,
        semanticModelVersion: true,
        lastRefreshedAt: true,
        freshnessSlaHours: true,
        ownerName: true,
        metrics: {
          where: { archivedAt: null },
          select: {
            id: true,
            key: true,
            name: true,
            definition: true,
            grain: true,
            certifiedAt: true,
            coverage: { select: { question: { select: { id: true, text: true, agentId: true } } } },
          },
        },
        versions: {
          orderBy: { createdAt: "desc" },
          select: { contractVersion: true, changeSummary: true, createdAt: true },
        },
        bindings: {
          where: { archivedAt: null },
          select: {
            id: true,
            status: true,
            bindingType: true,
            staleReason: true,
            currentVersion: { select: { boundContractVersion: true, boundContractMajor: true } },
            agent: {
              select: {
                id: true,
                slug: true,
                name: true,
                status: true,
                certification: true,
              },
            },
          },
        },
      },
    }),
  );

  if (!product) notFound();

  // One agent can bind the same product more than once — grounding on it and
  // querying it are different relationships. The lineage question is about
  // agents, though, so the list is one row per agent with its binding types.
  const dependants = new Map<string, Dependant>();
  for (const binding of product.bindings) {
    const existing = dependants.get(binding.agent.id);
    const drifted =
      (binding.currentVersion?.boundContractMajor ?? product.contractMajor) < product.contractMajor;
    if (existing) {
      existing.bindingTypes.push(binding.bindingType);
      existing.stale = existing.stale || binding.status === "STALE";
      existing.drifted = existing.drifted || drifted;
      if (binding.staleReason && !existing.staleReasons.includes(binding.staleReason)) {
        existing.staleReasons.push(binding.staleReason);
      }
      continue;
    }
    dependants.set(binding.agent.id, {
      agent: binding.agent,
      bindingTypes: [binding.bindingType],
      pinnedTo: binding.currentVersion?.boundContractVersion ?? "—",
      stale: binding.status === "STALE",
      drifted,
      staleReasons: binding.staleReason ? [binding.staleReason] : [],
    });
  }

  const rows = [...dependants.values()];
  const driftedCount = rows.filter((row) => row.drifted).length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/data-products" className="text-muted">
          ← Data products
        </Link>
        <PageTitle className="mt-1">{product.name}</PageTitle>
        <Muted className="mt-1 max-w-prose">{product.description}</Muted>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{product.layer}</Badge>
          <Badge tone="neutral">{product.sensitivity}</Badge>
          <Badge tone={product.qualityScore >= 90 ? "success" : "brand"}>
            quality {product.qualityScore}
          </Badge>
          <span className="text-muted">
            contract {product.contractVersion} · semantic model {product.semanticModelVersion} ·
            owned by {product.ownerName}
          </span>
        </div>
      </div>

      {driftedCount > 0 ? (
        <Band>
          {driftedCount} agent{driftedCount === 1 ? " is" : "s are"} pinned to an older major version
          of this contract and {driftedCount === 1 ? "needs" : "need"} re-approval.
        </Band>
      ) : null}

      <Panel>
        <SectionTitle>Everything standing on this</SectionTitle>
        <Muted className="mt-1">
          The lineage question executives actually ask: change this, and this is what needs
          re-certifying.
        </Muted>

        {rows.length === 0 ? (
          <Muted className="mt-3">Nothing binds to this product yet.</Muted>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {rows.map((row) => (
              <li key={row.agent.id} className="flex flex-wrap items-center gap-3 py-3">
                <Link href={`/marketplace/${row.agent.slug}`} className="font-medium">
                  {row.agent.name}
                </Link>
                {row.bindingTypes.map((type) => (
                  <Badge key={type} tone="neutral">
                    {type.replace(/_/g, " ").toLowerCase()}
                  </Badge>
                ))}
                <CertificationBadge status={row.agent.certification as CertificationStatus} />
                <span className="text-muted">pinned to {row.pinnedTo}</span>
                {row.stale ? <Badge tone="warning">stale</Badge> : null}
                {row.staleReasons.map((reason) => (
                  <p
                    key={reason}
                    className="w-full rounded bg-warning-tint px-3 py-2 text-warning"
                  >
                    {reason}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <SectionTitle>Certified metrics</SectionTitle>
        <Muted className="mt-1">
          And the questions across the organisation that each one answers.
        </Muted>
        <ul className="mt-4 space-y-4">
          {product.metrics.map((metric) => (
            <li key={metric.id}>
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-xs">{metric.key}</code>
                <span className="font-medium">{metric.name}</span>
                {metric.certifiedAt ? (
                  <Badge tone="success">certified</Badge>
                ) : (
                  <Badge tone="warning">not certified</Badge>
                )}
                <span className="text-muted">{metric.grain}</span>
              </div>
              <p className="mt-1 max-w-prose text-muted">{metric.definition}</p>
              {metric.coverage.length > 0 ? (
                <ul className="mt-1 list-disc pl-5 text-muted">
                  {metric.coverage.slice(0, 5).map((row) => (
                    <li key={row.question.id}>{row.question.text}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted">No question maps to this metric yet.</p>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <SectionTitle>Contract history</SectionTitle>
        <ul className="mt-3 divide-y divide-border">
          {product.versions.map((version) => (
            <li key={version.contractVersion} className="py-2">
              <span className="font-medium">{version.contractVersion}</span>
              <span className="ml-3 text-muted">
                {version.createdAt.toISOString().slice(0, 10)}
              </span>
              <p className="text-muted">{version.changeSummary}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
