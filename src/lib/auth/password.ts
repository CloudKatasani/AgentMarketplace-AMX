/**
 * Password hashing, deliberately on its own.
 *
 * `src/lib/auth/index.ts` constructs Auth.js, which reaches into `next/server`
 * — fine in the app, unusable from a plain Node context like the seed script or
 * a Vitest run. Hashing a password needs none of that, so it lives here and the
 * auth module re-exports it for callers that already have it in hand.
 */
import { compare, hash } from "bcryptjs";

export const PASSWORD_ROUNDS = 10;

export function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return compare(password, passwordHash);
}
