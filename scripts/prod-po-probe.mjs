import { chromium } from "playwright";

const BASE = process.env.SQA_BASE_URL || "https://insaf-corporation.vercel.app";
const browser = await chromium.launch({ headless: true });
const p = await browser.newPage();
await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await p.locator("#username").fill("operator");
await p.locator("#password").fill("insaf123");
await p.getByRole("button", { name: /Sign in|সাইন ইন/i }).click();
await p.waitForURL((u) => !u.pathname.includes("/login"));
await p.goto(`${BASE}/purchases`, { waitUntil: "networkidle" });
const row = p
  .locator("tbody tr")
  .filter({ hasNotText: /No |কোনো/i })
  .first();
const rowCount = await p.locator("tbody tr").count();
console.log(
  JSON.stringify({ rowCount, text: (await p.getByRole("main").innerText()).slice(0, 250) }),
);
if (rowCount) {
  await row.click();
  await p.waitForTimeout(1500);
  console.log("url", p.url());
  const recv = p.getByRole("button", {
    name: /Receive Goods|Receive cylinders|পণ্য গ্রহণ|সিলিন্ডার গ্রহণ/i,
  });
  const n = await recv.count();
  const en = n ? await recv.first().isEnabled() : false;
  console.log(JSON.stringify({ recv: n, enabled: en }));
  if (en) {
    await recv.first().click();
    const dlg = p.getByRole("dialog");
    const open = await dlg
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    const gen = open
      ? await dlg.getByRole("button", { name: /Generate serials|সিরিয়াল তৈরি/i }).count()
      : 0;
    const ta = open ? await dlg.locator("textarea").count() : 0;
    console.log(JSON.stringify({ open, gen, ta }));
    if (open) await p.keyboard.press("Escape");
  }
}
await browser.close();
