import { chromium } from "playwright";
import { MongoClient } from "mongodb";

const BASE = process.env.SQA_BASE_URL || "http://localhost:8082";
const URI = process.env.MONGODB_URI;
const tag = `SQALOST${Date.now().toString(36)}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const client = new MongoClient(URI);
await client.connect();
const db = client.db("InsafCorporation");

function rec(t, r, e) {
  console.log(`[${r}] ${t} — ${e}`);
}

try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-login-card]").first().click();
  await page.waitForURL((u) => !String(u.pathname).includes("/login"), {
    waitUntil: "commit",
    timeout: 60000,
  });

  await page.goto(`${BASE}/products/new`, { waitUntil: "networkidle" });
  await page.locator("form input:not([type=file])").nth(0).fill(`${tag}-S`);
  await page.locator("form input:not([type=file])").nth(1).fill(`${tag}-cyl`);
  await page.locator("[role=combobox]").nth(0).click();
  await page.getByRole("option", { name: "LPG" }).first().click();
  await page.locator("[role=combobox]").nth(1).click();
  await page
    .getByRole("option", { name: /সিলিন্ডার|Cylinder/ })
    .first()
    .click();
  await page.locator("[role=combobox]").nth(2).click();
  await page.getByRole("option", { name: "cyl" }).click();
  await page.locator("form button[type=submit]").click();
  await page.waitForTimeout(2000);
  if (page.url().endsWith("/products") || page.url().endsWith("/products/")) {
    await page.getByText(`${tag}-cyl`, { exact: true }).first().click();
    await page.waitForTimeout(600);
  }
  const pid = page.url().split("/products/")[1]?.split(/[?#]/)[0];

  await page.goto(`${BASE}/purchases/new`, { waitUntil: "networkidle" });
  await page.locator("[role=combobox]").first().click();
  await page.getByRole("option").nth(0).click();
  await page.getByRole("button", { name: /Add Item|আইটেম যোগ/i }).click();
  await page.locator("table [role=combobox]").first().click();
  await page.getByRole("option", { name: `${tag}-cyl` }).click();
  await page.locator("table input[type=number]").first().fill("1");
  await page.getByRole("button", { name: /Create PO|পিও তৈরি/i }).click();
  await page.waitForURL(/\/purchases\/(?!new)/, { waitUntil: "commit", timeout: 20000 });
  await page
    .getByRole("button", { name: /Receive Goods|পণ্য গ্রহণ/i })
    .first()
    .click();
  const g = page.getByRole("dialog");
  await g.waitFor();
  await g.getByTestId("generate-serials").click();
  await page.waitForTimeout(400);
  await g.getByTestId("grn-submit").click();
  await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 15000 });

  async function adj(typeText) {
    await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: /স্টক অ্যাডজাস্টমেন্ট|Adjust/i })
      .first()
      .click();
    const dlg = page.getByRole("dialog");
    await dlg.waitFor();
    await dlg.locator("[role=combobox]").first().click();
    await page
      .getByRole("option", { name: new RegExp(`${tag}-cyl`) })
      .first()
      .click();
    await page.keyboard.press("Escape");
    await dlg.getByTestId("adjust-type").click();
    await page.getByRole("option").filter({ hasText: typeText }).first().click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await dlg.locator("[role=combobox]").last().click();
    await page.waitForTimeout(300);
    await page.getByRole("option").first().click();
    const dates = page.locator("input[type=date]");
    const n = await dates.count();
    const today = new Date().toISOString().slice(0, 10);
    const ret = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    for (let i = 0; i < n; i += 1) {
      await dates.nth(i).evaluate(
        (el, v) => {
          const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
          proto.set.call(el, v);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        },
        i === 0 ? today : ret,
      );
    }
    await dlg.locator("input[type=number]").last().fill("1");
    const apply = dlg.getByRole("button", { name: /প্রয়োগ|Apply/i }).last();
    if (await apply.isDisabled()) throw new Error("apply disabled\n" + (await dlg.innerText()));
    await apply.click();
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 15000 });
  }

  await adj(/গ্রাহকে পাঠানো|Customer Sent/);
  let cyls = await db.collection("cylinders").find({ productId: pid }).toArray();
  rec("send before lost", cyls[0]?.status === "at_customer" ? "PASS" : "FAIL", cyls[0]?.status);
  const availBefore = cyls.filter((c) => c.status === "in_stock").length;
  await adj(/হারানো চিহ্নিত|Mark as Lost/);
  cyls = await db.collection("cylinders").find({ productId: pid }).toArray();
  rec(
    "Lost status",
    cyls[0]?.status === "lost" ? "PASS" : "FAIL",
    cyls.map((c) => c.status).join(","),
  );
  rec(
    "Lost not available",
    cyls.every((c) => c.status !== "in_stock") &&
      cyls.filter((c) => c.status === "in_stock").length <= availBefore
      ? "PASS"
      : "FAIL",
    JSON.stringify(cyls.map((c) => c.status)),
  );
} catch (e) {
  rec("Runner", "FAIL", e instanceof Error ? e.message : String(e));
} finally {
  const products = await db
    .collection("products")
    .find({ code: new RegExp(`^${tag}`) })
    .toArray();
  const pids = products.map((p) => p.id);
  const cyls = await db
    .collection("cylinders")
    .find({ productId: { $in: pids } })
    .toArray();
  await db.collection("movements").deleteMany({ cylinderId: { $in: cyls.map((c) => c.id) } });
  await db.collection("cylinders").deleteMany({ productId: { $in: pids } });
  await db.collection("purchases").deleteMany({ "items.productId": { $in: pids } });
  await db.collection("stockMovements").deleteMany({ productId: { $in: pids } });
  await db.collection("costLayers").deleteMany({ productId: { $in: pids } });
  await db.collection("products").deleteMany({ id: { $in: pids } });
  await client.close();
  await browser.close();
}
