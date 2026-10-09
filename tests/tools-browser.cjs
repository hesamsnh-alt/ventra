const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('http://localhost:3017/tools/concrete');
    await page.getByRole('heading', { name: 'Concrete Volume' }).waitFor();
    await page.getByLabel('Length (m)').fill('10');
    await page.waitForFunction(() => document.querySelector('output')?.textContent.includes('8.4'));
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Horizontal overflow');
    await page.screenshot({ path: `/workspace/scratch/ad3f0a90496e/tools-${width}.png` });
  }
  for (const tool of ['steel', 'area', 'volume', 'units', 'mep', 'boq', 'quotation', 'schedule', 'estimate', 'catalog']) {
    const response = await page.goto(`http://localhost:3017/tools/${tool}`);
    if (response.status() !== 200) throw new Error(`${tool}: ${response.status()}`);
  }
  await browser.close();
  console.log('Tool routes and calculator interaction passed on desktop and mobile.');
})().catch(error => { console.error(error); process.exitCode = 1; });
