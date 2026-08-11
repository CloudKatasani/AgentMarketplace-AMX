/**
 * What a gate actually approves.
 *
 * Not "stage 3 of agent X" — a specific set of artifact version hashes. Storing
 * that as `Gate.snapshotHash` is what makes cascade invalidation provable
 * rather than heuristic: if the recomputed snapshot differs from the one on the
 * gate, what was approved is demonstrably not what exists now.
 */
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import { snapshotHash } from "@/lib/hash";
import { stageByKey } from "@/lib/lifecycle/stages";

export async function computeStageSnapshot(
  db: AmxPrismaClient,
  agentId: string,
  stageId: string,
): Promise<{ hash: string; versionIds: string[]; missingKinds: string[] }> {
  const stage = stageByKey(stageId);

  const artifacts = await db.artifact.findMany({
    where: { agentId, kind: { in: [...stage.requiredArtifacts] } },
    select: {
      kind: true,
      currentVersion: { select: { id: true, contentHash: true } },
    },
  });

  const present = artifacts.filter((a) => a.currentVersion !== null);
  const missingKinds = stage.requiredArtifacts.filter(
    (kind) => !present.some((a) => a.kind === kind),
  );

  return {
    hash: snapshotHash(present.map((a) => a.currentVersion!.contentHash)),
    versionIds: present.map((a) => a.currentVersion!.id),
    missingKinds,
  };
}
