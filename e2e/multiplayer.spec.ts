import { expect, test, type Page } from "@playwright/test";

/**
 * The second human.
 *
 * Everything else in the suite proves one person can drive AMX alone. This
 * proves the thing the product is actually sold on: a *different* person, in
 * the same workspace, holding a role they were granted, signing a gate the
 * author submitted. Until Phase 6 there was no way to add anyone to a
 * workspace at all, so this path did not exist.
 */

test.describe.configure({ mode: "serial" });
test.describe("two people, one workspace", () => {
  const PASSWORD = "correct-horse-battery";
  const stamp = Date.now();
  const founder = `founder${stamp}@example.test`;
  const colleague = `colleague${stamp}@example.test`;
  let agentId = "";
  let invitePath = "";

  test("an admin invites a colleague and gets a link to send", async ({ page }) => {
    await onboard(page, founder, PASSWORD, stamp);

    await page.goto("/admin");
    await expect(page.locator("h1")).toContainText("Workspace settings");

    const invite = page.locator('form:has(button:has-text("Send invitation"))');
    await invite.locator("#email").fill(colleague);
    await invite.locator("#roleKey").selectOption("agent-product-owner");
    await invite.getByRole("button", { name: "Send invitation" }).click();

    // Email delivery is stubbed, so the link has to be visible to the admin —
    // otherwise a deployment without mail configured cannot invite anyone.
    const status = invite.locator("[role=status]");
    await expect(status).toContainText("Invitation created");
    const message = (await status.textContent()) ?? "";
    const match = message.match(/\/invite\/[0-9a-f]{64}/);
    expect(match).not.toBeNull();
    invitePath = match![0];

    await expect(page.getByText(colleague).first()).toBeVisible();
  });

  test("the colleague accepts, creates an account, and lands in the workspace", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const joiner = await context.newPage();

    await joiner.goto(invitePath);
    await expect(joiner.locator("h1")).toContainText("Join");
    await expect(joiner.getByText("Agent Product Owner")).toBeVisible();

    await joiner.fill("#name", "Casey Colleague");
    await joiner.fill("#password", PASSWORD);
    await joiner.getByRole("button", { name: "Accept the invitation" }).click();
    await joiner.waitForURL("**/agents", { timeout: 60_000 });

    // Same workspace, same seeded agent — not a new tenant.
    await expect(joiner.getByRole("link", { name: "Customer Churn Advisor" })).toBeVisible();

    // A non-admin has no settings screen, and the route refuses them.
    await expect(joiner.getByRole("link", { name: "Settings" })).toHaveCount(0);
    const response = await joiner.goto("/admin");
    expect(response?.status()).toBe(404);

    await context.close();
  });

  test("the colleague signs a gate the founder submitted — a real peer review", async ({
    page,
    browser,
  }) => {
    await signIn(page, founder, PASSWORD);
    await page.goto("/agents");
    await page.getByRole("link", { name: "Customer Churn Advisor" }).click();
    await page.waitForURL(/\/agents\/[^/]+$/);
    agentId = page.url().split("/agents/")[1];

    // Submitted for *peer* review: the solo attestation box is left unticked.
    await page.goto(`/agents/${agentId}/stages/1-consumption-discovery`);
    const submit = page.locator('form:has(button:has-text("Submit stage 1 for review"))');
    await submit.getByRole("button", { name: "Submit stage 1 for review" }).click();
    await expect(page.getByRole("link", { name: "Go to the gate" })).toBeVisible();

    const context = await browser.newContext();
    const reviewer = await context.newPage();
    await signIn(reviewer, colleague, PASSWORD);

    await reviewer.goto(`/agents/${agentId}/stages/1-consumption-discovery`);
    await reviewer.getByRole("link", { name: "Go to the gate" }).click();
    await reviewer.waitForURL(/\/gates\//);

    await reviewer.fill(
      "#comment",
      "The personas match the decisions this team owns, and every question has a consequence I recognise.",
    );
    await reviewer.getByRole("button", { name: "Record decision" }).click();

    await expect(reviewer.getByText("approved").first()).toBeVisible();
    // The distinction the whole product rests on.
    await expect(reviewer.getByText("self-attested")).toHaveCount(0);
    await expect(reviewer.getByText("Casey Colleague").first()).toBeVisible();

    await context.close();
  });
});

async function onboard(page: Page, email: string, password: string, stamp: number) {
  await page.goto("/onboarding");
  await page.check('input[value="utilities"]');
  await page.fill("#organizationName", `Two Player ${stamp}`);
  await page.fill("#workspaceName", "Retail & Revenue");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.waitForURL("**/onboarding/account**");
  await page.fill("#name", "Dana Founder");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL("**/agents?tour=1**", { timeout: 60_000 });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/signin");
  if (page.url().includes("/signin")) {
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/agents");
  }
}
