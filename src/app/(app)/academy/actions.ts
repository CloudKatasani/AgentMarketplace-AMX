"use server";

import { revalidatePath } from "next/cache";

import { completeModule, startPath } from "@/lib/academy";
import { requireSessionContext } from "@/lib/auth/session-context";
import { withOrg } from "@/lib/db/scope";
import { text } from "@/lib/forms";

import type { ActionState } from "@/app/(app)/agents/[id]/actions";

/**
 * Academy progress is per-person, so these actions never check the read-only
 * flag: learning in the demo workspace is exactly what a demo visitor should
 * be able to do, and nothing they do affects anyone else's agents.
 */
export async function startPathAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSessionContext();
  const pathKey = text(formData, "pathKey");
  const packKey = text(formData, "packKey");

  await withOrg(session.organizationId, (db) =>
    startPath(db, {
      organizationId: session.organizationId,
      userId: session.userId,
      packKey,
      pathKey,
    }),
  );

  revalidatePath(`/academy/${pathKey}`);
  revalidatePath("/academy");
  return { ok: true, message: "Path started." };
}

export async function completeModuleAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSessionContext();
  const pathKey = text(formData, "pathKey");
  const packKey = text(formData, "packKey");
  const courseKey = text(formData, "courseKey");
  const moduleKey = text(formData, "moduleKey");

  const answers: number[] = [];
  for (const [key, value] of formData.entries()) {
    const match = /^answer\.(\d+)$/.exec(key);
    if (match) answers[Number(match[1])] = Number(value);
  }

  const result = await withOrg(session.organizationId, (db) =>
    completeModule(db, {
      organizationId: session.organizationId,
      userId: session.userId,
      packKey,
      pathKey,
      courseKey,
      moduleKey,
      answers,
    }),
  );

  revalidatePath(`/academy/${pathKey}`);
  revalidatePath("/academy");

  if (!result) return { ok: false, message: "That module could not be found." };
  if (!result.passed) {
    return {
      ok: false,
      message: `${result.score} of ${result.outOf} correct. Every answer has to be right — this credential can gate who may approve an agent, so a near-miss is not a pass. Read the explanations and try again.`,
    };
  }
  if (result.credentialAwarded) {
    return {
      ok: true,
      message: `Module complete — and that finishes the path. The ${result.credentialAwarded.replace(/-/g, " ")} has been awarded and recorded in the audit trail.`,
    };
  }
  return { ok: true, message: "Module complete." };
}
