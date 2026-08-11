import { expect, test, type Page } from "@playwright/test";

import { claimWorkspace, openWorkspace, signIn } from "./helpers";

/**
 * One practitioner, one browser, eight gates, a published agent.
 *
 * This is the single-player promise made literal: nobody hands this run a
 * fixture, nobody writes a row directly, and no second human appears. Every
 * stage is authored in the forms a customer sees, submitted with a written
 * self-attestation, and approved at its own gate.
 *
 * `tests/demo-arc.test.ts` proves the same walk against the engine, where the
 * peer-review path lives. What this adds is the part an engine test cannot:
 * that the forms in front of the criteria can actually be filled in.
 */

test.describe.configure({ mode: "serial" });
test.describe("the full eight-stage walk, solo, in a browser", () => {
  const PASSWORD = "correct-horse-battery";
  const stamp = Date.now();
  const email = `solo${stamp}@example.test`;
  let agentId = "";

  test("onboard, then author and approve every stage to published", async ({ page }) => {
    // Eight stages of authoring and approving is a long session by design.
    test.setTimeout(240_000);

    await openWorkspace(page, { name: `Solo Walk ${stamp}` });
    // Claimed straight away: this walk signs back in twice, and a guest has no
    // password to sign in with.
    await claimWorkspace(page, { name: "Dana Founder", email, password: PASSWORD });
    agentId = await openStarterAgent(page);

    // ── Stages 1–3 · already authored by the starter workspace ──
    //
    // The seeded agent arrives mid-lifecycle with a persona register, a charter
    // and complete binding coverage. That is the product's promise — never an
    // empty screen — so the walk starts by approving what is already there.
    await passStage(page, 1, "1-consumption-discovery");
    await passStage(page, 2, "2-agent-charter");
    await passStage(page, 3, "3-data-product-binding");

    // ── Stage 4 · grounding pack and tool specifications ──
    await page.goto(`/agents/${agentId}/stages/4-grounding-and-tools`);

    const grounding = formWith(page, "Validate and commit the grounding pack");
    await grounding
      .locator("#glossary")
      .fill("churn | A residential account terminating service, excluding in-territory moves");
    await grounding.locator("#allowedJoins").fill("customer | account | customer_id");
    await grounding.locator("#hints").fill("account | The billing account, not the online login");
    await commit(grounding, "Validate and commit the grounding pack");

    const tools = formWith(page, "Validate and commit the tool specifications");
    await tools.locator("[name='tool.0.name']").fill("rank_accounts_by_churn_risk");
    await tools
      .locator("[name='tool.0.bindingRef']")
      .selectOption({ index: 1 });
    await tools
      .locator("[name='tool.0.description']")
      .fill("Ranks residential accounts by the certified churn rate for a segment.");
    await tools
      .locator("[name='tool.0.inputs']")
      .fill("segment | string | Residential segment to rank within | yes");
    await tools
      .locator("[name='tool.0.outputs']")
      .fill("ranked_accounts | array | Accounts with churn rate and prior-quarter change | yes");
    await tools
      .locator("[name='tool.0.refusalRules']")
      .fill(
        "Refuse for commercial and industrial accounts — they are outside the charter.\nRefuse any request for an individual customer's personal details.",
      );
    await tools
      .locator("[name='tool.0.escalationPath']")
      .fill("Hand off to the Revenue Assurance duty analyst.");
    await commit(tools, "Validate and commit the tool specifications");

    await passStage(page, 4, "4-grounding-and-tools");

    // ── Stage 5 · score the harness, golden set and adversarial probes ──
    await page.goto(`/agents/${agentId}/stages/5-evaluation-harness`);
    const harness = formWith(page, "Commit the evaluation");

    // The golden cases are seeded from Stage 1's questions; a reviewer scores
    // them. Anything left blank fails the "every case scored" criterion.
    for (const field of ["groundedness", "faithfulness", "citationCorrectness"]) {
      const inputs = harness.locator(`input[name$='.${field}']`);
      for (let i = 0; i < (await inputs.count()); i += 1) {
        await inputs.nth(i).fill("5");
      }
    }
    // Probes pass by being refused.
    const refusals = harness.locator("input[name$='.refusedCorrectly']");
    for (let i = 0; i < (await refusals.count()); i += 1) {
      await refusals.nth(i).check();
    }
    await commit(harness, "Commit the evaluation");
    await passStage(page, 5, "5-evaluation-harness");

    // ── Stage 6 · access, constraints, runbook, rollback, kill switch ──
    await page.goto(`/agents/${agentId}/stages/6-governance-and-guardrails`);
    const governance = formWith(page, "Commit the governance review");
    await governance
      .locator("#invocationAccess")
      .fill("Revenue Assurance duty analysts\nRetention campaign managers");

    const constraints = governance.locator("textarea[name$='.howAddressed']");
    for (let i = 0; i < (await constraints.count()); i += 1) {
      await constraints
        .nth(i)
        .fill(
          "Answers are aggregate and cite the certified metric; no individual customer record is returned, and access is limited to the named teams.",
        );
    }
    await governance
      .locator("#incidentRunbook")
      .fill(
        "The duty analyst is paged, checks the freshness banner and the bound contract version, and tells consumers in the retention channel.",
      );
    await governance
      .locator("#rollbackPlan")
      .fill(
        "Deprecate the listing, point consumers back at the certified churn dashboard, and re-open Stage 7 for re-certification.",
      );
    await governance.locator("#killSwitchOwner").fill("Dana Founder");
    await commit(governance, "Commit the governance review");
    await passStage(page, 6, "6-governance-and-guardrails");

    // ── Stage 7 · DATSIS+V, every score citing an artifact field ──
    await page.goto(`/agents/${agentId}/stages/7-certification`);
    const scorecard = formWith(page, "Commit the scorecard");

    const scores = scorecard.locator("input[name^='dim.'][name$='.score']");
    const citations = scorecard.locator("select[name^='dim.'][name$='.citation']");
    const dimensions = await scores.count();
    expect(dimensions).toBeGreaterThan(0);
    for (let i = 0; i < dimensions; i += 1) {
      await scores.nth(i).fill("4");
      // Index 0 is the "cite an artifact field" placeholder; a score without a
      // citation is an opinion, and the form refuses one.
      await citations.nth(i).selectOption({ index: 1 });
    }
    await scorecard
      .locator("#valueStatement")
      .fill(
        "Retention analysts start the week with a ranked, explainable list instead of three dashboards and a guess.",
      );
    await commit(scorecard, "Commit the scorecard");
    await passStage(page, 7, "7-certification");

    // ── Stage 8 · the listing, then publish ──
    await page.goto(`/agents/${agentId}/stages/8-publish-and-operate`);
    const listing = formWith(page, "Commit the listing");
    await listing
      .locator("#headline")
      .fill("Find the residential accounts most likely to leave — and why.");
    await listing
      .locator("#audience")
      .fill("Revenue Assurance Analysts\nRetention campaign managers");
    await listing
      .locator("#howToInvoke")
      .fill("Ask it in the retention channel, or open it from the marketplace listing.");
    await listing.locator("#supportContact").fill("revenue-assurance@example.test");
    await commit(listing, "Commit the listing");
    await passStage(page, 8, "8-publish-and-operate");

    // ── The end state, on the screens a consumer sees ──
    await page.goto(`/agents/${agentId}`);
    await expect(page.getByText("Published").first()).toBeVisible();
    await expect(page.getByText("Self-attested").first()).toBeVisible();

    await page.goto("/marketplace");
    await expect(page.getByRole("link", { name: "Customer Churn Advisor" })).toBeVisible();
    // Solo all the way through, so the badge must say so — never peer-certified.
    // `exact` keeps this off the lowercase <option> values in the filter.
    await expect(page.getByText("Self-attested", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Peer-certified", { exact: true })).toHaveCount(0);
  });

  test("editing an approved artifact makes its own gate stale", async ({ page }) => {
    // The second cascade path. The first — a data product's major version bump
    // invalidating what stands on it — is the demo arc's money moment; this one
    // is the inward-facing twin: the thing that was approved changed.
    await signIn(page, email, PASSWORD);
    await page.goto(`/agents/${agentId}/stages/2-agent-charter`);

    // Approved stages are locked, and the lock says the edit is still possible.
    // That promise has to be reachable, not just written.
    await expect(page.getByText(/has been approved/)).toBeVisible();
    await page.getByRole("link", { name: "Edit anyway" }).click();
    await page.waitForURL(/edit=1/);

    const charter = formWith(page, "Commit a new version");
    await charter
      .locator("#mission")
      .fill(
        "Tell a retention analyst which residential accounts are about to leave, why the certified numbers say so, and which of them are worth an intervention this week.",
      );
    await commit(charter, "Commit a new version");

    // The approval covered the previous version, so it is now stale — with the
    // cause in plain language and a re-approval path.
    await page.goto(`/agents/${agentId}/stages/2-agent-charter`);
    await expect(page.getByText("This stage needs re-approval")).toBeVisible();
    await expect(page.getByText(/agent charter changed after Agent Charter was approved/i)).toBeVisible();

    // And the agent's own page shows the stage back in play.
    await page.goto(`/agents/${agentId}`);
    await expect(page.getByText(/stale/i).first()).toBeVisible();
  });

  test("the walk left a complete, verified audit trail", async ({ page }) => {
    await signIn(page, email, PASSWORD);
    await page.goto("/audit");

    // A chain that verifies on screen rather than on trust, and one entry per
    // gate decision — eight of them, since every stage was decided once.
    await expect(page.getByText(/chain verified/i).first()).toBeVisible();
    await expect(page.getByText(/decided — gate/)).toHaveCount(8);
  });
});

// ─────────────────────────────── helpers ───────────────────────────────

/** Submit the stage solo, then approve it at its own gate. */
async function passStage(page: Page, ordinal: number, stageKey: string): Promise<void> {
  const agentId = page.url().split("/agents/")[1].split("/")[0];
  await page.goto(`/agents/${agentId}/stages/${stageKey}`);

  const submit = page.locator(`form:has(button:has-text("Submit stage ${ordinal} for review"))`);
  await submit.locator('input[name="soloAttestation"]').check();
  await submit.getByRole("button", { name: `Submit stage ${ordinal} for review` }).click();

  await page.getByRole("link", { name: "Go to the gate" }).click();
  await page.waitForURL(/\/gates\//);

  await page.fill(
    "#attestationStatement",
    `I have reviewed everything committed at stage ${ordinal} against this agent's charter and the questions it claims to answer, and I accept it on my own attestation.`,
  );
  await page.getByRole("button", { name: "Record decision" }).click();

  await expect(page.getByText("approved").first()).toBeVisible();
  await expect(page.getByText("self-attested").first()).toBeVisible();
}

/** Commit an artifact form and insist the server said yes. */
async function commit(
  form: ReturnType<Page["locator"]>,
  buttonName: string,
): Promise<void> {
  await form.getByRole("button", { name: buttonName }).click();
  const status = form.locator("[role=status]");
  await expect(status).toBeVisible();
  // A rejection renders in the same place, so assert the content, not just that
  // something appeared.
  await expect(status).not.toContainText(/cannot|refused|rejected/i);
}

function formWith(page: Page, buttonText: string) {
  return page.locator(`form:has(button:has-text("${buttonText}"))`).first();
}

async function openStarterAgent(page: Page): Promise<string> {
  await page.goto("/agents");
  await page.getByRole("link", { name: "Customer Churn Advisor" }).click();
  await page.waitForURL(/\/agents\/[^/]+$/);
  return page.url().split("/agents/")[1];
}

