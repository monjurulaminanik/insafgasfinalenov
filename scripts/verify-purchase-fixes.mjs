import puppeteer from "puppeteer";

async function verifyPurchaseFixes() {
  console.log("=== STARTING AUTOMATED VERIFICATION OF PURCHASE ORDER FIXES ===");

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // -------------------------------------------------------------------------
  // 1. Navigate to Login and sign in
  // -------------------------------------------------------------------------
  console.log("\n1. Navigating to http://localhost:8080/login...");
  await page.goto("http://localhost:8080/login", {
    waitUntil: "networkidle0",
    timeout: 30000,
  });

  // Check if we need to log in
  const isLoginPage = await page.evaluate(() => window.location.pathname.includes("/login"));
  if (isLoginPage) {
    console.log("On login page. Signing in as Administrator / Operator...");
    // Try clicking quick login card for Administrator or filling credentials
    const adminCard = await page.$("button[data-login-card], [data-login-card]");
    if (adminCard) {
      console.log("Clicking quick login role card...");
      await adminCard.click();
    } else {
      console.log("Filling username & password...");
      const userInp = await page.$("input[autocomplete='username'], input[type='text']");
      const passInp = await page.$("input[type='password']");
      if (userInp && passInp) {
        await userInp.click();
        await page.keyboard.type("operator");
        await passInp.click();
        await page.keyboard.type("insaf123");
        await page.keyboard.press("Enter");
      }
    }

    // Wait for redirect to dashboard or logged-in state
    await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("Logged in. Current URL:", page.url());

  // Navigate to New Purchase Order
  console.log("Navigating to http://localhost:8080/purchases/new...");
  await page.goto("http://localhost:8080/purchases/new", {
    waitUntil: "networkidle0",
    timeout: 30000,
  });

  await page.waitForSelector("#purchase-supplier", { timeout: 15000 });
  console.log("Purchase form loaded successfully.");

  // -------------------------------------------------------------------------
  // 2. Test Cost Field Leading Zeros & Decimals & Empty State
  // -------------------------------------------------------------------------
  console.log("\n2. Testing Cost Input Behavior on first row...");
  // Find the cost input in the table
  const costInputSelector = "table tbody tr:first-child td:nth-child(4) input";
  await page.waitForSelector(costInputSelector, { timeout: 5000 });

  const getCostVal = () =>
    page.evaluate((sel) => document.querySelector(sel)?.value, costInputSelector);
  const getLineTotal = () =>
    page.evaluate(
      () =>
        document.querySelector("table tbody tr:first-child td:nth-child(5)")?.textContent?.trim(),
    );
  const getGrandTotal = () =>
    page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".w-56 .flex.justify-between"));
      return rows.map((r) => r.textContent?.trim());
    });

  console.log("Initial Cost value:", await getCostVal());

  // Test 2a: Clear cost input -> verify it remains empty
  const costInput = await page.$(costInputSelector);
  await costInput.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  const costAfterClear = await getCostVal();
  console.log("Cost after clearing (Backspace):", JSON.stringify(costAfterClear));
  if (costAfterClear !== "") {
    throw new Error(`Expected empty string '' but got '${costAfterClear}'`);
  }

  // Test 2b: Type "0800" into empty input -> should become "800"
  await page.keyboard.type("0800");
  const costAfter0800 = await getCostVal();
  console.log("Cost after typing '0800' into empty input:", costAfter0800);
  if (costAfter0800 !== "800") {
    throw new Error(`Expected '800' but got '${costAfter0800}'`);
  }

  // Test 2c: Type "00050"
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("00050");
  const costAfter00050 = await getCostVal();
  console.log("Cost after typing '00050':", costAfter00050);
  if (costAfter00050 !== "50") {
    throw new Error(`Expected '50' but got '${costAfter00050}'`);
  }

  // Test 2d: Type "01200"
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("01200");
  const costAfter01200 = await getCostVal();
  console.log("Cost after typing '01200':", costAfter01200);
  if (costAfter01200 !== "1200") {
    throw new Error(`Expected '1200' but got '${costAfter01200}'`);
  }

  // Test 2e: Type "0" -> should remain "0"
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("0");
  const costAfter0 = await getCostVal();
  console.log("Cost after typing '0':", costAfter0);
  if (costAfter0 !== "0") {
    throw new Error(`Expected '0' but got '${costAfter0}'`);
  }

  // Test 2f: Type "800" after "0" without clearing -> should become "800"
  await page.keyboard.type("800");
  const costAfter800After0 = await getCostVal();
  console.log("Cost after typing '800' directly after '0':", costAfter800After0);
  if (costAfter800After0 !== "800") {
    throw new Error(`Expected '800' but got '${costAfter800After0}'`);
  }

  // Test 2g: Type "0.50" -> should remain "0.50"
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("0.50");
  const costAfter0_50 = await getCostVal();
  console.log("Cost after typing '0.50':", costAfter0_50);
  if (costAfter0_50 !== "0.50") {
    throw new Error(`Expected '0.50' but got '${costAfter0_50}'`);
  }

  // Set final cost for PO 1 to 800 and Quantity to 2
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("800");

  const qtyInputSelector = "table tbody tr:first-child td:nth-child(3) input";
  const qtyInput = await page.$(qtyInputSelector);
  await qtyInput.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.type("2");

  await new Promise((r) => setTimeout(r, 200));
  const lineTotal = await getLineTotal();
  const totals = await getGrandTotal();
  console.log("Line Total with Qty=2, Cost=800:", lineTotal);
  console.log("Totals summary:", totals);

  // -------------------------------------------------------------------------
  // 3. Test Selecting Existing Supplier & Saving PO
  // -------------------------------------------------------------------------
  console.log("\n3. Testing selecting existing supplier from dropdown...");
  const supplierInput = await page.$("#purchase-supplier");
  await supplierInput.click();

  // Wait for popover options
  await page.waitForSelector("[role='dialog'], [data-radix-popper-content-wrapper]", {
    timeout: 5000,
  });

  // Extract option texts
  const options = await page.evaluate(() => {
    const btns = Array.from(
      document.querySelectorAll("[data-radix-popper-content-wrapper] button"),
    );
    return btns.map((b) => b.textContent?.trim()).filter(Boolean);
  });
  console.log("Available supplier options in dropdown:", options);

  // Click an existing supplier option (second option, skipping '—')
  const existingSupplierName = options.find((o) => o && !o.includes("—")) || "Jamuna Gas Ltd";
  console.log(`Selecting existing supplier: "${existingSupplierName}"`);

  await page.evaluate((name) => {
    const btns = Array.from(
      document.querySelectorAll("[data-radix-popper-content-wrapper] button"),
    );
    const target = btns.find((b) => b.textContent?.trim() === name);
    if (target) target.click();
  }, existingSupplierName);

  const selectedSupplierValue = await page.evaluate(
    () => document.querySelector("#purchase-supplier")?.value,
  );
  console.log("Supplier input value after selection:", selectedSupplierValue);

  // Click "Create PO" button
  console.log("Submitting PO with selected supplier...");
  await page.evaluate(() => {
    const btn = document.querySelector(".flex.justify-end.gap-2 button:last-child");
    if (btn) btn.click();
  });

  // Wait for navigation to /purchases/$id
  await page.waitForFunction(
    () =>
      window.location.pathname.startsWith("/purchases/") &&
      window.location.pathname !== "/purchases/new",
    { timeout: 15000 },
  );

  const poUrl1 = page.url();
  console.log("Successfully created PO 1! Navigated to:", poUrl1);

  // Check displayed supplier on the PO view page
  await page.waitForSelector(".print-sheet", { timeout: 10000 });
  const viewSupplier1 = await page.evaluate(() => {
    const sheet = document.querySelector(".print-sheet");
    return sheet?.innerText;
  });
  console.log(
    `Supplier in view page matches "${existingSupplierName}":`,
    viewSupplier1.includes(existingSupplierName),
  );
  if (!viewSupplier1.includes(existingSupplierName)) {
    throw new Error(`PO View does not display existing supplier: ${existingSupplierName}`);
  }

  // Go to Edit page of PO 1
  console.log("Navigating to Edit page of PO 1...");
  await page.goto(`${poUrl1}/edit`, { waitUntil: "networkidle0", timeout: 15000 });
  await page.waitForSelector("#purchase-supplier", { timeout: 10000 });

  const editSupplierVal1 = await page.evaluate(
    () => document.querySelector("#purchase-supplier")?.value,
  );
  const editCostVal1 = await getCostVal();
  console.log("PO 1 Edit page - Supplier:", editSupplierVal1, "| Cost:", editCostVal1);
  if (editSupplierVal1 !== existingSupplierName) {
    throw new Error(
      `PO 1 Edit supplier mismatch: expected '${existingSupplierName}', got '${editSupplierVal1}'`,
    );
  }
  if (editCostVal1 !== "800") {
    throw new Error(`PO 1 Edit cost mismatch: expected '800', got '${editCostVal1}'`);
  }

  // -------------------------------------------------------------------------
  // 4. Test Custom Manually Typed Supplier & Saving PO
  // -------------------------------------------------------------------------
  const customSupplierName = `Custom Supplier ${Date.now().toString().slice(-4)}`;
  console.log(`\n4. Testing custom manually entered supplier: "${customSupplierName}"...`);

  await page.goto("http://localhost:8080/purchases/new", {
    waitUntil: "networkidle0",
    timeout: 15000,
  });
  await page.waitForSelector("#purchase-supplier", { timeout: 10000 });

  // Type custom supplier name
  const supInp = await page.$("#purchase-supplier");
  await supInp.click();
  await page.keyboard.type(customSupplierName);
  await page.keyboard.press("Escape"); // Close popover

  const enteredCustomName = await page.evaluate(
    () => document.querySelector("#purchase-supplier")?.value,
  );
  console.log("Supplier input value after typing custom name:", enteredCustomName);

  // In row 1, enter Cost "0800" to verify leading zeros cleaning on new PO
  const costInp2 = await page.$(costInputSelector);
  await costInp2.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("0800");
  const cost2Val = await getCostVal();
  console.log("PO 2 Cost after typing 0800 into empty field:", cost2Val);
  if (cost2Val !== "800") {
    throw new Error(`Expected '800', got '${cost2Val}'`);
  }

  // Save the PO with custom supplier
  console.log("Submitting PO with custom supplier...");
  await page.evaluate(() => {
    const btn = document.querySelector(".flex.justify-end.gap-2 button:last-child");
    if (btn) btn.click();
  });

  await page.waitForFunction(
    () =>
      window.location.pathname.startsWith("/purchases/") &&
      window.location.pathname !== "/purchases/new",
    { timeout: 15000 },
  );

  const poUrl2 = page.url();
  console.log("Successfully created PO 2! Navigated to:", poUrl2);

  // Check displayed supplier on the PO view page
  await page.waitForSelector(".print-sheet", { timeout: 10000 });
  const viewSupplier2 = await page.evaluate(() => {
    const sheet = document.querySelector(".print-sheet");
    return sheet?.innerText;
  });
  console.log(
    `Supplier in view page matches custom name "${customSupplierName}":`,
    viewSupplier2.includes(customSupplierName),
  );
  if (!viewSupplier2.includes(customSupplierName)) {
    throw new Error(`PO View does not display custom supplier: ${customSupplierName}`);
  }

  // Go to Edit page of PO 2
  console.log("Navigating to Edit page of PO 2...");
  await page.goto(`${poUrl2}/edit`, { waitUntil: "networkidle0", timeout: 15000 });
  await page.waitForSelector("#purchase-supplier", { timeout: 10000 });

  const editSupplierVal2 = await page.evaluate(
    () => document.querySelector("#purchase-supplier")?.value,
  );
  const editCostVal2 = await getCostVal();
  console.log("PO 2 Edit page - Supplier:", editSupplierVal2, "| Cost:", editCostVal2);
  if (editSupplierVal2 !== customSupplierName) {
    throw new Error(
      `PO 2 Edit supplier mismatch: expected '${customSupplierName}', got '${editSupplierVal2}'`,
    );
  }
  if (editCostVal2 !== "800") {
    throw new Error(`PO 2 Edit cost mismatch: expected '800', got '${editCostVal2}'`);
  }

  // Take screenshot of PO 2 edit page
  await page.screenshot({ path: "scripts/po-custom-supplier-verified.png", fullPage: true });
  console.log("Evidence screenshot saved to scripts/po-custom-supplier-verified.png");

  await browser.close();
  console.log("\n=== ALL AUTOMATED CHECKS COMPLETED AND PASSED PERFECTLY ===");
}

verifyPurchaseFixes().catch((err) => {
  console.error("FAILED VERIFICATION:", err);
  process.exit(1);
});
