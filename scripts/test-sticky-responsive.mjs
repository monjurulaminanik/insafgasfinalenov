import puppeteer from "puppeteer";

async function testMobileAndTablet() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  });

  const testViewport = async (width, height, name) => {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
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
      const tableDiv = table.parentElement;
      const outerDiv = tableDiv.parentElement;
      
      outerDiv.style.maxHeight = "calc(100vh - 14.5rem)";
      outerDiv.style.minHeight = "280px";
      outerDiv.style.overflow = "auto";
      tableDiv.style.overflow = "visible";

      ths.forEach(th => {
        th.style.position = "sticky";
        th.style.top = "0";
        th.style.zIndex = "10";
        th.style.backgroundColor = "oklch(0.995 0.004 240 / 0.95)";
        th.style.backdropFilter = "blur(4px)";
      });

      outerDiv.scrollTop = 250;
      outerDiv.scrollLeft = 80;
    });

    await page.screenshot({ path: `scripts/sqa-shots/test-sticky-${name}.png` });
    console.log(`Saved screenshot: scripts/sqa-shots/test-sticky-${name}.png`);
    await page.close();
  };

  await testViewport(768, 1024, "tablet-768x1024");
  await testViewport(390, 844, "mobile-390x844");

  await browser.close();
}

testMobileAndTablet().catch(console.error);
