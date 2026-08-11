import { ActionForm, SubmitButton } from "@/components/action-form";
import {
  Band,
  Input,
  Label,
  Muted,
  Panel,
  SectionTitle,
  Textarea,
} from "@/components/ui/primitives";
import { StaleBanner } from "@/components/ui/status";
import { saveCharterAction } from "@/app/(app)/agents/[id]/stages/[stage]/actions";
import type { AgentCharter } from "@/lib/artifacts/schemas";
import { AGENT_ARCHETYPES, RISK_TIERS } from "@/lib/enums";

const ARCHETYPE_HELP: Record<string, string> = {
  Analyst: "Answers questions with numbers. Explains, does not decide.",
  Advisor: "Recommends a course of action, with the reasoning shown.",
  Monitor: "Watches for a condition and raises it when it appears.",
  Operator: "Takes an action in a system, within stated limits.",
  Navigator: "Helps someone find their way to the right data or process.",
  Educator: "Teaches a concept or a procedure.",
};

const RISK_HELP: Record<string, string> = {
  informational: "Tells someone something. Wrong answers cost time.",
  "decision-support": "Informs a decision a human still makes. Wrong answers cost money.",
  "action-taking": "Does something in a system. Wrong answers cost trust — and require a veto review.",
};

/**
 * Stage 2 · Agent Charter.
 *
 * Hard-blocked until Stage 1 has produced a persona with real questions, and
 * the block is stated up front rather than discovered at submit. The
 * out-of-scope list is a required field for a reason: an agent with no stated
 * exclusions has an aspiration, not a boundary.
 */
export function StageTwo({
  agentId,
  charter,
  personaFloorMet,
  locked,
}: {
  agentId: string;
  charter: AgentCharter | null;
  personaFloorMet: boolean;
  locked: boolean;
}) {
  if (!personaFloorMet) {
    return (
      <Panel>
        <SectionTitle>Chartering is blocked until Stage 1 is real</SectionTitle>
        <div className="mt-4">
          <StaleBanner
            title="No persona with three complete questions yet"
            cause="A charter written before the questions is a guess about scope. The mission, the boundary, and the out-of-scope list all come from what the persona actually needs answered."
            action={
              <a
                href={`/agents/${agentId}/stages/1-consumption-discovery`}
                className="font-medium underline underline-offset-2"
              >
                Go back to Stage 1
              </a>
            }
          />
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <SectionTitle>Agent charter</SectionTitle>
      <Muted className="mt-1 max-w-prose">
        Agents are chartered, not deployed. Nothing advances past here without a mission, a
        boundary with explicit exclusions, a risk tier, and a human whose name is on it.
      </Muted>

      {locked ? null : (
        <Band className="mt-4">
          Write the mission as one sentence. If it needs two, the agent is probably two agents.
        </Band>
      )}

      <ActionForm action={saveCharterAction} className="mt-5 space-y-4">
        <input type="hidden" name="agentId" value={agentId} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="archetype">Archetype</Label>
            <select
              id="archetype"
              name="archetype"
              defaultValue={charter?.archetype ?? "Analyst"}
              disabled={locked}
              className="h-10 w-full rounded border border-border bg-surface px-3 text-body disabled:opacity-60"
            >
              {AGENT_ARCHETYPES.values.map((archetype) => (
                <option key={archetype} value={archetype}>
                  {archetype} — {ARCHETYPE_HELP[archetype]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="riskTier">Risk tier</Label>
            <select
              id="riskTier"
              name="riskTier"
              defaultValue={charter?.riskTier ?? "decision-support"}
              disabled={locked}
              className="h-10 w-full rounded border border-border bg-surface px-3 text-body disabled:opacity-60"
            >
              {RISK_TIERS.values.map((tier) => (
                <option key={tier} value={tier}>
                  {tier} — {RISK_HELP[tier]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <Label htmlFor="mission" hint="one sentence">
            Mission
          </Label>
          <Textarea
            id="mission"
            name="mission"
            rows={2}
            required
            maxLength={240}
            disabled={locked}
            defaultValue={charter?.mission}
            placeholder="Help retention analysts find the residential accounts most likely to leave, and explain why using certified numbers."
          />
        </div>

        <div>
          <Label htmlFor="scopeBoundary">Scope boundary</Label>
          <Textarea
            id="scopeBoundary"
            name="scopeBoundary"
            rows={3}
            required
            disabled={locked}
            defaultValue={charter?.scopeBoundary}
            placeholder="Residential accounts in the retail book, using Customer 360 and Meter-to-Cash only. Advises; never contacts a customer."
          />
        </div>

        <div>
          <Label htmlFor="outOfScope" hint="one per line — at least one">
            Explicitly out of scope
          </Label>
          <Textarea
            id="outOfScope"
            name="outOfScope"
            rows={4}
            required
            disabled={locked}
            defaultValue={charter?.outOfScope.join("\n")}
            placeholder={"Commercial and industrial accounts\nMaking or approving retention offers\nAny customer-facing communication"}
          />
          <Muted className="mt-1">
            This list is what a reviewer reads first. An agent with no exclusions has no boundary.
          </Muted>
        </div>

        <div>
          <Label htmlFor="valueHypothesis">Value hypothesis</Label>
          <Textarea
            id="valueHypothesis"
            name="valueHypothesis"
            rows={2}
            required
            disabled={locked}
            defaultValue={charter?.valueHypothesis}
            placeholder="Analysts stop reconciling three dashboards by hand and start the week with a ranked, explainable list."
          />
        </div>

        <div>
          <Label htmlFor="successMeasures" hint="one per line">
            How we will know it worked
          </Label>
          <Textarea
            id="successMeasures"
            name="successMeasures"
            rows={3}
            required
            disabled={locked}
            defaultValue={charter?.successMeasures.join("\n")}
            placeholder={"Time from cycle open to a reviewed retention list under one hour\nEvery recommendation traceable to a certified metric"}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ownerName" hint="a person, not a team">
              Accountable owner
            </Label>
            <Input
              id="ownerName"
              name="ownerName"
              required
              disabled={locked}
              defaultValue={charter?.ownerName}
            />
          </div>
          <div>
            <Label htmlFor="escalationContact">Escalation contact</Label>
            <Input
              id="escalationContact"
              name="escalationContact"
              required
              disabled={locked}
              defaultValue={charter?.escalationContact}
            />
          </div>
        </div>

        <SubmitButton pendingLabel="Committing…">
          {charter ? "Commit a new version" : "Commit the charter"}
        </SubmitButton>
      </ActionForm>
    </Panel>
  );
}
