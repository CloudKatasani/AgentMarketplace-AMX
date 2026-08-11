import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import type { CertificationStatus } from "@/lib/enums";

/**
 * The state treatments, defined once.
 *
 * STALE always names its cause and offers the re-approval path; AI_DRAFT always
 * gets the dashed violet treatment. Defining them as components rather than as
 * a convention is what keeps them consistent across every screen.
 */

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "brand" | "success" | "warning" | "danger" | "ai-draft";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "bg-band text-brand-ink",
    brand: "bg-brand-accent/15 text-brand-deep",
    success: "bg-success/10 text-success",
    warning: "bg-warning-tint text-warning",
    danger: "bg-danger/10 text-danger",
    "ai-draft": "border border-dashed border-ai-draft bg-ai-draft/5 text-ai-draft",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The badge that has to distinguish self-attested from peer-certified. */
export function CertificationBadge({ status }: { status: CertificationStatus }) {
  switch (status) {
    case "PEER_CERTIFIED":
      return <Badge tone="success">Peer-certified</Badge>;
    case "SELF_ATTESTED":
      return <Badge tone="brand">Self-attested</Badge>;
    case "STALE":
      return <Badge tone="warning">Certification stale</Badge>;
    default:
      return <Badge tone="neutral">Not certified</Badge>;
  }
}

/**
 * The STALE treatment: warning tint, the cause in plain language, and the way
 * back. A stale state that does not say why is just a broken screen.
 */
export function StaleBanner({
  title,
  cause,
  action,
}: {
  title: string;
  cause: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border-l-4 border-warning bg-warning-tint px-4 py-3">
      <p className="font-medium text-warning">{title}</p>
      <p className="mt-1 text-brand-ink">{cause}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function InfoBanner({ children }: { children: ReactNode }) {
  return <div className="rounded-lg bg-band px-4 py-3 text-brand-ink">{children}</div>;
}

export function AiDraftMarker() {
  return <Badge tone="ai-draft">AI draft — needs a human</Badge>;
}
