// Runs the browser tests in tests/suites. Each suite gets its own browser with
// the extension loaded from the repository root.
//
//   node run.mjs            all tests
//   node run.mjs markdown   only tests whose suite or name contains "markdown"

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './helpers.mjs';

const filter = (process.argv[2] || '').toLowerCase();
const suitesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'suites');

let passed = 0;
const failed = [];

for (const file of fs.readdirSync(suitesDir).filter((f) => f.endsWith('.mjs')).sort()) {
  const suite = file.replace(/\.mjs$/, '');
  const { default: tests } = await import(pathToFileURL(path.join(suitesDir, file)).href);
  const selected = Object.entries(tests).filter(([name]) => !filter || `${suite} ${name}`.toLowerCase().includes(filter));
  if (!selected.length) continue;

  console.log(`\n${suite}`);
  const ctx = await launch();
  try {
    for (const [name, run] of selected) {
      const start = Date.now();
      try {
        await run(ctx);
        passed++;
        console.log(`  ✓ ${name} (${Date.now() - start} ms)`);
      } catch (err) {
        failed.push(`${suite}: ${name}`);
        console.log(`  ✗ ${name}\n      ${String(err.stack || err).split('\n').slice(0, 6).join('\n      ')}`);
      } finally {
        // Keep the first tab: closing the last one can end the browser.
        for (const page of (await ctx.browser.pages()).slice(1)) await page.close().catch(() => {});
      }
    }
  } finally {
    await ctx.browser.close();
  }
}

console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length) {
  console.log(failed.map((f) => `  ✗ ${f}`).join('\n'));
  process.exit(1);
}
