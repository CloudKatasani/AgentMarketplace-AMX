# CLAUDE.md — Agent Marketplace (AMX) · Venture Edition

This file is binding for every session in this repository. If a prompt, issue, or instruction
conflicts with it, flag the conflict — do not resolve it silently.

## What this product is

**AMX** — a multi-tenant SaaS product that is the **system of record for enterprise agent
trust**: it catalogs, certifies, and distributes AI agents across industries, and makes every
agent's dependence on governed **data products** explicit, versioned, and enforced.

Positioning in one line: *the certification and distribution layer for enterprise AI agents —
where every published agent proves, per question, which certified data product answers it and
which human approved it.*

AMX is being built to be sold and demoed to sophisticated AI and product companies. Every
screen must survive two audiences at once: a Chief Data/AI Officer asking "can I defend this to
my regulator?" and a product leader asking "would my team actually enjoy using this?" If a
feature satisfies governance but feels like enterprise sludge, it is not done.

## Product principles (in priority order)

1. **Time-to-first-wow under 10 minutes.** A new organisation picks an industry pack and lands
   in a seeded workspace with a starter agent mid-lifecycle — never an empty screen.
2. **Demo mode is a first-class feature.** A read-only, fully seeded showcase tenant exists at
   all times for sales demos; it can never be broken by product changes without a failing test.
3. **Single-player value before multi-player.** One practitioner must get value (charter an
   agent, see the coverage matrix, export an evidence pack) before any approval flow involves a
   second human. Gates support a solo "self-review with attestation" mode in the Free tier.
4. **Governance as a feature, not friction.** Every gate, validator rejection, and STALE flag
   must explain itself in plain language and offer the next action inline.
5. **Instrumented by default.** Emit product analytics events through an adapter (PostHog-style
   interface, no vendor lock); never block the UI on analytics; no PII in event payloads.
6. **White-label ready.** All brand decisions live in design tokens; a buyer can rebrand by
   editing one file.

## Non-negotiable governance principles

1. **Consumption-first.** Every agent page leads with the persona, the blocked decision, and
   the questions — never with the model, framework, or tools.
2. **Semantic layer is the fulcrum.** Agents answer through certified metrics and semantic
   models. **No free-form text-to-SQL against raw or Bronze/Silver physical tables — ever.**
   Validators reject any grounding or tool spec referencing a physical table.
3. **Agents are chartered, not deployed.** No agent exists without mission, scope boundary,
   explicit out-of-scope list, guardrails, and a named human owner.
4. **The Agent ↔ Data Product Binding is a first-class, versioned, gated entity.** Cascade
   invalidation: a major version bump on a bound product flips dependent certifications to
   `STALE`.
5. **Governance is structural.** Single-path `recordDecision()`, append-only `AuditEvent`,
   content-hashed immutable artifact versions, `archivedAt` instead of deletes.
6. **Industry-agnostic core, declarative packs.** Packs change vocabulary and seed content,
   never logic. Zod-validated on load.
7. **DATSIS+V certification against cited evidence**, never free text.

## Core nouns

| Noun | Meaning |
|---|---|
| `Organization` | Tenant. Owns workspaces, members, plan tier, theme override. |
| `Agent` | Unit of work; 8-stage gated lifecycle. |
| `DataProduct` | Registered reference to a certified data product: contract + semantic model versions, certified metrics, quality score, freshness, owner, domain. |
| `Binding` | Versioned Agent ↔ DataProduct relationship. Type ∈ {`GROUNDS_ON`, `QUERIES`, `RETRIEVES`, `ACTS_VIA`, `CITES`}. Gated. |
| `Persona` | Named business or IT role: owned decisions + question archetypes. |
| `Question` | Catalogued sample question mapped persona → binding(s) → certified metric(s), with intent class and expected answer shape. |
| `Artifact` / `Gate` | As in the gate engine: immutable versions; approval checkpoints with roles, quorum, veto, audit. |
| `LearningPath` | Academy: role path → courses → modules → labs → assessment → credential. |

## Agent lifecycle (8 gated stages)

1 Consumption Discovery · 2 Agent Charter · 3 Data Product Binding · 4 Grounding & Tool Design ·
5 Evaluation Harness · 6 Governance & Guardrails · 7 Certification (DATSIS+V) · 8 Publish & Operate.
Stage 2 hard-blocks until ≥1 persona with ≥3 complete questions; Stage 3 exit requires 100%
question coverage; Stage 7 requires cited evidence per DATSIS+V dimension.

## Design system — Capgemini light theme

All tokens in `src/styles/tokens.css` (CSS variables) surfaced through `tailwind.config.ts`.
White backgrounds throughout. Never hard-code a hex in a component.

| Token | Hex | Use |
|---|---|---|
| `--brand-primary` | `#0070AD` | Primary buttons, header band, active nav, links on white |
| `--brand-accent` | `#12ABDB` | Progress, highlights, selected states, secondary badges |
| `--brand-ink` | `#00375F` | Headings and body text on light surfaces |
| `--brand-deep` | `#005A87` | Primary hover/pressed, chart depth series |
| `--surface` | `#FFFFFF` | Page background |
| `--panel` | `#EAF3FB` | Cards, hero panels, onboarding surfaces |
| `--band` | `#DCEAF6` | Synthesis strips, table header rows, info banners |

Semantic states (outside the brand palette, WCAG AA on white): success `#1E7B34`, warning /
`STALE` `#B45309` on `#FEF3C7` tint, danger / veto `#B91C1C`, `AI_DRAFT` marker `#6D28D9` with
a dashed border treatment. Focus rings use `--brand-accent`.

Typography: Inter (variable), `--brand-ink` for text; page titles 28/36 semibold, section
titles 18/28 semibold, body 14/22. Density: comfortable by default, compact toggle on tables.
Chart palette order: primary → accent → deep → navy tints. Every list/table has a designed
empty state with one primary action; every STALE state names the cause and the re-approval path.

## Stack

Next.js 15 (App Router) · TypeScript strict · Prisma + SQLite (Postgres via
`docker-compose.yml`) · Auth.js · Zod at every boundary · shadcn/ui + Tailwind (tokenized) ·
Vitest + Playwright · pnpm. Billing behind an adapter (Stripe-ready, stubbed). Analytics behind
an adapter. Feature flags per plan tier (`FREE`, `TEAM`, `ENTERPRISE`) in
`src/lib/plans/features.ts` — flags gate features, never governance rules.

## Repository layout

```
src/
  app/                     # (marketing)/ landing · (app)/ marketplace, agents/[id], academy, admin, onboarding
  lib/
    lifecycle/stages.ts    # 8-stage registry as data; exit criteria as functions
    gates/                 # requestTransition(), recordDecision() — the only approval path
    bindings/              # validators incl. the no-physical-table guardrail
    artifacts/commit.ts    # hash, version, mirror, audit — one transaction
    packs/  plans/  analytics/  billing/  academy/
  styles/tokens.css
prisma/schema.prisma
packs/_generic/ …          # + industry packs
workspace/                 # mirrored committed artifacts
```

## Working rules

- Plan multi-file changes first; list files, then execute. Vertical slices over scaffolding.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` before declaring done; state what
  was not verified.
- Ask when governance semantics are ambiguous. Never ask about styling — the design system
  above decides; pick within it and move on.
- No speculative files, no placeholder routes, no abstraction without a second concrete use.
- AI assist (if enabled): propose-only, persisted as `AI_DRAFT`, visually marked, can never
  call `recordDecision()`, never required to complete a stage.
