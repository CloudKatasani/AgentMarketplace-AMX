import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/action-form";
import {
  Band,
  EmptyState,
  Input,
  Label,
  Muted,
  PageTitle,
  Panel,
  SectionTitle,
  Textarea,
} from "@/components/ui/primitives";
import { Badge } from "@/components/ui/status";
import { listApiTokens } from "@/lib/api/tokens";
import { requireSessionContext } from "@/lib/auth/session-context";
import { withOrg } from "@/lib/db/scope";
import type { PlanTier } from "@/lib/enums";
import { listMembers } from "@/lib/organizations/members";
import { pendingInvitations } from "@/lib/organizations/invitations";
import { can, featuresFor } from "@/lib/plans/features";
import { ROLES } from "@/lib/roles";
import {
  OVERRIDABLE_TOKENS,
  THEME_FORM_PLACEHOLDER,
  readThemeOverride,
  toThemeForm,
} from "@/lib/theme/override";

import {
  inviteMemberAction,
  issueApiTokenAction,
  revokeApiTokenAction,
  revokeInvitationAction,
  saveThemeAction,
  setCredentialPolicyAction,
  setRoleAction,
} from "./actions";

/**
 * Workspace settings.
 *
 * The screen that turns a single-player workspace into a team one: who is here,
 * what they may sign for, who has been invited, whether an approver needs the
 * academy credential, and — on Enterprise — what the product looks like.
 *
 * Everything on this page is administration. Nothing here can approve anything.
 */
export default async function AdminPage() {
  const session = await requireSessionContext();
  const isAdmin = session.roleKeys.includes("org-admin");
  if (!isAdmin) notFound();

  const data = await withOrg(session.organizationId, async (db) => {
    const [members, invitations, tokens, organization, agentCount] = await Promise.all([
      listMembers(db, session.organizationId),
      pendingInvitations(db, session.organizationId),
      listApiTokens(db, session.organizationId),
      db.organization.findUnique({
        where: { id: session.organizationId },
        select: { requireApproverCredentials: true, themeOverride: true, isReadOnly: true },
      }),
      db.agent.count({ where: { archivedAt: null } }),
    ]);
    return { members, invitations, tokens, organization, agentCount };
  });

  const features = featuresFor(session.planTier as PlanTier);
  const whiteLabel = can(session.planTier as PlanTier, "whiteLabel");
  const apiAccess = can(session.planTier as PlanTier, "apiAccess");
  const theme = readThemeOverride(data.organization?.themeOverride ?? null);
  const readOnly = data.organization?.isReadOnly ?? false;

  return (
    <div className="space-y-6">
      <div>
        <PageTitle>Workspace settings</PageTitle>
        <Muted className="mt-1 max-w-prose">
          {session.organizationName} · {session.planTier} · {data.members.length} member
          {data.members.length === 1 ? "" : "s"} · {data.agentCount} agent
          {data.agentCount === 1 ? "" : "s"} of{" "}
          {features.maxAgents === Number.POSITIVE_INFINITY ? "unlimited" : features.maxAgents}
        </Muted>
      </div>

      {readOnly ? (
        <Band>
          This workspace is read-only, so nothing on this page can be changed. Create your own
          workspace to manage members.
        </Band>
      ) : null}

      <Panel>
        <SectionTitle>People</SectionTitle>
        <Muted className="mt-1 max-w-prose">
          A role decides which gates a person may sign. Granting one is recorded in the audit
          trail; whether they may actually decide a given gate is re-checked at decision time.
        </Muted>

        <ul className="mt-4 divide-y divide-border">
          {data.members.map((member) => (
            <li key={member.membershipId} className="py-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{member.name || member.email}</span>
                <span className="text-muted">{member.email}</span>
                {member.userId === session.userId ? <Badge tone="brand">you</Badge> : null}
                {member.credentialKeys.length > 0 ? (
                  <Badge tone="success">
                    {member.credentialKeys.length} credential
                    {member.credentialKeys.length === 1 ? "" : "s"}
                  </Badge>
                ) : null}
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {ROLES.map((role) => {
                  const held = member.roleKeys.includes(role.id);
                  return (
                    <ActionForm key={role.id} action={setRoleAction} className="inline-block">
                      <input type="hidden" name="membershipId" value={member.membershipId} />
                      <input type="hidden" name="roleKey" value={role.id} />
                      <input type="hidden" name="granted" value={held ? "0" : "1"} />
                      <SubmitButton
                        variant={held ? "primary" : "outline"}
                        size="sm"
                        disabled={readOnly}
                        pendingLabel="Saving…"
                      >
                        {role.name}
                        {role.requiresCredentialKey ? " ·" : ""}
                      </SubmitButton>
                    </ActionForm>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <SectionTitle>Invite someone</SectionTitle>
        <Muted className="mt-1 max-w-prose">
          Peer review needs a second person. Email delivery is stubbed in this deployment — the
          link appears here for you to send.
        </Muted>

        <ActionForm action={inviteMemberAction} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required disabled={readOnly} />
          </div>
          <div>
            <Label htmlFor="roleKey">Role</Label>
            <select
              id="roleKey"
              name="roleKey"
              defaultValue="agent-product-owner"
              disabled={readOnly}
              className="h-10 w-full rounded border border-border bg-surface px-3 text-body"
            >
              {ROLES.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton disabled={readOnly} pendingLabel="Inviting…">
            Send invitation
          </SubmitButton>
        </ActionForm>

        <div className="mt-6">
          <p className="font-medium">Pending invitations</p>
          {data.invitations.length === 0 ? (
            <Muted className="mt-1">Nobody is waiting to join.</Muted>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {data.invitations.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="font-medium">{invitation.email}</span>
                  <Badge tone="neutral">{invitation.roleName}</Badge>
                  {invitation.expired ? (
                    <Badge tone="warning">expired</Badge>
                  ) : (
                    <span className="text-muted">
                      expires {invitation.expiresAt.toISOString().slice(0, 10)}
                    </span>
                  )}
                  <code className="text-xs">{invitation.acceptPath}</code>
                  <ActionForm action={revokeInvitationAction} className="ml-auto">
                    <input type="hidden" name="invitationId" value={invitation.id} />
                    <SubmitButton
                      variant="outline"
                      size="sm"
                      disabled={readOnly}
                      pendingLabel="Revoking…"
                    >
                      Revoke
                    </SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Approver credentials</SectionTitle>
        <Muted className="mt-1 max-w-prose">
          When this is on, a role that names an academy credential may only be exercised by
          someone who holds it. Off by default: it is a choice, not something the product imposes.
        </Muted>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Badge tone={data.organization?.requireApproverCredentials ? "success" : "neutral"}>
            {data.organization?.requireApproverCredentials ? "required" : "not required"}
          </Badge>
          <ActionForm action={setCredentialPolicyAction}>
            <input
              type="hidden"
              name="required"
              value={data.organization?.requireApproverCredentials ? "0" : "1"}
            />
            <SubmitButton variant="outline" disabled={readOnly} pendingLabel="Saving…">
              {data.organization?.requireApproverCredentials
                ? "Stop requiring credentials"
                : "Require credentials to approve"}
            </SubmitButton>
          </ActionForm>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>API tokens</SectionTitle>
        <Muted className="mt-1 max-w-prose">
          Read-only access to this workspace&rsquo;s agents, data products and audit trail. There
          are no write endpoints: an approval is an act by a named person at a gate, and a bearer
          token is not a person.
        </Muted>

        {apiAccess ? (
          <>
            <ActionForm
              action={issueApiTokenAction}
              className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
            >
              <div>
                <Label htmlFor="tokenName" hint="what will use it">
                  Token name
                </Label>
                <Input
                  id="tokenName"
                  name="name"
                  required
                  minLength={2}
                  disabled={readOnly}
                  placeholder="Governance dashboard"
                />
              </div>
              <SubmitButton disabled={readOnly} pendingLabel="Issuing…">
                Issue a token
              </SubmitButton>
            </ActionForm>

            {data.tokens.length === 0 ? (
              <Muted className="mt-4">No tokens yet.</Muted>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {data.tokens.map((token) => (
                  <li key={token.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="font-medium">{token.name}</span>
                    <code className="text-xs">{token.prefix}…</code>
                    <span className="text-muted">
                      {token.lastUsedAt
                        ? `last used ${token.lastUsedAt.toISOString().slice(0, 10)}`
                        : "never used"}
                    </span>
                    {token.revokedAt ? (
                      <Badge tone="warning">revoked</Badge>
                    ) : (
                      <ActionForm action={revokeApiTokenAction} className="ml-auto">
                        <input type="hidden" name="tokenId" value={token.id} />
                        <SubmitButton
                          variant="outline"
                          size="sm"
                          disabled={readOnly}
                          pendingLabel="Revoking…"
                        >
                          Revoke
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <Band className="mt-4">
              <code className="text-xs">
                curl -H &quot;Authorization: Bearer amx_…&quot; {"{origin}"}/api/v1/agents
              </code>
            </Band>
          </>
        ) : (
          <EmptyState
            title="API access is part of Enterprise"
            body="Read agents, data products and the audit trail from your own systems, with tokens you can revoke."
          />
        )}
      </Panel>

      <Panel>
        <SectionTitle>Rebrand this workspace</SectionTitle>
        <Muted className="mt-1 max-w-prose">
          One token per line. Values are colours — a six-digit hex, or three RGB channels. Only
          brand and surface tokens can be overridden: success, warning and danger carry meaning
          and contrast guarantees a rebrand must not be able to break.
        </Muted>

        {whiteLabel ? (
          <ActionForm action={saveThemeAction} className="mt-4 space-y-3">
            <Label htmlFor="theme" hint={OVERRIDABLE_TOKENS.join(", ")}>
              Token overrides
            </Label>
            <Textarea
              id="theme"
              name="theme"
              rows={6}
              disabled={readOnly}
              defaultValue={toThemeForm(theme)}
              placeholder={THEME_FORM_PLACEHOLDER}
            />
            <SubmitButton disabled={readOnly} pendingLabel="Saving…">
              Save the theme
            </SubmitButton>
          </ActionForm>
        ) : (
          <EmptyState
            title="Rebranding is part of Enterprise"
            body="Override the brand and surface tokens so every screen carries your palette. The default Capgemini light theme applies until then."
          />
        )}
      </Panel>
    </div>
  );
}
