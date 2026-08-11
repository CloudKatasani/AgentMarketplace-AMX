/**
 * Tenant isolation, in one choke-point.
 *
 * A Prisma client extension wraps every operation on every model:
 *   - tenant-scoped reads gain an `organizationId` predicate
 *   - tenant-scoped writes are stamped with the current organisation
 *   - append-only models reject update/delete/upsert
 *   - a tenant-scoped query with no organisation in context THROWS
 *
 * Deny-by-default is the point: forgetting to scope a query fails loudly in
 * development instead of returning another tenant's rows in production.
 *
 * PROMPT.md asks for "a single Prisma middleware". `$use` middleware is
 * deprecated as of Prisma 5, so this is the same single choke-point built as a
 * client extension — the supported successor. See docs/phase-1-design.md §5.2.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, PrismaClient } from "@prisma/client";

import {
  TENANT_ROOT_MODEL,
  isAppendOnly,
  isGlobalModel,
  isTenantScoped,
} from "./model-classification";

export type OrgContext = {
  organizationId: string;
  /** System context bypasses scoping for seeding and cascade sweeps. */
  isSystem?: boolean;
};

const storage = new AsyncLocalStorage<OrgContext>();

export class MissingOrgContextError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model}.${operation} ran without an organisation in context. ` +
        `Wrap the call in runAsOrg(organizationId, ...) — or runAsSystem(...) ` +
        `if this is seeding or a cascade sweep.`,
    );
    this.name = "MissingOrgContextError";
  }
}

export class AppendOnlyViolationError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model} is append-only; ${operation} is not permitted. ` +
        `Write a new version or a new event instead.`,
    );
    this.name = "AppendOnlyViolationError";
  }
}

export class CrossTenantWriteError extends Error {
  constructor(model: string, attempted: string, current: string) {
    super(
      `${model} write targeted organisation ${attempted} while ${current} is in context.`,
    );
    this.name = "CrossTenantWriteError";
  }
}

/**
 * Runs `fn` with `organizationId` in context.
 *
 * The `await` inside the scope is load-bearing. Prisma promises are lazy: the
 * query is dispatched when the promise is awaited, not when it is built. A
 * caller that returns `db.agent.findMany()` without awaiting would therefore
 * dispatch it *after* this scope exited, and the extension would see no
 * organisation. Awaiting here means the caller can write the natural
 * `withOrg(id, (db) => db.agent.findMany())` and still be scoped.
 */
export async function runAsOrg<T>(
  organizationId: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  return storage.run({ organizationId }, async () => await fn());
}

/**
 * The only bypass. Seeding and cascade sweeps legitimately cross tenants;
 * every other caller must use `runAsOrg`. Cascade sweeps audit what they touch.
 */
export async function runAsSystem<T>(fn: () => Promise<T> | T): Promise<T> {
  return storage.run({ organizationId: "__system__", isSystem: true }, async () => await fn());
}

export function currentOrgContext(): OrgContext | undefined {
  return storage.getStore();
}

/** Throws unless a real (non-system) organisation is in context. */
export function requireOrgId(): string {
  const ctx = storage.getStore();
  if (!ctx || ctx.isSystem) {
    throw new MissingOrgContextError("context", "requireOrgId");
  }
  return ctx.organizationId;
}

/** Operations whose `where` is a filter — the predicate is AND-ed on. */
const FILTER_WHERE_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);

/**
 * Operations whose `where` is a unique input. Prisma's extended-where-unique
 * (GA since 5.0) accepts extra non-unique filters alongside the unique field,
 * so the organisation predicate is merged in rather than AND-ed.
 */
const UNIQUE_WHERE_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "delete",
  "upsert",
]);

const CREATE_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn"]);

const MUTATING_OPERATIONS = new Set([
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

type AnyArgs = Record<string, unknown>;

function andWhere(args: AnyArgs, predicate: AnyArgs): AnyArgs {
  const existing = args.where as AnyArgs | undefined;
  return { ...args, where: existing ? { AND: [existing, predicate] } : predicate };
}

function mergeWhere(args: AnyArgs, model: string, orgId: string): AnyArgs {
  const existing = (args.where ?? {}) as AnyArgs;
  const supplied = existing.organizationId;
  if (typeof supplied === "string" && supplied !== orgId) {
    throw new CrossTenantWriteError(model, supplied, orgId);
  }
  return { ...args, where: { ...existing, organizationId: orgId } };
}

function stampData(data: unknown, organizationId: string, model: string): unknown {
  if (Array.isArray(data)) return data.map((row) => stampData(row, organizationId, model));
  const row = (data ?? {}) as AnyArgs;
  const supplied = row.organizationId;
  if (typeof supplied === "string" && supplied !== organizationId) {
    throw new CrossTenantWriteError(model, supplied, organizationId);
  }
  return { ...row, organizationId };
}

function baseClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.PRISMA_LOG === "query" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

export function createTenantAwareClient(client: PrismaClient = baseClient()) {
  return client.$extends({
    name: "amx-tenancy",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query: typedQuery }) {
          // The rewritten args are structurally correct but not statically
          // provable per-model, so the callback is widened once, here.
          const query = typedQuery as (rewritten: unknown) => Promise<unknown>;

          if (isAppendOnly(model) && MUTATING_OPERATIONS.has(operation)) {
            throw new AppendOnlyViolationError(model!, operation);
          }
          if (isGlobalModel(model)) return query(args);

          const ctx = storage.getStore();
          if (!ctx) throw new MissingOrgContextError(model!, operation);
          if (ctx.isSystem) return query(args);

          const orgId = ctx.organizationId;
          const typedArgs = (args ?? {}) as AnyArgs;

          // The tenant root filters on its own id, not on organizationId.
          if (model === TENANT_ROOT_MODEL) {
            if (FILTER_WHERE_OPERATIONS.has(operation)) {
              return query(andWhere(typedArgs, { id: orgId }));
            }
            if (UNIQUE_WHERE_OPERATIONS.has(operation)) {
              const existing = (typedArgs.where ?? {}) as AnyArgs;
              // Asking for a different organisation by id must behave exactly
              // as if that row does not exist — not silently return your own.
              if (typeof existing.id === "string" && existing.id !== orgId) {
                if (operation.startsWith("find") && !operation.endsWith("OrThrow")) return null;
                throw new CrossTenantWriteError(model, existing.id, orgId);
              }
              return query({ ...typedArgs, where: { ...existing, id: orgId } });
            }
            return query(args);
          }

          if (!isTenantScoped(model)) {
            throw new MissingOrgContextError(model!, `${operation} (unclassified model)`);
          }

          if (FILTER_WHERE_OPERATIONS.has(operation)) {
            return query(andWhere(typedArgs, { organizationId: orgId }));
          }

          if (UNIQUE_WHERE_OPERATIONS.has(operation)) {
            const scoped = mergeWhere(typedArgs, model!, orgId);
            if (operation === "upsert") {
              return query({ ...scoped, create: stampData(scoped.create, orgId, model!) });
            }
            return query(scoped);
          }

          if (CREATE_OPERATIONS.has(operation)) {
            return query({ ...typedArgs, data: stampData(typedArgs.data, orgId, model!) });
          }

          return query(args);
        },
      },
    },
  });
}

export type AmxPrismaClient = ReturnType<typeof createTenantAwareClient>;

/** Every model in the generated datamodel — the classification test reads this. */
export const ALL_MODEL_NAMES: string[] = Prisma.dmmf.datamodel.models.map((m) => m.name);
