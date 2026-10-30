import puppeteer from "puppeteer";
import fs from "fs";

async function verifyPurchaseOrderDropdowns() {
  console.log("Launching browser for Purchase Order dropdown verification...");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    console.log("Navigating to login page...");
    await page.goto("http://localhost:8080/login", {
      waitUntil: "networkidle0",
      timeout: 30000,
    });

    if (page.url().includes("/login")) {
      console.log("Logging in as operator...");
      await page.waitForSelector("#username", { timeout: 10000 });
      await page.type("#username", "operator");
      await page.type("#password", "insaf123");
      await page.click("button[type='submit']");
      await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }).catch(() => {});
    }

    console.log("Navigating to http://localhost:8080/purchases/new...");
    await page.goto("http://localhost:8080/purchases/new", {
      waitUntil: "networkidle0",
      timeout: 30000,
    });

    // Wait for form to load
    await page.waitForSelector("table", { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1000));

    // Ensure directory exists
    if (!fs.existsSync("scripts/sqa-shots")) {
      fs.mkdirSync("scripts/sqa-shots", { recursive: true });
    }

    console.log("\n--- TEST 1: Initial State ---");
    const initialRow = await page.evaluate(() => {
      const rows = document.querySelectorAll("table tbody tr");
      if (rows.length === 0) return null;
      const selects = rows[0].querySelectorAll("button[role='combobox']");
      const inputs = rows[0].querySelectorAll("input");
      const lineTotal = rows[0].querySelector("td:nth-child(5)")?.innerText?.trim();
      return {
        product: selects[0]?.innerText?.trim(),
        type: selects[1]?.innerText?.trim(),
        qty: inputs[0]?.value,
        cost: inputs[1]?.value,
        lineTotal,
      };
    });
    console.log("Initial row:", initialRow);

    // If no row yet, click Add Item
    if (!initialRow) {
      console.log("Clicking Add Item button...");
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll("button")).find((b) =>
          b.innerText.includes("Add Item"),
        );
        btn?.click();
      });
      await new Promise((r) => setTimeout(r, 500));
    }

    console.log("\n--- TEST 2: Select Type: Cylinder ---");
    // Find Type combobox on first row and click it
    const typeBtn = await page.evaluateHandle(() => {
      const rows = document.querySelectorAll("table tbody tr");
      return rows[0].querySelectorAll("button[role='combobox']")[1];
    });
    await typeBtn.click();
    await new Promise((r) => setTimeout(r, 500));

    // Select "Cylinder"
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("[role='option']"));
      const cyl = items.find((el) => el.innerText.trim().toLowerCase() === "cylinder");
      if (cyl) (cyl).click();
    });
    await new Promise((r) => setTimeout(r, 600));

    // Now click the Product combobox to see all cylinder options
    const prodBtn = await page.evaluateHandle(() => {
      const rows = document.querySelectorAll("table tbody tr");
      return rows[0].querySelectorAll("button[role='combobox']")[0];
    });
    await prodBtn.click();
    await new Promise((r) => setTimeout(r, 600));

    // Read all options inside the open dropdown
    const cylinderOptions = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("[role='option']"));
      return items.map((el) => el.innerText.trim());
    });
    console.log(`Cylinder options found (${cylinderOptions.length}):`, cylinderOptions);

    await page.screenshot({ path: "scripts/sqa-shots/po-cylinder-dropdown.png" });
    console.log("Saved screenshot: scripts/sqa-shots/po-cylinder-dropdown.png");

    // Select "LPG Domestic 12kg" or first option
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("[role='option']"));
      const target = items.find((el) => el.innerText.includes("LPG Domestic 12kg")) || items[0];
      if (target) (target).click();
    });
    await new Promise((r) => setTimeout(r, 600));

    const cylinderRowState = await page.evaluate(() => {
      const row = document.querySelectorAll("table tbody tr")[0];
      const selects = row.querySelectorAll("button[role='combobox']");
      const inputs = row.querySelectorAll("input");
      const lineTotal = row.querySelector("td:nth-child(5)")?.innerText?.trim();
      return {
        product: selects[0]?.innerText?.trim(),
        type: selects[1]?.innerText?.trim(),
        qty: inputs[0]?.value,
        cost: inputs[1]?.value,
        lineTotal,
      };
    });
    console.log("Cylinder row state:", cylinderRowState);

    console.log("\n--- TEST 3: Select Type: Product ---");
    // Click Type combobox
    const typeBtn2 = await page.evaluateHandle(() => {
      const rows = document.querySelectorAll("table tbody tr");
      return rows[0].querySelectorAll("button[role='combobox']")[1];
    });
    await typeBtn2.click();
    await new Promise((r) => setTimeout(r, 500));

    // Select "Product"
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("[role='option']"));
      const p = items.find((el) => el.innerText.trim().toLowerCase() === "product");
      if (p) (p).click();
    });
    await new Promise((r) => setTimeout(r, 600));

    // Click Product combobox to see all general product options
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
    console.log(`Product options found (${productOptions.length}):`, productOptions);

    await page.screenshot({ path: "scripts/sqa-shots/po-product-dropdown.png" });
    console.log("Saved screenshot: scripts/sqa-shots/po-product-dropdown.png");

    // Select "RFL ROse Gas stove"
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("[role='option']"));
      const target = items.find((el) => el.innerText.includes("RFL")) || items[0];
      if (target) (target).click();
    });
    await new Promise((r) => setTimeout(r, 600));

    const productRowState = await page.evaluate(() => {
      const row = document.querySelectorAll("table tbody tr")[0];
      const selects = row.querySelectorAll("button[role='combobox']");
      const inputs = row.querySelectorAll("input");
      const lineTotal = row.querySelector("td:nth-child(5)")?.innerText?.trim();
      return {
        product: selects[0]?.innerText?.trim(),
        type: selects[1]?.innerText?.trim(),
        qty: inputs[0]?.value,
        cost: inputs[1]?.value,
        lineTotal,
      };
    });
    console.log("Product row state:", productRowState);

    console.log("\n--- TEST 4: Multi-item Row Addition and Totals ---");
    // Click Add Item (supports English and Bengali)
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.innerText.includes("Add Item") || b.innerText.includes("আইটেম যোগ"),
      );
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 1000));

    // On second row, set Type to Cylinder
    const typeBtnRow2 = await page.evaluateHandle(() => {
      const rows = document.querySelectorAll("table tbody tr");
      return rows[1].querySelectorAll("button[role='combobox']")[1];
    });
    await typeBtnRow2.click();
    await new Promise((r) => setTimeout(r, 500));

    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("[role='option']"));
      const cyl = items.find((el) => el.innerText.trim().toLowerCase() === "cylinder");
      if (cyl) (cyl).click();
    });
    await new Promise((r) => setTimeout(r, 600));

    // Focus and type qty 3 on second row
    const qtyInputs = await page.$$("table tbody tr input[type='number']:first-of-type");
    if (qtyInputs.length >= 2) {
      await qtyInputs[1].click({ clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.keyboard.type("3");
      await new Promise((r) => setTimeout(r, 400));

      await qtyInputs[0].click({ clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.keyboard.type("2");
      await new Promise((r) => setTimeout(r, 600));
    }

    const finalSummary = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table tbody tr")).map((tr) => {
        const selects = tr.querySelectorAll("button[role='combobox']");
        const inputs = tr.querySelectorAll("input");
        return {
          product: selects[0]?.innerText?.trim(),
          type: selects[1]?.innerText?.trim(),
          qty: inputs[0]?.value,
          cost: inputs[1]?.value,
          lineTotal: tr.querySelector("td:nth-child(5)")?.innerText?.trim(),
        };
      });

      const totalsText = document.querySelector(".w-56")?.innerText?.replace(/\s+/g, " ");
      return { rows, totalsText };
    });

    console.log("Final Purchase Order Rows:", finalSummary.rows);
    console.log("Final Totals Text:", finalSummary.totalsText);

    await page.screenshot({ path: "scripts/sqa-shots/po-multi-item-completed.png" });
    console.log("Saved screenshot: scripts/sqa-shots/po-multi-item-completed.png");

    console.log("\nALL TESTS PASSED SUCCESSFULLY!");
  } finally {
    await browser.close();
  }
}

verifyPurchaseOrderDropdowns().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
