import Link from "next/link";

import { PrismaClient } from "@prisma/client";

import { Band, Muted, Panel, SectionTitle } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/status";
import { PLAN_FEATURES } from "@/lib/plans/features";

const db = new PrismaClient();

/**
 * The landing page.
 *
 * One line of positioning, then the demo — because the STALE flip and the
 * evidence pack do in 150 seconds what a 40-slide governance deck cannot. The
 * three proof panels are the three things nothing else on the market does, in
 * the order they land.
 */
export default async function LandingPage() {
  const showcase = await db.organization.findFirst({
    where: { isShowcase: true },
    select: { id: true, name: true },
  });

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-brand-primary text-surface">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-6">
          <span className="text-lg font-semibold tracking-tight">AMX</span>
          <nav className="ml-auto flex items-center gap-4">
            <Link href="/catalog" className="text-surface no-underline">
              Agent catalog
            </Link>
            <Link href="/signin" className="text-surface no-underline">
              Sign in
            </Link>
            <Link
              href="/onboarding"
              className="rounded bg-brand-deep px-3 py-1.5 text-surface no-underline"
            >
              Open a workspace
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="bg-panel">
          <div className="mx-auto w-full max-w-6xl px-6 py-16">
            <p className="text-xs font-medium uppercase tracking-wide text-brand-deep">
              The system of record for enterprise agent trust
            </p>
            <h1 className="mt-3 max-w-4xl text-4xl font-semibold leading-tight">
              Every published agent proves, per question, which certified data product answers it
              — and which human approved it.
            </h1>
            <p className="mt-4 max-w-2xl text-muted">
              Observability tools tell you what an agent did at runtime. Nothing tells you whether
              it was ever fit to publish. AMX makes it structurally impossible to ship an agent
              without naming the persona it serves, the questions it answers, the certified data
              beneath it, and the people who approved every design choice.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              {showcase ? (
                <Link
                  href="/demo"
                  prefetch={false}
                  className="inline-flex h-12 items-center rounded bg-brand-primary px-6 font-medium text-surface no-underline hover:bg-brand-deep"
                >
                  Explore the live demo
                </Link>
              ) : null}
              <Link
                href="/catalog"
                className="inline-flex h-12 items-center rounded border border-brand-primary px-6 font-medium no-underline hover:bg-band"
              >
                Browse the agent catalog
              </Link>
              <Link
                href="/onboarding"
                className="inline-flex h-12 items-center rounded border border-brand-primary px-6 font-medium no-underline hover:bg-band"
              >
                Open a workspace
              </Link>
              <span className="text-muted">
                No account, no email, no card — a seeded workspace in one click.
              </span>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 py-16">
          <SectionTitle>Three things nothing else does</SectionTitle>
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            <Panel>
              <Badge tone="brand">Question trace</Badge>
              <p className="mt-3 font-medium">
                Per question: the certified metric, and the data product it came from.
              </p>
              <p className="mt-2 text-muted">
                Not a tag on an agent — a row per question, with the metric that answers it. An
                agent cannot leave Stage 3 until every question has one.
              </p>
            </Panel>
            <Panel>
              <Badge tone="warning">STALE cascade</Badge>
              <p className="mt-3 font-medium">
                A bound product bumps a major version; dependent certifications go stale, live.
              </p>
              <p className="mt-2 text-muted">
                Each binding pins the contract version it was approved against, so invalidation is
                a comparison rather than a guess — and the re-approval tasks appear with it.
              </p>
            </Panel>
            <Panel>
              <Badge tone="success">Evidence pack</Badge>
              <p className="mt-3 font-medium">
                A signed pack: charter, bindings, coverage, evaluation, approvals, audit chain.
              </p>
              <p className="mt-2 text-muted">
                Assembled from committed artifact versions with a manifest of content hashes, so a
                reader can verify it instead of trusting it.
              </p>
            </Panel>
          </div>
        </section>

        <section className="bg-band">
          <div className="mx-auto w-full max-w-6xl px-6 py-16">
            <SectionTitle>Pricing</SectionTitle>
            <Muted className="mt-1">
              Priced on published, certified agents — the unit a buyer brags about, not seats.
            </Muted>
            <div className="mt-6 grid gap-5 md:grid-cols-3">
              {(
                [
                  ["FREE", "Free", "One practitioner, start to finish.", "£0"],
                  ["TEAM", "Team", "Peer review, every pack, exports.", "Talk to us"],
                  ["ENTERPRISE", "Enterprise", "SSO, white-label, API, audit export.", "Talk to us"],
                ] as const
              ).map(([tier, name, blurb, price]) => {
                const features = PLAN_FEATURES[tier];
                return (
                  <Panel key={tier} className="bg-surface">
                    <p className="font-medium">{name}</p>
                    <p className="mt-1 text-muted">{blurb}</p>
                    <p className="mt-4 text-page-title">{price}</p>
                    <ul className="mt-4 space-y-1 text-muted">
                      <li>
                        {features.maxAgents === Number.POSITIVE_INFINITY
                          ? "Unlimited agents"
                          : `${features.maxAgents} agents`}
                      </li>
                      <li>{features.peerGates ? "Peer-reviewed gates" : "Solo attestation"}</li>
                      <li>{features.exports ? "All exports" : "Evidence pack preview"}</li>
                      <li>{features.packs === "*" ? "All industry packs" : "Generic pack"}</li>
                      {features.whiteLabel ? <li>White-label theme</li> : null}
                    </ul>
                  </Panel>
                );
              })}
            </div>
            <Band className="mt-6 bg-surface">
              <span className="font-medium">Design partners:</span> we are working with three to
              five organisations to certify agents they have already shipped, and publishing the
              worked examples together. If that is you,{" "}
              <Link href="/onboarding">start a workspace</Link> and tell us.
            </Band>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-6 text-muted">
          AMX · the certification and distribution layer for enterprise agents
        </div>
      </footer>
    </div>
  );
}
