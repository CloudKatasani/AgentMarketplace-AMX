import { ActionForm, SubmitButton } from "@/components/action-form";
import { Label, Muted, Panel, SectionTitle, Textarea } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/status";
import {
  addCommentAction,
  resolveCommentAction,
} from "@/app/(app)/agents/[id]/stages/[stage]/actions";
import type { StageComment } from "@/lib/stages/review";

/**
 * Reviewer comments and the parking lot.
 *
 * A comment anchors to the version it was written about and, where the
 * reviewer says so, to the field. That is what turns a changes-requested round
 * into a list of specific edits rather than a mood.
 *
 * The parking lot is separate on purpose: it holds the things worth
 * remembering that must never block a gate. Without somewhere to put them,
 * they end up as blocking comments, and the gate stops meaning anything.
 */
export function ReviewPanel({
  agentId,
  stageId,
  comments,
  fieldOptions,
  readOnly,
}: {
  agentId: string;
  stageId: string;
  comments: StageComment[];
  fieldOptions: { path: string; label: string }[];
  readOnly: boolean;
}) {
  const review = comments.filter((c) => !c.isParkingLot);
  const parkingLot = comments.filter((c) => c.isParkingLot);
  const open = review.filter((c) => !c.resolvedAt);

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>Review comments</SectionTitle>
          {open.length > 0 ? (
            <Badge tone="warning">
              {open.length} unresolved
            </Badge>
          ) : (
            <Muted>Nothing unresolved.</Muted>
          )}
        </div>

        {review.length === 0 ? (
          <Muted className="mt-3">
            No comments yet. Reviewers can anchor a comment to a specific field, so the author
            knows exactly what to change.
          </Muted>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {review.map((comment) => (
              <li key={comment.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{comment.authorName}</span>
                  {comment.fieldPath && !comment.fieldPath.includes(":") ? (
                    <Badge tone="brand">{comment.fieldPath}</Badge>
                  ) : null}
                  {comment.versionNumber !== null ? (
                    <span className="text-muted">on version {comment.versionNumber}</span>
                  ) : null}
                  {comment.resolvedAt ? <Badge tone="success">resolved</Badge> : null}
                  <span className="ml-auto text-muted">
                    {comment.createdAt.toISOString().slice(0, 10)}
                  </span>
                </div>
                <p className="mt-1">{comment.body}</p>

                {!comment.resolvedAt && !readOnly ? (
                  <ActionForm action={resolveCommentAction} className="mt-2">
                    <input type="hidden" name="agentId" value={agentId} />
                    <input type="hidden" name="stageId" value={stageId} />
                    <input type="hidden" name="commentId" value={comment.id} />
                    <SubmitButton variant="ghost" size="sm" pendingLabel="Resolving…">
                      Mark resolved
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {!readOnly ? (
          <ActionForm action={addCommentAction} className="mt-5 space-y-3">
            <input type="hidden" name="agentId" value={agentId} />
            <input type="hidden" name="stageId" value={stageId} />

            <div>
              <Label htmlFor="comment-field" hint="optional">
                Anchor to a field
              </Label>
              <select
                id="comment-field"
                name="fieldPath"
                className="h-10 w-full rounded border border-border bg-surface px-3 text-body"
              >
                <option value="">The stage as a whole</option>
                {fieldOptions.map((option) => (
                  <option key={option.path} value={option.path}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="comment-body">Comment</Label>
              <Textarea id="comment-body" name="body" rows={3} required />
            </div>

            <SubmitButton pendingLabel="Adding…">Add comment</SubmitButton>
          </ActionForm>
        ) : null}
      </Panel>

      <Panel>
        <SectionTitle>Parking lot</SectionTitle>
        <Muted className="mt-1">
          Worth remembering, not worth blocking on. Nothing here affects whether the stage can be
          submitted.
        </Muted>

        {parkingLot.length === 0 ? (
          <Muted className="mt-3">Empty.</Muted>
        ) : (
          <ul className="mt-3 space-y-2">
            {parkingLot.map((item) => (
              <li key={item.id} className="rounded bg-band px-3 py-2">
                <p>{item.body}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {item.authorName} · {item.createdAt.toISOString().slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
        )}

        {!readOnly ? (
          <ActionForm action={addCommentAction} className="mt-4 space-y-3">
            <input type="hidden" name="agentId" value={agentId} />
            <input type="hidden" name="stageId" value={stageId} />
            <input type="hidden" name="isParkingLot" value="on" />
            <div>
              <Label htmlFor="parking-body">Park a thought</Label>
              <Textarea id="parking-body" name="body" rows={2} required />
            </div>
            <SubmitButton variant="outline" pendingLabel="Parking…">
              Add to parking lot
            </SubmitButton>
          </ActionForm>
        ) : null}
      </Panel>
    </div>
  );
}
