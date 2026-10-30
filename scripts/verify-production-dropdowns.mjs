import puppeteer from "puppeteer";

async function verifyProductionDropdowns() {
  console.log("Launching browser to verify LIVE production: https://insaf-corporation.vercel.app/purchases/new...");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    console.log("Navigating to production login page...");
    await page.goto("https://insaf-corporation.vercel.app/login", {
      waitUntil: "networkidle0",
      timeout: 60000,
    });

    if (page.url().includes("/login")) {
      console.log("Logging in as operator on production...");
      await page.waitForSelector("#username", { timeout: 20000 });
      await page.type("#username", "operator");
      await page.type("#password", "insaf123");
      await page.click("button[type='submit']");
      await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {});
    }

    console.log("Navigating to https://insaf-corporation.vercel.app/purchases/new...");
    await page.goto("https://insaf-corporation.vercel.app/purchases/new", {
      waitUntil: "networkidle0",
      timeout: 60000,
    });

    await page.waitForSelector("table", { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Ensure a row exists
    const hasRow = await page.evaluate(() => document.querySelectorAll("table tbody tr button[role='combobox']").length > 0);
    if (!hasRow) {
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll("button")).find(
          (b) => b.innerText.includes("Add Item") || b.innerText.includes("আইটেম যোগ"),
        );
        btn?.click();
      });
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log("\n--- PRODUCTION TEST 1: Select Type: Cylinder ---");
    const typeBtn = await page.evaluateHandle(() => {
      const rows = document.querySelectorAll("table tbody tr");
      return rows[0].querySelectorAll("button[role='combobox']")[1];
    });
    await typeBtn.click();
    await new Promise((r) => setTimeout(r, 600));

    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("[role='option']"));
      const cyl = items.find((el) => el.innerText.trim().toLowerCase() === "cylinder");
      if (cyl) cyl.click();
    });
    await new Promise((r) => setTimeout(r, 600));

    // Click Product combobox
    const prodBtn = await page.evaluateHandle(() => {
      const rows = document.querySelectorAll("table tbody tr");
      return rows[0].querySelectorAll("button[role='combobox']")[0];
    });
    await prodBtn.click();
    await new Promise((r) => setTimeout(r, 600));

    const cylinderOptions = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("[role='option']"));
      return items.map((el) => el.innerText.trim());
    });
    console.log(`Live Production Cylinder options (${cylinderOptions.length}):`, cylinderOptions);

    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("[role='option']"));
      const target = items.find((el) => el.innerText.includes("LPG Domestic 12kg")) || items[0];
      if (target) target.click();
    });
    await new Promise((r) => setTimeout(r, 600));

    console.log("\n--- PRODUCTION TEST 2: Select Type: Product ---");
    const typeBtn2 = await page.evaluateHandle(() => {
      const rows = document.querySelectorAll("table tbody tr");
      return rows[0].querySelectorAll("button[role='combobox']")[1];
    });
    await typeBtn2.click();
    await new Promise((r) => setTimeout(r, 600));

    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("[role='option']"));
      const p = items.find((el) => el.innerText.trim().toLowerCase() === "product");
      if (p) p.click();
    });
    await new Promise((r) => setTimeout(r, 600));

    const prodBtn2 = await page.evaluateHandle(() => {
      const rows = document.querySelectorAll("table tbody tr");
      return rows[0].querySelectorAll("button[role='combobox']")[0];
    });
    await prodBtn2.click();
    await new Promise((r) => setTimeout(r, 600));

    const productOptions = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("[role='option']"));
      return items.map((el) => el.innerText.trim());
    });
    console.log(`Live Production Product options (${productOptions.length}):`, productOptions);

    await page.screenshot({ path: "scripts/sqa-shots/prod-live-product-dropdown.png" });
    console.log("Screenshot saved to scripts/sqa-shots/prod-live-product-dropdown.png");

    console.log("\nPRODUCTION LIVE VERIFICATION COMPLETE!");
  } finally {
    await browser.close();
  }
}

verifyProductionDropdowns().catch((err) => {
  console.error("Production verification failed:", err);
  process.exit(1);
});
