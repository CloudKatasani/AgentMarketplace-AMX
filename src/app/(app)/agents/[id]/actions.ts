"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSessionContext } from "@/lib/auth/session-context";
import { declareBinding, setQuestionCoverage } from "@/lib/bindings/service";
import { withOrg } from "@/lib/db/scope";
import { BINDING_TYPES, STAGE_KEYS, DECISIONS } from "@/lib/enums";
import { recordDecision, requestTransition } from "@/lib/gates";
import { roleKeySchema } from "@/lib/roles";

export type ActionState = { ok: boolean; message: string };

/**
 * Server actions are a trust boundary, so every one of them re-derives the
 * session and the organisation server-side and passes them to the engine. The
 * form is never asked which organisation it belongs to.
 */

const submitSchema = z.object({
  agentId: z.string().min(1),
  stageId: STAGE_KEYS.schema,
  soloAttestation: z.coerce.boolean().default(false),
});

export async function submitStageAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSessionContext();
  const parsed = submitSchema.safeParse({
    agentId: formData.get("agentId"),
    stageId: formData.get("stageId"),
    soloAttestation: formData.get("soloAttestation") === "on",
  });
  if (!parsed.success) return { ok: false, message: "That request was malformed." };

  const result = await withOrg(session.organizationId, (db) =>
    requestTransition(db, {
      organizationId: session.organizationId,
      agentId: parsed.data.agentId,
      stageId: parsed.data.stageId,
      actorUserId: session.userId,
      requestSoloAttestation: parsed.data.soloAttestation,
    }),
  );

  revalidatePath(`/agents/${parsed.data.agentId}`);

  if (result.ok) {
    return {
      ok: true,
      message:
        result.mode === "SOLO_ATTESTATION"
          ? "Submitted as a self-review. Record your attestation to close the gate."
          : "Submitted for review. The named approver roles can now decide.",
    };
  }
  if (result.reason === "CRITERIA_UNMET") {
    return {
      ok: false,
      message: `Not ready yet: ${result.blockers.map((b) => b.label).join("; ")}.`,
    };
  }
  if (result.reason === "ALREADY_OPEN") {
    return { ok: false, message: "This stage is already open for review." };
  }
  if (result.reason === "ARTIFACTS_MISSING") {
    return { ok: false, message: `Still missing: ${result.missingKinds.join(", ")}.` };
  }
  return { ok: false, message: result.detail };
}

const decisionSchema = z.object({
  agentId: z.string().min(1),
  gateId: z.string().min(1),
  roleKey: roleKeySchema,
  decision: DECISIONS.schema,
  comment: z.string().trim().optional(),
  attestationStatement: z.string().trim().optional(),
});

export async function recordDecisionAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSessionContext();
  const parsed = decisionSchema.safeParse({
    agentId: formData.get("agentId"),
    gateId: formData.get("gateId"),
    roleKey: formData.get("roleKey"),
    decision: formData.get("decision"),
    comment: formData.get("comment") || undefined,
    attestationStatement: formData.get("attestationStatement") || undefined,
  });
  if (!parsed.success) return { ok: false, message: "That decision was malformed." };

  const result = await withOrg(session.organizationId, (db) =>
    recordDecision(db, {
      organizationId: session.organizationId,
      gateId: parsed.data.gateId,
      actorUserId: session.userId,
      roleKey: parsed.data.roleKey,
      decision: parsed.data.decision,
      comment: parsed.data.comment,
      attestationStatement: parsed.data.attestationStatement,
    }),
  );

  revalidatePath(`/agents/${parsed.data.agentId}`);

  if (!result.ok) return { ok: false, message: result.detail };

  if (result.gateStatus === "APPROVED") {
    return {
      ok: true,
      message: result.advancedToStageId
        ? `Approved. The agent has moved to ${result.advancedToStageId.replace(/^\d+-/, "").replace(/-/g, " ")}.`
        : "Approved.",
    };
  }
  if (result.gateStatus === "OPEN") {
    return {
      ok: true,
      message: `Recorded. Still waiting on: ${result.outstandingRoles.join(", ")}.`,
    };
  }
  return { ok: true, message: `Recorded as ${result.gateStatus.toLowerCase().replace("_", " ")}.` };
}

const bindingSchema = z.object({
  agentId: z.string().min(1),
  dataProductId: z.string().min(1),
  type: BINDING_TYPES.schema,
  purpose: z.string().trim().min(10, "Say what this binding is for, in a sentence."),
  metricIds: z.array(z.string()).default([]),
});

export async function declareBindingAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSessionContext();
  const parsed = bindingSchema.safeParse({
    agentId: formData.get("agentId"),
    dataProductId: formData.get("dataProductId"),
    type: formData.get("type"),
    purpose: formData.get("purpose"),
    metricIds: formData.getAll("metricIds").map(String),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "That binding was malformed." };
  }

  const result = await withOrg(session.organizationId, (db) =>
    declareBinding(db, {
      organizationId: session.organizationId,
      agentId: parsed.data.agentId,
      dataProductId: parsed.data.dataProductId,
      type: parsed.data.type,
      purpose: parsed.data.purpose,
      metricIds: parsed.data.metricIds,
      actorUserId: session.userId,
    }),
  );

  revalidatePath(`/agents/${parsed.data.agentId}/stages/3-data-product-binding`);

  if (result.ok) return { ok: true, message: "Binding validated and committed." };
  return {
    ok: false,
    message: result.report.findings.map((f) => `${f.message} ${f.suggestedFix}`).join(" "),
  };
}

const coverageSchema = z.object({
  agentId: z.string().min(1),
  questionId: z.string().min(1),
  bindingId: z.string().min(1),
  certifiedMetricId: z.string().nullable().default(null),
});

export async function setCoverageAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSessionContext();
  const parsed = coverageSchema.safeParse({
    agentId: formData.get("agentId"),
    questionId: formData.get("questionId"),
    bindingId: formData.get("bindingId"),
    certifiedMetricId: formData.get("certifiedMetricId") || null,
  });
  if (!parsed.success) return { ok: false, message: "That mapping was malformed." };

  await withOrg(session.organizationId, (db) =>
    setQuestionCoverage(db, {
      organizationId: session.organizationId,
      questionId: parsed.data.questionId,
      bindingId: parsed.data.bindingId,
      certifiedMetricId: parsed.data.certifiedMetricId,
    }),
  );

  revalidatePath(`/agents/${parsed.data.agentId}/stages/3-data-product-binding`);
  return { ok: true, message: "Coverage updated." };
}
