import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Band,
  Muted,
  PageTitle,
  Panel,
  SectionTitle,
} from "@/components/ui/primitives";
import { Badge, CertificationBadge, StaleBanner } from "@/components/ui/status";
import { requireSessionContext } from "@/lib/auth/session-context";
import { withOrg } from "@/lib/db/scope";
import type { BindingType, CertificationStatus, IntentClass } from "@/lib/enums";
import { toMermaid, toSvg } from "@/lib/graph/binding-graph";
import {
  DATSISV_LABELS,
  type AgentCharter,
  type AgentListing,
  type DatsisvScorecard,
} from "@/lib/artifacts/schemas";

/**
 * The agent detail page.
 *
 * Assembled entirely from committed artifact versions — nothing here is prose
 * someone typed into a listing field and forgot to update. Consumption-first:
 * the persona and the questions come before the archetype, and the model is not
 * mentioned at all, because it is not what makes an agent trustworthy.
 */
export default async function MarketplaceAgentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await requireSessionContext();

  const data = await withOrg(session.organizationId, async (db) => {
    const agent = await db.agent.findFirst({
      where: { slug, archivedAt: null },
      select: {
        id: true,
        slug: true,
        name: true,
        summary: true,
        archetype: true,
        riskTier: true,
        sensitivity: true,
        status: true,
        certification: true,
        staleReason: true,
        domain: { select: { name: true } },
      },
    });
    if (!agent) return null;

    const [artifacts, personas, questions, coverage, bindings, siblings] = await Promise.all([
      db.artifact.findMany({
        where: { agentId: agent.id },
        select: {
          kind: true,
          currentVersion: { select: { versionNumber: true, content: true, contentHash: true } },
        },
      }),
      db.persona.findMany({
        where: { agents: { some: { agentId: agent.id } }, archivedAt: null },
        select: { id: true, name: true, ownedDecisions: true, cadence: true },
      }),
      db.question.findMany({
        where: { agentId: agent.id, archivedAt: null },
        orderBy: { priority: "asc" },
        select: {
          id: true,
          text: true,
          intentClass: true,
          personaId: true,
          persona: { select: { name: true } },
        },
      }),
      db.questionCoverage.findMany({
        where: { question: { agentId: agent.id } },
        select: {
          questionId: true,
          bindingId: true,
          certifiedMetric: { select: { id: true, key: true, definition: true } },
          binding: { select: { dataProduct: { select: { id: true, name: true } } } },
        },
      }),
      db.binding.findMany({
        where: { agentId: agent.id, archivedAt: null },
        select: {
          id: true,
          status: true,
          bindingType: true,
          dataProduct: {
            select: {
              id: true,
              key: true,
              name: true,
              contractVersion: true,
              qualityScore: true,
              lastRefreshedAt: true,
            },
          },
          currentVersion: {
            select: {
              boundContractVersion: true,
              metrics: { select: { certifiedMetric: { select: { id: true, key: true } } } },
            },
          },
        },
      }),
      // "Agents like this": anything sharing a data product or a persona.
      db.agent.findMany({
        where: {
          archivedAt: null,
          id: { not: agent.id },
          OR: [
            { bindings: { some: { dataProduct: { bindings: { some: { agentId: agent.id } } } } } },
            { personas: { some: { persona: { agents: { some: { agentId: agent.id } } } } } },
          ],
        },
        select: {
          id: true,
          slug: true,
          name: true,
          certification: true,
          bindings: { select: { dataProduct: { select: { id: true, name: true } } } },
          personas: { select: { persona: { select: { id: true, name: true } } } },
        },
      }),
    ]);

    return { agent, artifacts, personas, questions, coverage, bindings, siblings };
  });

  if (!data) notFound();
  const { agent, artifacts, personas, questions, coverage, bindings, siblings } = data;

  const content = <T,>(kind: string): T | null => {
    const artifact = artifacts.find((a) => a.kind === kind);
    return artifact?.currentVersion ? (JSON.parse(artifact.currentVersion.content) as T) : null;
  };

  const charter = content<AgentCharter>("agent-charter");
  const listing = content<AgentListing>("agent-listing");
  const scorecard = content<DatsisvScorecard>("datsisv-scorecard");

  const coverageByQuestion = new Map(coverage.map((row) => [row.questionId, row]));
  const covered = questions.filter((q) => coverageByQuestion.has(q.id)).length;

  const graph = {
    agentName: agent.name,
    personas: personas.map((p) => ({ id: p.id, name: p.name })),
    questions: questions.map((q) => ({ id: q.id, text: q.text, personaId: q.personaId })),
    bindings: bindings.map((b) => ({
      id: b.id,
      type: b.bindingType as BindingType,
      productId: b.dataProduct.id,
    })),
    products: bindings.map((b) => ({
      id: b.dataProduct.id,
      name: b.dataProduct.name,
      contractVersion: b.dataProduct.contractVersion,
    })),
    metrics: bindings.flatMap((b) =>
      (b.currentVersion?.metrics ?? []).map((m) => ({
        id: m.certifiedMetric.id,
        key: m.certifiedMetric.key,
        productId: b.dataProduct.id,
      })),
    ),
    coverage: coverage.map((row) => ({
      questionId: row.questionId,
      bindingId: row.bindingId,
      metricId: row.certifiedMetric?.id ?? null,
    })),
  };
  const svg = toSvg(graph);

  const ownProductIds = new Set(bindings.map((b) => b.dataProduct.id));
  const ownPersonaIds = new Set(personas.map((p) => p.id));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/marketplace" className="text-muted">
          ← Marketplace
        </Link>
        <PageTitle className="mt-1">{agent.name}</PageTitle>
        <Muted className="mt-1 max-w-prose">{listing?.headline ?? agent.summary}</Muted>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CertificationBadge status={agent.certification as CertificationStatus} />
          {agent.archetype ? <Badge tone="neutral">{agent.archetype}</Badge> : null}
          {agent.riskTier ? <Badge tone="neutral">{agent.riskTier}</Badge> : null}
          {agent.sensitivity ? <Badge tone="neutral">{agent.sensitivity}</Badge> : null}
          {agent.status === "DEPRECATED" ? <Badge tone="warning">deprecated</Badge> : null}
        </div>
      </div>

      {agent.staleReason ? (
        <StaleBanner
          title="Re-certification pending"
          cause={agent.staleReason}
          action={
            <Button asChild size="sm">
              <Link href={`/agents/${agent.id}/stages/3-data-product-binding`}>
                Review the bindings
              </Link>
            </Button>
          }
        />
      ) : null}

      {/* Consumption-first: who is blocked, before anything technical. */}
      <Panel>
        <SectionTitle>Who this is for</SectionTitle>
        <ul className="mt-3 space-y-3">
          {personas.map((persona) => (
            <li key={persona.id}>
              <p className="font-medium">{persona.name}</p>
              <p className="text-muted">{persona.ownedDecisions}</p>
              <p className="text-xs text-muted">{persona.cadence}</p>
            </li>
          ))}
          {personas.length === 0 ? (
            <li className="text-muted">No persona recorded.</li>
          ) : null}
        </ul>
        {listing?.audience?.length ? (
          <Band className="mt-4">Listed for {listing.audience.join(", ")}.</Band>
        ) : null}
      </Panel>

      {/* The question catalog: the claim, per row, with what answers it. */}
      <Panel>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>What it can answer</SectionTitle>
          <Muted>
            {covered} of {questions.length} questions have a certified metric behind them
          </Muted>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-band">
                <th className="px-3 py-row font-semibold">Question</th>
                <th className="px-3 py-row font-semibold">Asked by</th>
                <th className="px-3 py-row font-semibold">Answered using</th>
                <th className="px-3 py-row font-semibold">From</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((question) => {
                const row = coverageByQuestion.get(question.id);
                return (
                  <tr key={question.id} className="border-b border-border align-top">
                    <td className="max-w-md px-3 py-row">
                      <span className="block">{question.text}</span>
                      <span className="block text-xs text-muted">
                        {question.intentClass as IntentClass}
                      </span>
                    </td>
                    <td className="px-3 py-row text-muted">{question.persona.name}</td>
                    <td className="px-3 py-row">
                      {row?.certifiedMetric ? (
                        <>
                          <code className="text-xs">{row.certifiedMetric.key}</code>
                          <span className="block text-xs text-muted">
                            {row.certifiedMetric.definition.slice(0, 90)}
                          </span>
                        </>
                      ) : (
                        <span className="text-warning">nothing yet</span>
                      )}
                    </td>
                    <td className="px-3 py-row text-muted">
                      {row ? (
                        <Link href={`/data-products/${row.binding.dataProduct.id}`}>
                          {row.binding.dataProduct.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>What it stands on</SectionTitle>
        <div
          className="mt-4 overflow-x-auto"
          // Server-rendered SVG: deterministic layout, no client JavaScript.
          dangerouslySetInnerHTML={{ __html: svg.svg }}
        />
        <details className="mt-4">
          <summary className="cursor-pointer text-muted">Mermaid source</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-panel p-3 text-xs">{toMermaid(graph)}</pre>
        </details>
      </Panel>

      {charter ? (
        <Panel>
          <SectionTitle>Scope</SectionTitle>
          <p className="mt-2 max-w-prose">{charter.mission}</p>
          <p className="mt-2 max-w-prose text-muted">{charter.scopeBoundary}</p>
          <p className="mt-4 font-medium">What it will not do</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
            {charter.outOfScope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <Band className="mt-4">
            Owned by {charter.ownerName}; escalate to {charter.escalationContact}.
          </Band>
        </Panel>
      ) : null}

      {scorecard ? (
        <Panel>
          <SectionTitle>Certification</SectionTitle>
          <p className="mt-2 max-w-prose">{scorecard.valueStatement}</p>
          <ul className="mt-4 space-y-2">
            {scorecard.scores.map((score) => (
              <li key={score.dimension} className="flex flex-wrap items-center gap-3">
                <span className="min-w-64 flex-1">{DATSISV_LABELS[score.dimension]}</span>
                <span className="font-medium">{score.score}/5</span>
                <span className="text-xs text-muted">
                  cites {score.citations[0]?.artifactKind} v{score.citations[0]?.versionNumber}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button asChild>
              <Link href={`/api/agents/${agent.id}/evidence?format=pdf`}>
                Download the evidence pack
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/api/agents/${agent.id}/evidence?format=docx`}>Word version</Link>
            </Button>
          </div>
        </Panel>
      ) : null}

      {siblings.length > 0 ? (
        <Panel>
          <SectionTitle>Agents like this</SectionTitle>
          <Muted className="mt-1">
            Related by what they stand on and who they serve — not by tags someone remembered to
            add.
          </Muted>
          <ul className="mt-3 space-y-2">
            {siblings.map((sibling) => {
              const sharedProducts = [
                ...new Set(
                  sibling.bindings
                    .map((b) => b.dataProduct)
                    .filter((p) => ownProductIds.has(p.id))
                    .map((p) => p.name),
                ),
              ];
              const sharedPersonas = [
                ...new Set(
                  sibling.personas
                    .map((p) => p.persona)
                    .filter((p) => ownPersonaIds.has(p.id))
                    .map((p) => p.name),
                ),
              ];
              return (
                <li key={sibling.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/marketplace/${sibling.slug}`}>{sibling.name}</Link>
                  <CertificationBadge status={sibling.certification as CertificationStatus} />
                  <span className="text-muted">
                    {[
                      sharedProducts.length > 0 ? `shares ${sharedProducts.join(", ")}` : null,
                      sharedPersonas.length > 0 ? `serves ${sharedPersonas.join(", ")}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}

      <Panel>
        <SectionTitle>Provenance</SectionTitle>
        <Muted className="mt-1">
          Every section above is rendered from a committed artifact version, with its content hash.
        </Muted>
        <ul className="mt-3 space-y-1">
          {artifacts
            .filter((a) => a.currentVersion)
            .map((artifact) => (
              <li key={artifact.kind} className="flex flex-wrap items-center gap-3 text-muted">
                <span className="min-w-56">{artifact.kind.replace(/-/g, " ")}</span>
                <span>v{artifact.currentVersion!.versionNumber}</span>
                <code className="text-xs">
                  {artifact.currentVersion!.contentHash.slice(0, 16)}
                </code>
              </li>
            ))}
        </ul>
        <div className="mt-4">
          <Button asChild variant="outline" size="sm">
            <Link href={`/agents/${agent.id}/audit`}>Audit trail</Link>
          </Button>
        </div>
      </Panel>
    </div>
  );
}
