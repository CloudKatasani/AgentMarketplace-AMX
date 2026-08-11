# SKILLS.md — Skills Required to Build AMX (Venture Edition)

Three registers: (A) Claude Code / Agent Skills to author for the build; (B) human & platform
skills; (C) startup/product skills the venture edition adds.

---

## A. Claude Code skills to author

Each skill = a folder with `SKILL.md` (frontmatter name + trigger; body procedure, constraints,
examples; reference files alongside). Keep each under ~500 lines.

1. **`gate-engine-patterns`** — trigger: any gate/approval/transition/audit work. Encodes the
   single-path rule, append-only audit writes, hash-then-commit transaction, both cascade
   recipes, solo-attestation labelling, the "no path to APPROVED" test template.
2. **`binding-validator`** — trigger: Binding, grounding pack, or tool-spec work. Encodes the
   five binding types and invariants, the no-physical-table guardrail (pack-configurable
   rules), coverage-matrix computation, plain-language rejection messages, rejection-first
   tests. Fixtures: one valid pack, one Silver-table reference (must fail), one orphan
   question (must fail).
3. **`artifact-schemas`** — trigger: any stage artifact schema/serialisation change. Zod-first
   workflow, YAML/MD/JSON conventions, schema semver, diff-view expectations. Reference
   schemas: persona-question-register, agent-charter, binding-set, grounding-pack (DPF Stage 10
   compatible), tool-specs, eval-harness, governance-review, datsisv-scorecard, agent-listing.
4. **`amx-design-system`** — trigger: any route or component. Encodes the Capgemini token
   system (never hard-code hex), consumption-first page composition, persona-lens interaction,
   coverage-matrix table pattern, STALE and AI_DRAFT treatments, empty states with one primary
   action, accessibility baseline, landing-page composition rules.
5. **`tenancy-and-plans`** — trigger: any Organization, Membership, plan-flag, or billing work.
   Encodes org-scoping middleware pattern and isolation tests, feature-flag-not-governance
   rule, upgrade-prompt placement rules, Stripe-shaped billing adapter, analytics event naming.
6. **`eval-harness-design`** — trigger: Stage 5. Golden-set construction, groundedness /
   faithfulness / citation rubric, adversarial probe taxonomy, manual-scoring-first design.
7. **`evidence-pack-export`** — trigger: certification exports. Word/PDF assembly order,
   signing/hash manifest, Excel question-catalog conventions (dropdown validations, COUNTIFS
   coverage summary).
8. **`industry-pack-authoring`** — trigger: anything under `packs/`. Pack YAML shape, Zod
   validation, persona-writing standard, conformed-backbone declaration, academy content in
   packs. Reference: `_generic` + the utility pack (Customer → Account → Premise → Service
   Point → Meter; eight domains; churn/high-bill thread).
9. **`academy-content`** — trigger: Academy work. Path→course→module→lab→assessment→credential
   hierarchy, live-object lab pattern, credential-as-audit-event, five role tracks,
   credential-gated approver roles.
10. **`demo-showcase`** — trigger: seed, demo mode, or landing work. Showcase-tenant
    idempotent seeding, read-only enforcement, the scripted 7-minute arc as an e2e test, the
    STALE-flip money moment choreography.

## B. Human & platform skills

| Skill | Why it matters | Depth |
|---|---|---|
| Next.js 15 App Router + server actions | Gate engine and marketing/app route groups | Advanced |
| TypeScript strict + Zod | Artifact schemas are the product | Advanced |
| Prisma + relational modelling + multi-tenancy | The schema *is* the governance; isolation is table stakes for SaaS | Advanced |
| Auth.js, RBAC, SSO patterns | Server-side enforcement; Enterprise-tier SSO stub | Intermediate–Advanced |
| Testing (Vitest + Playwright) | Rejection, cascade, isolation, and demo-arc tests are the credibility | Advanced |
| Design systems + Tailwind tokens | White-label readiness; brand consistency without design debt | Advanced |
| Mermaid/graph rendering | Binding graph, product inversion | Intermediate |
| Document generation (docx/xlsx/pdf) | Evidence packs, SME Excel exports | Intermediate |
| Data product management (DATSIS+V, contracts, semantic layers) | Certification substance | Advanced |
| Semantic modelling (MetricFlow-style) | QUERIES bindings, grounding packs | Advanced |
| Agent design & safety (charters, guardrails, evals) | Stages 2, 4, 5, 6 | Advanced |
| Regulatory literacy per industry | Pack constraint libraries; Stage 6 | Intermediate |
| Instructional design | Academy paths people finish | Intermediate |

## C. Startup & product skills (venture edition)

| Skill | Where it shows up |
|---|---|
| Product positioning & category design | PITCH.md narrative; landing page copy; "system of record for agent trust" |
| PLG design | Onboarding wizard, time-to-first-wow budget, single-player value, upgrade-prompt placement |
| Product analytics | Event taxonomy, activation/retention funnels on the adapter |
| Pricing & packaging | Tier design, value metric (published agents), falsifier F3 discipline |
| Sales engineering & demo craft | Demo mode, DEMO.md, the STALE-flip money moment |
| Design-partner GTM | Wedge motion ("certify what you already shipped"), co-published worked examples |
| Partner/channel strategy | Consulting-led distribution and services attach |
| Fundraising narrative | Why-now clocks, moat honesty, falsifiers — the same PITCH.md serves both sales and investors |

## D. Suggested authoring order

1. `gate-engine-patterns` + `artifact-schemas` + `tenancy-and-plans` (before Phase 1 code)
2. `binding-validator` (Phase 1 step 5) · `amx-design-system` (Phase 1 step 1)
3. `eval-harness-design` (Phase 3) · `demo-showcase` (Phase 3)
4. `industry-pack-authoring` + `academy-content` + `evidence-pack-export` (Phase 4)
