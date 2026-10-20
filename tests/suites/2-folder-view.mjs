// The folder view that replaces Chrome's directory listing.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TEST_FILES, newPage, setSettings, openFolder, selectedInFolder, folderOrder, shown, until, sleep, pressAndSettle } from '../helpers.mjs';

const labels = (page) => page.$$eval('#fn-explorer .fn-label', (els) => els.map((e) => e.textContent));
const count = (page) => page.$eval('#fn-explorer .fn-count', (e) => e.textContent);

// What type-ahead should select: the next name starting with `prefix` after
// index `from` (wrapping), like the folder view does for a repeated letter.
const nextStartingWith = (names, prefix, from) => {
  for (let k = 1; k <= names.length; k++) {
    const name = names[(from + k) % names.length];
    if (name.toLowerCase().startsWith(prefix)) return name;
  }
};

export default {
  "replaces Chrome's listing: folders first, natural order": async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openFolder(page);
    assert.deepEqual(await labels(page), folderOrder());
    assert.equal(await selectedInFolder(page), folderOrder()[0]);
    assert.deepEqual(page.errors, []);
  },

  'arrow keys, Home and End move the selection': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openFolder(page);
    const names = folderOrder();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await selectedInFolder(page), names[2]);
    await page.keyboard.press('End');
    assert.equal(await selectedInFolder(page), names.at(-1));
    await page.keyboard.press('Home');
    assert.equal(await selectedInFolder(page), names[0]);
  },

  'typing jumps to matching names': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openFolder(page);
    const names = folderOrder();
    await page.keyboard.press('p');
    const first = nextStartingWith(names, 'p', 0);
    assert.equal(await selectedInFolder(page), first);
    await page.keyboard.press('p');
    assert.equal(await selectedInFolder(page), nextStartingWith(names, 'p', names.indexOf(first)));
    await sleep(900); // type-ahead resets after 800 ms
    await page.keyboard.type('no');
    assert.equal(await selectedInFolder(page), names.find((n) => n.startsWith('no')));
  },

  'filter box narrows the list, Esc clears it': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openFolder(page);
    const all = await count(page);
    await page.keyboard.press('/');
    await page.keyboard.type('clip');
    await until(async () => (await labels(page)).every((l) => l.includes('clip')), { message: 'filtered list' });
    assert.equal((await labels(page)).length, folderOrder().filter((n) => n.includes('clip')).length);
    await page.keyboard.press('Escape');
    assert.equal(await count(page), all);
  },

  'clicking a column header sorts by it, folders stay first': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openFolder(page);
    await page.click('#fn-explorer .fn-col-size');
    const dir = path.join(ROOT, 'test-files');
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => !d.name.startsWith('.'));
    const folders = entries.filter((d) => d.isDirectory()).map((d) => d.name);
    const shownOrder = await labels(page);
    assert.deepEqual(shownOrder.slice(0, folders.length).sort(), folders.sort());
    const sizes = shownOrder.slice(folders.length).map((n) => fs.statSync(path.join(dir, n)).size);
    assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b));
  },

  'Enter opens, Backspace returns with the folder selected': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openFolder(page);
    const folder = folderOrder().find((n) => fs.statSync(path.join(ROOT, 'test-files', n)).isDirectory());
    assert.equal(await selectedInFolder(page), folder);
    assert.equal(await pressAndSettle(page, 'Enter'), folder + '/');
    await page.waitForSelector('#fn-explorer');
    assert.equal(await pressAndSettle(page, 'Backspace'), '(folder)');
    await page.waitForSelector('#fn-explorer .fn-selected');
    assert.equal(await selectedInFolder(page), folder);
  },

  'Left goes to the parent folder with this one selected': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openFolder(page);
    await page.keyboard.press('ArrowLeft');
    await until(() => page.url() === new URL('../', TEST_FILES).href, { message: 'parent folder' });
    await page.waitForSelector('#fn-explorer .fn-selected');
    assert.equal(await selectedInFolder(page), 'test-files');
  },

  'a click selects, a double-click opens': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openFolder(page);
    await page.click('#fn-explorer .fn-row[title="notes.txt"]');
    await sleep(300);
    assert.equal(await selectedInFolder(page), 'notes.txt');
    assert.equal(shown(page.url()), '(folder)');
    await page.click('#fn-explorer .fn-row[title="notes.txt"]', { count: 2 });
    await until(() => shown(page.url()) === 'notes.txt', { message: 'notes.txt opened' });
  },

  'the single-click setting opens on a click': async (ctx) => {
    await setSettings(ctx, { openWith: 'single' });
    const page = await newPage(ctx);
    await openFolder(page);
    await page.click('#fn-explorer .fn-row[title="notes.txt"]');
    await until(() => shown(page.url()) === 'notes.txt', { message: 'notes.txt opened' });
  },

  'Ctrl+click and middle-click open a new tab in both modes': async (ctx) => {
    for (const openWith of ['double', 'single']) {
      await setSettings(ctx, { openWith });
      const page = await newPage(ctx);
      await openFolder(page);
      for (const click of [
        () => page.keyboard.down('Control').then(() => page.click('#fn-explorer .fn-row[title="notes.txt"]')).then(() => page.keyboard.up('Control')),
        () => page.click('#fn-explorer .fn-row[title="notes.txt"]', { button: 'middle' }),
      ]) {
        const before = (await ctx.browser.pages()).length;
        await click();
        await until(async () => (await ctx.browser.pages()).length === before + 1, { message: `new tab (${openWith})` });
        assert.equal(shown(page.url()), '(folder)');
      }
      await page.close();
    }
  },

  "Chrome's listing never shows, not even for a frame": async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    // Before the page's first frame is drawn, record whether the folder view's
    // styles (which hide Chrome's listing) are already active.
    await page.evaluateOnNewDocument(() => {
      requestAnimationFrame(() => (window.__hiddenAtFirstFrame = document.documentElement.classList.contains('fn-explorer')));
    });
    for (let i = 0; i < 5; i++) {
      await page.goto(TEST_FILES + (i % 2 ? 'subfolder/' : ''));
      await page.waitForFunction(() => '__hiddenAtFirstFrame' in window);
      assert.equal(await page.evaluate(() => window.__hiddenAtFirstFrame), true, `load ${i + 1}`);
    }
  },

  "turning it off brings back Chrome's listing, also live": async (ctx) => {
    await setSettings(ctx, { folderView: false });
    const page = await newPage(ctx);
    await page.goto(TEST_FILES);
    await sleep(500);
    assert.equal(await page.$('#fn-explorer'), null);
    await setSettings(ctx, {});
    await page.reload();
    await page.waitForSelector('#fn-explorer .fn-row');
    await setSettings(ctx, { folderView: false });
    await until(() => page.evaluate(() => getComputedStyle(document.getElementById('fn-explorer')).display === 'none'), { message: 'folder view hidden' });
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('table')).display), 'none');
    assert.equal(shown(page.url()), '(folder)');
  },
};
