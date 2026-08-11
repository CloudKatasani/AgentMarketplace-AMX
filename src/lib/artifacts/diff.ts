/**
 * Diffing two artifact versions.
 *
 * A reviewer asked to re-approve after a change deserves to see the change,
 * not the whole document again. The diff runs over the YAML rendering rather
 * than the canonical JSON, because that is what the reviewer reads in the
 * workspace mirror and in the evidence pack.
 */
import { stringify as toYaml } from "yaml";

export type DiffLine = {
  kind: "added" | "removed" | "context";
  text: string;
};

export type ArtifactDiff = {
  lines: DiffLine[];
  added: number;
  removed: number;
  identical: boolean;
};

function render(content: unknown): string[] {
  return toYaml(content, { sortMapEntries: true }).split("\n");
}

/**
 * Longest-common-subsequence diff, with unchanged runs collapsed to a few
 * lines of context on each side.
 */
export function diffArtifacts(
  before: unknown,
  after: unknown,
  contextLines = 2,
): ArtifactDiff {
  const left = render(before);
  const right = render(after);

  const lcs = longestCommonSubsequence(left, right);
  const raw: DiffLine[] = [];

  let i = 0;
  let j = 0;
  for (const [li, ri] of lcs) {
    while (i < li) raw.push({ kind: "removed", text: left[i++] });
    while (j < ri) raw.push({ kind: "added", text: right[j++] });
    raw.push({ kind: "context", text: left[i] });
    i += 1;
    j += 1;
  }
  while (i < left.length) raw.push({ kind: "removed", text: left[i++] });
  while (j < right.length) raw.push({ kind: "added", text: right[j++] });

  const added = raw.filter((line) => line.kind === "added").length;
  const removed = raw.filter((line) => line.kind === "removed").length;

  return {
    lines: collapseContext(raw, contextLines),
    added,
    removed,
    identical: added === 0 && removed === 0,
  };
}

/** Indices of matching lines, as [leftIndex, rightIndex] pairs. */
function longestCommonSubsequence(left: string[], right: string[]): [number, number][] {
  const table: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        left[i] === right[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

function collapseContext(lines: DiffLine[], contextLines: number): DiffLine[] {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind === "context") return;
    for (let offset = -contextLines; offset <= contextLines; offset += 1) {
      const target = index + offset;
      if (target >= 0 && target < lines.length) keep.add(target);
    }
  });

  const out: DiffLine[] = [];
  let skipping = false;
  lines.forEach((line, index) => {
    if (keep.has(index)) {
      out.push(line);
      skipping = false;
    } else if (!skipping) {
      out.push({ kind: "context", text: "…" });
      skipping = true;
    }
  });
  return out;
}
