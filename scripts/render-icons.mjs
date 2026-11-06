// Renders the SVG app icon to the PNG sizes the web manifest and iOS need.
// Usage: NODE_PATH=$(npm root -g) npm run icons   (needs a global Playwright install)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Playwright is installed globally on the dev machine, not as a project dependency.
const { chromium } = createRequire(import.meta.url)('playwright');

const targets = [
  { svg: 'public/icons/icon.svg', out: 'public/icons/icon-192.png', size: 192 },
  { svg: 'public/icons/icon.svg', out: 'public/icons/icon-512.png', size: 512 },
  { svg: 'scripts/icon-maskable.svg', out: 'public/icons/icon-maskable-512.png', size: 512 },
  { svg: 'scripts/icon-maskable.svg', out: 'public/icons/apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { svg, out, size } of targets) {
  await page.setViewportSize({ width: size, height: size });
  const markup = readFileSync(svg, 'utf8').replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup}</body></html>`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`wrote ${out}`);
}
await browser.close();
