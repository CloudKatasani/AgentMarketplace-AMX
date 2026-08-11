/**
 * The shape every API response has.
 *
 * One envelope, one error format, one place that decides them. An integration
 * written against `/v1/agents` should not have to discover that `/v1/audit`
 * paginates differently or names its error field something else.
 *
 * The API is read-only by construction: there are no write handlers, and the
 * governance rules say why — an approval is an act by a named human at a gate,
 * and a bearer token is not a person.
 */
import { NextResponse } from "next/server";

export const API_VERSION = "v1";

/** Bounded so a token cannot ask for a tenant's entire history in one call. */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export type Page = { limit: number; offset: number };

export function readPage(url: URL): Page {
  const limit = Number(url.searchParams.get("limit") ?? DEFAULT_PAGE_SIZE);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  return {
    limit: Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE,
    offset: Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0,
  };
}

export function ok<T>(
  data: T,
  meta?: { total?: number; limit?: number; offset?: number },
): NextResponse {
  return NextResponse.json(
    { apiVersion: API_VERSION, data, ...(meta ? { meta } : {}) },
    {
      headers: {
        "Cache-Control": "no-store",
        // A governance record is not something to serve from a proxy.
        "X-AMX-Api-Version": API_VERSION,
      },
    },
  );
}

export function fail(status: number, detail: string): NextResponse {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { status, detail } },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(status === 401 ? { "WWW-Authenticate": 'Bearer realm="AMX"' } : {}),
      },
    },
  );
}
