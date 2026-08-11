import Link from "next/link";

import { PublicShell } from "@/components/public-shell";
import { Button } from "@/components/ui/button";
import { Muted, PageTitle, Panel, SectionTitle } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/status";
import { catalogIndustries } from "@/lib/packs/catalog";

export const metadata = {
  title: "Agent catalog by industry · AMX",
  description:
    "Every agent, persona, question and certified data product AMX ships per industry — readable without an account.",
};

/**
 * The agent catalogue, by industry, open to anyone.
 *
 * No sign-in, no email, no workspace. Someone evaluating AMX wants to know what
 * it would put in front of *their* analysts on day one, and that answer lives
 * in the industry packs, which contain nothing tenant-specific. Making them
 * read them behind a sign-up form would be asking for a commitment before
 * showing the thing being committed to.
 */
export default function CatalogIndexPage() {
  const industries = catalogIndustries();

  return (
    <PublicShell>
      <section className="bg-panel">
        <div className="mx-auto w-full max-w-6xl px-6 py-14">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-deep">
            Agent catalog
          </p>
          <PageTitle className="mt-2 max-w-3xl">
            What AMX would put in front of your analysts on day one
          </PageTitle>
          <Muted className="mt-3 max-w-prose">
            Nine industry packs, each with the personas who own decisions, the questions they ask,
            the certified data products that answer them, and starter agents already bound to
            those metrics. Read all of it here — no account, no email. Open a workspace when you
            want to change something.
          </Muted>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {industries.map((industry) => (
            <Panel key={industry.key} className="flex flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <SectionTitle>
                  <Link href={`/catalog/${industry.key}`}>{industry.name}</Link>
                </SectionTitle>
                {industry.hasLiveDemo ? <Badge tone="success">live demo</Badge> : null}
              </div>
              <Muted className="mt-2 flex-1">{industry.summary}</Muted>
              <p className="mt-4 text-muted">
                {industry.agentCount} starter agent{industry.agentCount === 1 ? "" : "s"} ·{" "}
                {industry.productCount} data product{industry.productCount === 1 ? "" : "s"} ·{" "}
                {industry.questionCount} catalogued question
                {industry.questionCount === 1 ? "" : "s"}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href={`/catalog/${industry.key}`}>Browse the agents</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/onboarding?industry=${industry.key}`}>Open a workspace</Link>
                </Button>
              </div>
            </Panel>
          ))}
        </div>

        <Panel className="mt-8">
          <SectionTitle>Packs are a starting point, not a standard</SectionTitle>
          <Muted className="mt-2 max-w-prose">
            Everything in a pack is editable the moment it lands in your workspace: rename a
            persona, delete a question, point a binding somewhere else. What a pack cannot do is
            change the rules — no pack can weaken a gate, skip a stage, or make the binding
            validator lenient.
          </Muted>
        </Panel>
      </section>
    </PublicShell>
  );
}
