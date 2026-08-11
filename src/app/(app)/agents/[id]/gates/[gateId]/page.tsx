import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/action-form";
import { Band, Label, Muted, PageTitle, Panel, SectionTitle, Textarea } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/status";
import { requireSessionContext } from "@/lib/auth/session-context";
import { withOrg } from "@/lib/db/scope";
import { stageByKey } from "@/lib/lifecycle/stages";
import { roleName, type RoleKey } from "@/lib/roles";

import { recordDecisionAction } from "../../actions";

export default async function GatePage({
  params,
}: {
  params: Promise<{ id: string; gateId: string }>;
}) {
  const { id, gateId } = await params;
  const session = await requireSessionContext();

  const data = await withOrg(session.organizationId, async (db) => {
    const gate = await db.gate.findUnique({
      where: { id: gateId },
      select: {
        id: true,
        agentId: true,
        stageId: true,
        round: true,
        mode: true,
        status: true,
        quorum: true,
        snapshotHash: true,
        openedAt: true,
        staleReason: true,
        approvals: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            userId: true,
            roleId: true,
            decision: true,
            comment: true,
            isSelfAttestation: true,
            attestationStatement: true,
            createdAt: true,
          },
        },
      },
    });
    if (!gate || gate.agentId !== id) return null;

    const agent = await db.agent.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    return { gate, agent };
  });

  if (!data?.gate || !data.agent) notFound();
  const { gate, agent } = data;
  const stage = stageByKey(gate.stageId);

  const decidedRoles = new Set(
    gate.approvals.filter((a) => a.decision === "APPROVE").map((a) => a.roleId),
  );
  const eligibleRoles = [...stage.requiredApproverRoles, ...stage.vetoRoles].filter((role) =>
    session.roleKeys.includes(role),
  );
  const isSolo = gate.mode === "SOLO_ATTESTATION";
  const canDecide = gate.status === "OPEN" && eligibleRoles.length > 0 && !session.isReadOnly;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/agents/${agent.id}`} className="text-muted">
          ← {agent.name}
        </Link>
        <PageTitle className="mt-1">{stage.name} · gate</PageTitle>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={gate.status === "APPROVED" ? "success" : "brand"}>
            {gate.status.toLowerCase().replace("_", " ")}
          </Badge>
          <span className="text-muted">round {gate.round}</span>
          {isSolo ? <Badge tone="brand">Self-review</Badge> : null}
        </div>
      </div>

      <Panel>
        <SectionTitle>What this gate approves</SectionTitle>
        <Muted className="mt-1">
          A gate approves a specific set of artifact versions, not a stage in the abstract. If any
          of them change, this approval no longer describes what exists — and the gate goes stale
          rather than quietly covering the new version.
        </Muted>
        <Band className="mt-3 font-mono text-xs break-all">snapshot {gate.snapshotHash}</Band>
        {gate.staleReason ? (
          <p className="mt-3 rounded bg-warning-tint px-3 py-2 text-warning">{gate.staleReason}</p>
        ) : null}
      </Panel>

      <Panel>
        <SectionTitle>Decisions</SectionTitle>
        {gate.approvals.length === 0 ? (
          <Muted className="mt-2">Nobody has decided yet.</Muted>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {gate.approvals.map((approval) => (
              <li key={approval.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{roleName(approval.roleId)}</span>
                  <Badge
                    tone={
                      approval.decision === "APPROVE"
                        ? "success"
                        : approval.decision === "VETO"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {approval.decision.toLowerCase().replace("_", " ")}
                  </Badge>
                  {approval.isSelfAttestation ? <Badge tone="brand">self-attested</Badge> : null}
                </div>
                {approval.comment ? <p className="mt-1">{approval.comment}</p> : null}
                {approval.attestationStatement ? (
                  <blockquote className="mt-2 border-l-2 border-brand-accent pl-3 text-muted">
                    {approval.attestationStatement}
                  </blockquote>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {!isSolo ? (
          <Band className="mt-4">
            Needs {stage.requiredApproverRoles.map(roleName).join(" and ")}.
            {stage.requiredApproverRoles.filter((r) => !decidedRoles.has(r)).length > 0
              ? ` Still waiting on ${stage.requiredApproverRoles
                  .filter((r) => !decidedRoles.has(r))
                  .map(roleName)
                  .join(" and ")}.`
              : " All required roles have approved."}
          </Band>
        ) : null}
      </Panel>

      {canDecide ? (
        <Panel>
          <SectionTitle>Record your decision</SectionTitle>
          <ActionForm action={recordDecisionAction} className="mt-4 space-y-4">
            <input type="hidden" name="agentId" value={agent.id} />
            <input type="hidden" name="gateId" value={gate.id} />

            <div>
              <Label htmlFor="roleKey">Deciding as</Label>
              <select
                id="roleKey"
                name="roleKey"
                required
                className="h-10 w-full rounded border border-border bg-surface px-3 text-body"
              >
                {eligibleRoles.map((role: RoleKey) => (
                  <option key={role} value={role}>
                    {roleName(role)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="decision">Decision</Label>
              <select
                id="decision"
                name="decision"
                required
                className="h-10 w-full rounded border border-border bg-surface px-3 text-body"
              >
                <option value="APPROVE">Approve</option>
                <option value="REQUEST_CHANGES">Request changes</option>
                {stage.vetoRoles.some((r) => session.roleKeys.includes(r)) ? (
                  <option value="VETO">Veto</option>
                ) : null}
              </select>
            </div>

            <div>
              <Label htmlFor="comment" hint="optional">
                Comment
              </Label>
              <Textarea id="comment" name="comment" rows={2} />
            </div>

            {isSolo ? (
              <div>
                <Label htmlFor="attestationStatement">
                  Attestation
                  <span className="ml-2 font-normal text-muted">
                    in your own words, at least {stage.soloAttestation.minStatementLength}{" "}
                    characters
                  </span>
                </Label>
                <Textarea
                  id="attestationStatement"
                  name="attestationStatement"
                  rows={3}
                  defaultValue={stage.soloAttestation.statementTemplate}
                />
                <Muted className="mt-1">
                  This is recorded verbatim in the audit trail and the evidence pack, and the
                  certification badge will read &ldquo;self-attested&rdquo; rather than
                  &ldquo;peer-certified&rdquo;.
                </Muted>
              </div>
            ) : null}

            <SubmitButton pendingLabel="Recording…">Record decision</SubmitButton>
          </ActionForm>
        </Panel>
      ) : (
        <Panel>
          <Muted>
            {gate.status !== "OPEN"
              ? "This gate has been decided. Re-submitting the stage opens a new round."
              : session.isReadOnly
                ? "This is the read-only demo workspace, so decisions cannot be recorded here."
                : `You do not hold an approver role for ${stage.name}. It needs ${stage.requiredApproverRoles.map(roleName).join(" or ")}.`}
          </Muted>
        </Panel>
      )}
    </div>
  );
}
