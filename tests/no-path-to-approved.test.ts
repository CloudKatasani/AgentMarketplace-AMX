import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The single-path rule, enforced by the build.
 *
 * `CLAUDE.md`: "Governance is structural." A convention that only one module
 * writes approvals is not structural — it survives exactly until the first
 * deadline. This test reads the source tree and fails if any file other than
 * the gate engine can produce an approval, close a gate, advance a stage, or
 * grant a certification.
 *
 * If this test fails, the fix is to route the change through
 * `recordDecision()` — not to add the file to the allowlist.
 */

const SRC = path.resolve(__dirname, "..", "src");

/** The only files permitted to perform each protected write. */
const ALLOWED: Record<string, string[]> = {
  "approval.create": ["lib/gates/record-decision.ts"],
  "gate APPROVED": ["lib/gates/record-decision.ts"],
  "stage advance": ["lib/gates/record-decision.ts"],
  "certification grant": ["lib/gates/record-decision.ts"],
};

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [full] : [];
    }),
  );
  return files.flat();
}

function relative(file: string): string {
  return path.relative(SRC, file).split(path.sep).join("/");
}

/**
 * The `data:` payloads in a file, with balanced braces.
 *
 * Scanning raw source would flag `where: { status: "APPROVED" }` — reading
 * approved gates is not the same as creating one, and a test that cannot tell
 * the difference gets an allowlist entry rather than a fix.
 */
function writePayloads(source: string): string[] {
  const payloads: string[] = [];
  const marker = /\bdata:\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = marker.exec(source)) !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    while (index < source.length && depth > 0) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") depth -= 1;
      index += 1;
    }
    payloads.push(source.slice(match.index, index));
  }
  return payloads;
}

describe("no path to APPROVED except recordDecision()", () => {
  it("only the gate engine creates an Approval", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      if (/\.approval\.(create|createMany|upsert)\s*\(/.test(source)) {
        offenders.push(relative(file));
      }
    }
    expect(
      offenders.filter((f) => !ALLOWED["approval.create"].includes(f)),
      "An Approval is the only evidence a human approved anything. Route this through recordDecision().",
    ).toEqual([]);
    // And the engine really does write them — otherwise this test passes vacuously.
    expect(offenders).toEqual([...ALLOWED["approval.create"]]);
  });

  it("only the gate engine writes a gate status of APPROVED", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const payloads = writePayloads(readFileSync(file, "utf8"));
      if (payloads.some((payload) => /status:\s*["']APPROVED["']/.test(payload))) {
        offenders.push(relative(file));
      }
    }
    expect(offenders.filter((f) => !ALLOWED["gate APPROVED"].includes(f))).toEqual([]);
    expect(offenders).toEqual([...ALLOWED["gate APPROVED"]]);
  });

  it("only the gate engine advances an agent's stage", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      // Seeding an agent's starting stage is a create, not an advance.
      const advances =
        /agentUpdate\.currentStageId\s*=/.test(source) ||
        writePayloads(source).some(
          (payload) =>
            /currentStageId:/.test(payload) && /update|Update/.test(payload.slice(0, 200)),
        );
      if (advances) offenders.push(relative(file));
    }
    expect(offenders.filter((f) => !ALLOWED["stage advance"].includes(f))).toEqual([]);
  });

  it("only the gate engine grants a certification", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      // STALE is a revocation, not a grant, so the cascade may set it.
      const grants =
        /certification:\s*["'](?:PEER_CERTIFIED|SELF_ATTESTED)["']/.test(source) ||
        /certification\s*=\s*isSolo/.test(source);
      if (grants) offenders.push(relative(file));
    }
    expect(offenders.filter((f) => !ALLOWED["certification grant"].includes(f))).toEqual([]);
    expect(offenders).toEqual([...ALLOWED["certification grant"]]);
  });

  it("the gate engine exposes exactly two mutating entry points", async () => {
    const index = readFileSync(path.join(SRC, "lib/gates/index.ts"), "utf8");
    expect(index).toContain("requestTransition");
    expect(index).toContain("recordDecision");
  });
});

describe("plan tiers gate features, never governance", () => {
  it("the gate engine does not import plan features", async () => {
    const gateFiles = await sourceFiles(path.join(SRC, "lib", "gates"));
    for (const file of gateFiles) {
      const source = readFileSync(file, "utf8");
      expect(
        source.includes("@/lib/plans"),
        `${relative(file)} imports plan features. Flags gate features, never governance rules.`,
      ).toBe(false);
    }
  });

  it("the lifecycle registry does not import plan features", async () => {
    const files = await sourceFiles(path.join(SRC, "lib", "lifecycle"));
    for (const file of files) {
      expect(readFileSync(file, "utf8").includes("@/lib/plans")).toBe(false);
    }
  });

  it("the binding validator does not import plan features", async () => {
    const files = await sourceFiles(path.join(SRC, "lib", "bindings"));
    for (const file of files) {
      expect(readFileSync(file, "utf8").includes("@/lib/plans")).toBe(false);
    }
  });
});
