/**
 * Stage 4 · Grounding & Tool Design.
 *
 * Both documents go through the binding validator before they are written, and
 * the validator walks *every* string in the structure rather than the fields
 * anyone remembered to check. A grounding pack is exactly where a raw table
 * reference sneaks back in, so this is the second place the semantic-layer rule
 * is enforced — the first being the binding itself.
 */
import { commitArtifact } from "@/lib/artifacts/commit";
import {
  groundingPackSchema,
  toolSpecsSchema,
  type GroundingPack,
  type ToolSpecs,
} from "@/lib/artifacts/schemas";
import { loadBindingContext } from "@/lib/bindings/service";
import { validateDocumentReferences, type ValidationReport } from "@/lib/bindings/validate";
import type { AmxPrismaClient } from "@/lib/db/tenancy";

export type SaveStageFourResult =
  | { ok: true; versionNumber: number; report: ValidationReport }
  | { ok: false; errors: { path: string; message: string }[]; report?: ValidationReport };

export type StageFourInput = {
  organizationId: string;
  agentId: string;
  actorUserId: string | null;
  document: unknown;
};

/**
 * Seeds a grounding pack from what the agent already has.
 *
 * Stage 4 should not begin with a blank page: the sample questions are the
 * Stage 1 register and the metric definitions are the metrics the Stage 3
 * bindings named. The author edits rather than invents.
 */
export async function draftGroundingPack(
  db: AmxPrismaClient,
  agentId: string,
): Promise<GroundingPack | null> {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { slug: true },
  });
  if (!agent) return null;

  const [questions, coverage, bindings] = await Promise.all([
    db.question.findMany({
      where: { agentId, archivedAt: null },
      orderBy: { priority: "asc" },
      select: { id: true, text: true, expectedAnswerShape: true },
    }),
    db.questionCoverage.findMany({
      where: { question: { agentId } },
      select: { questionId: true, certifiedMetric: { select: { key: true } } },
    }),
    db.binding.findMany({
      where: { agentId, archivedAt: null },
      select: {
        currentVersion: {
          select: {
            metrics: {
              select: {
                certifiedMetric: { select: { key: true, definition: true, grain: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const metricByQuestion = new Map(
    coverage
      .filter((row) => row.certifiedMetric)
      .map((row) => [row.questionId, row.certifiedMetric!.key]),
  );

  const metrics = new Map<string, { key: string; definition: string; grain: string }>();
  for (const binding of bindings) {
    for (const entry of binding.currentVersion?.metrics ?? []) {
      metrics.set(entry.certifiedMetric.key, {
        key: entry.certifiedMetric.key,
        definition: entry.certifiedMetric.definition,
        grain: entry.certifiedMetric.grain,
      });
    }
  }

  return {
    schemaVersion: "1.0.0",
    agentSlug: agent.slug,
    sampleQuestions: questions.map((question) => ({
      question: question.text,
      metricKey: metricByQuestion.get(question.id) ?? "",
      expectedAnswerShape: question.expectedAnswerShape,
    })),
    glossary: [],
    metricDefinitions: [...metrics.values()],
    allowedJoins: [],
    disambiguationHints: [],
  };
}

export async function saveGroundingPack(
  db: AmxPrismaClient,
  input: StageFourInput,
): Promise<SaveStageFourResult> {
  const ctx = await loadBindingContext(db, input.agentId);

  // Validate the RAW document, before the schema parse.
  //
  // Zod strips unknown keys, so a `sql` field would be quietly dropped and the
  // author would never learn why. Silently removing the text-to-SQL surface is
  // not the same as refusing it — the refusal is the product feature.
  const report = validateDocumentReferences(
    input.document,
    "grounding-pack",
    input.agentId,
    ctx,
  );
  if (!report.ok) {
    return {
      ok: false,
      report,
      errors: report.findings.map((finding) => ({
        path: finding.subject.field ?? "/",
        message: `${finding.message} ${finding.suggestedFix}`,
      })),
    };
  }

  const parsed = groundingPackSchema.safeParse(input.document);
  if (!parsed.success) {
    return {
      ok: false,
      report,
      errors: parsed.error.issues.map((issue) => ({
        path: `/${issue.path.join("/")}`,
        message: issue.message,
      })),
    };
  }

  const result = await commitArtifact(db, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    stageId: "4-grounding-and-tools",
    kind: "grounding-pack",
    authorUserId: input.actorUserId,
    content: parsed.data,
  });
  if (!result.ok) return { ok: false, errors: result.errors, report };

  return { ok: true, versionNumber: result.versionNumber, report };
}

export async function saveToolSpecs(
  db: AmxPrismaClient,
  input: StageFourInput,
): Promise<SaveStageFourResult> {
  const ctx = await loadBindingContext(db, input.agentId);

  // Raw first, for the same reason as the grounding pack: a `sql` field that
  // Zod would strip has to be refused out loud, not quietly deleted.
  const report = validateDocumentReferences(input.document, "tool-spec", input.agentId, ctx);
  if (!report.ok) {
    return {
      ok: false,
      report,
      errors: report.findings.map((finding) => ({
        path: finding.subject.field ?? "/",
        message: `${finding.message} ${finding.suggestedFix}`,
      })),
    };
  }

  const parsed = toolSpecsSchema.safeParse(input.document);
  if (!parsed.success) {
    return {
      ok: false,
      report,
      errors: parsed.error.issues.map((issue) => ({
        path: `/${issue.path.join("/")}`,
        message: issue.message,
      })),
    };
  }

  const specs: ToolSpecs = parsed.data;

  // Every tool must act through a binding that exists on this agent.
  const bindings = await db.binding.findMany({
    where: { agentId: input.agentId, archivedAt: null },
    select: { id: true, bindingType: true, dataProduct: { select: { key: true, name: true } } },
  });
  const known = new Set(bindings.map((b) => `${b.dataProduct.key}:${b.bindingType}`));

  const orphans = specs.tools.filter((tool) => !known.has(tool.bindingRef));
  if (orphans.length > 0) {
    return {
      ok: false,
      errors: orphans.map((tool) => ({
        path: `/tools/${specs.tools.indexOf(tool)}/bindingRef`,
        message: `The tool "${tool.name}" acts through "${tool.bindingRef}", which is not a binding on this agent. A tool with no binding behind it is ungoverned — pick one of: ${[...known].join(", ") || "none declared yet, so add a binding at Stage 3 first"}.`,
      })),
    };
  }

  const result = await commitArtifact(db, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    stageId: "4-grounding-and-tools",
    kind: "tool-specs",
    authorUserId: input.actorUserId,
    content: specs,
  });
  if (!result.ok) return { ok: false, errors: result.errors, report };

  return { ok: true, versionNumber: result.versionNumber, report };
}
