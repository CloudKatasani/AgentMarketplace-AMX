import { apiRoute } from "@/lib/api/handler";
import { ok, readPage } from "@/lib/api/respond";

/**
 * Every agent in the workspace, with the two things an integration actually
 * wants: what it is certified as, and what it stands on.
 */
export const GET = apiRoute(async ({ scoped, url }) => {
  const page = readPage(url);
  const status = url.searchParams.get("status");
  const certification = url.searchParams.get("certification");

  const where = {
    archivedAt: null,
    ...(status ? { status } : {}),
    ...(certification ? { certification } : {}),
  };

  const [rows, total] = await Promise.all([
    scoped.agent.findMany({
      where,
      orderBy: { name: "asc" },
      take: page.limit,
      skip: page.offset,
      select: {
        id: true,
        slug: true,
        name: true,
        summary: true,
        archetype: true,
        riskTier: true,
        sensitivity: true,
        status: true,
        certification: true,
        staleReason: true,
        currentStageId: true,
        domain: { select: { name: true } },
        bindings: {
          where: { archivedAt: null },
          select: {
            bindingType: true,
            status: true,
            dataProduct: { select: { key: true, name: true, contractVersion: true } },
            currentVersion: { select: { boundContractVersion: true } },
          },
        },
      },
    }),
    scoped.agent.count({ where }),
  ]);

  return ok(
    rows.map((agent) => ({
      id: agent.id,
      slug: agent.slug,
      name: agent.name,
      summary: agent.summary,
      archetype: agent.archetype,
      riskTier: agent.riskTier,
      sensitivity: agent.sensitivity,
      status: agent.status,
      certification: agent.certification,
      staleReason: agent.staleReason,
      stage: agent.currentStageId,
      domain: agent.domain?.name ?? null,
      bindings: agent.bindings.map((binding) => ({
        type: binding.bindingType,
        status: binding.status,
        dataProduct: binding.dataProduct.key,
        dataProductName: binding.dataProduct.name,
        boundContractVersion: binding.currentVersion?.boundContractVersion ?? null,
        currentContractVersion: binding.dataProduct.contractVersion,
      })),
    })),
    { total, limit: page.limit, offset: page.offset },
  );
});
