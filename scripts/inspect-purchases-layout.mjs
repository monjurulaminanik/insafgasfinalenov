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

  const info = await page.evaluate(() => {
    const table = document.querySelector("table");
    const thead = document.querySelector("thead");
    const tableContainer = table?.parentElement;
    const nav = document.querySelector(".app-navbar");
    const card = document.querySelector(".card, [class*='rounded-lg']");
    return {
      bodyScrollHeight: document.body.scrollHeight,
      windowInnerHeight: window.innerHeight,
      tableOffsetTop: table?.getBoundingClientRect().top,
      theadClass: thead?.className,
      tableContainerClass: tableContainer?.className,
      tableContainerParentClass: tableContainer?.parentElement?.className,
      navbarHeight: nav?.getBoundingClientRect().height,
      navZIndex: window.getComputedStyle(nav).zIndex,
      theadZIndex: window.getComputedStyle(thead).zIndex,
      rowCount: document.querySelectorAll("table tbody tr").length,
    };
  });
  console.log("Layout info:", info);
  await browser.close();
}

main().catch(console.error);
