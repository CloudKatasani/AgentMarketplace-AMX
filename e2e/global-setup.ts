import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

/**
 * A fresh database, seeded by the product's own seed script.
 *
 * Deliberately not a fixture: the showcase tenant these tests walk is the same
 * one `pnpm seed` produces for a customer, so a change that breaks the demo
 * breaks this too.
 */
export default async function globalSetup() {
  const root = path.resolve(__dirname, "..");
  const env = { ...process.env, DATABASE_URL: "file:./e2e.db" };

  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(path.join(root, "prisma", `e2e.db${suffix}`), { force: true });
  }
  rmSync(path.join(root, ".e2e-workspace"), { recursive: true, force: true });

  execSync("pnpm prisma migrate deploy", { cwd: root, env, stdio: "pipe" });
  execSync("pnpm seed", { cwd: root, env, stdio: "pipe" });
}
