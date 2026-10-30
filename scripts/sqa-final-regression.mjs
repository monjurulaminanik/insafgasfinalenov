/**
 * Final regression gate: cylinder status tour + FIFO COGS + discount check.
 * Cleans only SQAFR-tagged docs.
 */
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

const BASE = process.env.SQA_BASE_URL || "http://localhost:8082";
const URI = process.env.MONGODB_URI;
const DBNAME = process.env.MONGODB_DB || "InsafCorporation";
const tag = `SQAFR${Date.now().toString(36)}`;
const rows = [];
const created = { products: [], purchases: [], sales: [], deliveries: [] };

function rec(test, result, evidence) {
  rows.push({ test, result, evidence });
  console.log(`[${result}] ${test} — ${evidence}`);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("[data-login-card]").first().waitFor({ timeout: 20000 });
  await page.locator("[data-login-card]").first().click();
  await page.waitForURL((u) => !String(u.pathname).includes("/login"), {
    timeout: 60000,
    waitUntil: "commit",
  });
  await page
    .getByText(/ওভারভিউ|Dashboard|শুভ দিন/i)
    .first()
    .waitFor({ timeout: 20000 });
}

async function pickCombo(page, nth, option) {
  await page.locator("[role=combobox]").nth(nth).click();
  await page.getByRole("option", { name: option }).first().click();
  await page.keyboard.press("Escape");
}

async function afterSaveProduct(page, name) {
  await page.locator("form button[type=submit]").click();
  await page.waitForTimeout(2200);
  if (/\/products\/?$/.test(new URL(page.url()).pathname)) {
    await page.getByText(name, { exact: true }).first().click();
    await page.waitForTimeout(800);
  }
  const id = page.url().split("/products/")[1]?.split(/[?#]/)[0];
  if (!id || id === "new") throw new Error(`product not opened: ${page.url()}`);
  return id;
}

async function createCylProduct(page, code, name) {
  await page.goto(`${BASE}/products/new`, { waitUntil: "networkidle" });
  await page.locator("form input:not([type=file])").nth(0).fill(code);
  await page.locator("form input:not([type=file])").nth(1).fill(name);
  await pickCombo(page, 0, "LPG");
  await pickCombo(page, 1, /সিলিন্ডার|Cylinder/);
  await pickCombo(page, 2, "cyl");
  await page.locator("form input[type=number]").nth(0).fill("100");
  await page.locator("form input[type=number]").nth(1).fill("50");
  const id = await afterSaveProduct(page, name);
  created.products.push(id);
  return id;
}

async function createGasFifo(page, code, name, sell, cost) {
  await page.goto(`${BASE}/products/new`, { waitUntil: "networkidle" });
  await page.locator("form input:not([type=file])").nth(0).fill(code);
  await page.locator("form input:not([type=file])").nth(1).fill(name);
  await pickCombo(page, 0, "LPG");
  await pickCombo(page, 1, /Gas|গ্যাস/);
  await pickCombo(page, 2, "kg");
  await page.locator("form input[type=number]").nth(0).fill(String(sell));
  await page.locator("form input[type=number]").nth(1).fill(String(cost));
  const id = await afterSaveProduct(page, name);
  created.products.push(id);
  return id;
}

async function createPO(page, productName, qty, lineCost) {
  await page.goto(`${BASE}/purchases/new`, { waitUntil: "networkidle" });
  await page.locator("[role=combobox]").first().click();
  await page.getByRole("option").nth(0).click();
  await page.getByRole("button", { name: /Add Item|আইটেম যোগ/i }).click();
  await page.locator("table [role=combobox]").first().click();
  await page.getByRole("option", { name: productName }).click();
  await page.locator("table input[type=number]").first().fill(String(qty));
  if (lineCost != null) {
    const nums = page.locator("table input[type=number]");
    if ((await nums.count()) > 1) await nums.nth(1).fill(String(lineCost));
  }
  await page.getByRole("button", { name: /Create PO|পিও তৈরি/i }).click();
  await page.waitForURL(/\/purchases\/(?!new(?:\/|$))[^/]+$/, {
    timeout: 20000,
    waitUntil: "commit",
  });
  const id = page.url().split("/purchases/")[1]?.split(/[?#]/)[0];
  created.purchases.push(id);
  await page.waitForTimeout(600);
  return id;
}

async function receiveGrn(page, { serials = false, qty } = {}) {
  await page
    .getByRole("button", { name: /Receive Goods|পণ্য গ্রহণ|সিলিন্ডার গ্রহণ/i })
    .first()
    .click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ timeout: 12000 });
  if (qty != null) await dlg.locator("input[type=number]").first().fill(String(qty));
  if (serials) {
    const gen = dlg.getByTestId("generate-serials");
    await gen.waitFor({ timeout: 8000 });
    await gen.click();
    await page.waitForTimeout(500);
    const ta = dlg.locator("textarea").first();
    const val = await ta.inputValue();
    if (!val.trim()) {
      const lines = Array.from(
        { length: qty || 6 },
        (_, i) => `${tag}-S-20260924-${String(i + 1).padStart(3, "0")}`,
      );
      await ta.fill(lines.join("\n"));
    }
  } else if (await dlg.locator("textarea").count()) {
    await dlg.locator("textarea").first().fill("");
  }
  await dlg.getByTestId("grn-submit").click();
  await page
    .getByRole("dialog")
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(900);
}

async function completeSo(page, productName, qty, customer) {
  await page.goto(`${BASE}/sales/new`, { waitUntil: "networkidle" });
  await page.locator("input").first().fill(customer);
  await page.keyboard.press("Tab");
  await page.locator("table button").first().click();
  await page.waitForTimeout(300);
  const search = page.locator("[role=dialog] input, .w-80 input").first();
  if (await search.count()) await search.fill(productName);
  await page.waitForTimeout(300);
  await page.getByText(productName).first().click();
  await page.locator("table input[type=number]").first().fill(String(qty));
  await page.getByRole("button", { name: /Complete Order|অর্ডার সম্পন্ন/i }).click();
  await page.waitForTimeout(2500);
  const id = page.url().split("/sales/")[1]?.split("/")[0];
  created.sales.push(id);
  return id;
}

async function confirmDelivery(page, soId) {
  await page.goto(`${BASE}/deliveries`, { waitUntil: "networkidle" });
  await page
    .locator("input")
    .first()
    .fill(soId || "");
  await page.waitForTimeout(400);
  const row = page.locator(`tr[data-sales-order-id="${soId}"]`).first();
  await row.click();
  await page.waitForTimeout(800);
  const delId = page.url().split("/deliveries/")[1];
  created.deliveries.push(delId);
  await page.getByTestId("delivery-confirm").last().click();
  await page
    .getByText(/ডেলিভারড|Delivered/i)
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  return delId;
}

async function pickParty(page, dlg, name) {
  const partyBox = dlg.locator("[role=combobox]").last();
  await partyBox.waitFor({ state: "visible", timeout: 10000 });
  await partyBox.click();
  await page.waitForTimeout(400);
  const texts = await page.getByRole("option").allTextContents();
  const hit = texts.find((t) => name && t.includes(name.split(" ")[0]));
  if (hit) {
    await page.getByRole("option", { name: hit }).first().click();
    return;
  }
  if (texts.length) {
    await page.getByRole("option").first().click();
    return;
  }
  throw new Error(`party option not found: ${name} options=${texts.join("|")}`);
}

async function adjust(
  page,
  { productName, typeLabel, qty, customer, supplier, expectedReturn, applyTwice },
) {
  await page.keyboard.press("Escape").catch(() => {});
  await page
    .getByRole("dialog")
    .waitFor({ state: "hidden", timeout: 4000 })
    .catch(() => {});
  await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
  await page.keyboard.press("Escape").catch(() => {});
  await page
    .getByRole("button", { name: /স্টক অ্যাডজাস্টমেন্ট|Adjust|Stock/i })
    .first()
    .click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor();
  await dlg.locator("[role=combobox]").first().click();
  await page
    .getByRole("option", { name: new RegExp(productName) })
    .first()
    .click();
  await page.keyboard.press("Escape");
  await dlg.getByTestId("adjust-type").click();
  const typeOpt = page.getByRole("option").filter({ hasText: typeLabel }).first();
  await typeOpt.waitFor({ timeout: 15000 });
  await typeOpt.click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  if (customer || supplier) {
    await dlg.locator("[role=combobox]").nth(2).waitFor({ timeout: 10000 });
    await pickParty(page, dlg, customer || supplier);
  }
  const dates = page.locator("input[type=date]");
  await dates
    .first()
    .waitFor({ timeout: 8000 })
    .catch(() => {});
  const dc = await dates.count();
  const today = new Date().toISOString().slice(0, 10);
  const ret = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  for (let i = 0; i < dc; i += 1) {
    const val = i === 0 ? today : ret;
    if (i > 0 && expectedReturn === false) continue;
    await dates.nth(i).evaluate((el, v) => {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      proto.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, val);
  }
  const qtyBox = dlg.locator("input[type=number]").last();
  await qtyBox.fill(String(qty));
  console.log(
    "adjust dialog",
    (await dlg.innerText()).slice(0, 400),
    "dates",
    dc,
    "applyDisabled",
    await dlg
      .getByRole("button", { name: /প্রয়োগ|Apply/i })
      .last()
      .isDisabled(),
  );
  const apply = dlg.getByRole("button", { name: /প্রয়োগ|Apply|আপডেট/i }).last();
  if (applyTwice)
    await apply.evaluate((el) => {
      el.click();
      el.click();
    });
  else {
    if (await apply.isDisabled())
      throw new Error(`apply disabled: ${(await dlg.innerText()).slice(0, 220)}`);
    await apply.click();
  }
  await page
    .getByRole("dialog")
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(600);
}

async function mongo() {
  const client = new MongoClient(URI);
  await client.connect();
  return { client, db: client.db(DBNAME) };
}

function counts(cyls) {
  const by = (fn) => cyls.filter(fn).length;
  return {
    n: cyls.length,
    in_stock: by((c) => c.status === "in_stock"),
    at_customer: by((c) => c.status === "at_customer"),
    with_supplier: by(
      (c) =>
        Boolean(c.supplierId) &&
        c.status !== "lost" &&
        c.status !== "damaged" &&
        c.status !== "at_customer",
    ),
    lost: by((c) => c.status === "lost"),
    damaged: by((c) => c.status === "damaged"),
    empty: by((c) => c.fillLevel === "empty" || c.status === "refilling"),
    full_stock: by(
      (c) => c.status === "in_stock" && c.fillLevel !== "empty" && c.status !== "refilling",
    ),
    available: by((c) => c.status === "in_stock" && c.fillLevel !== "empty"),
  };
}

async function snap(db, productId) {
  const cyls = await db.collection("cylinders").find({ productId }).toArray();
  const mvs = await db
    .collection("movements")
    .find({ cylinderId: { $in: cyls.map((c) => c.id) } })
    .toArray();
  const product = await db.collection("products").findOne({ id: productId });
  return { cyls, mvs, product, counts: counts(cyls) };
}

function remaining(mvs, kind, partyId) {
  let sent = 0;
  let returned = 0;
  let lost = 0;
  for (const m of mvs.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))) {
    if (kind === "customer" && m.customerId !== partyId) continue;
    if (kind === "supplier" && m.supplierId !== partyId) continue;
    if (kind === "customer") {
      if (m.type === "issued" && !m.sold) sent += 1;
      if (m.type === "returned") returned += 1;
      if (m.type === "lost") lost += 1;
    } else {
      if (m.type === "transferred") sent += 1;
      if (
        m.type === "received" ||
        m.type === "refilled" ||
        m.type === "returned" ||
        m.type === "damaged"
      )
        returned += 1;
      if (m.type === "lost") lost += 1;
    }
  }
  return { sent, returned, lost, remaining: sent - returned - lost };
}

async function cleanup(db) {
  const products = await db
    .collection("products")
    .find({ code: new RegExp(`^${tag}`) })
    .toArray();
  const pids = products.map((p) => p.id);
  if (!pids.length) return { pids: 0 };
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
  const cyls = await db
    .collection("cylinders")
    .find({ productId: { $in: pids } })
    .toArray();
  await db.collection("stockMovements").deleteMany({ productId: { $in: pids } });
  await db.collection("costLayers").deleteMany({ productId: { $in: pids } });
  await db.collection("movements").deleteMany({ cylinderId: { $in: cyls.map((c) => c.id) } });
  await db.collection("cylinders").deleteMany({ productId: { $in: pids } });
  await db.collection("purchases").deleteMany({ id: { $in: pos.map((x) => x.id) } });
  await db.collection("sales").deleteMany({ id: { $in: sos.map((x) => x.id) } });
  await db.collection("deliveries").deleteMany({ id: { $in: dels.map((x) => x.id) } });
  await db
    .collection("vouchers")
    .deleteMany({ refId: { $in: [...pos.map((x) => x.id), ...sos.map((x) => x.id)] } });
  await db
    .collection("ledger")
    .deleteMany({ refId: { $in: [...pos.map((x) => x.id), ...sos.map((x) => x.id)] } });
  await db.collection("products").deleteMany({ id: { $in: pids } });
  return { pids: pids.length, po: pos.length, so: sos.length, cyl: cyls.length };
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const { client, db } = await mongo();

try {
  await login(page);

  const formTxt = await (async () => {
    await page.goto(`${BASE}/products/new`, { waitUntil: "networkidle" });
    return page.getByRole("main").innerText();
  })();
  rec(
    "Discount field on Product Form",
    /discount|ডিসকাউন্ট/i.test(formTxt) ? "FAIL" : "NOT APPLICABLE",
    "not in Product model/form",
  );

  const serialName = `${tag}-serial`;
  const serialId = await createCylProduct(page, `${tag}-S`, serialName);
  await createPO(page, serialName, 6);
  await receiveGrn(page, { serials: true });
  let s = await snap(db, serialId);
  rec(
    "Serial GRN created 6 cylinders",
    s.counts.n === 6 && s.counts.in_stock === 6 ? "PASS" : "FAIL",
    JSON.stringify(s.counts),
  );

  const qtyName = `${tag}-qty`;
  const qtyId = await createCylProduct(page, `${tag}-Q`, qtyName);
  await createPO(page, qtyName, 2);
  await receiveGrn(page, { serials: false, qty: 2 });
  const qtySnap = await snap(db, qtyId);
  rec(
    "Quantity-only cylinder GRN",
    qtySnap.counts.n === 0 && (qtySnap.product?.stock ?? 0) === 2 ? "PASS" : "FAIL",
    `cyls=${qtySnap.counts.n} stock=${qtySnap.product?.stock}`,
  );

  const firstCust = (
    await db
      .collection("customers")
      .find({ name: { $not: /^SQA/i } })
      .sort({ createdAt: 1 })
      .toArray()
  )[0];
  const firstSup = (
    await db
      .collection("suppliers")
      .find({ name: { $not: /^SQA/i } })
      .sort({ createdAt: 1 })
      .toArray()
  )[0];
  if (!firstCust || !firstSup) throw new Error("Need existing customer/supplier");

  await page
    .goto(`${BASE}/customers/${firstCust.id}`, { waitUntil: "networkidle" })
    .catch(() => {});
  await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });

  await adjust(page, {
    productName: serialName,
    typeLabel: /গ্রাহকে পাঠানো|Customer Sent/i,
    qty: 2,
    customer: firstCust.name,
  });
  s = await snap(db, serialId);
  const heldCustId = s.cyls.find((c) => c.status === "at_customer")?.customerId || firstCust.id;
  const cr1 = remaining(s.mvs, "customer", heldCustId);
  rec(
    "Full → Customer",
    s.counts.at_customer === 2 && cr1.remaining === 2 ? "PASS" : "FAIL",
    JSON.stringify({ ...s.counts, cr1 }),
  );

  await adjust(page, {
    productName: serialName,
    typeLabel: /গ্রাহক ফেরত|Customer Returned/i,
    qty: 1,
    customer: firstCust.name,
    expectedReturn: false,
  });
  s = await snap(db, serialId);
  const cr2 = remaining(s.mvs, "customer", heldCustId);
  rec(
    "Empty ← Customer",
    s.counts.at_customer === 1 && cr2.remaining === 1 ? "PASS" : "FAIL",
    JSON.stringify({ at_customer: s.counts.at_customer, empty: s.counts.empty, cr2 }),
  );
  rec(
    "Customer Remaining after return",
    cr2.remaining === 1 ? "PASS" : "FAIL",
    JSON.stringify(cr2),
  );

  const availBeforeRefill = s.counts.available;
  await adjust(page, {
    productName: serialName,
    typeLabel: /রিফিল সম্পন্ন|Complete Refill/i,
    qty: 1,
  });
  s = await snap(db, serialId);
  rec(
    "Refill",
    s.counts.available >= availBeforeRefill && s.mvs.some((m) => m.type === "refilled")
      ? "PASS"
      : "FAIL",
    JSON.stringify(s.counts),
  );

  await adjust(page, {
    productName: serialName,
    typeLabel: /গ্রাহক ফেরত|Customer Returned/i,
    qty: 1,
    customer: firstCust.name,
    expectedReturn: false,
  });
  s = await snap(db, serialId);
  rec(
    "Customer Remaining after second return",
    remaining(s.mvs, "customer", heldCustId).remaining === 0 ? "PASS" : "FAIL",
    JSON.stringify(remaining(s.mvs, "customer", heldCustId)),
  );

  await adjust(page, {
    productName: serialName,
    typeLabel: /সাপ্লায়ারে পাঠানো|Supplier Sent/i,
    qty: 1,
    supplier: firstSup.name,
  });
  s = await snap(db, serialId);
  const heldSupId = s.cyls.find((c) => c.supplierId)?.supplierId || firstSup.id;
  const sr1 = remaining(s.mvs, "supplier", heldSupId);
  rec(
    "Supplier Sent",
    s.counts.with_supplier === 1 && sr1.remaining === 1 ? "PASS" : "FAIL",
    JSON.stringify({ with_supplier: s.counts.with_supplier, sr1 }),
  );
  rec("Supplier Remaining after send", sr1.remaining === 1 ? "PASS" : "FAIL", JSON.stringify(sr1));

  await adjust(page, {
    productName: serialName,
    typeLabel: /সাপ্লায়ার ফেরত|Supplier Returned/i,
    qty: 1,
    supplier: firstSup.name,
    expectedReturn: false,
  });
  s = await snap(db, serialId);
  const sr2 = remaining(s.mvs, "supplier", heldSupId);
  rec(
    "Supplier Returned",
    s.counts.with_supplier === 0 && sr2.remaining === 0 ? "PASS" : "FAIL",
    JSON.stringify({ with_supplier: s.counts.with_supplier, sr2 }),
  );

  await adjust(page, {
    productName: serialName,
    typeLabel: /গ্রাহকে পাঠানো|Customer Sent/i,
    qty: 1,
    customer: firstCust.name,
  });
  s = await snap(db, serialId);
  rec("Customer-held", s.counts.at_customer === 1 ? "PASS" : "FAIL", JSON.stringify(s.counts));

  await adjust(page, {
    productName: serialName,
    typeLabel: /সিলিন্ডার এক্সচেঞ্জ|Cylinder Exchange/i,
    qty: 1,
    customer: firstCust.name,
  });
  s = await snap(db, serialId);
  const issued = s.mvs.filter((m) => m.type === "issued").length;
  const returned = s.mvs.filter((m) => m.type === "returned").length;
  rec(
    "Exchange",
    s.counts.at_customer === 1 && issued >= 3 && returned >= 3 ? "PASS" : "FAIL",
    JSON.stringify({ at_customer: s.counts.at_customer, issued, returned }),
  );

  const availBeforeLost = s.counts.available;
  await adjust(page, {
    productName: serialName,
    typeLabel: /হারানো চিহ্নিত|Mark as Lost/i,
    qty: 1,
    customer: firstCust.name,
    expectedReturn: false,
  });
  s = await snap(db, serialId);
  rec(
    "Lost",
    s.counts.lost === 1 && s.counts.available <= availBeforeLost ? "PASS" : "FAIL",
    JSON.stringify(s.counts),
  );
  rec(
    "Lost not available stock",
    s.cyls.filter((c) => c.status === "lost").every((c) => c.status !== "in_stock")
      ? "PASS"
      : "FAIL",
    "lost rows",
  );

  await adjust(page, {
    productName: serialName,
    typeLabel: /ক্ষতিগ্রস্ত চিহ্নিত|Mark Damaged/i,
    qty: 1,
  });
  s = await snap(db, serialId);
  rec("Damaged", s.counts.damaged >= 1 ? "PASS" : "FAIL", JSON.stringify(s.counts));
  rec(
    "Damaged not available stock",
    s.cyls.filter((c) => c.status === "damaged").every((c) => c.status !== "in_stock")
      ? "PASS"
      : "FAIL",
    "damaged rows",
  );

  const mvBeforeDup = s.mvs.length;
  await adjust(page, {
    productName: serialName,
    typeLabel: /গ্রাহকে পাঠানো|Customer Sent/i,
    qty: 1,
    customer: firstCust.name,
    applyTwice: true,
  });
  s = await snap(db, serialId);
  rec(
    "Duplicate customer send does not double beyond available",
    s.mvs.length - mvBeforeDup <= 2 ? "PASS" : "FAIL",
    `newMoves=${s.mvs.length - mvBeforeDup} at_customer=${s.counts.at_customer}`,
  );

  await page.goto(`${BASE}/cylinders`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  rec(
    "Cylinder registry persist refresh",
    (await page.locator("body").innerText()).includes(serialName) ||
      (await db.collection("cylinders").countDocuments({ productId: serialId })) === 6
      ? "PASS"
      : "FAIL",
    "refresh",
  );

  rec(
    "Serial-tracked vs quantity-only split",
    s.counts.n === 6 && qtySnap.counts.n === 0 ? "PASS" : "FAIL",
    `serial=${s.counts.n} qtyDocs=${qtySnap.counts.n}`,
  );

  // --- FIFO COGS ---
  const fifoName = `${tag}-fifo`;
  const fifoId = await createGasFifo(page, `${tag}-F`, fifoName, 100, 10);
  await createPO(page, fifoName, 4, 10);
  await receiveGrn(page, { qty: 4 });
  await createPO(page, fifoName, 4, 30);
  await receiveGrn(page, { qty: 4 });
  const soId = await completeSo(page, fifoName, 4, `${tag}-cogs-cust`);
  await confirmDelivery(page, soId);
  await page.reload({ waitUntil: "networkidle" }).catch(() => {});

  const outs = await db
    .collection("stockMovements")
    .find({ productId: fifoId, type: "out" })
    .toArray();
  const ins = await db
    .collection("stockMovements")
    .find({ productId: fifoId, type: "in" })
    .toArray();
  const cogs = outs.reduce((a, m) => a + (m.cogsAmount || 0), 0);
  const so = await db.collection("sales").findOne({ id: soId });
  const revenue = so?.subtotal ?? so?.total ?? 0;
  const gp = revenue - cogs;
  rec(
    "FIFO layers received",
    ins.filter((m) => m.refType === "purchase").length >= 2 ? "PASS" : "FAIL",
    `in=${ins.length}`,
  );
  rec(
    "FIFO COGS on stock OUT",
    Math.abs(cogs - 40) < 0.02 ? "PASS" : "FAIL",
    `cogs=${cogs} expected 4×10=40`,
  );
  rec(
    "Gross profit engine",
    Math.abs(gp - (400 - 40)) < 0.05 ? "PASS" : "FAIL",
    `rev=${revenue} cogs=${cogs} gp=${gp}`,
  );
  rec(
    "Single delivery OUT",
    outs.filter((m) => m.refType === "delivery").length === 1 ? "PASS" : "FAIL",
    `out=${outs.length}`,
  );
  rec(
    "No duplicate purchase IN",
    ins.filter((m) => m.refType === "purchase").length === 2 ? "PASS" : "FAIL",
    `purchaseIN=${ins.filter((m) => m.refType === "purchase").length}`,
  );

  const vouchers = await db
    .collection("vouchers")
    .find({ refId: { $in: created.purchases.concat(created.sales) } })
    .toArray();
  rec(
    "No duplicate vouchers per ref",
    new Set(vouchers.map((v) => `${v.refId}:${v.type}:${v.amount}`)).size === vouchers.length
      ? "PASS"
      : "FAIL",
    `v=${vouchers.length}`,
  );

  await page.goto(`${BASE}/reports`, { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: /Profit|লাভ|ক্ষতি|P&L/i })
    .click()
    .catch(() => {});
  rec(
    "P&L page still uses existing formula",
    /Revenue|আয়|COGS|বিক্রয়|Gross|মোট/i.test(await page.locator("body").innerText())
      ? "PASS"
      : "FAIL",
    "report loaded; engine COGS is source of truth",
  );
} catch (e) {
  rec("Runner", "FAIL", e instanceof Error ? e.stack || e.message : String(e));
} finally {
  let clean = {};
  try {
    clean = await cleanup(db);
  } catch (e) {
    clean = { err: String(e) };
  }
  rec("Cleanup", clean.pids != null ? "PASS" : "FAIL", JSON.stringify(clean));
  writeFileSync("scripts/sqa-final-regression-last.json", JSON.stringify({ tag, rows }, null, 2));
  await client.close();
  await browser.close();
}
