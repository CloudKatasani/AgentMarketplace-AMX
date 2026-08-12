import { describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { isClassified } from "@/lib/db/model-classification";
import {
  ALL_MODEL_NAMES,
  AppendOnlyViolationError,
  CrossTenantWriteError,
  MissingOrgContextError,
} from "@/lib/db/tenancy";

import { addMember, inOrg, makeOrg } from "./helpers";

describe("model classification", () => {
  it("classifies every model in the datamodel", () => {
    const unclassified = ALL_MODEL_NAMES.filter((model) => !isClassified(model));
    expect(
      unclassified,
      `Unclassified models leak across tenants. Add them to GLOBAL_MODELS or TENANT_SCOPED_MODELS in src/lib/db/model-classification.ts: ${unclassified.join(", ")}`,
    ).toEqual([]);
  });
});

describe("tenant isolation", () => {
  it("refuses a tenant-scoped query with no organisation in context", async () => {
    await expect(db.agent.findMany()).rejects.toBeInstanceOf(MissingOrgContextError);
  });

  it("hides another organisation's rows from findMany", async () => {
    const alpha = await makeOrg();
    const beta = await makeOrg();

    const alphaAgents = await inOrg(alpha.organizationId, () =>
      db.agent.findMany({ select: { id: true } }),
    );
    const betaAgents = await inOrg(beta.organizationId, () =>
      db.agent.findMany({ select: { id: true } }),
    );

    expect(alphaAgents).toHaveLength(1);
    expect(betaAgents).toHaveLength(1);
    expect(alphaAgents[0].id).not.toEqual(betaAgents[0].id);
  });

  it("returns null for another organisation's row by id", async () => {
    const alpha = await makeOrg();
    const beta = await makeOrg();

    const found = await inOrg(beta.organizationId, () =>
      db.agent.findUnique({ where: { id: alpha.agentId }, select: { id: true } }),
    );
    expect(found).toBeNull();
  });

  it("does not update another organisation's row", async () => {
    const alpha = await makeOrg();
    const beta = await makeOrg();

    await expect(
      inOrg(beta.organizationId, () =>
        db.agent.update({ where: { id: alpha.agentId }, data: { name: "hijacked" } }),
      ),
    ).rejects.toThrow();

    const untouched = await inOrg(alpha.organizationId, () =>
      db.agent.findUnique({ where: { id: alpha.agentId }, select: { name: true } }),
    );
    expect(untouched?.name).toBe("Customer Churn Advisor");
  });

  it("rejects a write that names a different organisation", async () => {
    const alpha = await makeOrg();
    const beta = await makeOrg();

    await expect(
      inOrg(beta.organizationId, () =>
        db.workspace.create({
          data: {
            organizationId: alpha.organizationId,
            slug: "smuggled",
            name: "Smuggled",
          },
        }),
      ),
    ).rejects.toBeInstanceOf(CrossTenantWriteError);
  });

  it("scopes the organisation row itself", async () => {
    const alpha = await makeOrg();
    const beta = await makeOrg();

    const visible = await inOrg(beta.organizationId, () =>
      db.organization.findMany({ select: { id: true } }),
    );
    expect(visible.map((o) => o.id)).toEqual([beta.organizationId]);

    const foreign = await inOrg(beta.organizationId, () =>
      db.organization.findUnique({ where: { id: alpha.organizationId } }),
    );
    expect(foreign).toBeNull();
  });

  it("keeps membership rows apart", async () => {
    const alpha = await makeOrg();
    await addMember(alpha.organizationId, ["governance-officer"]);
    const beta = await makeOrg();

    const betaMembers = await inOrg(beta.organizationId, () => db.membership.findMany());
    expect(betaMembers).toHaveLength(1);
  });
});

describe("append-only models", () => {
  it("rejects updating an audit event", async () => {
    const org = await makeOrg();
    const event = await inOrg(org.organizationId, () =>
      db.auditEvent.findFirst({ select: { id: true } }),
    );
    expect(event).not.toBeNull();

    await expect(
      inOrg(org.organizationId, () =>
        db.auditEvent.update({ where: { id: event!.id }, data: { type: "tampered" } }),
      ),
    ).rejects.toBeInstanceOf(AppendOnlyViolationError);
  });

  it("rejects deleting an audit event", async () => {
    const org = await makeOrg();
    await expect(
      inOrg(org.organizationId, () => db.auditEvent.deleteMany({})),
    ).rejects.toBeInstanceOf(AppendOnlyViolationError);
  });

  it("rejects updating an artifact version", async () => {
    const org = await makeOrg();
    const version = await inOrg(org.organizationId, () =>
      db.artifactVersion.findFirst({ select: { id: true } }),
    );
    expect(version).not.toBeNull();

    await expect(
      inOrg(org.organizationId, () =>
        db.artifactVersion.update({ where: { id: version!.id }, data: { content: "{}" } }),
      ),
    ).rejects.toBeInstanceOf(AppendOnlyViolationError);
  });

  it("rejects updating an approval", async () => {
    const org = await makeOrg();
    await expect(
      inOrg(org.organizationId, () =>
        db.approval.updateMany({ data: { decision: "APPROVE" } }),
      ),
    ).rejects.toBeInstanceOf(AppendOnlyViolationError);
  });
});

/**
 * The bug that only showed up in `pnpm dev`.
 *
 * Next evaluates a module more than once — a route compiled in a different pass
 * gets its own copy of `tenancy.ts` — while the Prisma client is cached on
 * `globalThis` so edits do not exhaust connections. If the AsyncLocalStorage
 * were per module copy, the cached client would close over the first one, a
 * later `runAsOrg` would write to the second, and every tenant-scoped query
 * would throw `MissingOrgContextError` in development while passing in
 * production, where there is only one registry.
 *
 * `vi.resetModules()` reproduces exactly that: a fresh registry, a fresh copy of
 * the module, the same process.
 */
describe("context survives a second module registry", () => {
  it("scopes a client from one registry with a scope entered from another", async () => {
    const org = await makeOrg({ seedStarter: false });

    // The client under test comes from the registry loaded at the top of this
    // file; the scope comes from a freshly-evaluated copy of the same module.
    vi.resetModules();
    const reloaded = await import("@/lib/db/tenancy");

    const agents = await reloaded.runAsOrg(org.organizationId, () =>
      db.agent.findMany({ select: { id: true } }),
    );
    expect(Array.isArray(agents)).toBe(true);

    // And the reverse direction: a client from the new registry, a scope from
    // this one.
    const freshDb = await import("@/lib/db");
    const alsoAgents = await inOrg(org.organizationId, () =>
      freshDb.db.agent.findMany({ select: { id: true } }),
    );
    expect(Array.isArray(alsoAgents)).toBe(true);
  });
});
