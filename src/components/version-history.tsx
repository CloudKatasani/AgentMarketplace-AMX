import Link from "next/link";

import { Band, Muted, Panel, SectionTitle } from "@/components/ui/primitives";
import { AiDraftMarker, Badge } from "@/components/ui/status";
import type { ArtifactDiff } from "@/lib/artifacts/diff";

export type VersionRow = {
  id: string;
  kind: string;
  versionNumber: number;
  contentHash: string;
  isAiDraft: boolean;
  authorName: string;
  createdAt: Date;
  isCurrent: boolean;
};

/**
 * Version history and the diff between two of them.
 *
 * A reviewer re-approving after a change should see the change, not the whole
 * document again — and the content hash is shown because that is the identity
 * the gate approved and the evidence pack cites.
 */
export function VersionHistory({
  versions,
  diff,
  compare,
  basePath,
}: {
  versions: VersionRow[];
  diff: ArtifactDiff | null;
  compare: { fromVersion: number; toVersion: number; kind: string } | null;
  basePath: string;
}) {
  if (versions.length === 0) {
    return (
      <Panel>
        <SectionTitle>Version history</SectionTitle>
        <Muted className="mt-2">Nothing committed yet.</Muted>
      </Panel>
    );
  }

  const byKind = new Map<string, VersionRow[]>();
  for (const version of versions) {
    byKind.set(version.kind, [...(byKind.get(version.kind) ?? []), version]);
  }

  return (
    <Panel className="space-y-5">
      <div>
        <SectionTitle>Version history</SectionTitle>
        <Muted className="mt-1">
          Every version is immutable and content-hashed. Approvals attach to a specific one.
        </Muted>
      </div>

      {[...byKind.entries()].map(([kind, rows]) => (
        <div key={kind}>
          <p className="font-medium">{kind.replace(/-/g, " ")}</p>
          <ul className="mt-2 divide-y divide-border">
            {rows.map((version, index) => {
              const previous = rows[index + 1];
              return (
                <li key={version.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="font-medium">v{version.versionNumber}</span>
                  {version.isCurrent ? <Badge tone="brand">current</Badge> : null}
                  {version.isAiDraft ? <AiDraftMarker /> : null}
                  <span className="text-muted">{version.authorName}</span>
                  <span className="text-muted">
                    {version.createdAt.toISOString().slice(0, 10)}
                  </span>
                  <code className="text-xs text-muted">{version.contentHash.slice(0, 12)}</code>
                  {previous ? (
                    <Link
                      href={`${basePath}?diff=${kind}&from=${previous.versionNumber}&to=${version.versionNumber}`}
                      className="ml-auto"
                    >
                      What changed?
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {diff && compare ? (
        <div>
          <Band>
            {compare.kind.replace(/-/g, " ")} · v{compare.fromVersion} → v{compare.toVersion} ·{" "}
            {diff.identical
              ? "no textual change"
              : `${diff.added} line${diff.added === 1 ? "" : "s"} added, ${diff.removed} removed`}
          </Band>
          <pre className="mt-3 overflow-x-auto rounded border border-border bg-surface p-3 text-xs leading-5">
            {diff.lines.map((line, index) => (
              <span
                key={index}
                className={
                  line.kind === "added"
                    ? "block bg-success/10 text-success"
                    : line.kind === "removed"
                      ? "block bg-danger/5 text-danger"
                      : "block text-muted"
                }
              >
                {line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  "}
                {line.text}
              </span>
            ))}
          </pre>
        </div>
      ) : null}
    </Panel>
  );
}
