"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "@/components/ui/button";
import type { ActionState } from "@/app/(app)/agents/[id]/actions";

type Action = (previous: ActionState | undefined, formData: FormData) => Promise<ActionState>;

/**
 * A form that shows what the server said.
 *
 * Validator rejections and unmet exit criteria are the product's voice, so they
 * render in place with the same weight as a success — never as a toast that
 * disappears before it has been read.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);

  return (
    <form action={formAction} className={className}>
      {children}
      {state ? (
        <p
          className={
            state.ok
              ? "mt-3 rounded border-l-4 border-success bg-success/5 px-3 py-2 text-success"
              : "mt-3 rounded border-l-4 border-warning bg-warning-tint px-3 py-2 text-warning"
          }
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function SubmitButton({
  children,
  pendingLabel = "Working…",
  ...props
}: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
