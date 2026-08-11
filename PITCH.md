# PITCH.md — AMX Positioning Narrative 

The strategic case, structured SCR, written to be defensible in front of a top AI or product
company's leadership. Action titles carry the answer; every section closes with a synthesis
line; falsifiers and "what we are not saying" are published, not hidden.

---

## 1 · Situation — Agents are scaling faster than the trust infrastructure beneath them

Enterprises moved in 24 months from BI dashboards to conversational and agentic consumption.
Every platform vendor now ships an agent framework; every function is piloting one. Meanwhile
the data side matured its own discipline — data products, contracts, semantic layers,
marketplaces — largely in a separate organisational lane.

**So what:** the two fastest-growing enterprise capabilities — agents and data products — have
no structural connection. That gap is the product.

## 2 · Complication — Nobody can answer "was this agent fit to publish, and what does it stand on?"

- Observability tools (LangSmith, AgentOps, Langfuse class) answer *what did the agent do at
  runtime*. Model registries answer *which model*. Data catalogs (Collibra/Alation class)
  answer *what data exists*. **None answer: which certified data answers which question, for
  which persona, approved by whom.**
- Regulatory pressure is arriving anyway: EU AI Act documentation duties, model-risk-management
  expectations extending to agents, procurement questionnaires already asking for evidence of
  human oversight.
- The failure mode is predictable: agents grounded on uncertified data, free-form text-to-SQL
  on raw tables, no charter, no owner, no retirement path — a governance incident with a
  chat interface.

**Critical:** the buying trigger is not enthusiasm; it is the first time a board, regulator, or
enterprise customer asks for evidence and the AI team has none.

## 3 · Resolution — AMX: the certification and distribution layer for enterprise agents

One line: **the system of record for agent trust** — every published agent proves, per
question, which certified data product and metric answers it, and which human approved every
design choice, with a signed evidence pack to hand to whoever asks.

Three product truths that make it defensible in a demo:

1. **The Binding is first-class.** Agent ↔ DataProduct is a versioned, gated entity — not a
   tag. Question-coverage must hit 100% before an agent advances.
2. **Trust is structural, not procedural.** A single code path to approval; append-only audit;
   cascade invalidation — when a bound data product bumps a major version, the agent's
   certification flips STALE on screen, live. This is the demo's money moment.
3. **The guardrail everyone claims, enforced.** Validators reject any grounding or tool spec
   touching raw/Bronze/Silver tables. "Semantic layer only" stops being a slide bullet.

**Read across:** the analogy that lands with product audiences — app-store review + type
certification for agents, with the data supply chain visible per question.

## 4 · Why now (three clocks striking together)

1. **Agent sprawl clock** — pilots are converting to production; count per enterprise is about
   to jump an order of magnitude.
2. **Regulatory clock** — AI Act phase-in and audit expectations create a compliance artifact
   nobody currently produces; AMX's evidence pack *is* that artifact.
3. **Data-product maturity clock** — enough enterprises now have contracts and semantic layers
   for the Binding to have something real to bind to. Three years ago this product had no
   substrate.

## 5 · Who buys, and the wedge

- **ICP:** enterprises with ≥1 data-product initiative and ≥3 agent pilots; regulated
  industries first (utilities, banking, insurance, healthcare) — exactly the shipped packs.
- **Economic buyer:** CDO/CAIO. **Champion:** Head of Data Products or AI Platform lead.
  **Veto-holder to win early:** CISO/Privacy — which is why the Privacy veto is in-product.
- **Wedge motion:** land with the **evidence pack + binding validator** on 1–3 existing agents
  ("certify what you already shipped") — value in week one without changing how agents are
  built. Expand to the full lifecycle, marketplace, and academy.
- **Partner-led distribution:** consulting firms (Capgemini-class) carry it into accounts as
  the delivery backbone of agent programmes — the product creates the services attach
  (chartering workshops, pack customisation, academy rollout), and the services create product
  pull. Design-partner motion: 3–5 named logos, discounted, co-published worked examples.

## 6 · Moat (in order of durability)

1. **The binding graph.** Accumulated agent↔product↔metric↔question metadata is a proprietary
   trust graph per customer — switching cost compounds with every certified agent, and
   "agents like this" / product-inversion views get better with density.
2. **Evidence-pack gravity.** Once auditors and procurement accept AMX's pack format, it
   becomes the incumbent artifact.
3. **Packs + academy.** Industry content and role credentials are replicable but slow to copy
   well; credential-gated approver roles embed AMX into the org chart.
4. Not a moat, and say so honestly: the UI and the lifecycle model are copyable. Speed and
   graph density are the defence.

## 7 · Business model

- **Tiers:** Free (solo attestation, 3 agents) → Team (peer gates, packs, exports) →
  Enterprise (SSO, white-label, API, audit export). Value metric: **published/certified
  agents** — priced on the unit the buyer brags about, not seats.
- **Attach:** services (partner-delivered), premium packs, academy credentialing at scale.
- **Honest risk on pricing:** per-agent pricing can throttle adoption if agents proliferate as
  cheap micro-agents; falsifier below.

## 8 · Competitive objections, answered in advance

| Objection | Answer |
|---|---|
| "LangSmith/AgentOps covers this" | Runtime observability ≠ fitness-to-publish. We integrate with them (eval evidence in), not against them. |
| "Collibra/Alation will add agents" | Catalogs index assets; they do not gate lifecycles or enforce coverage. Their governance DNA is advisory; ours is structural. Also a partnership surface. |
| "The model vendors will bundle it" | Vendors certify their own agents; enterprises need a vendor-neutral system of record across all of them. Neutrality is the feature. |
| "This slows my AI team down" | Free-tier solo attestation gives single-player value; the validator catches raw-table grounding before security does; the evidence pack removes the audit fire-drill. Governance as a feature, priced against incident cost. |
| "We'll build it internally" | Every enterprise says this about registries; the packs, evidence format, and academy are the 18 months they don't want to spend. |

## 9 · What we are not saying

- Not an agent runtime, framework, or orchestrator — AMX certifies and distributes; it does
  not execute agents in production.
- Not a data catalog or a data-product builder — DPF/ADPM-class tools build products; AMX
  binds agents to them and will import their exports.
- Not claiming certification guarantees agent correctness — it guarantees traceable evidence
  of fitness, scope, and human approval. The distinction is the honest slide.
- Not dependent on any one model vendor, cloud, or semantic-layer technology.

## 10 · Falsifiers per phase (publish these; kill or pivot if they fire)

- **F1 (design partners):** if certified-agent evidence packs are not requested by any
  auditor, customer, or procurement process within 2 quarters at design partners, the
  compliance wedge is weaker than believed → pivot messaging to marketplace/discovery value.
- **F2 (wedge):** if "certify existing agents" takes >4 weeks of customer effort per agent,
  single-player value is not real → invest in importers/AI-assist drafting before GTM scale.
- **F3 (pricing):** if micro-agent proliferation makes per-published-agent pricing punitive,
  switch value metric to certified-question volume or workspace tiers.
- **F4 (moat):** if churned pilots export their binding graph and feel no loss, graph gravity
  is not real → deepen the inversion/lineage analytics that only density enables.

## 11 · The 7-minute demo arc (what the audience must feel)

1. Landing page → "Explore the live demo" (0:30)
2. Marketplace persona lens: "I am a Revenue Assurance Analyst" (1:00)
3. Agent page: question → certified metric → data product, per row (1:30)
4. Binding graph, then the product-view inversion: every agent standing on Customer 360 (1:00)
5. **The money moment:** bump Customer 360's contract version → certification flips STALE live,
   re-approval tasks appear (1:30)
6. Download the signed evidence pack; open the PDF on the approvals page (1:00)
7. Close on the academy credential gating approver roles (0:30)

**Synthesis:** the demo sells structural trust — the STALE flip and the evidence pack do in 150
seconds what a 40-slide governance deck cannot.
