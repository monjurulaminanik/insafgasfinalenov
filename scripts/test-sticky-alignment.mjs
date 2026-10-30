import puppeteer from "puppeteer";

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  });
  const page = await browser.newPage();
  // Set smaller viewport to force horizontal scroll
  await page.setViewport({ width: 900, height: 700 });
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
    outerDiv.style.overflow = "auto";
    tableDiv.style.overflow = "visible";

    ths.forEach(th => {
      th.style.position = "sticky";
      th.style.top = "0";
      th.style.zIndex = "10";
      th.style.backgroundColor = "oklch(0.995 0.004 240 / 0.95)";
      th.style.backdropFilter = "blur(4px)";
    });

    // Scroll both vertically and horizontally
    outerDiv.scrollTop = 300;
    outerDiv.scrollLeft = 200;
  });

  const scrollInfo = await page.evaluate(() => {
    const table = document.querySelector("table");
    const outerDiv = table.parentElement.parentElement;
    const ths = Array.from(document.querySelectorAll("th")).map(th => {
      const rect = th.getBoundingClientRect();
      return { text: th.innerText.trim(), left: rect.left, width: rect.width };
    });
    const firstRowTds = Array.from(document.querySelectorAll("tbody tr:nth-child(10) td")).map(td => {
      const rect = td.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    });
    return {
      scrollLeft: outerDiv.scrollLeft,
      scrollTop: outerDiv.scrollTop,
      columnAlignments: ths.map((th, i) => ({
        thText: th.text,
        thLeft: th.left,
        tdLeft: firstRowTds[i]?.left,
        diff: Math.abs(th.left - (firstRowTds[i]?.left || 0))
      }))
    };
  });
  console.log("Scroll alignment info:", scrollInfo);

  await page.screenshot({ path: "scripts/sqa-shots/test-sticky-horizontal-and-vertical.png" });
  console.log("Saved screenshot: scripts/sqa-shots/test-sticky-horizontal-and-vertical.png");

  await browser.close();
}

main().catch(console.error);
