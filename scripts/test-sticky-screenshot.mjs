import puppeteer from "puppeteer";

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://localhost:8080/login", { waitUntil: "networkidle0" });
  await page.type("#username", "operator");
  await page.type("#password", "insaf123");
  await page.click("button[type='submit']");
  await new Promise(r => setTimeout(r, 1500));
  await page.goto("http://localhost:8080/purchases", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 1500));

  await page.evaluate(() => {
    const table = document.querySelector("table");
    const thead = document.querySelector("thead");
    const ths = thead.querySelectorAll("th");
    const tableDiv = table.parentElement; // inner div in Table
    const outerDiv = tableDiv.parentElement; // overflow-x-auto in DataTable
    
    // Configure container
    outerDiv.style.maxHeight = "calc(100vh - 14.5rem)";
    outerDiv.style.overflow = "auto";
    tableDiv.style.overflow = "visible";

    // In CSS tables, position: sticky on <th> works across all browsers
    ths.forEach(th => {
      th.style.position = "sticky";
      th.style.top = "0";
      th.style.zIndex = "10";
      // Match the row background
      th.style.backgroundColor = "var(--color-card, #ffffff)";
    });

    // Also the tr or thead
    const tr = thead.querySelector("tr");
    if (tr) {
      tr.style.backgroundColor = "var(--color-card, #ffffff)";
    }

    outerDiv.scrollTop = 450;
  });

  await page.screenshot({ path: "scripts/sqa-shots/test-sticky-mode-a.png" });
  console.log("Screenshot saved to scripts/sqa-shots/test-sticky-mode-a.png");

  await browser.close();
}

main().catch(console.error);
