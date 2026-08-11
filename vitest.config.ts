import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // One SQLite file, one process: the tenancy tests deliberately share a
    // database so that isolation is proven against real cross-tenant rows.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    env: {
      DATABASE_URL: "file:./test.db",
      ANALYTICS_DRIVER: "noop",
      ANALYTICS_SALT: "test-salt",
      AUTH_SECRET: "test-secret",
      AMX_PROJECT_DIR: path.resolve(__dirname, ".test-workspace"),
    },
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
