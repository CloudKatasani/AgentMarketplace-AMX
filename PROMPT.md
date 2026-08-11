# Claude Code Kickoff Prompt — Agent Marketplace (AMX) · Venture Edition

> Paste everything below the line into Claude Code, in an empty directory that already contains
> `CLAUDE.md`. Work through it phase by phase; do not attempt to one-shot the whole application.

---

`CLAUDE.md` is in the repo root. Read it first and treat it as binding — including the product
principles and the Capgemini design-token system. If anything below conflicts with it, flag the
conflict rather than resolving it silently.

## What we are building

**AMX** — a multi-tenant SaaS product: the certification and distribution layer for enterprise
AI agents. Organisations catalog, certify, and publish agents across industries, with every
agent's dependence on governed data products made explicit, versioned, and enforced. Industry
specifics arrive through declarative packs.

The problem: enterprises are shipping agents nobody chartered, grounded on data nobody
certified, answering questions nobody inventoried — while regulators, procurement, and boards
have started asking "who approved this agent and what does it stand on?" Observability tools
answer *what did the agent do*; nothing on the market answers *was this agent ever fit to
publish*. AMX makes it structurally impossible to publish an agent without naming the persona
it serves, the questions it answers, the certified data products beneath it, and the humans who
approved every design choice.

This codebase will be demoed to top AI and product companies. Success looks like a 7-minute
demo: open the seeded showcase tenant → marketplace persona lens ("I am a Revenue Assurance
Analyst") → an agent's question catalog with per-question metric and data product → the binding
graph → a bound product bumps its contract version → the certification flips STALE live on
screen → the evidence pack downloads as a signed PDF. No slide can do what that minute does.

## Core mental model

Five nouns carry the whole product — **Agent**, **DataProduct**, **Binding**, **Persona**,
**Question** — defined in `CLAUDE.md`. The **Binding** is the moat: a versioned, gated,
first-class Agent ↔ DataProduct relationship (`GROUNDS_ON`, `QUERIES`, `RETRIEVES`, `ACTS_VIA`,
`CITES`). Build it as an entity with its own lifecycle, never as a join table with a type
column. Everything else — tenancy, packs, academy, exports, billing stubs — is scaffolding.

## Phase plan

Build in this order. Stop at the end of each phase, summarise what works and what is
unverified, and wait for my confirmation before starting the next.

### Phase 1 — Tenancy, design system, gate engine, binding validator

1. Scaffold Next.js 15 / TypeScript strict / Tailwind / shadcn / Prisma per `CLAUDE.md`.
   Implement `src/styles/tokens.css` with the Capgemini token table and wire it through
   `tailwind.config.ts`; build the app shell (top nav in `--brand-primary`, white content
   surface, `--panel` cards) so every subsequent screen inherits the brand for free.
2. Prisma schema: `Organization`, `Membership`, `PlanTier`, `User`, `Role`, `Workspace`,
   `Industry`, `Domain`, `Agent`, `Stage`, `StageRun`, `Artifact`, `ArtifactVersion`, `Gate`,
   `Approval`, `Comment`, `Task`, `AuditEvent`, `ChangeRequest`, `DataProduct`,
   `CertifiedMetric`, `Binding`, `BindingVersion`, `Persona`, `Question`, `AnalyticsEvent`.
   Every tenant-scoped row carries `organizationId`; enforce scoping in a single Prisma
   middleware, tested. Content-hashed immutable `ArtifactVersion`/`BindingVersion`; append-only
   `AuditEvent`; `archivedAt` instead of deletes.
3. `src/lib/lifecycle/stages.ts` — 8-stage registry as data: id, name, purpose, required
   artifacts, required approver roles, veto roles, exit criteria as functions returning
   `CriterionResult[]`. Include the Free-tier **solo attestation** variant: a gate may be
   satisfied by a single self-review with an explicit attestation statement, recorded and
   labelled as such in the audit trail and on the certification badge ("self-attested" vs
   "peer-certified").
4. Transition engine: single `requestTransition()` and single `recordDecision()` — the only
   path to `APPROVED`. Server-side auth + role + org-scoping enforced.
5. **Binding validator** (`src/lib/bindings/validate.ts`): `QUERIES` must name ≥1 existing
   `CertifiedMetric`; reject any binding, grounding artifact, or tool spec referencing a
   physical Bronze/Silver table (layer metadata + configurable identifier rules); a `Question`
   is valid only when mapped to ≥1 binding on the same agent. Rejection messages must be
   plain-language with a suggested fix — validator UX is a demo moment, not a stack trace.
6. **Cascade invalidation**, both directions: artifact re-version → downstream gates `STALE`
   with re-approval `Task`s; bound `DataProduct` major version bump → dependent certifications
   and listings flip `STALE` with a visible "re-certification pending" banner (`--band` tint,
   warning state).
7. `artifacts/commit.ts` — hash, version, mirror to `workspace/`, audit event, one transaction.
   Auth.js credentials + org invite flow (email stubbed to console). Seed script: the
   **showcase tenant** (read-only flag) with one user per role, two data products with
   certified metrics (`residential_churn_rate v2.1`, `high_bill_risk` on Customer 360), and a
   starter agent mid-lifecycle at stage 3.
8. Analytics adapter (`src/lib/analytics`) with a no-op default and a console driver; emit
   `org_created`, `agent_created`, `binding_validated`, `gate_decided`, `stale_triggered`.
9. Tests: tenant isolation, exit criteria, role enforcement, both cascade paths, audit
   immutability, validator rejections, solo-attestation labelling, and the "no path to
   APPROVED except recordDecision()" assertion.

End of Phase 1: I can create an org, land in a seeded workspace, declare a binding, watch the
validator reject a bad one with a helpful message, pass a gate solo with attestation, and see
the audit trail — all in the branded shell.

### Phase 2 — Stages 1–4 + onboarding

Authoring UI, Zod schema, YAML/Markdown serialisation for:

- **Stage 1 · Consumption Discovery** — `persona-question-register.yaml`. Persona = named role
  (business or IT), owned decisions, cadence, current workaround, ≥3 questions with intent
  class (`lookup`, `trend`, `comparison`, `diagnosis`, `forecast`, `recommendation`,
  `navigation`) and consequence-of-no-answer. The most important screen in the product —
  maximum design attention. Stage 2 hard-blocked until one complete persona exists.
- **Stage 2 · Agent Charter** — archetype (`Analyst`, `Advisor`, `Monitor`, `Operator`,
  `Navigator`, `Educator`), one-sentence mission, scope boundary with explicit out-of-scope
  list, value hypothesis with success measures, risk tier (informational / decision-support /
  action-taking), named owner, escalation contact.
- **Stage 3 · Data Product Binding** — the workhorse. Product picker showing contract version,
  quality score, freshness; binding type; metric selection for `QUERIES`; the
  **question-coverage matrix** (questions × bindings) that must reach 100% to exit; inline
  validator feedback. Register a new `DataProduct` from an imported DPF/ADPM export
  (`marketplace-listing.json` + `semantic-model.yaml` + `data-contract.yaml`) in the same flow.
- **Stage 4 · Grounding & Tool Design** — `grounding-pack.json` (sample questions, glossary,
  metric definitions, allowed joins, disambiguation hints; field-compatible with the DPF Stage
  10 grounding pack) and `tool-specs.yaml` (function specs with Zod input/output schemas,
  per-tool binding reference, refusal and escalation rules). Validator runs on both.

Each stage: draft → submit → field-anchored reviewer comments → changes-requested loop →
approval → lock; version diff view; per-stage parking lot.

Plus the **onboarding wizard**: pick industry pack → name workspace → seeded starter agent and
data products land instantly → a 5-step guided tour ending on the coverage matrix. Instrument
every step; target time-to-first-wow < 10 minutes and assert the flow in an e2e test.

### Phase 3 — Stages 5–8, marketplace, demo mode

- **Stage 5 · Evaluation Harness** — golden set seeded from stage 1; groundedness /
  faithfulness / citation-correctness rubric; adversarial set (out-of-scope, prompt-injection,
  raw-data-access probes); thresholds; results log as committed artifacts. Manual scoring must
  fully work without a live model.
- **Stage 6 · Governance & Guardrails** — invocation access policy; sensitivity inheritance
  (agent inherits the highest classification among bound products); regulatory constraint
  mapping from the pack library; Privacy/Security Officer veto; incident + rollback runbook;
  kill-switch owner.
- **Stage 7 · Certification** — DATSIS+V scorecard, each dimension scored against cited
  evidence (artifact version + field, never free text); signed evidence pack (Word + PDF):
  charter, bindings, coverage matrix, eval results, approvals, audit events. Badge
  differentiates "peer-certified" from "self-attested".
- **Stage 8 · Publish & Operate** — `agent-listing.json`; usage telemetry (invocations, intent
  mix, persona mix); feedback log; staleness dashboard (bound-product freshness + version
  drift); change requests; version bumps trigger cascade re-approval; deprecation and
  retirement with consumer notification.

- **Marketplace** — the front door and the demo centrepiece:
  - search + filters: industry, domain, archetype, risk tier, persona, certification status,
    bound-product quality score, freshness
  - **persona lens**: "I am a ___" → agents ranked by question coverage for that persona
  - agent detail page assembled entirely from committed artifacts: charter summary, personas,
    question catalog with per-question answering metric and product, binding graph (Mermaid),
    DATSIS+V badge, evidence pack download
  - **"agents like this"** by shared products, personas, and conformed-backbone entities
  - **product-view inversion**: from any data product, every dependent agent and binding type —
    the lineage question executives actually ask

- **Demo mode**: the showcase tenant reachable from the landing page as "Explore the live
  demo", read-only, reseeded idempotently by `pnpm seed:showcase`, protected by a test that
  walks the 7-minute demo arc (persona lens → question trace → binding graph → live STALE flip
  → evidence pack download).

### Phase 4 — Academy, packs, exports, monetisation surfaces, AI assist

- **Academy.** `LearningPath`, `Course`, `Module`, `Lab`, `Assessment`, `Credential`. Role
  paths shipped as pack content: Business Consumer, Agent Product Owner, Agent Builder, Data
  Product Owner, Governance Officer. Labs reference live marketplace objects. Credentials are
  audit events with profile badges; a workspace setting can require the Governance Officer
  credential before holding approver roles. Academy is a retention and land-and-expand surface
  — track path starts/completions in analytics.
- **Packs.** YAML: industry, domains, conformed backbone, personas, canonical question library,
  starter agents (importable stage-1/2 drafts), starter data products with metrics, regulatory
  constraint library, glossary, academy content. Zod-validated; `pnpm pack:validate` in CI.
  Ship `_generic` + utility/energy, banking, insurance, retail/CPG, healthcare, manufacturing,
  telecom, public sector. The utility pack carries Customer → Account → Premise → Service
  Point → Meter, the eight utility domains, and threads `residential_churn_rate` /
  `high_bill_risk` through its starter agent. Packs are illustrative and editable.
- **Exports** behind adapters: charter + evidence pack (Word/PDF), question catalog (Excel with
  dropdown validations and a COUNTIFS coverage-summary sheet), grounding pack + listing (JSON),
  binding graph (Mermaid + SVG), full agent bundle (zip).
- **Monetisation surfaces (no live billing yet):** plan tiers as feature flags —
  `FREE` (1 workspace, 3 agents, solo attestation, `_generic` pack), `TEAM` (peer gates, all
  packs, exports), `ENTERPRISE` (SSO stub, white-label theme override, API access, audit
  export). Billing adapter with a Stripe-shaped interface and an in-memory driver; upgrade
  prompts appear only at genuine capability boundaries, never as interruptions. A public
  **landing page** at `(marketing)/`: one-line positioning, the 7-minute demo entry point,
  three proof panels (question trace, STALE cascade, evidence pack), pricing table, and a
  design-partner CTA — all on the token system.
- **Optional AI assist**: propose-only, disabled by default, user-supplied key, outputs
  persisted as `AI_DRAFT` with the marked visual treatment. Surfaces: draft persona questions
  from a decision description; propose bindings by matching questions to registered metrics;
  generate adversarial probes; critique an artifact against exit criteria; optionally execute
  eval runs against a live model. Never calls `recordDecision()`; never required.

### Phase 5 — Hardening and the sales demo

Playwright e2e: full 8-stage path to published; rejection loop; both cascade paths; onboarding
under 10 minutes; the complete 7-minute showcase arc; one academy path to credential; tenant
isolation probes. Seed the worked example end-to-end ("Customer Churn Advisor" on Customer 360,
utility pack). README with five-minute quickstart. ADRs for significant choices. Performance
sanity at ~50 orgs, ~200 agents, ~100 products, ~2,000 questions. `DEMO.md`: the scripted
7-minute arc with per-step screen, talk track cue, and fallback.

## Working agreement

- Plan first for any multi-file change; list files, then execute. Vertical slices over
  horizontal scaffolding.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` before declaring done; state
  explicitly what you could not verify.
- Ask when governance or tenancy semantics are ambiguous. Do not ask about styling — the
  design-token system in `CLAUDE.md` decides.
- No speculative files, no placeholder routes, no abstraction without a second concrete use.

Start with Phase 1. Before writing code, give me your proposed Prisma schema (tenancy
included), the shape of `stages.ts` and `bindings/validate.ts`, and the token → Tailwind wiring
plan, and wait for my sign-off on those four things.
