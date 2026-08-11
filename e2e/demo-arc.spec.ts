import { expect, test } from "@playwright/test";

/**
 * The seven-minute demo arc, in a browser.
 *
 * `tests/demo-arc.test.ts` proves the arc holds against the engine. This proves
 * it holds *on screen* — which is what actually happens in a sales call. The two
 * are deliberately separate: one fails when the governance breaks, the other
 * when the pitch breaks.
 *
 * Section names match `DEMO.md` so a failure points at the slide it ruins.
 */

test.describe.configure({ mode: "serial" });

let agentSlug = "customer-churn-advisor";

test("0:30 — landing page to the live demo", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("h1")).toContainText("Every published agent proves");
  await expect(page.getByText("STALE cascade")).toBeVisible();

  await page.getByRole("link", { name: "Explore the live demo" }).click();
  await page.waitForURL("**/marketplace");

  // The showcase is read-only, server-side, and says so.
  await expect(page.getByText("live demo workspace")).toBeVisible();
});

test("1:00 — the persona lens ranks by what that role can actually get answered", async ({
  page,
}) => {
  await enterDemo(page);

  await page.getByRole("link", { name: "Revenue Assurance Analyst" }).click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByText(/Ranked for Revenue Assurance Analyst/)).toBeVisible();
  await expect(page.getByText(/3 of 3 questions answered/)).toBeVisible();
});

test("1:30 — the question trace: question → metric → product", async ({ page }) => {
  await enterDemo(page);
  await page.goto(`/marketplace/${agentSlug}`);

  await expect(page.getByText("Peer-certified").first()).toBeVisible();

  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(3);

  // Every row resolves to a certified metric on a named product.
  await expect(page.getByText("residential_churn_rate").first()).toBeVisible();
  await expect(page.getByText("high_bill_risk").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Customer 360" }).first()).toBeVisible();
});

test("2:30 — the binding graph, and the product-view inversion", async ({ page }) => {
  await enterDemo(page);
  await page.goto(`/marketplace/${agentSlug}`);

  const svg = page.locator("svg[role='img']");
  await expect(svg).toBeVisible();
  await expect(svg).toContainText("Customer 360");
  await expect(svg).toContainText("contract 2.1.0");

  await page.getByRole("link", { name: "Customer 360" }).first().click();
  await page.waitForURL("**/data-products/**");

  await expect(page.getByText("Everything standing on this")).toBeVisible();
  await expect(page.getByRole("link", { name: "Customer Churn Advisor" })).toBeVisible();
});

test("4:00 — the money moment: publish a breaking version, watch it go stale", async ({
  page,
  browser,
}) => {
  // The showcase tenant is read-only by design, so the bump happens in the
  // sandbox twin — the same seed, walked the same way, but writable. That is
  // exactly what happens on stage: the presenter switches workspace.
  const context = await browser.newContext();
  const owner = await context.newPage();

  await owner.goto("/signin");
  await owner.fill("#email", "sam.data@amx.demo");
  await owner.fill("#password", "amx-demo-2024");
  await owner.getByRole("button", { name: "Sign in" }).click();
  await owner.waitForURL("**/agents");

  await owner.locator("header select[name='organizationId']").selectOption({
    label: "Northwind Utility (sandbox)",
  });
  await owner.getByRole("button", { name: "Switch" }).click();
  // The read-only banner disappearing is the signal the switch landed — waiting
  // on the URL would pass instantly, since both workspaces land on /agents.
  await expect(owner.getByText("This is the live demo workspace")).toHaveCount(0);

  await owner.goto("/data-products");
  await owner.getByText("Publish a new contract version").first().click();
  await owner.fill("input[name='contractVersion']", "3.0.0");
  await owner.fill(
    "textarea[name='changeSummary']",
    "Removed the legacy premise identifier from the customer grain.",
  );
  await owner.getByRole("button", { name: "Publish version" }).click();

  const status = owner.locator("[role=status]").first();
  await expect(status).toBeVisible();
  await expect(status).toContainText("Breaking change recorded");
  await expect(status).toContainText("re-certification task");

  // And on the next render: the certification is stale, with a cause.
  await owner.goto(`/marketplace/${agentSlug}`);
  await expect(owner.getByText("Re-certification pending")).toBeVisible();
  await expect(owner.getByText(/moved from contract 2\.1\.0 to 3\.0\.0/)).toBeVisible();

  // And the showcase, one tenant over, is untouched — which is the whole point
  // of the split. A demo that a demo can break is not a demo.
  await enterDemo(page);
  await page.goto(`/marketplace/${agentSlug}`);
  await expect(page.getByText("Re-certification pending")).toHaveCount(0);

  await context.close();
});

test("5:30 — the evidence pack downloads, with a hashed filename", async ({ page }) => {
  await enterDemo(page);
  await page.goto(`/marketplace/${agentSlug}`);

  const download = await Promise.race([
    page.waitForEvent("download", { timeout: 60_000 }),
    page
      .getByRole("link", { name: "Download the evidence pack" })
      .click()
      .then(() => page.waitForEvent("download", { timeout: 60_000 })),
  ]);

  expect(download.suggestedFilename()).toMatch(/^evidence-pack-customer-churn-advisor-[0-9a-f]{8}\.pdf$/);
});

test("7:00 — the academy credential that gates an approver role", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/academy");

  await expect(page.getByRole("link", { name: "Governance Officer" })).toBeVisible();
  await page.getByRole("link", { name: "Governance Officer" }).click();
  await page.waitForURL("**/academy/governance-officer");

  await expect(page.getByText(/unlocks Governance Officer/)).toBeVisible();
  await expect(page.getByText("Lab ·").first()).toBeVisible();
});

/**
 * Each test gets a fresh browser context, so each one enters the demo the way a
 * visitor does — through the landing page's entry point, not a fixture.
 */
async function enterDemo(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  await page.waitForURL("**/marketplace");
}
