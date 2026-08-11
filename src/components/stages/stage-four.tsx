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
import {
  saveGroundingPackAction,
  saveToolSpecsAction,
} from "@/app/(app)/agents/[id]/stages/[stage]/actions";
import type { GroundingPack, ToolSpecs } from "@/lib/artifacts/schemas";

/**
 * Stage 4 · Grounding & Tool Design.
 *
 * The grounding pack is pre-filled from Stage 1 and Stage 3 rather than
 * starting blank: the sample questions are the register, and the metric
 * definitions are the metrics the bindings already name. The author edits
 * what is there instead of inventing a parallel document that can drift.
 *
 * There is deliberately nowhere to put a query. Every field here is a
 * question, a word, a metric, or a join between named semantic entities — and
 * the validator walks every string before anything is written.
 */
export function StageFour({
  agentId,
  agentSlug,
  pack,
  specs,
  bindingRefs,
  locked,
}: {
  agentId: string;
  agentSlug: string;
  pack: GroundingPack;
  specs: ToolSpecs | null;
  bindingRefs: { ref: string; label: string }[];
  locked: boolean;
}) {
  const tools = specs?.tools ?? [];

  return (
    <div className="space-y-6">
      <Panel>
        <SectionTitle>Grounding pack</SectionTitle>
        <Muted className="mt-1 max-w-prose">
          What the agent knows: worked examples, vocabulary, the certified metrics behind its
          numbers, and which semantic entities may be joined. Pre-filled from Stages 1 and 3.
        </Muted>
        <Band className="mt-3">
          There is no field for a query here, by design. Anything that reads like a table
          reference is rejected before this is saved.
        </Band>

        <ActionForm action={saveGroundingPackAction} className="mt-5 space-y-5">
          <input type="hidden" name="agentId" value={agentId} />
          <input type="hidden" name="agentSlug" value={agentSlug} />

          <fieldset disabled={locked} className="space-y-5 disabled:opacity-60">
            <div>
              <p className="font-medium">Sample questions</p>
              <Muted className="mb-2">
                Straight from the Stage 1 register, with the metric that answers each one.
              </Muted>
              <div className="space-y-2">
                {pack.sampleQuestions.map((sample, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
                    <Input
                      name={`sample.${index}.question`}
                      defaultValue={sample.question}
                      aria-label={`Sample question ${index + 1}`}
                    />
                    <Input
                      name={`sample.${index}.metricKey`}
                      defaultValue={sample.metricKey}
                      placeholder="metric key"
                      aria-label={`Metric for question ${index + 1}`}
                    />
                    <Input
                      name={`sample.${index}.expectedAnswerShape`}
                      defaultValue={sample.expectedAnswerShape}
                      placeholder="answer shape"
                      aria-label={`Answer shape for question ${index + 1}`}
                    />
                  </div>
                ))}
                <BlankRows
                  prefix="sample"
                  from={pack.sampleQuestions.length}
                  fields={["question", "metricKey", "expectedAnswerShape"]}
                  placeholders={["another question", "metric key", "answer shape"]}
                />
              </div>
            </div>

            <div>
              <p className="font-medium">Metric definitions</p>
              <Muted className="mb-2">
                Mirrored from the certified metrics your bindings name, so the agent uses the same
                words as the contract.
              </Muted>
              <div className="space-y-2">
                {pack.metricDefinitions.map((metric, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-[1fr_2fr_1fr]">
                    <Input
                      name={`metric.${index}.key`}
                      defaultValue={metric.key}
                      aria-label={`Metric key ${index + 1}`}
                    />
                    <Input
                      name={`metric.${index}.definition`}
                      defaultValue={metric.definition}
                      aria-label={`Metric definition ${index + 1}`}
                    />
                    <Input
                      name={`metric.${index}.grain`}
                      defaultValue={metric.grain}
                      placeholder="grain"
                      aria-label={`Metric grain ${index + 1}`}
                    />
                  </div>
                ))}
                <BlankRows
                  prefix="metric"
                  from={pack.metricDefinitions.length}
                  fields={["key", "definition", "grain"]}
                  placeholders={["metric key", "definition", "grain"]}
                  count={1}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="glossary" hint="one per line — term | definition">
                Glossary
              </Label>
              <Textarea
                id="glossary"
                name="glossary"
                rows={4}
                defaultValue={pack.glossary.map((g) => `${g.term} | ${g.definition}`).join("\n")}
                placeholder={"churn | A residential account terminating service, excluding in-territory moves"}
              />
            </div>

            <div>
              <Label htmlFor="allowedJoins" hint="one per line — from | to | join key">
                Allowed joins
              </Label>
              <Textarea
                id="allowedJoins"
                name="allowedJoins"
                rows={3}
                defaultValue={pack.allowedJoins.map((j) => `${j.from} | ${j.to} | ${j.on}`).join("\n")}
                placeholder={"customer | account | customer_id"}
              />
              <Muted className="mt-1">
                Semantic entities, not tables. Anything that looks like a physical table is
                rejected.
              </Muted>
            </div>

            <div>
              <Label htmlFor="hints" hint="one per line — term | how to resolve it">
                Disambiguation hints
              </Label>
              <Textarea
                id="hints"
                name="hints"
                rows={3}
                defaultValue={pack.disambiguationHints
                  .map((h) => `${h.ambiguousTerm} | ${h.resolution}`)
                  .join("\n")}
                placeholder={"account | Billing account, not the online login"}
              />
            </div>
          </fieldset>

          <SubmitButton pendingLabel="Validating…" disabled={locked}>
            Validate and commit the grounding pack
          </SubmitButton>
        </ActionForm>
      </Panel>

      <Panel>
        <SectionTitle>Tool specifications</SectionTitle>
        <Muted className="mt-1 max-w-prose">
          What the agent may call, and — more importantly — when it must refuse. Every tool acts
          through a binding declared at Stage 3; a tool with no binding behind it is ungoverned.
        </Muted>

        {bindingRefs.length === 0 ? (
          <Band className="mt-3">
            This agent has no bindings yet, so there is nothing for a tool to act through. Declare
            one at Stage 3 first.
          </Band>
        ) : null}

        <ActionForm action={saveToolSpecsAction} className="mt-5 space-y-5">
          <input type="hidden" name="agentId" value={agentId} />
          <input type="hidden" name="agentSlug" value={agentSlug} />

          <fieldset disabled={locked} className="space-y-5 disabled:opacity-60">
            {[...tools, null].map((tool, index) => (
              <ToolFieldset
                key={index}
                index={index}
                tool={tool}
                bindingRefs={bindingRefs}
                isNew={tool === null}
              />
            ))}
          </fieldset>

          <SubmitButton pendingLabel="Validating…" disabled={locked}>
            Validate and commit the tool specifications
          </SubmitButton>
        </ActionForm>
      </Panel>
    </div>
  );
}

function ToolFieldset({
  index,
  tool,
  bindingRefs,
  isNew,
}: {
  index: number;
  tool: ToolSpecs["tools"][number] | null;
  bindingRefs: { ref: string; label: string }[];
  isNew: boolean;
}) {
  const fieldLines = (fields: { name: string; type: string; description: string; required: boolean }[]) =>
    fields.map((f) => `${f.name} | ${f.type} | ${f.description} | ${f.required ? "yes" : "no"}`).join("\n");

  return (
    <div className="rounded border border-border p-4">
      <p className="font-medium">{isNew ? "Add a tool" : tool?.name}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`tool-name-${index}`}>Name</Label>
          <Input
            id={`tool-name-${index}`}
            name={`tool.${index}.name`}
            defaultValue={tool?.name}
            placeholder="lookup_account_risk"
          />
        </div>
        <div>
          <Label htmlFor={`tool-binding-${index}`}>Acts through</Label>
          <select
            id={`tool-binding-${index}`}
            name={`tool.${index}.bindingRef`}
            defaultValue={tool?.bindingRef ?? ""}
            className="h-10 w-full rounded border border-border bg-surface px-3 text-body"
          >
            <option value="">— pick a binding —</option>
            {bindingRefs.map((binding) => (
              <option key={binding.ref} value={binding.ref}>
                {binding.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3">
        <Label htmlFor={`tool-desc-${index}`}>What it does</Label>
        <Input
          id={`tool-desc-${index}`}
          name={`tool.${index}.description`}
          defaultValue={tool?.description}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`tool-inputs-${index}`} hint="name | type | description | required">
            Inputs
          </Label>
          <Textarea
            id={`tool-inputs-${index}`}
            name={`tool.${index}.inputs`}
            rows={3}
            defaultValue={tool ? fieldLines(tool.inputs) : ""}
            placeholder={"account_id | string | The billing account | yes"}
          />
        </div>
        <div>
          <Label htmlFor={`tool-outputs-${index}`} hint="name | type | description | required">
            Outputs
          </Label>
          <Textarea
            id={`tool-outputs-${index}`}
            name={`tool.${index}.outputs`}
            rows={3}
            defaultValue={tool ? fieldLines(tool.outputs) : ""}
            placeholder={"risk_score | number | High-bill risk, 0 to 1 | yes"}
          />
        </div>
      </div>

      <div className="mt-3">
        <Label htmlFor={`tool-refusals-${index}`} hint="one per line — required">
          When must it refuse?
        </Label>
        <Textarea
          id={`tool-refusals-${index}`}
          name={`tool.${index}.refusalRules`}
          rows={3}
          defaultValue={tool?.refusalRules.join("\n")}
          placeholder={"Refuse for commercial accounts — they are out of charter scope\nRefuse if asked for an individual's personal details"}
        />
      </div>

      <div className="mt-3">
        <Label htmlFor={`tool-escalation-${index}`}>Escalation path</Label>
        <Input
          id={`tool-escalation-${index}`}
          name={`tool.${index}.escalationPath`}
          defaultValue={tool?.escalationPath}
          placeholder="Hand off to the Revenue Assurance duty analyst"
        />
      </div>
    </div>
  );
}

/** Blank rows so "add another" needs no client state. Empty rows are dropped. */
function BlankRows({
  prefix,
  from,
  fields,
  placeholders,
  count = 2,
}: {
  prefix: string;
  from: number;
  fields: string[];
  placeholders: string[];
  count?: number;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, offset) => (
        <div
          key={offset}
          className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]"
        >
          {fields.map((field, column) => (
            <Input
              key={field}
              name={`${prefix}.${from + offset}.${field}`}
              placeholder={placeholders[column]}
              aria-label={`${placeholders[column]} (new row)`}
            />
          ))}
        </div>
      ))}
    </>
  );
}
