import puppeteer from 'puppeteer';
import path from 'path';

const executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactDir = 'C:\\Users\\shahi\\.gemini\\antigravity-ide\\brain\\e29a367f-e219-4eea-afc3-995381a8ab9a';

async function run() {
  console.log("Launching Chrome...");
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  console.log("Navigating to http://localhost:8080/ ...");
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });

  const url = page.url();
  if (url.includes("/login")) {
    console.log("Logging in as operator...");
    await page.waitForSelector("#username", { timeout: 10000 });
    await page.type("#username", "operator");
    await page.type("#password", "insaf123");
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 4000));
  }

  // Wait for data to load and populate beyond ৳0
  console.log("Waiting for financial summary cards to populate live data...");
  await page.waitForSelector('[data-testid="financial-card-sales"] p.tabular-nums', { timeout: 20000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="financial-card-sales"] p.tabular-nums');
    return el && el.textContent && el.textContent.includes('44,987');
  }, { timeout: 25000 });

  const extractCards = async () => {
    return await page.evaluate(() => {
      const cards = ['sales', 'purchases', 'expenses', 'profit'];
      return cards.map(id => {
        const el = document.querySelector(`[data-testid="financial-card-${id}"]`);
        if (!el) return { id, error: 'Element not found' };
        const pTags = Array.from(el.querySelectorAll('p')).map(p => p.textContent?.trim());
        const title = pTags[0];
        const value = el.querySelector('p.tabular-nums')?.textContent?.trim();
        const subtitle = pTags[2];
        const hasEllipsis = value ? value.includes('...') || value.includes('…') : false;
        return { id, title, value, subtitle, hasEllipsis };
      });
    });
  };

  console.log('\n=== 1. Desktop Viewport (1440x900) ===');
  await page.setViewport({ width: 1440, height: 900 });
  await new Promise(r => setTimeout(r, 800));
  const desktopCards = await extractCards();
  desktopCards.forEach(c => console.log(`  [${c.id}] ${c.title} -> Value: "${c.value}" (Ellipsis: ${c.hasEllipsis}) | Subtitle: "${c.subtitle}"`));
  await page.screenshot({ path: path.join(artifactDir, 'dashboard-cards-desktop-fixed.png'), fullPage: false });

  console.log('\n=== 2. Laptop Viewport (1024x768) ===');
  await page.setViewport({ width: 1024, height: 768 });
  await new Promise(r => setTimeout(r, 800));
  const laptopCards = await extractCards();
  laptopCards.forEach(c => console.log(`  [${c.id}] ${c.title} -> Value: "${c.value}" (Ellipsis: ${c.hasEllipsis})`));
  await page.screenshot({ path: path.join(artifactDir, 'dashboard-cards-laptop-fixed.png'), fullPage: false });

  console.log('\n=== 3. Tablet Viewport (768x1024) ===');
  await page.setViewport({ width: 768, height: 1024 });
  await new Promise(r => setTimeout(r, 800));
  const tabletCards = await extractCards();
  tabletCards.forEach(c => console.log(`  [${c.id}] ${c.title} -> Value: "${c.value}" (Ellipsis: ${c.hasEllipsis})`));
  await page.screenshot({ path: path.join(artifactDir, 'dashboard-cards-tablet-fixed.png'), fullPage: false });

  console.log('\n=== 4. Mobile Viewport (390x844) ===');
  await page.setViewport({ width: 390, height: 844 });
  await new Promise(r => setTimeout(r, 800));
  const mobileCards = await extractCards();
  mobileCards.forEach(c => console.log(`  [${c.id}] ${c.title} -> Value: "${c.value}" (Ellipsis: ${c.hasEllipsis})`));
  await page.screenshot({ path: path.join(artifactDir, 'dashboard-cards-mobile-fixed.png'), fullPage: false });

  // Focus screenshot on just the 4 cards and revenue chart
  await page.setViewport({ width: 1440, height: 900 });
  await new Promise(r => setTimeout(r, 800));
  const cardsSection = await page.$('.space-y-4');
  if (cardsSection) {
    await cardsSection.screenshot({ path: path.join(artifactDir, 'dashboard-cards-focused-verified.png') });
  }

  await browser.close();
  console.log('\nAll viewport screenshots captured successfully!');
}

run().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
