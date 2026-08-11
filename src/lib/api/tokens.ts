/**
 * Bearer tokens for the read-only API.
 *
 * Three properties, all of them deliberate:
 *
 * 1. **Only the hash is stored.** A token is shown once, to the person who
 *    created it, and is unrecoverable afterwards. A `prefix` is kept in clear so
 *    two tokens can be told apart in a list without the product remembering
 *    either of them.
 * 2. **The token names the tenant.** Resolving it is therefore system-scoped —
 *    the caller has no session and no organisation yet — and it is the second
 *    and last such lookup in the product, after invitation tokens. Everything
 *    the request then reads happens inside the organisation the token names.
 * 3. **The plan is checked at request time, not at issue time.** An
 *    organisation that leaves Enterprise stops answering on the API without
 *    anyone having to remember to revoke anything.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { appendAuditEvent } from "@/lib/audit/append";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import { runAsSystem } from "@/lib/db/tenancy";
import type { PlanTier } from "@/lib/enums";
import { assertMutable, requireMembership } from "@/lib/gates/authorization";
import { can } from "@/lib/plans/features";

const TOKEN_BYTES = 32;
const PREFIX_LENGTH = 12;
export const TOKEN_LABEL = "amx";

export type IssuedToken = {
  id: string;
  name: string;
  /** Shown once. Not stored, not recoverable, not logged. */
  token: string;
  prefix: string;
};

export type ApiTokenSummary = {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export type VerifiedCaller =
  | { ok: true; organizationId: string; tokenId: string }
  | { ok: false; status: 401 | 403; detail: string };

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueApiToken(
  db: AmxPrismaClient,
  input: { organizationId: string; actorUserId: string; name: string; planTier: PlanTier },
): Promise<{ ok: true; issued: IssuedToken } | { ok: false; detail: string }> {
  if (!can(input.planTier, "apiAccess")) {
    return { ok: false, detail: "API access is part of Enterprise." };
  }

  const mutable = await assertMutable(db, input.organizationId);
  if (!mutable.ok) return { ok: false, detail: mutable.detail };

  const membership = await requireMembership(db, input.organizationId, input.actorUserId);
  if (!membership.ok) return { ok: false, detail: membership.detail };
  if (!membership.roleKeys.includes("org-admin")) {
    return { ok: false, detail: "Only an Organisation Admin can issue an API token." };
  }

  const name = input.name.trim();
  if (name.length < 2) {
    return { ok: false, detail: "Give the token a name you will recognise in six months." };
  }

  const token = `${TOKEN_LABEL}_${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  const prefix = token.slice(0, PREFIX_LENGTH);

  const created = await db.$transaction(async (tx) => {
    const row = await tx.apiToken.create({
      data: {
        organizationId: input.organizationId,
        name,
        tokenHash: hashToken(token),
        prefix,
        createdByUserId: input.actorUserId,
      },
      select: { id: true },
    });
    await appendAuditEvent(tx as AmxPrismaClient, {
      organizationId: input.organizationId,
      type: "api-token.issued",
      subjectType: "ApiToken",
      subjectId: row.id,
      actorUserId: input.actorUserId,
      // Name and prefix only — the token is the credential.
      payload: { name, prefix },
    });
    return row;
  });

  return { ok: true, issued: { id: created.id, name, token, prefix } };
}

export async function revokeApiToken(
  db: AmxPrismaClient,
  input: { organizationId: string; actorUserId: string; tokenId: string },
): Promise<{ ok: boolean; detail: string }> {
  const mutable = await assertMutable(db, input.organizationId);
  if (!mutable.ok) return { ok: false, detail: mutable.detail };

  const membership = await requireMembership(db, input.organizationId, input.actorUserId);
  if (!membership.ok) return { ok: false, detail: membership.detail };
  if (!membership.roleKeys.includes("org-admin")) {
    return { ok: false, detail: "Only an Organisation Admin can revoke an API token." };
  }

  const token = await db.apiToken.findUnique({
    where: { id: input.tokenId },
    select: { id: true, name: true, revokedAt: true },
  });
  if (!token) return { ok: false, detail: "That token no longer exists." };
  if (token.revokedAt) return { ok: true, detail: `${token.name} was already revoked.` };

  await db.$transaction(async (tx) => {
    await tx.apiToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    await appendAuditEvent(tx as AmxPrismaClient, {
      organizationId: input.organizationId,
      type: "api-token.revoked",
      subjectType: "ApiToken",
      subjectId: token.id,
      actorUserId: input.actorUserId,
      payload: { name: token.name },
    });
  });

  return { ok: true, detail: `${token.name} can no longer be used.` };
}

export async function listApiTokens(
  db: AmxPrismaClient,
  organizationId: string,
): Promise<ApiTokenSummary[]> {
  return db.apiToken.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });
}

/**
 * Turns an `Authorization: Bearer …` header into an organisation, or into the
 * status code the caller should get.
 *
 * The hash comparison is constant-time. It is a SHA-256 of a 256-bit random
 * value rather than a password, so the practical risk is negligible either way
 * — but a lookup that leaks its own timing is the kind of detail an enterprise
 * security review asks about, and the fix is three lines.
 */
export async function verifyApiToken(
  db: AmxPrismaClient,
  authorization: string | null,
): Promise<VerifiedCaller> {
  const token = readBearer(authorization);
  if (!token) {
    return { ok: false, status: 401, detail: "Send an API token as `Authorization: Bearer …`." };
  }

  const hash = hashToken(token);
  const found = await runAsSystem(async () => {
    const row = await db.apiToken.findUnique({
      where: { tokenHash: hash },
      select: {
        id: true,
        tokenHash: true,
        organizationId: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
    if (!row) return null;
    const organization = await db.organization.findUnique({
      where: { id: row.organizationId },
      select: { planTier: true, archivedAt: true },
    });
    return organization ? { row, organization } : null;
  });

  if (!found || !constantTimeEquals(found.row.tokenHash, hash)) {
    return { ok: false, status: 401, detail: "That API token is not valid." };
  }
  const { row, organization } = found;

  if (row.revokedAt) return { ok: false, status: 401, detail: "That API token has been revoked." };
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return { ok: false, status: 401, detail: "That API token has expired." };
  }
  if (organization.archivedAt) {
    return { ok: false, status: 401, detail: "That workspace is archived." };
  }
  if (!can(organization.planTier as PlanTier, "apiAccess")) {
    return {
      ok: false,
      status: 403,
      detail: "API access is part of Enterprise, and this workspace is not on it.",
    };
  }

  // Best-effort: a failed touch must never fail the request it was recording.
  void runAsSystem(() =>
    db.apiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined),
  );

  return { ok: true, organizationId: row.organizationId, tokenId: row.id };
}

function readBearer(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
