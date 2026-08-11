# Phase 4 — Packs, Academy, exports, monetisation, and AI assist

## 1 · Packs are content, not configuration

Nine packs ship: `_generic` plus utilities, banking, insurance, retail/CPG, healthcare,
manufacturing, telecom, and public sector. Each declares its domains, conformed backbone,
personas, question library, certified data products, a starter agent, a regulatory constraint
library, a glossary, and academy content.

**A pack changes vocabulary and seed content; it never changes logic.** There is no field in the
schema that can weaken a gate, skip a stage, or make a validator lenient. The single exception is
`referenceRules`, which may only *tighten* the physical-reference patterns — because "what counts
as a raw table" genuinely is a platform dialect (`bronze.` in one shop, `RAW_` in another,
`^cis_raw` in a utility running a legacy CIS).

Validation runs on load and in CI (`pnpm pack:validate`). Beyond structure, it checks the
cross-references that would produce a broken *workspace* rather than a broken file: a starter
agent pointing at a question that does not exist, a `QUERIES` binding with no metric, or a
question whose expected metric none of the agent's bindings provide. A pack that would seed an
agent with a coverage gap on day one fails the build.

Picking an industry at onboarding now genuinely changes what lands — a banking workspace gets
`credit-risk-360` and a Credit Risk Analyst, not utility vocabulary with a different label.

## 2 · The Academy: content in packs, progress in the tenant

`PROMPT.md` lists `LearningPath`, `Course`, `Module`, `Lab`, `Assessment`, and `Credential` as
models. **Only `Credential` (plus `LearningEnrolment` and `ModuleCompletion`) became tables.**
Paths, courses, modules, labs, and assessments are pack content — versioned with the code and
reviewable in a diff. Copying them into every tenant would guarantee drift the first time a
module is corrected, and there is no per-tenant editing of course text to justify it. Flagged as
a deliberate departure.

Two things make it more than a course catalogue:

- **Labs point at live objects.** "Open the coverage matrix and follow one question to its metric"
  cannot go stale relative to the product the way a screenshot can.
- **A credential is an audit event.** It is evidence that a named person demonstrated something,
  so it lives in the append-only record, and the `Credential` row carries the event id.

**Credential gating** is off by default and enabled per organisation
(`Organization.requireApproverCredentials`). It reads through one function that the gate engine
calls, and it can only ever make approval *harder* — which is the test for whether something is
allowed near `recordDecision()` at all.

Assessments pass on every answer, not a majority. These are short, and the credential can gate
who may approve an agent; a "good enough" pass on the module about what an approval means would
be an odd thing to build.

## 3 · Exports

| Export | Notes |
|---|---|
| Evidence pack (PDF, Word) | Available on **every plan** |
| Question catalogue (Excel) | Dropdown validations on intent class and metric, COUNTIFS coverage summary |
| Grounding pack, listing (JSON) | DPF-compatible shapes |
| Binding graph (Mermaid, SVG) | For other people's docs and slides |
| Full bundle (zip) | Artifacts as YAML, catalogue, graph, both packs, and the manifest |

The Excel catalogue is the one people live in — SMEs review question lists in a spreadsheet
whatever the product does — so it ships with dropdowns that prevent a reviewer inventing a value
the validator would reject, and a computed coverage summary rather than a pasted number.

**The evidence pack is deliberately not gated.** A Free-tier practitioner has to be able to hand
someone the pack; that is the wedge. Gating it would make the free tier a demo rather than a
product.

## 4 · Monetisation

Billing sits behind a Stripe-shaped adapter with an in-memory driver — enough to build and test
every upgrade path without a network call. The **value metric is published, certified agents**,
metered from the same `Agent.certification` column the gate engine writes, so the meter cannot
drift from the governance record.

`upgradePromptFor()` returns `null` unless a capability genuinely ends. Prompts appear at
boundaries, never on a timer or as a dismissible banner. And the Free tier is never offered solo
attestation back as a paid feature — the prompt for peer review says explicitly that solo
attestation is available on every plan and always will be.

## 5 · AI assist — propose-only, and structurally so

Four rules, enforced by construction:

1. **Off by default.** `assistDriver()` returns `enabled: false` unless an organisation configures
   a driver with its own key.
2. **Propose-only.** `src/lib/ai` does not import `@/lib/gates`, and a test asserts it — after
   stripping comments, so a doc comment explaining the rule does not trip the test that checks it.
3. **Marked.** Anything committed from a proposal carries `isAiDraft` and renders with the dashed
   AI_DRAFT treatment.
4. **Never required.** Every stage completes with the assist off.

The `rules` driver is keyword matching over the workspace's own certified metrics — not a language
model, and it says so in its own rationale ("crude on purpose — check each one"). It is genuinely
useful for the boring half of Stage 3, and honest about what it is. Two details worth keeping:

- Drafted questions leave `consequenceOfNoAnswer` **blank**. An invented consequence reads as if
  someone thought about it, which is worse than an empty field.
- The critique function takes the stage's exit criteria *as data* rather than re-deriving them, so
  it can never disagree with the gate — it only explains in advance what the gate will say.

## 6 · Verification

`pnpm typecheck`, `pnpm lint`, `pnpm pack:validate` (9 packs), `pnpm test` (**194 tests, 12
files**), and `pnpm build` all pass. `pnpm verify` runs the lot.

Phase 4 tests cover: every pack on disk validating, no pack shipping a product an agent could not
bind to, seeding in the chosen industry's vocabulary with complete coverage on day one, the
academy's near-miss refusal and credential-as-audit-event, credential gating on and off, the
Excel catalogue's two sheets, the zip bundle's manifest, the certified-agent meter, upgrade
prompts staying silent until a boundary, and each AI-assist surface including the case where no
metric matches.

**Not verified:** the Academy and export screens driven in a browser (covered by unit tests), the
Anthropic assist driver against a live key, and Stripe itself.
