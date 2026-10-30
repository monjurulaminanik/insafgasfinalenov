import puppeteer from "puppeteer";

async function testSticky() {
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

  // Mode A: Container scrolling
  // We make the table wrapper overflow-auto with max-height, and thead sticky top-0
  const modeA = await page.evaluate(() => {
    const table = document.querySelector("table");
    const thead = document.querySelector("thead");
    const tableDiv = table.parentElement; // inner div
    const outerDiv = tableDiv.parentElement; // overflow-x-auto div
    
    // Set container scroll
    outerDiv.style.maxHeight = "calc(100vh - 14rem)";
    outerDiv.style.overflow = "auto";
    tableDiv.style.overflow = "visible"; // prevent double scrollbar

    thead.style.position = "sticky";
    thead.style.top = "0";
    thead.style.zIndex = "10";
    thead.style.backgroundColor = "oklch(0.955 0.012 240)"; // var(--muted)

    // Scroll inside container
    outerDiv.scrollTop = 400;

    const theadRect = thead.getBoundingClientRect();
    const containerRect = outerDiv.getBoundingClientRect();

    return {
      containerScrollTop: outerDiv.scrollTop,
      containerTop: containerRect.top,
      theadTop: theadRect.top,
      isStuckToContainerTop: Math.abs(theadRect.top - containerRect.top) < 2,
    };
  });
  console.log("Mode A (container scroll):", modeA);

  // Now test Mode B: Window scrolling with sticky top: 56px (below navbar)
  // Can horizontal scroll exist on table while sticky to window?
  const modeB = await page.evaluate(() => {
    const table = document.querySelector("table");
    const thead = document.querySelector("thead");
    const tableDiv = table.parentElement;
    const outerDiv = tableDiv.parentElement;
    const card = outerDiv.parentElement;

    outerDiv.style.maxHeight = "";
    outerDiv.scrollTop = 0;

    // What if outerDiv has overflow-x: auto and no height limit?
    outerDiv.style.overflowX = "auto";
    outerDiv.style.overflowY = "visible"; // Note: CSS spec makes overflowY compute to auto if overflowX is auto!
    tableDiv.style.overflow = "visible";
    card.style.overflow = "visible";

    thead.style.position = "sticky";
    thead.style.top = "56px";
    thead.style.zIndex = "10";
    thead.style.backgroundColor = "oklch(0.955 0.012 240)";

    window.scrollTo(0, 500);

    const theadRect = thead.getBoundingClientRect();
    const computedOuter = window.getComputedStyle(outerDiv);

    return {
      windowScrollY: window.scrollY,
      theadTop: theadRect.top,
      outerComputedOverflowX: computedOuter.overflowX,
      outerComputedOverflowY: computedOuter.overflowY,
      isStuckTo56: Math.abs(theadRect.top - 56) < 2,
    };
  });
  console.log("Mode B (window scroll):", modeB);

  await browser.close();
}

testSticky().catch(console.error);
