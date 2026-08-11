import { Band } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/status";

export type AuditRow = {
  id: string;
  sequence: number;
  type: string;
  subjectType: string;
  subjectId: string;
  actorKind: string;
  actorUserId: string | null;
  payload: string;
  hash: string;
  createdAt: Date;
};

/**
 * The audit trail, with its chain state on show.
 *
 * Showing the verification result — not just the events — is the difference
 * between "we keep a log" and "here is evidence the log has not been edited".
 */
export function AuditTrail({
  events,
  verification,
  actorNames,
}: {
  events: AuditRow[];
  verification: { ok: boolean; length: number; reason?: string };
  actorNames: Record<string, string>;
}) {
  return (
    <div className="space-y-4">
      <Band>
        {verification.ok ? (
          <>
            <span className="font-medium">
              {verification.length} events, chain verified.
            </span>{" "}
            Each event carries the hash of the one before it, so any edit or deletion after the
            fact would break the chain. This is what the evidence pack signs.
          </>
        ) : (
          <>
            <span className="font-medium text-danger">Chain broken.</span> {verification.reason}
          </>
        )}
      </Band>

      <ul className="divide-y divide-border">
        {events.map((event) => (
          <li key={event.id} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted">#{event.sequence}</span>
              <span className="font-medium">{humanise(event.type)}</span>
              {event.type.startsWith("cascade.") ? <Badge tone="warning">cascade</Badge> : null}
              {event.actorKind === "SYSTEM" ? <Badge tone="neutral">system</Badge> : null}
              <span className="ml-auto text-muted">
                {event.createdAt.toISOString().replace("T", " ").slice(0, 19)}
              </span>
            </div>
            <p className="mt-1 text-muted">
              {event.subjectType} · {event.subjectId}
              {event.actorUserId ? ` · ${actorNames[event.actorUserId] ?? "a member"}` : ""}
            </p>
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted">Payload and hash</summary>
              <pre className="mt-2 overflow-x-auto rounded bg-panel p-3 text-xs">
                {formatPayload(event.payload)}
              </pre>
              <p className="mt-1 break-all font-mono text-xs text-muted">{event.hash}</p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

function humanise(type: string): string {
  const [subject, action] = type.split(".");
  return `${action?.replace(/-/g, " ") ?? type} — ${subject}`;
}

function formatPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}
