/**
 * Stage 1 · Consumption Discovery.
 *
 * The most important screen in the product, so the model behind it is the
 * plain one: personas and questions are rows, and the artifact is *derived*
 * from them on every change. Nobody has to remember to "save the register",
 * and what a reviewer approves is provably what the workspace contains.
 *
 * Personas are workspace-scoped so the marketplace persona lens can rank
 * across agents; questions belong to one agent.
 */
import { commitArtifact } from "@/lib/artifacts/commit";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import type { IntentClass, PersonaKind } from "@/lib/enums";

export type PersonaInput = {
  id?: string;
  name: string;
  kind: PersonaKind;
  ownedDecisions: string;
  cadence: string;
  currentWorkaround: string;
};

export type QuestionInput = {
  id?: string;
  personaId: string;
  text: string;
  intentClass: IntentClass;
  consequenceOfNoAnswer: string;
  expectedAnswerShape: string;
};

export type StageOneContext = {
  organizationId: string;
  agentId: string;
  actorUserId: string | null;
};

function slugKey(value: string, fallback: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || fallback
  );
}

/**
 * Re-serialises personas and questions into the Stage 1 artifact.
 *
 * A commit with identical content is a no-op inside `commitArtifact`, so
 * editing a field and changing it back does not fire a spurious cascade.
 */
export async function commitPersonaRegister(
  db: AmxPrismaClient,
  ctx: StageOneContext,
): Promise<void> {
  const agent = await db.agent.findUnique({
    where: { id: ctx.agentId },
    select: { slug: true },
  });
  if (!agent) return;

  const personas = await db.persona.findMany({
    where: { archivedAt: null, agents: { some: { agentId: ctx.agentId } } },
    orderBy: { createdAt: "asc" },
    select: {
      key: true,
      name: true,
      kind: true,
      ownedDecisions: true,
      cadence: true,
      currentWorkaround: true,
      questions: {
        where: { agentId: ctx.agentId, archivedAt: null },
        orderBy: { priority: "asc" },
        select: {
          id: true,
          text: true,
          intentClass: true,
          consequenceOfNoAnswer: true,
          expectedAnswerShape: true,
          priority: true,
          packSourceKey: true,
        },
      },
    },
  });

  if (personas.length === 0) return;

  await commitArtifact(db, {
    organizationId: ctx.organizationId,
    agentId: ctx.agentId,
    stageId: "1-consumption-discovery",
    kind: "persona-question-register",
    authorUserId: ctx.actorUserId,
    content: {
      schemaVersion: "1.0.0",
      agentSlug: agent.slug,
      personas: personas.map((persona) => ({
        key: persona.key,
        name: persona.name,
        kind: persona.kind,
        ownedDecisions: persona.ownedDecisions,
        cadence: persona.cadence,
        currentWorkaround: persona.currentWorkaround,
        questions: persona.questions.map((question) => ({
          key: question.packSourceKey ?? question.id,
          text: question.text,
          intentClass: question.intentClass,
          consequenceOfNoAnswer: question.consequenceOfNoAnswer,
          expectedAnswerShape: question.expectedAnswerShape,
          priority: question.priority,
        })),
      })),
    },
  });
}

export async function savePersona(
  db: AmxPrismaClient,
  ctx: StageOneContext,
  input: PersonaInput,
): Promise<string> {
  const agent = await db.agent.findUnique({
    where: { id: ctx.agentId },
    select: { workspaceId: true },
  });
  if (!agent) throw new Error("Agent not found.");

  let personaId = input.id;

  if (personaId) {
    await db.persona.update({
      where: { id: personaId },
      data: {
        name: input.name,
        kind: input.kind,
        ownedDecisions: input.ownedDecisions,
        cadence: input.cadence,
        currentWorkaround: input.currentWorkaround,
      },
    });
  } else {
    const key = await uniquePersonaKey(db, ctx.organizationId, agent.workspaceId, input.name);
    const created = await db.persona.create({
      data: {
        organizationId: ctx.organizationId,
        workspaceId: agent.workspaceId,
        key,
        name: input.name,
        kind: input.kind,
        ownedDecisions: input.ownedDecisions,
        cadence: input.cadence,
        currentWorkaround: input.currentWorkaround,
      },
      select: { id: true },
    });
    personaId = created.id;
  }

  await db.agentPersona.upsert({
    where: { agentId_personaId: { agentId: ctx.agentId, personaId } },
    update: {},
    create: {
      organizationId: ctx.organizationId,
      agentId: ctx.agentId,
      personaId,
      isPrimary: false,
    },
  });

  await commitPersonaRegister(db, ctx);
  return personaId;
}

async function uniquePersonaKey(
  db: AmxPrismaClient,
  organizationId: string,
  workspaceId: string,
  name: string,
): Promise<string> {
  const base = slugKey(name, "persona");
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const key = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const clash = await db.persona.findUnique({
      where: { organizationId_workspaceId_key: { organizationId, workspaceId, key } },
      select: { id: true },
    });
    if (!clash) return key;
  }
  return `${base}-${Date.now()}`;
}

export async function saveQuestion(
  db: AmxPrismaClient,
  ctx: StageOneContext,
  input: QuestionInput,
): Promise<void> {
  if (input.id) {
    await db.question.update({
      where: { id: input.id },
      data: {
        personaId: input.personaId,
        text: input.text,
        intentClass: input.intentClass,
        consequenceOfNoAnswer: input.consequenceOfNoAnswer,
        expectedAnswerShape: input.expectedAnswerShape,
      },
    });
  } else {
    const count = await db.question.count({ where: { agentId: ctx.agentId, archivedAt: null } });
    await db.question.create({
      data: {
        organizationId: ctx.organizationId,
        agentId: ctx.agentId,
        personaId: input.personaId,
        text: input.text,
        intentClass: input.intentClass,
        consequenceOfNoAnswer: input.consequenceOfNoAnswer,
        expectedAnswerShape: input.expectedAnswerShape,
        priority: count,
      },
    });
  }

  await commitPersonaRegister(db, ctx);
}

/**
 * Archives rather than deletes — `archivedAt`, never a DELETE, so a question
 * that an approved gate once covered is still there to explain the approval.
 */
export async function archiveQuestion(
  db: AmxPrismaClient,
  ctx: StageOneContext,
  questionId: string,
): Promise<void> {
  await db.question.update({
    where: { id: questionId },
    data: { archivedAt: new Date() },
  });
  await db.questionCoverage.deleteMany({ where: { questionId } });
  await commitPersonaRegister(db, ctx);
}
