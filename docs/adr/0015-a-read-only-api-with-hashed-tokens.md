# 15. The API is read-only, and its tokens are stored as hashes

Date: 2026-08-11 · Status: Accepted

## Context

`apiAccess` had been an Enterprise flag since Phase 4 with no API behind it. The
demand is real and specific: a governance dashboard, a risk register, a CMDB
that wants to know which agents are certified and what they stand on.

Two questions had to be answered before writing a handler. What may a token do?
And what happens when it leaks — because a token that lives in someone's CI
configuration will eventually leak.

## Decision

**Read-only, by construction.** There are no write handlers, so the router
answers 405 to every write shape, and a test asserts it. This is not caution
about scope: an approval is an act by a named human at a gate, with a role, a
comment and a place in a hash chain. A bearer token is not a person, and an API
that could approve would make every certification in the product weaker.

**Only the hash is stored.** A token is 32 random bytes, shown once to the admin
who created it, and stored as SHA-256. A 12-character prefix is kept in clear so
two tokens can be told apart in a list. The comparison is constant-time — the
practical risk is negligible for a hash of a 256-bit random value, but it is the
kind of detail an enterprise security review asks about and the fix is three
lines.

**The token names the tenant, and the plan is checked per request.** Resolving a
token is system-scoped — the caller has no session — and is the second and last
such lookup in the product after invitation tokens. Everything the request then
reads happens inside the organisation that token names, through the same
`withOrg` choke-point every page uses. Because the plan is re-checked on each
request, a workspace that leaves Enterprise stops answering (403) without anyone
remembering to revoke anything; a revoked token stops answering immediately
(401).

**Audit export is its own flag.** `/api/v1/audit` is gated on `auditExport`
rather than `apiAccess`. A token that can read the catalogue is not
automatically a token that can pull an organisation's entire decision history
into someone else's system. Both are Enterprise today; they are separate
decisions.

**No names on the wire.** Approvals are returned as role, decision and
self-attestation flag. Who signed is in the evidence pack, which a person
requests; it is not something a machine polls.

## Consequences

- An integration can compute drift without a second call: every binding carries
  both the contract version it was approved against and the product's current
  one.
- Pagination is bounded (200 max) so a token cannot ask for a tenant's whole
  history in one call.
- The envelope is uniform — `apiVersion`, `data`, `meta`, and one error shape —
  so `/v1/audit` cannot drift from `/v1/agents`.
- A customer who wants write access will be told no, and told why. That is the
  intended answer.

## Alternatives rejected

- **OAuth client credentials.** Correct eventually, and it is a token-issuing
  service to build, operate and explain for a first API surface that is five
  read endpoints.
- **Signed webhooks instead of polling.** A different feature, and it does not
  answer "show me every certified agent right now".
- **Reusing the session cookie.** Ties an integration to a person's employment.
