import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "https://insaf-corporation.vercel.app";
mkdirSync("scripts/sqa-shots", { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser
  .newContext({ viewport: { width: 1440, height: 900 } })
  .then((c) => c.newPage());
const cons = [];
page.on("console", (m) => {
  if (m.type() === "error") cons.push(m.text());
});
page.on("pageerror", (e) => cons.push(e.message));

await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
await page.locator('input[type="password"]').waitFor();
const inputs = page.locator("input");
await inputs.nth(0).fill("operator");
await page.locator('input[type="password"]').fill("insaf123");
await page
  .locator("button[type=submit], button")
  .filter({ hasText: /ইন|Sign/ })
  .first()
  .click();
await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 25000 });

await page.goto(`${BASE}/products/categories`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: "scripts/sqa-shots/categories.png", fullPage: true });
const catText = await page.getByRole("main").innerText();
console.log("CAT_PAGE_SNIP", JSON.stringify(catText.slice(0, 1500)));
console.log("BUTTONS", await page.locator("button").allTextContents());

await page.goto(`${BASE}/sales/new`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: "scripts/sqa-shots/sales-new.png", fullPage: true });
const so = await page.locator("table, body").innerText();
console.log("SO_SNIP", JSON.stringify(so.slice(0, 2000)));
console.log("SO_BUTTONS", await page.locator("button").allTextContents());
console.log("COMBO", await page.locator("[role=combobox]").count());
if (await page.locator("[role=combobox]").count()) {
  const n = await page.locator("[role=combobox]").count();
  for (let i = 0; i < n; i++) {
    await page.locator("[role=combobox]").nth(i).click();
    await page.waitForTimeout(400);
    const opts = await page.getByRole("option").allTextContents();
    console.log("COMBO", i, opts);
    await page.keyboard.press("Escape");
  }
}

await page.goto(`${BASE}/products/new`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: "scripts/sqa-shots/product-new.png", fullPage: true });
const n2 = await page.locator("[role=combobox]").count();
console.log("PROD_COMBOS", n2);
for (let i = 0; i < n2; i++) {
  await page.locator("[role=combobox]").nth(i).click();
  await page.waitForTimeout(400);
  const opts = await page.getByRole("option").allTextContents();
  console.log("PCOMBO", i, opts);
  await page.keyboard.press("Escape");
}

console.log("CONSOLE_ERR", cons);
await browser.close();
