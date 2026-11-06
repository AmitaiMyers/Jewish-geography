// Fails the build when the JavaScript loaded on start-up exceeds the budget in docs/DESIGN_SYSTEM.md.
// Lazily loaded chunks (e.g. the QR scanner) are not counted: they load only when used.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 250;
const html = readFileSync('dist/index.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => match[1]);
if (scripts.length === 0) {
  throw new Error('No entry scripts found in dist/index.html — run the build first.');
}
const totalKb =
  scripts.reduce((sum, src) => sum + gzipSync(readFileSync(`dist/${src.replace(/^.*?assets\//, 'assets/')}`)).length, 0) / 1024;
console.log(`Entry JavaScript: ${totalKb.toFixed(1)} KB gzipped (budget ${BUDGET_KB} KB)`);
if (totalKb > BUDGET_KB) {
  console.error('Bundle budget exceeded.');
  process.exit(1);
}
