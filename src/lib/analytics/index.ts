/**
 * Product analytics behind an adapter.
 *
 * Three rules from CLAUDE.md, enforced here rather than remembered per call
 * site: never block the UI (every call is fire-and-forget and swallows its own
 * errors), never ship PII (the distinct id is a salted hash), and never lock in
 * a vendor (the interface is PostHog-shaped; the default driver is a no-op).
 */
import { createHash } from "node:crypto";

export type AnalyticsEventName =
  | "org_created"
  | "agent_created"
  | "binding_validated"
  | "gate_opened"
  | "gate_decided"
  | "stale_triggered"
  | "onboarding_step_completed"
  | "evidence_pack_exported"
  | "academy_path_started"
  | "academy_module_completed"
  | "academy_credential_awarded"
  | "export_downloaded"
  | "upgrade_prompt_shown"
  | "ai_draft_proposed"
  | "org_invited"
  | "org_joined"
  | "member_role_changed"
  | "theme_override_saved";

export type TrackInput = {
  name: AnalyticsEventName;
  organizationId: string;
  /** Hashed before it leaves this module. Never stored raw. */
  userId?: string;
  properties?: Record<string, string | number | boolean | null | undefined | string[]>;
};

export type AnalyticsDriver = {
  name: string;
  capture(event: {
    name: AnalyticsEventName;
    organizationId: string;
    distinctId: string;
    properties: Record<string, unknown>;
  }): Promise<void> | void;
};

const SALT = process.env.ANALYTICS_SALT ?? "amx-dev-salt";

/** Stable per user per deployment, and not reversible to an email or an id. */
export function distinctIdFor(userId: string | undefined): string {
  if (!userId) return "anonymous";
  return createHash("sha256").update(`${SALT}:${userId}`).digest("hex").slice(0, 32);
}

export const noopDriver: AnalyticsDriver = {
  name: "noop",
  capture() {},
};

export const consoleDriver: AnalyticsDriver = {
  name: "console",
  capture(event) {
    // eslint-disable-next-line no-console
    console.info(
      `[analytics] ${event.name} org=${event.organizationId} id=${event.distinctId} ${JSON.stringify(event.properties)}`,
    );
  },
};

let driver: AnalyticsDriver =
  process.env.ANALYTICS_DRIVER === "console" ? consoleDriver : noopDriver;

/** Swap the driver — used by tests and by a future PostHog adapter. */
export function setAnalyticsDriver(next: AnalyticsDriver): void {
  driver = next;
}

export function currentDriver(): AnalyticsDriver {
  return driver;
}

/**
 * Emits an event. Deliberately returns a resolved promise even on failure:
 * analytics must never be the reason a governance action fails.
 */
export async function track(input: TrackInput): Promise<void> {
  try {
    await driver.capture({
      name: input.name,
      organizationId: input.organizationId,
      distinctId: distinctIdFor(input.userId),
      properties: stripUndefined(input.properties ?? {}),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[analytics] ${input.name} failed to send`, error);
  }
}

function stripUndefined(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).filter(([, v]) => v !== undefined));
}
