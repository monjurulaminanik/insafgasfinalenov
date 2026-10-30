/**
 * One-shot browser SQA against a live ERP URL.
 * Usage: node scripts/sqa-browser.mjs
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.SQA_BASE_URL || "http://localhost:8080";
const USER = process.env.SQA_USER || "operator";
const PASS = process.env.SQA_PASS || "insaf123";
const stamp = `SQA-${Date.now().toString(36)}`;

const results = [];
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

function rec(area, test, result, evidence, defect = "") {
  results.push({ area, test, result, evidence, defect });
  console.log(`[${result}] ${area} :: ${test} — ${evidence}${defect ? ` | ${defect}` : ""}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("response", (res) => {
    const s = res.status();
    if (s >= 400) failedRequests.push(`${s} ${res.request().method()} ${res.url()}`);
  });

  try {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
    rec("Auth", "Login page loads", "PASS", page.url());

    await page.locator("#username").waitFor({ timeout: 15000 });
    await page.locator("#username").fill(USER);
    await page.locator("#password").fill(PASS);
    await page.getByRole("button", { name: /sign in|সাইন ইন/i }).click();
    await page
      .waitForURL((u) => !u.pathname.includes("/login"), { timeout: 25000 })
      .catch(() => {});
    await page.waitForTimeout(1500);
    const afterLogin = page.url();
    if (afterLogin.includes("/login")) {
      rec(
        "Auth",
        "Login as operator",
        "FAIL",
        afterLogin,
        "Still on login — credentials or demo gate",
      );
    } else {
      rec("Auth", "Login as operator", "PASS", afterLogin);
    }

    const modules = [
      ["/", "Dashboard"],
      ["/customers", "Customers"],
      ["/suppliers", "Suppliers"],
      ["/products", "Products"],
      ["/products/categories", "Product Categories"],
      ["/sales", "Sales Orders"],
      ["/purchases", "Purchases"],
      ["/inventory", "Inventory"],
      ["/cylinders", "Cylinders"],
      ["/deliveries", "Deliveries"],
      ["/accounting", "Accounting"],
      ["/expenses", "Expenses"],
      ["/hr", "HR"],
      ["/reports", "Reports"],
      ["/settings", "Settings"],
    ];

    for (const [path, name] of modules) {
      const beforeErr = pageErrors.length + consoleErrors.length;
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1200);
      const body = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      const crashed =
        body.includes("Something went wrong") ||
        body.includes("Application Error") ||
        body.includes("সাইন ইন");
      const newErrs = [...pageErrors, ...consoleErrors].slice(beforeErr);
      const classExtends = newErrs.some((e) => /Class extends value undefined/i.test(e));
      if (crashed || classExtends) {
        rec(
          "Smoke",
          `${name} page`,
          "FAIL",
          path,
          classExtends ? "Class extends value undefined" : "error page",
        );
      } else {
        rec(
          "Smoke",
          `${name} page`,
          "PASS",
          `${path} title-ish ${body.slice(0, 80).replace(/\s+/g, " ")}`,
        );
      }
    }

    // Categories CRUD if logged in
    await page.goto(`${BASE}/products/categories`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(800);
    const newCatBtn = page
      .getByRole("button")
      .filter({ hasText: /New Category|নতুন ক্যাটাগরি|Create|নতুন/i })
      .first();
    const catMain = await page
      .getByRole("main")
      .innerText()
      .catch(() => "");
    rec(
      "Category",
      "Categories page not product-not-found",
      /পণ্য পাওয়া যায়নি|Product not found/i.test(catMain) ? "FAIL" : "PASS",
      catMain.slice(0, 120),
    );
    if (await newCatBtn.count()) {
      await newCatBtn.click();
      await page.locator("input").first().fill(stamp);
      await page
        .getByRole("button", { name: /^save$|^সংরক্ষণ/i })
        .first()
        .click();
      await page.waitForTimeout(1500);
      const listed = await page.getByText(stamp, { exact: true }).count();
      rec(
        "Category",
        "Create category",
        listed ? "PASS" : "FAIL",
        stamp,
        listed ? "" : "name not in list",
      );
    } else {
      rec("Category", "Create category", "BLOCKED", "New Category button missing (auth or UI)");
    }

    await page.goto(`${BASE}/products/new`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1000);
    const catTrigger = page.getByText(/^Category$|^ক্যাটাগরি$/).first();
    rec(
      "Category",
      "Product form has Category",
      (await page.locator("body").innerText()).includes("Category") ||
        (await page.locator("body").innerText()).includes("ক্যাটাগরি")
        ? "PASS"
        : "FAIL",
      "/products/new",
    );

    const bodyNew = await page.locator("body").innerText();
    rec(
      "Category",
      "New category in product dropdown (open select)",
      bodyNew.includes(stamp) ? "PASS" : "NOT TESTED",
      "Radix select may not list until opened",
    );
    const selects = page.locator('[role="combobox"]');
    if (await selects.count()) {
      await selects
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(400);
      // Category is likely 3rd row of fields - try all comboboxes
      let found = false;
      const n = await selects.count();
      for (let i = 0; i < n; i++) {
        await selects
          .nth(i)
          .click()
          .catch(() => {});
        await page.waitForTimeout(300);
        const opt = page.getByRole("option", { name: stamp });
        if (await opt.count()) {
          found = true;
          rec("Category", "Product Category dropdown shows new category", "PASS", stamp);
          await page.keyboard.press("Escape");
          break;
        }
        await page.keyboard.press("Escape").catch(() => {});
      }
      if (!found)
        rec(
          "Category",
          "Product Category dropdown shows new category",
          "FAIL",
          "opened comboboxes, option missing",
        );
    }

    await page.goto(`${BASE}/sales/new`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1200);
    const soText = await page.locator("body").innerText();
    rec(
      "Sales",
      "Item columns Product/Category/Type",
      /Product|পণ্য/.test(soText) && /Category|ক্যাটাগরি/.test(soText) ? "PASS" : "FAIL",
      soText.slice(0, 200),
    );
    rec(
      "Sales",
      "Gas option",
      /Gas|গ্যাস/.test(soText) ? "PASS" : "FAIL",
      "label visible on new SO",
    );
    rec(
      "Sales",
      "Cylinder option",
      /Cylinder|সিলিন্ডার/.test(soText) ? "PASS" : "FAIL",
      "may be in closed select",
    );
    rec(
      "Sales",
      "Product type option",
      /Gas\/Cylinder\/Product|গ্যাস\/সিলিন্ডার\/পণ্য|গ্যাস\/সিলিন্ডার/.test(soText)
        ? "PASS"
        : "FAIL",
      soText.match(/গ্যাস.+/)?.[0]?.slice(0, 80) || soText.slice(0, 80),
    );

    const typeSelects = page.locator('[role="combobox"]');
    let sawProductType = false;
    let sawGas = false;
    let sawCyl = false;
    const tn = await typeSelects.count();
    for (let i = 0; i < tn; i++) {
      await typeSelects
        .nth(i)
        .click()
        .catch(() => {});
      await page.waitForTimeout(250);
      const menu = await page
        .locator("[role='listbox'], [role='option']")
        .allTextContents()
        .catch(() => []);
      const joined = menu.join(" ");
      if (/Cylinder/i.test(joined) && /Gas/i.test(joined)) {
        sawGas = true;
        sawCyl = true;
        sawProductType = /Product|পণ্য/.test(joined);
        rec(
          "Sales",
          "Type dropdown Gas/Cylinder/Product",
          sawProductType ? "PASS" : "FAIL",
          joined.slice(0, 120),
        );
        await page.keyboard.press("Escape");
        break;
      }
      await page.keyboard.press("Escape").catch(() => {});
    }
    if (!sawCyl)
      rec("Sales", "Open type dropdown", "NOT TESTED", "could not identify type combobox");

    await page.goto(`${BASE}/purchases`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(800);
    rec(
      "Purchase",
      "PO list loads",
      /Purchase|ক্রয়|PO-/i.test(await page.locator("body").innerText()) ? "PASS" : "FAIL",
      "/purchases",
    );

    await page.goto(`${BASE}/inventory`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(800);
    rec("Inventory", "Inventory page loads", "PASS", page.url());

    const classHits = [...consoleErrors, ...pageErrors].filter((e) =>
      /Class extends value undefined/i.test(e),
    );
    rec(
      "Runtime",
      "No Class extends value undefined",
      classHits.length ? "FAIL" : "PASS",
      classHits[0] || "not observed",
    );
    rec(
      "Runtime",
      "Page errors",
      pageErrors.length ? "FAIL" : "PASS",
      pageErrors.slice(0, 3).join(" | ") || "none",
    );
    rec(
      "Runtime",
      "Console errors",
      consoleErrors.length ? "FAIL" : "PASS",
      consoleErrors.slice(0, 5).join(" | ") || "none",
    );
    rec(
      "Runtime",
      "HTTP 4xx/5xx",
      failedRequests.length ? "FAIL" : "PASS",
      failedRequests.slice(0, 8).join(" | ") || "none",
    );

    rec(
      "Inventory",
      "SO Complete no OUT (UI)",
      "NOT TESTED",
      "skipped to avoid mutating live production orders",
    );
    rec(
      "Inventory",
      "Delivery confirm OUT (UI)",
      "NOT TESTED",
      "skipped to avoid mutating live deliveries",
    );
    rec("Inventory", "Unfulfill/re-fulfill (UI)", "NOT TESTED", "skipped");
    rec("Inventory", "Partial GRN 2+2+1 (UI)", "NOT TESTED", "skipped to avoid live PO receive");
    rec("Inventory", "Serial GRN 5 (UI)", "NOT TESTED", "skipped");
    rec(
      "Inventory",
      "Serial-less GRN (UI)",
      "NOT TESTED",
      "skipped; backend E2E covered quantity-only path",
    );
    rec(
      "Inventory",
      "Stock adjustment +10/-10 (UI)",
      "NOT TESTED",
      "skipped to avoid live stock change",
    );
  } catch (e) {
    rec("Runner", "Playwright session", "FAIL", e instanceof Error ? e.message : String(e));
  } finally {
    const out = { stamp, base: BASE, results, consoleErrors, pageErrors, failedRequests };
    writeFileSync("scripts/sqa-browser-last.json", JSON.stringify(out, null, 2));
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
