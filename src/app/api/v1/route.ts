import { apiRoute } from "@/lib/api/handler";
import { ok } from "@/lib/api/respond";

/**
 * The index: what this API offers, to a caller who has just been given a token.
 *
 * Read-only by construction. There are no write endpoints, because an approval
 * is an act by a named human at a gate and a bearer token is not a person.
 */
export const GET = apiRoute(async ({ scoped, organizationId }) => {
  const organization = await scoped.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, planTier: true },
  });

  return ok({
    workspace: { id: organizationId, name: organization?.name, planTier: organization?.planTier },
    readOnly: true,
    endpoints: [
      { path: "/api/v1/agents", describes: "Published and in-progress agents with certification state" },
      { path: "/api/v1/agents/{slug}", describes: "One agent: charter, personas, questions, bindings, certification" },
      { path: "/api/v1/data-products", describes: "Registered data products, their contracts, metrics and dependants" },
      { path: "/api/v1/audit", describes: "The hash-chained audit trail (Enterprise audit export)" },
    ],
  });
});
