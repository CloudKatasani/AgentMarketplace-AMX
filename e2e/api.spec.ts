import { expect, test } from "@playwright/test";

/**
 * The read-only API, from issuing a token in the UI to reading the catalogue
 * with it.
 *
 * The point of driving it through the browser first is that the token is only
 * ever shown once, on screen, to the person who created it — so "can an admin
 * actually get a working token out of this product" is the thing under test,
 * not just whether the handler parses a header.
 */
test.describe.configure({ mode: "serial" });

let token = "";

test("an Enterprise admin can issue a token, and it is shown exactly once", async ({ page }) => {
  await page.goto("/signin");
  await page.fill("#email", "priya.owner@amx.demo");
  await page.fill("#password", "amx-demo-2024");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/agents");

  await page.locator("header select[name='organizationId']").selectOption({
    label: "Northwind Utility (sandbox)",
  });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("This is the live demo workspace")).toHaveCount(0);

  await page.goto("/admin");
  const form = page.locator('form:has(button:has-text("Issue a token"))');
  await form.locator("#tokenName").fill("Playwright reader");
  await form.getByRole("button", { name: "Issue a token" }).click();

  const status = form.locator("[role=status]");
  await expect(status).toContainText("cannot be shown again");
  const message = (await status.textContent()) ?? "";
  const match = message.match(/amx_[A-Za-z0-9_-]{20,}/);
  expect(match).not.toBeNull();
  token = match![0];

  // Reloading the page must not surface it again: only the prefix survives.
  await page.reload();
  await expect(page.getByText(token)).toHaveCount(0);
  await expect(page.getByText(token.slice(0, 12), { exact: false }).first()).toBeVisible();
});

test("the token reads the catalogue, and nothing reads it without one", async ({ request }) => {
  const anonymous = await request.get("/api/v1/agents");
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()["www-authenticate"]).toContain("Bearer");

  const wrong = await request.get("/api/v1/agents", {
    headers: { Authorization: "Bearer amx_definitely-not-a-real-token" },
  });
  expect(wrong.status()).toBe(401);

  const response = await request.get("/api/v1/agents", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBe(true);

  const body = await response.json();
  expect(body.apiVersion).toBe("v1");
  const agent = body.data.find((row: { slug: string }) => row.slug === "customer-churn-advisor");
  expect(agent).toBeTruthy();
  expect(agent.certification).toBeTruthy();
  // Every agent carries what it stands on, with both contract versions, so a
  // consumer can compute drift without a second call.
  expect(agent.bindings.length).toBeGreaterThan(0);
  expect(agent.bindings[0].boundContractVersion).toBeTruthy();
});

test("one agent resolves to its questions, metrics and approvals", async ({ request }) => {
  const response = await request.get("/api/v1/agents/customer-churn-advisor", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBe(true);

  const { data } = await response.json();
  expect(data.questions.length).toBeGreaterThan(0);
  expect(data.questions[0].answeredBy[0].metric).toBeTruthy();
  expect(data.approvals.length).toBeGreaterThan(0);
  // Roles and decisions, never names, on a surface a machine reads.
  expect(data.approvals[0].decisions[0].role).toBeTruthy();
  expect(JSON.stringify(data)).not.toContain("@amx.demo");

  const missing = await request.get("/api/v1/agents/no-such-agent", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(missing.status()).toBe(404);
});

test("the audit endpoint returns the chain, in order, with hashes", async ({ request }) => {
  const response = await request.get("/api/v1/audit?limit=5", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBe(true);

  const { data, meta } = await response.json();
  expect(meta.limit).toBe(5);
  expect(data).toHaveLength(5);
  expect(data[0].sequence).toBe(1);
  expect(data[1].prevHash).toBe(data[0].hash);
  // Payloads come back as JSON, not as a string to re-parse.
  expect(typeof data[0].payload).toBe("object");
});

test("the API refuses to write, in every shape", async ({ request }) => {
  // There are no write handlers at all, so the router answers 405. The absence
  // is the feature: an approval is an act by a named person at a gate.
  for (const call of [
    request.post("/api/v1/agents", { headers: { Authorization: `Bearer ${token}` }, data: {} }),
    request.delete("/api/v1/agents/customer-churn-advisor", {
      headers: { Authorization: `Bearer ${token}` },
    }),
    request.patch("/api/v1/data-products", {
      headers: { Authorization: `Bearer ${token}` },
      data: {},
    }),
  ]) {
    const response = await call;
    expect(response.status()).toBe(405);
  }
});

test("a revoked token stops working immediately", async ({ page, request }) => {
  await page.goto("/signin");
  await page.fill("#email", "priya.owner@amx.demo");
  await page.fill("#password", "amx-demo-2024");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/agents");

  await page.locator("header select[name='organizationId']").selectOption({
    label: "Northwind Utility (sandbox)",
  });
  await page.getByRole("button", { name: "Switch" }).click();
  // The banner disappearing is the signal the switch landed; without it the
  // next navigation races the server action and lands back on the showcase.
  await expect(page.getByText("This is the live demo workspace")).toHaveCount(0);
  await page.goto("/admin");

  const row = page.locator("li", { hasText: "Playwright reader" }).first();
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("revoked").first()).toBeVisible();

  const response = await request.get("/api/v1/agents", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(401);
});
