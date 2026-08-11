/**
 * Optional enterprise sign-in through the buyer's own identity provider.
 *
 * This is deliberately *not* a stub that pretends. It is a real generic OIDC
 * provider that appears only when a deployment configures one, and is absent
 * otherwise — so a screenshot of the sign-in page never advertises something
 * the deployment cannot do.
 *
 * Three rules, and they are the reason this file is small:
 *
 * 1. **SSO authenticates, it never authorises.** A successful OIDC sign-in
 *    proves who someone is. It grants no membership and no role: the person
 *    still joins a workspace through an invitation, and roles are still granted
 *    by an org-admin. An identity provider a buyer controls must not be able to
 *    mint approvers inside AMX.
 * 2. **Accounts are matched on verified email only.** An unverified email from
 *    an IdP would let a misconfigured directory take over an existing account.
 * 3. **Configuration is per deployment, not per tenant.** Per-tenant IdP
 *    routing is a real feature with real discovery requirements, and pretending
 *    otherwise in the plan flags would be worse than saying so.
 */
import type { Provider } from "next-auth/providers";

export type SsoConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Shown on the sign-in button, e.g. "Northwind SSO". */
  label: string;
};

export function ssoConfig(): SsoConfig | null {
  const issuer = process.env.AMX_OIDC_ISSUER?.trim();
  const clientId = process.env.AMX_OIDC_CLIENT_ID?.trim();
  const clientSecret = process.env.AMX_OIDC_CLIENT_SECRET?.trim();
  if (!issuer || !clientId || !clientSecret) return null;

  return {
    issuer,
    clientId,
    clientSecret,
    label: process.env.AMX_OIDC_LABEL?.trim() || "Single sign-on",
  };
}

export const SSO_PROVIDER_ID = "sso";

/** The provider list to hand Auth.js: empty unless this deployment has an IdP. */
export function ssoProviders(): Provider[] {
  const config = ssoConfig();
  if (!config) return [];

  return [
    {
      id: SSO_PROVIDER_ID,
      name: config.label,
      type: "oidc",
      issuer: config.issuer,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      // Only what is needed to identify a person. AMX asks an IdP for nothing
      // about groups or roles, because it would not honour them if it got them.
      authorization: { params: { scope: "openid email profile" } },
      allowDangerousEmailAccountLinking: false,
    },
  ];
}
