import { chromium } from "playwright";

const BASE = "https://insaf-corporation.vercel.app";
const browser = await chromium.launch({ headless: true });
const p = await browser.newPage();
await p.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
await p.locator("#username").waitFor({ timeout: 20000 });
await p.locator("#username").fill("operator");
await p.locator("#password").fill("insaf123");
await p.getByRole("button", { name: /Sign in|সাইন ইন/i }).click();
await p.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 45000 });
await p.goto(`${BASE}/purchases/1ozxdmms`, { waitUntil: "networkidle", timeout: 45000 });
const recv = p
  .getByRole("button", { name: /Receive Goods|Receive cylinders|পণ্য গ্রহণ|সিলিন্ডার গ্রহণ/i })
  .first();
await recv.click();
const dlg = p.getByRole("dialog");
await dlg.waitFor({ timeout: 10000 });
console.log("number inputs", await dlg.locator("input[type=number]").count());
console.log("textarea", await dlg.locator("textarea").count());
console.log("testid gen", await dlg.getByTestId("generate-serials").count());
if (await dlg.locator("input[type=number]").count()) {
  await dlg.locator("input[type=number]").first().fill("2");
  await dlg.locator("input[type=number]").first().blur();
}
if (await dlg.getByTestId("generate-serials").count()) {
  await dlg.getByTestId("generate-serials").click();
} else {
  await dlg.getByRole("button", { name: /Generate serials|সিরিয়াল তৈরি/i }).click();
}
await p.waitForTimeout(1200);
console.log(
  "value",
  await dlg
    .locator("textarea")
    .first()
    .inputValue()
    .catch(() => "none"),
);
await p.goto(`${BASE}/cylinders`, { waitUntil: "networkidle" });
await p
  .getByRole("button", { name: /Registry|রেজিস্ট্রি/ })
  .click()
  .catch(() => {});
const main = await p.getByRole("main").innerText();
console.log("hist serial format", /-\d{8}-\d{3}/.test(main));
await browser.close();
