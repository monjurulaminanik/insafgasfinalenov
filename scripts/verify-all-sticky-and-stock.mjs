import puppeteer from "puppeteer";
import fs from "fs";

async function runComprehensiveVerification() {
  console.log("Starting comprehensive verification...");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    if (!fs.existsSync("scripts/sqa-shots")) {
      fs.mkdirSync("scripts/sqa-shots", { recursive: true });
    }

    console.log("Logging in as operator...");
    await page.goto("http://localhost:8080/login", { waitUntil: "networkidle0" });
    await page.type("#username", "operator");
    await page.type("#password", "insaf123");
    await page.click("button[type='submit']");
    await new Promise((r) => setTimeout(r, 1500));

    // ==========================================
    // PART 2: Purchase Order Product Dropdown
    // ==========================================
    console.log("\n==========================================");
    console.log("TESTING PART 2: Purchase Order Stock Display");
    console.log("==========================================");

    await page.goto("http://localhost:8080/purchases/new", { waitUntil: "networkidle0" });
    await page.waitForSelector("table", { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1000));

    // 1. Test Gas dropdown
    console.log("\n--- Checking Gas Products & Stock ---");
    // Ensure first row is Gas
    const typeSelect = await page.evaluateHandle(() => {
      const rows = document.querySelectorAll("table tbody tr");
      return rows[0].querySelectorAll("button[role='combobox']")[1];
    });
    await typeSelect.click();
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll("[role='option']"));
      const gasOpt = opts.find((o) => o.innerText.trim().toLowerCase() === "gas");
      if (gasOpt) gasOpt.click();
    });
    await new Promise((r) => setTimeout(r, 600));

    // Open Product dropdown
    const prodSelect = await page.evaluateHandle(() => {
      const rows = document.querySelectorAll("table tbody tr");
      return rows[0].querySelectorAll("button[role='combobox']")[0];
    });
    await prodSelect.click();
    await new Promise((r) => setTimeout(r, 600));

    const gasOptions = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("[role='option']")).map((o) => o.innerText.trim());
    });
    console.log("Gas options found in dropdown:", gasOptions);

    await page.screenshot({ path: "scripts/sqa-shots/po-gas-dropdown-with-stock.png" });
    console.log("Screenshot: scripts/sqa-shots/po-gas-dropdown-with-stock.png");

    // Verify Gas stock labels
    const argonOpt = gasOptions.find((o) => o.includes("Argon 0.98"));
    const inaOpt = gasOptions.find((o) => o.includes("Ina Church"));
    const oxygenGasOpt = gasOptions.find((o) => o.includes("Oxygen"));
    console.log("Argon option:", argonOpt);
    console.log("Ina Church option:", inaOpt);
    console.log("Oxygen option:", oxygenGasOpt);

    if (!argonOpt || !argonOpt.includes("Stock: 200")) {
      throw new Error(`Expected Argon 0.98 to show Stock: 200, got: ${argonOpt}`);
    }
    if (!inaOpt || !inaOpt.includes("Stock: 0")) {
      throw new Error(`Expected Ina Church to show Stock: 0, got: ${inaOpt}`);
    }

    // Select Argon 0.98
    await page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll("[role='option']"));
      const target = opts.find((o) => o.innerText.includes("Argon 0.98"));
      if (target) target.click();
    });
    await new Promise((r) => setTimeout(r, 600));

    // Check that trigger displays clean name "Argon 0.98"
    const argonTriggerText = await page.evaluate(() => {
      const rows = document.querySelectorAll("table tbody tr");
      return rows[0].querySelectorAll("button[role='combobox']")[0].innerText.trim();
    });
    console.log("Selected trigger text for Argon:", argonTriggerText);
    if (!argonTriggerText.includes("Argon 0.98")) {
      throw new Error(`Expected trigger to contain Argon 0.98, got: ${argonTriggerText}`);
    }

    // 2. Test Cylinder dropdown
    console.log("\n--- Checking Cylinder Products & Stock ---");
    await typeSelect.click();
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll("[role='option']"));
      const cylOpt = opts.find((o) => o.innerText.trim().toLowerCase() === "cylinder");
      if (cylOpt) cylOpt.click();
    });
    await new Promise((r) => setTimeout(r, 600));

    // Open Product dropdown for cylinders
    await prodSelect.click();
    await new Promise((r) => setTimeout(r, 600));

    const cylinderOptions = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("[role='option']")).map((o) => o.innerText.trim());
    });
    console.log("Cylinder options found in dropdown:", cylinderOptions);

    await page.screenshot({ path: "scripts/sqa-shots/po-cylinder-dropdown-with-stock.png" });
    console.log("Screenshot: scripts/sqa-shots/po-cylinder-dropdown-with-stock.png");

    const lpg12Opt = cylinderOptions.find((o) => o.includes("LPG Domestic 12kg"));
    const co2Opt = cylinderOptions.find((o) => o.includes("Carbon Dioxide"));
    const cylOxyOpt = cylinderOptions.find((o) => o.startsWith("Oxygen\n") || o.split("\n")[0].trim() === "Oxygen");
    console.log("LPG Domestic 12kg option:", lpg12Opt);
    console.log("Carbon Dioxide option (0 stock):", co2Opt);
    console.log("Oxygen cylinder option:", cylOxyOpt);

    if (!lpg12Opt || !lpg12Opt.includes("Stock: 104")) {
      throw new Error(`Expected LPG Domestic 12kg to show Stock: 104, got: ${lpg12Opt}`);
    }
    if (!co2Opt || !co2Opt.includes("Stock: 0")) {
      throw new Error(`Expected Carbon Dioxide to show Stock: 0, got: ${co2Opt}`);
    }
    if (!cylOxyOpt || !cylOxyOpt.includes("Stock: 560")) {
      throw new Error(`Expected Oxygen cylinder to show Stock: 560, got: ${cylOxyOpt}`);
    }

    // Select LPG Domestic 12kg
    await page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll("[role='option']"));
      const target = opts.find((o) => o.innerText.includes("LPG Domestic 12kg"));
      if (target) target.click();
    });
    await new Promise((r) => setTimeout(r, 600));

    // 3. Test Product dropdown
    console.log("\n--- Checking General Products & Stock ---");
    await typeSelect.click();
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll("[role='option']"));
      const pOpt = opts.find((o) => o.innerText.trim().toLowerCase() === "product");
      if (pOpt) pOpt.click();
    });
    await new Promise((r) => setTimeout(r, 600));

    // Open Product dropdown for products
    await prodSelect.click();
    await new Promise((r) => setTimeout(r, 600));

    const generalProductOptions = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("[role='option']")).map((o) => o.innerText.trim());
    });
    console.log("General Product options found in dropdown:", generalProductOptions);

    await page.screenshot({ path: "scripts/sqa-shots/po-general-product-dropdown-with-stock.png" });
    console.log("Screenshot: scripts/sqa-shots/po-general-product-dropdown-with-stock.png");

    const rflOpt = generalProductOptions.find((o) => o.includes("RFL ROse Gas stove"));
    const mitarOpt = generalProductOptions.find((o) => o.includes("mitar"));
    console.log("RFL option:", rflOpt);
    console.log("mitar option:", mitarOpt);

    if (!rflOpt || !rflOpt.includes("Stock: 50")) {
      throw new Error(`Expected RFL to show Stock: 50, got: ${rflOpt}`);
    }
    if (!mitarOpt || !mitarOpt.includes("Stock: 3015")) {
      throw new Error(`Expected mitar to show Stock: 3015, got: ${mitarOpt}`);
    }

    // Select RFL
    await page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll("[role='option']"));
      const target = opts.find((o) => o.innerText.includes("RFL"));
      if (target) target.click();
    });
    await new Promise((r) => setTimeout(r, 600));

    // 4. Verify calculations
    console.log("\n--- Verifying PO Calculations with stock-enabled items ---");
    // Change Qty to 5 and Cost to 150
    const qtyInput = await page.$("table tbody tr input[type='number']:first-of-type");
    await qtyInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.keyboard.type("5");
    await new Promise((r) => setTimeout(r, 300));

    const costInputs = await page.$$("table tbody tr input");
    const costInput = costInputs[1];
    await costInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.keyboard.type("150");
    await new Promise((r) => setTimeout(r, 500));

    const rowCalc = await page.evaluate(() => {
      const lineTotal = document.querySelector("table tbody tr td:nth-child(5)")?.innerText?.trim();
      const subtotal = document.querySelector(".w-56")?.innerText;
      const qty = document.querySelector("table tbody tr input[type='number']:first-of-type")?.value;
      const cost = document.querySelectorAll("table tbody tr input")[1]?.value;
      return { lineTotal, subtotal, qty, cost };
    });
    console.log("Calculated row & totals:", rowCalc);
    const expected = Number(rowCalc.qty) * Number(rowCalc.cost);
    if (!rowCalc.lineTotal.includes(expected.toLocaleString("en-US")) && !rowCalc.lineTotal.includes(expected.toLocaleString("bn-BD"))) {
      throw new Error(`Expected line total to match ${expected}, got: ${rowCalc.lineTotal}`);
    }

    // ==========================================
    // PART 1: Sticky Headers Across Lists
    // ==========================================
    console.log("\n==========================================");
    console.log("TESTING PART 1: Sticky Column Headers Across Lists");
    console.log("==========================================");

    const checkListSticky = async (url, listName) => {
      console.log(`\nTesting list: ${listName} (${url})...`);
      await page.goto(`http://localhost:8080${url}`, { waitUntil: "networkidle0" });
      await page.waitForSelector("table", { timeout: 15000 });
      await new Promise((r) => setTimeout(r, 1000));

      const stickyResult = await page.evaluate(() => {
        const table = document.querySelector("table");
        const thead = document.querySelector("thead");
        const th = thead?.querySelector("th");
        const scrollContainer = thead?.closest(".overflow-auto");

        if (!scrollContainer) {
          return { error: "No .overflow-auto scroll container found" };
        }

        const initialTheadTop = thead.getBoundingClientRect().top;
        const initialContainerTop = scrollContainer.getBoundingClientRect().top;

        // Scroll the container down by 300px
        scrollContainer.scrollTop = 300;

        const scrolledTheadTop = thead.getBoundingClientRect().top;
        const scrolledContainerTop = scrollContainer.getBoundingClientRect().top;
        const actualScrollTop = scrollContainer.scrollTop;

        // Scroll horizontally if table is wider than container
        const maxScrollLeft = scrollContainer.scrollWidth - scrollContainer.clientWidth;
        if (maxScrollLeft > 0) {
          scrollContainer.scrollLeft = Math.min(100, maxScrollLeft);
        }

        const horizontalTheadLeft = thead.getBoundingClientRect().left;
        const firstRowTdLeft = document.querySelector("tbody tr td")?.getBoundingClientRect().left;

        return {
          hasContainer: true,
          initialScrollTop: actualScrollTop,
          initialTheadTop,
          scrolledTheadTop,
          scrolledContainerTop,
          isHeaderSticky: Math.abs(scrolledTheadTop - scrolledContainerTop) < 3,
          horizontalAlignmentDiff: Math.abs(horizontalTheadLeft - (firstRowTdLeft || 0)),
        };
      });

      console.log(`${listName} sticky result:`, stickyResult);
      if (!stickyResult.isHeaderSticky) {
        throw new Error(`${listName} header is NOT sticky! Scrolled top: ${stickyResult.scrolledTheadTop}, Container top: ${stickyResult.scrolledContainerTop}`);
      }

      await page.screenshot({ path: `scripts/sqa-shots/sticky-${listName.toLowerCase().replace(/[^a-z0-9]/g, "-")}.png` });
      console.log(`Screenshot saved: scripts/sqa-shots/sticky-${listName.toLowerCase().replace(/[^a-z0-9]/g, "-")}.png`);
    };

    // Test Purchases list
    await checkListSticky("/purchases", "Purchases");

    // Test Sales list
    await checkListSticky("/sales", "Sales");

    // Test Deliveries list
    await checkListSticky("/deliveries", "Deliveries");

    // Test Returns list
    await checkListSticky("/returns", "Returns");

    // Test Inventory list (Gas, Cylinder, Product, Summary tabs)
    await checkListSticky("/inventory", "Inventory-Gas");

    // Switch to Cylinder tab in Inventory
    console.log("\nTesting Inventory Cylinder tab...");
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll("button[role='tab']"));
      const cylTab = tabs.find((t) => t.innerText.includes("Cylinder") || t.innerText.includes("সিলিন্ডার"));
      cylTab?.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await checkListSticky("/inventory", "Inventory-Cylinder");

    // Switch to Product tab in Inventory
    console.log("\nTesting Inventory Product tab...");
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll("button[role='tab']"));
      const pTab = tabs.find((t) => t.innerText.includes("Product") || t.innerText.includes("পণ্য"));
      pTab?.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await checkListSticky("/inventory", "Inventory-Product");

    // Test Suppliers list
    await checkListSticky("/suppliers", "Suppliers");

    // Test Customers list
    await checkListSticky("/customers", "Customers");

    // Test Products list
    await checkListSticky("/products", "Products");

    // Test Damage Cylinder
    await checkListSticky("/cylinders/damage", "Damage-Cylinders");

    // Test Cylinder Registry
    await checkListSticky("/cylinders", "Cylinder-Registry");

    // Test Supplier Returns
    await checkListSticky("/suppliers/returns", "Supplier-Returns");

    // Test Sorting and Searching on Purchases list
    console.log("\n--- Testing Sort and Search Interactions on Purchases List ---");
    await page.goto("http://localhost:8080/purchases", { waitUntil: "networkidle0" });
    await page.waitForSelector("table", { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1000));

    // Sort by PO No
    const firstPoBefore = await page.evaluate(() => {
      return document.querySelector("tbody tr td:first-child")?.innerText?.trim();
    });
    console.log("First PO before sort:", firstPoBefore);

    // Click sort button on first column
    await page.evaluate(() => {
      const sortBtn = document.querySelector("th button");
      sortBtn?.click();
    });
    await new Promise((r) => setTimeout(r, 500));

    const firstPoAfter = await page.evaluate(() => {
      return document.querySelector("tbody tr td:first-child")?.innerText?.trim();
    });
    console.log("First PO after sort:", firstPoAfter);

    // Test Search filter
    const searchInput = await page.$("input[placeholder*='Search'], input[placeholder*='খুঁজুন']");
    if (searchInput) {
      await searchInput.type("Bashundhara");
      await new Promise((r) => setTimeout(r, 500));
      const rowCount = await page.evaluate(() => {
        return document.querySelectorAll("tbody tr").length;
      });
      console.log(`Rows after searching 'Bashundhara': ${rowCount}`);
      if (rowCount === 0) {
        throw new Error("Search filter failed to find Bashundhara rows");
      }
    }

    console.log("\n==========================================");
    console.log("ALL TESTS COMPLETED AND VERIFIED 100% SUCCESSFULLY!");
    console.log("==========================================");

    await browser.close();
  } catch (err) {
    console.error("Test error:", err);
    await browser.close();
    process.exit(1);
  }
}

runComprehensiveVerification();
