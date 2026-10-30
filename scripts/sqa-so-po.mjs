import { chromium } from "playwright";
const BASE = "http://localhost:8080";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const failed = [];
page.on("response", (r) => {
  if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
});
page.on("pageerror", (e) => console.log("PAGEERR", e.message));
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.locator("#username").fill("operator");
await page.locator("#password").fill("insaf123");
await page.getByRole("button", { name: /সাইন ইন|Sign in/i }).click();
await page.waitForURL((u) => !u.pathname.includes("login"));
await page.goto(`${BASE}/sales/new`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const n = await page.locator("[role=combobox]").count();
console.log("SO_COMBOS", n);
for (let i = 0; i < n; i++) {
  await page.locator("[role=combobox]").nth(i).click();
  await page.waitForTimeout(300);
  const opts = await page.getByRole("option").allTextContents();
  console.log("SO_COMBO", i, opts);
  await page.keyboard.press("Escape");
}
const headers = await page.locator("th").allTextContents();
console.log("SO_TH", headers);

await page.goto(`${BASE}/purchases`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const firstPo = page.locator("a[href*='/purchases/']").first();
if (await firstPo.count()) {
  await firstPo.click();
  await page.waitForTimeout(1500);
  console.log("PO_URL", page.url());
  const recv = page.getByRole("button").filter({ hasText: /GRN|গ্রহণ|Receive/i });
  console.log("RECV_BTNS", await page.locator("button").allTextContents());
  if (await recv.count()) {
    await recv.first().click();
    await page.waitForTimeout(1000);
    console.log(
      "MODAL",
      (
        await page
          .locator("[role=dialog]")
          .innerText()
          .catch(() => "no-dialog")
      ).slice(0, 800),
    );
    await page.keyboard.press("Escape");
  }
}
console.log("FAILED_HTTP", failed);
await browser.close();
