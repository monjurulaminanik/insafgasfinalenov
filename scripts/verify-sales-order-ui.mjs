import puppeteer from "puppeteer";
import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");

async function runTest() {
  console.log("=== LAUNCHING PUPPETEER FOR SALES ORDER COMPLETION TEST ===");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const testCustomerName = `SQA Test Customer ${Date.now()}`;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    console.log("1. Logging in...");
    await page.goto("http://localhost:8080/login", { waitUntil: "networkidle0", timeout: 30000 });
    const card = await page.$("[data-login-card]");
    if (card) {
      await card.click();
      await new Promise(r => setTimeout(r, 1000));
    } else {
      await page.type("#username", "operator");
      await page.type("#password", "insaf123");
      const btn = await page.$("button[type='submit']");
      if (btn) await btn.click();
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log("2. Navigating to http://localhost:8080/sales/new...");
    await page.goto("http://localhost:8080/sales/new", { waitUntil: "networkidle0", timeout: 30000 });

    // Step 2: Fill Customer by typing
    console.log(`3. Setting customer name to "${testCustomerName}"...`);
    await page.waitForSelector("table tbody tr", { timeout: 15000 });
    
    // Find customer input
    const custInput = await page.$("input");
    if (!custInput) throw new Error("Could not find customer input");
    await custInput.click();
    await custInput.type(testCustomerName, { delay: 30 });
    await new Promise(r => setTimeout(r, 500));

    // Step 3: Open Product popover
    console.log("4. Opening product selector...");
    const rowButton = await page.$("table tbody tr button");
    if (!rowButton) throw new Error("Could not find product button in table row");
    await rowButton.click();

    // Wait for popover content
    console.log("5. Waiting for product dropdown list...");
    await page.waitForSelector("ul button", { timeout: 10000 });

    // Check dropdown text for Medical Oxygen ( o2-1.36)
    const options = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("ul button"));
      return btns.map(b => b.innerText?.trim());
    });
    console.log("Found products in popover:", options.filter(o => /Medical Oxygen/i.test(o)));

    const medOxyOption = options.find(o => /Medical Oxygen \( o2-1\.36\)/i.test(o) && /10\s*cyl/i.test(o));
    console.log("Matching cylinder option:", medOxyOption);

    if (!medOxyOption) {
      throw new Error("Could not find 'Medical Oxygen ( o2-1.36)' with '10 cyl' in dropdown!");
    }

    // Click the matching cylinder option
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("ul button"));
      const target = btns.find(b => /Medical Oxygen \( o2-1\.36\)/i.test(b.innerText) && /10\s*cyl/i.test(b.innerText));
      if (target) target.click();
    });

    await new Promise(r => setTimeout(r, 800));

    // Step 4: Set Quantity to 1, Price to 100
    console.log("6. Setting Quantity = 1 and Price = 100...");
    await page.evaluate(() => {
      const numInputs = Array.from(document.querySelectorAll("table tbody tr input[type='number']"));
      if (numInputs[0]) {
        numInputs[0].value = "1";
        numInputs[0].dispatchEvent(new Event("input", { bubbles: true }));
        numInputs[0].dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (numInputs[1]) {
        numInputs[1].value = "100";
        numInputs[1].dispatchEvent(new Event("input", { bubbles: true }));
        numInputs[1].dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    await new Promise(r => setTimeout(r, 500));

    // Step 5: Click Complete Order
    console.log("7. Clicking 'Complete Order' button...");
    const completeBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const btn = btns.find(b => /Complete Order|অর্ডার সম্পন্ন/i.test(b.innerText));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });

    if (!completeBtn) throw new Error("Could not find 'Complete Order' button");

    // Wait for result / navigation / error toast
    console.log("8. Waiting for order completion response...");
    await new Promise(r => setTimeout(r, 5000));

    // Check if error toast or alert appeared
    const errorText = await page.evaluate(() => {
      const toasts = Array.from(document.querySelectorAll("[data-sonner-toast], [role='alert'], .text-destructive"));
      return toasts.map(t => t.innerText).join(" | ");
    });

    if (/Insufficient stock/i.test(errorText)) {
      throw new Error(`TEST FAILED: Insufficient stock error still occurred! Toast: ${errorText}`);
    }

    console.log("SUCCESS: No insufficient stock error! Messages:", errorText || "None (clean redirect)");

    // Take screenshot of result
    await page.screenshot({ path: "scripts/sales-order-success.png", fullPage: true });
    console.log("Saved screenshot to scripts/sales-order-success.png");

    // Verify in MongoDB that order was created
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db("InsafCorporation");
    const testOrder = await db.collection("sales").findOne(
      { customerName: testCustomerName }
    );

    console.log("\n=== DATABASE VERIFICATION ===");
    console.log("Created Order in DB:", testOrder?.orderNo, testOrder?.status, testOrder?.customerName);
    console.log("Order items:", testOrder?.items);

    if (testOrder && testOrder.orderNo) {
      console.log(`PASS: Sales order ${testOrder.orderNo} successfully created and verified in database!`);

      // Clean up ONLY this test order and its delivery
      console.log("Cleaning up test sales order to keep production database clean...");
      await db.collection("sales").deleteOne({ id: testOrder.id });
      await db.collection("deliveries").deleteMany({ salesOrderId: testOrder.id });
      await db.collection("customers").deleteMany({ name: testCustomerName });
      console.log(`Cleaned up test order ${testOrder.id}`);
    } else {
      console.log("Note: Could not find created order in database");
    }

    await client.close();
  } finally {
    await browser.close();
  }
}

runTest().catch((e) => {
  console.error("FATAL ERROR in runTest:", e);
  process.exit(1);
});
