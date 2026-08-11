import { expect, test } from "@playwright/test";

/**
 * One academy path, all the way to the credential.
 *
 * The credential can gate who may approve an agent, so "can a person actually
 * finish a path in a browser" is a governance question, not a nice-to-have.
 */
test("a learner can complete a path and be awarded its credential", async ({ page }) => {
  await page.goto("/signin");
  await page.fill("#email", "dana.consumer@amx.demo");
  await page.fill("#password", "amx-demo-2024");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/agents");

  await page.goto("/academy");
  await expect(page.getByRole("link", { name: "Business Consumer" })).toBeVisible();

  await page.getByRole("link", { name: "Business Consumer" }).click();
  await page.waitForURL("**/academy/business-consumer");

  // Starting the path replaces the button rather than posting a message: the
  // state change is the feedback.
  await page.getByRole("button", { name: "Start this path" }).click();
  await expect(page.getByRole("button", { name: "Start this path" })).toHaveCount(0);

  // The assessment form is addressed by its module field, not its button label:
  // the label changes to "Re-take the assessment" once the module is complete.
  const form = page.locator('form:has(input[name="moduleKey"])').first();

  // Answer wrongly first: a near-miss must not pass, because the credential can
  // gate an approver role.
  await form.locator('input[type="radio"]').first().check();
  await form.getByRole("button", { name: "Complete this module" }).click();
  await expect(form.locator("[role=status]")).toContainText("Every answer has to be right");

  // Then correctly. The Business Consumer path has one module with one question.
  await form.locator('input[type="radio"]').nth(1).check();
  await form.getByRole("button", { name: "Complete this module" }).click();

  await expect(form.locator("[role=status]")).toContainText("finishes the path");
  await expect(form.locator("[role=status]")).toContainText("audit trail");

  await page.goto("/academy");
  await expect(page.getByText("credential held")).toBeVisible();
});
