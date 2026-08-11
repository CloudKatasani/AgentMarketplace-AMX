"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSessionContext } from "@/lib/auth/session-context";
import { track } from "@/lib/analytics";
import { registerDataProductFromImport } from "@/lib/data-products/import";
import { withOrg } from "@/lib/db/scope";
import { INTENT_CLASSES, PERSONA_KINDS, STAGE_KEYS } from "@/lib/enums";
import { assertMutable } from "@/lib/gates";
import { delimitedRows, lines, repeatedRows, text } from "@/lib/forms";
import { saveCharter } from "@/lib/stages/charter";
import { archiveQuestion, savePersona, saveQuestion } from "@/lib/stages/consumption";
import { saveGroundingPack, saveToolSpecs } from "@/lib/stages/grounding";
import { addStageComment, resolveComment } from "@/lib/stages/review";

import type { ActionState } from "../../actions";

/**
 * Stage authoring actions.
 *
 * Every one re-derives the session server-side and refuses when the
 * organisation is read-only, so the showcase tenant cannot be edited by anyone
 * who finds the form.
 */
async function guard(): Promise<
  | { ok: true; session: Awaited<ReturnType<typeof requireSessionContext>> }
  | { ok: false; state: ActionState }
> {
  const session = await requireSessionContext();
  const mutable = await withOrg(session.organizationId, (db) =>
    assertMutable(db, session.organizationId),
  );
  if (!mutable.ok) return { ok: false, state: { ok: false, message: mutable.detail } };
  return { ok: true, session };
}

function refresh(agentId: string, stageId: string): void {
  revalidatePath(`/agents/${agentId}/stages/${stageId}`);
  revalidatePath(`/agents/${agentId}`);
}

// ───────────────────────── Stage 1 ─────────────────────────

const personaSchema = z.object({
  agentId: z.string().min(1),
  personaId: z.string().optional(),
  name: z.string().trim().min(2, "Give the persona a name — a real role, not a department."),
  kind: PERSONA_KINDS.schema,
  ownedDecisions: z
    .string()
    .trim()
    .min(10, "What does this person decide? An agent exists to unblock a decision."),
  cadence: z.string().trim().min(2, "How often do they face it?"),
  currentWorkaround: z
    .string()
    .trim()
    .min(10, "What do they do today instead? That is the baseline the agent has to beat."),
});

export async function savePersonaAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guard();
  if (!guarded.ok) return guarded.state;

  const parsed = personaSchema.safeParse({
    agentId: formData.get("agentId"),
    personaId: text(formData, "personaId") || undefined,
    name: formData.get("name"),
    kind: formData.get("kind"),
    ownedDecisions: formData.get("ownedDecisions"),
    cadence: formData.get("cadence"),
    currentWorkaround: formData.get("currentWorkaround"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "That persona was malformed." };
  }

  const { session } = guarded;
  await withOrg(session.organizationId, (db) =>
    savePersona(
      db,
      {
        organizationId: session.organizationId,
        agentId: parsed.data.agentId,
        actorUserId: session.userId,
      },
      {
        id: parsed.data.personaId,
        name: parsed.data.name,
        kind: parsed.data.kind,
        ownedDecisions: parsed.data.ownedDecisions,
        cadence: parsed.data.cadence,
        currentWorkaround: parsed.data.currentWorkaround,
      },
    ),
  );

  refresh(parsed.data.agentId, "1-consumption-discovery");
  return {
    ok: true,
    message: parsed.data.personaId ? "Persona updated." : "Persona added.",
  };
}

const questionSchema = z.object({
  agentId: z.string().min(1),
  questionId: z.string().optional(),
  personaId: z.string().min(1, "Pick the persona who asks this."),
  questionText: z.string().trim().min(8, "Write the question as they would ask it."),
  intentClass: INTENT_CLASSES.schema,
  consequenceOfNoAnswer: z
    .string()
    .trim()
    .min(10, "What goes wrong without an answer? A question with no consequence is a nice-to-have."),
  expectedAnswerShape: z.string().trim().min(3, "What shape is a good answer?"),
});

export async function saveQuestionAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guard();
  if (!guarded.ok) return guarded.state;

  const parsed = questionSchema.safeParse({
    agentId: formData.get("agentId"),
    questionId: text(formData, "questionId") || undefined,
    personaId: formData.get("personaId"),
    questionText: formData.get("questionText"),
    intentClass: formData.get("intentClass"),
    consequenceOfNoAnswer: formData.get("consequenceOfNoAnswer"),
    expectedAnswerShape: formData.get("expectedAnswerShape"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "That question was malformed." };
  }

  const { session } = guarded;
  await withOrg(session.organizationId, (db) =>
    saveQuestion(
      db,
      {
        organizationId: session.organizationId,
        agentId: parsed.data.agentId,
        actorUserId: session.userId,
      },
      {
        id: parsed.data.questionId,
        personaId: parsed.data.personaId,
        text: parsed.data.questionText,
        intentClass: parsed.data.intentClass,
        consequenceOfNoAnswer: parsed.data.consequenceOfNoAnswer,
        expectedAnswerShape: parsed.data.expectedAnswerShape,
      },
    ),
  );

  refresh(parsed.data.agentId, "1-consumption-discovery");
  return { ok: true, message: parsed.data.questionId ? "Question updated." : "Question added." };
}

export async function archiveQuestionAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guard();
  if (!guarded.ok) return guarded.state;

  const agentId = text(formData, "agentId");
  const questionId = text(formData, "questionId");
  if (!agentId || !questionId) return { ok: false, message: "That request was malformed." };

  const { session } = guarded;
  await withOrg(session.organizationId, (db) =>
    archiveQuestion(
      db,
      { organizationId: session.organizationId, agentId, actorUserId: session.userId },
      questionId,
    ),
  );

  refresh(agentId, "1-consumption-discovery");
  return {
    ok: true,
    message: "Question archived. It stays in the record so past approvals still make sense.",
  };
}

// ───────────────────────── Stage 2 ─────────────────────────

export async function saveCharterAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guard();
  if (!guarded.ok) return guarded.state;

  const agentId = text(formData, "agentId");
  const { session } = guarded;

  const result = await withOrg(session.organizationId, (db) =>
    saveCharter(db, {
      organizationId: session.organizationId,
      agentId,
      actorUserId: session.userId,
      charter: {
        schemaVersion: "1.0.0",
        archetype: text(formData, "archetype"),
        mission: text(formData, "mission"),
        scopeBoundary: text(formData, "scopeBoundary"),
        outOfScope: lines(formData.get("outOfScope")),
        valueHypothesis: text(formData, "valueHypothesis"),
        successMeasures: lines(formData.get("successMeasures")),
        riskTier: text(formData, "riskTier"),
        ownerName: text(formData, "ownerName"),
        escalationContact: text(formData, "escalationContact"),
      },
    }),
  );

  refresh(agentId, "2-agent-charter");
  if (result.ok) return { ok: true, message: `Charter committed as version ${result.versionNumber}.` };
  return { ok: false, message: result.errors.map((e) => e.message).join(" ") };
}

// ───────────────────────── Stage 3 ─────────────────────────

export async function importDataProductAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guard();
  if (!guarded.ok) return guarded.state;

  const agentId = text(formData, "agentId");
  const raw = text(formData, "payload");

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      message:
        "That is not valid JSON. Paste the export as one object with `listing`, `contract`, and `semanticModel` keys.",
    };
  }

  const { session } = guarded;
  const result = await withOrg(session.organizationId, async (db) => {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      select: { workspaceId: true },
    });
    if (!agent) return { ok: false as const, errors: [{ path: "/", message: "Agent not found." }] };

    return registerDataProductFromImport(db, {
      organizationId: session.organizationId,
      workspaceId: agent.workspaceId,
      actorUserId: session.userId,
      payload,
    });
  });

  refresh(agentId, "3-data-product-binding");
  if (result.ok) {
    return {
      ok: true,
      message: `Registered with ${result.metricCount} metric${result.metricCount === 1 ? "" : "s"}. You can bind to it now.`,
    };
  }
  return { ok: false, message: result.errors.map((e) => e.message).join(" ") };
}

// ───────────────────────── Stage 4 ─────────────────────────

export async function saveGroundingPackAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guard();
  if (!guarded.ok) return guarded.state;

  const agentId = text(formData, "agentId");
  const agentSlug = text(formData, "agentSlug");
  const { session } = guarded;

  const document = {
    schemaVersion: "1.0.0",
    agentSlug,
    sampleQuestions: repeatedRows(formData, "sample", [
      "question",
      "metricKey",
      "expectedAnswerShape",
    ]),
    glossary: delimitedRows(formData.get("glossary"), 2).map(([term, definition]) => ({
      term,
      definition,
    })),
    metricDefinitions: repeatedRows(formData, "metric", ["key", "definition", "grain"]),
    allowedJoins: delimitedRows(formData.get("allowedJoins"), 3).map(([from, to, on]) => ({
      from,
      to,
      on,
    })),
    disambiguationHints: delimitedRows(formData.get("hints"), 2).map(
      ([ambiguousTerm, resolution]) => ({ ambiguousTerm, resolution }),
    ),
  };

  const result = await withOrg(session.organizationId, (db) =>
    saveGroundingPack(db, {
      organizationId: session.organizationId,
      agentId,
      actorUserId: session.userId,
      document,
    }),
  );

  refresh(agentId, "4-grounding-and-tools");
  if (result.ok) {
    return { ok: true, message: `Grounding pack committed as version ${result.versionNumber}.` };
  }
  return { ok: false, message: result.errors.map((e) => e.message).join(" ") };
}

export async function saveToolSpecsAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guard();
  if (!guarded.ok) return guarded.state;

  const agentId = text(formData, "agentId");
  const agentSlug = text(formData, "agentSlug");
  const { session } = guarded;

  const rows = repeatedRows(formData, "tool", [
    "name",
    "description",
    "bindingRef",
    "inputs",
    "outputs",
    "refusalRules",
    "escalationPath",
  ]);

  const document = {
    schemaVersion: "1.0.0",
    agentSlug,
    tools: rows.map((row) => ({
      name: row.name,
      description: row.description,
      bindingRef: row.bindingRef,
      inputs: parseFields(row.inputs),
      outputs: parseFields(row.outputs),
      refusalRules: row.refusalRules
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      escalationPath: row.escalationPath,
    })),
  };

  const result = await withOrg(session.organizationId, (db) =>
    saveToolSpecs(db, {
      organizationId: session.organizationId,
      agentId,
      actorUserId: session.userId,
      document,
    }),
  );

  refresh(agentId, "4-grounding-and-tools");
  if (result.ok) {
    return { ok: true, message: `Tool specifications committed as version ${result.versionNumber}.` };
  }
  return { ok: false, message: result.errors.map((e) => e.message).join(" ") };
}

/** `name | type | description | required?` per line. */
function parseFields(value: string): {
  name: string;
  type: string;
  description: string;
  required: boolean;
}[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", type = "string", description = "", required = "yes"] = line
        .split("|")
        .map((part) => part.trim());
      return {
        name,
        type: type || "string",
        description,
        required: !/^(no|false|optional)$/i.test(required),
      };
    });
}

// ───────────────────── Review loop ─────────────────────

const commentSchema = z.object({
  agentId: z.string().min(1),
  stageId: STAGE_KEYS.schema,
  body: z.string().trim().min(3, "Say something a reader can act on."),
  fieldPath: z.string().trim().optional(),
  isParkingLot: z.boolean().default(false),
});

export async function addCommentAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guard();
  if (!guarded.ok) return guarded.state;

  const parsed = commentSchema.safeParse({
    agentId: formData.get("agentId"),
    stageId: formData.get("stageId"),
    body: formData.get("body"),
    fieldPath: text(formData, "fieldPath") || undefined,
    isParkingLot: formData.get("isParkingLot") === "on",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "That comment was malformed." };
  }

  const { session } = guarded;
  await withOrg(session.organizationId, (db) =>
    addStageComment(db, {
      organizationId: session.organizationId,
      agentId: parsed.data.agentId,
      stageId: parsed.data.stageId,
      authorUserId: session.userId,
      body: parsed.data.body,
      fieldPath: parsed.data.fieldPath ?? null,
      isParkingLot: parsed.data.isParkingLot,
    }),
  );

  refresh(parsed.data.agentId, parsed.data.stageId);
  return {
    ok: true,
    message: parsed.data.isParkingLot ? "Added to the parking lot." : "Comment added.",
  };
}

export async function resolveCommentAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guard();
  if (!guarded.ok) return guarded.state;

  const agentId = text(formData, "agentId");
  const stageId = text(formData, "stageId");
  const commentId = text(formData, "commentId");
  if (!commentId) return { ok: false, message: "That request was malformed." };

  const { session } = guarded;
  await withOrg(session.organizationId, (db) =>
    resolveComment(db, session.organizationId, commentId, session.userId),
  );

  refresh(agentId, stageId);
  return { ok: true, message: "Marked resolved." };
}

// ───────────────────── Onboarding tour ─────────────────────

export async function trackTourStepAction(step: string, index: number): Promise<void> {
  const session = await requireSessionContext();
  await track({
    name: "onboarding_step_completed",
    organizationId: session.organizationId,
    userId: session.userId,
    properties: { step, index, surface: "guided-tour" },
  });
}
