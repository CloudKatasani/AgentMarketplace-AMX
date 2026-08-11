/**
 * The binding graph.
 *
 * Two renderings of the same data: Mermaid source (for export, and for anyone
 * who wants to paste it into their own docs) and an inline SVG for the screen.
 *
 * The SVG is laid out here rather than by a diagramming library on purpose —
 * the graph is always the same shape (persona → question → binding → product →
 * metric), so a deterministic layout beats a general-purpose one, renders on
 * the server, and adds no client JavaScript.
 */
import type { BindingType } from "@/lib/enums";

export type GraphInput = {
  agentName: string;
  personas: { id: string; name: string }[];
  questions: { id: string; text: string; personaId: string }[];
  bindings: { id: string; type: BindingType; productId: string }[];
  products: { id: string; name: string; contractVersion: string }[];
  metrics: { id: string; key: string; productId: string }[];
  /** questionId → bindingId, with the metric where there is one. */
  coverage: { questionId: string; bindingId: string; metricId: string | null }[];
};

const ARROW: Record<BindingType, string> = {
  GROUNDS_ON: "grounds on",
  QUERIES: "queries",
  RETRIEVES: "retrieves",
  ACTS_VIA: "acts via",
  CITES: "cites",
};

/** Mermaid flowchart source. Deterministic, so it diffs cleanly in exports. */
export function toMermaid(input: GraphInput): string {
  const lines = ["flowchart LR"];
  const id = (prefix: string, value: string) =>
    `${prefix}_${value.replace(/[^a-zA-Z0-9]/g, "")}`;

  lines.push(`  agent["${escape(input.agentName)}"]`);

  for (const persona of input.personas) {
    lines.push(`  ${id("p", persona.id)}(["${escape(persona.name)}"])`);
    lines.push(`  ${id("p", persona.id)} --> agent`);
  }

  for (const product of input.products) {
    lines.push(
      `  ${id("d", product.id)}[["${escape(product.name)}<br/>contract ${escape(product.contractVersion)}"]]`,
    );
  }

  for (const binding of input.bindings) {
    lines.push(
      `  agent -- "${ARROW[binding.type]}" --> ${id("d", binding.productId)}`,
    );
  }

  for (const metric of input.metrics) {
    lines.push(`  ${id("m", metric.id)}("${escape(metric.key)}")`);
    lines.push(`  ${id("d", metric.productId)} --> ${id("m", metric.id)}`);
  }

  for (const row of input.coverage) {
    const question = input.questions.find((q) => q.id === row.questionId);
    if (!question || !row.metricId) continue;
    lines.push(
      `  ${id("q", question.id)}["${escape(truncate(question.text, 48))}"] -.-> ${id("m", row.metricId)}`,
    );
  }

  return lines.join("\n");
}

// ────────────────────────────── SVG ──────────────────────────────

type Node = { x: number; y: number; w: number; h: number; label: string; sub?: string; kind: string };
type Edge = { from: Node; to: Node; label?: string; dashed?: boolean };

const COLUMN_X = [16, 236, 470, 700] as const;
const NODE_W = 190;
const ROW_H = 56;
const GAP = 14;

/**
 * A four-column layout: questions → agent → products → metrics.
 *
 * Colours come from the token classes rather than literals, so the graph
 * re-skins with the rest of the product and the no-hard-coded-hex rule holds.
 */
export function toSvg(input: GraphInput): { svg: string; width: number; height: number } {
  const questions = input.questions.slice(0, 12);
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const column = (index: number, count: number, i: number) => ({
    x: COLUMN_X[index],
    y: 20 + i * (ROW_H + GAP) + Math.max(0, (rows(questions.length) - count) * (ROW_H + GAP)) / 2,
  });

  const questionNodes = questions.map((question, i) => {
    const { x, y } = column(0, questions.length, i);
    const node: Node = {
      x,
      y,
      w: NODE_W,
      h: ROW_H,
      label: truncate(question.text, 52),
      sub: input.personas.find((p) => p.id === question.personaId)?.name,
      kind: "question",
    };
    nodes.push(node);
    return { question, node };
  });

  const agentNode: Node = {
    x: COLUMN_X[1],
    y: 20 + (rows(questions.length) - 1) * (ROW_H + GAP) * 0.5,
    w: NODE_W,
    h: ROW_H,
    label: truncate(input.agentName, 30),
    sub: `${input.bindings.length} binding${input.bindings.length === 1 ? "" : "s"}`,
    kind: "agent",
  };
  nodes.push(agentNode);

  const productNodes = input.products.map((product, i) => {
    const { x, y } = column(2, input.products.length, i);
    const node: Node = {
      x,
      y,
      w: NODE_W,
      h: ROW_H,
      label: truncate(product.name, 26),
      sub: `contract ${product.contractVersion}`,
      kind: "product",
    };
    nodes.push(node);
    return { product, node };
  });

  const metricNodes = input.metrics.map((metric, i) => {
    const { x, y } = column(3, input.metrics.length, i);
    const node: Node = {
      x,
      y,
      w: NODE_W,
      h: ROW_H,
      label: metric.key,
      sub: "certified metric",
      kind: "metric",
    };
    nodes.push(node);
    return { metric, node };
  });

  for (const { node } of questionNodes) edges.push({ from: node, to: agentNode });

  for (const binding of input.bindings) {
    const product = productNodes.find((p) => p.product.id === binding.productId);
    if (product) edges.push({ from: agentNode, to: product.node, label: ARROW[binding.type] });
  }

  for (const metric of metricNodes) {
    const product = productNodes.find((p) => p.product.id === metric.metric.productId);
    if (product) edges.push({ from: product.node, to: metric.node });
  }

  // The dashed lines are the ones that matter: this question is answered by
  // this metric. Everything else is structure.
  for (const row of input.coverage) {
    const question = questionNodes.find((q) => q.question.id === row.questionId);
    const metric = row.metricId ? metricNodes.find((m) => m.metric.id === row.metricId) : null;
    if (question && metric) {
      edges.push({ from: question.node, to: metric.node, dashed: true });
    }
  }

  const height = Math.max(...nodes.map((n) => n.y + n.h)) + 24;
  const width = COLUMN_X[3] + NODE_W + 16;

  const body = [
    ...edges.map(renderEdge),
    ...nodes.map(renderNode),
  ].join("\n");

  return {
    width,
    height,
    svg: `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Binding graph for ${escape(input.agentName)}" xmlns="http://www.w3.org/2000/svg">\n${body}\n</svg>`,
  };
}

function rows(count: number): number {
  return Math.max(count, 1);
}

function renderEdge(edge: Edge): string {
  const x1 = edge.from.x + edge.from.w;
  const y1 = edge.from.y + edge.from.h / 2;
  const x2 = edge.to.x;
  const y2 = edge.to.y + edge.to.h / 2;
  const mid = (x1 + x2) / 2;
  const path = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;

  const stroke = edge.dashed
    ? ' stroke-dasharray="4 3" class="stroke-brand-accent"'
    : ' class="stroke-border"';

  const label = edge.label
    ? `<text x="${mid}" y="${(y1 + y2) / 2 - 5}" text-anchor="middle" font-size="9" class="fill-muted">${escape(edge.label)}</text>`
    : "";

  return `  <path d="${path}" fill="none" stroke-width="1.5"${stroke} />${label}`;
}

function renderNode(node: Node): string {
  const fill =
    node.kind === "agent"
      ? "fill-brand-primary"
      : node.kind === "metric"
        ? "fill-panel"
        : node.kind === "product"
          ? "fill-band"
          : "fill-surface";
  const text = node.kind === "agent" ? "fill-surface" : "fill-brand-ink";
  const sub = node.kind === "agent" ? "fill-surface" : "fill-muted";

  return [
    `  <g>`,
    `    <rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="6" class="${fill} stroke-border" stroke-width="1" />`,
    `    <text x="${node.x + 10}" y="${node.y + 22}" font-size="11" font-weight="600" class="${text}">${escape(node.label)}</text>`,
    node.sub
      ? `    <text x="${node.x + 10}" y="${node.y + 38}" font-size="9" class="${sub}">${escape(node.sub)}</text>`
      : "",
    `  </g>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
