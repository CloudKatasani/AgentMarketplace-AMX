# Deploying AMX and ADE Studio on AWS — architecture and cost

A plan you can hand to a platform team and a finance partner in the same meeting. It covers
what the applications actually need at runtime, the AWS components that meet those needs, three
sized environments with line-by-line monthly cost, the levers that move the number, the code
changes required before the first deploy, and the Azure equivalent.

---

## 0 · Scope, and one assumption stated plainly

**In scope:** two Node/Next.js applications deployed as containers behind one platform —

| Application | What it is | Evidence |
|---|---|---|
| **AMX — Agentic Data Product Management** | This repository. Next.js 15 (App Router, server-rendered), Prisma, Postgres, Auth.js, a read-only `/api/v1`, document generation (PDF/Word/Excel/zip), nine industry packs. | Verified against the code. |
| **ADE Studio** | The companion authoring studio. | **Assumed** to be a Next.js/Node application of similar shape — SSR, the same Postgres, no GPU, no long-running compute. |

That second row is an assumption, and it is the one number in this document I cannot verify from
the repository. It matters for exactly one line item — container compute — and nothing else. If
ADE Studio does anything of the following, tell me and the compute line changes (the rest of the
architecture does not):

- runs model inference in-process → GPU instances or Bedrock, add **$300–3,000/mo**;
- executes user notebooks or arbitrary code → isolated compute (Fargate-per-job or EMR Serverless);
- ingests or transforms large datasets → Glue/EMR and S3 egress, sized separately;
- holds long-lived websockets → different load-balancer and task sizing.

**Out of scope:** the data platform the data products *describe*. AMX registers a reference to a
certified data product — contract version, semantic model version, metrics, owner, freshness. It
does not store or serve the underlying data, so Snowflake/Databricks/Redshift costs are not in
these figures.

**Prices** are approximate **us-east-1 on-demand list prices**, rounded, excluding tax and AWS
Support. They are a planning estimate, not a quote — re-run the
[AWS Pricing Calculator](https://calculator.aws) before committing a budget. Every figure below
is arithmetic you can check: the unit rate and the quantity are both shown.

---

## 1 · What these applications actually need

Read from the code, because sizing guesses that skip this step are how platform teams end up
paying for the wrong thing.

| Requirement | Where it comes from | Consequence for the architecture |
|---|---|---|
| **Server-side rendering on every request** | Next.js App Router; nearly every page is `ƒ (Dynamic)` — tenant-scoped data on each render | Long-running containers, not static hosting. CDN caches assets, not pages. |
| **PostgreSQL** | `prisma/schema.prisma`, `docker-compose.yml`; `pnpm check:postgres` renders 40 tables / 68 indexes on Postgres | RDS PostgreSQL (or Aurora). No enums, no extensions required. |
| **Stateless web tier** | Auth.js JWT sessions — no server-side session store | Horizontal scaling with no sticky sessions. |
| **A writable artifact mirror** | `src/lib/artifacts/commit.ts` writes committed artifact versions to `AMX_PROJECT_DIR` | **Needs a decision** — see §5.2. Multiple tasks each have their own ephemeral disk. |
| **Document generation in-process** | `pdf-lib`, `docx`, `exceljs`, `jszip` — evidence packs, catalogues, bundles | Memory headroom (4 GB tasks), and a worker at scale so a 30-second export does not hold a web task. |
| **Password hashing** | `bcryptjs` at sign-in | CPU spike per sign-in; sized into the vCPU allowance. |
| **Unauthenticated write path** | `/onboarding` mints a guest workspace with no email | **Rate limiting is mandatory** — WAF rate rule plus an application limiter. Named as a gap in `docs/entry-flow.md`. |
| **Bearer-token API** | `/api/v1`, read-only, Enterprise plan only | ALB + WAF is sufficient; no API Gateway needed. |
| **Append-only audit chain** | Hash-chained `AuditEvent` per organisation | Point-in-time recovery matters more than usual: a restore that loses events breaks the chain. |
| **Industry packs** | YAML on disk, validated at load | Baked into the image. No runtime dependency. |
| **Email** | Invitations, stubbed to console today | SES, ~$0.10 per 1,000 messages. |
| **Optional AI assist** | Off by default, user-supplied key | Bedrock only if you enable it server-side; priced separately in §7. |

---

## 2 · Reference architecture

```
                    Route 53  ──►  CloudFront (assets, TLS, geo)  ──►  AWS WAF
                                                                          │
                                          ┌───────────────────────────────┘
                                          ▼
                              Application Load Balancer  (public subnets, 2–3 AZ)
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
            ECS Fargate service   ECS Fargate service   ECS Fargate service
                 AMX web             ADE Studio             worker
                 (2–6 tasks)         (2–4 tasks)         (exports, packs)
                    │                     │                     │
                    └─────────────────────┼─────────────────────┘
                                          │  (private subnets)
        ┌──────────────┬──────────────────┼───────────────┬────────────────┐
        ▼              ▼                  ▼               ▼                ▼
  RDS PostgreSQL  ElastiCache        S3 (artifacts,   Secrets Manager   SES
   Multi-AZ        Redis              evidence packs)  + KMS CMK
   + PITR          (rate limit,       + lifecycle
                    cache)             to IA/Glacier
```

**Why each component is there** — one line each, because a diagram without justification is a
shopping list:

| Component | Why it, specifically |
|---|---|
| **ECS on Fargate** | SSR needs a warm process; Fargate gives that without managing EC2 or a Kubernetes control plane. Two containerised apps is exactly Fargate's sweet spot; EKS earns its $73/mo control plane at roughly ten services, not two. |
| **Application Load Balancer** | Path/host routing between the two apps, native ECS integration, WAF attachment point, TLS termination with a free ACM certificate. |
| **RDS PostgreSQL, Multi-AZ** | The schema is ordinary relational Postgres. Multi-AZ for automatic failover; PITR because the audit chain must not lose links. Aurora Serverless v2 is the alternative — see §6. |
| **ElastiCache Redis** | Distributed rate limiting for the unauthenticated workspace-creation path, plus caching the public catalogue (which is pack-derived and identical for every visitor). |
| **S3** | Artifact mirror, generated evidence packs and exports. Versioned, lifecycle-tiered, presigned URLs for downloads so a 20 MB PDF never streams through a task. |
| **CloudFront** | Static assets and the public `/catalog` pages, which have no session and cache well. Also where you get TLS at the edge and origin shielding. |
| **AWS WAF** | Managed rule sets, and the rate-based rule in front of guest workspace creation. |
| **Secrets Manager + KMS** | `AUTH_SECRET`, `DATABASE_URL`, `ANALYTICS_SALT`, OIDC client secret — injected as ECS task secrets, never baked into an image. Customer-managed key for RDS/S3 encryption when a buyer asks who holds the key. |
| **CloudWatch** | Logs, metrics, alarms. Container Insights for task-level CPU/memory. |
| **SES** | Invitation delivery, replacing the console stub. |
| **ECR** | Image registry, scan-on-push. |

---

## 3 · Three sized environments, line by line

### Tier 1 — Pilot / internal demo · **≈ $186/month**

Single AZ, no HA. Right for a sales-demo deployment, an internal pilot, or a design-partner
environment. ~50 users, low hundreds of workspaces.

| Component | Sizing | Monthly |
|---|---|---:|
| ECS Fargate — AMX | 1 task, 1 vCPU / 2 GB, 730 h | $36.04 |
| ECS Fargate — ADE Studio | 1 task, 1 vCPU / 2 GB | $36.04 |
| Application Load Balancer | base $16.43 + ~2 LCU | $28.11 |
| RDS PostgreSQL | db.t4g.small, single-AZ | $23.36 |
| RDS storage | 50 GB gp3 @ $0.115/GB | $5.75 |
| S3 | 50 GB + requests | $2.15 |
| CloudFront | 100 GB egress + 2M requests | $10.50 |
| AWS WAF | web ACL + 3 managed rule groups + 2M req | $9.20 |
| Secrets Manager | 6 secrets @ $0.40 | $2.40 |
| CloudWatch | 10 GB logs + alarms | $8.00 |
| ECR | 10 GB images | $1.00 |
| Route 53 | 1 zone + queries | $1.00 |
| VPC endpoints (S3, ECR, Secrets) | replaces NAT Gateway | $22.00 |
| **Total** | | **$185.55** |

> **The NAT trap.** A NAT Gateway is $32.85/month *each*, before data processing — often the
> largest line in a small environment. Interface endpoints for ECR, Secrets Manager, CloudWatch
> and a free S3 gateway endpoint cost less and keep traffic off the internet entirely.

### Tier 2 — Production SaaS · **≈ $967/month**

Two AZs, HA, autoscaling. ~2,000 users, low thousands of workspaces, one region.

| Component | Sizing | Monthly |
|---|---|---:|
| ECS Fargate — AMX | 3 tasks, 2 vCPU / 4 GB | $216.24 |
| ECS Fargate — ADE Studio | 2 tasks, 2 vCPU / 4 GB | $144.16 |
| ECS Fargate — export worker | 1 task, 1 vCPU / 2 GB | $36.04 |
| Application Load Balancer | base + ~10 LCU | $74.83 |
| RDS PostgreSQL | db.t4g.medium, **Multi-AZ** | $94.90 |
| RDS storage + backups | 200 GB gp3, mirrored, 7-day PITR | $51.00 |
| ElastiCache Redis | 2 × cache.t4g.micro | $23.36 |
| S3 | 500 GB, lifecycle to IA | $17.00 |
| CloudFront | 1 TB egress + 20M requests | $107.04 |
| NAT Gateway | 2 AZ + 200 GB processed | $74.70 |
| AWS WAF | web ACL + 6 rules + 20M req | $23.00 |
| KMS | 2 customer-managed keys + requests | $6.00 |
| Secrets Manager | 10 secrets | $4.00 |
| CloudWatch | 100 GB logs, metrics, dashboards | $68.00 |
| SES | 50,000 emails | $5.00 |
| ECR + CI build minutes | | $22.00 |
| **Total** | | **$967.27** |
| *with a 1-year Compute Savings Plan* | ~28% off Fargate | *$856* |

### Tier 3 — Enterprise / regulated · **≈ $3,139/month**

Three AZs, cross-region DR, the security services a regulated buyer's questionnaire asks about.
Tens of thousands of users, one region live plus a warm standby.

| Component | Sizing | Monthly |
|---|---|---:|
| ECS Fargate — AMX | 6 tasks, 2 vCPU / 4 GB | $432.48 |
| ECS Fargate — ADE Studio | 4 tasks, 2 vCPU / 4 GB | $288.32 |
| ECS Fargate — workers | 2 tasks, 2 vCPU / 4 GB | $144.16 |
| Application Load Balancer | base + ~25 LCU | $162.43 |
| RDS PostgreSQL | db.m6g.large, Multi-AZ | $235.79 |
| RDS storage + backups | 500 GB gp3, mirrored, 35-day PITR | $130.00 |
| RDS read replica | reporting and `/api/v1` reads | $117.90 |
| ElastiCache Redis | 2 × cache.m6g.large | $210.00 |
| S3 | 2 TB + versioning + Glacier IR archive | $76.00 |
| CloudFront | 3 TB egress + 100M requests | $361.12 |
| NAT Gateway | 3 AZ + 1 TB processed | $143.55 |
| AWS WAF | web ACL + 10 rules + 100M req | $75.00 |
| GuardDuty, Security Hub, Config, CloudTrail data events | | $200.00 |
| KMS | 5 CMKs + high request volume | $25.00 |
| Secrets Manager + Parameter Store | | $12.00 |
| CloudWatch | 500 GB logs (tiered), metrics, X-Ray | $300.00 |
| Cross-region DR | snapshot copy, S3 replication, warm standby | $165.00 |
| SES + ECR + CodePipeline | | $60.00 |
| **Total** | | **$3,138.75** |
| *with a 1-year Compute Savings Plan* | ~28% off Fargate | *$2,897* |

### Summary

| | Pilot | Production | Enterprise |
|---|---:|---:|---:|
| Monthly (on-demand) | **$186** | **$967** | **$3,139** |
| Monthly (1-yr Savings Plan) | $165 | $856 | $2,897 |
| Annual | $2,227 | $11,607 | $37,665 |
| AWS Business Support (+10% / 7%) | +$100 (minimum) | +$100 | +$314 |
| Availability target | best effort | 99.9% | 99.95% |
| RPO / RTO | 24 h / 4 h | 5 min / 1 h | 5 min / 15 min |

---

## 4 · Unit economics

The number that matters to a SaaS P&L is not the monthly bill; it is the bill divided by what it
carries.

| Tier | Monthly | Active workspaces | **Cost per workspace** |
|---|---:|---:|---:|
| Pilot | $186 | 50 | $3.72 |
| Production | $967 | 500 | $1.93 |
| Production | $967 | 2,000 | **$0.48** |
| Enterprise | $3,139 | 5,000 | $0.63 |

Two things follow. Infrastructure is not what makes this product expensive to run — at
production scale it is well under a dollar per workspace per month, which means the FREE tier is
affordable and the pricing conversation is about value, not cost recovery. And the fixed floor
(~$400/month of ALB, NAT, RDS, WAF and baseline tasks) dominates below a few hundred workspaces,
which is the real argument for putting pilots on the serverless-lean variant in §6.

---

## 5 · Work required before the first deploy

Honest engineering, not configuration. Each item is small; none is optional.

### 5.1 Container build
Add `output: "standalone"` to `next.config.ts` and build a multi-stage image on `node:22-slim`.
Without it the runtime image carries the full `node_modules` — roughly 400 MB instead of ~150 MB,
which is slower to pull on every task start. Run `prisma generate` at build time and copy the
engine into the runtime layer.

### 5.2 The artifact mirror — a decision, not a default
`src/lib/artifacts/commit.ts` writes every committed artifact version to the local filesystem
under `AMX_PROJECT_DIR`. With more than one task, each task writes to its own ephemeral disk and
the mirrors diverge. The database is the record of truth, so this is a convenience feature, and
there are three honest options:

| Option | Change | Cost | Verdict |
|---|---|---|---|
| **S3 adapter** | Small: put a storage interface behind the existing write | $2–76/mo | **Recommended.** Durable, versioned, presignable for download. |
| **EFS mount** | None — mount at `AMX_PROJECT_DIR` | $0.30/GB-mo (~$6–20) | Works today with zero code change. Slower, and a shared writable filesystem is a thing a security review will ask about. |
| **Disable in production** | One environment flag | $0 | Defensible — the DB is authoritative — but you lose the diff-on-disk convenience. |

### 5.3 Postgres, for real
`pnpm check:postgres` proves the schema *renders* on PostgreSQL; it has never been *run* there.
Before production: point `DATABASE_URL` at RDS, run the full Vitest and Playwright suites, and
load-test the guest-signup path — a single signup now seeds five agents, nine or ten data
products and their metrics, which is a burst of writes worth watching. Budget two days. Add
**RDS Proxy** (~$22/mo at t4g.medium) if connection counts climb; Prisma opens a pool per task.

### 5.4 Rate limiting on the open door
`/onboarding` creates a workspace with no account, which is one click for a person and one click
for a script. Two layers: a WAF rate-based rule (e.g. 20 requests / 5 min / IP) at the edge, and
a Redis token bucket in the application keyed by IP and by fingerprint. This is already recorded
as an open gap in `docs/entry-flow.md`.

### 5.5 Operational plumbing
- **Health check** — add `GET /api/health` returning 200 with a database round-trip; the ALB
  target group needs it and there is no such route today.
- **Migrations** — run `prisma migrate deploy` as a one-off ECS task in the deploy pipeline,
  before the new task set takes traffic. Never on container start: ten tasks racing the same
  migration is a bad afternoon.
- **Secrets** — `AUTH_SECRET`, `DATABASE_URL`, `ANALYTICS_SALT`, `AMX_OIDC_CLIENT_SECRET` as ECS
  `secrets`, not `environment`.
- **Session cookies** — set `AUTH_URL` and `AUTH_TRUST_HOST` to the public origin.
- **Exports off the request path** — evidence-pack generation is synchronous today. At Tier 2+,
  publish a job to SQS, generate in the worker, store in S3, hand back a presigned URL.
- **Graceful shutdown** — handle `SIGTERM`, drain in-flight requests, and set the ALB
  deregistration delay to 30 s.
- **Seed** — `pnpm seed` is idempotent; run it once per environment as a one-off task.

---

## 6 · Cheaper and simpler variants

### Serverless-lean pilot — **≈ $95–140/month**
Aurora Serverless v2 with scale-to-zero (~$25/mo at pilot duty cycle) + AWS App Runner (~$57/app
at full duty, includes TLS and a load balancer) or Amplify Hosting (~$21/app at 100 GB). No ALB,
no NAT, no Redis. Trade-offs: cold starts on Aurora resume, less control over networking, and
App Runner has no request-level WAF attachment.

### Levers, ranked by how much they move the number

| Lever | Saving | Cost of the lever |
|---|---|---|
| Compute Savings Plan (1 yr, no upfront) | ~28% of Fargate | 1-year commitment |
| Fargate Spot for workers and non-prod | ~70% of those tasks | Tasks can be reclaimed with 2 min notice |
| VPC endpoints instead of NAT | $33–99/mo | ~$22/mo of endpoints |
| Aurora Serverless v2 (scale-to-zero) for non-prod | $23–95/mo per environment | Resume latency |
| CloudWatch log tiering + 14-day retention | 40–60% of the logs line | Shorter forensic window |
| Scheduled scale-to-zero for dev/test (nights, weekends) | ~65% of non-prod compute | Requires a scheduler |
| Graviton (`db.t4g`/`m6g`) — already assumed above | ~20% vs x86 | None |
| CloudFront caching for `/catalog` | Cuts SSR task count | Cache invalidation on pack changes |

### What is deliberately *not* in these numbers
Snowflake/Databricks or any underlying data platform; Bedrock or other model inference; AWS
Shield Advanced (**$3,000/mo**, only if you face a named DDoS threat); Business/Enterprise
Support; data transfer between regions beyond the DR line; taxes; and the first-12-months AWS
free tier, which will make early bills lower than shown.

---

## 7 · If you enable server-side AI assist

AMX ships AI assist propose-only, off by default, with a user-supplied key. If you instead run it
centrally on Bedrock, add a usage line — roughly, at Claude Sonnet-class pricing and ~4k input /
1k output tokens per proposal:

| Proposals / month | Approximate Bedrock cost |
|---:|---:|
| 1,000 | $20–30 |
| 10,000 | $200–300 |
| 100,000 | $2,000–3,000 |

It stays a variable line that scales with adoption, and it never touches the governance path —
AI assist cannot call `recordDecision()` by construction.

---

## 8 · Azure equivalent

Same architecture, different nouns. Azure list prices run within roughly ±10% of AWS for this
shape of workload; the material difference is that Azure Container Apps includes a free tier and
scale-to-zero, which makes the *pilot* tier cheaper, while egress and managed Postgres land close
to parity at production scale.

| AWS | Azure | Note |
|---|---|---|
| ECS on Fargate | Azure Container Apps | Container Apps scales to zero; good for pilot and non-prod. |
| Application Load Balancer | Application Gateway (v2) + WAF | WAF is integrated rather than separate. |
| RDS PostgreSQL Multi-AZ | Azure Database for PostgreSQL Flexible Server, zone-redundant HA | Comparable pricing; Burstable → General Purpose tiers. |
| ElastiCache Redis | Azure Cache for Redis | |
| S3 | Blob Storage (Hot/Cool/Archive) | |
| CloudFront | Azure Front Door | Front Door Standard bundles WAF and CDN. |
| Secrets Manager + KMS | Key Vault | One service instead of two; cheaper per secret. |
| CloudWatch | Azure Monitor + Log Analytics | Log Analytics ingestion is the line to watch, as with CloudWatch. |
| SES | Azure Communication Services (Email) | |
| ECR | Azure Container Registry | |
| Cognito / Auth.js | Entra ID (External ID) | Only if you replace Auth.js; the OIDC provider in `src/lib/auth/sso.ts` already accepts Entra as an issuer. |
| GuardDuty / Security Hub | Microsoft Defender for Cloud | |

Rough Azure equivalents: pilot **$120–170**, production **$900–1,050**, enterprise
**$2,900–3,400** per month.

---

## 9 · Rollout plan

| Phase | Duration | Output |
|---|---|---|
| **1 · Containerise** | 3–5 days | Standalone Dockerfile, health endpoint, ECR repo, image scanning, local compose parity. |
| **2 · Postgres** | 2–3 days | RDS provisioned, migrations run as a task, full test suite green against Postgres, load test on guest signup. |
| **3 · Landing zone** | 3–5 days | Terraform/CDK: VPC, subnets, endpoints, ALB, ECS cluster, IAM task roles, Secrets, KMS. |
| **4 · Pilot live** | 2–3 days | Tier 1 environment, CI/CD to it, smoke run of the Playwright suite against the deployed URL. |
| **5 · Production hardening** | 1–2 weeks | Multi-AZ, autoscaling policies, WAF rules, rate limiting, S3 artifact adapter, worker + SQS, alarms, runbooks. |
| **6 · Enterprise add-ons** | as required | Cross-region DR, GuardDuty/Config, CMK, PrivateLink, VPC-only deployment for a buyer who demands it. |

**Total to production: roughly four to six weeks of one platform engineer**, alongside the
application work in §5.

---

## 10 · Assumptions, so the numbers can be argued with

1. **us-east-1, on-demand list prices**, no enterprise discount programme (EDP), no free tier.
2. **ADE Studio is a Next.js/Node app of similar shape to AMX** — see §0. This affects the
   compute line only.
3. Traffic: pilot ~2M requests/month, production ~20M, enterprise ~100M, with CDN offload of
   static assets at 70%+.
4. Egress: pilot 100 GB, production 1 TB, enterprise 3 TB per month.
5. Database: 50 / 200 / 500 GB. AMX stores artifacts, audit events and telemetry — text, not
   blobs — so growth is roughly linear in agents and approvals.
6. Evidence packs and exports live in S3, not in the database.
7. All tasks run 730 h/month (no scheduled scale-down). Non-prod environments are *not* included;
   a dev + staging pair on the serverless-lean pattern adds roughly $150–250/month.
8. Prices are as of the author's knowledge in mid-2026 and AWS changes them; verify before
   committing.
