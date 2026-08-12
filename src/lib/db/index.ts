import { createTenantAwareClient, type AmxPrismaClient } from "./tenancy";

/**
 * The application's only database handle. Always tenant-aware — there is no
 * un-scoped export, so a query cannot accidentally escape the extension.
 */
const globalForPrisma = globalThis as unknown as { amxPrisma?: AmxPrismaClient };

/**
 * The global cache exists for one reason: Next's dev server re-evaluates
 * modules on every edit, and a new PrismaClient per edit exhausts connections.
 *
 * It is scoped to development only, deliberately: under a test runner an extra
 * connection per file is cheaper than reasoning about a shared one.
 *
 * The context store itself is pinned to `globalThis` in `tenancy.ts`, which is
 * what makes caching the client safe at all. Without that, a cached client
 * keeps the module instance's *first* AsyncLocalStorage while a re-evaluated
 * module writes to a second one — and every tenant-scoped query throws.
 */
export const db: AmxPrismaClient = globalForPrisma.amxPrisma ?? createTenantAwareClient();

if (process.env.NODE_ENV === "development") {
  globalForPrisma.amxPrisma = db;
}

export * from "./tenancy";
export * from "./model-classification";
