import { ActionForm, SubmitButton } from "@/components/action-form";
import {
  Band,
  EmptyState,
  Input,
  Label,
  Muted,
  Panel,
  SectionTitle,
  Textarea,
} from "@/components/ui/primitives";
import { Badge } from "@/components/ui/status";
import { INTENT_CLASSES, PERSONA_KINDS, type IntentClass } from "@/lib/enums";
import {
  archiveQuestionAction,
  savePersonaAction,
  saveQuestionAction,
} from "@/app/(app)/agents/[id]/stages/[stage]/actions";

export type StageOnePersona = {
  id: string;
  name: string;
  kind: string;
  ownedDecisions: string;
  cadence: string;
  currentWorkaround: string;
  questions: {
    id: string;
    text: string;
    intentClass: IntentClass;
    consequenceOfNoAnswer: string;
    expectedAnswerShape: string;
  }[];
};

const MINIMUM = 3;

/**
 * Stage 1 · Consumption Discovery.
 *
 * The most important screen in the product, so it is built around the sentence
 * a practitioner has to be able to finish: *"X has to decide Y, every Z, and
 * today they do W instead."* Everything else — intent classes, answer shapes —
 * is secondary to getting that sentence honest.
 *
 * The question form insists on the consequence of having no answer, because a
 * question with no consequence is a nice-to-have, and agents built from
 * nice-to-haves are the ones nobody uses.
 */
export function StageOne({
  agentId,
  personas,
  locked,
}: {
  agentId: string;
  personas: StageOnePersona[];
  locked: boolean;
}) {
  const intents = new Set(personas.flatMap((p) => p.questions.map((q) => q.intentClass)));

  return (
    <div className="space-y-6">
      <Panel>
        <SectionTitle>Who is blocked, and on what?</SectionTitle>
        <Muted className="mt-1 max-w-prose">
          An agent starts with the person whose decision is stuck — never with the model. Name the
          role, the decision they own, and what they do today instead.
        </Muted>

        {personas.length > 0 ? (
          <Band className="mt-4">
            {personas.length} persona{personas.length === 1 ? "" : "s"} ·{" "}
            {personas.reduce((total, p) => total + p.questions.length, 0)} questions ·{" "}
            {intents.size} intent class{intents.size === 1 ? "" : "es"}. Stage 2 unlocks once one
            persona has {MINIMUM} complete questions.
          </Band>
        ) : null}
      </Panel>

      {personas.length === 0 ? (
        <EmptyState
          title="No personas yet"
          body="Start with one real role — a named job someone in the business actually holds — and the decision they own. The agent's scope comes from their questions, not the other way round."
        />
      ) : null}

      {personas.map((persona) => {
        const complete = persona.questions.filter(
          (q) => q.text && q.consequenceOfNoAnswer && q.expectedAnswerShape,
        ).length;

        return (
          <Panel key={persona.id} className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <SectionTitle>{persona.name}</SectionTitle>
                <Muted className="mt-1 max-w-prose">{persona.ownedDecisions}</Muted>
                <p className="mt-1 text-muted">
                  {persona.cadence} · today: {persona.currentWorkaround}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="neutral">{persona.kind.toLowerCase()}</Badge>
                <Badge tone={complete >= MINIMUM ? "success" : "warning"}>
                  {complete >= MINIMUM
                    ? `${complete} complete question${complete === 1 ? "" : "s"}`
                    : `${complete} of ${MINIMUM} questions`}
                </Badge>
              </div>
            </div>

            {persona.questions.length > 0 ? (
              <ul className="divide-y divide-border">
                {persona.questions.map((question) => (
                  <li key={question.id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{question.text}</p>
                        <p className="mt-0.5 text-muted">
                          Without an answer: {question.consequenceOfNoAnswer}
                        </p>
                        <p className="mt-0.5 text-muted">
                          Answer looks like: {question.expectedAnswerShape}
                        </p>
                      </div>
                      <Badge tone="neutral">{question.intentClass}</Badge>
                    </div>

                    {!locked ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-muted">Edit or archive</summary>
                        <div className="mt-3 space-y-3 border-l-2 border-border pl-4">
                          <QuestionForm
                            agentId={agentId}
                            personas={personas}
                            question={question}
                            defaultPersonaId={persona.id}
                          />
                          <ActionForm action={archiveQuestionAction}>
                            <input type="hidden" name="agentId" value={agentId} />
                            <input type="hidden" name="questionId" value={question.id} />
                            <SubmitButton variant="outline" size="sm" pendingLabel="Archiving…">
                              Archive this question
                            </SubmitButton>
                          </ActionForm>
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Muted>
                No questions yet. A persona without questions tells us who is blocked but not on
                what.
              </Muted>
            )}

            {!locked ? (
              <>
                <details>
                  <summary className="cursor-pointer font-medium">Add a question</summary>
                  <div className="mt-3">
                    <QuestionForm
                      agentId={agentId}
                      personas={personas}
                      defaultPersonaId={persona.id}
                    />
                  </div>
                </details>

                <details>
                  <summary className="cursor-pointer text-muted">Edit this persona</summary>
                  <div className="mt-3">
                    <PersonaForm agentId={agentId} persona={persona} />
                  </div>
                </details>
              </>
            ) : null}
          </Panel>
        );
      })}

      {!locked ? (
        <Panel>
          <SectionTitle>Add a persona</SectionTitle>
          <div className="mt-4">
            <PersonaForm agentId={agentId} />
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function PersonaForm({
  agentId,
  persona,
}: {
  agentId: string;
  persona?: StageOnePersona;
}) {
  const id = persona?.id ?? "new";
  return (
    <ActionForm action={savePersonaAction} className="space-y-3">
      <input type="hidden" name="agentId" value={agentId} />
      {persona ? <input type="hidden" name="personaId" value={persona.id} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`p-name-${id}`}>Role</Label>
          <Input
            id={`p-name-${id}`}
            name="name"
            required
            defaultValue={persona?.name}
            placeholder="Revenue Assurance Analyst"
          />
        </div>
        <div>
          <Label htmlFor={`p-kind-${id}`}>Business or IT</Label>
          <select
            id={`p-kind-${id}`}
            name="kind"
            defaultValue={persona?.kind ?? "BUSINESS"}
            className="h-10 w-full rounded border border-border bg-surface px-3 text-body"
          >
            {PERSONA_KINDS.values.map((kind) => (
              <option key={kind} value={kind}>
                {kind === "BUSINESS" ? "Business role" : "IT role"}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor={`p-decisions-${id}`} hint="the decision they own">
          What do they decide?
        </Label>
        <Textarea
          id={`p-decisions-${id}`}
          name="ownedDecisions"
          rows={2}
          required
          defaultValue={persona?.ownedDecisions}
          placeholder="Which residential accounts get a retention offer this cycle."
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`p-cadence-${id}`}>How often?</Label>
          <Input
            id={`p-cadence-${id}`}
            name="cadence"
            required
            defaultValue={persona?.cadence}
            placeholder="Weekly, with a daily exception review"
          />
        </div>
        <div>
          <Label htmlFor={`p-workaround-${id}`} hint="the baseline to beat">
            What do they do today?
          </Label>
          <Input
            id={`p-workaround-${id}`}
            name="currentWorkaround"
            required
            defaultValue={persona?.currentWorkaround}
            placeholder="Exports three dashboards and reconciles by hand"
          />
        </div>
      </div>

      <SubmitButton pendingLabel="Saving…">
        {persona ? "Save persona" : "Add persona"}
      </SubmitButton>
    </ActionForm>
  );
}

function QuestionForm({
  agentId,
  personas,
  question,
  defaultPersonaId,
}: {
  agentId: string;
  personas: StageOnePersona[];
  question?: StageOnePersona["questions"][number];
  defaultPersonaId: string;
}) {
  const id = question?.id ?? `new-${defaultPersonaId}`;
  return (
    <ActionForm action={saveQuestionAction} className="space-y-3">
      <input type="hidden" name="agentId" value={agentId} />
      {question ? <input type="hidden" name="questionId" value={question.id} /> : null}

      <div>
        <Label htmlFor={`q-text-${id}`} hint="in their words">
          The question
        </Label>
        <Textarea
          id={`q-text-${id}`}
          name="questionText"
          rows={2}
          required
          defaultValue={question?.text}
          placeholder="Which residential segments are churning faster than last quarter?"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`q-persona-${id}`}>Asked by</Label>
          <select
            id={`q-persona-${id}`}
            name="personaId"
            defaultValue={defaultPersonaId}
            className="h-10 w-full rounded border border-border bg-surface px-3 text-body"
          >
            {personas.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`q-intent-${id}`}>Intent</Label>
          <select
            id={`q-intent-${id}`}
            name="intentClass"
            defaultValue={question?.intentClass ?? "lookup"}
            className="h-10 w-full rounded border border-border bg-surface px-3 text-body"
          >
            {INTENT_CLASSES.values.map((intent) => (
              <option key={intent} value={intent}>
                {intent}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor={`q-consequence-${id}`} hint="this is the one that matters">
          What happens if they can&rsquo;t answer it?
        </Label>
        <Textarea
          id={`q-consequence-${id}`}
          name="consequenceOfNoAnswer"
          rows={2}
          required
          defaultValue={question?.consequenceOfNoAnswer}
          placeholder="Retention budget goes to the loudest segment rather than the one actually leaving."
        />
      </div>

      <div>
        <Label htmlFor={`q-shape-${id}`}>What does a good answer look like?</Label>
        <Input
          id={`q-shape-${id}`}
          name="expectedAnswerShape"
          required
          defaultValue={question?.expectedAnswerShape}
          placeholder="Ranked segment list with churn rate and change versus prior quarter"
        />
      </div>

      <SubmitButton pendingLabel="Saving…">
        {question ? "Save question" : "Add question"}
      </SubmitButton>
    </ActionForm>
  );
}
