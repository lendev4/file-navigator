// Shared helpers for the browser tests: launching Chrome with the extension,
// settings, URLs and waiting.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEST_FILES = pathToFileURL(path.join(ROOT, 'test-files') + '/').href;

// Any Chromium-based browser works. CHROME_PATH overrides the search.
export function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = ['/opt/helium-browser-bin/helium', 'google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'];
  for (const c of candidates) {
    if (c.startsWith('/') ? fs.existsSync(c) : which(c)) return c.startsWith('/') ? c : which(c);
  }
  throw new Error('No Chromium-based browser found. Set CHROME_PATH.');
}

function which(cmd) {
  try {
    return execFileSync('which', [cmd], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// Extensions loaded from the command line get file access without the toggle.
export async function launch() {
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required'],
  });
  const worker = await browser.waitForTarget((t) => t.type() === 'service_worker', { timeout: 10000 });
  return { browser, id: new URL(worker.url()).host };
}

export async function newPage(ctx, { width = 900, height = 600, scheme } = {}) {
  const page = await ctx.browser.newPage();
  await page.setViewport({ width, height });
  if (scheme) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return page;
}

// Replaces all settings; omitted ones fall back to their defaults. Also forgets
// the layouts picked per folder.
export async function setSettings(ctx, settings = {}) {
  const page = await ctx.browser.newPage();
  await page.goto(`chrome-extension://${ctx.id}/options.html`);
  await page.evaluate((s) => Promise.all([chrome.storage.local.clear(), chrome.storage.sync.clear().then(() => chrome.storage.sync.set(s))]), settings);
  await page.close();
}

export const viewerUrl = (ctx, fileUrl) => `chrome-extension://${ctx.id}/viewer.html?file=${encodeURIComponent(fileUrl)}`;

// What a tab shows, readably: "photo1.png", "viewer:table.csv", "(folder)".
export function shown(url, base = TEST_FILES) {
  if (url.startsWith('chrome-extension://')) {
    const u = new URL(url);
    const file = u.searchParams.get('file');
    return file ? 'viewer:' + decodeURIComponent(file.replace(base, '')) : u.pathname.slice(1);
  }
  const rel = decodeURIComponent(url.split('#')[0].replace(base, ''));
  return rel || '(folder)';
}

export async function until(fn, { timeout = 5000, interval = 50, message = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${message} (last value: ${JSON.stringify(last)})`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits until the tab shows `expected` (see shown()), then lets the content
// script settle.
export async function waitForShown(page, expected, base) {
  await until(() => shown(page.url(), base) === expected, { message: `tab to show ${expected}, shows ${shown(page.url(), base)}` });
  await page.waitForFunction(() => document.readyState !== 'loading');
  await sleep(300);
}

// Waits for a key press to navigate away (or not), returning what's shown after.
export async function pressAndSettle(page, key, base) {
  const before = page.url();
  await page.keyboard.press(key);
  try {
    await until(() => page.url() !== before, { timeout: 1500 });
  } catch {
    return shown(page.url(), base);
  }
  await page.waitForFunction(() => document.readyState !== 'loading');
  await sleep(300);
  return shown(page.url(), base);
}

// Opens a folder in the folder view and waits for it to be built.
export async function openFolder(page, url = TEST_FILES) {
  await page.goto(url);
  await page.waitForSelector('#fn-explorer .fn-row');
}

export async function selectedInFolder(page) {
  return page.evaluate(() => document.querySelector('#fn-explorer .fn-selected .fn-label')?.textContent);
}

// The header bar lives in a closed shadow root, so it's found by position:
// the element at the top of the page is its host, a direct child of <html>.
export async function barVisible(page) {
  return page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, 6);
    return !!el && el.parentElement === document.documentElement && el.localName === 'div';
  });
}

// Centres of the bar's ‹ and › buttons (see the bar layout in content.js).
export function barButton(page, which) {
  const { width } = page.viewport();
  return which === 'next' ? [width - 8 - 15, 22] : [width - 103, 22];
}

// A temporary folder with files copied from test-files, cleaned up by the caller.
export function tempFolder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filenav-test-'));
  for (const [name, source] of Object.entries(files)) {
    const target = path.join(dir, name);
    if (typeof source === 'string' && source.startsWith('@')) fs.copyFileSync(path.join(ROOT, 'test-files', source.slice(1)), target);
    else fs.writeFileSync(target, source);
  }
  return { dir, url: pathToFileURL(dir).href + '/', remove: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// Runs fn in the extension's options page, where shared.js is loaded, e.g. to
// ask categoryOf() which files belong together.
export async function inExtension(ctx, fn, ...args) {
  const page = await ctx.browser.newPage();
  await page.goto(`chrome-extension://${ctx.id}/options.html`);
  try {
    return await page.evaluate(fn, ...args);
  } finally {
    await page.close();
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const naturalSort = (names) => [...names].sort(collator.compare);

// The visible files of test-files in the same group as `name` (default
// settings: same kind, by name, no hidden files), in stepping order.
export async function groupOf(ctx, name, dir = path.join(ROOT, 'test-files')) {
  const names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && !d.name.startsWith('.')).map((d) => d.name);
  const same = await inExtension(ctx, (names, name) => names.filter((n) => categoryOf(n) === categoryOf(name)), names, name);
  return naturalSort(same);
}

// Folder view order: folders first, then files, each in natural order.
export function folderOrder(dir = path.join(ROOT, 'test-files')) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => !d.name.startsWith('.'));
  return [...naturalSort(entries.filter((d) => d.isDirectory()).map((d) => d.name)), ...naturalSort(entries.filter((d) => !d.isDirectory()).map((d) => d.name))];
}

// Runs fn in the extension's background service worker.
export async function inWorker(ctx, fn, ...args) {
  const target = await ctx.browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(ctx.id));
  return (await target.worker()).evaluate(fn, ...args);
}
