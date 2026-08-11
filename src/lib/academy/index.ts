/**
 * The Academy.
 *
 * Content lives in packs; progress and credentials live in the tenant. Two
 * things make this more than a course catalogue:
 *
 *   1. **Labs point at live objects.** "Open the coverage matrix for an agent
 *      in your workspace and follow one question to its metric" teaches more
 *      than a screenshot, and it cannot go stale relative to the product.
 *   2. **A credential is an audit event.** It is evidence that a named person
 *      demonstrated something, so it belongs in the append-only record — and an
 *      organisation may require it before an approver role can be exercised.
 */
import { track } from "@/lib/analytics";
import { appendAuditEvent } from "@/lib/audit/append";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import { loadPack } from "@/lib/packs/load";
import type { PackAcademyPath } from "@/lib/packs/schema";
import { roleName } from "@/lib/roles";

export type AcademyModuleProgress = {
  courseKey: string;
  moduleKey: string;
  title: string;
  completed: boolean;
  score: number;
  outOf: number;
};

export type AcademyPathProgress = {
  path: PackAcademyPath;
  packKey: string;
  started: boolean;
  completedModules: number;
  totalModules: number;
  modules: AcademyModuleProgress[];
  credentialHeld: boolean;
  /** Roles this credential unlocks when the organisation requires them. */
  unlocksRoles: string[];
};

export function academyPaths(packKey: string): { packKey: string; paths: PackAcademyPath[] } {
  const loaded = loadPack(packKey);
  if (loaded.ok) return { packKey, paths: loaded.pack.academy };

  const fallback = loadPack("_generic");
  return { packKey: "_generic", paths: fallback.ok ? fallback.pack.academy : [] };
}

export async function loadPathProgress(
  db: AmxPrismaClient,
  input: { organizationId: string; userId: string; packKey: string },
): Promise<AcademyPathProgress[]> {
  const { packKey, paths } = academyPaths(input.packKey);

  const [completions, credentials, enrolments, roles] = await Promise.all([
    db.moduleCompletion.findMany({ where: { userId: input.userId } }),
    db.credential.findMany({ where: { userId: input.userId } }),
    db.learningEnrolment.findMany({ where: { userId: input.userId } }),
    db.role.findMany({
      where: { requiresCredentialKey: { not: null } },
      select: { id: true, requiresCredentialKey: true },
    }),
  ]);

  return paths.map((path) => {
    const modules = path.courses.flatMap((course) =>
      course.modules.map((lesson) => {
        const completion = completions.find(
          (c) =>
            c.pathKey === path.key && c.courseKey === course.key && c.moduleKey === lesson.key,
        );
        return {
          courseKey: course.key,
          moduleKey: lesson.key,
          title: lesson.title,
          completed: Boolean(completion),
          score: completion?.score ?? 0,
          outOf: completion?.outOf ?? lesson.assessment.length,
        };
      }),
    );

    return {
      path,
      packKey,
      started: enrolments.some((e) => e.pathKey === path.key),
      completedModules: modules.filter((m) => m.completed).length,
      totalModules: modules.length,
      modules,
      credentialHeld: credentials.some((c) => c.credentialKey === path.credentialKey),
      unlocksRoles: roles
        .filter((role) => role.requiresCredentialKey === path.credentialKey)
        .map((role) => roleName(role.id)),
    };
  });
}

export async function startPath(
  db: AmxPrismaClient,
  input: { organizationId: string; userId: string; packKey: string; pathKey: string },
): Promise<void> {
  const existing = await db.learningEnrolment.findUnique({
    where: {
      organizationId_userId_pathKey: {
        organizationId: input.organizationId,
        userId: input.userId,
        pathKey: input.pathKey,
      },
    },
    select: { id: true },
  });
  if (existing) return;

  await db.learningEnrolment.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      pathKey: input.pathKey,
      packKey: input.packKey,
    },
  });

  await track({
    name: "academy_path_started",
    organizationId: input.organizationId,
    userId: input.userId,
    properties: { pathKey: input.pathKey, packKey: input.packKey },
  });
}

export type CompleteModuleResult = {
  score: number;
  outOf: number;
  passed: boolean;
  /** Set when this completion finished the path. */
  credentialAwarded: string | null;
};

/**
 * An assessment is passed on every answer, not a majority.
 *
 * These are short, and the credential can gate an approver role — a
 * "good enough" pass on the lesson about what an approval means would be an
 * odd thing to build.
 */
export async function completeModule(
  db: AmxPrismaClient,
  input: {
    organizationId: string;
    userId: string;
    packKey: string;
    pathKey: string;
    courseKey: string;
    moduleKey: string;
    answers: number[];
  },
): Promise<CompleteModuleResult | null> {
  const { packKey, paths } = academyPaths(input.packKey);
  const path = paths.find((p) => p.key === input.pathKey);
  const course = path?.courses.find((c) => c.key === input.courseKey);
  const lesson = course?.modules.find((m) => m.key === input.moduleKey);
  if (!path || !course || !lesson) return null;

  const outOf = lesson.assessment.length;
  const score = lesson.assessment.filter(
    (item, index) => input.answers[index] === item.correctIndex,
  ).length;
  const passed = outOf === 0 || score === outOf;

  if (!passed) return { score, outOf, passed, credentialAwarded: null };

  await db.moduleCompletion.upsert({
    where: {
      organizationId_userId_pathKey_courseKey_moduleKey: {
        organizationId: input.organizationId,
        userId: input.userId,
        pathKey: input.pathKey,
        courseKey: input.courseKey,
        moduleKey: input.moduleKey,
      },
    },
    update: { score, outOf, completedAt: new Date() },
    create: {
      organizationId: input.organizationId,
      userId: input.userId,
      pathKey: input.pathKey,
      courseKey: input.courseKey,
      moduleKey: input.moduleKey,
      score,
      outOf,
    },
  });

  await startPath(db, {
    organizationId: input.organizationId,
    userId: input.userId,
    packKey,
    pathKey: input.pathKey,
  });

  await track({
    name: "academy_module_completed",
    organizationId: input.organizationId,
    userId: input.userId,
    properties: { pathKey: input.pathKey, moduleKey: input.moduleKey, score, outOf },
  });

  // Path finished? Award the credential — as an audit event with a row.
  const required = path.courses.flatMap((c) => c.modules.map((m) => `${c.key}:${m.key}`));
  const done = await db.moduleCompletion.findMany({
    where: { userId: input.userId, pathKey: input.pathKey },
    select: { courseKey: true, moduleKey: true },
  });
  const doneKeys = new Set(done.map((d) => `${d.courseKey}:${d.moduleKey}`));
  if (!required.every((key) => doneKeys.has(key))) {
    return { score, outOf, passed, credentialAwarded: null };
  }

  const alreadyHeld = await db.credential.findUnique({
    where: {
      organizationId_userId_credentialKey: {
        organizationId: input.organizationId,
        userId: input.userId,
        credentialKey: path.credentialKey,
      },
    },
    select: { id: true },
  });
  if (alreadyHeld) return { score, outOf, passed, credentialAwarded: null };

  await db.$transaction(async (tx) => {
    const event = await appendAuditEvent(tx as AmxPrismaClient, {
      organizationId: input.organizationId,
      type: "academy.credential-awarded",
      subjectType: "Credential",
      subjectId: `${input.userId}:${path.credentialKey}`,
      actorUserId: input.userId,
      payload: { credentialKey: path.credentialKey, pathKey: path.key, packKey },
    });

    await tx.credential.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        credentialKey: path.credentialKey,
        pathKey: path.key,
        auditEventId: event.id,
      },
    });

    await tx.learningEnrolment.updateMany({
      where: { organizationId: input.organizationId, userId: input.userId, pathKey: path.key },
      data: { completedAt: new Date() },
    });
  });

  await track({
    name: "academy_credential_awarded",
    organizationId: input.organizationId,
    userId: input.userId,
    properties: { credentialKey: path.credentialKey, pathKey: path.key },
  });

  return { score, outOf, passed, credentialAwarded: path.credentialKey };
}

export type CredentialGate = { ok: true } | { ok: false; detail: string };

/**
 * Credential gating for approver roles.
 *
 * Off by default and enabled per organisation. This is a *policy* knob, not a
 * governance bypass — it can only ever make approval harder, and the gate
 * engine reads it through this function alone.
 */
export async function assertCredentialForRole(
  db: AmxPrismaClient,
  input: { organizationId: string; userId: string; roleKey: string },
): Promise<CredentialGate> {
  const organization = await db.organization.findUnique({
    where: { id: input.organizationId },
    select: { requireApproverCredentials: true },
  });
  if (!organization?.requireApproverCredentials) return { ok: true };

  const role = await db.role.findUnique({
    where: { id: input.roleKey },
    select: { requiresCredentialKey: true },
  });
  if (!role?.requiresCredentialKey) return { ok: true };

  const held = await db.credential.findUnique({
    where: {
      organizationId_userId_credentialKey: {
        organizationId: input.organizationId,
        userId: input.userId,
        credentialKey: role.requiresCredentialKey,
      },
    },
    select: { id: true },
  });
  if (held) return { ok: true };

  return {
    ok: false,
    detail: `This organisation requires the ${role.requiresCredentialKey.replace(/-/g, " ")} before the ${roleName(input.roleKey)} role can approve anything. The Academy path takes about twenty minutes.`,
  };
}
