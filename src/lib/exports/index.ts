/**
 * Exports, behind one adapter.
 *
 * Every export is assembled from committed artifact versions, like the
 * evidence pack — so an export is a *view* of the record, never a second copy
 * of the truth that can drift.
 *
 * The Excel catalogue is the one people actually live in: SMEs review question
 * lists in a spreadsheet whatever the product does, so it ships with dropdown
 * validations and a COUNTIFS coverage summary rather than a flat dump they have
 * to rebuild.
 */
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { stringify as toYaml } from "yaml";

import type { AmxPrismaClient } from "@/lib/db/tenancy";
import { INTENT_CLASSES } from "@/lib/enums";
import { assembleEvidencePack } from "@/lib/evidence/pack";
import { renderPackDocx, renderPackPdf } from "@/lib/evidence/render";
import { toMermaid, toSvg } from "@/lib/graph/binding-graph";
import type { BindingType } from "@/lib/enums";

export type ExportFormat =
  | "question-catalog-xlsx"
  | "grounding-pack-json"
  | "listing-json"
  | "binding-graph-mmd"
  | "binding-graph-svg"
  | "evidence-pack-pdf"
  | "evidence-pack-docx"
  | "agent-bundle-zip";

export type ExportResult = {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
};

const CONTENT_TYPES: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json",
  mmd: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  zip: "application/zip",
};

type AgentExportData = Awaited<ReturnType<typeof loadAgentExportData>>;

async function loadAgentExportData(db: AmxPrismaClient, agentId: string) {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { id: true, slug: true, name: true, summary: true, certification: true },
  });
  if (!agent) return null;

  const [questions, coverage, bindings, artifacts, personas] = await Promise.all([
    db.question.findMany({
      where: { agentId, archivedAt: null },
      orderBy: { priority: "asc" },
      select: {
        id: true,
        text: true,
        intentClass: true,
        consequenceOfNoAnswer: true,
        expectedAnswerShape: true,
        personaId: true,
        persona: { select: { name: true } },
      },
    }),
    db.questionCoverage.findMany({
      where: { question: { agentId } },
      select: {
        questionId: true,
        bindingId: true,
        certifiedMetric: { select: { id: true, key: true } },
        binding: { select: { dataProduct: { select: { name: true } } } },
      },
    }),
    db.binding.findMany({
      where: { agentId, archivedAt: null },
      select: {
        id: true,
        bindingType: true,
        status: true,
        dataProduct: { select: { id: true, name: true, contractVersion: true } },
        currentVersion: {
          select: {
            boundContractVersion: true,
            metrics: { select: { certifiedMetric: { select: { id: true, key: true } } } },
          },
        },
      },
    }),
    db.artifact.findMany({
      where: { agentId },
      select: {
        kind: true,
        currentVersion: { select: { versionNumber: true, content: true, contentHash: true } },
      },
    }),
    db.persona.findMany({
      where: { agents: { some: { agentId } }, archivedAt: null },
      select: { id: true, name: true },
    }),
  ]);

  return { agent, questions, coverage, bindings, artifacts, personas };
}

function artifactContent<T>(data: AgentExportData, kind: string): T | null {
  const artifact = data?.artifacts.find((a) => a.kind === kind);
  return artifact?.currentVersion ? (JSON.parse(artifact.currentVersion.content) as T) : null;
}

function graphInput(data: NonNullable<AgentExportData>) {
  return {
    agentName: data.agent.name,
    personas: data.personas,
    questions: data.questions.map((q) => ({ id: q.id, text: q.text, personaId: q.personaId })),
    bindings: data.bindings.map((b) => ({
      id: b.id,
      type: b.bindingType as BindingType,
      productId: b.dataProduct.id,
    })),
    products: data.bindings.map((b) => ({
      id: b.dataProduct.id,
      name: b.dataProduct.name,
      contractVersion: b.dataProduct.contractVersion,
    })),
    metrics: data.bindings.flatMap((b) =>
      (b.currentVersion?.metrics ?? []).map((m) => ({
        id: m.certifiedMetric.id,
        key: m.certifiedMetric.key,
        productId: b.dataProduct.id,
      })),
    ),
    coverage: data.coverage.map((row) => ({
      questionId: row.questionId,
      bindingId: row.bindingId,
      metricId: row.certifiedMetric?.id ?? null,
    })),
  };
}

/**
 * The question catalogue, as a workbook an SME can actually work in.
 *
 * Dropdowns on intent class and metric so a reviewer cannot invent a value that
 * would fail validation on the way back in, and a COUNTIFS summary so the
 * coverage number in the spreadsheet is computed rather than pasted.
 */
export async function buildQuestionCatalogue(
  data: NonNullable<AgentExportData>,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AMX";
  workbook.created = new Date();

  const metricKeys = [
    ...new Set(
      data.bindings.flatMap((b) =>
        (b.currentVersion?.metrics ?? []).map((m) => m.certifiedMetric.key),
      ),
    ),
  ];

  const sheet = workbook.addWorksheet("Questions");
  sheet.columns = [
    { header: "Question", key: "text", width: 60 },
    { header: "Persona", key: "persona", width: 28 },
    { header: "Intent", key: "intent", width: 16 },
    { header: "Consequence of no answer", key: "consequence", width: 60 },
    { header: "Expected answer shape", key: "shape", width: 40 },
    { header: "Certified metric", key: "metric", width: 28 },
    { header: "Data product", key: "product", width: 24 },
    { header: "Covered", key: "covered", width: 10 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const coverageByQuestion = new Map(data.coverage.map((row) => [row.questionId, row]));

  for (const question of data.questions) {
    const row = coverageByQuestion.get(question.id);
    sheet.addRow({
      text: question.text,
      persona: question.persona.name,
      intent: question.intentClass,
      consequence: question.consequenceOfNoAnswer,
      shape: question.expectedAnswerShape,
      metric: row?.certifiedMetric?.key ?? "",
      product: row?.binding.dataProduct.name ?? "",
      covered: row ? "yes" : "no",
    });
  }

  const lastRow = data.questions.length + 1;

  // Dropdowns, so a reviewer cannot type a value the validator would reject.
  for (let rowNumber = 2; rowNumber <= Math.max(lastRow, 200); rowNumber += 1) {
    sheet.getCell(`C${rowNumber}`).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [`"${INTENT_CLASSES.values.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Intent class",
      error: "Pick one of the catalogued intent classes.",
    };
    if (metricKeys.length > 0) {
      sheet.getCell(`F${rowNumber}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${metricKeys.join(",")}"`],
        showErrorMessage: true,
        errorTitle: "Certified metric",
        error: "Only metrics this agent is bound to can answer a question.",
      };
    }
  }

  const summary = workbook.addWorksheet("Coverage summary");
  summary.columns = [
    { header: "Measure", key: "measure", width: 40 },
    { header: "Value", key: "value", width: 18 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.addRow({ measure: "Questions", value: { formula: `COUNTA(Questions!A2:A${lastRow})` } });
  summary.addRow({
    measure: "Covered",
    value: { formula: `COUNTIF(Questions!H2:H${lastRow},"yes")` },
  });
  summary.addRow({
    measure: "Uncovered",
    value: { formula: `COUNTIF(Questions!H2:H${lastRow},"no")` },
  });
  summary.addRow({
    measure: "Coverage",
    value: { formula: `IF(B2=0,0,B3/B2)` },
  });
  summary.getCell("B5").numFmt = "0%";

  for (const intent of INTENT_CLASSES.values) {
    summary.addRow({
      measure: `Questions with intent "${intent}"`,
      value: { formula: `COUNTIF(Questions!C2:C${lastRow},"${intent}")` },
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export async function buildExport(
  db: AmxPrismaClient,
  input: { organizationId: string; agentId: string; format: ExportFormat },
): Promise<ExportResult | null> {
  const data = await loadAgentExportData(db, input.agentId);
  if (!data) return null;

  const slug = data.agent.slug;
  const encode = (value: string) => new TextEncoder().encode(value);

  switch (input.format) {
    case "question-catalog-xlsx":
      return {
        filename: `question-catalog-${slug}.xlsx`,
        contentType: CONTENT_TYPES.xlsx,
        bytes: await buildQuestionCatalogue(data),
      };

    case "grounding-pack-json": {
      const pack = artifactContent<unknown>(data, "grounding-pack");
      return {
        filename: `grounding-pack-${slug}.json`,
        contentType: CONTENT_TYPES.json,
        bytes: encode(JSON.stringify(pack ?? { error: "No grounding pack committed." }, null, 2)),
      };
    }

    case "listing-json": {
      const listing = artifactContent<unknown>(data, "agent-listing");
      return {
        filename: `agent-listing-${slug}.json`,
        contentType: CONTENT_TYPES.json,
        bytes: encode(JSON.stringify(listing ?? { error: "No listing committed." }, null, 2)),
      };
    }

    case "binding-graph-mmd":
      return {
        filename: `binding-graph-${slug}.mmd`,
        contentType: CONTENT_TYPES.mmd,
        bytes: encode(toMermaid(graphInput(data))),
      };

    case "binding-graph-svg":
      return {
        filename: `binding-graph-${slug}.svg`,
        contentType: CONTENT_TYPES.svg,
        bytes: encode(toSvg(graphInput(data)).svg),
      };

    case "evidence-pack-pdf":
    case "evidence-pack-docx": {
      const pack = await assembleEvidencePack(db, input.organizationId, input.agentId);
      if (!pack) return null;
      const isPdf = input.format === "evidence-pack-pdf";
      return {
        filename: `evidence-pack-${slug}-${pack.manifest.packHash.slice(0, 8)}.${isPdf ? "pdf" : "docx"}`,
        contentType: isPdf ? CONTENT_TYPES.pdf : CONTENT_TYPES.docx,
        bytes: isPdf ? await renderPackPdf(pack) : await renderPackDocx(pack),
      };
    }

    case "agent-bundle-zip": {
      const zip = new JSZip();
      const pack = await assembleEvidencePack(db, input.organizationId, input.agentId);

      // Every committed artifact, as YAML, exactly as the workspace mirror has it.
      for (const artifact of data.artifacts) {
        if (!artifact.currentVersion) continue;
        const content = JSON.parse(artifact.currentVersion.content);
        zip.file(
          `artifacts/${artifact.kind}.yaml`,
          toYaml(content, { sortMapEntries: true }),
        );
      }

      zip.file("question-catalog.xlsx", await buildQuestionCatalogue(data));
      zip.file("binding-graph.mmd", toMermaid(graphInput(data)));
      zip.file("binding-graph.svg", toSvg(graphInput(data)).svg);

      if (pack) {
        zip.file("evidence-pack.pdf", await renderPackPdf(pack));
        zip.file("evidence-pack.docx", await renderPackDocx(pack));
        zip.file("manifest.json", JSON.stringify(pack.manifest, null, 2));
      }

      zip.file(
        "README.txt",
        [
          `AMX agent bundle — ${data.agent.name}`,
          "",
          "artifacts/          every committed artifact version, as YAML",
          "question-catalog.xlsx  the question catalogue with a coverage summary",
          "binding-graph.*     what this agent stands on",
          "evidence-pack.*     the signed pack, with its manifest",
          "manifest.json       content hashes and the audit chain head",
          "",
          "Every file here is derived from committed artifact versions. The manifest",
          "lets you check this bundle against the system it came from.",
        ].join("\n"),
      );

      const bytes = await zip.generateAsync({ type: "uint8array" });
      return {
        filename: `agent-bundle-${slug}.zip`,
        contentType: CONTENT_TYPES.zip,
        bytes,
      };
    }

    default:
      return null;
  }
}
