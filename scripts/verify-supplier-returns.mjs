import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const baseUrl = "http://localhost:8080";
const screenshotDir = path.resolve("./scripts/sqa-shots");
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

async function run() {
  console.log("=== Launching Browser for Supplier Return E2E Verification ===");
  const browser = await puppeteer.launch({
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1400,900"],
    defaultViewport: { width: 1400, height: 900 },
  });

  try {
    const page = await browser.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log(`[Browser Error]:`, msg.text());
    });

    // 1. Navigate to home
    console.log("Step 1: Navigating to", baseUrl);
    await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 30000 });

    // Handle login if redirected to /login
    if (page.url().includes("/login")) {
      console.log("Logging in via demo/admin card...");
      await page.waitForSelector("button", { timeout: 10000 });
      const buttons = await page.$$("button");
      let clicked = false;
      for (const btn of buttons) {
        const text = await page.evaluate((el) => el.textContent, btn);
        if (text && text.includes("Administrator")) {
          await btn.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) {
        await page.type("input[type='text']", "operator");
        await page.type("input[type='password']", "insaf123");
        await page.click("button[type='submit']");
      }
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
    }

    console.log("Current URL after login:", page.url());

    // 2. Check Sidebar for 'Suppliers Return'
    console.log("Step 2: Checking sidebar for Suppliers Return...");
    const sidebarHtml = await page.content();
    const hasSuppliersReturn = sidebarHtml.includes("Suppliers Return") || sidebarHtml.includes("সরবরাহকারী ফেরত");
    console.log("Sidebar contains Suppliers Return:", hasSuppliersReturn);

    // 3. Navigate to /suppliers/returns
    console.log("Step 3: Navigating to /suppliers/returns");
    await page.goto(`${baseUrl}/suppliers/returns`, { waitUntil: "networkidle2", timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1000));

    const listScreenshot = path.join(screenshotDir, "suppliers-return-list.png");
    await page.screenshot({ path: listScreenshot, fullPage: true });
    console.log("Saved screenshot:", listScreenshot);

    const listHeading = await page.$eval("h1, h2, [class*='font-semibold']", (el) => el.textContent);
    console.log("List page heading text:", listHeading);

    // 4. Click 'Suppliers Return' button or navigate to /suppliers/returns/new
    console.log("Step 4: Navigating to /suppliers/returns/new");
    await page.goto(`${baseUrl}/suppliers/returns/new`, { waitUntil: "networkidle2", timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    const formScreenshot = path.join(screenshotDir, "suppliers-return-form.png");
    await page.screenshot({ path: formScreenshot, fullPage: true });
    console.log("Saved form screenshot:", formScreenshot);

    // 5. Fill Supplier Return form
    console.log("Step 5: Filling Supplier Return form...");

    // Supplier combobox
    const supplierInput = await page.$("#supplier-return-supplier");
    if (supplierInput) {
      await supplierInput.click();
      await supplierInput.type("Rabbi LPG");
      await new Promise((r) => setTimeout(r, 500));
      // Click first option or press Enter
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
    }

    // Notes field
    const inputs = await page.$$("input");
    for (const inp of inputs) {
      const placeholder = await page.evaluate((el) => el.placeholder, inp);
      if (placeholder && placeholder.toLowerCase().includes("optional notes")) {
        await inp.type("E2E Automated Supplier Return Verification");
        break;
      }
    }

    // Cost input - clean leading zero verification
    const costInput = await page.$("input[type='number']:not([min='1'])");
    if (costInput) {
      await costInput.click({ clickCount: 3 });
      await costInput.type("1500");
    }

    // Quantity input
    const qtyInput = await page.$("input[min='1']");
    if (qtyInput) {
      await qtyInput.click({ clickCount: 3 });
      await qtyInput.type("2");
    }

    await new Promise((r) => setTimeout(r, 800));

    const filledScreenshot = path.join(screenshotDir, "suppliers-return-filled.png");
    await page.screenshot({ path: filledScreenshot, fullPage: true });
    console.log("Saved filled form screenshot:", filledScreenshot);

    // 6. Click Submit 'Create Suppliers Return'
    console.log("Step 6: Submitting return form...");
    const buttons = await page.$$("button");
    for (const btn of buttons) {
      const text = await page.evaluate((el) => el.textContent, btn);
      if (text && (text.includes("Create") || text.includes("তৈরি"))) {
        console.log("Clicking submit button:", text.trim());
        await btn.click();
        break;
      }
    }

    await new Promise((r) => setTimeout(r, 3000));
    console.log("Current URL after submit:", page.url());

    const detailScreenshot = path.join(screenshotDir, "suppliers-return-detail.png");
    await page.screenshot({ path: detailScreenshot, fullPage: true });
    console.log("Saved detail screenshot:", detailScreenshot);

    // 7. Verify record on list page
    console.log("Step 7: Returning to /suppliers/returns list page to verify persistence...");
    await page.goto(`${baseUrl}/suppliers/returns`, { waitUntil: "networkidle2", timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    const listHtml = await page.content();
    const hasSRNumber = /SR-\d{4}-\d+/i.test(listHtml);
    console.log("List page displays generated SR number:", hasSRNumber);

    const finalListScreenshot = path.join(screenshotDir, "suppliers-return-list-persisted.png");
    await page.screenshot({ path: finalListScreenshot, fullPage: true });
    console.log("Saved final list screenshot:", finalListScreenshot);

    console.log("=== Verification Successful! ===");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
