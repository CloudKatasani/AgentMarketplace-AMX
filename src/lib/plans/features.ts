/**
 * Plan tiers as feature flags.
 *
 * The hard rule from CLAUDE.md: flags gate FEATURES, never GOVERNANCE. Nothing
 * in this file may change whether an approval is valid, whether a gate is
 * satisfied, or whether a validator rejects something. A Free-tier agent that
 * passes Stage 3 passed it for exactly the same reasons an Enterprise one did.
 *
 * `gate-engine` code must not import this module; `plans.test.ts` asserts that.
 */
import type { PlanTier } from "@/lib/enums";

export type PlanFeatures = {
  /** Hard caps. Reaching one is where an upgrade prompt is honest. */
  maxWorkspaces: number;
  maxAgents: number;
  /** Packs available to the tier. `"*"` means all shipped packs. */
  packs: "*" | string[];
  peerGates: boolean;
  exports: boolean;
  apiAccess: boolean;
  ssoStub: boolean;
  whiteLabel: boolean;
  auditExport: boolean;
};

export const PLAN_FEATURES: Record<PlanTier, PlanFeatures> = {
  FREE: {
    maxWorkspaces: 1,
    maxAgents: 3,
    packs: ["_generic"],
    peerGates: false,
    exports: false,
    apiAccess: false,
    ssoStub: false,
    whiteLabel: false,
    auditExport: false,
  },
  TEAM: {
    maxWorkspaces: 5,
    maxAgents: 50,
    packs: "*",
    peerGates: true,
    exports: true,
    apiAccess: false,
    ssoStub: false,
    whiteLabel: false,
    auditExport: false,
  },
  ENTERPRISE: {
    maxWorkspaces: Number.POSITIVE_INFINITY,
    maxAgents: Number.POSITIVE_INFINITY,
    packs: "*",
    peerGates: true,
    exports: true,
    apiAccess: true,
    ssoStub: true,
    whiteLabel: true,
    auditExport: true,
  },
};

export function featuresFor(planTier: PlanTier): PlanFeatures {
  return PLAN_FEATURES[planTier];
}

export function can(planTier: PlanTier, feature: keyof PlanFeatures): boolean {
  return PLAN_FEATURES[planTier][feature] === true;
}

export type LimitCheck =
  | { withinLimit: true }
  | { withinLimit: false; limit: number; upgradeTo: PlanTier; message: string };

/**
 * Limit checks return the message the upgrade prompt should show.
 *
 * Prompts appear only at a genuine capability boundary — never as an
 * interruption — so the message names what the user was trying to do.
 */
export function checkAgentLimit(planTier: PlanTier, currentCount: number): LimitCheck {
  const limit = PLAN_FEATURES[planTier].maxAgents;
  if (currentCount < limit) return { withinLimit: true };
  return {
    withinLimit: false,
    limit,
    upgradeTo: planTier === "FREE" ? "TEAM" : "ENTERPRISE",
    message: `You have ${currentCount} of ${limit} agents on the ${planTier.toLowerCase()} plan. Certifying more agents is what the next tier is for.`,
  };
}

export function checkWorkspaceLimit(planTier: PlanTier, currentCount: number): LimitCheck {
  const limit = PLAN_FEATURES[planTier].maxWorkspaces;
  if (currentCount < limit) return { withinLimit: true };
  return {
    withinLimit: false,
    limit,
    upgradeTo: planTier === "FREE" ? "TEAM" : "ENTERPRISE",
    message: `The ${planTier.toLowerCase()} plan includes ${limit} workspace${limit === 1 ? "" : "s"}.`,
  };
}

export function packAvailable(planTier: PlanTier, packKey: string): boolean {
  const packs = PLAN_FEATURES[planTier].packs;
  return packs === "*" || packs.includes(packKey);
}
