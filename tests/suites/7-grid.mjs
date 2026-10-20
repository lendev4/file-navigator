// The folder view's thumbnail grid.

import assert from 'node:assert/strict';
import { TEST_FILES, newPage, setSettings, openFolder, selectedInFolder, tempFolder, inWorker, until, sleep, shown, pressAndSettle } from '../helpers.mjs';

const isGrid = (page) => page.$eval('#fn-explorer .fn-rows', (r) => r.classList.contains('fn-grid'));
const photoFolder = (n = 12) => tempFolder(Object.fromEntries([...Array(n)].map((_, i) => [`photo${i + 1}.png`, `@photo${[1, 2, 3, 10, 11, 20][i % 6]}.png`])));
const thumbLoaded = (page, i) => page.$$eval('#fn-explorer .fn-thumb img', (imgs, i) => !!imgs[i]?.getAttribute('src') && imgs[i].complete && imgs[i].naturalWidth > 0, i);

export default {
  'grid when most files are images or videos, list otherwise': async (ctx) => {
    const f = photoFolder();
    // Half images, half not: not "most".
    const mixed = tempFolder({ 'a.png': '@photo1.png', 'b.webm': '@clip1.webm', 'c.txt': 'text\n', 'd.pdf': '@document1.pdf' });
    try {
      await setSettings(ctx, {});
      const page = await newPage(ctx);
      await openFolder(page, f.url);
      assert.equal(await isGrid(page), true);
      await openFolder(page, mixed.url);
      assert.equal(await isGrid(page), false);
      await setSettings(ctx, { folderLayout: 'list' });
      await openFolder(page, f.url);
      assert.equal(await isGrid(page), false);
    } finally {
      f.remove();
      mixed.remove();
    }
  },

  'thumbnails load as they scroll into view': async (ctx) => {
    const f = photoFolder(80);
    try {
      await setSettings(ctx, {});
      const page = await newPage(ctx, { width: 900, height: 500 });
      await openFolder(page, f.url);
      await until(() => thumbLoaded(page, 0), { message: 'first thumbnail' });
      assert.equal(await page.$$eval('#fn-explorer .fn-thumb img', (imgs) => imgs.at(-1).hasAttribute('src')), false);
      await page.keyboard.press('End');
      await until(() => thumbLoaded(page, 79), { message: 'last thumbnail after scrolling' });
      assert.deepEqual(page.errors, []);
    } finally {
      f.remove();
    }
  },

  'videos show a frame, other files their icon': async (ctx) => {
    const f = tempFolder({ 'a.png': '@photo1.png', 'b.webm': '@clip1.webm', 'c.txt': 'text\n' });
    try {
      await setSettings(ctx, { folderLayout: 'grid' });
      const page = await newPage(ctx);
      await openFolder(page, f.url);
      await page.waitForFunction(() => document.querySelector('#fn-explorer .fn-thumb video')?.readyState >= 2);
      assert.equal(await page.$$eval('#fn-explorer .fn-thumb > .fn-icon', (icons) => icons.length), 1);
    } finally {
      f.remove();
    }
  },

  'arrow keys move in two dimensions; Enter opens, Backspace returns': async (ctx) => {
    const f = photoFolder();
    try {
      await setSettings(ctx, {});
      const page = await newPage(ctx, { width: 900, height: 600 });
      await openFolder(page, f.url);
      const labels = await page.$$eval('#fn-explorer .fn-label', (els) => els.map((e) => e.textContent));
      const columns = await page.$$eval('#fn-explorer .fn-row', (rows) => rows.filter((r) => r.offsetTop === rows[0].offsetTop).length);
      assert.ok(columns > 1, `several columns (${columns})`);
      await page.keyboard.press('ArrowRight');
      assert.equal(await selectedInFolder(page), labels[1]);
      await page.keyboard.press('ArrowDown');
      assert.equal(await selectedInFolder(page), labels[1 + columns]);
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowUp');
      assert.equal(await selectedInFolder(page), labels[0]);
      await page.keyboard.press('ArrowRight');
      assert.equal(await pressAndSettle(page, 'Enter', f.url), labels[1]);
      assert.equal(await pressAndSettle(page, 'Backspace', f.url), '(folder)');
      await page.waitForSelector('#fn-explorer .fn-selected');
      assert.equal(await selectedInFolder(page), labels[1]);
    } finally {
      f.remove();
    }
  },

  'the List / Grid switch is remembered for that folder': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    // Waits until the choice for a folder is stored.
    const stored = (folder, layout) =>
      until(() => inWorker(ctx, async (folder) => (await chrome.storage.local.get('folderLayouts')).folderLayouts?.[folder], new URL(folder).pathname).then((l) => l === layout), { message: `${layout} stored` });
    await openFolder(page, TEST_FILES);
    await page.click('#fn-explorer .fn-layout-grid');
    assert.equal(await isGrid(page), true);
    await stored(TEST_FILES, 'grid');
    await openFolder(page, TEST_FILES);
    assert.equal(await isGrid(page), true);
    await openFolder(page, TEST_FILES + 'subfolder/');
    // subfolder/ has one image, so "auto" shows it as a grid anyway; choose list there.
    await page.click('#fn-explorer .fn-layout-list');
    await stored(TEST_FILES + 'subfolder/', 'list');
    await openFolder(page, TEST_FILES);
    assert.equal(await isGrid(page), true);
    await openFolder(page, TEST_FILES + 'subfolder/');
    assert.equal(await isGrid(page), false);
    assert.equal(shown(page.url()), 'subfolder/');
  },
};
