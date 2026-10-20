// Renders icons/icon.svg to the PNG sizes the manifest uses:
//   npm run icons

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { ROOT, findBrowser } from './helpers.mjs';

const svg = fs.readFileSync(path.join(ROOT, 'icons/icon.svg'), 'utf8');
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true });
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewport({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: path.join(ROOT, `icons/icon${size}.png`), omitBackground: true });
  console.log(`icons/icon${size}.png`);
}
await browser.close();
