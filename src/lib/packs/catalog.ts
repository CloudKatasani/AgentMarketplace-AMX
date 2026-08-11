/**
 * The public catalogue: what each industry pack actually contains, resolved.
 *
 * A pack on disk is a set of cross-referenced keys — an agent names question
 * keys, a question names a metric key, a binding names a product key. That is
 * right for authoring and useless for reading, so this resolves the references
 * once and hands screens whole objects.
 *
 * It reads packs, never the database, which is what lets the catalogue be
 * public: there is no tenant involved, nothing here belongs to anybody, and no
 * session is required to look at it. Anything a visitor sees here is the same
 * starting content their own workspace would be seeded with.
 */
import { loadAllPacks, loadPack } from "./load";
import type { Pack } from "./schema";

export type CatalogQuestion = {
  key: string;
  text: string;
  intentClass: string;
  consequenceOfNoAnswer: string;
  expectedAnswerShape: string;
  personaName: string;
  metricKey: string;
  metricName: string | null;
  dataProductName: string | null;
};

export type CatalogBinding = {
  type: string;
  purpose: string;
  dataProductKey: string;
  dataProductName: string;
  contractVersion: string;
  layer: string;
  metricKeys: string[];
};

export type CatalogAgent = {
  key: string;
  name: string;
  summary: string;
  archetype: string;
  riskTier: string;
  domainName: string;
  personaName: string;
  personaDecisions: string;
  questions: CatalogQuestion[];
  bindings: CatalogBinding[];
};

export type CatalogIndustry = {
  key: string;
  name: string;
  version: string;
  summary: string;
  disclaimer: string;
  domains: { key: string; name: string }[];
  conformedBackbone: string[];
  personas: { key: string; name: string; kind: string; ownedDecisions: string; cadence: string }[];
  agents: CatalogAgent[];
  dataProducts: {
    key: string;
    name: string;
    description: string;
    layer: string;
    sensitivity: string;
    qualityScore: number;
    contractVersion: string;
    owner: string;
    metrics: { key: string; name: string; definition: string; grain: string }[];
  }[];
  constraints: { key: string; name: string; prompt: string; citation: string }[];
  glossary: { term: string; definition: string }[];
  academyPaths: { key: string; title: string; summary: string; credentialKey: string }[];
  /** True for the industry the seeded live demo actually runs on. */
  hasLiveDemo: boolean;
};

/** The one pack the showcase tenant is seeded from. */
const LIVE_DEMO_PACK = "utilities";

export function catalogIndustries(): { key: string; name: string; summary: string; agentCount: number; productCount: number; questionCount: number; hasLiveDemo: boolean }[] {
  const { loaded } = loadAllPacks();
  return loaded
    .map((pack) => ({
      key: pack.key,
      name: pack.name,
      summary: pack.summary,
      agentCount: pack.starterAgents.length,
      productCount: pack.dataProducts.length,
      questionCount: pack.questionLibrary.length,
      hasLiveDemo: pack.key === LIVE_DEMO_PACK,
    }))
    .sort((a, b) => {
      // The generic pack is the fallback, so it reads last rather than first.
      if (a.key.startsWith("_") !== b.key.startsWith("_")) return a.key.startsWith("_") ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
}

export function catalogIndustry(key: string): CatalogIndustry | null {
  const result = loadPack(key);
  if (!result.ok) return null;
  return resolve(result.pack);
}

function resolve(pack: Pack): CatalogIndustry {
  const domainName = new Map(pack.domains.map((domain) => [domain.key, domain.name]));
  const personaName = new Map(pack.personas.map((persona) => [persona.key, persona.name]));
  const personaDecisions = new Map(pack.personas.map((p) => [p.key, p.ownedDecisions]));
  const questionByKey = new Map(pack.questionLibrary.map((question) => [question.key, question]));

  const productByKey = new Map(pack.dataProducts.map((product) => [product.key, product]));
  const metricIndex = new Map<string, { name: string; productName: string }>();
  for (const product of pack.dataProducts) {
    for (const metric of product.metrics) {
      metricIndex.set(metric.key, { name: metric.name, productName: product.name });
    }
  }

  const agents: CatalogAgent[] = pack.starterAgents.map((agent) => ({
    key: agent.key,
    name: agent.name,
    summary: agent.summary,
    archetype: agent.archetype,
    riskTier: agent.riskTier,
    domainName: domainName.get(agent.domainKey) ?? agent.domainKey,
    personaName: personaName.get(agent.primaryPersonaKey) ?? agent.primaryPersonaKey,
    personaDecisions: personaDecisions.get(agent.primaryPersonaKey) ?? "",
    questions: agent.questionKeys
      .map((questionKey) => questionByKey.get(questionKey))
      .filter((question): question is NonNullable<typeof question> => Boolean(question))
      .map((question) => {
        const metric = question.metricKey ? metricIndex.get(question.metricKey) : undefined;
        return {
          key: question.key,
          text: question.text,
          intentClass: question.intentClass,
          consequenceOfNoAnswer: question.consequenceOfNoAnswer,
          expectedAnswerShape: question.expectedAnswerShape,
          personaName: personaName.get(question.personaKey) ?? question.personaKey,
          metricKey: question.metricKey,
          metricName: metric?.name ?? null,
          dataProductName: metric?.productName ?? null,
        };
      }),
    bindings: agent.bindings.map((binding) => {
      const product = productByKey.get(binding.dataProductKey);
      return {
        type: binding.type,
        purpose: binding.purpose,
        dataProductKey: binding.dataProductKey,
        dataProductName: product?.name ?? binding.dataProductKey,
        contractVersion: product?.contractVersion ?? "—",
        layer: product?.layer ?? "GOLD",
        metricKeys: binding.metricKeys,
      };
    }),
  }));

  return {
    key: pack.key,
    name: pack.name,
    version: pack.version,
    summary: pack.summary,
    disclaimer: pack.disclaimer,
    domains: pack.domains.map((domain) => ({ key: domain.key, name: domain.name })),
    conformedBackbone: pack.conformedBackbone,
    personas: pack.personas.map((persona) => ({
      key: persona.key,
      name: persona.name,
      kind: persona.kind,
      ownedDecisions: persona.ownedDecisions,
      cadence: persona.cadence,
    })),
    agents,
    dataProducts: pack.dataProducts.map((product) => ({
      key: product.key,
      name: product.name,
      description: product.description,
      layer: product.layer,
      sensitivity: product.sensitivity,
      qualityScore: product.qualityScore,
      contractVersion: product.contractVersion,
      owner: product.owner,
      metrics: product.metrics.map((metric) => ({
        key: metric.key,
        name: metric.name,
        definition: metric.definition,
        grain: metric.grain,
      })),
    })),
    constraints: pack.regulatoryConstraints.map((constraint) => ({
      key: constraint.key,
      name: constraint.name,
      prompt: constraint.prompt,
      citation: constraint.citation,
    })),
    glossary: pack.glossary,
    academyPaths: pack.academy.map((path) => ({
      key: path.key,
      title: path.title,
      summary: path.summary,
      credentialKey: path.credentialKey,
    })),
    hasLiveDemo: pack.key === LIVE_DEMO_PACK,
  };
}
