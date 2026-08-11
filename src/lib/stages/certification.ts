/**
 * Stage 7 · Certification (DATSIS+V).
 *
 * A score is only accepted when it cites an artifact version and a field inside
 * it — and the citation is checked against what was actually committed. Free
 * text would make certification an opinion; a citation makes it something a
 * reader can go and verify, which is the entire point of shipping an evidence
 * pack.
 */
import { commitArtifact } from "@/lib/artifacts/commit";
import {
  DATSISV_DIMENSIONS,
  DATSISV_LABELS,
  datsisvScorecardSchema,
  type DatsisvDimension,
  type DatsisvScorecard,
} from "@/lib/artifacts/schemas";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import type { ArtifactKind } from "@/lib/enums";

export type EvidenceSource = {
  artifactKind: ArtifactKind;
  versionNumber: number;
  /** Field paths a citation may point at, with their current values. */
  fields: { path: string; excerpt: string }[];
};

/** What a scorer may cite: the committed artifacts, flattened to leaf fields. */
export async function loadEvidenceSources(
  db: AmxPrismaClient,
  agentId: string,
): Promise<EvidenceSource[]> {
  const artifacts = await db.artifact.findMany({
    where: { agentId },
    select: {
      kind: true,
      currentVersion: { select: { versionNumber: true, content: true } },
    },
  });

  return artifacts
    .filter((artifact) => artifact.currentVersion !== null)
    .map((artifact) => ({
      artifactKind: artifact.kind as ArtifactKind,
      versionNumber: artifact.currentVersion!.versionNumber,
      fields: flatten(JSON.parse(artifact.currentVersion!.content)),
    }));
}

/** Leaf paths of a document, with a short excerpt of each value. */
function flatten(value: unknown, prefix = ""): { path: string; excerpt: string }[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flatten(item, `${prefix}/${index}`));
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      flatten(child, `${prefix}/${key}`),
    );
  }
  const excerpt = String(value);
  if (excerpt.trim() === "") return [];
  return [{ path: prefix || "/", excerpt: excerpt.slice(0, 300) }];
}

export type ScorecardCheck = {
  dimension: DatsisvDimension;
  label: string;
  score: number | null;
  citationCount: number;
  /** Set when the score is below the minimum or the citation does not resolve. */
  problem: string | null;
};

export type CertificationReadiness = {
  checks: ScorecardCheck[];
  ready: boolean;
  missingDimensions: DatsisvDimension[];
  /** Overall, for the badge. */
  averageScore: number;
};

export function assessScorecard(
  scorecard: DatsisvScorecard | null,
  sources: EvidenceSource[],
): CertificationReadiness {
  const byDimension = new Map((scorecard?.scores ?? []).map((s) => [s.dimension, s]));
  const minimum = scorecard?.minimumScore ?? 3;

  const checks: ScorecardCheck[] = DATSISV_DIMENSIONS.map((dimension) => {
    const score = byDimension.get(dimension);
    if (!score) {
      return {
        dimension,
        label: DATSISV_LABELS[dimension],
        score: null,
        citationCount: 0,
        problem: "Not scored yet.",
      };
    }

    const unresolved = score.citations.filter(
      (citation) =>
        !sources.some(
          (source) =>
            source.artifactKind === citation.artifactKind &&
            source.versionNumber === citation.versionNumber &&
            source.fields.some((field) => field.path === citation.fieldPath),
        ),
    );

    let problem: string | null = null;
    if (unresolved.length > 0) {
      problem = `${unresolved.length} citation${unresolved.length === 1 ? "" : "s"} no longer resolve — the artifact moved on since this was scored. Re-cite against the current version.`;
    } else if (score.score < minimum) {
      problem = `Scored ${score.score}, below the minimum of ${minimum}.`;
    }

    return {
      dimension,
      label: DATSISV_LABELS[dimension],
      score: score.score,
      citationCount: score.citations.length,
      problem,
    };
  });

  const scored = checks.filter((c) => c.score !== null);

  return {
    checks,
    missingDimensions: checks.filter((c) => c.score === null).map((c) => c.dimension),
    ready: checks.every((c) => c.problem === null),
    averageScore:
      scored.length === 0
        ? 0
        : scored.reduce((total, c) => total + (c.score ?? 0), 0) / scored.length,
  };
}

export type SaveScorecardResult =
  | { ok: true; versionNumber: number; readiness: CertificationReadiness }
  | { ok: false; errors: { path: string; message: string }[] };

export async function saveScorecard(
  db: AmxPrismaClient,
  input: {
    organizationId: string;
    agentId: string;
    actorUserId: string | null;
    scorecard: unknown;
  },
): Promise<SaveScorecardResult> {
  const parsed = datsisvScorecardSchema.safeParse(input.scorecard);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: `/${issue.path.join("/")}`,
        message: issue.message,
      })),
    };
  }

  const sources = await loadEvidenceSources(db, input.agentId);

  // A citation that does not resolve is worse than no citation: it looks like
  // evidence. Refuse before writing.
  const unresolved = parsed.data.scores.flatMap((score) =>
    score.citations
      .filter(
        (citation) =>
          !sources.some(
            (source) =>
              source.artifactKind === citation.artifactKind &&
              source.versionNumber === citation.versionNumber &&
              source.fields.some((field) => field.path === citation.fieldPath),
          ),
      )
      .map((citation) => ({
        path: `/scores/${score.dimension}/citations`,
        message: `The evidence cited for "${DATSISV_LABELS[score.dimension]}" points at ${citation.artifactKind} v${citation.versionNumber} ${citation.fieldPath}, which does not exist. Cite a field of a committed artifact version.`,
      })),
  );
  if (unresolved.length > 0) return { ok: false, errors: unresolved };

  const result = await commitArtifact(db, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    stageId: "7-certification",
    kind: "datsisv-scorecard",
    authorUserId: input.actorUserId,
    content: parsed.data,
  });
  if (!result.ok) return { ok: false, errors: result.errors };

  return {
    ok: true,
    versionNumber: result.versionNumber,
    readiness: assessScorecard(parsed.data, sources),
  };
}

/**
 * Pre-fills a scorecard by citing the obvious evidence for each dimension.
 *
 * Every score starts unset — the citations are a starting point for a human,
 * not a self-certification. Nothing here writes anything.
 */
export function draftScorecard(
  agentSlug: string,
  sources: EvidenceSource[],
): DatsisvScorecard {
  const cite = (kind: ArtifactKind, fieldMatch: string) => {
    const source = sources.find((s) => s.artifactKind === kind);
    const field = source?.fields.find((f) => f.path.includes(fieldMatch)) ?? source?.fields[0];
    if (!source || !field) return [];
    return [
      {
        artifactKind: kind,
        versionNumber: source.versionNumber,
        fieldPath: field.path,
        excerpt: field.excerpt,
      },
    ];
  };

  const suggestions: Record<DatsisvDimension, ReturnType<typeof cite>> = {
    discoverable: cite("agent-charter", "/mission"),
    addressable: cite("tool-specs", "/tools"),
    trustworthy: cite("binding-set", "/bindings"),
    "self-describing": cite("agent-charter", "/outOfScope"),
    interoperable: cite("grounding-pack", "/metricDefinitions"),
    secure: cite("governance-review", "/invocationAccess"),
    valuable: cite("agent-charter", "/valueHypothesis"),
  };

  return {
    schemaVersion: "1.0.0",
    agentSlug,
    minimumScore: 3,
    valueStatement: "",
    scores: DATSISV_DIMENSIONS.filter((d) => suggestions[d].length > 0).map((dimension) => ({
      dimension,
      score: 0,
      citations: suggestions[dimension],
      note: "",
    })),
  };
}
