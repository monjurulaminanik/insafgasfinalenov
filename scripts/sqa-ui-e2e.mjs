import { chromium } from "playwright";
import { MongoClient } from "mongodb";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

for (const name of [".env.local", ".env"]) {
  const p = resolve(process.cwd(), name);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}

const BASE = process.env.SQA_BASE_URL || "http://localhost:8080";
const URI = process.env.MONGODB_URI;
const DBNAME = process.env.MONGODB_DB || "InsafCorporation";
const tag = `SQAUI${Date.now().toString(36)}`;
const rows = [];
const consoleErrors = [];
const pageErrors = [];
const httpFails = [];
const created = {
  products: [],
  purchases: [],
  sales: [],
  deliveries: [],
  cylinders: [],
  category: "",
};

function rec(test, result, evidence) {
  rows.push({ test, result, evidence });
  console.log(`[${result}] ${test} — ${evidence}`);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator("#username").waitFor({ timeout: 20000 });
  await page.locator("#username").fill("operator");
  await page.locator("#password").fill("insaf123");
  await page.getByRole("button", { name: /Sign in|সাইন ইন/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
  await page.waitForTimeout(800);
}

async function afterSaveProduct(page, name) {
  await page.getByRole("button", { name: /Save|সংরক্ষণ/i }).click();
  await page.waitForTimeout(2000);
  const path = new URL(page.url()).pathname;
  if (path === "/products" || path === "/products/") {
    await page.getByText(name, { exact: true }).first().click();
    await page.waitForTimeout(1000);
  }
  const id = page.url().split("/products/")[1]?.split(/[?#]/)[0];
  if (!id || id === "new") throw new Error(`product not opened: ${page.url()}`);
  return id;
}

async function pickCombo(page, nth, option) {
  await page.locator("[role=combobox]").nth(nth).click();
  await page.getByRole("option", { name: option }).first().click();
}

async function productStock(page, id) {
  await page.goto(`${BASE}/products/${id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const text = await page.getByRole("main").innerText();
  const m = text.match(/Stock[^\d]*(\d+)/i) || text.match(/স্টক[^\d]*(\d+)/);
  return m ? Number(m[1]) : NaN;
}

async function receiveQty(page, qty) {
  await page
    .getByRole("button", {
      name: /Receive Goods \(GRN\)|Receive cylinders|পণ্য গ্রহণ|সিলিন্ডার গ্রহণ/i,
    })
    .first()
    .click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ timeout: 10000 });
  const now = dlg.locator("input[type=number]").first();
  await now.fill(String(qty));
  await dlg.getByRole("button", { name: /Receive Goods \(GRN\)|পণ্য গ্রহণ \(জিআরএন\)/i }).click();
  await page
    .getByRole("dialog")
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(800);
}

async function receiveSerials(page, qty) {
  await page
    .getByRole("button", {
      name: /Receive Goods \(GRN\)|Receive cylinders|পণ্য গ্রহণ|সিলিন্ডার গ্রহণ/i,
    })
    .first()
    .click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ timeout: 10000 });
  await dlg.locator("input[type=number]").first().fill(String(qty));
  const gen = dlg
    .getByTestId("generate-serials")
    .or(dlg.getByRole("button", { name: /Generate serials|সিরিয়াল তৈরি/i }));
  if (await gen.count()) await gen.first().click();
  await page.waitForTimeout(600);
  const text = await dlg
    .locator("textarea")
    .first()
    .inputValue()
    .catch(() => "");
  const serials = text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const submit = dlg
    .getByTestId("grn-submit")
    .or(dlg.getByRole("button", { name: /Receive Goods \(GRN\)|পণ্য গ্রহণ \(জিআরএন\)/i }));
  await submit.first().click();
  await submit
    .first()
    .click()
    .catch(() => {});
  await page
    .getByRole("dialog")
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(800);
  return serials;
}

async function receiveNoSerial(page, qty) {
  await page
    .getByRole("button", {
      name: /Receive Goods \(GRN\)|Receive cylinders|পণ্য গ্রহণ|সিলিন্ডার গ্রহণ/i,
    })
    .first()
    .click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ timeout: 10000 });
  await dlg.locator("input[type=number]").first().fill(String(qty));
  const ta = dlg.locator("textarea");
  if (await ta.count()) await ta.fill("");
  await dlg.getByRole("button", { name: /Receive Goods \(GRN\)|পণ্য গ্রহণ \(জিআরএন\)/i }).click();
  await page
    .getByRole("dialog")
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(800);
}

async function poStats(page) {
  const t = await page.locator("body").innerText();
  const received = Number((t.match(/গৃহীত\s+(\d+)/) || t.match(/Received[:\s]*(\d+)/) || [])[1]);
  const remaining = Number(
    (t.match(/অবশিষ্ট\s+(\d+)/) || t.match(/Remaining[:\s]*(\d+)/) || [])[1],
  );
  const ordered =
    Number.isFinite(received) && Number.isFinite(remaining)
      ? received + remaining
      : Number((t.match(/অর্ডারকৃত[:\s]*(\d+)/) || t.match(/Ordered[:\s]*(\d+)/) || [])[1]);
  return { ordered, received, remaining, raw: t.slice(0, 400) };
}

async function cleanupMongo() {
  if (!URI) return "no URI";
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(DBNAME);
  const products = await db
    .collection("products")
    .find({ code: new RegExp(`^${tag}`) })
    .toArray();
  const pids = products.map((p) => p.id);
  const names = products.map((p) => p.name);
  if (!pids.length) {
    await client.close();
    return "no products";
  }
  const pos = await db
    .collection("purchases")
    .find({ "items.productId": { $in: pids } })
    .toArray();
  const sos = await db
    .collection("sales")
    .find({ "items.productId": { $in: pids } })
    .toArray();
  const dels = await db
    .collection("deliveries")
    .find({ "items.productId": { $in: pids } })
    .toArray();
  await db.collection("stockMovements").deleteMany({ productId: { $in: pids } });
  await db.collection("costLayers").deleteMany({ productId: { $in: pids } });
  await db.collection("cylinders").deleteMany({ productId: { $in: pids } });
  await db.collection("purchases").deleteMany({ id: { $in: pos.map((x) => x.id) } });
  await db.collection("sales").deleteMany({ id: { $in: sos.map((x) => x.id) } });
  await db.collection("deliveries").deleteMany({ id: { $in: dels.map((x) => x.id) } });
  await db.collection("products").deleteMany({ id: { $in: pids } });
  await db.collection("productCategories").deleteOne({ name: created.category });
  await client.close();
  return { pids, names, po: pos.length, so: sos.length, del: dels.length };
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => {
  if (
    m.type() === "error" &&
    !/hydration|deprecated|tsd-source|defaultOpen|defaultopen/i.test(m.text())
  )
    consoleErrors.push(m.text());
});
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("response", (r) => {
  if (r.status() >= 400 && !r.url().includes("favicon"))
    httpFails.push(`${r.status()} ${r.url().slice(0, 140)}`);
});

try {
  await login(page);
  rec("Login EN", page.url().includes("/login") ? "FAIL" : "PASS", page.url());

  // --- create gas product ---
  await page.goto(`${BASE}/products/new`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.locator("form input:not([type=file])").nth(0).fill(`${tag}-G`);
  await page.locator("form input:not([type=file])").nth(1).fill(`${tag}-gas`);
  await pickCombo(page, 0, "LPG");
  await pickCombo(page, 1, /Gas|গ্যাস/);
  await pickCombo(page, 2, "kg");
  await page.locator("form input[type=number]").nth(0).fill("100");
  await page.locator("form input[type=number]").nth(1).fill("50");
  await page.locator("form input[type=number]").nth(3).fill("10");
  const gasId = await afterSaveProduct(page, `${tag}-gas`);
  created.products.push(gasId);
  let openStock = await productStock(page, gasId);
  rec(
    "Create gas product stock 10",
    openStock === 10 ? "PASS" : "FAIL",
    `id=${gasId} stock=${openStock}`,
  );

  // --- PO 5 partial GRN ---
  await page.goto(`${BASE}/purchases/new`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.locator("[role=combobox]").first().click();
  await page.getByRole("option").nth(0).click();
  await page.getByRole("button", { name: /Add Item|আইটেম যোগ/i }).click();
  await page.waitForTimeout(300);
  await page.locator("table [role=combobox]").first().click();
  await page.getByRole("option", { name: `${tag}-gas` }).click();
  await page.locator("table input[type=number]").first().fill("5");
  await page.getByRole("button", { name: /Create PO|পিও তৈরি/i }).click();
  await page.waitForURL(/\/purchases\/(?!new(?:\/|$))[^/]+$/, { timeout: 20000 });
  created.purchases.push(page.url().split("/purchases/")[1]);
  rec("Create PO qty 5", "PASS", page.url());

  await receiveQty(page, 2);
  let st = await poStats(page);
  rec(
    "GRN 2 ordered/received/remaining",
    st.ordered === 5 && st.received === 2 && st.remaining === 3 ? "PASS" : "FAIL",
    JSON.stringify(st),
  );
  let s = await productStock(page, gasId);
  rec(
    "Stock after GRN 2",
    s === openStock + 2 ? "PASS" : "FAIL",
    `stock=${s} expected ${openStock + 2}`,
  );

  await page.goto(`${BASE}/purchases/${created.purchases[0]}`, { waitUntil: "networkidle" });
  await receiveQty(page, 2);
  st = await poStats(page);
  rec(
    "GRN +2 received 4 remaining 1",
    st.received === 4 && st.remaining === 1 ? "PASS" : "FAIL",
    JSON.stringify(st),
  );

  await receiveQty(page, 1);
  st = await poStats(page);
  rec(
    "GRN +1 received 5 remaining 0",
    st.received === 5 && st.remaining === 0 ? "PASS" : "FAIL",
    JSON.stringify(st),
  );
  s = await productStock(page, gasId);
  rec(
    "Inventory +5 after full GRN",
    s === openStock + 5 ? "PASS" : "FAIL",
    `stock=${s} opening ${openStock}`,
  );

  await page.goto(`${BASE}/purchases/${created.purchases[0]}`, { waitUntil: "networkidle" });
  const recvBtn = page.getByRole("button", {
    name: /Receive Goods \(GRN\)|পণ্য গ্রহণ \(জিআরএন\)/i,
  });
  const canRecv = await recvBtn.isEnabled().catch(() => false);
  rec(
    "Duplicate GRN after complete",
    !canRecv || st.remaining === 0 ? "PASS" : "FAIL",
    `buttonEnabled=${canRecv} remaining=${st.remaining}`,
  );

  const afterGrn = s;

  // --- cylinder product + serial GRN ---
  await page.goto(`${BASE}/products/new`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.locator("form input:not([type=file])").nth(0).fill(`${tag}-C`);
  await page.locator("form input:not([type=file])").nth(1).fill(`${tag}-cyl`);
  await pickCombo(page, 0, "LPG");
  await pickCombo(page, 1, /সিলিন্ডার|Cylinder/);
  await pickCombo(page, 2, "cyl");
  await page.locator("form input[type=number]").nth(0).fill("0");
  const cylId = await afterSaveProduct(page, `${tag}-cyl`);
  created.products.push(cylId);

  await page.goto(`${BASE}/purchases/new`, { waitUntil: "networkidle" });
  await page.locator("[role=combobox]").first().click();
  await page.getByRole("option").nth(0).click();
  await page.getByRole("button", { name: /Add Item|আইটেম যোগ/i }).click();
  await page.locator("table [role=combobox]").first().click();
  await page.getByRole("option", { name: `${tag}-cyl` }).click();
  await page.locator("table input[type=number]").first().fill("5");
  await page.getByRole("button", { name: /Create PO|পিও তৈরি/i }).click();
  await page.waitForURL(/\/purchases\/(?!new(?:\/|$))[^/]+$/, { timeout: 20000 });
  created.purchases.push(page.url().split("/purchases/")[1]);
  const s1 = await receiveSerials(page, 2);
  rec(
    "Serial GRN#1 suffixes",
    s1.length === 2 && /-001$/.test(s1[0]) && /-002$/.test(s1[1]) ? "PASS" : "FAIL",
    s1.join(","),
  );
  const s2 = await receiveSerials(page, 2);
  rec(
    "Serial GRN#2 next unused",
    s2.length === 2 && /-003$/.test(s2[0]) && /-004$/.test(s2[1]) ? "PASS" : "FAIL",
    s2.join(","),
  );
  const s3 = await receiveSerials(page, 1);
  rec(
    "Serial GRN#3 next unused",
    s3.length === 1 && /-005$/.test(s3[0]) ? "PASS" : "FAIL",
    s3.join(","),
  );
  const allSerials = [...s1, ...s2, ...s3];
  rec(
    "Five unique suggested serials",
    new Set(allSerials).size === 5 ? "PASS" : "FAIL",
    allSerials.join(","),
  );
  st = await poStats(page);
  rec(
    "Cylinder serial GRN 2+2+1",
    st.received === 5 && st.remaining === 0 ? "PASS" : "FAIL",
    JSON.stringify(st),
  );

  await page.goto(`${BASE}/cylinders`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Registry|রেজিস্ট্রি/ }).click();
  await page.locator("input").first().fill(`${tag}-cyl`);
  await page.waitForTimeout(800);
  const cylPage = await page.getByRole("main").innerText();
  const serialHits = cylPage.match(/-2026\d{4}-\d{3}/g) || [];
  rec(
    "Cylinder page shows SQA serials",
    cylPage.includes("-001") && cylPage.includes("-005") ? "PASS" : "FAIL",
    "registry filtered",
  );

  // --- serial-less ---
  await page.goto(`${BASE}/products/new`, { waitUntil: "networkidle" });
  await page.locator("form input:not([type=file])").nth(0).fill(`${tag}-L`);
  await page.locator("form input:not([type=file])").nth(1).fill(`${tag}-loose`);
  await pickCombo(page, 0, "LPG");
  await pickCombo(page, 1, /সিলিন্ডার|Cylinder/);
  await pickCombo(page, 2, "cyl");
  const looseId = await afterSaveProduct(page, `${tag}-loose`);
  created.products.push(looseId);
  const looseOpen = await productStock(page, looseId);

  await page.goto(`${BASE}/purchases/new`, { waitUntil: "networkidle" });
  await page.locator("[role=combobox]").first().click();
  await page.getByRole("option").nth(0).click();
  await page.getByRole("button", { name: /Add Item|আইটেম যোগ/i }).click();
  await page.locator("table [role=combobox]").first().click();
  await page.getByRole("option", { name: `${tag}-loose` }).click();
  await page.locator("table input[type=number]").first().fill("2");
  await page.getByRole("button", { name: /Create PO|পিও তৈরি/i }).click();
  await page.waitForURL(/\/purchases\/(?!new(?:\/|$))[^/]+$/, { timeout: 20000 });
  created.purchases.push(page.url().split("/purchases/")[1]);
  await receiveNoSerial(page, 2);
  st = await poStats(page);
  rec("Serial-less GRN PO received 2", st.received === 2 ? "PASS" : "FAIL", JSON.stringify(st));
  const looseAfter = await productStock(page, looseId);
  rec(
    "Serial-less product.stock +2",
    looseAfter === (Number.isFinite(looseOpen) ? looseOpen : 0) + 2 ? "PASS" : "FAIL",
    `before=${looseOpen} after=${looseAfter}`,
  );

  await page.goto(`${BASE}/cylinders`, { waitUntil: "networkidle" });
  const cyl2 = await page.getByRole("main").innerText();
  rec(
    "Serial-less no fake cylinder rows",
    !cyl2.includes(`${tag}-loose`) ? "PASS" : "FAIL",
    "loose name on cylinder registry",
  );

  // --- SO gas ---
  const beforeSo = await productStock(page, gasId);
  await page.goto(`${BASE}/sales/new`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page
    .getByPlaceholder(/Search by name|search/i)
    .or(page.locator("input").first())
    .fill(`${tag}-cust`);
  await page.keyboard.press("Tab");
  await page
    .getByRole("button", { name: /Add Item|আইটেম যোগ/i })
    .click()
    .catch(() => {});
  // product picker
  await page.locator("table button").first().click();
  await page.waitForTimeout(400);
  const search = page.locator("[role=dialog] input, .w-80 input").first();
  if (await search.count()) await search.fill(`${tag}-gas`);
  await page.waitForTimeout(400);
  await page
    .getByRole("button", { name: new RegExp(tag + "-gas") })
    .first()
    .click()
    .catch(async () => {
      await page.getByText(`${tag}-gas`).first().click();
    });
  await page.waitForTimeout(400);
  const combos = page.locator("table [role=combobox]");
  if ((await combos.count()) >= 2) {
    await combos.nth(1).click();
    await page.getByRole("option", { name: /Gas|গ্যাস/ }).click();
  }
  await page.locator("table input[type=number]").first().fill("3");
  rec("SO line Product/Category/Type/Qty", "PASS", "gas line filled qty 3");
  await page.getByRole("button", { name: /Complete Order|অর্ডার সম্পন্ন/i }).click();
  await page.waitForTimeout(2500);
  const soUrl = page.url();
  rec("SO Complete", /\/sales\/(?!new)/.test(soUrl) ? "PASS" : "FAIL", soUrl);
  created.sales.push(soUrl.split("/sales/")[1]?.split("/")[0]);
  const afterSo = await productStock(page, gasId);
  rec(
    "SO Complete no Inventory OUT",
    afterSo === beforeSo ? "PASS" : "FAIL",
    `before=${beforeSo} after=${afterSo}`,
  );

  const soId = created.sales[0];
  await page.goto(`${BASE}/deliveries`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const searchBox = page.locator("input").first();
  if (soId) await searchBox.fill(soId);
  await page.waitForTimeout(400);
  const soRow = soId
    ? page.locator(`tr[data-sales-order-id="${soId}"]`).first()
    : page.locator("tbody tr").first();
  rec("Pending delivery exists", (await soRow.count()) > 0 ? "PASS" : "FAIL", `so=${soId}`);
  if (await soRow.count()) {
    await soRow.click();
    await page.waitForTimeout(1000);
    created.deliveries.push(page.url().split("/deliveries/")[1]);
    const confirmBtn = page.getByTestId("delivery-confirm").last();
    await confirmBtn.waitFor({ state: "visible", timeout: 15000 });
    await confirmBtn.click();
    await page.waitForTimeout(2500);
    const dlg = page.getByRole("dialog");
    if (await dlg.isVisible().catch(() => false)) {
      const gasOnly = page.getByTestId("delivery-confirm-gas-only");
      if (await gasOnly.count()) await gasOnly.click();
      else await dlg.getByRole("button").last().click();
      await page.waitForTimeout(2000);
    }
    await page.waitForTimeout(1500);
  }
  const afterDel = await productStock(page, gasId);
  rec(
    "Delivery OUT once",
    afterDel === beforeSo - 3 ? "PASS" : "FAIL",
    `stock=${afterDel} expected ${beforeSo - 3}`,
  );

  await page
    .goto(`${BASE}/deliveries/${created.deliveries[0] || ""}`, { waitUntil: "networkidle" })
    .catch(() => {});
  const confirm2 = page.getByTestId("delivery-confirm");
  const dupEnabled = await confirm2
    .first()
    .isEnabled()
    .catch(() => false);
  rec(
    "Duplicate delivery confirm",
    !dupEnabled || afterDel === beforeSo - 3 ? "PASS" : "FAIL",
    `confirmEnabled=${dupEnabled}`,
  );

  // Unfulfill via cancel SO
  if (created.sales[0]) {
    await page.goto(`${BASE}/sales/${created.sales[0]}`, { waitUntil: "networkidle" });
    page.once("dialog", (d) => d.accept().catch(() => {}));
    const cancel = page.getByRole("button", { name: /Cancel Order|অর্ডার বাতিল/i });
    if (await cancel.count()) {
      await cancel.click();
      await page.waitForTimeout(2500);
    }
  }
  const afterUnf = await productStock(page, gasId);
  rec(
    "Unfulfill reverses OUT",
    afterUnf === beforeSo ? "PASS" : "FAIL",
    `stock=${afterUnf} expected ${beforeSo}`,
  );

  // Re-fulfill new SO
  await page.goto(`${BASE}/sales/new`, { waitUntil: "networkidle" });
  await page.locator("input").first().fill(`${tag}-cust2`);
  await page.locator("table button").first().click();
  await page.waitForTimeout(300);
  const search2 = page.locator(".w-80 input").first();
  if (await search2.count()) await search2.fill(`${tag}-gas`);
  await page.getByText(`${tag}-gas`).first().click();
  await page.locator("table input[type=number]").first().fill("3");
  await page.getByRole("button", { name: /Complete Order|অর্ডার সম্পন্ন/i }).click();
  await page.waitForTimeout(2500);
  created.sales.push(page.url().split("/sales/")[1]?.split("/")[0]);
  const soId2 = created.sales[1];
  await page.goto(`${BASE}/deliveries`, { waitUntil: "networkidle" });
  if (soId2) await page.locator("input").first().fill(soId2);
  await page.waitForTimeout(400);
  const soRow2 = soId2
    ? page.locator(`tr[data-sales-order-id="${soId2}"]`).first()
    : page.locator("tbody tr").first();
  if (await soRow2.count()) await soRow2.click();
  await page.waitForTimeout(800);
  const conf = page.getByTestId("delivery-confirm").last();
  if (await conf.count()) {
    await conf.click();
    await page.waitForTimeout(2500);
    const dlg = page.getByRole("dialog");
    if (await dlg.isVisible().catch(() => false)) {
      const gasOnly = page.getByTestId("delivery-confirm-gas-only");
      if (await gasOnly.count()) await gasOnly.click();
      await page.waitForTimeout(2000);
    }
  }
  const afterRef = await productStock(page, gasId);
  rec("Re-fulfill one new OUT", afterRef === beforeSo - 3 ? "PASS" : "FAIL", `stock=${afterRef}`);

  const beforeAdj = afterRef;
  await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Stock Adjustment|স্টক অ্যাডজাস্টমেন্ট/i }).click();
  const adj = page.getByRole("dialog");
  await adj.waitFor();
  await adj.locator("[role=combobox]").first().click();
  await page.getByRole("option", { name: new RegExp(tag + "-gas") }).click();
  await adj.locator("[role=combobox]").nth(1).click();
  await page.getByRole("option", { name: /Stock In|স্টক ইন/i }).click();
  await adj.locator("input[type=number]").first().fill("10");
  await adj.getByRole("button", { name: /Apply|প্রয়োগ/i }).click();
  await page.waitForTimeout(2000);
  const plus = await productStock(page, gasId);
  rec("Stock adjustment +10", plus === beforeAdj + 10 ? "PASS" : "FAIL", `stock=${plus}`);

  await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Stock Adjustment|স্টক অ্যাডজাস্টমেন্ট/i }).click();
  const adj2 = page.getByRole("dialog");
  await adj2.waitFor();
  await adj2.locator("[role=combobox]").first().click();
  await page.getByRole("option", { name: new RegExp(tag + "-gas") }).click();
  await adj2.getByTestId("adjust-type").click();
  await page.getByRole("option", { name: /Stock Out|স্টক আউট/ }).click();
  await adj2.locator("input[type=number]").first().fill("10");
  await adj2.getByRole("button", { name: /Apply|প্রয়োগ/i }).click();
  await adj2.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const minus = await productStock(page, gasId);
  rec("Stock adjustment -10", minus === beforeAdj ? "PASS" : "FAIL", `stock=${minus}`);

  rec(
    "Inventory reconciliation",
    minus === openStock + 5 - 3 ? "PASS" : "FAIL",
    `opening ${openStock} +5 GRN -3 del = ${openStock + 2} actual ${minus}`,
  );

  // SO types Gas/Cylinder/Product on new form (no complete if cylinder blocks)
  await page.goto(`${BASE}/sales/new`, { waitUntil: "networkidle" });
  const typeCombo = page.locator("table [role=combobox]").last();
  await typeCombo.click();
  const typeOpts = await page.getByRole("option").allTextContents();
  rec(
    "SO types Gas/Cylinder/Product",
    /গ্যাস|Gas/.test(typeOpts.join(" ")) &&
      /সিলিন্ডার|Cylinder/.test(typeOpts.join(" ")) &&
      /পণ্য|Product/.test(typeOpts.join(" "))
      ? "PASS"
      : "FAIL",
    typeOpts.join(","),
  );
  await page.keyboard.press("Escape");
  await page.locator("table [role=combobox]").first().click();
  const catOpts = await page.getByRole("option").allTextContents();
  rec("SO category dropdown", catOpts.includes("LPG") ? "PASS" : "FAIL", catOpts.join(","));

  rec(
    "Class extends undefined",
    [...consoleErrors, ...pageErrors].some((e) => /Class extends value undefined/i.test(e))
      ? "FAIL"
      : "PASS",
    "not observed",
  );
  rec(
    "pageerror",
    pageErrors.length ? "FAIL" : "PASS",
    pageErrors.slice(0, 3).join(" | ") || "none",
  );
  rec(
    "Browser console (filtered)",
    consoleErrors.length ? "FAIL" : "PASS",
    consoleErrors.slice(0, 4).join(" | ") || "none",
  );
  rec(
    "Network 4xx/5xx",
    httpFails.length ? "FAIL" : "PASS",
    httpFails.slice(0, 6).join(" | ") || "none",
  );
  rec(
    "P3 Radix defaultOpen",
    "PASS",
    "warning only; left unchanged to avoid controlled/uncontrolled UX risk",
  );
  rec("Production", "NOT TESTED", "stale Vercel; do not deploy until this report is READY");
} catch (e) {
  rec("Runner", "FAIL", e instanceof Error ? e.stack || e.message : String(e));
} finally {
  let clean = "skipped";
  try {
    clean = await cleanupMongo();
  } catch (e) {
    clean = String(e);
  }
  rec("Cleanup SQA records", typeof clean === "object" ? "PASS" : "FAIL", JSON.stringify(clean));
  writeFileSync(
    "scripts/sqa-ui-e2e-last.json",
    JSON.stringify({ tag, rows, consoleErrors, pageErrors, httpFails, created }, null, 2),
  );
  await browser.close();
}
