/**
 * Loading packs from disk.
 *
 * Packs are YAML on the filesystem rather than rows in the database, because
 * they are *product content*: versioned with the code, reviewable in a diff,
 * and identical for every tenant until someone edits their copy of the seeded
 * result. A pack is read, validated, and turned into workspace rows once — at
 * onboarding — and then the rows are the truth.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import { packSchema, validatePackReferences, type Pack, type PackIssue } from "./schema";

const PACKS_DIR = process.env.AMX_PACKS_DIR ?? path.join(process.cwd(), "packs");

export type PackLoadResult =
  | { ok: true; pack: Pack }
  | { ok: false; key: string; issues: PackIssue[] };

export function packKeys(): string[] {
  if (!existsSync(PACKS_DIR)) return [];
  return readdirSync(PACKS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(PACKS_DIR, name, "pack.yaml")))
    .sort();
}

export function loadPack(key: string): PackLoadResult {
  const file = path.join(PACKS_DIR, key, "pack.yaml");
  if (!existsSync(file)) {
    return { ok: false, key, issues: [{ path: "/", message: `No pack.yaml at ${file}.` }] };
  }

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(file, "utf8"));
  } catch (error) {
    return {
      ok: false,
      key,
      issues: [{ path: "/", message: `Could not parse the YAML: ${(error as Error).message}` }],
    };
  }

  const parsed = packSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      key,
      issues: parsed.error.issues.map((issue) => ({
        path: `/${issue.path.join("/")}`,
        message: issue.message,
      })),
    };
  }

  // Structural validity is not enough: a pack that parses but references a
  // persona that does not exist would seed a broken workspace.
  const referenceIssues = validatePackReferences(parsed.data);
  if (referenceIssues.length > 0) return { ok: false, key, issues: referenceIssues };

  if (parsed.data.key !== key) {
    return {
      ok: false,
      key,
      issues: [
        {
          path: "/key",
          message: `The pack declares key "${parsed.data.key}" but lives in the "${key}" directory.`,
        },
      ],
    };
  }

  return { ok: true, pack: parsed.data };
}

export function loadAllPacks(): { loaded: Pack[]; failed: PackLoadResult[] } {
  const loaded: Pack[] = [];
  const failed: PackLoadResult[] = [];

  for (const key of packKeys()) {
    const result = loadPack(key);
    if (result.ok) loaded.push(result.pack);
    else failed.push(result);
  }

  return { loaded, failed };
}
