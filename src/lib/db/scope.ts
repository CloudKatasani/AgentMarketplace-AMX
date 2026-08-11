import { db } from "./index";
import type { AmxPrismaClient } from "./tenancy";
import { runAsOrg } from "./tenancy";

/**
 * The one way a page or action reaches the database.
 *
 * Passing the organisation explicitly at the call site makes the scope visible
 * in review; the extension underneath makes it enforced.
 */
export function withOrg<T>(
  organizationId: string,
  fn: (client: AmxPrismaClient) => Promise<T>,
): Promise<T> {
  return runAsOrg(organizationId, () => fn(db));
}
