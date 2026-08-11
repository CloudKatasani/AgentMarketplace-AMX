import type { NextRequest } from "next/server";

import { apiRoute } from "@/lib/api/handler";
import { fail, ok } from "@/lib/api/respond";

/**
 * One agent, assembled the way the marketplace page is: consumption first —
 * personas and the questions they own — then what answers each question, then
 * the certification and who signed it.
 */
export function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  return apiRoute(async ({ scoped }) => {
    const { slug } = await context.params;

    const agent = await scoped.agent.findFirst({
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
        currentStageId: true,
        personas: { select: { persona: { select: { key: true, name: true, ownedDecisions: true } } } },
        questions: {
          where: { archivedAt: null },
          select: {
            id: true,
            text: true,
            intentClass: true,
            expectedAnswerShape: true,
            persona: { select: { key: true, name: true } },
            coverage: {
              select: {
                certifiedMetric: {
                  select: {
                    key: true,
                    name: true,
                    dataProduct: { select: { key: true, name: true, contractVersion: true } },
                  },
                },
              },
            },
          },
        },
        bindings: {
          where: { archivedAt: null },
          select: {
            bindingType: true,
            status: true,
            staleReason: true,
            dataProduct: { select: { key: true, name: true, contractVersion: true, layer: true } },
            currentVersion: {
              select: { boundContractVersion: true, purpose: true, versionNumber: true },
            },
          },
        },
        gates: {
          where: { status: "APPROVED" },
          orderBy: { stageId: "asc" },
          select: {
            stageId: true,
            mode: true,
            decidedAt: true,
            approvals: { select: { roleId: true, decision: true, isSelfAttestation: true } },
          },
        },
      },
    });

    if (!agent) return fail(404, "No agent with that slug in this workspace.");

    return ok({
      id: agent.id,
      slug: agent.slug,
      name: agent.name,
      summary: agent.summary,
      archetype: agent.archetype,
      riskTier: agent.riskTier,
      sensitivity: agent.sensitivity,
      status: agent.status,
      certification: agent.certification,
      staleReason: agent.staleReason,
      stage: agent.currentStageId,
      personas: agent.personas.map((link) => ({
        key: link.persona.key,
        name: link.persona.name,
        ownedDecisions: link.persona.ownedDecisions,
      })),
      questions: agent.questions.map((question) => ({
        id: question.id,
        text: question.text,
        intentClass: question.intentClass,
        expectedAnswerShape: question.expectedAnswerShape,
        persona: question.persona.key,
        answeredBy: question.coverage
          .filter((row) => row.certifiedMetric)
          .map((row) => ({
            metric: row.certifiedMetric!.key,
            metricName: row.certifiedMetric!.name,
            dataProduct: row.certifiedMetric!.dataProduct.key,
            contractVersion: row.certifiedMetric!.dataProduct.contractVersion,
          })),
      })),
      bindings: agent.bindings.map((binding) => ({
        type: binding.bindingType,
        status: binding.status,
        staleReason: binding.staleReason,
        purpose: binding.currentVersion?.purpose ?? null,
        versionNumber: binding.currentVersion?.versionNumber ?? null,
        dataProduct: binding.dataProduct.key,
        dataProductName: binding.dataProduct.name,
        layer: binding.dataProduct.layer,
        boundContractVersion: binding.currentVersion?.boundContractVersion ?? null,
        currentContractVersion: binding.dataProduct.contractVersion,
      })),
      approvals: agent.gates.map((gate) => ({
        stage: gate.stageId,
        mode: gate.mode,
        decidedAt: gate.decidedAt,
        // Who signed is a role and a decision — never a name, on an API a
        // machine reads.
        decisions: gate.approvals.map((approval) => ({
          role: approval.roleId,
          decision: approval.decision,
          selfAttestation: approval.isSelfAttestation,
        })),
      })),
    });
  })(request);
}
