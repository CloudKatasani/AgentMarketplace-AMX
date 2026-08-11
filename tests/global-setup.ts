import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { STAGES } from "../src/lib/lifecycle/stages";
import { loadAllPacks } from "../src/lib/packs/load";
import { ROLES } from "../src/lib/roles";

/**
 * A real database, reset once per run.
 *
 * The isolation tests are only meaningful against a database that actually
 * holds more than one tenant's rows, so these tests do not mock Prisma.
 */
export default async function setup() {
  const env = { ...process.env, DATABASE_URL: "file:./test.db" };
  rmSync(path.resolve(__dirname, "..", ".test-workspace"), { recursive: true, force: true });

  // Delete the file and push into a fresh one, rather than `db push
  // --force-reset`: same outcome, without running a destructive CLI command.
  const prismaDir = path.resolve(__dirname, "..", "prisma");
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(path.join(prismaDir, `test.db${suffix}`), { force: true });
  }

  execSync("pnpm prisma db push --skip-generate", { env, stdio: "pipe" });

  // Relative SQLite URLs resolve against the schema directory, so this is the
  // same prisma/test.db the workers will open.
  process.env.DATABASE_URL = "file:./test.db";
  const db = new PrismaClient();
  try {
    for (const role of ROLES) {
      await db.role.create({
        data: {
          id: role.id,
          name: role.name,
          description: role.description,
          isApprover: role.isApprover,
          isVeto: role.isVeto,
          requiresCredentialKey: role.requiresCredentialKey,
          ordinal: role.ordinal,
        },
      });
    }
    for (const stage of STAGES) {
      await db.stage.create({
        data: {
          id: stage.key,
          ordinal: stage.ordinal,
          name: stage.name,
          purpose: stage.purpose,
        },
      });
    }

    // Industries and domains come from the packs, exactly as in production —
    // so a pack that would break seeding breaks the tests too.
    for (const pack of loadAllPacks().loaded) {
      await db.industry.create({
        data: {
          id: pack.key,
          name: pack.name,
          packVersion: pack.version,
          summary: pack.summary,
        },
      });
      for (const domain of pack.domains) {
        await db.domain.create({
          data: {
            id: `${pack.key}:${domain.key}`,
            industryId: pack.key,
            key: domain.key,
            name: domain.name,
          },
        });
      }
    }
  } finally {
    await db.$disconnect();
  }
}
