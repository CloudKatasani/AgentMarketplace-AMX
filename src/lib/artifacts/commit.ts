/**
 * Committing an artifact version: validate, hash, version, audit — one
 * transaction — then mirror to `workspace/`.
 *
 * The mirror is written *after* the transaction commits, deliberately. A file
 * write cannot participate in a database transaction, so the choice is which
 * one is authoritative: the database is the record, `workspace/` is a
 * convenience for diffing and export. A missing mirror is recoverable; a
 * version row that exists only on disk is not.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringify as toYaml } from "yaml";
import { z } from "zod";

import { appendAuditEvent } from "@/lib/audit/append";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import type { ArtifactFormat, ArtifactKind } from "@/lib/enums";
import { canonicalize, contentHash } from "@/lib/hash";

import { ARTIFACT_SCHEMAS, isSchemaBacked } from "./schemas";
import { cascadeFromArtifactRevision } from "@/lib/gates/cascade";

export type CommitInput = {
  organizationId: string;
  agentId: string;
  stageId: string;
  kind: ArtifactKind;
  content: unknown;
  authorUserId: string | null;
  /** AI assist output is persisted as a draft and marked; it never satisfies a gate on its own. */
  isAiDraft?: boolean;
  format?: ArtifactFormat;
  /** Set false in tests that assert cascade separately. */
  runCascade?: boolean;
};

export type CommitResult =
  | {
      ok: true;
      versionId: string;
      versionNumber: number;
      contentHash: string;
      /** True when the content was byte-identical to the current version. */
      unchanged: boolean;
      mirrorPath: string;
      staleGateIds: string[];
    }
  | { ok: false; errors: { path: string; message: string }[] };

/** Mirror paths are project-relative; tests point this at a temporary directory. */
const PROJECT_ROOT = process.env.AMX_PROJECT_DIR ?? process.cwd();

const FORMAT_BY_KIND: Partial<Record<ArtifactKind, ArtifactFormat>> = {
  "persona-question-register": "yaml",
  "agent-charter": "yaml",
  "binding-set": "yaml",
  "grounding-pack": "json",
  "tool-specs": "yaml",
  "eval-harness": "yaml",
  "governance-review": "yaml",
  "datsisv-scorecard": "yaml",
  "agent-listing": "json",
};

export function mirrorPathFor(
  organizationId: string,
  agentSlug: string,
  kind: ArtifactKind,
  format: ArtifactFormat,
): string {
  const extension = format === "markdown" ? "md" : format;
  return path.join("workspace", organizationId, agentSlug, `${kind}.${extension}`);
}

function serialise(content: unknown, format: ArtifactFormat): string {
  if (format === "yaml") return toYaml(content, { sortMapEntries: true });
  if (format === "markdown") return String(content);
  return `${JSON.stringify(content, null, 2)}\n`;
}

/**
 * The only way an artifact version comes into existence.
 *
 * Re-committing identical content is a no-op that returns the existing version
 * rather than creating a new one — otherwise saving an unedited form would
 * invalidate every downstream gate and cry wolf.
 */
export async function commitArtifact(
  db: AmxPrismaClient,
  input: CommitInput,
): Promise<CommitResult> {
  if (isSchemaBacked(input.kind)) {
    const schema = ARTIFACT_SCHEMAS[input.kind] as z.ZodTypeAny;
    const parsed = schema.safeParse(input.content);
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((issue) => ({
          path: `/${issue.path.join("/")}`,
          message: issue.message,
        })),
      };
    }
    input = { ...input, content: parsed.data };
  }

  const agent = await db.agent.findUnique({
    where: { id: input.agentId },
    select: { id: true, slug: true },
  });
  if (!agent) return { ok: false, errors: [{ path: "/", message: "Agent not found." }] };

  const format = input.format ?? FORMAT_BY_KIND[input.kind] ?? "json";
  const hash = contentHash(input.content);
  const mirror = mirrorPathFor(input.organizationId, agent.slug, input.kind, format);

  const outcome = await db.$transaction(async (tx) => {
    const artifact = await tx.artifact.upsert({
      where: { agentId_kind: { agentId: input.agentId, kind: input.kind } },
      update: {},
      create: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        stageId: input.stageId,
        kind: input.kind,
      },
      select: { id: true, currentVersionId: true },
    });

    const current = artifact.currentVersionId
      ? await tx.artifactVersion.findUnique({
          where: { id: artifact.currentVersionId },
          select: { id: true, versionNumber: true, contentHash: true },
        })
      : null;

    if (current?.contentHash === hash) {
      return {
        versionId: current.id,
        versionNumber: current.versionNumber,
        unchanged: true,
        artifactId: artifact.id,
      };
    }

    const previous = await tx.artifactVersion.findFirst({
      where: { artifactId: artifact.id },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const versionNumber = (previous?.versionNumber ?? 0) + 1;

    const version = await tx.artifactVersion.create({
      data: {
        organizationId: input.organizationId,
        artifactId: artifact.id,
        versionNumber,
        contentHash: hash,
        content: canonicalize(input.content),
        schemaVersion:
          (input.content as { schemaVersion?: string } | null)?.schemaVersion ?? "1.0.0",
        format,
        mirrorPath: mirror,
        authorUserId: input.authorUserId,
        isAiDraft: input.isAiDraft ?? false,
      },
      select: { id: true, versionNumber: true },
    });

    await tx.artifact.update({
      where: { id: artifact.id },
      data: { currentVersionId: version.id },
    });

    await appendAuditEvent(tx as AmxPrismaClient, {
      organizationId: input.organizationId,
      type: "artifact.committed",
      subjectType: "ArtifactVersion",
      subjectId: version.id,
      actorUserId: input.authorUserId,
      payload: {
        agentId: input.agentId,
        kind: input.kind,
        versionNumber: version.versionNumber,
        contentHash: hash,
        isAiDraft: input.isAiDraft ?? false,
      },
    });

    return {
      versionId: version.id,
      versionNumber: version.versionNumber,
      unchanged: false,
      artifactId: artifact.id,
    };
  });

  // Mirror after the record is durable. See the note at the top of this file.
  const absolute = path.join(PROJECT_ROOT, mirror);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, serialise(input.content, format), "utf8");

  // A new version invalidates any gate that approved the previous snapshot.
  let staleGateIds: string[] = [];
  if (!outcome.unchanged && input.runCascade !== false) {
    staleGateIds = await cascadeFromArtifactRevision(db, {
      organizationId: input.organizationId,
      agentId: input.agentId,
      artifactKind: input.kind,
      actorUserId: input.authorUserId,
    });
  }

  return {
    ok: true,
    versionId: outcome.versionId,
    versionNumber: outcome.versionNumber,
    contentHash: hash,
    unchanged: outcome.unchanged,
    mirrorPath: mirror,
    staleGateIds,
  };
}
