/**
 * Billing, behind an adapter.
 *
 * Stripe-shaped, with an in-memory driver, because nothing about the product
 * should assume a card is involved. The value metric is **published, certified
 * agents** — the unit a buyer brags about, not seats — which means the meter
 * reads from the same `Agent.certification` the gate engine writes, and cannot
 * drift from it.
 *
 * Nothing here may affect whether a gate passes. `plans.test.ts` asserts the
 * gate engine never imports this module or the plan features it reads.
 */
import type { PlanTier } from "@/lib/enums";
import { PLAN_FEATURES } from "@/lib/plans/features";

export type Price = {
  tier: PlanTier;
  /** Minor units, so nothing is stored as a float. */
  amountPerCertifiedAgent: number;
  currency: "GBP" | "USD" | "EUR";
  interval: "month" | "year";
};

export type Subscription = {
  organizationId: string;
  tier: PlanTier;
  status: "active" | "trialing" | "past_due" | "cancelled";
  currentPeriodEnd: Date;
  /** Certified agents at the last meter read — the value metric. */
  certifiedAgents: number;
};

export type CheckoutSession = {
  id: string;
  url: string;
  organizationId: string;
  tier: PlanTier;
};

export type BillingDriver = {
  name: string;
  getSubscription(organizationId: string): Promise<Subscription | null>;
  createCheckoutSession(input: {
    organizationId: string;
    tier: PlanTier;
    returnUrl: string;
  }): Promise<CheckoutSession>;
  reportUsage(input: { organizationId: string; certifiedAgents: number }): Promise<void>;
};

export const PRICES: Record<PlanTier, Price | null> = {
  FREE: null,
  TEAM: { tier: "TEAM", amountPerCertifiedAgent: 24_000, currency: "GBP", interval: "month" },
  ENTERPRISE: {
    tier: "ENTERPRISE",
    amountPerCertifiedAgent: 60_000,
    currency: "GBP",
    interval: "month",
  },
};

/**
 * The in-memory driver.
 *
 * Everything a Stripe driver would do, minus the network: it is enough to build
 * and test every upgrade path, and swapping it out is one line.
 */
export function createMemoryDriver(): BillingDriver {
  const subscriptions = new Map<string, Subscription>();
  const usage = new Map<string, number>();

  return {
    name: "memory",

    async getSubscription(organizationId) {
      return subscriptions.get(organizationId) ?? null;
    },

    async createCheckoutSession({ organizationId, tier, returnUrl }) {
      const id = `cs_memory_${organizationId.slice(-8)}_${tier.toLowerCase()}`;
      subscriptions.set(organizationId, {
        organizationId,
        tier,
        status: "trialing",
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3_600_000),
        certifiedAgents: usage.get(organizationId) ?? 0,
      });
      return { id, url: `${returnUrl}?checkout=${id}`, organizationId, tier };
    },

    async reportUsage({ organizationId, certifiedAgents }) {
      usage.set(organizationId, certifiedAgents);
      const existing = subscriptions.get(organizationId);
      if (existing) subscriptions.set(organizationId, { ...existing, certifiedAgents });
    },
  };
}

let driver: BillingDriver = createMemoryDriver();

export function setBillingDriver(next: BillingDriver): void {
  driver = next;
}

export function billing(): BillingDriver {
  return driver;
}

export type UpgradePrompt = {
  reason: string;
  upgradeTo: PlanTier;
  /** What the user was trying to do — prompts appear at boundaries, never as interruptions. */
  blockedAction: string;
};

/**
 * Prompts appear only where a capability genuinely ends.
 *
 * Never on a timer, never on a dashboard, never as a banner someone dismisses
 * once and stops reading. If this function returns null, say nothing.
 */
export function upgradePromptFor(input: {
  planTier: PlanTier;
  action:
    | "create-agent"
    | "create-workspace"
    | "bulk-export"
    | "peer-review"
    | "white-label"
    | "api-access";
  currentCount?: number;
}): UpgradePrompt | null {
  const features = PLAN_FEATURES[input.planTier];

  switch (input.action) {
    case "create-agent":
      if ((input.currentCount ?? 0) < features.maxAgents) return null;
      return {
        reason: `You have ${input.currentCount} of ${features.maxAgents} agents on the ${input.planTier.toLowerCase()} plan. Certifying more is what the next tier is for.`,
        upgradeTo: input.planTier === "FREE" ? "TEAM" : "ENTERPRISE",
        blockedAction: "chartering another agent",
      };

    case "create-workspace":
      if ((input.currentCount ?? 0) < features.maxWorkspaces) return null;
      return {
        reason: `The ${input.planTier.toLowerCase()} plan includes ${features.maxWorkspaces} workspace${features.maxWorkspaces === 1 ? "" : "s"}.`,
        upgradeTo: input.planTier === "FREE" ? "TEAM" : "ENTERPRISE",
        blockedAction: "creating another workspace",
      };

    case "bulk-export":
      if (features.exports) return null;
      return {
        reason:
          "Bulk exports — the question catalogue, the bundle, the graph files — are part of Team. The evidence pack is on every plan, because that is the one you hand an auditor.",
        upgradeTo: "TEAM",
        blockedAction: "exporting the full bundle",
      };

    case "peer-review":
      if (features.peerGates) return null;
      return {
        reason:
          "Solo attestation is available on every plan and always will be. Peer review — a second named person signing a gate — is part of Team.",
        upgradeTo: "TEAM",
        blockedAction: "requiring a second approver",
      };

    case "white-label":
      if (features.whiteLabel) return null;
      return {
        reason: "White-label theming is part of Enterprise.",
        upgradeTo: "ENTERPRISE",
        blockedAction: "rebranding the workspace",
      };

    case "api-access":
      if (features.apiAccess) return null;
      return {
        reason: "API access is part of Enterprise.",
        upgradeTo: "ENTERPRISE",
        blockedAction: "using the API",
      };

    default:
      return null;
  }
}

/** The meter: certified agents, read from the same column the gate engine writes. */
export function countCertifiedAgents(
  agents: { certification: string; status: string }[],
): number {
  return agents.filter(
    (agent) =>
      (agent.certification === "PEER_CERTIFIED" || agent.certification === "SELF_ATTESTED") &&
      agent.status !== "RETIRED",
  ).length;
}
