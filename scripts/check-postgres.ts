/**
 * Does this schema still target Postgres?
 *
 * `docs/adr/0012-*` commits AMX to SQLite in development and Postgres in
 * production from one `schema.prisma`. That claim decays silently: a
 * SQLite-only feature added on a Tuesday breaks nothing locally and breaks the
 * production target completely.
 *
 * So this renders the datamodel against a Postgres provider and fails if
 * Prisma cannot, printing the DDL summary when it can. It needs no running
 * database, which is the point — it is cheap enough to keep in CI.
 *
 * What it does NOT prove, and the honesty matters: that the application behaves
 * identically on Postgres. Nothing here exercises concurrency, isolation levels
 * or driver differences. Only a real Postgres run does that, and until one has
 * happened `docs/phase-*-design.md` says so under "not verified".
 *
 *   pnpm check:postgres
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "prisma", "schema.prisma");

function main(): void {
  const original = readFileSync(SOURCE, "utf8");

  if (!/provider\s*=\s*"sqlite"/.test(original)) {
    console.info("Schema is not on the SQLite provider; nothing to compare.");
    return;
  }

  const workspace = mkdtempSync(path.join(tmpdir(), "amx-pg-"));
  const target = path.join(workspace, "schema.prisma");

  // Only the datasource block changes. If the rest of the schema needs editing
  // to target Postgres, that is exactly the drift this script exists to catch.
  writeFileSync(
    target,
    original
      .replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"')
      .replace(/url\s*=\s*env\("DATABASE_URL"\)/, 'url = env("POSTGRES_URL")'),
  );

  try {
    execFileSync("pnpm", ["prisma", "validate", "--schema", target], {
      cwd: ROOT,
      stdio: "pipe",
      env: { ...process.env, POSTGRES_URL: "postgresql://amx:amx@localhost:5432/amx" },
    });

    const sql = execFileSync(
      "pnpm",
      [
        "prisma",
        "migrate",
        "diff",
        "--from-empty",
        "--to-schema-datamodel",
        target,
        "--script",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, POSTGRES_URL: "postgresql://amx:amx@localhost:5432/amx" },
      },
    );

    const tables = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]);
    const indexes = [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX/g)].length;

    console.info(
      `Schema renders on PostgreSQL: ${tables.length} tables, ${indexes} indexes, ` +
        `${sql.split("\n").length} lines of DDL.`,
    );
    console.info(
      "Not proven here: runtime behaviour on Postgres — concurrency, isolation, driver quirks.",
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("Schema does NOT render on PostgreSQL:\n" + detail);
    process.exitCode = 1;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

main();
