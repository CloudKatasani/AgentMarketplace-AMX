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
 * It is scoped to development only, deliberately. Under a test runner each file
 * gets a fresh module registry but shares `globalThis`, so a cached client
 * would keep the *first* file's AsyncLocalStorage — and every later file's
 * `runAsOrg` would write to a store the client cannot see. Silent cross-file
 * context loss is a worse bug than an extra connection.
 */
export const db: AmxPrismaClient = globalForPrisma.amxPrisma ?? createTenantAwareClient();

if (process.env.NODE_ENV === "development") {
  globalForPrisma.amxPrisma = db;
}

export * from "./tenancy";
export * from "./model-classification";
