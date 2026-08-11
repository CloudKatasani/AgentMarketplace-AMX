/**
 * The one entry point every API route goes through.
 *
 * It authenticates the bearer token, enters the organisation that token names,
 * and hands the handler a tenant-scoped client. A route that forgot to do any
 * of that would not compile against this signature — which is the same
 * argument as `withOrg` for pages, applied to a surface with no session.
 */
import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { withOrg } from "@/lib/db/scope";
import type { AmxPrismaClient } from "@/lib/db/tenancy";

import { fail } from "./respond";
import { verifyApiToken } from "./tokens";

export type ApiContext = {
  organizationId: string;
  url: URL;
  scoped: AmxPrismaClient;
};

export function apiRoute(
  handler: (context: ApiContext) => Promise<NextResponse>,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    const caller = await verifyApiToken(db, request.headers.get("authorization"));
    if (!caller.ok) return fail(caller.status, caller.detail);

    const url = new URL(request.url);
    return withOrg(caller.organizationId, (scoped) =>
      handler({ organizationId: caller.organizationId, url, scoped }),
    );
  };
}
