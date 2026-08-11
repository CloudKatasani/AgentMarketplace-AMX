/**
 * Stage 2 · Agent Charter.
 *
 * Here the artifact *is* the truth — a charter has no row equivalent — so this
 * validates, commits, and then mirrors the two fields the rest of the product
 * filters on (archetype and risk tier) onto the agent.
 *
 * The Stage 1 hard block is enforced here as well as in the exit criteria. A
 * rule that only lives in the submit path is a rule you can walk around by
 * saving a draft; consumption-first has to hold at the point of authoring.
 */
import { commitArtifact } from "@/lib/artifacts/commit";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import { agentCharterSchema, type AgentCharter } from "@/lib/artifacts/schemas";

export type SaveCharterResult =
  | { ok: true; versionNumber: number }
  | { ok: false; errors: { path: string; message: string }[] };

const MINIMUM_QUESTIONS_PER_PERSONA = 3;

/** Does this agent have a Stage 1 persona complete enough to charter against? */
export async function hasQualifyingPersona(
  db: AmxPrismaClient,
  agentId: string,
): Promise<boolean> {
  const personas = await db.persona.findMany({
    where: { archivedAt: null, agents: { some: { agentId } } },
    select: {
      ownedDecisions: true,
      cadence: true,
      currentWorkaround: true,
      questions: {
        where: { agentId, archivedAt: null },
        select: { text: true, consequenceOfNoAnswer: true, expectedAnswerShape: true },
      },
    },
  });

  return personas.some(
    (persona) =>
      persona.ownedDecisions.trim() !== "" &&
      persona.cadence.trim() !== "" &&
      persona.currentWorkaround.trim() !== "" &&
      persona.questions.filter(
        (q) =>
          q.text.trim() !== "" &&
          q.consequenceOfNoAnswer.trim() !== "" &&
          q.expectedAnswerShape.trim() !== "",
      ).length >= MINIMUM_QUESTIONS_PER_PERSONA,
  );
}

export async function saveCharter(
  db: AmxPrismaClient,
  input: {
    organizationId: string;
    agentId: string;
    actorUserId: string | null;
    charter: unknown;
  },
): Promise<SaveCharterResult> {
  if (!(await hasQualifyingPersona(db, input.agentId))) {
    return {
      ok: false,
      errors: [
        {
          path: "/",
          message: `A charter needs a persona with at least ${MINIMUM_QUESTIONS_PER_PERSONA} complete questions behind it. Finish Stage 1 first — the scope of an agent comes from the questions it is meant to answer, not the other way round.`,
        },
      ],
    };
  }

  const parsed = agentCharterSchema.safeParse(input.charter);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: `/${issue.path.join("/")}`,
        message: issue.message,
      })),
    };
  }

  const charter: AgentCharter = parsed.data;

  const result = await commitArtifact(db, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    stageId: "2-agent-charter",
    kind: "agent-charter",
    authorUserId: input.actorUserId,
    content: charter,
  });
  if (!result.ok) return { ok: false, errors: result.errors };

  // Mirrored onto the agent so the marketplace can filter without parsing
  // every charter. The artifact stays authoritative.
  await db.agent.update({
    where: { id: input.agentId },
    data: { archetype: charter.archetype, riskTier: charter.riskTier },
  });

  return { ok: true, versionNumber: result.versionNumber };
}
