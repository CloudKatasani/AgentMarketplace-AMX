/**
 * One-off authoring aid: appends the second wave of certified data products to
 * every industry pack.
 *
 * Packs shipped with two or three products each, which was enough to seed a
 * starter agent and not enough to *browse*. A catalogue is a claim about
 * breadth, so each pack now carries eight to ten products across its own
 * domains, each with certified metrics at a stated grain.
 *
 * Kept in the repository rather than run and deleted: the next person adding a
 * pack will want the shape, and the diff it produced is easier to review
 * against the generator than against nine YAML files.
 *
 *   node scripts/expand-packs.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Quotes a scalar when YAML would otherwise read it as structure — a colon
 * followed by a space starts a mapping, and `pnpm pack:validate` is the thing
 * that told us so.
 */
function scalar(value) {
  const text = String(value);
  return /[:#]\s|^[\s&*!|>%@`'"-]|\s$/.test(text) ? JSON.stringify(text) : text;
}

/** Serialises one product in the exact style the packs already use. */
function render(product) {
  const lines = [
    `- key: ${product.key}`,
    `  name: ${scalar(product.name)}`,
    `  description: ${scalar(product.description)}`,
    `  domainKey: ${product.domainKey}`,
    `  owner: ${scalar(product.owner)}`,
    `  contractVersion: ${product.contractVersion}`,
    `  semanticModelVersion: ${product.contractVersion}`,
    `  layer: ${product.layer ?? "GOLD"}`,
    `  qualityScore: ${product.qualityScore}`,
    `  sensitivity: ${product.sensitivity ?? "INTERNAL"}`,
    `  freshnessSlaHours: ${product.freshnessSlaHours ?? 24}`,
    `  metrics:`,
  ];
  for (const metric of product.metrics) {
    lines.push(
      `  - key: ${metric.key}`,
      `    name: ${scalar(metric.name)}`,
      `    definition: ${scalar(metric.definition)}`,
      `    grain: ${scalar(metric.grain)}`,
      `    unit: ${scalar(metric.unit)}`,
      `    semanticRef: semantic.${product.key.replace(/-/g, "_")}.${metric.key}`,
    );
  }
  return lines.join("\n");
}

const m = (key, name, definition, grain, unit) => ({ key, name, definition, grain, unit });

const PACKS = {
  utilities: [
    {
      key: "field-service-operations",
      name: "Field Service Operations",
      description:
        "Certified job, appointment, and crew metrics across planned and reactive field work.",
      domainKey: "field-services",
      owner: "Field Operations Analytics",
      contractVersion: "1.4.0",
      qualityScore: 88,
      metrics: [
        m("first_time_fix_rate", "First-time fix rate", "Share of field jobs resolved on the first visit, excluding jobs abandoned for access.", "job / month", "percent"),
        m("appointment_adherence", "Appointment adherence", "Share of booked appointments met inside the promised window.", "appointment / week", "percent"),
        m("mean_time_to_attend", "Mean time to attend", "Average hours from job creation to a crew arriving on site.", "job / month", "hours"),
      ],
    },
    {
      key: "asset-health-register",
      name: "Asset Health Register",
      description:
        "Condition, criticality, and replacement priority for network assets, certified against the asset register.",
      domainKey: "asset-management",
      owner: "Asset Strategy",
      contractVersion: "2.0.0",
      qualityScore: 91,
      freshnessSlaHours: 168,
      metrics: [
        m("asset_health_index", "Asset health index", "Composite condition score from inspection, age, and failure history, 0 to 100.", "asset / quarter", "index"),
        m("replacement_priority_score", "Replacement priority score", "Ranking of assets for replacement, combining health index with criticality.", "asset / quarter", "index"),
      ],
    },
    {
      key: "energy-trading-positions",
      name: "Energy Trading Positions",
      description:
        "Certified hedge, imbalance, and position metrics for the wholesale energy book.",
      domainKey: "energy-trading",
      owner: "Trading Analytics",
      contractVersion: "1.2.0",
      qualityScore: 94,
      sensitivity: "CONFIDENTIAL",
      freshnessSlaHours: 4,
      metrics: [
        m("hedge_coverage_ratio", "Hedge coverage ratio", "Share of forecast demand covered by executed hedges for the delivery period.", "delivery period / day", "percent"),
        m("imbalance_cost", "Imbalance cost", "Cost of settlement imbalance between forecast and metered volume.", "settlement period / day", "currency"),
      ],
    },
    {
      key: "regulatory-submissions",
      name: "Regulatory Submissions",
      description:
        "Timeliness and quality of statutory submissions, with the exceptions raised against each.",
      domainKey: "regulatory-reporting",
      owner: "Regulatory Reporting",
      contractVersion: "1.1.0",
      qualityScore: 96,
      freshnessSlaHours: 72,
      metrics: [
        m("submission_timeliness_rate", "Submission timeliness rate", "Share of statutory submissions filed on or before the regulatory deadline.", "submission / quarter", "percent"),
        m("data_quality_exceptions", "Data quality exceptions", "Count of validation exceptions raised against a submission before filing.", "submission / quarter", "count"),
      ],
    },
    {
      key: "sustainability-emissions",
      name: "Sustainability & Emissions",
      description:
        "Certified emissions, renewable share, and network loss metrics used in public reporting.",
      domainKey: "sustainability",
      owner: "Sustainability Reporting",
      contractVersion: "1.0.0",
      qualityScore: 87,
      freshnessSlaHours: 720,
      metrics: [
        m("scope_two_emissions", "Scope 2 emissions", "Market-based emissions from purchased electricity for network operations.", "reporting entity / month", "tonnes CO2e"),
        m("renewable_share", "Renewable share", "Share of supplied energy from certified renewable generation.", "supply region / month", "percent"),
        m("network_losses", "Network losses", "Energy entering the network that is not billed to a customer, as a share of throughput.", "network area / month", "percent"),
      ],
    },
    {
      key: "outage-communications",
      name: "Outage Communications",
      description:
        "How quickly and how well customers were told about interruptions, by channel and event.",
      domainKey: "customer-experience",
      owner: "Customer Operations",
      contractVersion: "1.3.0",
      qualityScore: 85,
      metrics: [
        m("notification_latency", "Notification latency", "Minutes from outage confirmation to the first customer notification going out.", "outage event", "minutes"),
        m("proactive_contact_rate", "Proactive contact rate", "Share of affected customers contacted before they contacted the utility.", "outage event", "percent"),
      ],
    },
    {
      key: "connections-and-capacity",
      name: "Connections & Capacity",
      description:
        "New connection lead times and available network headroom by substation and feeder.",
      domainKey: "network-operations",
      owner: "Network Planning",
      contractVersion: "1.1.0",
      qualityScore: 90,
      freshnessSlaHours: 168,
      metrics: [
        m("connection_lead_time", "Connection lead time", "Working days from a complete connection application to energisation.", "connection / month", "days"),
        m("capacity_headroom", "Capacity headroom", "Spare firm capacity at a substation as a share of its rating.", "substation / month", "percent"),
      ],
    },
  ],

  banking: [
    {
      key: "deposits-and-savings",
      name: "Deposits & Savings",
      description:
        "Certified balance, growth, and attrition metrics across retail deposit products.",
      domainKey: "retail-banking",
      owner: "Retail Analytics",
      contractVersion: "1.5.0",
      qualityScore: 93,
      sensitivity: "CONFIDENTIAL",
      metrics: [
        m("deposit_balance_growth", "Deposit balance growth", "Net change in deposit balances for a segment, excluding internal transfers.", "segment / month", "percent"),
        m("deposit_attrition_rate", "Deposit attrition rate", "Share of accounts closed or drained below the active threshold in the period.", "segment / month", "percent"),
      ],
    },
    {
      key: "lending-origination",
      name: "Lending Origination",
      description:
        "Application, decision, and drawdown metrics across commercial lending products.",
      domainKey: "commercial-lending",
      owner: "Lending Analytics",
      contractVersion: "2.1.0",
      qualityScore: 91,
      sensitivity: "CONFIDENTIAL",
      metrics: [
        m("approval_cycle_time", "Approval cycle time", "Working days from a complete application to a credit decision.", "application / month", "days"),
        m("origination_volume", "Origination volume", "Value of new facilities drawn in the period, by product and segment.", "product / month", "currency"),
        m("decline_rate", "Decline rate", "Share of complete applications declined at credit decision.", "product / month", "percent"),
      ],
    },
    {
      key: "payments-flows",
      name: "Payments Flows",
      description:
        "Certified volume, success, and settlement-latency metrics across payment rails.",
      domainKey: "payments",
      owner: "Payments Analytics",
      contractVersion: "1.2.0",
      qualityScore: 95,
      freshnessSlaHours: 4,
      metrics: [
        m("payment_success_rate", "Payment success rate", "Share of initiated payments that settle without manual intervention.", "rail / day", "percent"),
        m("settlement_latency", "Settlement latency", "Median seconds from payment initiation to confirmed settlement.", "rail / day", "seconds"),
      ],
    },
    {
      key: "capital-and-liquidity",
      name: "Capital & Liquidity",
      description:
        "Regulatory capital and liquidity metrics, reconciled to the submitted returns.",
      domainKey: "risk-and-capital",
      owner: "Treasury Reporting",
      contractVersion: "3.0.0",
      qualityScore: 97,
      sensitivity: "RESTRICTED",
      freshnessSlaHours: 72,
      metrics: [
        m("liquidity_coverage_ratio", "Liquidity coverage ratio", "High-quality liquid assets over projected net outflows for the stress window.", "entity / month", "percent"),
        m("rwa_density", "RWA density", "Risk-weighted assets as a share of total exposure, by portfolio.", "portfolio / quarter", "percent"),
      ],
    },
    {
      key: "collections-and-arrears",
      name: "Collections & Arrears",
      description:
        "Arrears, cure, and forbearance metrics across retail and commercial books.",
      domainKey: "retail-banking",
      owner: "Collections Analytics",
      contractVersion: "1.4.0",
      qualityScore: 89,
      sensitivity: "CONFIDENTIAL",
      metrics: [
        m("arrears_rate_30dpd", "Arrears rate (30 DPD)", "Share of accounts thirty or more days past due at period end.", "portfolio / month", "percent"),
        m("cure_rate", "Cure rate", "Share of accounts entering arrears that return to current within ninety days.", "portfolio / month", "percent"),
      ],
    },
    {
      key: "complaints-and-conduct",
      name: "Complaints & Conduct",
      description:
        "Complaint volumes, uphold rates, and remediation progress, by product and root cause.",
      domainKey: "retail-banking",
      owner: "Conduct Risk",
      contractVersion: "1.1.0",
      qualityScore: 88,
      sensitivity: "CONFIDENTIAL",
      metrics: [
        m("complaint_upheld_rate", "Complaint upheld rate", "Share of closed complaints decided in the customer's favour.", "product / month", "percent"),
        m("remediation_backlog", "Remediation backlog", "Open remediation cases past their committed completion date.", "programme / week", "count"),
      ],
    },
    {
      key: "channel-and-digital",
      name: "Channel & Digital",
      description:
        "Adoption and cost-to-serve across branch, contact centre, and digital channels.",
      domainKey: "retail-banking",
      owner: "Channel Analytics",
      contractVersion: "1.0.0",
      qualityScore: 86,
      metrics: [
        m("digital_adoption_rate", "Digital adoption rate", "Share of active customers who completed a servicing task digitally in the period.", "segment / month", "percent"),
        m("cost_to_serve", "Cost to serve", "Fully loaded servicing cost per active customer, by channel mix.", "segment / quarter", "currency"),
      ],
    },
  ],

  healthcare: [
    {
      key: "revenue-cycle-360",
      name: "Revenue Cycle 360",
      description:
        "Certified billing, denial, and collection metrics from encounter through payment.",
      domainKey: "revenue-cycle",
      owner: "Revenue Cycle Analytics",
      contractVersion: "2.2.0",
      qualityScore: 92,
      sensitivity: "CONFIDENTIAL",
      metrics: [
        m("denial_rate", "Denial rate", "Share of submitted claims denied on first pass, by payer and service line.", "payer / month", "percent"),
        m("days_in_ar", "Days in accounts receivable", "Average days from claim submission to cash posting.", "service line / month", "days"),
      ],
    },
    {
      key: "workforce-rostering",
      name: "Workforce & Rostering",
      description:
        "Staffing, agency use, and vacancy metrics across clinical rosters.",
      domainKey: "workforce",
      owner: "Workforce Analytics",
      contractVersion: "1.3.0",
      qualityScore: 87,
      sensitivity: "CONFIDENTIAL",
      metrics: [
        m("agency_hours_share", "Agency hours share", "Share of rostered clinical hours filled by agency staff.", "ward / week", "percent"),
        m("vacancy_rate", "Vacancy rate", "Funded establishment posts unfilled at period end.", "service / month", "percent"),
      ],
    },
    {
      key: "population-risk",
      name: "Population Risk",
      description:
        "Risk stratification and avoidable-admission metrics for registered populations.",
      domainKey: "population-health",
      owner: "Population Health Analytics",
      contractVersion: "1.1.0",
      qualityScore: 85,
      sensitivity: "RESTRICTED",
      freshnessSlaHours: 168,
      metrics: [
        m("risk_stratification_score", "Risk stratification score", "Modelled twelve-month risk of unplanned admission for a registered patient cohort.", "cohort / month", "index"),
        m("avoidable_admission_rate", "Avoidable admission rate", "Admissions for ambulatory care sensitive conditions per thousand population.", "cohort / month", "rate"),
      ],
    },
    {
      key: "theatre-utilisation",
      name: "Theatre Utilisation",
      description:
        "Session utilisation, late starts, and cancellations across operating theatres.",
      domainKey: "patient-flow",
      owner: "Elective Care Analytics",
      contractVersion: "1.2.0",
      qualityScore: 90,
      metrics: [
        m("theatre_utilisation", "Theatre utilisation", "Operating minutes used as a share of scheduled session minutes.", "theatre / week", "percent"),
        m("cancellation_rate", "Cancellation rate", "Share of scheduled procedures cancelled on the day for non-clinical reasons.", "specialty / month", "percent"),
      ],
    },
    {
      key: "diagnostics-turnaround",
      name: "Diagnostics Turnaround",
      description:
        "Test turnaround and backlog metrics across imaging and pathology.",
      domainKey: "patient-flow",
      owner: "Diagnostics Analytics",
      contractVersion: "1.0.0",
      qualityScore: 89,
      metrics: [
        m("test_turnaround_time", "Test turnaround time", "Median hours from request to reported result, by modality.", "modality / week", "hours"),
        m("backlog_over_six_weeks", "Backlog over six weeks", "Patients waiting more than six weeks for a diagnostic test.", "modality / week", "count"),
      ],
    },
    {
      key: "patient-experience",
      name: "Patient Experience",
      description:
        "Survey, complaint, and response metrics describing how care felt to receive.",
      domainKey: "quality-and-safety",
      owner: "Patient Experience",
      contractVersion: "1.1.0",
      qualityScore: 84,
      metrics: [
        m("experience_score", "Experience score", "Mean patient-reported experience score for a service in the period.", "service / month", "index"),
        m("complaint_response_time", "Complaint response time", "Working days from complaint receipt to substantive response.", "service / month", "days"),
      ],
    },
    {
      key: "medicines-and-supply",
      name: "Medicines & Supply",
      description:
        "Formulary adherence and availability metrics for medicines and clinical consumables.",
      domainKey: "quality-and-safety",
      owner: "Pharmacy Analytics",
      contractVersion: "1.0.0",
      qualityScore: 86,
      metrics: [
        m("formulary_adherence", "Formulary adherence", "Share of prescriptions issued within the agreed formulary.", "specialty / month", "percent"),
        m("stockout_rate", "Stockout rate", "Share of stock lines unavailable at the point of dispensing.", "site / week", "percent"),
      ],
    },
  ],

  insurance: [
    {
      key: "fraud-signals",
      name: "Fraud Signals",
      description:
        "Referral, investigation, and recovery metrics from the special investigations unit.",
      domainKey: "fraud",
      owner: "Counter-Fraud Analytics",
      contractVersion: "1.3.0",
      qualityScore: 90,
      sensitivity: "RESTRICTED",
      metrics: [
        m("referral_rate", "Referral rate", "Share of claims referred for investigation, by product and channel.", "product / month", "percent"),
        m("fraud_save_ratio", "Fraud save ratio", "Value of prevented or recovered indemnity over investigation cost.", "product / quarter", "ratio"),
      ],
    },
    {
      key: "reserving-and-actuarial",
      name: "Reserving & Actuarial",
      description:
        "Certified reserve, development, and ultimate-loss metrics used in actuarial review.",
      domainKey: "actuarial",
      owner: "Actuarial Reporting",
      contractVersion: "2.0.0",
      qualityScore: 95,
      sensitivity: "CONFIDENTIAL",
      freshnessSlaHours: 168,
      metrics: [
        m("ibnr_reserve", "IBNR reserve", "Reserve held for claims incurred but not yet reported, by class.", "class / quarter", "currency"),
        m("loss_development_factor", "Loss development factor", "Ratio of ultimate to reported losses at a given development age.", "class / quarter", "ratio"),
      ],
    },
    {
      key: "distribution-performance",
      name: "Distribution Performance",
      description:
        "Broker, agency, and direct channel metrics for new business and retention.",
      domainKey: "distribution",
      owner: "Distribution Analytics",
      contractVersion: "1.4.0",
      qualityScore: 88,
      metrics: [
        m("new_business_conversion", "New business conversion", "Share of quotes that bind, by channel and product.", "channel / month", "percent"),
        m("broker_retention_rate", "Broker retention rate", "Share of producing brokers still producing twelve months later.", "region / quarter", "percent"),
      ],
    },
    {
      key: "pricing-and-rating",
      name: "Pricing & Rating",
      description:
        "Rate adequacy and quote behaviour metrics used in underwriting review.",
      domainKey: "underwriting",
      owner: "Pricing Analytics",
      contractVersion: "1.2.0",
      qualityScore: 91,
      sensitivity: "CONFIDENTIAL",
      metrics: [
        m("rate_adequacy", "Rate adequacy", "Charged premium over technical price for the same risk.", "segment / quarter", "ratio"),
        m("quote_to_bind_ratio", "Quote to bind ratio", "Bound policies over quotes issued, by segment.", "segment / month", "ratio"),
      ],
    },
    {
      key: "policy-retention",
      name: "Policy Retention",
      description:
        "Lapse, renewal, and mid-term adjustment metrics across the in-force book.",
      domainKey: "distribution",
      owner: "Retention Analytics",
      contractVersion: "1.1.0",
      qualityScore: 89,
      metrics: [
        m("policy_lapse_rate", "Policy lapse rate", "Share of policies not renewed at expiry, excluding cancelled-flat policies.", "product / month", "percent"),
        m("renewal_premium_uplift", "Renewal premium uplift", "Average premium change applied at renewal for retained policies.", "product / month", "percent"),
      ],
    },
    {
      key: "claims-supply-chain",
      name: "Claims Supply Chain",
      description:
        "Repairer, supplier, and indemnity metrics for the claims delivery network.",
      domainKey: "claims",
      owner: "Claims Operations",
      contractVersion: "1.0.0",
      qualityScore: 87,
      metrics: [
        m("repair_cycle_time", "Repair cycle time", "Days from first notification of loss to repair completion.", "supplier / month", "days"),
        m("indemnity_leakage", "Indemnity leakage", "Estimated avoidable indemnity spend as a share of paid claims.", "product / quarter", "percent"),
      ],
    },
    {
      key: "catastrophe-exposure",
      name: "Catastrophe Exposure",
      description:
        "Aggregate exposure and modelled loss metrics by peril and accumulation zone.",
      domainKey: "actuarial",
      owner: "Exposure Management",
      contractVersion: "1.1.0",
      qualityScore: 93,
      sensitivity: "CONFIDENTIAL",
      freshnessSlaHours: 168,
      metrics: [
        m("aggregate_exposure", "Aggregate exposure", "Total sum insured within an accumulation zone for a peril.", "zone / quarter", "currency"),
        m("probable_maximum_loss", "Probable maximum loss", "Modelled loss at the stated return period for a peril and zone.", "zone / quarter", "currency"),
      ],
    },
  ],

  manufacturing: [
    {
      key: "maintenance-reliability",
      name: "Maintenance & Reliability",
      description:
        "Planned versus reactive maintenance, and reliability metrics by asset class.",
      domainKey: "maintenance",
      owner: "Reliability Engineering",
      contractVersion: "1.4.0",
      qualityScore: 90,
      metrics: [
        m("mean_time_between_failures", "Mean time between failures", "Operating hours between unplanned stoppages for an asset class.", "asset class / month", "hours"),
        m("planned_maintenance_ratio", "Planned maintenance ratio", "Planned maintenance hours as a share of total maintenance hours.", "plant / month", "percent"),
      ],
    },
    {
      key: "supply-chain-flow",
      name: "Supply Chain Flow",
      description:
        "Inbound and outbound flow metrics: delivery reliability, inventory, and lead time.",
      domainKey: "supply-chain",
      owner: "Supply Chain Analytics",
      contractVersion: "2.0.0",
      qualityScore: 92,
      metrics: [
        m("otif_rate", "On time in full", "Orders delivered complete and on the promised date, as a share of orders.", "customer / month", "percent"),
        m("inventory_turns", "Inventory turns", "Cost of goods sold over average inventory value for the period.", "site / quarter", "ratio"),
        m("inbound_lead_time", "Inbound lead time", "Days from purchase order to goods received, by supplier.", "supplier / month", "days"),
      ],
    },
    {
      key: "safety-incidents",
      name: "Safety Incidents",
      description:
        "Injury, near-miss, and corrective-action metrics across sites.",
      domainKey: "safety",
      owner: "EHS Analytics",
      contractVersion: "1.2.0",
      qualityScore: 94,
      sensitivity: "CONFIDENTIAL",
      metrics: [
        m("recordable_incident_rate", "Recordable incident rate", "Recordable injuries per two hundred thousand hours worked.", "site / month", "rate"),
        m("near_miss_rate", "Near miss rate", "Reported near misses per hundred employees, a leading indicator.", "site / month", "rate"),
      ],
    },
    {
      key: "supplier-quality",
      name: "Supplier Quality",
      description:
        "Incoming quality and delivery conformance by supplier and part.",
      domainKey: "quality",
      owner: "Supplier Quality",
      contractVersion: "1.1.0",
      qualityScore: 89,
      metrics: [
        m("ppm_defect_rate", "PPM defect rate", "Defective parts per million received, by supplier.", "supplier / month", "rate"),
        m("supplier_on_time_delivery", "Supplier on-time delivery", "Share of supplier deliveries received within the agreed window.", "supplier / month", "percent"),
      ],
    },
    {
      key: "capacity-and-scheduling",
      name: "Capacity & Scheduling",
      description:
        "Schedule adherence, changeover, and utilisation metrics by line.",
      domainKey: "production",
      owner: "Production Planning",
      contractVersion: "1.3.0",
      qualityScore: 88,
      metrics: [
        m("schedule_adherence", "Schedule adherence", "Share of scheduled orders completed in the planned sequence and period.", "line / week", "percent"),
        m("changeover_time", "Changeover time", "Median minutes lost to changeover between product runs.", "line / week", "minutes"),
      ],
    },
    {
      key: "warranty-and-returns",
      name: "Warranty & Returns",
      description:
        "Field failure, warranty claim, and cost metrics traced back to build data.",
      domainKey: "quality",
      owner: "Quality Engineering",
      contractVersion: "1.0.0",
      qualityScore: 86,
      metrics: [
        m("warranty_claim_rate", "Warranty claim rate", "Claims per thousand units shipped, by product and build period.", "product / month", "rate"),
        m("cost_per_claim", "Cost per claim", "Average settled cost of a warranty claim, including logistics.", "product / quarter", "currency"),
      ],
    },
    {
      key: "energy-and-utilities-use",
      name: "Energy & Utilities Use",
      description:
        "Energy, water, and waste intensity per unit produced, by site and line.",
      domainKey: "production",
      owner: "Site Sustainability",
      contractVersion: "1.0.0",
      qualityScore: 85,
      freshnessSlaHours: 168,
      metrics: [
        m("energy_per_unit", "Energy per unit", "Energy consumed per unit of saleable output.", "line / month", "kWh"),
        m("waste_to_landfill", "Waste to landfill", "Production waste sent to landfill as a share of total waste.", "site / month", "percent"),
      ],
    },
  ],

  "public-sector": [
    {
      key: "benefit-payments",
      name: "Benefit Payments",
      description:
        "Payment accuracy, timeliness, and recovery metrics across benefit schemes.",
      domainKey: "payments-and-benefits",
      owner: "Payments Assurance",
      contractVersion: "2.1.0",
      qualityScore: 94,
      sensitivity: "RESTRICTED",
      metrics: [
        m("payment_accuracy_rate", "Payment accuracy rate", "Share of payments made at the correct entitlement, by scheme.", "scheme / month", "percent"),
        m("overpayment_recovery_rate", "Overpayment recovery rate", "Share of identified overpayment value recovered within twelve months.", "scheme / quarter", "percent"),
      ],
    },
    {
      key: "contact-and-channels",
      name: "Contact & Channels",
      description:
        "Demand, wait, and resolution metrics across phone, digital, and face-to-face contact.",
      domainKey: "service-delivery",
      owner: "Service Analytics",
      contractVersion: "1.3.0",
      qualityScore: 88,
      metrics: [
        m("first_contact_resolution", "First contact resolution", "Share of enquiries resolved without a follow-up contact.", "channel / week", "percent"),
        m("average_wait_time", "Average wait time", "Mean minutes a citizen waits before being served, by channel.", "channel / week", "minutes"),
      ],
    },
    {
      key: "workforce-capacity",
      name: "Workforce Capacity",
      description:
        "Caseload, vacancy, and training metrics for frontline and casework teams.",
      domainKey: "workforce",
      owner: "Workforce Planning",
      contractVersion: "1.1.0",
      qualityScore: 87,
      sensitivity: "CONFIDENTIAL",
      metrics: [
        m("caseload_per_officer", "Caseload per officer", "Open cases per full-time equivalent caseworker.", "team / month", "count"),
        m("staff_vacancy_rate", "Staff vacancy rate", "Funded posts unfilled at period end, by service area.", "service / month", "percent"),
      ],
    },
    {
      key: "policy-impact",
      name: "Policy Impact",
      description:
        "Programme outcome and cost-per-outcome metrics used in policy evaluation.",
      domainKey: "policy-analysis",
      owner: "Policy Analysis",
      contractVersion: "1.0.0",
      qualityScore: 83,
      freshnessSlaHours: 720,
      metrics: [
        m("programme_outcome_rate", "Programme outcome rate", "Share of participants achieving the stated programme outcome within the window.", "programme / quarter", "percent"),
        m("cost_per_outcome", "Cost per outcome", "Total programme cost over outcomes achieved.", "programme / quarter", "currency"),
      ],
    },
    {
      key: "appeals-and-complaints",
      name: "Appeals & Complaints",
      description:
        "Appeal, review, and complaint metrics, with the decisions they overturned.",
      domainKey: "casework",
      owner: "Casework Quality",
      contractVersion: "1.2.0",
      qualityScore: 90,
      sensitivity: "CONFIDENTIAL",
      metrics: [
        m("appeal_overturn_rate", "Appeal overturn rate", "Share of appealed decisions overturned at first-tier review.", "scheme / quarter", "percent"),
        m("complaint_response_days", "Complaint response days", "Working days from complaint receipt to substantive response.", "service / month", "days"),
      ],
    },
    {
      key: "digital-services",
      name: "Digital Services",
      description:
        "Completion, assisted-digital, and accessibility metrics for online services.",
      domainKey: "service-delivery",
      owner: "Digital Service Analytics",
      contractVersion: "1.1.0",
      qualityScore: 86,
      metrics: [
        m("digital_completion_rate", "Digital completion rate", "Share of started online transactions completed without assistance.", "service / week", "percent"),
        m("assisted_digital_share", "Assisted digital share", "Share of transactions completed with staff assistance.", "service / week", "percent"),
      ],
    },
    {
      key: "procurement-and-spend",
      name: "Procurement & Spend",
      description:
        "Supplier spend, concentration, and contract compliance metrics.",
      domainKey: "policy-analysis",
      owner: "Commercial Analytics",
      contractVersion: "1.0.0",
      qualityScore: 85,
      freshnessSlaHours: 168,
      metrics: [
        m("supplier_concentration", "Supplier concentration", "Share of category spend with the three largest suppliers.", "category / quarter", "percent"),
        m("contract_compliance_rate", "Contract compliance rate", "Share of spend placed against a compliant contract route.", "category / quarter", "percent"),
      ],
    },
  ],

  "retail-cpg": [
    {
      key: "store-operations-360",
      name: "Store Operations 360",
      description:
        "Labour, shrink, and execution metrics across the store estate.",
      domainKey: "store-operations",
      owner: "Store Operations Analytics",
      contractVersion: "1.4.0",
      qualityScore: 89,
      metrics: [
        m("labour_hours_per_sale", "Labour hours per sale", "Rostered hours per thousand units sold, by store format.", "store / week", "hours"),
        m("shrink_rate", "Shrink rate", "Unaccounted stock loss as a share of retail value.", "store / month", "percent"),
      ],
    },
    {
      key: "ecommerce-funnel",
      name: "Ecommerce Funnel",
      description:
        "Traffic, conversion, and basket metrics across digital storefronts.",
      domainKey: "ecommerce",
      owner: "Digital Commerce Analytics",
      contractVersion: "2.0.0",
      qualityScore: 91,
      freshnessSlaHours: 6,
      metrics: [
        m("conversion_rate", "Conversion rate", "Sessions ending in a completed order, as a share of sessions.", "channel / day", "percent"),
        m("basket_abandonment_rate", "Basket abandonment rate", "Baskets created but not converted within the session window.", "channel / day", "percent"),
      ],
    },
    {
      key: "loyalty-and-crm",
      name: "Loyalty & CRM",
      description:
        "Membership, repeat purchase, and campaign response metrics.",
      domainKey: "customer-loyalty",
      owner: "Customer Analytics",
      contractVersion: "1.3.0",
      qualityScore: 88,
      sensitivity: "CONFIDENTIAL",
      metrics: [
        m("repeat_purchase_rate", "Repeat purchase rate", "Share of members purchasing again within ninety days.", "segment / month", "percent"),
        m("loyalty_penetration", "Loyalty penetration", "Share of sales identified to a loyalty member.", "store / month", "percent"),
      ],
    },
    {
      key: "pricing-and-promotions",
      name: "Pricing & Promotions",
      description:
        "Promotional lift, funding, and margin impact by mechanic and category.",
      domainKey: "merchandising",
      owner: "Pricing Analytics",
      contractVersion: "1.2.0",
      qualityScore: 87,
      metrics: [
        m("promotion_roi", "Promotion ROI", "Incremental margin over promotional investment for a mechanic.", "campaign", "ratio"),
        m("price_index", "Price index", "Basket price relative to the named competitor set.", "category / week", "index"),
      ],
    },
    {
      key: "assortment-and-space",
      name: "Assortment & Space",
      description:
        "Range productivity and space allocation metrics by category and format.",
      domainKey: "merchandising",
      owner: "Category Management",
      contractVersion: "1.1.0",
      qualityScore: 86,
      freshnessSlaHours: 168,
      metrics: [
        m("range_productivity", "Range productivity", "Sales per linear metre of shelf, by category and format.", "category / month", "currency"),
        m("sku_rationalisation_rate", "SKU rationalisation rate", "Share of listed SKUs contributing below the tail threshold.", "category / quarter", "percent"),
      ],
    },
    {
      key: "fulfilment-and-delivery",
      name: "Fulfilment & Delivery",
      description:
        "Pick, pack, and last-mile metrics for online and wholesale orders.",
      domainKey: "supply-chain",
      owner: "Fulfilment Analytics",
      contractVersion: "1.2.0",
      qualityScore: 90,
      metrics: [
        m("on_time_delivery", "On-time delivery", "Orders delivered within the promised slot, as a share of orders.", "network / week", "percent"),
        m("cost_per_order", "Cost per order", "Fully loaded fulfilment cost per delivered order.", "network / month", "currency"),
      ],
    },
    {
      key: "returns-and-reverse",
      name: "Returns & Reverse Logistics",
      description:
        "Return rate, reason, and recovery metrics across channels.",
      domainKey: "ecommerce",
      owner: "Returns Analytics",
      contractVersion: "1.0.0",
      qualityScore: 84,
      metrics: [
        m("return_rate", "Return rate", "Units returned as a share of units sold, by category and channel.", "category / month", "percent"),
        m("resale_recovery_rate", "Resale recovery rate", "Value recovered from returned stock as a share of original retail.", "category / quarter", "percent"),
      ],
    },
  ],

  telecom: [
    {
      key: "service-assurance-360",
      name: "Service Assurance 360",
      description:
        "Fault, restoration, and repeat-issue metrics across consumer and enterprise services.",
      domainKey: "service-assurance",
      owner: "Assurance Analytics",
      contractVersion: "1.5.0",
      qualityScore: 91,
      metrics: [
        m("mean_time_to_restore", "Mean time to restore", "Hours from fault raised to service restored, by fault class.", "fault class / week", "hours"),
        m("repeat_fault_rate", "Repeat fault rate", "Share of services faulting again within thirty days of restoration.", "region / month", "percent"),
      ],
    },
    {
      key: "broadband-experience",
      name: "Broadband Experience",
      description:
        "Throughput, latency, and congestion metrics for fixed broadband services.",
      domainKey: "fixed-broadband",
      owner: "Network Experience",
      contractVersion: "2.0.0",
      qualityScore: 93,
      freshnessSlaHours: 6,
      metrics: [
        m("average_throughput", "Average throughput", "Median downstream throughput during peak hours.", "exchange / day", "Mbps"),
        m("congestion_hours", "Congestion hours", "Hours per week a node exceeds the congestion threshold.", "node / week", "hours"),
      ],
    },
    {
      key: "enterprise-contracts",
      name: "Enterprise Contracts",
      description:
        "SLA attainment, credit exposure, and renewal metrics for enterprise accounts.",
      domainKey: "enterprise-accounts",
      owner: "Enterprise Analytics",
      contractVersion: "1.2.0",
      qualityScore: 90,
      sensitivity: "CONFIDENTIAL",
      metrics: [
        m("sla_attainment", "SLA attainment", "Share of contracted service levels met in the period.", "account / month", "percent"),
        m("contract_renewal_rate", "Contract renewal rate", "Share of contract value renewed at expiry.", "segment / quarter", "percent"),
      ],
    },
    {
      key: "churn-and-retention",
      name: "Churn & Retention",
      description:
        "Disconnection, save, and win-back metrics across consumer subscriptions.",
      domainKey: "consumer-mobile",
      owner: "Retention Analytics",
      contractVersion: "1.6.0",
      qualityScore: 92,
      sensitivity: "CONFIDENTIAL",
      metrics: [
        m("monthly_churn_rate", "Monthly churn rate", "Disconnections as a share of the opening subscriber base.", "segment / month", "percent"),
        m("save_rate", "Save rate", "Share of cancellation attempts retained after a save offer.", "segment / month", "percent"),
      ],
    },
    {
      key: "device-and-upgrade",
      name: "Device & Upgrade",
      description:
        "Upgrade behaviour, device margin, and trade-in metrics.",
      domainKey: "consumer-mobile",
      owner: "Device Analytics",
      contractVersion: "1.1.0",
      qualityScore: 87,
      metrics: [
        m("upgrade_take_rate", "Upgrade take rate", "Share of eligible subscribers upgrading within the window.", "segment / month", "percent"),
        m("device_margin", "Device margin", "Margin per device sold after subsidy and trade-in.", "device / month", "currency"),
      ],
    },
    {
      key: "field-installations",
      name: "Field Installations",
      description:
        "Provisioning, appointment, and first-time-right metrics for installs.",
      domainKey: "service-assurance",
      owner: "Field Operations",
      contractVersion: "1.0.0",
      qualityScore: 88,
      metrics: [
        m("install_first_time_right", "Install first time right", "Installs completed on the first visit with service confirmed working.", "region / week", "percent"),
        m("provisioning_lead_time", "Provisioning lead time", "Working days from order to service activation.", "product / month", "days"),
      ],
    },
    {
      key: "spectrum-and-capacity",
      name: "Spectrum & Capacity",
      description:
        "Cell utilisation and capacity headroom metrics used in network planning.",
      domainKey: "network-performance",
      owner: "Network Planning",
      contractVersion: "1.3.0",
      qualityScore: 94,
      freshnessSlaHours: 12,
      metrics: [
        m("cell_utilisation", "Cell utilisation", "Peak-hour resource block utilisation for a cell.", "cell / day", "percent"),
        m("capacity_headroom", "Capacity headroom", "Forecast months until a cell breaches its capacity threshold.", "cell / month", "months"),
      ],
    },
  ],

  _generic: [
    {
      key: "customer-360",
      name: "Customer 360",
      description:
        "Conformed customer view with certified activity, retention, and value metrics.",
      domainKey: "customer",
      owner: "Customer Analytics",
      contractVersion: "1.2.0",
      qualityScore: 90,
      sensitivity: "CONFIDENTIAL",
      metrics: [
        m("active_customers", "Active customers", "Customers with a qualifying interaction in the trailing ninety days.", "segment / month", "count"),
        m("customer_churn_rate", "Customer churn rate", "Share of active customers who lapse in the period.", "segment / month", "percent"),
      ],
    },
    {
      key: "workforce-capacity",
      name: "Workforce Capacity",
      description:
        "Utilisation, attrition, and capacity metrics for delivery teams.",
      domainKey: "workforce",
      owner: "People Analytics",
      contractVersion: "1.1.0",
      qualityScore: 87,
      sensitivity: "CONFIDENTIAL",
      metrics: [
        m("utilisation_rate", "Utilisation rate", "Billable or productive hours as a share of available hours.", "team / month", "percent"),
        m("attrition_rate", "Attrition rate", "Leavers as a share of average headcount, annualised.", "team / quarter", "percent"),
      ],
    },
    {
      key: "service-quality",
      name: "Service Quality",
      description:
        "Service level, incident, and resolution metrics across operational services.",
      domainKey: "operations",
      owner: "Service Management",
      contractVersion: "1.3.0",
      qualityScore: 89,
      metrics: [
        m("sla_attainment", "SLA attainment", "Share of service levels met in the period.", "service / month", "percent"),
        m("incident_rate", "Incident rate", "Incidents raised per thousand transactions.", "service / month", "rate"),
      ],
    },
    {
      key: "cost-to-serve",
      name: "Cost to Serve",
      description:
        "Unit economics by product, channel, and segment, reconciled to the ledger.",
      domainKey: "finance",
      owner: "Finance Analytics",
      contractVersion: "1.2.0",
      qualityScore: 91,
      sensitivity: "CONFIDENTIAL",
      freshnessSlaHours: 168,
      metrics: [
        m("cost_per_transaction", "Cost per transaction", "Fully loaded cost per completed transaction, by channel.", "channel / month", "currency"),
        m("contribution_margin", "Contribution margin", "Revenue less variable cost, as a share of revenue.", "segment / month", "percent"),
      ],
    },
    {
      key: "demand-and-pipeline",
      name: "Demand & Pipeline",
      description:
        "Pipeline, conversion, and forecast accuracy metrics for commercial planning.",
      domainKey: "customer",
      owner: "Commercial Analytics",
      contractVersion: "1.0.0",
      qualityScore: 85,
      metrics: [
        m("pipeline_conversion", "Pipeline conversion", "Share of qualified pipeline converting to closed business.", "segment / quarter", "percent"),
        m("forecast_accuracy", "Forecast accuracy", "Absolute error between forecast and actual, as a share of actual.", "segment / month", "percent"),
      ],
    },
    {
      key: "supplier-performance",
      name: "Supplier Performance",
      description:
        "Delivery, quality, and dispute metrics across the supplier base.",
      domainKey: "operations",
      owner: "Procurement Analytics",
      contractVersion: "1.1.0",
      qualityScore: 86,
      metrics: [
        m("supplier_on_time_rate", "Supplier on-time rate", "Deliveries received within the agreed window, as a share of deliveries.", "supplier / month", "percent"),
        m("dispute_rate", "Dispute rate", "Invoices disputed as a share of invoices received.", "supplier / month", "percent"),
      ],
    },
    {
      key: "compliance-register",
      name: "Compliance Register",
      description:
        "Control testing and remediation metrics across the compliance framework.",
      domainKey: "finance",
      owner: "Risk & Compliance",
      contractVersion: "1.0.0",
      qualityScore: 92,
      sensitivity: "CONFIDENTIAL",
      freshnessSlaHours: 168,
      metrics: [
        m("control_pass_rate", "Control pass rate", "Share of tested controls passing without exception.", "framework / quarter", "percent"),
        m("overdue_actions", "Overdue actions", "Remediation actions past their committed date.", "framework / month", "count"),
      ],
    },
  ],
};

let total = 0;
for (const [pack, products] of Object.entries(PACKS)) {
  const file = path.join(ROOT, "packs", pack, "pack.yaml");
  const source = readFileSync(file, "utf8");

  const marker = "\nstarterAgents:";
  const at = source.indexOf(marker);
  if (at === -1) throw new Error(`${pack}: no starterAgents block to insert before`);

  const existing = new Set([...source.matchAll(/^- key: (.+)$/gm)].map((match) => match[1]));
  const fresh = products.filter((product) => !existing.has(product.key));
  if (fresh.length === 0) {
    console.info(`${pack}: already expanded`);
    continue;
  }

  const block = fresh.map(render).join("\n");
  writeFileSync(file, `${source.slice(0, at)}\n${block}${source.slice(at)}`);
  total += fresh.length;
  console.info(`${pack}: +${fresh.length} data products`);
}
console.info(`\n${total} data products added.`);
