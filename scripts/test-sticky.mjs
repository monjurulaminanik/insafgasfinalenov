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

  // Let's test what happens if we apply sticky to thead or th in page context
  const test1 = await page.evaluate(() => {
    const thead = document.querySelector("thead");
    const ths = document.querySelectorAll("th");
    const table = document.querySelector("table");
    const tableDiv = table?.parentElement;
    const overflowXDiv = tableDiv?.parentElement;
    const card = overflowXDiv?.parentElement;

    // Apply sticky to th
    ths.forEach(th => {
      th.style.position = "sticky";
      th.style.top = "56px";
      th.style.zIndex = "10";
      th.style.backgroundColor = "var(--muted)";
    });

    window.scrollTo(0, 500);

    const firstThRect = ths[0].getBoundingClientRect();
    return {
      scrollBeforeFix: window.scrollY,
      firstThTop: firstThRect.top,
      tableDivOverflow: window.getComputedStyle(tableDiv).overflow,
      overflowXDivOverflow: window.getComputedStyle(overflowXDiv).overflow,
      cardOverflow: window.getComputedStyle(card).overflow,
    };
  });
  console.log("Test 1 (th sticky with existing ancestor overflow):", test1);

  await browser.close();
}

main().catch(console.error);
