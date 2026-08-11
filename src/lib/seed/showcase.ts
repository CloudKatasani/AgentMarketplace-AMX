/**
 * Walking an agent through Stages 3–8 with the real engine.
 *
 * Used by the showcase seed AND by the demo-arc test. That sharing is the
 * point: if the only way to reach Stage 8 is through `requestTransition` and
 * `recordDecision`, the demo cannot drift away from the product, and a change
 * that breaks the arc fails a test rather than a sales call.
 */
import { DATSISV_DIMENSIONS } from "@/lib/artifacts/schemas";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import type { StageKey } from "@/lib/enums";
import { recordDecision, requestTransition } from "@/lib/gates";
import type { RoleKey } from "@/lib/roles";
import { draftScorecard, loadEvidenceSources, saveScorecard } from "@/lib/stages/certification";
import { draftEvalHarness, saveEvalHarness } from "@/lib/stages/evaluation";
import { loadGovernanceContext, saveGovernanceReview } from "@/lib/stages/governance";
import { draftGroundingPack, saveGroundingPack, saveToolSpecs } from "@/lib/stages/grounding";
import { saveListing } from "@/lib/stages/publish";

export type WalkCast = {
  organizationId: string;
  agentId: string;
  agentSlug: string;
  /** Authors every artifact, so every approval below is a genuine peer review. */
  builderId: string;
  productOwnerId: string;
  dataOwnerId: string;
  governanceId: string;
};

export type WalkResult = { ok: boolean; failedAt: StageKey | null; detail: string | null };

export async function walkToPublished(
  db: AmxPrismaClient,
  cast: WalkCast,
): Promise<WalkResult> {
  const {
    organizationId,
    agentId: agentIdValue,
    agentSlug,
    builderId,
    productOwnerId,
    dataOwnerId,
    governanceId,
  } = cast;
  const agent = { id: agentIdValue, slug: agentSlug };
  let failure: WalkResult | null = null;

  const approve = async (
    stageId: StageKey,
    approvals: { userId: string; roleKey: RoleKey; comment: string }[],
  ) => {
    if (failure) return false;
    const gate = await requestTransition(db, {
      organizationId,
      agentId: agent.id,
      stageId,
      actorUserId: builderId,
    });
    if (!gate.ok) {
      failure = { ok: false, failedAt: stageId, detail: JSON.stringify(gate).slice(0, 500) };
      return false;
    }
    for (const approval of approvals) {
      const decision = await recordDecision(db, {
        organizationId,
        gateId: gate.gateId,
        actorUserId: approval.userId,
        roleKey: approval.roleKey,
        decision: "APPROVE",
        comment: approval.comment,
      });
      if (!decision.ok) {
        failure = { ok: false, failedAt: stageId, detail: decision.detail };
        return false;
      }
    }
    return true;
  };

  await approve("1-consumption-discovery", [
    {
      userId: productOwnerId,
      roleKey: "agent-product-owner",
      comment: "Personas match the decisions this team actually owns.",
    },
  ]);

  await approve("2-agent-charter", [
    {
      userId: productOwnerId,
      roleKey: "agent-product-owner",
      comment: "Scope boundary and out-of-scope list are specific enough to hold.",
    },
    {
      userId: governanceId,
      roleKey: "governance-officer",
      comment: "Decision-support tier is right; it advises and never contacts a customer.",
    },
  ]);

  await approve("3-data-product-binding", [
    {
      userId: dataOwnerId,
      roleKey: "data-product-owner",
      comment: "Both metrics are certified and the coverage matrix is complete.",
    },
    {
      userId: productOwnerId,
      roleKey: "agent-product-owner",
      comment: "Every question has a number behind it.",
    },
  ]);

  // Stage 4 · grounding pack and tool specs.
  const pack = await draftGroundingPack(db, agent.id);
  if (pack) {
    await saveGroundingPack(db, {
      organizationId,
      agentId: agent.id,
      actorUserId: builderId,
      document: {
        ...pack,
        glossary: [
          {
            term: "churn",
            definition:
              "A residential account terminating service, excluding moves within the territory.",
          },
          {
            term: "high bill",
            definition:
              "An invoice more than 40% above the account's trailing 12-month average.",
          },
        ],
        allowedJoins: [{ from: "customer", to: "account", on: "customer_id" }],
        disambiguationHints: [
          {
            ambiguousTerm: "account",
            resolution: "The billing account, not the online login.",
          },
        ],
      },
    });
}

  await saveToolSpecs(db, {
    organizationId,
    agentId: agent.id,
    actorUserId: builderId,
    document: {
      schemaVersion: "1.0.0",
      agentSlug: agent.slug,
      tools: [
        {
          name: "rank_accounts_by_churn_risk",
          description: "Ranks residential accounts by certified churn rate for a segment.",
          bindingRef: "customer-360:QUERIES",
          inputs: [
            {
              name: "segment",
              type: "string",
              description: "Residential segment to rank within",
              required: true,
            },
          ],
          outputs: [
            {
              name: "ranked_accounts",
              type: "array",
              description: "Accounts with churn rate and change versus prior quarter",
              required: true,
            },
          ],
          refusalRules: [
            "Refuse for commercial and industrial accounts — they are outside the charter.",
            "Refuse any request for an individual customer's personal details.",
          ],
          escalationPath: "Hand off to the Revenue Assurance duty analyst.",
        },
      ],
    },
  });

  await approve("4-grounding-and-tools", [
    {
      userId: dataOwnerId,
      roleKey: "data-product-owner",
      comment: "Reads through certified metrics only; no table references anywhere.",
    },
    {
      userId: governanceId,
      roleKey: "governance-officer",
      comment: "Refusal rules cover the commercial-account boundary.",
    },
  ]);

  // Stage 5 · evaluation, scored by hand as a reviewer would.
  const harness = await draftEvalHarness(db, agent.id);
  if (harness) {
    await saveEvalHarness(db, {
      organizationId,
      agentId: agent.id,
      actorUserId: builderId,
      harness: {
        ...harness,
        scores: harness.cases.map((testCase) =>
          testCase.kind === "golden"
            ? {
                caseKey: testCase.key,
                groundedness: 5,
                faithfulness: 4,
                citationCorrectness: 5,
                refusedCorrectly: false,
                note: "Cited the certified metric and stated its grain.",
                scoredBy: "Priya Raman",
              }
            : {
                caseKey: testCase.key,
                groundedness: 0,
                faithfulness: 0,
                citationCorrectness: 0,
                refusedCorrectly: true,
                note: "Refused and named the charter exclusion.",
                scoredBy: "Priya Raman",
              },
        ),
      },
    });
}

  await approve("5-evaluation-harness", [
    {
      userId: productOwnerId,
      roleKey: "agent-product-owner",
      comment: "Every probe refused; groundedness is where we need it.",
    },
    {
      userId: governanceId,
      roleKey: "governance-officer",
      comment: "Adversarial set covers injection and raw-data access.",
    },
  ]);

  // Stage 6 · governance.
  const governance = await loadGovernanceContext(db, agent.id);
  if (governance) {
    await saveGovernanceReview(db, {
      organizationId,
      agentId: agent.id,
      actorUserId: builderId,
      review: {
        schemaVersion: "1.0.0",
        agentSlug: agent.slug,
        invocationAccess: [
          "Retail Analytics team",
          "Revenue Assurance duty analysts",
        ],
        inheritedSensitivity: governance.inheritance.inherited,
        regulatoryConstraints: governance.constraints.map((constraint) => ({
          key: constraint.key,
          name: constraint.name,
          howAddressed:
            constraint.key === "personal-data-minimisation"
              ? "Returns account-level risk scores and segment aggregates only; never personal attributes or contact details."
              : constraint.key === "human-oversight"
                ? "The analyst reviews the ranked list and decides every offer; the agent never contacts a customer."
                : "Invocations, their citations, and approvals are retained for seven years and retrievable by the Governance Officer.",
        })),
        incidentRunbook:
          "The duty analyst raises it with the Agent Product Owner, who withdraws the listing and notifies the Retail Analytics channel within one hour.",
        rollbackPlan:
          "The listing is withdrawn and the previous weekly export resumes; the certification returns to STALE until re-approved.",
        killSwitchOwner: "Priya Raman, Agent Product Owner",
      },
    });
}

  await approve("6-governance-and-guardrails", [
    {
      userId: governanceId,
      roleKey: "governance-officer",
      comment: "Access is named, oversight is real, and the kill switch has an owner.",
    },
  ]);

  // Stage 7 · certification against cited evidence.
  const sources = await loadEvidenceSources(db, agent.id);
  const scorecardDraft = draftScorecard(agent.slug, sources);
  const scored = DATSISV_DIMENSIONS.map((dimension) => {
    const suggestion = scorecardDraft.scores.find((s) => s.dimension === dimension);
    const fallback = sources[0];
    return {
      dimension,
      score: 4,
      note: "Reviewed against the cited artifact field.",
      citations:
        suggestion?.citations ??
        (fallback
          ? [
              {
                artifactKind: fallback.artifactKind,
                versionNumber: fallback.versionNumber,
                fieldPath: fallback.fields[0].path,
                excerpt: fallback.fields[0].excerpt,
              },
            ]
          : []),
    };
  }).filter((score) => score.citations.length > 0);

  await saveScorecard(db, {
    organizationId,
    agentId: agent.id,
    actorUserId: builderId,
    scorecard: {
      schemaVersion: "1.0.0",
      agentSlug: agent.slug,
      minimumScore: 3,
      valueStatement:
        "Retention analysts start the cycle with a ranked, explainable list instead of reconciling three dashboards by hand — and every recommendation traces to a certified metric.",
      scores: scored,
    },
  });

  await approve("7-certification", [
    {
      userId: governanceId,
      roleKey: "governance-officer",
      comment: "Every dimension cites a committed artifact field.",
    },
    {
      userId: dataOwnerId,
      roleKey: "data-product-owner",
      comment: "Trustworthiness rests on contracts I own; the pins are current.",
    },
    {
      userId: productOwnerId,
      roleKey: "agent-product-owner",
      comment: "The value statement matches what the team actually asked for.",
    },
  ]);

  // Stage 8 · listing and publication.
  await saveListing(db, {
    organizationId,
    agentId: agent.id,
    actorUserId: builderId,
    listing: {
      schemaVersion: "1.0.0",
      agentSlug: agent.slug,
      headline:
        "Find the residential accounts most likely to leave — and what the certified numbers say about why.",
      audience: ["Revenue Assurance Analysts", "Retention campaign managers"],
      howToInvoke:
        "Ask it in the Retail Analytics channel, or open it from the weekly retention review.",
      supportContact: "retail-analytics@northwind.example",
      deprecation: null,
    },
  });

  await approve("8-publish-and-operate", [
    {
      userId: productOwnerId,
      roleKey: "agent-product-owner",
      comment: "Listing is honest about who it is for.",
    },
    {
      userId: governanceId,
      roleKey: "governance-officer",
      comment: "Certified, guardrailed, and owned. Publish it.",
    },
  ]);


  return failure ?? { ok: true, failedAt: null, detail: null };
}
