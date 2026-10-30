import puppeteer from "puppeteer";

async function auditRenderedUi() {
  console.log("Launching Google Chrome to inspect http://localhost:8080/inventory...");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  console.log("Navigating to http://localhost:8080/inventory...");
  await page.goto("http://localhost:8080/inventory", { waitUntil: "networkidle0", timeout: 30000 });

  // Wait for table to render rows
  await page.waitForSelector("table tbody tr", { timeout: 15000 });

  // Extract Summary Cards
  const cards = await page.evaluate(() => {
    // Select the stat card text
    const cardNodes = document.querySelectorAll(".grid > button, .grid > div");
    const out = [];
    cardNodes.forEach((n) => {
      out.push(n.innerText?.replace(/\s+/g, " ").trim());
    });
    return out;
  });

  console.log("\n=== 1. RENDERED SUMMARY CARDS FROM BROWSER UI ===");
  cards.forEach((c, idx) => console.log(`Card ${idx + 1}: ${c}`));

  // Extract Table Rows
  const tableData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table tbody tr"));
    return rows.map((tr) => {
      const cells = Array.from(tr.querySelectorAll("td")).map((td) => td.innerText?.trim() || "");
      return {
        SL: cells[0] || "",
        Product: cells[1] || "",
        StockIn: cells[2] || "",
        StockOut: cells[3] || "",
        OnHand: cells[4] || "",
        UOM: cells[5] || "",
        Cost: cells[6] || "",
        TotalValue: cells[7] || "",
      };
    });
  });

  console.log("\n=== 2. RENDERED INVENTORY TABLE ROWS FROM BROWSER UI ===");
  console.table(tableData);

  // Take a full page screenshot as artifact evidence
  await page.screenshot({ path: "scripts/inventory-ui-screenshot.png", fullPage: true });
  console.log("\nScreenshot saved to scripts/inventory-ui-screenshot.png");

  await browser.close();
}

auditRenderedUi().catch(console.error);
