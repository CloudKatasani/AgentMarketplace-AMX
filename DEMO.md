# The seven-minute demo

The arc that sells AMX, timed, with the exact clicks. Every step here is asserted by
`e2e/demo-arc.spec.ts`, so if the demo breaks, a test goes red before a call does. The section
titles match the test names.

**The through-line, in one sentence:** *every published agent proves, per question, which
certified data product answers it and which human approved it — and when that product changes
underneath it, the proof expires by itself.*

---

## Before the call · 3 minutes

```bash
pnpm install
pnpm prisma migrate deploy
pnpm seed            # reference data + the showcase tenant + its sandbox twin
pnpm dev
```

Open two tabs:

| Tab | URL | Who |
|---|---|---|
| **A — the story** | `http://localhost:3000/` | not signed in |
| **B — the write** | `http://localhost:3000/signin` → `sam.data@amx.demo` / `amx-demo-2024` | data-product owner |

In tab B, use the workspace switcher in the header to select **Northwind Utility (sandbox)**
before the call starts. The showcase tenant is read-only by design — it is what a prospect
browsing your deployment sees, and nothing in a demo may break it. The sandbox is the same seed,
walked through the same eight gates, and disposable. (`docs/adr/0008-*` explains the split.)

Reset between calls: delete `prisma/dev.db`, then `pnpm prisma migrate deploy && pnpm seed`.

---

## 0:30 · Landing page → the live demo

**Screen:** tab A, `/`, then click **Explore the live demo**.

**Say:** "Enterprises are about to publish hundreds of agents. Nobody can answer the only
question that matters about any of them — *what is this thing standing on, and who signed for
it?*"

Land on the marketplace. Point at the **Demo** band: "this is a real tenant, seeded and
read-only. Nothing here is a mock-up."

**Fallback:** the same screen is reachable at `/marketplace` after signing in as
`dana.consumer@amx.demo`.

---

## 1:00 · The persona lens

**Screen:** marketplace. Click the persona **Revenue Assurance Analyst**.

**Say:** "A catalogue that ranks by model or framework answers a question nobody asked. This
ranks by *what this role can actually get answered* — three of three questions covered."

**Watch for:** the header reads *Ranked for Revenue Assurance Analyst*, and each card carries
its covered-question count. That count is the product's opinion of relevance.

**Fallback:** if the persona chips have scrolled, the same view is
`/marketplace?persona=<id>` — the id is in the link.

---

## 1:30 · The question trace

**Screen:** open **Customer Churn Advisor**.

**Say:** "Consumption first. Not the model, not the tools — the persona, the decision that is
blocked, and the questions. Every row resolves to a certified metric on a named data product."

**Point at:** `residential_churn_rate` and `high_bill_risk`, each linked to **Customer 360**.
Then the badge: **Peer-certified**.

"There is no free-form SQL anywhere in this product. A binding that names a raw table, or that
names no certified metric, cannot be committed — the validator refuses it and tells the author
which metrics *are* available."

**Fallback:** the same trace is in the coverage matrix at Stage 3 of the agent's lifecycle.

---

## 2:30 · The binding graph, and the inversion

**Screen:** same page, scroll to the binding graph. Then click **Customer 360**.

**Say:** "From the agent, everything it stands on — with the contract version each binding was
approved against. And now the direction executives actually ask about."

On the product page: "*Everything standing on this.* Change Customer 360, and this is the list
of things that need re-certifying. One row per agent, with how it binds and which contract
version it is pinned to."

**Fallback:** `/data-products` lists the same dependants inline under each product.

---

## 4:00 · The money moment

**Screen:** switch to **tab B** (sandbox workspace, signed in as Sam).

Go to `/data-products` → **Publish a new contract version** on Customer 360:

- version: `3.0.0`
- summary: *Removed the legacy premise identifier from the customer grain.*

**Say, before clicking publish:** "This is a breaking change to a data product. In every
organisation I have seen, what happens next is nothing — the agents keep answering, on a
contract nobody re-approved."

Click **Publish version**.

**Watch for:** *Breaking change recorded* and *re-certification task*. Then open the agent:
**Re-certification pending**, with the cause in plain language — *moved from contract 2.1.0 to
3.0.0*.

**Say:** "That is not a nightly job or a heuristic. Each binding stores the exact contract
version it was approved against, so this is a comparison, and it is true on the next render for
everyone."

**The line that closes it:** flip back to tab A and reload the same agent in the showcase
tenant. Untouched. "Different tenant. Isolation is enforced in one place, and it denies by
default."

**Fallback:** if the publish form is missing, the header is on the read-only showcase tenant —
switch workspace to *Northwind Utility (sandbox)*.

---

## 5:30 · The evidence pack

**Screen:** back to the agent in tab A → **Download the evidence pack**.

**Say:** "This is what goes to the regulator, or to the internal risk committee. Charter, scope
boundary, every binding with the contract it was approved against, the DATSIS+V scores with the
artifact field each one cites, every approval with who signed and when, and a manifest of
content hashes."

**Point at the filename:** it ends in eight hex characters — the manifest hash. "Two packs with
the same name are the same pack."

**Fallback:** the Word and Excel exports are on the same panel and are the same content.

---

## 7:00 · The credential that gates the approver

**Screen:** `/academy` → **Governance Officer**.

**Say:** "The last piece is the part that makes the rest hold. A workspace can require that an
approver role is only exercised by someone who holds the matching credential — earned here, with
a lab and an assessment, and recorded in the audit trail."

**Close on:** "So: chartered, not deployed. Bound to certified data products, not tables.
Approved by named humans through one code path. And when the ground moves, the certification
expires by itself. That is the system of record for enterprise agent trust."

**Fallback:** `dana.consumer@amx.demo` can complete the *Business Consumer* path end to end in
under a minute if someone wants to see a credential actually awarded.

---

## Questions you will get, and the honest answer

| Question | Answer |
|---|---|
| "Does this run the agents?" | No. AMX certifies and distributes them; it is the trust layer, not the runtime. Invocation telemetry comes back in on the operate stage. |
| "What if my data products live in Collibra / Atlan / dbt?" | `DataProduct` is a registered *reference* — contract and semantic model versions, metrics, owner, quality, freshness. Import is DPF/ADPM-shaped, and a product served from a raw layer is refused. |
| "Can one person do all of this?" | Yes, and the artifact says so. A solo gate is a recorded self-attestation with a written statement, badged differently from peer-certified everywhere it appears. |
| "Is governance a paid tier?" | No. Plan tiers gate features; a test asserts the gate engine, the lifecycle registry and the validator never import the feature flags. |
| "Can we rebrand it?" | One file of design tokens, plus a per-tenant override of the same names. A lint rule fails the build on a hard-coded colour. |

## If the demo will not start

- **Blank marketplace** — the seed did not run: `pnpm seed`.
- **`UntrustedHost`** — set `AUTH_URL` to the origin you are actually serving on.
- **Everything read-only** — you are in the showcase tenant. Switch workspace.
- **Stale page after a bump** — the STALE state is computed on read; a hard reload is enough. If
  it is still wrong, that is a real bug and `tests/cascade.test.ts` should have caught it.
