import puppeteer from 'puppeteer';

async function main() {
  console.log('Launching browser to verify Quantity layout on Sales Order form...');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    console.log('Logging in locally...');
    await page.goto('http://localhost:8080/login', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1000));
    if (page.url().includes('/login')) {
      await page.waitForSelector('#username', { timeout: 10000 });
      await page.type('#username', 'operator');
      await page.type('#password', 'insaf123');
      await page.click("button[type='submit']");
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log('Navigating to http://localhost:8080/sales/new...');
    await page.goto('http://localhost:8080/sales/new', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('table', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));

    // Ensure a line item row exists
    const hasRow = await page.evaluate(() => document.querySelectorAll('table tbody tr input[type="number"]').length > 0);
    if (!hasRow) {
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(
          b => b.innerText.includes('Add Item') || b.innerText.includes('আইটেম যোগ')
        );
        btn?.click();
      });
      await new Promise(r => setTimeout(r, 600));
    }

    // Enter values 123456 in first quantity input
    const inputs = await page.$$('table tbody tr input[type="number"]');
    console.log(`Found ${inputs.length} number inputs in table`);

    if (inputs.length > 0) {
      await inputs[0].click({ clickCount: 3 });
      await inputs[0].type('123456');
    }

    await new Promise(r => setTimeout(r, 600));

    const measurements = await page.evaluate(() => {
      const qtyInput = document.querySelector('table tbody tr td:nth-child(5) input');
      const priceInput = document.querySelector('table tbody tr td:nth-child(6) input');
      const qtyCell = document.querySelector('table tbody tr td:nth-child(5)');
      const priceCell = document.querySelector('table tbody tr td:nth-child(6)');
      const qtyHeader = document.querySelector('table thead tr th:nth-child(5)');
      const priceHeader = document.querySelector('table thead tr th:nth-child(6)');

      return {
        qtyHeaderWidth: qtyHeader?.getBoundingClientRect().width,
        priceHeaderWidth: priceHeader?.getBoundingClientRect().width,
        qtyCellWidth: qtyCell?.getBoundingClientRect().width,
        priceCellWidth: priceCell?.getBoundingClientRect().width,
        qtyInputWidth: qtyInput?.getBoundingClientRect().width,
        qtyInputValue: qtyInput?.value,
        qtyInputScrollWidth: qtyInput?.scrollWidth,
        qtyInputClientWidth: qtyInput?.clientWidth,
        isTruncated: qtyInput ? qtyInput.scrollWidth > qtyInput.clientWidth : false,
      };
    });

    console.log('Measurements:', measurements);

    await page.screenshot({ path: 'scripts/sqa-shots/sales-order-qty-verified.png', fullPage: false });
    console.log('PASS: Screenshot saved to scripts/sqa-shots/sales-order-qty-verified.png');
    
    // Also test on smaller screen (1024x768)
    await page.setViewport({ width: 1024, height: 768 });
    await new Promise(r => setTimeout(r, 500));
    const smallMeasurements = await page.evaluate(() => {
      const qtyInput = document.querySelector('table tbody tr td:nth-child(5) input');
      return {
        qtyInputWidth: qtyInput?.getBoundingClientRect().width,
        qtyInputValue: qtyInput?.value,
        isTruncated: qtyInput ? qtyInput.scrollWidth > qtyInput.clientWidth : false,
      };
    });
    console.log('Measurements on 1024px viewport:', smallMeasurements);
    await page.screenshot({ path: 'scripts/sqa-shots/sales-order-qty-1024px.png', fullPage: false });
    console.log('PASS: Screenshot saved to scripts/sqa-shots/sales-order-qty-1024px.png');

  } finally {
    await browser.close();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
