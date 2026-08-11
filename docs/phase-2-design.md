# Phase 2 — Stages 1–4 authoring, the review loop, and onboarding

Built on the Phase 1 foundation (`docs/phase-1-design.md`). This records the shape of what was
built, the judgement calls, and what was verified.

## 1 · Rows are the truth; artifacts are derived

The pattern established by `commitBindingSet()` in Phase 1 now covers Stages 1 and 3:

| Stage | Truth | Derived artifact |
|---|---|---|
| 1 · Consumption Discovery | `Persona` + `Question` rows | `persona-question-register` |
| 2 · Agent Charter | the artifact itself | — (archetype and risk tier mirrored onto `Agent`) |
| 3 · Data Product Binding | `Binding` + `QuestionCoverage` rows | `binding-set` |
| 4 · Grounding & Tools | the artifacts themselves | — (pack pre-drafted from Stages 1 and 3) |

Nobody has to remember to "save the register": editing a persona or a question re-serialises and
commits it. What a reviewer approves is provably what the workspace contains, and re-saving
unchanged content is a no-op inside `commitArtifact`, so it never fires a spurious cascade.

Stage 2 is the exception because a charter has no row equivalent. It stays artifact-first, with
`archetype` and `riskTier` mirrored onto the agent so the marketplace can filter without parsing
every charter.

## 2 · The Stage 1 hard block is enforced twice

`hasQualifyingPersona()` runs in `saveCharter()` as well as in the Stage 2 exit criteria. A rule
that only lives in the submit path can be walked around by saving a draft; consumption-first has
to hold at the point of authoring, so the charter form refuses to write anything at all until
Stage 1 has a persona with three complete questions.

## 3 · The review loop

- **Field-anchored comments.** A comment anchors to the artifact *version* it was written about
  and, where the reviewer chooses, to a field path. That is what turns a changes-requested round
  into a list of specific edits.
- **Parking lot.** Separate storage (`isParkingLot`), no artifact version, never blocks a gate.
  Without somewhere to put non-blocking thoughts, they become blocking comments and the gate
  stops meaning anything.
- **The lock.** `stageLockState()` returns locked for OPEN, APPROVED, and VETOED gates — but
  locked does not mean frozen. Editing an approved stage is still possible; the banner states the
  consequence (new version → approval goes stale → re-approval task) *before* someone types.
  CHANGES_REQUESTED and STALE unlock, because that is precisely when editing is the point.
- **Version diff.** LCS diff over the YAML rendering — the same text the workspace mirror and the
  evidence pack show — with unchanged runs collapsed to two lines of context.

## 4 · Onboarding and the guided tour

Two steps: industry first, then account. Industry comes first because it decides what lands in
the workspace, and asking for a password before showing anyone what they are signing up to is
how you lose them.

The five-step tour ends on the coverage matrix deliberately — that is the first screen where the
claim becomes visible (this question, this metric, this certified product), and the whole
time-to-first-wow budget exists to get someone there. The agent id travels in the URL, so the
tour needs no server state and no session flag to resume.

## 5 · Judgement calls

**5.1 · Documents are validated raw, before the Zod parse.** Zod strips unknown keys, so a `sql`
field on a grounding pack would have been silently dropped and the author would never learn why.
Silently removing the text-to-SQL surface is not the same as refusing it — the refusal is the
product feature. Both Stage 4 savers now validate `input.document` first.

**5.2 · Line-based inputs instead of client-side array widgets.** Out-of-scope lists, glossaries,
and tool fields are typed one per line (`term | definition`). It survives a page reload, works
without JavaScript, and is easy to paste into from the spreadsheet the team is migrating off.
Repeating rows use "render the existing rows plus a couple of blank ones", with all-empty rows
dropped server-side — an add-a-row interaction with no client state.

**5.3 · Industry choice sets the tenant's industry and domain, not yet its vocabulary.** Packs
are Phase 4. Today picking Utilities files the starter content under a utilities domain; the
pack-driven personas, question library, and constraint library arrive with `packs/`.

**5.4 · Comments are org-scoped but not yet notified.** There is no inbox or email; a reviewer
finds work through the agent's task list. Notification is a Phase 3 concern alongside the
marketplace.

## 6 · Two bugs found by running it, not by the tests

**6.1 · The validator rejected ordinary English.** The lexical scanner treated any `FROM`/`JOIN`
followed by a word as a SQL table reference, so *"Which accounts moved into arrears this week?"*
was refused as a query. That is the kind of false positive that loses the room in the first
demo. A bare FROM/JOIN is now only treated as SQL when the string carries another SQL signal
(`SELECT`, `WHERE`, `GROUP BY`, …) or the identifier is shaped like a table (dotted or
snake_cased). `bronze.events` and `slv_meter_reads` are still caught anywhere, by the separate
denied-identifier scan. Five natural-language phrases are now regression tests.

**6.2 · The guided tour's links were off by one**, so step 1 pointed back at its own surface.
Fixed, and each step's destination is now asserted in the browser walk.

## 7 · Verification

`pnpm typecheck`, `pnpm lint`, `pnpm test` (**123 tests, 9 files**), and `pnpm build` all pass.

Walked in a browser against the production build:

| Step | Result |
|---|---|
| Onboarding wizard | Industry picker → account → seeded workspace, **1.4s** from first screen to the tour |
| Guided tour | 5 steps in order, ending on the coverage matrix |
| Stage 1 authoring | Question added; register re-derived to v2 |
| Version diff | "What changed?" shows the added question |
| Field-anchored comment | Anchored and listed |
| Stage 2 charter | Pre-filled from v1, committed as v2, not blocked (persona floor met) |
| Stage 4 grounding pack | Pre-filled with 6 sample questions; refused `slv_meter_reads`; accepted once removed |
| Data product import | Silver-layer export refused with the Gold-layer alternative named |

**Not verified:** the Stage 4 tool-spec form end to end in a browser (covered by unit tests only),
notification of reviewers, and Postgres as the datasource.
