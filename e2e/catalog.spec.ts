import { expect, test } from "@playwright/test";

import { openWorkspace } from "./helpers";

/**
 * What a stranger can see and do without an account.
 *
 * Two claims are under test, and both are about the absence of a wall: the
 * whole industry catalogue reads without signing in, and a workspace opens in
 * one click without an email address.
 */

test("the agent catalog reads without an account, industry by industry", async ({ page }) => {
  await page.goto("/catalog");
  await expect(page.locator("h1")).toContainText("day one");

  // Every shipped pack is listed, and the generic one sorts last.
  const industries = page.getByRole("link", { name: "Browse the agents" });
  expect(await industries.count()).toBeGreaterThanOrEqual(9);

  await page.goto("/catalog/utilities");
  await expect(page.locator("h1")).toContainText("Utilities");

  // Consumption first: the questions, and the certified metric answering each.
  await expect(page.getByText("Customer Churn Advisor").first()).toBeVisible();
  await expect(page.getByText("residential_churn_rate").first()).toBeVisible();
  await expect(page.getByText("Customer 360").first()).toBeVisible();

  // The layer rule is visible too — a pack may not ship a raw-served product.
  await expect(page.getByText("GOLD").first()).toBeVisible();

  // And the pack says out loud that it is a starting point.
  await expect(page.getByText(/illustrative/i).first()).toBeVisible();

  // No sign-in happened anywhere in this test.
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

  // A different industry is genuinely different content.
  await page.goto("/catalog/banking");
  await expect(page.locator("h1")).toContainText("Banking");
  await expect(page.getByText("residential_churn_rate")).toHaveCount(0);
});

test("an unknown industry is a 404, not a guess", async ({ page }) => {
  const response = await page.goto("/catalog/not-an-industry");
  expect(response?.status()).toBe(404);
});

test("a workspace opens in one click, with no email asked for", async ({ page }) => {
  const started = Date.now();

  await page.goto("/catalog/insurance");
  await page.getByRole("link", { name: "Open a workspace with this pack" }).click();
  await page.waitForURL("**/onboarding**");

  // The industry came through the link, so the choice is already made.
  await expect(page.locator('input[value="insurance"]')).toBeChecked();

  // Nothing on this screen asks who you are.
  await expect(page.locator("#email")).toHaveCount(0);
  await expect(page.locator("#password")).toHaveCount(0);

  await page.fill("#organizationName", `One Click ${Date.now()}`);
  await page.getByRole("button", { name: "Open my workspace" }).click();
  await page.waitForURL("**/agents?tour=1**", { timeout: 60_000 });

  expect((Date.now() - started) / 1000).toBeLessThan(120);

  // A real, seeded, editable workspace — and it says what being a guest means.
  await expect(page.getByText("Guest").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Claim this workspace" })).toBeVisible();
  await expect(page.locator("aside")).toContainText("Your workspace is not empty");
});

test("the demo entry never takes over a session someone already has", async ({ page }) => {
  // /demo establishes a session, and Next prefetches links — so a page that
  // merely rendered a link to it used to sign the reader in, and could swap a
  // signed-in customer into the demo tenant without a click. It now refuses to
  // touch an existing session, and the links carry prefetch={false}.
  const name = `Mine ${Date.now()}`;
  await openWorkspace(page, { name });

  await page.goto("/demo");
  await page.waitForURL("**/marketplace");

  await expect(page.locator("header")).toContainText(name);
  await expect(page.getByText("This is the live demo workspace")).toHaveCount(0);
});
