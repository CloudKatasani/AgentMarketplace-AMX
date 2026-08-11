import { expect, test } from "@playwright/test";

/**
 * Rebranding a tenant, end to end.
 *
 * `CLAUDE.md` promises a buyer can rebrand by editing one file, and that an
 * Enterprise tenant can override the same token names. The second half of that
 * had a column in the schema and nothing else until Phase 6 — so this test
 * exists to keep the claim honest: set a token, see every screen change, and
 * see the product refuse anything that is not a colour.
 */
test("an Enterprise admin can rebrand the workspace, and only with colours", async ({ page }) => {
  await page.goto("/signin");
  await page.fill("#email", "priya.owner@amx.demo");
  await page.fill("#password", "amx-demo-2024");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/agents");

  // The showcase tenant is read-only; the writable twin is where changes happen.
  await page.locator("header select[name='organizationId']").selectOption({
    label: "Northwind Utility (sandbox)",
  });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("This is the live demo workspace")).toHaveCount(0);

  await page.goto("/admin");
  const themeForm = page.locator('form:has(button:has-text("Save the theme"))');

  // Anything that is not a colour is refused, in words, before it can reach a
  // <style> tag on every page of the tenant.
  await themeForm.locator("#theme").fill("brand-primary: red; } body { display: none }");
  await themeForm.getByRole("button", { name: "Save the theme" }).click();
  await expect(themeForm.locator("[role=status]")).toContainText("is not a colour");

  // A semantic state is not overridable at all: success, warning and danger
  // carry meaning a rebrand must not be able to repaint.
  await themeForm.locator("#theme").fill("danger: #00FF00");
  await themeForm.getByRole("button", { name: "Save the theme" }).click();
  await expect(themeForm.locator("[role=status]")).toContainText("not an overridable token");

  await themeForm.locator("#theme").fill("brand-primary: #7A1F5C\nbrand-deep: #4E1039");
  await themeForm.getByRole("button", { name: "Save the theme" }).click();
  await expect(themeForm.locator("[role=status]")).toContainText("Theme saved");

  // The header band is `--brand-primary`, so the rebrand is visible on the
  // shell of every screen rather than only where it was set.
  await page.goto("/marketplace");
  const header = page.locator("header");
  await expect(header).toHaveCSS("background-color", "rgb(122, 31, 92)");

  // Put it back, so the demo tenant this shares a database with looks like the
  // demo tenant.
  await page.goto("/admin");
  await page.locator('form:has(button:has-text("Save the theme")) #theme').fill("");
  await page
    .locator('form:has(button:has-text("Save the theme"))')
    .getByRole("button", { name: "Save the theme" })
    .click();
  await expect(page.locator('form:has(button:has-text("Save the theme")) [role=status]')).toContainText(
    "Theme cleared",
  );
});
