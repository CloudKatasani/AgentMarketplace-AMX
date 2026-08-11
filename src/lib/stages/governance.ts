/**
 * Stage 6 · Governance & Guardrails.
 *
 * Sensitivity is *inherited*, not declared: an agent is exactly as sensitive as
 * the most sensitive thing it stands on. Letting someone type a lower number
 * than the data supports would make the whole classification decorative, so the
 * inherited value is computed and the form shows it rather than asks for it.
 */
import { commitArtifact } from "@/lib/artifacts/commit";
import { governanceReviewSchema, type GovernanceReview } from "@/lib/artifacts/schemas";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import { SENSITIVITY_ORDER, type RiskTier, type SensitivityLevel } from "@/lib/enums";

/** Constraints an industry pack contributes. `_generic` ships these. */
export type RegulatoryConstraint = {
  key: string;
  name: string;
  appliesWhen: (context: { sensitivity: SensitivityLevel; riskTier: RiskTier | null }) => boolean;
  prompt: string;
};

export const GENERIC_CONSTRAINTS: RegulatoryConstraint[] = [
  {
    key: "personal-data-minimisation",
    name: "Personal data minimisation",
    appliesWhen: ({ sensitivity }) =>
      sensitivity === "CONFIDENTIAL" || sensitivity === "RESTRICTED",
    prompt:
      "This agent reads personal or restricted data. Say what it may return about an individual, and what it must aggregate or withhold.",
  },
  {
    key: "human-oversight",
    name: "Human oversight of automated decisions",
    appliesWhen: ({ riskTier }) => riskTier === "decision-support" || riskTier === "action-taking",
    prompt:
      "A human must remain accountable for the decision. Say where the human is in the loop and what they see before acting.",
  },
  {
    key: "action-authorisation",
    name: "Authorisation for automated action",
    appliesWhen: ({ riskTier }) => riskTier === "action-taking",
    prompt:
      "This agent acts in a system. Say who authorises each action class, and what the agent may never do without a human.",
  },
  {
    key: "record-keeping",
    name: "Record-keeping and traceability",
    appliesWhen: () => true,
    prompt:
      "Say how long invocations and their citations are retained, and who can retrieve them when asked.",
  },
];

export type SensitivityInheritance = {
  inherited: SensitivityLevel;
  /** Which product set the level — named, so the number is arguable. */
  drivenBy: { productName: string; sensitivity: SensitivityLevel }[];
};

/** The agent inherits the highest classification among its bound products. */
export function inheritSensitivity(
  products: { name: string; sensitivity: string }[],
): SensitivityInheritance {
  const rank = (level: string) =>
    Math.max(0, SENSITIVITY_ORDER.indexOf(level as SensitivityLevel));

  let inherited: SensitivityLevel = "PUBLIC";
  for (const product of products) {
    if (rank(product.sensitivity) > rank(inherited)) {
      inherited = product.sensitivity as SensitivityLevel;
    }
  }

  return {
    inherited,
    drivenBy: products
      .filter((p) => p.sensitivity === inherited)
      .map((p) => ({ productName: p.name, sensitivity: inherited })),
  };
}

export async function loadGovernanceContext(
  db: AmxPrismaClient,
  agentId: string,
): Promise<{
  inheritance: SensitivityInheritance;
  constraints: RegulatoryConstraint[];
  riskTier: RiskTier | null;
  agentSlug: string;
} | null> {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { slug: true, riskTier: true },
  });
  if (!agent) return null;

  const bindings = await db.binding.findMany({
    where: { agentId, archivedAt: null },
    select: { dataProduct: { select: { name: true, sensitivity: true } } },
  });

  const inheritance = inheritSensitivity(bindings.map((b) => b.dataProduct));
  const riskTier = (agent.riskTier as RiskTier | null) ?? null;

  return {
    inheritance,
    riskTier,
    agentSlug: agent.slug,
    constraints: GENERIC_CONSTRAINTS.filter((constraint) =>
      constraint.appliesWhen({ sensitivity: inheritance.inherited, riskTier }),
    ),
  };
}

export type SaveGovernanceResult =
  | { ok: true; versionNumber: number; inherited: SensitivityLevel }
  | { ok: false; errors: { path: string; message: string }[] };

export async function saveGovernanceReview(
  db: AmxPrismaClient,
  input: {
    organizationId: string;
    agentId: string;
    actorUserId: string | null;
    review: unknown;
  },
): Promise<SaveGovernanceResult> {
  const ctx = await loadGovernanceContext(db, input.agentId);
  if (!ctx) return { ok: false, errors: [{ path: "/", message: "Agent not found." }] };

  const parsed = governanceReviewSchema.safeParse(input.review);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: `/${issue.path.join("/")}`,
        message: issue.message,
      })),
    };
  }

  const review: GovernanceReview = parsed.data;

  // Inheritance is computed, never accepted from the form.
  if (review.inheritedSensitivity !== ctx.inheritance.inherited) {
    return {
      ok: false,
      errors: [
        {
          path: "/inheritedSensitivity",
          message: `This agent inherits ${ctx.inheritance.inherited} from ${ctx.inheritance.drivenBy.map((d) => d.productName).join(", ") || "its bound products"}. Sensitivity is inherited, not chosen — bind to less sensitive products if you need a lower classification.`,
        },
      ],
    };
  }

  // Every applicable constraint must be addressed, by name.
  const addressed = new Set(review.regulatoryConstraints.map((c) => c.key));
  const missing = ctx.constraints.filter((c) => !addressed.has(c.key));
  if (missing.length > 0) {
    return {
      ok: false,
      errors: missing.map((constraint) => ({
        path: "/regulatoryConstraints",
        message: `"${constraint.name}" applies to this agent and has not been addressed. ${constraint.prompt}`,
      })),
    };
  }

  const result = await commitArtifact(db, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    stageId: "6-governance-and-guardrails",
    kind: "governance-review",
    authorUserId: input.actorUserId,
    content: review,
  });
  if (!result.ok) return { ok: false, errors: result.errors };

  await db.agent.update({
    where: { id: input.agentId },
    data: { sensitivity: ctx.inheritance.inherited },
  });

  return {
    ok: true,
    versionNumber: result.versionNumber,
    inherited: ctx.inheritance.inherited,
  };
}
