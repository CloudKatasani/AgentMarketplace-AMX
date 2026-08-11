"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSessionContext } from "@/lib/auth/session-context";
import { assertMutable } from "@/lib/gates";
import { withOrg } from "@/lib/db/scope";
import { bumpContractVersion } from "@/lib/data-products/version-bump";

export type ActionState = { ok: boolean; message: string };

const bumpSchema = z.object({
  dataProductId: z.string().min(1),
  contractVersion: z.string().trim().min(5),
  changeSummary: z.string().trim().min(10, "Say what changed — the cascade message quotes it."),
});

/**
 * Bumping a contract version.
 *
 * A major bump cascades synchronously, so by the time this action returns, the
 * dependent agents are already showing STALE. That is deliberate: the demo's
 * money moment cannot depend on a background worker.
 */
export async function bumpVersionAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSessionContext();

  const parsed = bumpSchema.safeParse({
    dataProductId: formData.get("dataProductId"),
    contractVersion: formData.get("contractVersion"),
    changeSummary: formData.get("changeSummary"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "That request was malformed." };
  }

  const result = await withOrg(session.organizationId, async (db) => {
    const guard = await assertMutable(db, session.organizationId);
    if (!guard.ok) return { ok: false as const, detail: guard.detail };

    return bumpContractVersion(db, {
      organizationId: session.organizationId,
      dataProductId: parsed.data.dataProductId,
      contractVersion: parsed.data.contractVersion,
      changeSummary: parsed.data.changeSummary,
      actorUserId: session.userId,
    });
  });

  revalidatePath("/data-products");
  revalidatePath("/agents");

  if (!result.ok) return { ok: false, message: "detail" in result ? result.detail : "Failed." };

  if (!result.isMajorBump) {
    return {
      ok: true,
      message:
        "Version recorded. This was not a breaking change, so nothing was invalidated — minor and patch bumps deliberately do not cascade.",
    };
  }

  const { staleAgentIds, staleBindingIds, taskCount } = result.cascade;
  if (staleAgentIds.length === 0) {
    return { ok: true, message: "Major version recorded. No agent was bound to an older major." };
  }
  return {
    ok: true,
    message: `Breaking change recorded. ${staleAgentIds.length} agent${staleAgentIds.length === 1 ? "" : "s"} and ${staleBindingIds.length} binding${staleBindingIds.length === 1 ? "" : "s"} are now stale, and ${taskCount} re-certification task${taskCount === 1 ? "" : "s"} have been raised.`,
  };
}
