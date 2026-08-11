# AMX — the certification and distribution layer for enterprise AI agents

Every published agent proves, per question, which certified data product answers it and which
human approved it.

`CLAUDE.md` is binding for work in this repository. `PROMPT.md` holds the phase plan,
`PITCH.md` the positioning, `SKILLS.md` the skill register.

**Status: Phase 1 complete** — tenancy, design system, gate engine, binding validator, both
cascade directions, audit chain, and a seeded showcase tenant. Stage authoring UI (Stages 1–4)
lands in Phase 2; marketplace and demo mode in Phase 3.

---

## Quickstart

```bash
pnpm install
cp .env.example .env          # SQLite by default; nothing else to configure
pnpm prisma db push           # or: pnpm db:migrate
pnpm seed                     # reference data + the read-only showcase tenant
pnpm dev
```

Then either **create your own organisation** at `/onboarding` — you land in a workspace that
already has two certified data products and an agent part-way through its lifecycle — or sign in
to the showcase tenant with any of the demo accounts printed by `pnpm seed`
(password `amx-demo-2024`).

Postgres instead of SQLite: `docker compose up -d`, set the datasource `provider` in
`prisma/schema.prisma` to `postgresql`, and point `DATABASE_URL` at it. No schema changes are
needed — every enum is a `String` column whose domain lives in `src/lib/enums.ts`.

## What you can do today

1. **Create an organisation** and land in a seeded workspace — never an empty screen.
2. **Declare a binding** and watch the validator refuse a bad one in plain language with a
   suggested fix.
3. **See the coverage matrix** — questions × bindings, with the certified metric in each cell.
   Stage 3 will not close below 100%.
4. **Pass a gate solo** with a recorded attestation, labelled *self-attested* rather than
   *peer-certified*.
5. **Publish a breaking contract version** on a data product and watch dependent certifications
   flip to STALE with re-certification tasks — immediately, on the next render.
6. **Read the audit trail**, hash-chained and verified on screen.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm typecheck` | `tsc --noEmit`, strict |
| `pnpm lint` | ESLint, including the no-hard-coded-colour rule |
| `pnpm test` | Vitest against a real SQLite database |
| `pnpm build` | Production build |
| `pnpm seed` | Reference data + showcase tenant (idempotent) |
| `pnpm seed:showcase` | Showcase tenant only |

## How it is put together

**The Binding is first-class.** `Binding` is an entity with its own lifecycle and immutable
versions, not a join table with a type column. Each `BindingVersion` *pins* the contract version
it was approved against, which is what makes cascade invalidation a comparison rather than a
guess.

**One path to APPROVED.** `recordDecision()` is the only code that may write an `Approval`,
close a gate, advance a stage, or grant a certification. `tests/no-path-to-approved.test.ts`
reads the source tree and fails the build if anything else does.

**Gates approve snapshots.** A gate stores a hash over the artifact versions under review, so an
artifact edited mid-review provably invalidates the approval instead of being silently covered
by it.

**Tenant isolation is deny-by-default.** One Prisma client extension scopes every query; a
tenant-scoped query with no organisation in context throws. Every model is explicitly classified
as global or tenant-scoped, and an unclassified model fails a test.

**The audit trail is hash-chained** per organisation, so tampering is detectable rather than
merely forbidden.

**Governance is never a paid feature.** `src/lib/plans/features.ts` gates capabilities only; a
test asserts the gate engine, lifecycle registry, and validator never import it.

```
src/
  app/                     (app)/ agents · data-products · audit · signin · onboarding
  lib/
    lifecycle/stages.ts    8-stage registry; exit criteria are pure functions
    gates/                 requestTransition() · recordDecision() · cascade
    bindings/              validate · coverage · service
    artifacts/             commit (hash → version → audit → mirror) · schemas
    db/                    tenancy extension + model classification
    audit/  analytics/  plans/  seed/  auth/
  styles/tokens.css        the only file containing a colour value
prisma/schema.prisma
workspace/                 mirrored artifact versions (gitignored)
```

## Design decisions

`docs/phase-1-design.md` carries the Phase 1 proposal, the flagged conflicts, and an as-built
section recording where the implementation departed from the plan and why.
