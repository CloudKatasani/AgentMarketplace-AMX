import { ActionForm, SubmitButton } from "@/components/action-form";
import { CoverageMatrix } from "@/components/coverage-matrix";
import {
  Band,
  EmptyState,
  Label,
  Muted,
  Panel,
  SectionTitle,
  Textarea,
} from "@/components/ui/primitives";
import { Badge } from "@/components/ui/status";
import { declareBindingAction, setCoverageAction } from "@/app/(app)/agents/[id]/actions";
import { importDataProductAction } from "@/app/(app)/agents/[id]/stages/[stage]/actions";
import type { CoverageMatrix as Matrix } from "@/lib/bindings/coverage";
import { BINDING_TYPES, BINDING_TYPE_LABELS } from "@/lib/enums";

export type StageThreeBinding = {
  id: string;
  status: string;
  bindingType: string;
  staleReason: string | null;
  productName: string;
  productContractVersion: string;
  purpose: string | null;
  pinnedContractVersion: string | null;
  metricKeys: string[];
};

export type StageThreeProduct = {
  id: string;
  name: string;
  contractVersion: string;
  qualityScore: number;
  layer: string;
  metrics: { id: string; key: string; name: string; certifiedAt: Date | null }[];
};

const EXAMPLE_IMPORT = `{
  "listing": {
    "key": "network-reliability",
    "name": "Network Reliability",
    "description": "Certified outage and restoration metrics by feeder and premise.",
    "owner": "Network Operations",
    "layer": "GOLD",
    "qualityScore": 91,
    "sensitivity": "INTERNAL"
  },
  "contract": { "version": "1.0.0", "changeSummary": "Initial import." },
  "semanticModel": {
    "version": "1.0.0",
    "entities": ["feeder", "premise"],
    "metrics": [
      {
        "key": "saidi_minutes",
        "name": "SAIDI",
        "definition": "Average interruption duration per customer served, in minutes.",
        "grain": "feeder / month",
        "semanticRef": "semantic.network_reliability.saidi_minutes",
        "certified": true
      }
    ]
  }
}`;

/**
 * Stage 3 · Data Product Binding — the workhorse.
 *
 * Three things happen here and they are deliberately on one screen: what the
 * agent stands on, whether the validator accepts it, and whether every
 * question has something certified to answer it. Splitting them across tabs
 * would let someone declare bindings without ever seeing the coverage gap.
 */
export function StageThree({
  agentId,
  bindings,
  products,
  matrix,
  locked,
}: {
  agentId: string;
  bindings: StageThreeBinding[];
  products: StageThreeProduct[];
  matrix: Matrix;
  locked: boolean;
}) {
  const uncovered = matrix.questions.filter((q) => matrix.uncoveredQuestionIds.includes(q.id));

  return (
    <div className="space-y-6">
      <Panel>
        <SectionTitle>Bindings</SectionTitle>
        <Muted className="mt-1">
          What this agent stands on. Each binding is versioned and pinned to the contract version
          it was approved against.
        </Muted>

        {bindings.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No bindings yet"
              body="An agent with no bindings stands on nothing that has been certified. Bind it to a data product below."
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {bindings.map((binding) => (
              <li key={binding.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{binding.productName}</span>
                  <Badge tone="neutral">
                    {binding.bindingType.replace(/_/g, " ").toLowerCase()}
                  </Badge>
                  {binding.status === "STALE" ? (
                    <Badge tone="warning">Stale</Badge>
                  ) : (
                    <Badge tone="brand">{binding.status.toLowerCase()}</Badge>
                  )}
                  <span className="text-muted">
                    pinned to contract {binding.pinnedContractVersion ?? "—"}
                    {binding.pinnedContractVersion &&
                    binding.pinnedContractVersion !== binding.productContractVersion
                      ? ` · product is now ${binding.productContractVersion}`
                      : ""}
                  </span>
                </div>
                <p className="mt-1 max-w-prose text-muted">{binding.purpose}</p>
                {binding.metricKeys.length > 0 ? (
                  <p className="mt-1 text-muted">Metrics: {binding.metricKeys.join(", ")}</p>
                ) : null}
                {binding.staleReason ? (
                  <p className="mt-2 rounded bg-warning-tint px-3 py-2 text-warning">
                    {binding.staleReason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {!locked ? (
        <Panel>
          <SectionTitle>Declare a binding</SectionTitle>
          <Muted className="mt-1">
            The validator runs before anything is saved. A binding that fails is not written at
            all — you will see why, and what to do instead.
          </Muted>

          <ActionForm action={declareBindingAction} className="mt-4 space-y-4">
            <input type="hidden" name="agentId" value={agentId} />

            <div>
              <Label htmlFor="dataProductId">Data product</Label>
              <select
                id="dataProductId"
                name="dataProductId"
                required
                className="h-10 w-full rounded border border-border bg-surface px-3 text-body"
              >
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} · contract {product.contractVersion} · quality{" "}
                    {product.qualityScore} · {product.layer}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="type">Binding type</Label>
              <select
                id="type"
                name="type"
                required
                className="h-10 w-full rounded border border-border bg-surface px-3 text-body"
              >
                {BINDING_TYPES.values.map((type) => (
                  <option key={type} value={type}>
                    {BINDING_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="purpose" hint="one sentence">
                What is this binding for?
              </Label>
              <Textarea id="purpose" name="purpose" rows={2} required minLength={10} />
            </div>

            <fieldset>
              <legend className="mb-1 font-medium">
                Certified metrics{" "}
                <span className="font-normal text-muted">required for a QUERIES binding</span>
              </legend>
              <div className="space-y-1">
                {products.flatMap((product) =>
                  product.metrics.map((metric) => (
                    <label key={metric.id} className="flex items-center gap-2">
                      <input type="checkbox" name="metricIds" value={metric.id} />
                      <span>
                        {metric.name}{" "}
                        <span className="text-muted">
                          ({product.name} · {metric.key}
                          {metric.certifiedAt ? "" : " · not certified"})
                        </span>
                      </span>
                    </label>
                  )),
                )}
              </div>
            </fieldset>

            <SubmitButton pendingLabel="Validating…">Validate and commit</SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}

      <Panel id="matrix">
        <SectionTitle>Question coverage</SectionTitle>
        <div className="mt-3">
          <CoverageMatrix matrix={matrix} />
        </div>

        {!locked && matrix.bindings.length > 0 && matrix.questions.length > 0 ? (
          <ActionForm action={setCoverageAction} className="mt-5 space-y-3">
            <input type="hidden" name="agentId" value={agentId} />
            <p className="font-medium">
              {uncovered.length > 0 ? "Cover a question" : "Change a mapping"}
            </p>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="coverage-question">Question</Label>
                <select
                  id="coverage-question"
                  name="questionId"
                  required
                  className="h-10 w-full rounded border border-border bg-surface px-3 text-body"
                >
                  {[...uncovered, ...matrix.questions.filter((q) => !uncovered.includes(q))].map(
                    (question) => (
                      <option key={question.id} value={question.id}>
                        {matrix.uncoveredQuestionIds.includes(question.id) ? "◻ " : "✓ "}
                        {question.text}
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div>
                <Label htmlFor="coverage-binding">Answered by</Label>
                <select
                  id="coverage-binding"
                  name="bindingId"
                  required
                  className="h-10 w-full rounded border border-border bg-surface px-3 text-body"
                >
                  {matrix.bindings.map((binding) => (
                    <option key={binding.id} value={binding.id}>
                      {binding.productName} · {binding.type.replace(/_/g, " ").toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="coverage-metric" hint="optional for context bindings">
                  Using metric
                </Label>
                <select
                  id="coverage-metric"
                  name="certifiedMetricId"
                  className="h-10 w-full rounded border border-border bg-surface px-3 text-body"
                >
                  <option value="">— context only —</option>
                  {products.flatMap((product) =>
                    product.metrics.map((metric) => (
                      <option key={metric.id} value={metric.id}>
                        {metric.key}
                      </option>
                    )),
                  )}
                </select>
              </div>
            </div>

            <SubmitButton pendingLabel="Mapping…">Map it</SubmitButton>
          </ActionForm>
        ) : null}
      </Panel>

      {!locked ? (
        <Panel>
          <SectionTitle>Register a data product from an export</SectionTitle>
          <Muted className="mt-1 max-w-prose">
            AMX does not build data products — it binds agents to them. Paste a DPF/ADPM export
            and the product, its contract version, and its certified metrics are registered
            together.
          </Muted>
          <Band className="mt-3">
            Imports are refused if the product is served from a raw or intermediate layer, or if a
            metric resolves to a physical table. A product an agent could never legally bind to is
            not worth registering.
          </Band>

          <ActionForm action={importDataProductAction} className="mt-4 space-y-3">
            <input type="hidden" name="agentId" value={agentId} />
            <div>
              <Label htmlFor="payload" hint="marketplace-listing + data-contract + semantic-model">
                Export JSON
              </Label>
              <Textarea
                id="payload"
                name="payload"
                rows={10}
                required
                className="font-mono text-xs"
                placeholder={EXAMPLE_IMPORT}
              />
            </div>
            <SubmitButton variant="outline" pendingLabel="Importing…">
              Register the product
            </SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}
    </div>
  );
}
