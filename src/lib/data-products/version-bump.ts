/**
 * Bumping a data product's contract version.
 *
 * A major bump is the trigger for cascade direction 2 — the moment a certified
 * agent discovers that what it stands on has moved. Minor and patch bumps are
 * recorded but do not cascade: a governance tool that cries wolf on every patch
 * gets switched off.
 */
import { appendAuditEvent } from "@/lib/audit/append";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import { cascadeFromProductMajorBump, type ProductCascadeResult } from "@/lib/gates/cascade";
import { contentHash } from "@/lib/hash";

export type VersionBumpInput = {
  organizationId: string;
  dataProductId: string;
  contractVersion: string;
  semanticModelVersion?: string;
  changeSummary: string;
  actorUserId: string | null;
};

export type VersionBumpResult =
  | { ok: true; isMajorBump: boolean; cascade: ProductCascadeResult }
  | { ok: false; detail: string };

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(
  version: string,
): { major: number; minor: number; patch: number } | null {
  const match = SEMVER.exec(version.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export async function bumpContractVersion(
  db: AmxPrismaClient,
  input: VersionBumpInput,
): Promise<VersionBumpResult> {
  const parsed = parseSemver(input.contractVersion);
  if (!parsed) {
    return { ok: false, detail: `"${input.contractVersion}" is not a semantic version (major.minor.patch).` };
  }

  const product = await db.dataProduct.findUnique({
    where: { id: input.dataProductId },
    select: {
      id: true,
      name: true,
      contractVersion: true,
      contractMajor: true,
      contractMinor: true,
      contractPatch: true,
      semanticModelVersion: true,
    },
  });
  if (!product) return { ok: false, detail: "Data product not found." };

  const previous = {
    major: product.contractMajor,
    minor: product.contractMinor,
    patch: product.contractPatch,
  };
  const isForward =
    parsed.major > previous.major ||
    (parsed.major === previous.major && parsed.minor > previous.minor) ||
    (parsed.major === previous.major &&
      parsed.minor === previous.minor &&
      parsed.patch > previous.patch);
  if (!isForward) {
    return {
      ok: false,
      detail: `${product.name} is already on ${product.contractVersion}. Contract versions only move forward.`,
    };
  }

  const semanticModelVersion = input.semanticModelVersion ?? product.semanticModelVersion;
  const isMajorBump = parsed.major > previous.major;

  await db.$transaction(async (tx) => {
    await tx.dataProductVersion.create({
      data: {
        organizationId: input.organizationId,
        dataProductId: product.id,
        contractVersion: input.contractVersion,
        contractMajor: parsed.major,
        contractMinor: parsed.minor,
        contractPatch: parsed.patch,
        semanticModelVersion,
        changeSummary: input.changeSummary,
        contentHash: contentHash({
          contractVersion: input.contractVersion,
          semanticModelVersion,
          changeSummary: input.changeSummary,
        }),
      },
    });

    await tx.dataProduct.update({
      where: { id: product.id },
      data: {
        contractVersion: input.contractVersion,
        contractMajor: parsed.major,
        contractMinor: parsed.minor,
        contractPatch: parsed.patch,
        semanticModelVersion,
      },
    });

    await appendAuditEvent(tx as AmxPrismaClient, {
      organizationId: input.organizationId,
      type: "dataproduct.version-bumped",
      subjectType: "DataProduct",
      subjectId: product.id,
      actorUserId: input.actorUserId,
      payload: {
        from: product.contractVersion,
        to: input.contractVersion,
        isMajorBump,
        changeSummary: input.changeSummary,
      },
    });
  });

  // Synchronous on purpose: the STALE banner must be there on the next render.
  const cascade = isMajorBump
    ? await cascadeFromProductMajorBump(db, {
        organizationId: input.organizationId,
        dataProductId: product.id,
        previousVersion: product.contractVersion,
        newVersion: input.contractVersion,
        newMajor: parsed.major,
        actorUserId: input.actorUserId,
      })
    : { staleBindingIds: [], staleAgentIds: [], taskCount: 0 };

  return { ok: true, isMajorBump, cascade };
}
