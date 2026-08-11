import { afterEach, describe, expect, it } from "vitest";

import { ssoConfig, ssoProviders, SSO_PROVIDER_ID } from "@/lib/auth/sso";

/**
 * Optional enterprise sign-in.
 *
 * The thing worth pinning is the *absence*: a deployment with no identity
 * provider must offer no SSO door at all, rather than a button that fails after
 * a redirect. And when one is configured, it must ask for identity only —
 * AMX would not honour groups or roles from an IdP, so it does not request
 * them.
 */
const KEYS = [
  "AMX_OIDC_ISSUER",
  "AMX_OIDC_CLIENT_ID",
  "AMX_OIDC_CLIENT_SECRET",
  "AMX_OIDC_LABEL",
] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

function configure(overrides: Partial<Record<(typeof KEYS)[number], string>> = {}) {
  process.env.AMX_OIDC_ISSUER = "https://idp.example.test";
  process.env.AMX_OIDC_CLIENT_ID = "amx";
  process.env.AMX_OIDC_CLIENT_SECRET = "secret";
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
}

describe("single sign-on", () => {
  it("offers nothing when the deployment has no identity provider", () => {
    expect(ssoConfig()).toBeNull();
    expect(ssoProviders()).toHaveLength(0);
  });

  it("stays off when the configuration is incomplete", () => {
    process.env.AMX_OIDC_ISSUER = "https://idp.example.test";
    expect(ssoConfig()).toBeNull();

    process.env.AMX_OIDC_CLIENT_ID = "amx";
    expect(ssoConfig()).toBeNull();

    process.env.AMX_OIDC_CLIENT_SECRET = "secret";
    expect(ssoConfig()).not.toBeNull();
  });

  it("appears as one OIDC provider when configured", () => {
    configure({ AMX_OIDC_LABEL: "Northwind SSO" });

    const providers = ssoProviders();
    expect(providers).toHaveLength(1);

    const provider = providers[0] as {
      id: string;
      name: string;
      type: string;
      issuer: string;
      authorization: { params: { scope: string } };
      allowDangerousEmailAccountLinking: boolean;
    };
    expect(provider.id).toBe(SSO_PROVIDER_ID);
    expect(provider.type).toBe("oidc");
    expect(provider.name).toBe("Northwind SSO");
    expect(provider.issuer).toBe("https://idp.example.test");

    // Identity only. Anything about groups or roles would be requested and then
    // ignored, which is worse than not asking.
    expect(provider.authorization.params.scope).toBe("openid email profile");
    expect(provider.authorization.params.scope).not.toContain("groups");

    // Account linking by unverified email is how a misconfigured directory
    // takes over an existing account.
    expect(provider.allowDangerousEmailAccountLinking).toBe(false);
  });

  it("falls back to a neutral button label", () => {
    configure();
    expect(ssoConfig()?.label).toBe("Single sign-on");
  });
});
