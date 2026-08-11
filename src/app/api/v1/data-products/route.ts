import { apiRoute } from "@/lib/api/handler";
import { ok, readPage } from "@/lib/api/respond";

/**
 * The product-view inversion, as data: each product with its contract, its
 * certified metrics, and every agent standing on it.
 */
export const GET = apiRoute(async ({ scoped, url }) => {
  const page = readPage(url);

  const [rows, total] = await Promise.all([
    scoped.dataProduct.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      take: page.limit,
      skip: page.offset,
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
          select: { key: true, name: true, grain: true, certifiedAt: true },
        },
        bindings: {
          where: { archivedAt: null },
          select: {
            bindingType: true,
            status: true,
            currentVersion: { select: { boundContractMajor: true } },
            agent: { select: { slug: true, name: true, certification: true } },
          },
        },
      },
    }),
    scoped.dataProduct.count({ where: { archivedAt: null } }),
  ]);

  return ok(
    rows.map((product) => ({
      id: product.id,
      key: product.key,
      name: product.name,
      description: product.description,
      layer: product.layer,
      sensitivity: product.sensitivity,
      qualityScore: product.qualityScore,
      contractVersion: product.contractVersion,
      semanticModelVersion: product.semanticModelVersion,
      lastRefreshedAt: product.lastRefreshedAt,
      freshnessSlaHours: product.freshnessSlaHours,
      owner: product.ownerName,
      certifiedMetrics: product.metrics.map((metric) => ({
        key: metric.key,
        name: metric.name,
        grain: metric.grain,
        certified: Boolean(metric.certifiedAt),
      })),
      dependants: product.bindings.map((binding) => ({
        agent: binding.agent.slug,
        agentName: binding.agent.name,
        certification: binding.agent.certification,
        type: binding.bindingType,
        status: binding.status,
        // The comparison that makes cascade a fact rather than a heuristic.
        pinnedToMajor: binding.currentVersion?.boundContractMajor ?? null,
        currentMajor: product.contractMajor,
        drifted:
          (binding.currentVersion?.boundContractMajor ?? product.contractMajor) <
          product.contractMajor,
      })),
    })),
    { total, limit: page.limit, offset: page.offset },
  );
});
