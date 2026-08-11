import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/action-form";
import {
  Band,
  EmptyState,
  Input,
  Label,
  Muted,
  PageTitle,
  Panel,
  SectionTitle,
  Textarea,
} from "@/components/ui/primitives";
import { Badge } from "@/components/ui/status";
import { requireSessionContext } from "@/lib/auth/session-context";
import { withOrg } from "@/lib/db/scope";

import { bumpVersionAction } from "./actions";

export default async function DataProductsPage() {
  const session = await requireSessionContext();

  const products = await withOrg(session.organizationId, (db) =>
    db.dataProduct.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        key: true,
        layer: true,
        sensitivity: true,
        qualityScore: true,
        contractVersion: true,
        contractMajor: true,
        semanticModelVersion: true,
        lastRefreshedAt: true,
        metrics: {
          where: { archivedAt: null },
          select: { id: true, key: true, name: true, certifiedAt: true },
        },
        bindings: {
          where: { archivedAt: null },
          select: {
            id: true,
            status: true,
            bindingType: true,
            agent: { select: { id: true, name: true, certification: true } },
            currentVersion: { select: { boundContractVersion: true, boundContractMajor: true } },
          },
        },
      },
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <PageTitle>Data products</PageTitle>
        <Muted className="mt-1">
          What the agents in this workspace stand on — and, for each product, exactly which agents
          depend on it.
        </Muted>
      </div>

      {products.length === 0 ? (
        <EmptyState
          title="No data products registered"
          body="Register a certified data product from its contract and semantic model export, and agents can start binding to it."
        />
      ) : (
        products.map((product) => {
          const dependents = product.bindings.filter((b) => b.currentVersion !== null);
          const outdated = dependents.filter(
            (b) => (b.currentVersion?.boundContractMajor ?? 0) < product.contractMajor,
          );

          return (
            <Panel key={product.id} className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <SectionTitle>
                    <Link href={`/data-products/${product.id}`} className="no-underline">
                      {product.name}
                    </Link>
                  </SectionTitle>
                  <Muted className="mt-1 max-w-prose">{product.description}</Muted>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{product.layer}</Badge>
                  <Badge tone="neutral">{product.sensitivity}</Badge>
                  <Badge tone={product.qualityScore >= 90 ? "success" : "brand"}>
                    quality {product.qualityScore}
                  </Badge>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted">
                <span>
                  contract <span className="text-brand-ink">{product.contractVersion}</span>
                </span>
                <span>semantic model {product.semanticModelVersion}</span>
                <span>
                  refreshed{" "}
                  {product.lastRefreshedAt
                    ? product.lastRefreshedAt.toISOString().slice(0, 10)
                    : "never"}
                </span>
              </div>

              <div>
                <p className="font-medium">Certified metrics</p>
                <ul className="mt-1 space-y-1">
                  {product.metrics.map((metric) => (
                    <li key={metric.id} className="text-muted">
                      <span className="font-mono text-xs text-brand-ink">{metric.key}</span> ·{" "}
                      {metric.name}
                      {metric.certifiedAt ? "" : " · not certified"}
                    </li>
                  ))}
                  {product.metrics.length === 0 ? (
                    <li className="text-muted">None yet.</li>
                  ) : null}
                </ul>
              </div>

              {/* The product-view inversion: from a product, every dependent agent. */}
              <div>
                <p className="font-medium">Agents standing on this</p>
                {dependents.length === 0 ? (
                  <Muted className="mt-1">Nothing binds to this product yet.</Muted>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {dependents.map((binding) => (
                      <li key={binding.id} className="flex flex-wrap items-center gap-2">
                        <Link href={`/agents/${binding.agent.id}`}>{binding.agent.name}</Link>
                        <span className="text-muted">
                          {binding.bindingType.replace(/_/g, " ").toLowerCase()} · pinned to{" "}
                          {binding.currentVersion?.boundContractVersion}
                        </span>
                        {binding.status === "STALE" ? <Badge tone="warning">stale</Badge> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {outdated.length > 0 ? (
                <Band>
                  {outdated.length} binding{outdated.length === 1 ? " is" : "s are"} pinned to an
                  older major version of this contract and need re-approval.
                </Band>
              ) : null}

              {!session.isReadOnly ? (
                <details className="rounded border border-border p-4">
                  <summary className="cursor-pointer font-medium">Publish a new contract version</summary>
                  <Muted className="mt-2">
                    A major bump is a breaking change, so every agent pinned to an older major has
                    its certification invalidated immediately. Minor and patch bumps are recorded
                    without cascading.
                  </Muted>
                  <ActionForm action={bumpVersionAction} className="mt-4 space-y-3">
                    <input type="hidden" name="dataProductId" value={product.id} />
                    <div>
                      <Label htmlFor={`version-${product.id}`} hint="major.minor.patch">
                        New contract version
                      </Label>
                      <Input
                        id={`version-${product.id}`}
                        name="contractVersion"
                        defaultValue={`${product.contractMajor + 1}.0.0`}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor={`summary-${product.id}`}>What changed?</Label>
                      <Textarea
                        id={`summary-${product.id}`}
                        name="changeSummary"
                        rows={2}
                        required
                        minLength={10}
                      />
                    </div>
                    <SubmitButton pendingLabel="Publishing…">Publish version</SubmitButton>
                  </ActionForm>
                </details>
              ) : null}
            </Panel>
          );
        })
      )}
    </div>
  );
}
