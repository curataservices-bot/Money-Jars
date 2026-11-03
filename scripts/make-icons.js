// Renders PNG icons from icons/icon.svg with the preinstalled Playwright Chromium.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'icons', 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['apple-touch-icon.png', 180, 0]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<html><body style="margin:0;background:#2db57a">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(__dirname, '..', 'icons', name), omitBackground: false });
    await page.close();
  }
  await browser.close();
  console.log('icons done');
})();
