import puppeteer from 'puppeteer';

async function main() {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const page = (await browser.pages())[0];
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2' });
  const result = await page.evaluate(() => {
    const images = Array.from(document.querySelectorAll('img')).map(img => ({
      src: img.src?.slice(0, 60),
      alt: img.alt,
    }));
    return {
      images,
      storageLogoLength: localStorage.getItem('insaf-custom-logo')?.length,
    };
  });
  console.log('Result:', result);
  console.log('Console logs:', logs.filter(l => l.includes('DEBUG')));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
