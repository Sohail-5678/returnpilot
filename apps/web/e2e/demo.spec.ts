import { expect, test, type Page } from "@playwright/test";

/** SPEC §1.6 demo: Maya asks → refund pauses for a human → Riley approves → Maya's chat updates. */

async function signInAs(page: Page, name: "Maya" | "Riley") {
  await page.goto("/login");
  await page.getByText(`Continue as ${name}`).click();
  await page.waitForURL(name === "Maya" ? /\/chat/ : /\/reviews/);
}

test("customer refund waits for a human, reviewer approves, chat updates", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try as Maya" }).click();
  await page.waitForURL(/\/chat/);

  await page.getByRole("button", { name: "Can I return the boots from my last order?" }).click();
  await expect(page.getByText("Looked up order #1042").first()).toBeVisible();
  await expect(page.getByText("Trail Runner Boots").first()).toBeVisible();
  await expect(page.getByText(/Policy §2\.1/).first()).toBeVisible();
  await page.waitForURL(/\/chat\/[0-9a-f-]{36}/);
  const threadUrl = page.url();

  const box = page.getByPlaceholder("Ask about an order, a return or a refund…");
  await box.fill("Yes, and refund me.");
  await box.press("Enter");
  await expect(page.getByText("Waiting for a human reviewer").first()).toBeVisible();
  await expect(page.getByText(/sent this refund of \$129\.00 to a team member/)).toBeVisible();

  await signInAs(page, "Riley");
  await page.getByText("Order #1042 · Trail Runner Boots").first().click();
  await expect(page.getByText("Amount is over the $50 auto-approve limit").or(page.getByText(/over the \$50\.00 auto-approve limit/)).first()).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Approve refund" }).click();
  await expect(page.getByText(/approved/i).first()).toBeVisible();

  await signInAs(page, "Maya");
  await page.goto(threadUrl);
  await expect(page.getByText(/a team member approved your refund of \$129\.00/)).toBeVisible();
  // The Celery job issues the (simulated) refund a moment later.
  await page.getByRole("button", { name: "Actions" }).first().click();
  await expect(page.getByText("Refund issued (simulated)").filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
});

test("another customer's order stays invisible", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try as Maya" }).click();
  await page.waitForURL(/\/chat/);
  const box = page.getByPlaceholder("Ask about an order, a return or a refund…");
  await box.fill("What's the status of order #1038?");
  await box.press("Enter");
  await expect(page.getByText(/couldn't find order #1038/)).toBeVisible();
});

test("reply feedback and the admin's agent profile panel", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try as Maya" }).click();
  await page.waitForURL(/\/chat/);
  await page.getByRole("button", { name: "Can I return the boots from my last order?" }).click();
  await expect(page.getByText(/Policy §2\.1/).first()).toBeVisible();
  const helpful = page.getByRole("button", { name: "Helpful" }).first();
  await helpful.click();
  await expect(helpful).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Thanks!").first()).toBeVisible();

  await page.goto("/login");
  await page.getByText("Continue as Avery").click();
  await page.waitForURL(/\/admin|\/runs/);
  await page.goto("/admin");
  const panel = page.getByRole("region", { name: "Agent profile" });
  await expect(panel.getByText(/returnpilot@\d+/).first()).toBeVisible();
  await expect(panel.getByText("Identical to the bundled default.")).toBeVisible();
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/admin-profile.png", fullPage: false });
});
