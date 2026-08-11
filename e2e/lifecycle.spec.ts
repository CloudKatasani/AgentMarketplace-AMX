import { expect, test } from "@playwright/test";

import { claimWorkspace, openWorkspace, signIn } from "./helpers";

/**
 * The parts of the lifecycle a person actually touches.
 *
 * The full eight-stage walk is asserted against the engine in
 * `tests/demo-arc.test.ts`, which is the right place for it — driving 24
 * approvals through a browser would test Playwright, not the product. What
 * belongs here is everything a human does with their hands: onboarding, the
 * validator rejection, the changes-requested round, and the isolation probes.
 */

test.describe.configure({ mode: "serial" });

const PASSWORD = "correct-horse-battery";
const stamp = Date.now();
const email = `founder${stamp}@example.test`;
let agentId = "";

test("onboarding lands in a working workspace well inside the ten-minute budget", async ({
  page,
}) => {
  const started = Date.now();

  await page.goto("/onboarding");
  await expect(page.locator("h1")).toContainText("Pick an industry");

  // One screen, no account: the industry choice is the sign-up.
  await openWorkspace(page, { name: `Northwind ${stamp}` });
  const elapsedSeconds = (Date.now() - started) / 1000;

  // The budget is ten minutes. Anything near it means the flow has grown a step.
  expect(elapsedSeconds).toBeLessThan(600);

  // Never an empty screen: a starter agent, mid-lifecycle.
  await expect(page.getByRole("link", { name: "Customer Churn Advisor" })).toBeVisible();

  const tour = page.locator("aside");
  await expect(tour).toContainText("Your workspace is not empty");

  // Guests are told what they have and what claiming it buys them.
  await expect(page.getByText("Claim this workspace")).toBeVisible();

  // Claimed here so the later tests can sign back in — the same thing a person
  // does when they decide to keep the workspace.
  await claimWorkspace(page, { name: "Dana Founder", email, password: PASSWORD });
});

test("the guided tour ends on the coverage matrix", async ({ page }) => {
  await signIn(page, email, PASSWORD);
  await page.goto("/agents");

  const link = page.getByRole("link", { name: "Customer Churn Advisor" });
  await link.click();
  await page.waitForURL(/\/agents\/[^/]+$/);
  agentId = page.url().split("/agents/")[1];

  await page.goto(`/agents?tour=1&agent=${agentId}`);
  const tour = page.locator("aside");

  for (let step = 1; step <= 4; step += 1) {
    await tour.locator("a").first().click();
    await page.waitForURL(`**tour=${step + 1}**`);
  }

  await expect(page).toHaveURL(/stages\/3-data-product-binding/);
  await expect(tour).toContainText("This is the part nothing else does");
  await expect(page.getByText(/All 3 questions are covered/)).toBeVisible();
});

test("the validator refuses a bad binding in words a business user can act on", async ({
  page,
}) => {
  await signIn(page, email, PASSWORD);
  await page.goto(`/agents/${agentId}/stages/3-data-product-binding`);

  const form = page.locator('form:has(button:has-text("Validate and commit"))').first();
  await form.locator("#type").selectOption("QUERIES");
  await form
    .locator("#purpose")
    .fill("Reads churn numbers for the retention list without naming a metric.");
  await form.getByRole("button", { name: "Validate and commit" }).click();

  const status = form.locator("[role=status]");
  await expect(status).toBeVisible();
  await expect(status).toContainText("doesn't name a certified metric");
  // A rejection has to say what to do instead.
  await expect(status).toContainText("residential_churn_rate");
});

test("a stage can be submitted solo and approved with a recorded attestation", async ({
  page,
}) => {
  await signIn(page, email, PASSWORD);
  await page.goto(`/agents/${agentId}/stages/1-consumption-discovery`);

  const submitForm = page.locator('form:has(button:has-text("Submit stage 1 for review"))');
  await submitForm.locator('input[name="soloAttestation"]').check();
  await submitForm.getByRole("button", { name: "Submit stage 1 for review" }).click();

  await page.getByRole("link", { name: "Go to the gate" }).click();
  await page.waitForURL(/\/gates\//);

  await page.fill(
    "#attestationStatement",
    "I have reviewed this persona and question register against the decisions this team owns, and I accept it.",
  );
  await page.getByRole("button", { name: "Record decision" }).click();

  await expect(page.getByText("self-attested").first()).toBeVisible();
  await expect(page.getByText("approved").first()).toBeVisible();
});

test("a changes-requested round unlocks the stage and opens a second gate", async ({ page }) => {
  await signIn(page, email, PASSWORD);

  // Stage 2 solo-submit, then request changes on it.
  await page.goto(`/agents/${agentId}/stages/2-agent-charter`);
  const submitForm = page.locator('form:has(button:has-text("Submit stage 2 for review"))');
  await submitForm.locator('input[name="soloAttestation"]').check();
  await submitForm.getByRole("button", { name: "Submit stage 2 for review" }).click();

  await page.getByRole("link", { name: "Go to the gate" }).click();
  await page.waitForURL(/\/gates\//);

  await page.locator("#decision").selectOption("REQUEST_CHANGES");
  await page.fill("#comment", "Name the customer-contact exclusion explicitly.");
  await page.getByRole("button", { name: "Record decision" }).click();

  await expect(page.getByText("changes requested").first()).toBeVisible();

  // The stage is editable again, and says so rather than staying locked.
  await page.goto(`/agents/${agentId}/stages/2-agent-charter`);
  await expect(page.getByRole("button", { name: /Commit a new version/ })).toBeEnabled();
});

test("one organisation cannot reach another's agent", async ({ page }) => {
  await signIn(page, email, PASSWORD);

  // The showcase agent belongs to a different tenant entirely.
  const response = await page.goto("/agents/cmshowcase-not-mine");
  expect(response?.status()).toBe(404);

  // And the demo viewer cannot mutate anything, even by finding the form.
  //
  // Entering the demo means arriving as a visitor: /demo deliberately refuses to
  // touch a session that already exists, so signing out first is the only way
  // in — which is exactly what a real visitor does by never having signed in.
  await page.context().clearCookies();
  await page.goto("/demo");
  await page.waitForURL("**/marketplace");
  await page.goto("/data-products");
  await expect(page.getByText("Publish a new contract version")).toHaveCount(0);
});

