/**
 * Authoring aid: the second wave of starter agents for every industry pack.
 *
 * Each pack shipped one starter agent — enough to prove a workspace is never
 * empty, not enough to look like a marketplace. Every pack now carries five,
 * each with the persona whose decisions it serves, at least three catalogued
 * questions, and bindings onto certified metrics that already exist in the same
 * pack.
 *
 * Three rules held while writing these, and they are the interesting part:
 *
 * 1. **Every question names a metric that exists.** A question with no metric
 *    behind it is a wish; the catalogue would render "no certified metric yet",
 *    which is honest but is not what a starter agent should ship as.
 * 2. **Every binding is legal.** `QUERIES` names certified metrics; `GROUNDS_ON`
 *    carries context and names none. The validator would reject anything else,
 *    and a pack that ships an agent its own product cannot bind to is a bug.
 * 3. **Risk tier is chosen, not defaulted.** An agent that only reports is
 *    `informational`; one that ranks or recommends is `decision-support`.
 *    Nothing here is `action-taking`, because nothing here acts.
 *
 * Kept in the repository: the diff it produces is nine YAML files long, and the
 * next person adding a pack wants this shape rather than that diff.
 *
 *   node scripts/expand-pack-agents.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function scalar(value) {
  const text = String(value);
  return /[:#]\s|^[\s&*!|>%@`'"-]|\s$/.test(text) ? JSON.stringify(text) : text;
}

const persona = (key, name, ownedDecisions, cadence, currentWorkaround, kind = "BUSINESS") => ({
  key,
  name,
  kind,
  ownedDecisions,
  cadence,
  currentWorkaround,
});

const q = (key, personaKey, text, intentClass, consequence, shape, metricKey) => ({
  key,
  personaKey,
  text,
  intentClass,
  consequenceOfNoAnswer: consequence,
  expectedAnswerShape: shape,
  metricKey,
});

function renderPersona(p) {
  return [
    `- key: ${p.key}`,
    `  name: ${scalar(p.name)}`,
    `  kind: ${p.kind}`,
    `  ownedDecisions: ${scalar(p.ownedDecisions)}`,
    `  cadence: ${scalar(p.cadence)}`,
    `  currentWorkaround: ${scalar(p.currentWorkaround)}`,
  ].join("\n");
}

function renderQuestion(question) {
  return [
    `- key: ${question.key}`,
    `  personaKey: ${question.personaKey}`,
    `  text: ${scalar(question.text)}`,
    `  intentClass: ${question.intentClass}`,
    `  consequenceOfNoAnswer: ${scalar(question.consequenceOfNoAnswer)}`,
    `  expectedAnswerShape: ${scalar(question.expectedAnswerShape)}`,
    `  metricKey: ${question.metricKey}`,
  ].join("\n");
}

function renderAgent(agent) {
  const lines = [
    `- key: ${agent.key}`,
    `  name: ${scalar(agent.name)}`,
    `  summary: ${scalar(agent.summary)}`,
    `  archetype: ${agent.archetype}`,
    `  riskTier: ${agent.riskTier}`,
    `  domainKey: ${agent.domainKey}`,
    `  primaryPersonaKey: ${agent.primaryPersonaKey}`,
    `  questionKeys:`,
    ...agent.questionKeys.map((key) => `  - ${key}`),
    `  bindings:`,
  ];
  for (const binding of agent.bindings) {
    lines.push(
      `  - dataProductKey: ${binding.dataProductKey}`,
      `    type: ${binding.type}`,
      `    purpose: ${scalar(binding.purpose)}`,
      `    metricKeys:${binding.metricKeys.length === 0 ? " []" : ""}`,
      ...binding.metricKeys.map((key) => `    - ${key}`),
    );
  }
  return lines.join("\n");
}

/** Grounding binding: context, no metrics — exactly what the validator expects. */
const grounds = (dataProductKey, purpose) => ({
  dataProductKey,
  type: "GROUNDS_ON",
  purpose,
  metricKeys: [],
});

const queries = (dataProductKey, purpose, metricKeys) => ({
  dataProductKey,
  type: "QUERIES",
  purpose,
  metricKeys,
});

const PACKS = {
  utilities: {
    personas: [
      persona(
        "asset-investment-planner",
        "Asset Investment Planner",
        "Which assets are replaced this year and which are held for another cycle.",
        "Quarterly, against the regulatory settlement",
        "Ranks assets in a spreadsheet from a condition export that is six weeks old.",
      ),
      persona(
        "trading-desk-lead",
        "Trading Desk Lead",
        "How much of tomorrow's forecast demand is hedged, and at what price.",
        "Daily, before market close",
        "Reconciles position reports against a demand forecast that arrives by email.",
      ),
      persona(
        "sustainability-lead",
        "Sustainability Lead",
        "What is published in the annual report, and which reduction claims can be defended.",
        "Monthly, with a hard annual deadline",
        "Rebuilds the emissions position from three systems each reporting cycle.",
      ),
    ],
    questions: [
      q("q-hedge-trend", "trading-desk-lead", "How has hedge coverage moved across the last month?", "trend", "A drifting hedge position is noticed at settlement.", "Coverage trend by delivery period", "hedge_coverage_ratio"),
      q("q-asset-criticality", "asset-investment-planner", "Which critical assets are in the worst condition right now?", "lookup", "A critical asset fails before it reaches a replacement list.", "Asset list with health and criticality", "asset_health_index"),
      q("q-jobs-missed", "field-operations-lead", "Which jobs missed their appointment window yesterday, and why?", "diagnosis", "The same round gets booked the same way tomorrow.", "Job list with cause and crew", "appointment_adherence"),
      q("q-first-time-fix", "field-operations-lead", "Where is first-time fix falling, by patch and job type?", "trend", "Repeat visits absorb capacity nobody planned for.", "Trend by patch with job type breakdown", "first_time_fix_rate"),
      q("q-attend-time", "field-operations-lead", "How long are we taking to attend high-priority jobs?", "trend", "Priority jobs quietly become the same as everything else.", "Median hours by priority and week", "mean_time_to_attend"),
      q("q-asset-replace", "asset-investment-planner", "Which assets should be replaced first this year?", "recommendation", "Replacement money goes to whatever failed most recently.", "Ranked asset list with health and criticality", "replacement_priority_score"),
      q("q-asset-decline", "asset-investment-planner", "Which asset classes are deteriorating fastest?", "trend", "Deterioration is noticed at failure rather than in planning.", "Health index trend by asset class", "asset_health_index"),
      q("q-hedge-cover", "trading-desk-lead", "How much of tomorrow's forecast demand is hedged?", "lookup", "The desk goes into delivery exposed without knowing it.", "Coverage percentage by delivery period", "hedge_coverage_ratio"),
      q("q-imbalance-cost", "trading-desk-lead", "What did imbalance cost us last week, and where?", "diagnosis", "Forecast error keeps costing money nobody attributes.", "Cost by settlement period with driver", "imbalance_cost"),
      q("q-submission-late", "regulatory-reporting-manager", "Which statutory submissions are at risk of missing their deadline?", "forecast", "A missed filing is discovered by the regulator, not by us.", "Submission list with days to deadline", "submission_timeliness_rate"),
      q("q-emissions-trend", "sustainability-lead", "How are scope 2 emissions tracking against the reduction plan?", "trend", "The annual claim is assembled from numbers nobody has checked.", "Monthly emissions against plan", "scope_two_emissions"),
      q("q-renewable-share", "sustainability-lead", "What share of supplied energy was certified renewable this month?", "lookup", "A published figure ends up resting on an estimate.", "Percentage by supply region with source", "renewable_share"),
    ],
    agents: [
      {
        key: "field-dispatch-advisor",
        name: "Field Dispatch Advisor",
        summary:
          "Tells a field operations lead which jobs slipped and where first-time fix is falling, from certified job metrics.",
        archetype: "Advisor",
        riskTier: "decision-support",
        domainKey: "field-services",
        primaryPersonaKey: "field-operations-lead",
        questionKeys: ["q-jobs-missed", "q-first-time-fix", "q-attend-time"],
        bindings: [
          grounds("field-service-operations", "Field Service Operations frames every answer in job, crew, and appointment terms."),
          queries("field-service-operations", "Reads certified appointment adherence, first-time fix, and attendance metrics.", ["appointment_adherence", "first_time_fix_rate", "mean_time_to_attend"]),
        ],
      },
      {
        key: "asset-investment-analyst",
        name: "Asset Investment Analyst",
        summary:
          "Ranks assets for replacement against certified health and criticality, so investment argues from the register rather than from memory.",
        archetype: "Analyst",
        riskTier: "decision-support",
        domainKey: "asset-management",
        primaryPersonaKey: "asset-investment-planner",
        questionKeys: ["q-asset-replace", "q-asset-decline", "q-asset-criticality"],
        bindings: [
          grounds("asset-health-register", "The asset register provides the condition and criticality context for every ranking."),
          queries("asset-health-register", "Reads certified asset health and replacement priority scores.", ["asset_health_index", "replacement_priority_score"]),
        ],
      },
      {
        key: "hedge-position-monitor",
        name: "Hedge Position Monitor",
        summary:
          "Watches hedge coverage and imbalance cost against the certified trading book, and says when tomorrow looks exposed.",
        archetype: "Monitor",
        riskTier: "decision-support",
        domainKey: "energy-trading",
        primaryPersonaKey: "trading-desk-lead",
        questionKeys: ["q-hedge-cover", "q-imbalance-cost", "q-hedge-trend"],
        bindings: [
          grounds("energy-trading-positions", "The trading book provides position and delivery-period context."),
          queries("energy-trading-positions", "Reads certified hedge coverage and imbalance cost.", ["hedge_coverage_ratio", "imbalance_cost"]),
        ],
      },
      {
        key: "sustainability-reporting-analyst",
        name: "Sustainability Reporting Analyst",
        summary:
          "Assembles the emissions and renewable position from certified metrics, so a published claim can be traced to its source.",
        archetype: "Analyst",
        riskTier: "informational",
        domainKey: "sustainability",
        primaryPersonaKey: "sustainability-lead",
        questionKeys: ["q-emissions-trend", "q-renewable-share", "q-submission-late"],
        bindings: [
          grounds("sustainability-emissions", "Emissions reporting provides the entity and period context for every figure."),
          queries("sustainability-emissions", "Reads certified scope 2 emissions and renewable share.", ["scope_two_emissions", "renewable_share"]),
          queries("regulatory-submissions", "Reads submission timeliness so a reporting deadline is visible before it is missed.", ["submission_timeliness_rate"]),
        ],
      },
    ],
  },

  banking: {
    personas: [
      persona("collections-manager", "Collections Manager", "Which arrears cases get contacted first and which move to forbearance.", "Daily", "Works a queue sorted by balance rather than by likelihood of cure."),
      persona("payments-operations-lead", "Payments Operations Lead", "When a rail is degraded enough to reroute or pause.", "Continuous, with a morning review", "Watches a dashboard of raw counts with no view of what is normal."),
      persona("conduct-risk-officer", "Conduct Risk Officer", "Which complaint themes become a remediation programme.", "Monthly, reported to committee", "Reads complaint samples and infers the theme by hand."),
      persona("deposits-product-owner", "Deposits Product Owner", "Where pricing moves, and which segments are defended.", "Weekly", "Compares balance reports across two systems that disagree."),
    ],
    questions: [
      q("q-complaint-volume", "conduct-risk-officer", "Which products are generating the most complaints?", "comparison", "A product problem is read as a service problem.", "Product list with complaint volume", "complaint_upheld_rate"),
      q("q-rail-volume", "payments-operations-lead", "Which rails are carrying the most volume right now?", "lookup", "Capacity decisions are made without knowing where the load is.", "Rail list with volume and success", "payment_success_rate"),
      q("q-arrears-entry", "collections-manager", "Which segments are entering arrears fastest?", "trend", "Early-stage arrears grows before anyone re-plans capacity.", "Segment trend with entry rate", "arrears_rate_30dpd"),
      q("q-arrears-priority", "collections-manager", "Which arrears cases are most likely to cure with early contact?", "recommendation", "Effort goes to the largest balances instead of the reachable ones.", "Ranked case list with cure likelihood", "cure_rate"),
      q("q-arrears-trend", "collections-manager", "How is thirty-day arrears moving by portfolio?", "trend", "A deteriorating book is spotted at quarter end.", "Arrears rate trend by portfolio", "arrears_rate_30dpd"),
      q("q-payment-failures", "payments-operations-lead", "Which payment rail is failing more than usual today?", "diagnosis", "Customers report the outage before operations sees it.", "Rail comparison against baseline", "payment_success_rate"),
      q("q-settlement-latency", "payments-operations-lead", "Where has settlement latency moved outside its normal range?", "comparison", "Slow settlement is absorbed as complaints instead of fixed.", "Latency by rail with baseline band", "settlement_latency"),
      q("q-complaint-themes", "conduct-risk-officer", "Which complaint themes are being upheld most often?", "trend", "Remediation starts after the regulator asks rather than before.", "Theme list with uphold rate and volume", "complaint_upheld_rate"),
      q("q-remediation-late", "conduct-risk-officer", "Which remediation actions are past their committed date?", "lookup", "Committee is told everything is on track until it is not.", "Action list with owner and days overdue", "remediation_backlog"),
      q("q-deposit-growth", "deposits-product-owner", "Which segments are growing or draining deposits this month?", "trend", "Pricing responds to last quarter's picture.", "Segment growth with balance movement", "deposit_balance_growth"),
      q("q-deposit-attrition", "deposits-product-owner", "Where is deposit attrition concentrated?", "comparison", "Retention spend lands on segments that were never leaving.", "Attrition by segment and tenure", "deposit_attrition_rate"),
      q("q-origination-slow", "credit-risk-analyst", "Where is the approval cycle slowest, and what is holding it?", "diagnosis", "Deals are lost to a competitor who answered first.", "Stage timings with bottleneck named", "approval_cycle_time"),
    ],
    agents: [
      {
        key: "collections-priority-advisor",
        name: "Collections Priority Advisor",
        summary:
          "Ranks arrears cases by certified cure likelihood so early contact goes where it changes the outcome.",
        archetype: "Advisor",
        riskTier: "decision-support",
        domainKey: "retail-banking",
        primaryPersonaKey: "collections-manager",
        questionKeys: ["q-arrears-priority", "q-arrears-trend", "q-arrears-entry"],
        bindings: [
          grounds("collections-and-arrears", "Arrears and forbearance status frames every recommendation."),
          queries("collections-and-arrears", "Reads certified arrears and cure metrics.", ["arrears_rate_30dpd", "cure_rate"]),
        ],
      },
      {
        key: "payments-health-monitor",
        name: "Payments Health Monitor",
        summary:
          "Watches success rate and settlement latency per rail against certified baselines, and says which rail is degraded.",
        archetype: "Monitor",
        riskTier: "decision-support",
        domainKey: "payments",
        primaryPersonaKey: "payments-operations-lead",
        questionKeys: ["q-payment-failures", "q-settlement-latency", "q-rail-volume"],
        bindings: [
          grounds("payments-flows", "Payment rail and corridor context frames every comparison."),
          queries("payments-flows", "Reads certified payment success rate and settlement latency.", ["payment_success_rate", "settlement_latency"]),
        ],
      },
      {
        key: "conduct-theme-analyst",
        name: "Conduct Theme Analyst",
        summary:
          "Surfaces which complaint themes are upheld and which remediation actions have slipped, from certified conduct metrics.",
        archetype: "Analyst",
        riskTier: "decision-support",
        domainKey: "retail-banking",
        primaryPersonaKey: "conduct-risk-officer",
        questionKeys: ["q-complaint-themes", "q-remediation-late", "q-complaint-volume"],
        bindings: [
          grounds("complaints-and-conduct", "Complaint taxonomy and root-cause context frames every theme."),
          queries("complaints-and-conduct", "Reads certified uphold rate and remediation backlog.", ["complaint_upheld_rate", "remediation_backlog"]),
        ],
      },
      {
        key: "deposit-growth-advisor",
        name: "Deposit Growth Advisor",
        summary:
          "Explains where deposits are growing or draining, and how fast the approval cycle is turning, from certified metrics.",
        archetype: "Advisor",
        riskTier: "decision-support",
        domainKey: "retail-banking",
        primaryPersonaKey: "deposits-product-owner",
        questionKeys: ["q-deposit-growth", "q-deposit-attrition", "q-origination-slow"],
        bindings: [
          grounds("deposits-and-savings", "Deposit product and segment context frames every movement."),
          queries("deposits-and-savings", "Reads certified balance growth and attrition.", ["deposit_balance_growth", "deposit_attrition_rate"]),
          queries("lending-origination", "Reads the certified approval cycle time behind the origination view.", ["approval_cycle_time"]),
        ],
      },
    ],
  },

  healthcare: {
    personas: [
      persona("revenue-cycle-manager", "Revenue Cycle Manager", "Which denial causes get worked, and which payer conversations to open.", "Weekly", "Exports a denial report and pivots it by hand every Monday."),
      persona("theatre-scheduler", "Theatre Scheduler", "Which lists are moved, and where spare session time goes.", "Daily", "Balances a whiteboard against a booking system that disagrees with it."),
      persona("workforce-planner", "Workforce Planner", "Where agency spend is authorised and where a vacancy is escalated.", "Weekly", "Reconciles roster exports with a finance ledger a fortnight behind."),
      persona("population-health-lead", "Population Health Lead", "Which cohorts get proactive outreach this quarter.", "Quarterly", "Waits for an analyst to rebuild a stratification model by request."),
    ],
    questions: [
      q("q-cohort-trend", "population-health-lead", "How is cohort risk moving since the last review?", "trend", "A cohort deteriorates between quarterly reviews.", "Cohort trend with risk score", "risk_stratification_score"),
      q("q-theatre-trend", "theatre-scheduler", "How is theatre utilisation trending by specialty?", "trend", "Utilisation drifts down a percentage point at a time.", "Specialty trend with utilisation", "theatre_utilisation"),
      q("q-denial-payer", "revenue-cycle-manager", "Which payers deny most often on first pass?", "comparison", "Payer conversations open without evidence.", "Payer list with denial rate", "denial_rate"),
      q("q-denial-causes", "revenue-cycle-manager", "Which denial reasons are costing the most this month?", "diagnosis", "The same denial reason is reworked every month instead of fixed.", "Reason list with value and payer", "denial_rate"),
      q("q-cash-lag", "revenue-cycle-manager", "Where is cash taking longest to arrive?", "trend", "Working capital is managed by overdraft rather than by cause.", "Days in AR by service line", "days_in_ar"),
      q("q-theatre-gaps", "theatre-scheduler", "Where is theatre time going unused this week?", "lookup", "Sessions are lost that a waiting patient could have used.", "Session list with unused minutes", "theatre_utilisation"),
      q("q-cancellations", "theatre-scheduler", "Which specialties are cancelling most on the day, and why?", "diagnosis", "Cancellations are treated as bad luck rather than as a pattern.", "Specialty list with cancellation cause", "cancellation_rate"),
      q("q-agency-spend", "workforce-planner", "Where is agency use highest relative to establishment?", "comparison", "Agency spend is approved ward by ward with no view of the whole.", "Ward comparison with agency share", "agency_hours_share"),
      q("q-vacancy-hotspots", "workforce-planner", "Which services carry the deepest vacancy gap?", "lookup", "Recruitment effort spreads evenly across uneven need.", "Service list with vacancy rate", "vacancy_rate"),
      q("q-cohort-risk", "population-health-lead", "Which cohorts carry the highest risk of unplanned admission?", "forecast", "Outreach goes to whoever was in hospital last, not who is next.", "Cohort ranking with risk score", "risk_stratification_score"),
      q("q-avoidable-admissions", "population-health-lead", "Where are avoidable admissions concentrated?", "comparison", "Prevention money lands where the noise is, not the need.", "Rate by cohort and locality", "avoidable_admission_rate"),
      q("q-diagnostic-backlog", "service-manager", "Which diagnostic backlogs are growing fastest?", "trend", "A backlog becomes a breach before anyone escalates it.", "Modality trend with backlog count", "backlog_over_six_weeks"),
    ],
    agents: [
      {
        key: "denial-cause-analyst",
        name: "Denial Cause Analyst",
        summary:
          "Explains which denial reasons cost the most and where cash is slowest, from certified revenue-cycle metrics.",
        archetype: "Analyst",
        riskTier: "decision-support",
        domainKey: "revenue-cycle",
        primaryPersonaKey: "revenue-cycle-manager",
        questionKeys: ["q-denial-causes", "q-cash-lag", "q-denial-payer"],
        bindings: [
          grounds("revenue-cycle-360", "Claim, payer, and service-line context frames every denial answer."),
          queries("revenue-cycle-360", "Reads certified denial rate and days in accounts receivable.", ["denial_rate", "days_in_ar"]),
        ],
      },
      {
        key: "theatre-utilisation-advisor",
        name: "Theatre Utilisation Advisor",
        summary:
          "Shows where theatre time is going unused and which specialties cancel on the day, from certified metrics.",
        archetype: "Advisor",
        riskTier: "decision-support",
        domainKey: "patient-flow",
        primaryPersonaKey: "theatre-scheduler",
        questionKeys: ["q-theatre-gaps", "q-cancellations", "q-theatre-trend"],
        bindings: [
          grounds("theatre-utilisation", "Session, list, and specialty context frames every scheduling answer."),
          queries("theatre-utilisation", "Reads certified theatre utilisation and cancellation rate.", ["theatre_utilisation", "cancellation_rate"]),
        ],
      },
      {
        key: "workforce-gap-monitor",
        name: "Workforce Gap Monitor",
        summary:
          "Watches agency use and vacancy depth across rosters, so escalation lands where the gap actually is.",
        archetype: "Monitor",
        riskTier: "informational",
        domainKey: "workforce",
        primaryPersonaKey: "workforce-planner",
        questionKeys: ["q-agency-spend", "q-vacancy-hotspots", "q-diagnostic-backlog"],
        bindings: [
          grounds("workforce-rostering", "Roster and establishment context frames every staffing comparison."),
          queries("workforce-rostering", "Reads certified agency share and vacancy rate.", ["agency_hours_share", "vacancy_rate"]),
          queries("diagnostics-turnaround", "Reads the certified diagnostic backlog behind the demand picture.", ["backlog_over_six_weeks"]),
        ],
      },
      {
        key: "population-risk-navigator",
        name: "Population Risk Navigator",
        summary:
          "Points a population health lead at the cohorts carrying the most avoidable admissions, with the certified risk behind each.",
        archetype: "Navigator",
        riskTier: "decision-support",
        domainKey: "population-health",
        primaryPersonaKey: "population-health-lead",
        questionKeys: ["q-cohort-risk", "q-avoidable-admissions", "q-cohort-trend"],
        bindings: [
          grounds("population-risk", "Cohort definitions and registered population frame every ranking."),
          queries("population-risk", "Reads certified risk stratification and avoidable admission rate.", ["risk_stratification_score", "avoidable_admission_rate"]),
        ],
      },
    ],
  },

  insurance: {
    personas: [
      persona("fraud-investigations-lead", "Fraud Investigations Lead", "Which claims are referred to investigation and which are released.", "Daily", "Reviews a referral queue with no view of which referral types pay off."),
      persona("pricing-actuary", "Pricing Actuary", "Where rate is adequate and where it is corrected at renewal.", "Monthly", "Reruns a rate adequacy model against extracts that arrive late."),
      persona("distribution-manager", "Distribution Manager", "Which brokers get support, and where new business appetite goes.", "Weekly", "Reads separate broker reports and reconciles names by hand."),
      persona("retention-lead", "Retention Lead", "Which renewals get intervention and at what price.", "Weekly", "Works a lapse list produced after the renewal invitation has gone out."),
    ],
    questions: [
      q("q-channel-mix", "distribution-manager", "How is new business split across channels this quarter?", "lookup", "Channel investment follows habit rather than mix.", "Channel split with conversion", "new_business_conversion"),
      q("q-rate-trend", "pricing-actuary", "How has rate adequacy moved since the last review?", "trend", "Adequacy erodes quietly between annual reviews.", "Adequacy trend by segment", "rate_adequacy"),
      q("q-referral-outcome", "fraud-investigations-lead", "How long are investigations taking to reach an outcome?", "trend", "Cases age in the queue and the claim pays anyway.", "Outcome time by referral type", "referral_rate"),
      q("q-referral-value", "fraud-investigations-lead", "Which referral types are actually converting to a save?", "comparison", "Investigation capacity is spent on referral types that never pay.", "Referral type list with save ratio", "fraud_save_ratio"),
      q("q-referral-volume", "fraud-investigations-lead", "Where is referral volume rising fastest?", "trend", "A new fraud pattern is seen only once it is expensive.", "Referral rate trend by product", "referral_rate"),
      q("q-rate-adequacy", "pricing-actuary", "Which segments are charging below technical price?", "comparison", "Loss-making segments grow because they are the easiest to win.", "Segment list with adequacy ratio", "rate_adequacy"),
      q("q-quote-conversion", "pricing-actuary", "Where is quote-to-bind falling after a rate change?", "diagnosis", "A rate correction quietly costs more volume than it was worth.", "Segment conversion before and after", "quote_to_bind_ratio"),
      q("q-broker-retention", "distribution-manager", "Which brokers have stopped producing?", "lookup", "A broker relationship is discovered lost at the annual review.", "Broker list with last production date", "broker_retention_rate"),
      q("q-new-business", "distribution-manager", "Where is new business converting best this quarter?", "comparison", "Appetite is directed by anecdote from the last conversation.", "Channel and product conversion", "new_business_conversion"),
      q("q-lapse-risk", "retention-lead", "Which renewals are most likely to lapse next month?", "forecast", "Intervention arrives after the customer has already left.", "Policy list with lapse likelihood", "policy_lapse_rate"),
      q("q-renewal-uplift", "retention-lead", "How much uplift are we applying to retained policies?", "trend", "Retention is bought with margin nobody measured.", "Uplift trend by product", "renewal_premium_uplift"),
      q("q-repair-cycle", "claims-team-lead", "Which repairers are slowest to close a claim?", "comparison", "Cycle time is blamed on volume rather than on the network.", "Supplier list with cycle time", "repair_cycle_time"),
    ],
    agents: [
      {
        key: "fraud-referral-advisor",
        name: "Fraud Referral Advisor",
        summary:
          "Shows which referral types convert to a save and where referral volume is moving, from certified counter-fraud metrics.",
        archetype: "Advisor",
        riskTier: "decision-support",
        domainKey: "fraud",
        primaryPersonaKey: "fraud-investigations-lead",
        questionKeys: ["q-referral-value", "q-referral-volume", "q-referral-outcome"],
        bindings: [
          grounds("fraud-signals", "Referral, typology, and disposition context frames every answer."),
          queries("fraud-signals", "Reads certified referral rate and fraud save ratio.", ["referral_rate", "fraud_save_ratio"]),
        ],
      },
      {
        key: "rate-adequacy-analyst",
        name: "Rate Adequacy Analyst",
        summary:
          "Explains where charged premium sits against technical price, and what a rate change did to conversion.",
        archetype: "Analyst",
        riskTier: "decision-support",
        domainKey: "underwriting",
        primaryPersonaKey: "pricing-actuary",
        questionKeys: ["q-rate-adequacy", "q-quote-conversion", "q-rate-trend"],
        bindings: [
          grounds("pricing-and-rating", "Segment and rating-factor context frames every adequacy answer."),
          queries("pricing-and-rating", "Reads certified rate adequacy and quote-to-bind ratio.", ["rate_adequacy", "quote_to_bind_ratio"]),
        ],
      },
      {
        key: "distribution-performance-navigator",
        name: "Distribution Performance Navigator",
        summary:
          "Points a distribution manager at brokers who stopped producing and channels converting best, from certified metrics.",
        archetype: "Navigator",
        riskTier: "informational",
        domainKey: "distribution",
        primaryPersonaKey: "distribution-manager",
        questionKeys: ["q-broker-retention", "q-new-business", "q-channel-mix"],
        bindings: [
          grounds("distribution-performance", "Channel, broker, and product context frames every comparison."),
          queries("distribution-performance", "Reads certified broker retention and new business conversion.", ["broker_retention_rate", "new_business_conversion"]),
        ],
      },
      {
        key: "renewal-retention-advisor",
        name: "Renewal Retention Advisor",
        summary:
          "Ranks renewals by certified lapse behaviour and shows what uplift retention is costing, before the invitation goes out.",
        archetype: "Advisor",
        riskTier: "decision-support",
        domainKey: "distribution",
        primaryPersonaKey: "retention-lead",
        questionKeys: ["q-lapse-risk", "q-renewal-uplift", "q-repair-cycle"],
        bindings: [
          grounds("policy-retention", "In-force policy and renewal-cycle context frames every recommendation."),
          queries("policy-retention", "Reads certified lapse rate and renewal uplift.", ["policy_lapse_rate", "renewal_premium_uplift"]),
          queries("claims-supply-chain", "Reads certified repair cycle time where a claim experience drives the renewal.", ["repair_cycle_time"]),
        ],
      },
    ],
  },

  manufacturing: {
    personas: [
      persona("maintenance-planner", "Maintenance Planner", "Which assets get planned downtime and when.", "Weekly", "Plans from a failure log that is only updated after the shift."),
      persona("supply-chain-manager", "Supply Chain Manager", "Which suppliers get expedited and where buffer stock sits.", "Daily", "Chases suppliers from an order book with no reliability history."),
      persona("ehs-manager", "EHS Manager", "Where a safety intervention goes next.", "Weekly, escalating immediately on incident", "Counts incidents in a spreadsheet with no leading indicator."),
      persona("production-scheduler", "Production Scheduler", "Which orders run in which sequence this week.", "Daily", "Re-sequences by hand whenever a changeover overruns."),
    ],
    questions: [
      q("q-line-sequence", "production-scheduler", "Which lines lose the most time to sequencing?", "comparison", "Sequencing losses are absorbed as normal running.", "Line list with lost minutes", "changeover_time"),
      q("q-incident-severity", "ehs-manager", "Which incident types are most severe, not just most frequent?", "comparison", "Attention follows frequency and misses severity.", "Incident type with severity mix", "recordable_incident_rate"),
      q("q-downtime-cause", "maintenance-planner", "Which failure modes cause the most unplanned downtime?", "diagnosis", "Maintenance treats symptoms and the mode repeats.", "Failure mode list with downtime", "mean_time_between_failures"),
      q("q-failure-pattern", "maintenance-planner", "Which asset classes are failing most between planned services?", "trend", "Planned maintenance stays on a calendar that reality left behind.", "Asset class list with MTBF trend", "mean_time_between_failures"),
      q("q-planned-ratio", "maintenance-planner", "How much of our maintenance is still reactive?", "comparison", "Reactive work is normalised as how the plant runs.", "Planned share by plant and month", "planned_maintenance_ratio"),
      q("q-supplier-late", "supply-chain-manager", "Which suppliers are missing their delivery windows?", "lookup", "Expediting is triggered by whoever shouts, not by who slips.", "Supplier list with on-time rate", "supplier_on_time_delivery"),
      q("q-otif", "supply-chain-manager", "Where are we failing on-time-in-full to customers?", "diagnosis", "A customer escalation is the first sign of a supply problem.", "Customer list with OTIF and cause", "otif_rate"),
      q("q-incident-rate", "ehs-manager", "How is the recordable incident rate moving by site?", "trend", "Safety performance is reported annually and managed never.", "Site trend with incident rate", "recordable_incident_rate"),
      q("q-near-miss", "ehs-manager", "Which sites report the fewest near misses relative to size?", "comparison", "Silence is read as safety rather than as under-reporting.", "Site comparison with near-miss rate", "near_miss_rate"),
      q("q-schedule-slip", "production-scheduler", "Where is schedule adherence slipping, and after which changeover?", "diagnosis", "The sequence is blamed instead of the changeover that broke it.", "Line list with adherence and changeover", "schedule_adherence"),
      q("q-changeover-cost", "production-scheduler", "Which changeovers are costing the most minutes?", "comparison", "Sequencing rules stay as they were written years ago.", "Changeover pairs with lost minutes", "changeover_time"),
      q("q-supplier-quality", "quality-engineer", "Which suppliers are sending the most defects?", "comparison", "Defects are absorbed on the line rather than raised with the supplier.", "Supplier list with PPM defect rate", "ppm_defect_rate"),
    ],
    agents: [
      {
        key: "maintenance-planning-advisor",
        name: "Maintenance Planning Advisor",
        summary:
          "Shows which assets fail between services and how much work is still reactive, from certified reliability metrics.",
        archetype: "Advisor",
        riskTier: "decision-support",
        domainKey: "maintenance",
        primaryPersonaKey: "maintenance-planner",
        questionKeys: ["q-failure-pattern", "q-planned-ratio", "q-downtime-cause"],
        bindings: [
          grounds("maintenance-reliability", "Asset class and work-order context frames every maintenance answer."),
          queries("maintenance-reliability", "Reads certified MTBF and planned maintenance ratio.", ["mean_time_between_failures", "planned_maintenance_ratio"]),
        ],
      },
      {
        key: "supply-reliability-monitor",
        name: "Supply Reliability Monitor",
        summary:
          "Watches supplier delivery and customer OTIF against certified metrics, and says where the flow is breaking.",
        archetype: "Monitor",
        riskTier: "decision-support",
        domainKey: "supply-chain",
        primaryPersonaKey: "supply-chain-manager",
        questionKeys: ["q-supplier-late", "q-otif", "q-supplier-quality"],
        bindings: [
          grounds("supply-chain-flow", "Order, supplier, and customer context frames every flow answer."),
          queries("supply-chain-flow", "Reads certified OTIF alongside the order book.", ["otif_rate"]),
          queries("supplier-quality", "Reads certified supplier delivery and defect metrics.", ["supplier_on_time_delivery", "ppm_defect_rate"]),
        ],
      },
      {
        key: "safety-signal-monitor",
        name: "Safety Signal Monitor",
        summary:
          "Tracks recordable incidents against near-miss reporting, so under-reporting reads as a signal rather than as safety.",
        archetype: "Monitor",
        riskTier: "informational",
        domainKey: "safety",
        primaryPersonaKey: "ehs-manager",
        questionKeys: ["q-incident-rate", "q-near-miss", "q-incident-severity"],
        bindings: [
          grounds("safety-incidents", "Site, shift, and incident-class context frames every safety answer."),
          queries("safety-incidents", "Reads certified recordable incident and near-miss rates.", ["recordable_incident_rate", "near_miss_rate"]),
        ],
      },
      {
        key: "schedule-adherence-analyst",
        name: "Schedule Adherence Analyst",
        summary:
          "Explains where the schedule slips and which changeovers cost the most minutes, from certified production metrics.",
        archetype: "Analyst",
        riskTier: "decision-support",
        domainKey: "production",
        primaryPersonaKey: "production-scheduler",
        questionKeys: ["q-schedule-slip", "q-changeover-cost", "q-line-sequence"],
        bindings: [
          grounds("capacity-and-scheduling", "Line, order, and sequence context frames every scheduling answer."),
          queries("capacity-and-scheduling", "Reads certified schedule adherence and changeover time.", ["schedule_adherence", "changeover_time"]),
        ],
      },
    ],
  },

  "public-sector": {
    personas: [
      persona("payments-assurance-lead", "Payments Assurance Lead", "Which payment error causes are investigated and which recoveries are pursued.", "Monthly", "Samples payments manually and generalises from what the sample showed."),
      persona("contact-centre-manager", "Contact Centre Manager", "Where staff are moved between channels each week.", "Daily", "Balances queue reports that describe yesterday."),
      persona("digital-service-owner", "Digital Service Owner", "Which service journeys are rebuilt next.", "Fortnightly", "Reads drop-off analytics with no view of assisted-digital demand."),
      persona("commercial-lead", "Commercial Lead", "Where contract routes are tightened and which suppliers are reviewed.", "Quarterly", "Reconciles spend across ledgers with inconsistent supplier names."),
    ],
    questions: [
      q("q-spend-trend", "commercial-lead", "How is category spend moving against contract?", "trend", "Spend drifts off-contract a category at a time.", "Category trend with compliance", "contract_compliance_rate"),
      q("q-demand-trend", "contact-centre-manager", "How is contact demand trending by channel?", "trend", "Staffing is planned against last year\u2019s shape of demand.", "Channel trend with volume and wait", "average_wait_time"),
      q("q-error-causes", "payments-assurance-lead", "What is causing payment error in the worst scheme?", "diagnosis", "The same error cause is corrected case by case forever.", "Cause list with value at risk", "payment_accuracy_rate"),
      q("q-payment-accuracy", "payments-assurance-lead", "Which schemes are paying least accurately this quarter?", "comparison", "Error is discovered in an annual audit rather than in the month.", "Scheme list with accuracy rate", "payment_accuracy_rate"),
      q("q-recovery-rate", "payments-assurance-lead", "How much identified overpayment are we actually recovering?", "trend", "Recovery targets are set against a number nobody tracks.", "Recovery trend by scheme", "overpayment_recovery_rate"),
      q("q-wait-times", "contact-centre-manager", "Where are citizens waiting longest to be served?", "lookup", "Staff move to the loudest channel rather than the slowest.", "Channel list with average wait", "average_wait_time"),
      q("q-first-contact", "contact-centre-manager", "Which enquiry types need a second contact most often?", "diagnosis", "Repeat contact is counted as demand instead of as failure.", "Enquiry type with resolution rate", "first_contact_resolution"),
      q("q-digital-dropoff", "digital-service-owner", "Which online journeys are people failing to complete?", "diagnosis", "A broken journey is rebuilt only after complaints arrive.", "Journey list with completion rate", "digital_completion_rate"),
      q("q-assisted-digital", "digital-service-owner", "Where is assisted-digital demand highest?", "comparison", "Support is withdrawn from the people who need it most.", "Service list with assisted share", "assisted_digital_share"),
      q("q-appeal-overturn", "casework-manager", "Which decision types are overturned most on appeal?", "comparison", "The same decision error is repeated at scale.", "Decision type with overturn rate", "appeal_overturn_rate"),
      q("q-supplier-concentration", "commercial-lead", "Where is spend most concentrated with a single supplier?", "lookup", "Dependency is discovered when the supplier fails.", "Category list with concentration", "supplier_concentration"),
      q("q-contract-compliance", "commercial-lead", "How much spend is going outside a compliant route?", "trend", "Off-contract spend grows quietly until an audit finds it.", "Compliance trend by category", "contract_compliance_rate"),
    ],
    agents: [
      {
        key: "payment-accuracy-analyst",
        name: "Payment Accuracy Analyst",
        summary:
          "Explains which schemes pay least accurately and how much overpayment is recovered, from certified payment metrics.",
        archetype: "Analyst",
        riskTier: "decision-support",
        domainKey: "payments-and-benefits",
        primaryPersonaKey: "payments-assurance-lead",
        questionKeys: ["q-payment-accuracy", "q-recovery-rate", "q-error-causes"],
        bindings: [
          grounds("benefit-payments", "Scheme, entitlement, and payment-run context frames every answer."),
          queries("benefit-payments", "Reads certified payment accuracy and recovery rate.", ["payment_accuracy_rate", "overpayment_recovery_rate"]),
        ],
      },
      {
        key: "contact-demand-monitor",
        name: "Contact Demand Monitor",
        summary:
          "Watches wait times and repeat contact by channel, so staffing follows where citizens are actually stuck.",
        archetype: "Monitor",
        riskTier: "decision-support",
        domainKey: "service-delivery",
        primaryPersonaKey: "contact-centre-manager",
        questionKeys: ["q-wait-times", "q-first-contact", "q-demand-trend"],
        bindings: [
          grounds("contact-and-channels", "Channel and enquiry-type context frames every demand answer."),
          queries("contact-and-channels", "Reads certified wait time and first-contact resolution.", ["average_wait_time", "first_contact_resolution"]),
        ],
      },
      {
        key: "digital-journey-advisor",
        name: "Digital Journey Advisor",
        summary:
          "Shows which online journeys fail and where assisted-digital demand sits, from certified service metrics.",
        archetype: "Advisor",
        riskTier: "decision-support",
        domainKey: "service-delivery",
        primaryPersonaKey: "digital-service-owner",
        questionKeys: ["q-digital-dropoff", "q-assisted-digital", "q-appeal-overturn"],
        bindings: [
          grounds("digital-services", "Journey and step context frames every completion answer."),
          queries("digital-services", "Reads certified completion and assisted-digital metrics.", ["digital_completion_rate", "assisted_digital_share"]),
          queries("appeals-and-complaints", "Reads the certified overturn rate where a journey produced the decision.", ["appeal_overturn_rate"]),
        ],
      },
      {
        key: "commercial-spend-navigator",
        name: "Commercial Spend Navigator",
        summary:
          "Points a commercial lead at concentration and off-contract spend, with the certified numbers behind each.",
        archetype: "Navigator",
        riskTier: "informational",
        domainKey: "policy-analysis",
        primaryPersonaKey: "commercial-lead",
        questionKeys: ["q-supplier-concentration", "q-contract-compliance", "q-spend-trend"],
        bindings: [
          grounds("procurement-and-spend", "Category, supplier, and contract context frames every spend answer."),
          queries("procurement-and-spend", "Reads certified concentration and contract compliance.", ["supplier_concentration", "contract_compliance_rate"]),
        ],
      },
    ],
  },

  "retail-cpg": {
    personas: [
      persona("store-operations-manager", "Store Operations Manager", "Where hours are added or cut across the estate each week.", "Weekly", "Compares labour reports with sales exports that arrive on different days."),
      persona("ecommerce-manager", "Ecommerce Manager", "Which journey fixes and campaigns go live next.", "Daily", "Watches a funnel dashboard with no view of what changed upstream."),
      persona("loyalty-manager", "Loyalty Manager", "Which segments get an offer and what it costs.", "Weekly", "Builds segments from an export that is a week stale."),
      persona("fulfilment-manager", "Fulfilment Manager", "Where capacity is added and which carrier is used.", "Daily", "Reads carrier reports separately from the order book."),
    ],
    questions: [
      q("q-lane-cost-trend", "fulfilment-manager", "How is cost per order trending by lane?", "trend", "Cost creeps up lane by lane between reviews.", "Lane trend with cost per order", "cost_per_order"),
      q("q-device-conversion", "ecommerce-manager", "Where does conversion differ most by device?", "comparison", "A mobile-only failure hides inside a healthy total.", "Device comparison with conversion", "conversion_rate"),
      q("q-store-trend", "store-operations-manager", "How is labour productivity trending by format?", "trend", "Productivity slips seasonally and is read as noise.", "Format trend with hours per sale", "labour_hours_per_sale"),
      q("q-labour-productivity", "store-operations-manager", "Which stores are using the most hours per sale?", "comparison", "Hours are cut evenly rather than where they are unproductive.", "Store list with hours per sale", "labour_hours_per_sale"),
      q("q-shrink-hotspots", "store-operations-manager", "Where is shrink concentrated this period?", "lookup", "Shrink is treated as a cost of trading rather than a location problem.", "Store and category with shrink rate", "shrink_rate"),
      q("q-conversion-drop", "ecommerce-manager", "Where did conversion drop after the last release?", "diagnosis", "A broken step stays live because the total looks normal.", "Step conversion before and after", "conversion_rate"),
      q("q-abandonment", "ecommerce-manager", "Which baskets are being abandoned most, and at which step?", "diagnosis", "Abandonment is answered with discounts instead of fixes.", "Step list with abandonment rate", "basket_abandonment_rate"),
      q("q-repeat-purchase", "loyalty-manager", "Which segments are buying again within ninety days?", "trend", "Offers go to segments that would have returned anyway.", "Segment trend with repeat rate", "repeat_purchase_rate"),
      q("q-loyalty-penetration", "loyalty-manager", "Where is loyalty identification weakest?", "comparison", "Half the basket data is missing and nobody says which half.", "Store list with identified share", "loyalty_penetration"),
      q("q-delivery-late", "fulfilment-manager", "Which lanes are missing the promised delivery slot?", "lookup", "A carrier problem is discovered through customer contact.", "Lane list with on-time rate", "on_time_delivery"),
      q("q-cost-per-order", "fulfilment-manager", "Where is cost per order highest, and what is driving it?", "diagnosis", "Fulfilment cost is managed as one number for the whole network.", "Node list with cost and driver", "cost_per_order"),
      q("q-promo-roi", "category-manager", "Which promotions actually returned their investment?", "comparison", "The same mechanic is repeated because it felt busy.", "Campaign list with ROI", "promotion_roi"),
    ],
    agents: [
      {
        key: "store-productivity-advisor",
        name: "Store Productivity Advisor",
        summary:
          "Shows which stores use the most hours per sale and where shrink concentrates, from certified store metrics.",
        archetype: "Advisor",
        riskTier: "decision-support",
        domainKey: "store-operations",
        primaryPersonaKey: "store-operations-manager",
        questionKeys: ["q-labour-productivity", "q-shrink-hotspots", "q-store-trend"],
        bindings: [
          grounds("store-operations-360", "Store, format, and shift context frames every productivity answer."),
          queries("store-operations-360", "Reads certified labour hours per sale and shrink rate.", ["labour_hours_per_sale", "shrink_rate"]),
        ],
      },
      {
        key: "conversion-drop-analyst",
        name: "Conversion Drop Analyst",
        summary:
          "Explains where the digital funnel lost people and at which step baskets are abandoned, from certified metrics.",
        archetype: "Analyst",
        riskTier: "decision-support",
        domainKey: "ecommerce",
        primaryPersonaKey: "ecommerce-manager",
        questionKeys: ["q-conversion-drop", "q-abandonment", "q-device-conversion"],
        bindings: [
          grounds("ecommerce-funnel", "Session, step, and device context frames every funnel answer."),
          queries("ecommerce-funnel", "Reads certified conversion and basket abandonment.", ["conversion_rate", "basket_abandonment_rate"]),
        ],
      },
      {
        key: "loyalty-segment-advisor",
        name: "Loyalty Segment Advisor",
        summary:
          "Shows which segments return without prompting and where loyalty identification is weakest, from certified metrics.",
        archetype: "Advisor",
        riskTier: "decision-support",
        domainKey: "customer-loyalty",
        primaryPersonaKey: "loyalty-manager",
        questionKeys: ["q-repeat-purchase", "q-loyalty-penetration", "q-promo-roi"],
        bindings: [
          grounds("loyalty-and-crm", "Member, segment, and campaign context frames every offer answer."),
          queries("loyalty-and-crm", "Reads certified repeat purchase and loyalty penetration.", ["repeat_purchase_rate", "loyalty_penetration"]),
          queries("pricing-and-promotions", "Reads certified promotion ROI where an offer is being considered.", ["promotion_roi"]),
        ],
      },
      {
        key: "fulfilment-cost-monitor",
        name: "Fulfilment Cost Monitor",
        summary:
          "Watches delivery reliability and cost per order across the network, and says which lane is failing.",
        archetype: "Monitor",
        riskTier: "decision-support",
        domainKey: "supply-chain",
        primaryPersonaKey: "fulfilment-manager",
        questionKeys: ["q-delivery-late", "q-cost-per-order", "q-lane-cost-trend"],
        bindings: [
          grounds("fulfilment-and-delivery", "Lane, node, and carrier context frames every delivery answer."),
          queries("fulfilment-and-delivery", "Reads certified on-time delivery and cost per order.", ["on_time_delivery", "cost_per_order"]),
        ],
      },
    ],
  },

  telecom: {
    personas: [
      persona("service-assurance-manager", "Service Assurance Manager", "Which fault classes get engineering attention this sprint.", "Daily", "Reads fault tickets with no view of which faults repeat."),
      persona("enterprise-account-manager", "Enterprise Account Manager", "Which accounts get a service review and where credits are conceded.", "Monthly", "Assembles an SLA position from tickets the customer already quoted."),
      persona("device-product-manager", "Device Product Manager", "Which upgrade offers run, and at what subsidy.", "Monthly", "Judges upgrade appetite from last quarter's take-up sheet."),
      persona("field-installation-lead", "Field Installation Lead", "Where install capacity goes and which jobs are re-scheduled.", "Daily", "Balances an install diary against a provisioning system that lags it."),
    ],
    questions: [
      q("q-upgrade-timing", "device-product-manager", "When in the contract do upgrades actually happen?", "trend", "Offers land months before or after the moment of appetite.", "Take rate by contract month", "upgrade_take_rate"),
      q("q-credit-exposure", "enterprise-account-manager", "Which accounts have the largest service-credit exposure?", "comparison", "Credits are conceded without a view of the total.", "Account list with exposure", "sla_attainment"),
      q("q-fault-volume", "service-assurance-manager", "Which regions are raising the most faults this week?", "lookup", "Engineering attention follows escalation, not volume.", "Region list with fault volume", "mean_time_to_restore"),
      q("q-fault-repeat", "service-assurance-manager", "Which fault classes keep coming back after restoration?", "trend", "The same fault is fixed repeatedly and never resolved.", "Fault class with repeat rate", "repeat_fault_rate"),
      q("q-restore-time", "service-assurance-manager", "Where is restoration slowest, and for which class?", "comparison", "Restoration targets are missed in a region nobody is watching.", "Region list with time to restore", "mean_time_to_restore"),
      q("q-sla-breach", "enterprise-account-manager", "Which enterprise accounts are closest to an SLA breach?", "forecast", "A credit is conceded before anyone knew it was coming.", "Account list with SLA position", "sla_attainment"),
      q("q-renewal-risk", "enterprise-account-manager", "Which contracts are up for renewal with poor service history?", "recommendation", "Renewal conversations start without the service story.", "Contract list with renewal date", "contract_renewal_rate"),
      q("q-upgrade-appetite", "device-product-manager", "Which segments are taking up upgrades fastest?", "trend", "Subsidy is spent evenly across uneven appetite.", "Segment trend with take rate", "upgrade_take_rate"),
      q("q-device-margin", "device-product-manager", "Where is device margin thinnest after subsidy?", "comparison", "A popular offer turns out to lose money per unit.", "Device list with margin", "device_margin"),
      q("q-install-first-time", "field-installation-lead", "Where are installs failing on the first visit?", "diagnosis", "Repeat visits absorb capacity that new orders needed.", "Region list with first-time-right rate", "install_first_time_right"),
      q("q-provisioning-lag", "field-installation-lead", "How long are orders taking to reach activation?", "trend", "Order-to-activation is quoted from memory, not measurement.", "Product trend with lead time", "provisioning_lead_time"),
      q("q-cell-headroom", "network-performance-analyst", "Which cells run out of capacity first at current growth?", "forecast", "Capacity is added after customers have already felt it.", "Cell list with months of headroom", "capacity_headroom"),
    ],
    agents: [
      {
        key: "fault-pattern-analyst",
        name: "Fault Pattern Analyst",
        summary:
          "Explains which faults repeat and where restoration is slowest, from certified assurance metrics.",
        archetype: "Analyst",
        riskTier: "decision-support",
        domainKey: "service-assurance",
        primaryPersonaKey: "service-assurance-manager",
        questionKeys: ["q-fault-repeat", "q-restore-time", "q-fault-volume"],
        bindings: [
          grounds("service-assurance-360", "Fault class, region, and service context frames every answer."),
          queries("service-assurance-360", "Reads certified time to restore and repeat fault rate.", ["mean_time_to_restore", "repeat_fault_rate"]),
        ],
      },
      {
        key: "enterprise-sla-monitor",
        name: "Enterprise SLA Monitor",
        summary:
          "Watches SLA position and renewal exposure per account, so a service review happens before a credit does.",
        archetype: "Monitor",
        riskTier: "decision-support",
        domainKey: "enterprise-accounts",
        primaryPersonaKey: "enterprise-account-manager",
        questionKeys: ["q-sla-breach", "q-renewal-risk", "q-credit-exposure"],
        bindings: [
          grounds("enterprise-contracts", "Account, contract, and service-level context frames every answer."),
          queries("enterprise-contracts", "Reads certified SLA attainment and renewal rate.", ["sla_attainment", "contract_renewal_rate"]),
        ],
      },
      {
        key: "upgrade-appetite-advisor",
        name: "Upgrade Appetite Advisor",
        summary:
          "Shows where upgrade take-up is strongest and where device margin is thinnest, from certified metrics.",
        archetype: "Advisor",
        riskTier: "decision-support",
        domainKey: "consumer-mobile",
        primaryPersonaKey: "device-product-manager",
        questionKeys: ["q-upgrade-appetite", "q-device-margin", "q-upgrade-timing"],
        bindings: [
          grounds("device-and-upgrade", "Device, tariff, and eligibility context frames every offer answer."),
          queries("device-and-upgrade", "Reads certified upgrade take rate and device margin.", ["upgrade_take_rate", "device_margin"]),
        ],
      },
      {
        key: "install-performance-advisor",
        name: "Install Performance Advisor",
        summary:
          "Shows where installs fail first time and how long activation takes, with the capacity picture behind it.",
        archetype: "Advisor",
        riskTier: "decision-support",
        domainKey: "service-assurance",
        primaryPersonaKey: "field-installation-lead",
        questionKeys: ["q-install-first-time", "q-provisioning-lag", "q-cell-headroom"],
        bindings: [
          grounds("field-installations", "Job, appointment, and provisioning context frames every install answer."),
          queries("field-installations", "Reads certified first-time-right and provisioning lead time.", ["install_first_time_right", "provisioning_lead_time"]),
          queries("spectrum-and-capacity", "Reads certified capacity headroom where an install depends on it.", ["capacity_headroom"]),
        ],
      },
    ],
  },

  _generic: {
    personas: [
      persona("customer-success-lead", "Customer Success Lead", "Which accounts get attention this week and which are left alone.", "Weekly", "Works from a churn list built by hand each Monday."),
      persona("service-owner", "Service Owner", "Where reliability work goes next.", "Weekly", "Reads incident counts with no view of which service they belong to."),
      persona("commercial-analyst", "Commercial Analyst", "Which forecast is taken to the board.", "Monthly", "Reconciles a pipeline export against a finance ledger by hand."),
      persona("compliance-manager", "Compliance Manager", "Which control failures are escalated and which are accepted.", "Quarterly", "Chases control owners by email for evidence."),
    ],
    questions: [
      q("q-control-trend", "compliance-manager", "How is control pass rate moving by framework?", "trend", "Control health is asserted rather than shown.", "Framework trend with pass rate", "control_pass_rate"),
      q("q-incident-trend", "service-owner", "How is the incident rate moving month on month?", "trend", "A slow degradation is only visible in hindsight.", "Service trend with incident rate", "incident_rate"),
      q("q-customer-trend", "customer-success-lead", "How is the active customer base trending?", "trend", "Growth is reported from contracts rather than usage.", "Active count trend by segment", "active_customers"),
      q("q-active-customers", "customer-success-lead", "How many customers are actually active this month?", "lookup", "Reporting counts contracts rather than usage.", "Active count by segment", "active_customers"),
      q("q-churn-where", "customer-success-lead", "Where is churn concentrated?", "comparison", "Retention effort spreads evenly across uneven risk.", "Segment list with churn rate", "customer_churn_rate"),
      q("q-sla-attainment", "service-owner", "Which services are missing their service levels?", "lookup", "A missed level is reported after the customer noticed.", "Service list with attainment", "sla_attainment"),
      q("q-incident-drivers", "service-owner", "Which services generate the most incidents per transaction?", "comparison", "Reliability work goes to the loudest service, not the worst.", "Service list with incident rate", "incident_rate"),
      q("q-forecast-accuracy", "commercial-analyst", "How accurate has the forecast been by segment?", "trend", "The same optimistic segment is believed every quarter.", "Segment trend with error", "forecast_accuracy"),
      q("q-pipeline-conversion", "commercial-analyst", "Where is pipeline converting best?", "comparison", "Capacity is planned against a pipeline nobody weighted.", "Segment list with conversion", "pipeline_conversion"),
      q("q-control-failures", "compliance-manager", "Which controls failed testing this quarter?", "lookup", "Committee hears about a failure at the same time as the regulator.", "Control list with test result", "control_pass_rate"),
      q("q-overdue-actions", "compliance-manager", "Which remediation actions are overdue?", "trend", "An overdue action ages quietly until it is an incident.", "Action list with days overdue", "overdue_actions"),
      q("q-cost-per-transaction", "finance-controller", "Where is cost per transaction highest?", "comparison", "Cost is managed as one total rather than where it is made.", "Channel list with unit cost", "cost_per_transaction"),
    ],
    agents: [
      {
        key: "customer-retention-advisor",
        name: "Customer Retention Advisor",
        summary:
          "Shows who is genuinely active and where churn concentrates, from certified customer metrics.",
        archetype: "Advisor",
        riskTier: "decision-support",
        domainKey: "customer",
        primaryPersonaKey: "customer-success-lead",
        questionKeys: ["q-active-customers", "q-churn-where", "q-customer-trend"],
        bindings: [
          grounds("customer-360", "Conformed customer context frames every retention answer."),
          queries("customer-360", "Reads certified active customers and churn rate.", ["active_customers", "customer_churn_rate"]),
        ],
      },
      {
        key: "service-reliability-monitor",
        name: "Service Reliability Monitor",
        summary:
          "Watches service level attainment and incident rate per service, so reliability work follows the evidence.",
        archetype: "Monitor",
        riskTier: "decision-support",
        domainKey: "operations",
        primaryPersonaKey: "service-owner",
        questionKeys: ["q-sla-attainment", "q-incident-drivers", "q-incident-trend"],
        bindings: [
          grounds("service-quality", "Service and transaction context frames every reliability answer."),
          queries("service-quality", "Reads certified SLA attainment and incident rate.", ["sla_attainment", "incident_rate"]),
        ],
      },
      {
        key: "forecast-accuracy-analyst",
        name: "Forecast Accuracy Analyst",
        summary:
          "Explains where the forecast has been wrong and where pipeline converts, from certified commercial metrics.",
        archetype: "Analyst",
        riskTier: "decision-support",
        domainKey: "customer",
        primaryPersonaKey: "commercial-analyst",
        questionKeys: ["q-forecast-accuracy", "q-pipeline-conversion", "q-cost-per-transaction"],
        bindings: [
          grounds("demand-and-pipeline", "Pipeline stage and segment context frames every forecast answer."),
          queries("demand-and-pipeline", "Reads certified forecast accuracy and pipeline conversion.", ["forecast_accuracy", "pipeline_conversion"]),
          queries("cost-to-serve", "Reads certified cost per transaction where unit economics matter to the answer.", ["cost_per_transaction"]),
        ],
      },
      {
        key: "control-failure-monitor",
        name: "Control Failure Monitor",
        summary:
          "Tracks which controls failed testing and which remediation actions are overdue, from the certified register.",
        archetype: "Monitor",
        riskTier: "informational",
        domainKey: "finance",
        primaryPersonaKey: "compliance-manager",
        questionKeys: ["q-control-failures", "q-overdue-actions", "q-control-trend"],
        bindings: [
          grounds("compliance-register", "Framework and control context frames every compliance answer."),
          queries("compliance-register", "Reads certified control pass rate and overdue actions.", ["control_pass_rate", "overdue_actions"]),
        ],
      },
    ],
  },
};

function insertBefore(source, marker, block) {
  const at = source.indexOf(marker);
  if (at === -1) throw new Error(`no ${marker.trim()} section`);
  return `${source.slice(0, at)}\n${block}${source.slice(at)}`;
}

let agents = 0;
for (const [pack, content] of Object.entries(PACKS)) {
  const file = path.join(ROOT, "packs", pack, "pack.yaml");
  let source = readFileSync(file, "utf8");

  const existing = new Set([...source.matchAll(/^- key: (.+)$/gm)].map((match) => match[1]));
  const freshAgents = content.agents.filter((agent) => !existing.has(agent.key));
  if (freshAgents.length === 0) {
    console.info(`${pack}: already expanded`);
    continue;
  }

  source = insertBefore(
    source,
    "\nquestionLibrary:",
    content.personas.filter((p) => !existing.has(p.key)).map(renderPersona).join("\n"),
  );
  source = insertBefore(
    source,
    "\ndataProducts:",
    content.questions.filter((question) => !existing.has(question.key)).map(renderQuestion).join("\n"),
  );
  source = insertBefore(source, "\nregulatoryConstraints:", freshAgents.map(renderAgent).join("\n"));

  writeFileSync(file, source);
  agents += freshAgents.length;
  console.info(
    `${pack}: +${freshAgents.length} agents, +${content.personas.length} personas, +${content.questions.length} questions`,
  );
}
console.info(`\n${agents} starter agents added.`);
