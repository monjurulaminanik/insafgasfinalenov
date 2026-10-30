import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const ARTIFACT_DIR = "C:/Users/shahi/.gemini/antigravity-ide/brain/e29a367f-e219-4eea-afc3-995381a8ab9a";

async function runDashboardAudit() {
  console.log("Launching headless Chrome to audit Dashboard Financial Analytics...");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1024 });

  console.log("Navigating to http://localhost:8080/ ...");
  await page.goto("http://localhost:8080/", { waitUntil: "networkidle2", timeout: 30000 });

  // Handle login if redirected to login page
  const url = page.url();
  console.log("Current URL:", url);
  if (url.includes("/login")) {
    console.log("On login page, submitting credentials for operator...");
    await page.waitForSelector("#username", { timeout: 10000 });
    await page.type("#username", "operator");
    await page.type("#password", "insaf123");
    await page.click('button[type="submit"]');
    console.log("Submitted login form, waiting for gate animation and redirect...");
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 4000));
  }

  // Wait for dashboard elements
  await page.waitForSelector('[data-testid="revenue-overview-chart"]', { timeout: 15000 });
  console.log("Dashboard and Revenue Overview Chart rendered successfully!");

  // Wait an extra second for React Query cache & GSAP animations
  await new Promise((r) => setTimeout(r, 2500));

  // 1. EXTRACT FINANCIAL SUMMARY CARDS
  const financialCards = await page.evaluate(() => {
    const ids = [
      "financial-card-sales",
      "financial-card-purchases",
      "financial-card-expenses",
      "financial-card-profit",
    ];
    return ids.map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return { id, missing: true };
      const title = el.querySelector("p:nth-child(1)")?.innerText?.trim();
      const value = el.querySelector("p:nth-child(2)")?.innerText?.trim();
      const subtitle = el.querySelector("p:nth-child(3)")?.innerText?.trim();
      const badge = el.querySelector("span:last-child")?.innerText?.trim();
      return { id, title, value, subtitle, badge };
    });
  });

  console.log("\n=======================================================");
  console.log("1. FOUR FINANCIAL SUMMARY CARDS (DEFAULT RANGE):");
  console.log("=======================================================");
  console.table(financialCards);

  // 2. EXTRACT REVENUE OVERVIEW CHART DETAILS
  const chartDetails = await page.evaluate(() => {
    const chartEl = document.querySelector('[data-testid="revenue-overview-chart"]');
    if (!chartEl) return null;
    const title = chartEl.querySelector("h3")?.innerText?.trim();
    const desc = chartEl.querySelector("p")?.innerText?.trim();
    const legendItems = Array.from(chartEl.querySelectorAll("span.font-medium")).map((s) =>
      s.innerText?.trim(),
    );
    const xAxisTicks = Array.from(chartEl.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick")).map((t) =>
      t.textContent?.trim(),
    );
    const areas = Array.from(chartEl.querySelectorAll(".recharts-area")).length;
    return { title, desc, legendItems, xAxisTicks, areaCount: areas };
  });

  console.log("\n=======================================================");
  console.log("2. REVENUE OVERVIEW CHART:");
  console.log("=======================================================");
  console.log(chartDetails);

  // 3. EXTRACT CYLINDER DASHBOARD METRICS (REGRESSION TEST)
  const cylinderCards = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".grid.grid-cols-2.gap-3 a"));
    return cards.map((a) => {
      const pTags = a.querySelectorAll("p");
      return {
        title: pTags[0]?.innerText?.trim(),
        value: pTags[1]?.innerText?.trim(),
        hint: pTags[2]?.innerText?.trim() || "",
      };
    });
  });

  console.log("\n=======================================================");
  console.log("3. PRESERVED CYLINDER DASHBOARD CARDS (REGRESSION TEST):");
  console.log("=======================================================");
  console.table(cylinderCards);

  // 4. TEST DATE RANGE FILTER TOGGLING
  console.log("\n=======================================================");
  console.log("4. TESTING DATE RANGE FILTER TOGGLING:");
  console.log("=======================================================");
  const filterButtons = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".rounded-xl.border.bg-card\\/60 button"));
    return btns.map((b) => b.innerText?.trim());
  });
  console.log("Available filter buttons:", filterButtons);

  // Click "This month"
  console.log("Clicking 'This month' filter...");
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".rounded-xl.border.bg-card\\/60 button"));
    const btn = btns.find((b) => b.innerText?.toLowerCase().includes("month") || b.innerText?.toLowerCase().includes("মাস"));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 1500));

  const thisMonthCards = await page.evaluate(() => {
    const ids = [
      "financial-card-sales",
      "financial-card-purchases",
      "financial-card-expenses",
      "financial-card-profit",
    ];
    return ids.map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return {
        id,
        value: el?.querySelector("p:nth-child(2)")?.innerText?.trim(),
        subtitle: el?.querySelector("p:nth-child(3)")?.innerText?.trim(),
      };
    });
  });
  console.log("Cards with 'This month' filter:");
  console.table(thisMonthCards);

  // Click "All" filter to restore
  console.log("Restoring 'All' filter...");
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".rounded-xl.border.bg-card\\/60 button"));
    const btn = btns.find((b) => b.innerText?.toLowerCase().includes("all") || b.innerText?.toLowerCase().includes("সকল"));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 1500));

  // 5. TAKE SCREENSHOTS
  const desktopScreenshotPath = path.join(ARTIFACT_DIR, "dashboard-financials-desktop.png");
  await page.screenshot({ path: desktopScreenshotPath, fullPage: true });
  console.log(`Desktop full-page screenshot saved to: ${desktopScreenshotPath}`);

  // Mobile viewport
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await new Promise((r) => setTimeout(r, 1000));
  const mobileScreenshotPath = path.join(ARTIFACT_DIR, "dashboard-financials-mobile.png");
  await page.screenshot({ path: mobileScreenshotPath, fullPage: true });
  console.log(`Mobile full-page screenshot saved to: ${mobileScreenshotPath}`);

  await browser.close();
  console.log("Audit complete!");
}

runDashboardAudit().catch((err) => {
  console.error("Audit error:", err);
  process.exit(1);
});
