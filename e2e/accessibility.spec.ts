import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * WCAG 2.1 AA, on the screens the product is judged by.
 *
 * `CLAUDE.md` sets AA as the contrast bar for the token system; this checks the
 * whole page rather than the palette — labels, roles, heading order, and the
 * contrast of every combination the tokens actually produce. Automated scanning
 * catches perhaps half of what a real audit would, so this is a floor, not a
 * certificate: it is written to fail loudly on the half it does catch.
 *
 * Each screen is scanned as a *person with an account* would meet it, because
 * the interesting markup — forms, tables, status regions — is behind sign-in.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.describe.configure({ mode: "serial" });

test("the demo surfaces a prospect sees are accessible", async ({ page }) => {
  await page.goto("/");
  await scan(page, "landing page");

  await page.goto("/demo");
  await page.waitForURL("**/marketplace");
  await scan(page, "marketplace");

  await page.goto("/marketplace/customer-churn-advisor");
  await scan(page, "agent listing");

  await page.goto("/data-products");
  await scan(page, "data products");

  await page.goto("/academy");
  await scan(page, "academy");

  await page.goto("/audit");
  await scan(page, "audit trail");
});

test("the screens a practitioner works in are accessible", async ({ page }) => {
  await page.goto("/signin");
  await scan(page, "sign in");

  await page.fill("#email", "priya.owner@amx.demo");
  await page.fill("#password", "amx-demo-2024");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/agents");

  await page.locator("header select[name='organizationId']").selectOption({
    label: "Northwind Utility (sandbox)",
  });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("This is the live demo workspace")).toHaveCount(0);

  await scan(page, "agents");

  await page.goto("/admin");
  await scan(page, "workspace settings");

  const agent = await page
    .goto("/agents")
    .then(() => page.getByRole("link", { name: "Customer Churn Advisor" }).first().click())
    .then(() => page.waitForURL(/\/agents\/[^/]+$/))
    .then(() => page.url().split("/agents/")[1]);

  await scan(page, "agent detail");

  // The two heaviest authoring screens: the coverage matrix and the scorecard.
  await page.goto(`/agents/${agent}/stages/3-data-product-binding`);
  await scan(page, "stage 3 — bindings and coverage");

  await page.goto(`/agents/${agent}/stages/7-certification`);
  await scan(page, "stage 7 — certification");
});

test("onboarding is accessible, since it is the first thing anyone meets", async ({ page }) => {
  await page.goto("/onboarding");
  await scan(page, "onboarding — industry");

  await page.check('input[value="utilities"]');
  await page.fill("#organizationName", "Accessible Co");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL("**/onboarding/account**");
  await scan(page, "onboarding — account");
});

/** Scans the page and reports every violation with the element that caused it. */
async function scan(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

  const report = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 3).map((node) => node.html.slice(0, 400)),
  }));

  expect(report, `${label} has accessibility violations`).toEqual([]);
}
