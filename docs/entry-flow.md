# The way in

Three doors, in the order most people want them, and none of them asks for an
account.

| Door | URL | What it costs the visitor |
|---|---|---|
| Read the catalogue | `/catalog` | nothing — no session at all |
| Open a workspace | `/onboarding` | one click; no email, no password, no card |
| Explore the live demo | `/demo` | nothing; read-only showcase tenant |

Signing in still exists at `/signin`, for people who already have an account and
for anyone who accepted an invitation. It is one option in the nav rather than
the wall in front of the product.

## 1 · The public agent catalogue

`/catalog` lists every shipped industry pack; `/catalog/{industry}` renders one
in full:

- **starter agents**, each with the persona whose decisions it serves, the
  questions it answers, and — per question — the certified metric and data
  product behind the answer, or a plain statement that nothing answers it yet;
- **certified data products** with contract version, layer, sensitivity, quality
  score and metrics;
- **personas**, **regulatory constraint prompts**, **academy paths**, and the
  **glossary**;
- the pack's own disclaimer, which says it is a starting point rather than a
  standard.

It reads packs from disk, never the database. There is no tenant involved, which
is exactly why it can be public — and why a visitor sees the same content their
own workspace would be seeded with, rather than a marketing approximation of it.

## 2 · Opening a workspace without an account

One screen. Choose an industry, optionally name the workspace, and the industry
choice *is* the sign-up:

1. a guest identity is minted server-side — a reserved `@guest.amx.local`
   address and a random password used once, in-process, to establish the
   session;
2. the workspace is seeded from the chosen pack, exactly as before;
3. the person lands on their own starter agent with the guided tour running.

The workspace is ordinary: FREE tier, real gates, a real audit trail. A guest can
author every stage and self-attest their way to a published agent —
`e2e/full-walk.spec.ts` does precisely that, from this entry point.

A band across the top says what being a guest means and links to the claim form.

## 3 · Claiming

Settings → **Claim this workspace**: a name, an email, a password. It updates the
same `User` row, so memberships, roles, authored artifacts and every audit event
that names that actor stay pointed at the same id. Nothing moves; nothing is
re-attributed. An approval signed before the claim is still that person's
approval afterwards.

Claiming is also the unlock for inviting anyone, and that is deliberate: an
invitation grants a role, a role decides who may sign a gate, and an identity
nobody can contact should not be handing those out. The refusal says exactly
that and points at the form.

## The catalogue's breadth

Each pack shipped with two or three data products — enough to seed a starter
agent, not enough to browse. Every pack now carries **nine or ten**, across its
own declared domains, each with certified metrics at a stated grain: field
service, asset health, trading positions and emissions for utilities; capital
and liquidity, payments flows and collections for banking; theatre utilisation,
diagnostics turnaround and population risk for healthcare, and so on.

`scripts/expand-packs.mjs` authored them and stays in the repository: the next
person adding a pack wants the shape, and the diff is easier to review against
the generator than against nine YAML files. A test asserts the floor — at least
eight products per pack, every product in a domain the pack declares, and metric
keys unique inside a pack, because the catalogue resolves a question to its
metric by key and a duplicate would answer the wrong question with the right
number.

## What this changed elsewhere

- **`/onboarding/account` is gone.** One screen replaces two.
- **The session reads name, email and guest status from the user row** rather
  than the JWT, so a claim shows up on the next render instead of the next
  sign-in.
- **`/demo` refuses to touch an existing session.** It establishes one, and Next
  prefetches links — so a page that merely *rendered* a link to the demo used to
  sign the reader in, and could swap a signed-in customer into the demo tenant
  without a click. It now redirects an existing session to `/marketplace`
  untouched, and every link to it carries `prefetch={false}`. A browser test
  pins the behaviour.
- **Tenant context is pinned to `globalThis`.** Next evaluates a module more
  than once in development while the Prisma client is cached, so the client
  closed over the *first* `AsyncLocalStorage` and every `runAsOrg` wrote to a
  second one. Every tenant-scoped query threw `MissingOrgContextError` in `pnpm
  dev` and passed in production, where there is one registry — which is why the
  browser suite was green while the app was unusable locally. That is what broke
  "Explore the live demo", "Sign in" and "Open a workspace": all three land on a
  page that queries. A test reproduces it with `vi.resetModules()` and fails
  without the fix.
- **Badge tints became solid tokens.** `bg-success/10` blends with whatever is
  behind it, so the same badge cleared AA on white and failed it on `--panel`
  and `--band`. `--success-tint`, `--brand-tint`, `--danger-tint` and
  `--ai-draft-tint` fix the contrast wherever the badge lands.

## Not done

- **Housekeeping for unclaimed workspaces.** Guest tenants are ordinary tenants
  and they accumulate; no archiving job ships today.
- **Rate limiting on workspace creation.** One click with no email is also one
  click for a script. A deployment that exposes this publicly wants a limiter in
  front of it.
