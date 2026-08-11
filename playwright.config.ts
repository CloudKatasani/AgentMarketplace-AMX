import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a real build.
 *
 * These run on their own SQLite file, seeded from scratch by `e2e/global-setup`,
 * so a browser walk can never disturb a developer's working database — and so
 * the showcase tenant under test is exactly the one `pnpm seed` produces.
 */
const DATABASE_URL = "file:./e2e.db";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3210",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
        },
      },
    },
  ],
  webServer: {
    command: "pnpm start -p 3210",
    url: "http://127.0.0.1:3210/signin",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL,
      AUTH_SECRET: "e2e-secret",
      AUTH_URL: "http://127.0.0.1:3210",
      ANALYTICS_DRIVER: "noop",
      ANALYTICS_SALT: "e2e-salt",
      AMX_PROJECT_DIR: path.resolve(__dirname, ".e2e-workspace"),
    },
  },
});
