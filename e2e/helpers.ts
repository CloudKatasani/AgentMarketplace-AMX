import { expect, type Page } from "@playwright/test";

/**
 * Getting into a workspace, the way a person now does.
 *
 * Onboarding is one screen and asks for no account: the industry choice mints a
 * guest identity server-side and lands on a seeded agent. Tests that need to
 * sign back in later claim the workspace afterwards, which is exactly the path
 * a real user takes when they decide to keep it.
 */
export async function openWorkspace(
  page: Page,
  options: { industry?: string; name: string },
): Promise<void> {
  await page.goto("/onboarding");
  await page.check(`input[value="${options.industry ?? "utilities"}"]`);
  await page.fill("#organizationName", options.name);
  await page.getByRole("button", { name: "Open my workspace" }).click();
  await page.waitForURL("**/agents?tour=1**", { timeout: 60_000 });
}

/** Turns the guest identity into a real one, on the same user id. */
export async function claimWorkspace(
  page: Page,
  credentials: { name: string; email: string; password: string },
): Promise<void> {
  await page.goto("/admin");
  const form = page.locator('form:has(button:has-text("Claim it"))');
  await form.locator("#claimName").fill(credentials.name);
  await form.locator("#claimEmail").fill(credentials.email);
  await form.locator("#claimPassword").fill(credentials.password);
  await form.getByRole("button", { name: "Claim it" }).click();

  // The panel is for guests only, so it disappearing is the claim landing —
  // and the header stops saying "Guest" on the same render.
  await expect(page.getByRole("button", { name: "Claim it" })).toHaveCount(0);
  await expect(page.locator("header")).toContainText(credentials.name);
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/signin");
  if (page.url().includes("/signin")) {
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/agents");
  }
}
