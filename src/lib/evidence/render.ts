/**
 * Rendering the evidence pack as Word and PDF.
 *
 * Behind adapters and deliberately dependency-light in shape: both renderers
 * take the assembled pack and produce a byte array. The assembly is what
 * carries the meaning; these two only decide how it looks on a page.
 *
 * Section order is fixed, because an auditor reading their second pack should
 * not have to look for anything: what it is → who it serves → what it stands
 * on → whether it was evaluated → who approved it → the manifest that proves
 * all of the above.
 */
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { DATSISV_LABELS } from "@/lib/artifacts/schemas";

import type { EvidencePack } from "./pack";

const BASIS_NOTE: Record<EvidencePack["certificationBasis"], string> = {
  "peer-certified":
    "Peer-certified: every gate was approved by a second person holding the named role.",
  "self-attested":
    "Self-attested: the author reviewed their own work and signed an explicit attestation. This is recorded, permitted, and deliberately distinguished from peer certification.",
  "not certified": "Not certified. This agent has not completed Stage 7.",
};

// ────────────────────────────── Word ──────────────────────────────

export async function renderPackDocx(pack: EvidencePack): Promise<Uint8Array> {
  const heading = (text: string) =>
    new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 } });
  const sub = (text: string) =>
    new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 } });
  const body = (text: string) => new Paragraph({ children: [new TextRun(text)] });
  const mono = (text: string) =>
    new Paragraph({ children: [new TextRun({ text, font: "Consolas", size: 16 })] });

  const table = (headers: string[], rows: string[][]) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: headers.map(
            (text) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
              }),
          ),
        }),
        ...rows.map(
          (row) =>
            new TableRow({
              children: row.map(
                (text) => new TableCell({ children: [new Paragraph(text || "—")] }),
              ),
            }),
        ),
      ],
    });

  const children: (Paragraph | Table)[] = [
    new Paragraph({
      text: `Evidence pack — ${pack.agent.name}`,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
    }),
    body(`${pack.agent.organizationName} · generated ${pack.manifest.generatedAt}`),
    body(BASIS_NOTE[pack.certificationBasis]),

    heading("1 · What this agent is"),
    body(pack.agent.summary || "—"),
    table(
      ["Archetype", "Risk tier", "Sensitivity", "Status"],
      [
        [
          pack.agent.archetype ?? "—",
          pack.agent.riskTier ?? "—",
          pack.agent.sensitivity ?? "—",
          pack.agent.status,
        ],
      ],
    ),

    heading("2 · Who it serves"),
    table(
      ["Persona", "Decisions they own"],
      pack.personas.map((persona) => [persona.name, persona.ownedDecisions]),
    ),

    heading("3 · What answers each question"),
    body(
      `${pack.coverage.covered} of ${pack.coverage.total} questions are covered by an approved binding.`,
    ),
    table(
      ["Question", "Persona", "Certified metric", "Data product"],
      pack.questions.map((question) => [
        question.text,
        question.personaName,
        question.metricKey ?? "—",
        question.productName ?? "—",
      ]),
    ),

    heading("4 · What it stands on"),
    table(
      ["Data product", "Binding", "Contract pinned", "Metrics", "Status"],
      pack.bindings.map((binding) => [
        binding.productName,
        binding.type.replace(/_/g, " ").toLowerCase(),
        binding.boundContractVersion,
        binding.metricKeys.join(", "),
        binding.status,
      ]),
    ),
    sub("Binding graph (Mermaid)"),
    ...pack.mermaid.split("\n").map(mono),

    heading("5 · Evaluation"),
    body(pack.evaluation?.summary ?? "No evaluation harness was committed."),

    heading("6 · Certification (DATSIS+V)"),
    ...(pack.scorecard
      ? [
          body(pack.scorecard.valueStatement),
          table(
            ["Dimension", "Score", "Evidence cited"],
            pack.scorecard.scores.map((score) => [
              DATSISV_LABELS[score.dimension],
              String(score.score),
              score.citations
                .map((c) => `${c.artifactKind} v${c.versionNumber} ${c.fieldPath}`)
                .join("; "),
            ]),
          ),
        ]
      : [body("No scorecard was committed.")]),

    heading("7 · Who approved what"),
    table(
      ["Stage", "Role", "Decision", "Basis", "When", "Who"],
      pack.approvals.map((approval) => [
        approval.stageName,
        approval.role,
        approval.decision.toLowerCase().replace(/_/g, " "),
        approval.isSelfAttestation ? "self-attested" : "peer review",
        approval.at.toISOString().slice(0, 10),
        approval.approverName,
      ]),
    ),
    ...pack.approvals
      .filter((approval) => approval.attestationStatement)
      .flatMap((approval) => [
        sub(`Attestation — ${approval.stageName}, ${approval.role}`),
        body(approval.attestationStatement!),
      ]),

    heading("8 · Manifest"),
    body(
      pack.manifest.auditChainVerified
        ? `The audit chain verified across ${pack.manifest.auditEventCount} events at generation time. Each event carries the hash of its predecessor, so an edit after the fact breaks the chain.`
        : "WARNING: the audit chain did not verify at generation time.",
    ),
    table(
      ["Artifact", "Version", "Content hash"],
      pack.manifest.artifactHashes.map((entry) => [
        entry.kind,
        `v${entry.versionNumber}`,
        entry.contentHash,
      ]),
    ),
    mono(`audit chain head: ${pack.manifest.auditChainHead ?? "none"}`),
    mono(`pack hash: ${pack.manifest.packHash}`),
  ];

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc).then((buffer) => new Uint8Array(buffer));
}

// ────────────────────────────── PDF ──────────────────────────────

export async function renderPackPdf(pack: EvidencePack): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const monoFont = await pdf.embedFont(StandardFonts.Courier);

  const ink = rgb(0, 0.216, 0.373); // --brand-ink
  const muted = rgb(0.357, 0.478, 0.58); // --muted
  const brand = rgb(0, 0.439, 0.678); // --brand-primary

  const margin = 48;
  const width = 595.28;
  const height = 841.89;
  let page = pdf.addPage([width, height]);
  let y = height - margin;

  const space = (amount: number) => {
    y -= amount;
    if (y < margin + 40) {
      page = pdf.addPage([width, height]);
      y = height - margin;
    }
  };

  const write = (
    text: string,
    options: { size?: number; font?: typeof font; colour?: typeof ink; indent?: number } = {},
  ) => {
    const size = options.size ?? 9.5;
    const chosen = options.font ?? font;
    const maxChars = Math.floor((width - margin * 2 - (options.indent ?? 0)) / (size * 0.5));
    for (const line of wrap(text, maxChars)) {
      space(size + 3.5);
      page.drawText(line, {
        x: margin + (options.indent ?? 0),
        y,
        size,
        font: chosen,
        color: options.colour ?? ink,
      });
    }
  };

  const heading = (text: string) => {
    space(14);
    write(text, { size: 13, font: bold, colour: brand });
    space(2);
  };

  write(`Evidence pack — ${pack.agent.name}`, { size: 20, font: bold });
  write(`${pack.agent.organizationName} · generated ${pack.manifest.generatedAt}`, {
    colour: muted,
  });
  write(BASIS_NOTE[pack.certificationBasis], { font: bold });

  heading("1 · What this agent is");
  write(pack.agent.summary || "—");
  write(
    `Archetype ${pack.agent.archetype ?? "—"} · risk ${pack.agent.riskTier ?? "—"} · sensitivity ${pack.agent.sensitivity ?? "—"} · status ${pack.agent.status}`,
    { colour: muted },
  );

  heading("2 · Who it serves");
  for (const persona of pack.personas) {
    write(persona.name, { font: bold });
    write(persona.ownedDecisions, { indent: 12, colour: muted });
  }

  heading("3 · What answers each question");
  write(
    `${pack.coverage.covered} of ${pack.coverage.total} questions covered by an approved binding.`,
  );
  for (const question of pack.questions) {
    write(`• ${question.text}`);
    write(
      `${question.personaName} → ${question.metricKey ?? "no metric"} on ${question.productName ?? "no product"}`,
      { indent: 12, colour: muted },
    );
  }

  heading("4 · What it stands on");
  for (const binding of pack.bindings) {
    write(
      `${binding.productName} — ${binding.type.replace(/_/g, " ").toLowerCase()}, contract ${binding.boundContractVersion} (${binding.status.toLowerCase()})`,
    );
    if (binding.metricKeys.length > 0) {
      write(`metrics: ${binding.metricKeys.join(", ")}`, { indent: 12, colour: muted });
    }
  }

  heading("5 · Evaluation");
  write(pack.evaluation?.summary ?? "No evaluation harness was committed.");

  heading("6 · Certification (DATSIS+V)");
  if (pack.scorecard) {
    write(pack.scorecard.valueStatement);
    for (const score of pack.scorecard.scores) {
      write(`${DATSISV_LABELS[score.dimension]} — ${score.score}/5`);
      for (const citation of score.citations) {
        write(`cites ${citation.artifactKind} v${citation.versionNumber} ${citation.fieldPath}`, {
          indent: 12,
          colour: muted,
        });
      }
    }
  } else {
    write("No scorecard was committed.");
  }

  heading("7 · Who approved what");
  for (const approval of pack.approvals) {
    write(
      `${approval.stageName} — ${approval.role}: ${approval.decision.toLowerCase().replace(/_/g, " ")} (${approval.isSelfAttestation ? "self-attested" : "peer review"}), ${approval.approverName}, ${approval.at.toISOString().slice(0, 10)}`,
    );
    if (approval.attestationStatement) {
      write(`"${approval.attestationStatement}"`, { indent: 12, colour: muted });
    }
  }

  heading("8 · Manifest");
  write(
    pack.manifest.auditChainVerified
      ? `Audit chain verified across ${pack.manifest.auditEventCount} events at generation time.`
      : "WARNING: the audit chain did not verify at generation time.",
  );
  for (const entry of pack.manifest.artifactHashes) {
    write(`${entry.kind} v${entry.versionNumber}  ${entry.contentHash}`, {
      size: 8,
      font: monoFont,
      colour: muted,
    });
  }
  write(`audit chain head: ${pack.manifest.auditChainHead ?? "none"}`, {
    size: 8,
    font: monoFont,
    colour: muted,
  });
  write(`pack hash: ${pack.manifest.packHash}`, { size: 8, font: monoFont });

  return pdf.save();
}

/**
 * pdf-lib's standard fonts are WinAnsi-encoded, which has no arrow, no en
 * dash, and no curly quotes — all of which the product's own copy uses. Rather
 * than flatten the writing everywhere, transliterate at the point of drawing.
 */
const WIN_ANSI_SUBSTITUTIONS: [RegExp, string][] = [
  [/[\u2192\u2794\u27a1]/g, "->"],
  [/[\u2190]/g, "<-"],
  [/[\u2194]/g, "<->"],
  [/[\u2013\u2014]/g, "-"],
  [/[\u2018\u2019\u201b]/g, "'"],
  [/[\u201c\u201d\u201f]/g, '"'],
  [/[\u2026]/g, "..."],
  [/[\u2265]/g, ">="],
  [/[\u2264]/g, "<="],
  [/[\u00d7]/g, "x"],
  [/[\u00b7\u2022]/g, "-"],
  [/[\u2713\u2714]/g, "v"],
  [/[\u00a0]/g, " "],
];

function toWinAnsi(text: string): string {
  let out = String(text);
  for (const [pattern, replacement] of WIN_ANSI_SUBSTITUTIONS) {
    out = out.replace(pattern, replacement);
  }
  // Anything still outside the encodable range becomes a question mark rather
  // than throwing halfway through generating someone's audit evidence.
  return out.replace(/[^\u0000-\u00ff]/g, "?");
}

function wrap(text: string, maxChars: number): string[] {
  const words = toWinAnsi(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length === 0) {
      line = word;
    } else if (line.length + 1 + word.length <= maxChars) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
