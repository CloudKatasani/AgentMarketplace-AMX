import Link from "next/link";
import { notFound } from "next/navigation";

import { PublicShell } from "@/components/public-shell";
import { Button } from "@/components/ui/button";
import { Band, Muted, PageTitle, Panel, SectionTitle } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/status";
import { catalogIndustries, catalogIndustry } from "@/lib/packs/catalog";

export function generateStaticParams() {
  return catalogIndustries().map((industry) => ({ industry: industry.key }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ industry: string }>;
}) {
  const { industry } = await params;
  const pack = catalogIndustry(industry);
  return {
    title: pack ? `${pack.name} agent catalog · AMX` : "Agent catalog · AMX",
    description: pack?.summary,
  };
}

/**
 * One industry's catalogue, in full, without an account.
 *
 * Consumption-first, exactly as an agent page is: the persona and the questions
 * come before the bindings, and every question shows the certified metric and
 * data product that answers it — or says plainly that nothing does yet, which
 * is the honest state for a starter agent nobody has bound.
 */
export default async function IndustryCatalogPage({
  params,
}: {
  params: Promise<{ industry: string }>;
}) {
  const { industry } = await params;
  const pack = catalogIndustry(industry);
  if (!pack) notFound();

  return (
    <PublicShell>
      <section className="bg-panel">
        <div className="mx-auto w-full max-w-6xl px-6 py-12">
          <Link href="/catalog" className="text-brand-deep">
            ← All industries
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <PageTitle>{pack.name}</PageTitle>
            <Badge tone="neutral">pack {pack.version}</Badge>
            {pack.hasLiveDemo ? <Badge tone="success">live demo available</Badge> : null}
          </div>
          <Muted className="mt-3 max-w-prose">{pack.summary}</Muted>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button asChild>
              <Link href={`/onboarding?industry=${pack.key}`}>
                Open a workspace with this pack
              </Link>
            </Button>
            {pack.hasLiveDemo ? (
              <Button asChild variant="outline">
                <Link href="/demo" prefetch={false}>
                  See it certified, live
                </Link>
              </Button>
            ) : null}
          </div>
          <Muted className="mt-3">No account needed for either.</Muted>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-10">
        {pack.conformedBackbone.length > 0 ? (
          <Band>
            <span className="font-medium">Conformed backbone:</span>{" "}
            {pack.conformedBackbone.join(" → ")}
          </Band>
        ) : null}

        <Panel>
          <SectionTitle>Starter agents</SectionTitle>
          <Muted className="mt-1 max-w-prose">
            Each one arrives in a new workspace part-way through its lifecycle — chartered, bound,
            and waiting for a human to review it. None of them is published until someone
            approves every stage.
          </Muted>

          <div className="mt-5 space-y-5">
            {pack.agents.map((agent) => (
              <div key={agent.key} className="rounded border border-border p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-section-title">{agent.name}</span>
                  <Badge tone="neutral">{agent.archetype}</Badge>
                  <Badge tone="neutral">{agent.riskTier}</Badge>
                  <span className="text-muted">{agent.domainName}</span>
                </div>
                <p className="mt-2 max-w-prose">{agent.summary}</p>

                <p className="mt-3 font-medium">
                  For {agent.personaName}
                  <span className="ml-2 font-normal text-muted">{agent.personaDecisions}</span>
                </p>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[42rem] border-collapse">
                    <thead>
                      <tr className="bg-band text-left">
                        <th className="px-3 py-2 font-medium">Question it answers</th>
                        <th className="px-3 py-2 font-medium">Intent</th>
                        <th className="px-3 py-2 font-medium">Answered by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agent.questions.map((question) => (
                        <tr key={question.key} className="border-b border-border align-top">
                          <td className="px-3 py-2">
                            {question.text}
                            <span className="block text-muted">
                              Without it: {question.consequenceOfNoAnswer}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted">{question.intentClass}</td>
                          <td className="px-3 py-2">
                            {question.metricName ? (
                              <>
                                <code className="text-xs">{question.metricKey}</code>
                                <span className="block text-muted">
                                  {question.metricName} · {question.dataProductName}
                                </span>
                              </>
                            ) : (
                              <span className="text-muted">
                                No certified metric yet — the binding stage is where that gets
                                decided.
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="mt-4 font-medium">What it stands on</p>
                <ul className="mt-1 space-y-1">
                  {agent.bindings.map((binding) => (
                    <li key={`${binding.dataProductKey}-${binding.type}`} className="text-muted">
                      <Badge tone="neutral">
                        {binding.type.replace(/_/g, " ").toLowerCase()}
                      </Badge>{" "}
                      <span className="text-brand-ink">{binding.dataProductName}</span> · contract{" "}
                      {binding.contractVersion} · {binding.layer}
                      {binding.metricKeys.length > 0
                        ? ` · ${binding.metricKeys.join(", ")}`
                        : ""}
                      <span className="block">{binding.purpose}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionTitle>Certified data products</SectionTitle>
          <Muted className="mt-1 max-w-prose">
            Agents answer through these, never through raw tables. A pack may only ship products
            served from a gold, platinum or semantic layer — the binding validator rejects the
            rest.
          </Muted>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {pack.dataProducts.map((product) => (
              <div key={product.key} className="rounded border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{product.name}</span>
                  <Badge tone="neutral">{product.layer}</Badge>
                  <Badge tone="neutral">{product.sensitivity}</Badge>
                  <Badge tone={product.qualityScore >= 90 ? "success" : "brand"}>
                    quality {product.qualityScore}
                  </Badge>
                </div>
                <p className="mt-2 text-muted">{product.description}</p>
                <p className="mt-2 text-muted">
                  contract {product.contractVersion} · owned by {product.owner}
                </p>
                <ul className="mt-2 space-y-1">
                  {product.metrics.map((metric) => (
                    <li key={metric.key}>
                      <code className="text-xs">{metric.key}</code>{" "}
                      <span className="font-medium">{metric.name}</span>
                      <span className="block text-muted">
                        {metric.definition} · {metric.grain}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionTitle>Personas</SectionTitle>
          <Muted className="mt-1">The roles this pack assumes own the decisions.</Muted>
          <ul className="mt-3 divide-y divide-border">
            {pack.personas.map((persona) => (
              <li key={persona.key} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{persona.name}</span>
                  <Badge tone="neutral">{persona.kind.toLowerCase()}</Badge>
                  <span className="text-muted">{persona.cadence}</span>
                </div>
                <p className="mt-1 max-w-prose text-muted">{persona.ownedDecisions}</p>
              </li>
            ))}
          </ul>
        </Panel>

        {pack.constraints.length > 0 ? (
          <Panel>
            <SectionTitle>Regulatory constraints this pack asks about</SectionTitle>
            <Muted className="mt-1 max-w-prose">
              Surfaced at the governance stage, in plain language, with the citation. They are
              prompts to answer, not boxes to tick.
            </Muted>
            <ul className="mt-3 divide-y divide-border">
              {pack.constraints.map((constraint) => (
                <li key={constraint.key} className="py-3">
                  <span className="font-medium">{constraint.name}</span>
                  {constraint.citation ? (
                    <span className="ml-2 text-muted">{constraint.citation}</span>
                  ) : null}
                  <p className="mt-1 max-w-prose text-muted">{constraint.prompt}</p>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {pack.academyPaths.length > 0 ? (
          <Panel>
            <SectionTitle>Academy paths</SectionTitle>
            <Muted className="mt-1">
              Role paths that ship with this pack. A credential can gate who may approve.
            </Muted>
            <ul className="mt-3 divide-y divide-border">
              {pack.academyPaths.map((path) => (
                <li key={path.key} className="py-3">
                  <span className="font-medium">{path.title}</span>
                  <span className="ml-2 text-muted">unlocks {path.credentialKey}</span>
                  <p className="mt-1 max-w-prose text-muted">{path.summary}</p>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {pack.glossary.length > 0 ? (
          <Panel>
            <SectionTitle>Glossary</SectionTitle>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              {pack.glossary.map((entry) => (
                <div key={entry.term}>
                  <dt className="font-medium">{entry.term}</dt>
                  <dd className="text-muted">{entry.definition}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        ) : null}

        <Band>{pack.disclaimer}</Band>
      </div>
    </PublicShell>
  );
}
