// Walk the demo on a deployed site with the real models and print what happens.
//   node scripts/live-check.mjs https://returnpilot-ai.vercel.app <outDir>
import { chromium } from "@playwright/test";
const base = process.argv[2];
const out = process.argv[3] ?? "/tmp";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const lastReply = async () => (await page.locator("text=ReturnPilot said:").last().locator("..").innerText()).replace(/\s+/g, " ").slice(0, 400);
const replies = () => page.locator("text=ReturnPilot said:").count();
const waitIdle = async (before) => {
  for (let i = 0; i < 180; i++) {
    const box = page.getByPlaceholder("Ask about an order, a return or a refund…");
    if ((await replies()) > before && (await box.isEnabled()) && !(await page.getByRole("button", { name: /stop/i }).count())) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2000);
};

await page.goto(base);
await page.getByRole("button", { name: "Try as Maya" }).click();
await page.waitForURL(/\/chat/, { timeout: 120000 });
log("signed in as Maya");
const send = async (text) => { const before = await replies(); const box = page.getByPlaceholder("Ask about an order, a return or a refund…"); await box.fill(text); await box.press("Enter"); const t0 = Date.now(); await waitIdle(before); log(`sent "${text}" (${((Date.now() - t0) / 1000).toFixed(1)}s)`); };
await send("Can I return the boots from my last order?");
const chips = await page.locator('[class*="chip"], li:has-text("Looked up"), li:has-text("Checked")').allInnerTexts().catch(() => []);
log("tools:", (await page.getByText(/^(Looked up|Checked|Read policy|Proposed)/).allInnerTexts()).join(" | "));
log("reply:", await lastReply());
await page.screenshot({ path: `${out}/1-first-turn.png` });
await send("Yes, and refund me. They're unopened.");
log("tools:", (await page.getByText(/^(Proposed|Prepared)/).allInnerTexts()).join(" | "));
log("pending card:", await page.getByText("Waiting for a human reviewer").count());
log("reply:", await lastReply());
await page.screenshot({ path: `${out}/2-pending.png` });
const threadUrl = page.url();
await page.goto(`${base}/login`);
await page.getByText("Continue as Riley").click();
await page.waitForURL(/\/reviews/);
const item = page.getByText(/Order #1042 · Trail Runner Boots/).first();
if (await item.count()) {
  await item.click();
  await page.getByText("Agent summary").waitFor();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Approve refund" }).click();
  await page.waitForTimeout(3000);
  log("reviewer approved");
} else log("NO APPROVAL IN QUEUE");
await page.goto(`${base}/login`);
await page.getByText("Continue as Maya").click();
await page.waitForURL(/\/chat/);
await page.goto(threadUrl);
await page.waitForTimeout(8000);
log("after approval:", await lastReply());
await page.screenshot({ path: `${out}/3-approved.png` });
await page.goto(`${base}/chat`);
await page.waitForTimeout(1500);
await send("Use my usual return preference for this.");
log("memory reply:", await lastReply());
// traces for this browser's sandbox (demo admins only see their own workspace)
await page.goto(`${base}/login`);
await page.getByText("Continue as Avery").click();
await page.waitForURL(/admin|runs/);
const runs = await page.evaluate(async () => (await (await fetch("/api/v1/runs?limit=20")).json()).runs);
for (const r of runs.reverse()) {
  const d = await page.evaluate(async (id) => (await fetch(`/api/v1/runs/${id}`)).json(), r.id);
  console.log(`\nRUN ${r.kind} ${r.status} route=${r.route} total=${r.total_ms}ms "${(r.first_user_text || "").slice(0, 50)}"`);
  for (const st of d.steps) {
    const fb = st.kind === "llm" && st.input && st.input.fallbacks && st.input.fallbacks.length ? " FALLBACKS:" + JSON.stringify(st.input.fallbacks).slice(0, 400) : "";
    const calls = st.kind === "llm" && st.output && st.output.tool_calls ? " calls=" + st.output.tool_calls.map((c) => c.name).join(",") : "";
    console.log(`  ${st.kind.padEnd(9)} ${st.name.padEnd(26)} ${String(st.duration_ms).padStart(6)}ms ${st.model || ""} ${st.status}${calls}${fb}${st.error ? " ERR " + st.error.slice(0, 160) : ""}`);
  }
}
await browser.close();
