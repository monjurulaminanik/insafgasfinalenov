import { chromium } from "playwright";
import { MongoClient } from "mongodb";

const BASE = process.env.SQA_BASE_URL || "http://localhost:8082";
const URI = process.env.MONGODB_URI;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator("[data-login-card]").first().click();
await page.waitForURL((u) => !String(u.pathname).includes("/login"), {
  waitUntil: "commit",
  timeout: 60000,
});
await page.goto(`${BASE}/products/new`, { waitUntil: "networkidle" });
const tag = `PRB${Date.now().toString(36)}`;
await page.locator("form input:not([type=file])").nth(0).fill(tag);
await page.locator("form input:not([type=file])").nth(1).fill(`${tag}-name`);
await page.locator("[role=combobox]").nth(0).click();
await page.getByRole("option", { name: "LPG" }).first().click();
await page.keyboard.press("Escape");
await page.locator("[role=combobox]").nth(1).click();
await page
  .getByRole("option", { name: /Gas|গ্যাস/ })
  .first()
  .click();
await page.keyboard.press("Escape");
await page.locator("[role=combobox]").nth(2).click();
await page.getByRole("option", { name: "kg" }).click();
await page.keyboard.press("Escape");
await page.locator("form input[type=number]").nth(0).fill("100");
await page.locator("form input[type=number]").nth(1).fill("50");
await page.locator("form button[type=submit]").click();
await page.waitForTimeout(2500);
if (page.url().includes("/products") && !page.url().match(/\/products\/[^/]+/)) {
  await page.getByText(`${tag}-name`, { exact: true }).first().click();
  await page.waitForTimeout(800);
}
const id = page.url().split("/products/")[1]?.split(/[?#/]/)[0];
const client = new MongoClient(URI);
await client.connect();
const doc = await client.db("InsafCorporation").collection("products").findOne({ id });
console.log("db product", JSON.stringify(doc, null, 2));
await page.goto(`${BASE}/products/${id}/edit`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const snapshot = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll("form input")].map((el) => ({
    name: el.getAttribute("name"),
    type: el.getAttribute("type"),
    value: el.value,
  }));
  const combos = [...document.querySelectorAll("[role=combobox]")].map((el) => el.textContent);
  return { inputs, combos };
});
console.log("form snapshot", JSON.stringify(snapshot, null, 2));
await page.locator("form input:not([type=file])").nth(1).fill(`${tag}-edited`);
await page.locator("form button[type=submit]").click();
await page.waitForTimeout(1500);
console.log("toast", await page.locator("[data-sonner-toast]").allTextContents());
await client.db("InsafCorporation").collection("products").deleteOne({ id });
await client.close();
await browser.close();
