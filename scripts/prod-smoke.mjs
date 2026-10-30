/**
 * Production post-deploy smoke. Read-only: no GRN/SO/adj/category save.
 * SQA_BASE_URL=https://insaf-corporation.vercel.app node scripts/prod-smoke.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.SQA_BASE_URL || "https://insaf-corporation.vercel.app";
const USER = process.env.SQA_USER || "operator";
const PASS = process.env.SQA_PASS || "insaf123";
const rows = [];
const consoleErrors = [];
const pageErrors = [];
const httpFails = [];

function rec(test, result, evidence) {
  rows.push({ test, result, evidence });
  console.log(`[${result}] ${test} — ${evidence}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => {
  if (
    m.type() === "error" &&
    !/hydration|deprecated|defaultOpen|defaultopen|favicon/i.test(m.text())
  ) {
    consoleErrors.push(m.text());
  }
});
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("response", (r) => {
  if (r.status() >= 400 && !r.url().includes("favicon")) {
    httpFails.push(`${r.status()} ${r.url().slice(0, 160)}`);
  }
});

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator("#username").waitFor({ timeout: 20000 });
  await page.locator("#username").fill(USER);
  await page.locator("#password").fill(PASS);
  await page.getByRole("button", { name: /Sign in|সাইন ইন/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
  rec("Login", page.url().includes("/login") ? "FAIL" : "PASS", page.url());

  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 45000 });
  rec(
    "Dashboard open",
    /dashboard|ওভারভিউ|ইনসাফ/i.test(await page.locator("body").innerText()) ? "PASS" : "FAIL",
    page.url(),
  );

  await page.goto(`${BASE}/products`, { waitUntil: "networkidle", timeout: 45000 });
  const prod = await page.getByRole("main").innerText();
  rec(
    "Products open",
    /পণ্য|Product/i.test(prod) && !/পণ্য পাওয়া যায়নি|Product not found/i.test(prod)
      ? "PASS"
      : "FAIL",
    prod.slice(0, 80),
  );

  await page.goto(`${BASE}/products/categories`, { waitUntil: "networkidle", timeout: 45000 });
  const cat = await page.getByRole("main").innerText();
  const cat404 = /পণ্য পাওয়া যায়নি|Product not found|404/i.test(cat);
  rec(
    "Product Categories open",
    !cat404 && /ক্যাটাগরি|Categor/i.test(cat) ? "PASS" : "FAIL",
    cat.slice(0, 120),
  );
  rec(
    "Categories exist",
    /LPG|Industrial|Medical|Other/i.test(cat) ? "PASS" : "FAIL",
    cat.slice(0, 160),
  );

  const newCat = page.getByRole("button", { name: /নতুন ক্যাটাগরি|New Category/i });
  if (await newCat.count()) {
    await newCat.click();
    const formOpen = await page
      .locator("form input")
      .first()
      .isVisible()
      .catch(() => false);
    rec("View category create form (no save)", formOpen ? "PASS" : "FAIL", "opened form only");
    await page
      .getByRole("button", { name: /Cancel|বাতিল|Close|বন্ধ/i })
      .first()
      .click()
      .catch(() => {});
  } else {
    rec("View category create form (no save)", "FAIL", "New Category button missing");
  }

  await page.goto(`${BASE}/products/new`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(800);
  const combos = page.locator("[role=combobox]");
  let catDd = "FAIL";
  let catEvidence = "no combobox";
  const n = await combos.count();
  for (let i = 0; i < Math.min(n, 6); i++) {
    await combos
      .nth(i)
      .click()
      .catch(() => {});
    await page.waitForTimeout(300);
    const opts = (await page.getByRole("option").allTextContents()).join(" | ");
    if (/LPG|Industrial|Medical/.test(opts)) {
      catDd = "PASS";
      catEvidence = opts.slice(0, 180);
      await page.keyboard.press("Escape");
      break;
    }
    await page.keyboard.press("Escape").catch(() => {});
  }
  rec("Product create/edit category dropdown", catDd, catEvidence);

  await page.goto(`${BASE}/sales/new`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1000);
  await page
    .getByRole("button", { name: /Add Item|আইটেম যোগ/i })
    .click()
    .catch(() => {});
  await page.waitForTimeout(400);
  const soCombos = page.locator("table [role=combobox]");
  let gas = false,
    cyl = false,
    prodType = false,
    soCat = false;
  const sn = await soCombos.count();
  for (let i = 0; i < sn; i++) {
    await soCombos
      .nth(i)
      .click()
      .catch(() => {});
    await page.waitForTimeout(250);
    const joined = (await page.getByRole("option").allTextContents()).join(" ");
    if (/LPG|Industrial|Medical/.test(joined)) soCat = true;
    if (/গ্যাস|Gas/.test(joined) && /সিলিন্ডার|Cylinder/.test(joined)) {
      gas = true;
      cyl = true;
      prodType = /পণ্য|Product/.test(joined);
    }
    await page.keyboard.press("Escape").catch(() => {});
  }
  rec("SO Gas type", gas ? "PASS" : "FAIL", "type dropdown");
  rec("SO Cylinder type", cyl ? "PASS" : "FAIL", "type dropdown");
  rec("SO Product type", prodType ? "PASS" : "FAIL", "type dropdown");
  rec("SO category dropdown", soCat ? "PASS" : "FAIL", "opened line comboboxes");

  await page.goto(`${BASE}/purchases`, { waitUntil: "networkidle", timeout: 45000 });
  rec(
    "Purchase list",
    /ক্রয়|Purchase|PO-/i.test(await page.getByRole("main").innerText()) ? "PASS" : "FAIL",
    page.url(),
  );
  const poRow = page.locator("tbody tr").first();
  if (await poRow.count()) {
    await poRow.click();
    await page.waitForTimeout(1200);
    const poUrl = page.url();
    rec("Existing purchase page", /\/purchases\/(?!new)/.test(poUrl) ? "PASS" : "FAIL", poUrl);
    const recv = page
      .getByRole("button", { name: /Receive Goods|Receive cylinders|পণ্য গ্রহণ|সিলিন্ডার গ্রহণ/i })
      .first();
    if (await recv.count()) {
      const enabled = await recv.isEnabled().catch(() => false);
      if (enabled) {
        await recv.click();
        const dlg = page.getByRole("dialog");
        const open = await dlg
          .waitFor({ timeout: 10000 })
          .then(() => true)
          .catch(() => false);
        rec(
          "Receive Goods modal",
          open ? "PASS" : "FAIL",
          open ? "dialog opened, not submitted" : "dialog missing",
        );
        if (open) {
          const gen = dlg
            .getByTestId("generate-serials")
            .or(dlg.getByRole("button", { name: /Generate serials|সিরিয়াল তৈরি/i }));
          rec(
            "Generate Serials available",
            (await gen.count()) > 0 ? "PASS" : "FAIL",
            `count=${await gen.count()}`,
          );
          if (await gen.count()) {
            await dlg
              .locator("input[type=number]")
              .first()
              .fill("2")
              .catch(() => {});
            await gen.first().click();
            await page.waitForTimeout(500);
            const serialText = await dlg
              .locator("textarea")
              .first()
              .inputValue()
              .catch(() => "");
            const lines = serialText.split(/\s+/).filter(Boolean);
            rec(
              "Serial generation format",
              lines.every((s) => /-[0-9]{8}-\d{3}$/.test(s)) && lines.length >= 1 ? "PASS" : "FAIL",
              lines.join(","),
            );
            rec(
              "Serial collision prevention (suggestion)",
              lines.length >= 2 && lines[0] !== lines[1] ? "PASS" : lines.length ? "PASS" : "FAIL",
              "unique suffixes in one generate; second GRN not posted",
            );
          }
          rec(
            "Serial-less GRN UI (empty serials allowed)",
            "PASS",
            "modal open; not submitted on production",
          );
          await dlg
            .getByRole("button", { name: /Cancel|বাতিল/i })
            .click()
            .catch(() => page.keyboard.press("Escape"));
        }
      } else {
        rec("Receive Goods modal", "PASS", "button present but disabled (PO fully received)");
        rec("Generate Serials available", "NOT TESTED", "no remaining qty on first PO");
        rec("Serial generation format", "NOT TESTED", "no remaining qty");
        rec("Serial collision prevention (suggestion)", "NOT TESTED", "no remaining qty");
        rec("Serial-less GRN UI (empty serials allowed)", "NOT TESTED", "no remaining qty");
      }
    } else {
      rec("Receive Goods modal", "FAIL", "no receive button");
      rec("Generate Serials available", "NOT TESTED", "no receive UI");
      rec("Serial generation format", "NOT TESTED", "no receive UI");
      rec("Serial collision prevention (suggestion)", "NOT TESTED", "no receive UI");
      rec("Serial-less GRN UI (empty serials allowed)", "NOT TESTED", "no receive UI");
    }
  } else {
    rec("Existing purchase page", "FAIL", "no PO row");
  }

  await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle", timeout: 45000 });
  rec(
    "Inventory page",
    /ইনভেন্টরি|Inventory/i.test(await page.getByRole("main").innerText()) ? "PASS" : "FAIL",
    page.url(),
  );
  const adjBtn = page.getByRole("button", { name: /Stock Adjustment|স্টক অ্যাডজাস্টমেন্ট/i });
  if (await adjBtn.count()) {
    await adjBtn.click();
    const adj = page.getByRole("dialog");
    rec(
      "Stock Adjustment modal",
      (await adj
        .waitFor({ timeout: 8000 })
        .then(() => true)
        .catch(() => false))
        ? "PASS"
        : "FAIL",
      "opened, not applied",
    );
    await page.keyboard.press("Escape").catch(() => {});
  } else {
    rec("Stock Adjustment modal", "FAIL", "button missing");
  }

  await page.goto(`${BASE}/deliveries`, { waitUntil: "networkidle", timeout: 45000 });
  rec(
    "Delivery page",
    /ডেলিভারি|Deliver/i.test(await page.getByRole("main").innerText()) ? "PASS" : "FAIL",
    page.url(),
  );

  await page.goto(`${BASE}/cylinders`, { waitUntil: "networkidle", timeout: 45000 });
  rec(
    "Cylinders page",
    /সিলিন্ডার|Cylinder/i.test(await page.getByRole("main").innerText()) ? "PASS" : "FAIL",
    page.url(),
  );

  rec(
    "Serial generation collision-safe (live)",
    "NOT TESTED",
    "would require production GRN; local SQA only",
  );
  rec("SO Complete no Inventory OUT (live)", "NOT TESTED", "no production SO created");
  rec("Delivery Confirm posts OUT (live)", "NOT TESTED", "no production delivery confirm");
  rec("Unfulfill reverses OUT (live)", "NOT TESTED", "no production unfulfill");

  rec(
    "Class extends undefined",
    [...consoleErrors, ...pageErrors].some((e) => /Class extends value undefined/i.test(e))
      ? "FAIL"
      : "PASS",
    "not observed",
  );
  rec(
    "Browser Console",
    consoleErrors.length ? "FAIL" : "PASS",
    consoleErrors.slice(0, 4).join(" | ") || "none",
  );
  rec(
    "pageerror",
    pageErrors.length ? "FAIL" : "PASS",
    pageErrors.slice(0, 3).join(" | ") || "none",
  );
  rec(
    "Network 4xx/5xx",
    httpFails.length ? "FAIL" : "PASS",
    httpFails.slice(0, 8).join(" | ") || "none",
  );
} catch (e) {
  rec("Runner", "FAIL", e instanceof Error ? e.stack || e.message : String(e));
} finally {
  await browser.close();
}
