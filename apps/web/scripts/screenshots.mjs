// Capture README screenshots from a running local stack (backend with FAKE_LLM=true + `pnpm dev`).
//   node scripts/screenshots.mjs [baseURL] [outDir]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? "../../docs/screenshots";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
const page = await ctx.newPage();
const shot = async (name) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${name}.png` }); // README uses compressed .jpg copies
  console.log("saved", name);
};
const signIn = async (who) => {
  await page.goto(`${base}/login`);
  await page.getByText(`Continue as ${who}`).click();
  await page.waitForURL(who === "Maya" ? /\/chat/ : who === "Riley" ? /\/reviews/ : /\/admin|\/runs/);
};

await page.goto(base);
await page.waitForTimeout(4500); // let the hero chat preview play
await shot("landing");

await page.getByRole("button", { name: "Try as Maya" }).click();
await page.waitForURL(/\/chat/);
await page.getByRole("button", { name: "Can I return the boots from my last order?" }).click();
await page.getByText(/Policy §2\.1/).first().waitFor();
const box = page.getByPlaceholder("Ask about an order, a return or a refund…");
await box.fill("Yes, and refund me.");
await box.press("Enter");
await page.getByText("Waiting for a human reviewer").first().waitFor();
const threadUrl = page.url();
await shot("chat-approval-pending");

await signIn("Riley");
await page.getByText("Order #1042 · Trail Runner Boots").first().click();
await page.getByText("Agent summary").waitFor();
await shot("review-detail");
await page.getByRole("button", { name: "Approve", exact: true }).click();
await page.getByRole("button", { name: "Approve refund" }).click();
await page.waitForTimeout(1500);

await signIn("Maya");
await page.goto(threadUrl);
await page.getByText(/approved your refund of \$129\.00/).waitFor();
await page.waitForTimeout(3500); // refund job finishes
await shot("chat-approved");

await signIn("Avery");
await page.goto(`${base}/runs`);
await page.waitForTimeout(1200);
const firstRun = page.locator('a[href^="/runs/"]').last();
await firstRun.click();
await page.waitForURL(/\/runs\/.+/);
await shot("run-trace");
await page.goto(`${base}/admin`);
await page.waitForTimeout(2500);
await shot("admin");

const dark = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
const dp = await dark.newPage();
await dp.goto(base);
await dp.waitForTimeout(4500);
await dp.screenshot({ path: `${out}/landing-dark.png` });
console.log("saved landing-dark");

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: "light", isMobile: true });
const mp = await mobile.newPage();
await mp.goto(base);
await mp.waitForTimeout(3500);
await mp.screenshot({ path: `${out}/landing-mobile.png` });
console.log("saved landing-mobile");

await browser.close();
