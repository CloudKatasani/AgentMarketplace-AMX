# Phase 3 — Stages 5–8, the marketplace, and demo mode

## 1 · The lifecycle is now eight gates, not eight forms

Phase 3 completes Stages 5–8 and, in doing so, closed a hole the earlier phases left open.

**Sequential gating.** `requestTransition()` now refuses to open a stage while any earlier stage
is unapproved. Without it an agent could be walked straight to Stage 8 and published while its
charter was never signed — which would make the lifecycle a series of forms rather than a series
of gates. It is enforced in the one place a gate can open, and the refusal names the stages still
outstanding. This was found by the demo-arc test, not by review.

| Stage | What it produces | Refuses when |
|---|---|---|
| 5 · Evaluation Harness | `eval-harness` | any case is unscored, an adversarial probe was answered rather than refused, or an average is below the declared threshold |
| 6 · Governance & Guardrails | `governance-review` | the declared sensitivity is lower than what the bound products imply, or an applicable regulatory constraint is unaddressed |
| 7 · Certification | `datsisv-scorecard` | a dimension is unscored, uncited, below the minimum, or its citation does not resolve to a committed artifact field |
| 8 · Publish & Operate | `agent-listing` | the agent is uncertified or stale, or a binding is waiting on re-approval |

## 2 · Design decisions worth defending

**Manual scoring is the primary path at Stage 5.** Most enterprises evaluating an agent do it by
reading answers, not by wiring a judge model into their governance tool. Adversarial cases are
scored on a different axis from the golden set, because they pass by being *refused* — an agent
that answers every probe helpfully has no scope, whatever its groundedness score says.

**Sensitivity is inherited, not declared.** Stage 6 computes the highest classification among the
bound products and shows it; the form has no field to lower it. Letting someone type a smaller
number than the data supports would make the whole classification decorative.

**Evidence is a citation, never free text.** A DATSIS+V score points at an artifact kind, a
version number, and a field path — and `saveScorecard` refuses a citation that does not resolve.
A citation that looks like evidence but points at nothing is worse than no citation at all.

**The evidence pack carries a manifest.** Content hash per artifact version, the audit chain head,
and a pack hash over all of it. That is the difference between a document a reader has to trust
and one they can check against the system it came from.

**The binding graph is laid out by hand.** The graph is always the same shape — persona →
question → binding → product → metric — so a deterministic four-column layout beats a
general-purpose diagramming library: it renders on the server, adds no client JavaScript, and
its colours come from token classes so the no-hard-coded-hex rule still holds. Mermaid source is
produced too, for export and for pasting into someone else's docs.

**Refusals are a health signal.** The operate screen shows the refusal rate as a positive
number rather than an error count. An agent that never refuses has no boundary.

## 3 · The marketplace

The persona lens is the primary control, not a filter in a sidebar: "I am a Revenue Assurance
Analyst" is how a business user arrives, and ranking by *question coverage for that persona*
answers the only question they have — can this thing answer what I need to know?

The agent page is assembled entirely from committed artifact versions, and prints their content
hashes at the bottom. Nothing on it is prose someone typed into a listing field and forgot to
update. The model is not mentioned anywhere, because it is not what makes an agent trustworthy.

"Agents like this" is computed from shared data products and shared personas — not from tags
someone remembered to add. The product-view inversion answers the question executives actually
ask: change Customer 360, and here is exactly what needs re-certifying.

## 4 · Demo mode

`walkToPublished()` is shared by the showcase seed and by `demo-arc.test.ts`. That sharing is
the whole design: the demo tenant is not hand-written into a `PUBLISHED` row, it is walked
through `requestTransition` and `recordDecision` like anything else. A product change that
breaks the seven-minute arc fails a test rather than a sales call.

The landing page's "Explore the live demo" signs the visitor in as a real member with the
business-consumer role in a read-only tenant — the product's own permissions, not a bypass built
for the demo.

## 5 · Verification

`pnpm typecheck`, `pnpm lint`, `pnpm test` (**162 tests, 11 files**), and `pnpm build` all pass.

The seven-minute arc is asserted end to end in `tests/demo-arc.test.ts`: eight gates approved in
peer mode, nine artifacts committed, 100% question coverage for the persona, the graph naming the
contract version, the STALE flip with its re-certification tasks, and a rendered PDF and Word pack
with a verified manifest.

Walked in a browser against the production build:

| Step | Result |
|---|---|
| Landing → "Explore the live demo" | Marketplace in **1.2s**, read-only banner shown |
| Persona lens | 3 of 3 questions answered (100%) for Revenue Assurance Analyst |
| Agent detail | Peer-certified badge, 3 question-trace rows naming `residential_churn_rate`, binding graph SVG |
| Product inversion | Customer 360 lists its dependent agents and the questions each metric answers |
| Evidence pack | `evidence-pack-customer-churn-advisor-dab22c13.pdf` downloaded |

**Two bugs found by building it:** the sequential-gating hole above, and the PDF renderer
throwing on the arrows and en-dashes the product's own copy uses (now transliterated at the point
of drawing rather than flattening the writing everywhere).

**Not verified:** the Stage 5–8 authoring forms driven in a browser (covered by unit tests), and
Word rendering opened in Word itself — only that it is a valid zip of the right size.
