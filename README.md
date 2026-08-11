# AMX — the certification and distribution layer for enterprise AI agents

Every published agent proves, per question, which certified data product answers it and which
human approved it.

`CLAUDE.md` is binding for work in this repository. `PROMPT.md` holds the phase plan,
`PITCH.md` the positioning, `SKILLS.md` the skill register.

**Status: Phase 4 complete** — the full eight-stage lifecycle, the marketplace, signed evidence
packs, demo mode protected by a test, nine industry packs, the Academy with credential-gated
approver roles, the full export set, a Stripe-shaped billing adapter, and propose-only AI assist.
Phase 5 is hardening: end-to-end browser tests, ADRs, and the scripted demo.

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

1. **Create an organisation** — pick an industry, and land in a seeded workspace with a guided
   tour that ends on the coverage matrix. Never an empty screen.
2. **Author Stages 1–4**: the persona and question register, the charter (hard-blocked until
   Stage 1 is real), bindings and coverage, and the grounding pack and tool specs.
3. **Declare a binding** and watch the validator refuse a bad one in plain language with a
   suggested fix.
4. **See the coverage matrix** — questions × bindings, with the certified metric in each cell.
   Stage 3 will not close below 100%.
5. **Run a review round**: anchor a comment to a field, request changes, re-version, and see the
   diff between two versions of an artifact.
6. **Pass a gate solo** with a recorded attestation, labelled *self-attested* rather than
   *peer-certified*.
7. **Import a data product** from a DPF/ADPM export — refused if it is served from a raw layer.
8. **Publish a breaking contract version** and watch dependent certifications flip to STALE with
   re-certification tasks — immediately, on the next render.
9. **Certify an agent** against DATSIS+V with every score citing an artifact field, then
   **download the evidence pack** as PDF or Word with a verifiable manifest.
10. **Browse the marketplace** through a persona lens, and invert it: from a data product, every
    agent standing on it.
11. **Read the audit trail**, hash-chained and verified on screen.

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
| `pnpm pack:validate` | Validate every industry pack (runs in CI) |
| `pnpm verify` | typecheck + lint + packs + tests + build |

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
    stages/                consumption · charter · grounding · review
    artifacts/             commit (hash → version → audit → mirror) · schemas · diff
    db/                    tenancy extension + model classification
    audit/  analytics/  plans/  seed/  auth/
  styles/tokens.css        the only file containing a colour value
prisma/schema.prisma
workspace/                 mirrored artifact versions (gitignored)
```

## Design decisions

`docs/phase-1-design.md` carries the Phase 1 proposal, the flagged conflicts, and an as-built
section recording where the implementation departed from the plan and why.
`docs/phase-2-design.md` covers the authoring stages, the review loop, onboarding, and the two
bugs that only showed up when the app was actually driven in a browser.
