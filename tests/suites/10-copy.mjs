// Ctrl+C: paths from the folder view and file pages, images from image pages.

import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, TEST_FILES, newPage, setSettings, openFolder, selectedInFolder, waitForShown, viewerUrl, until, sleep } from '../helpers.mjs';

async function allowClipboard(ctx) {
  await ctx.browser.defaultBrowserContext().overridePermissions('file://', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  await ctx.browser.defaultBrowserContext().overridePermissions(`chrome-extension://${ctx.id}`, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
}

async function ctrlC(page) {
  // Something else first, so a copy that doesn't happen can't pass.
  await page.evaluate(() => navigator.clipboard.writeText('(nothing copied)'));
  await page.keyboard.down('Control');
  await page.keyboard.press('c');
  await page.keyboard.up('Control');
  await sleep(300);
}

const clipboardText = (page) => page.evaluate(() => navigator.clipboard.readText());
const testFile = (name) => path.join(ROOT, 'test-files', name);

export default {
  'folder view: Ctrl+C copies the selected path': async (ctx) => {
    await setSettings(ctx, {});
    await allowClipboard(ctx);
    const page = await newPage(ctx);
    await openFolder(page);
    await page.keyboard.type('notes');
    await until(async () => (await selectedInFolder(page)) === 'notes.txt');
    await ctrlC(page);
    assert.equal(await clipboardText(page), testFile('notes.txt'));
    assert.equal(await page.$eval('#fn-explorer .fn-count', (e) => e.textContent), `Copied ${testFile('notes.txt')}`);
    // Folders without the trailing slash.
    await page.keyboard.press('Home');
    await ctrlC(page);
    assert.equal(await clipboardText(page), testFile(await selectedInFolder(page)));
  },

  'folder view: selected text in the filter box is copied as usual': async (ctx) => {
    await setSettings(ctx, {});
    await allowClipboard(ctx);
    const page = await newPage(ctx);
    await openFolder(page);
    await page.keyboard.press('/');
    await page.keyboard.type('clip');
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await ctrlC(page);
    assert.equal(await clipboardText(page), 'clip');
  },

  'images: Ctrl+C copies the image, also SVGs': async (ctx) => {
    await setSettings(ctx, {});
    await allowClipboard(ctx);
    const page = await newPage(ctx);
    for (const name of ['photo2.png', 'drawing1.svg']) {
      await page.goto(TEST_FILES + name);
      await waitForShown(page, name);
      await ctrlC(page);
      const copied = await until(
        () => page.evaluate(async () => {
          const [item] = await navigator.clipboard.read();
          if (!item.types.includes('image/png')) return null;
          const bitmap = await createImageBitmap(await item.getType('image/png'));
          return `${bitmap.width}x${bitmap.height}`;
        }),
        { message: `${name} on the clipboard` }
      );
      assert.equal(copied, '480x320', name);
    }
  },

  'text files: the path, unless text is selected': async (ctx) => {
    await setSettings(ctx, {});
    await allowClipboard(ctx);
    const page = await newPage(ctx);
    await page.goto(TEST_FILES + 'notes.txt');
    await waitForShown(page, 'notes.txt');
    await ctrlC(page);
    assert.equal(await clipboardText(page), testFile('notes.txt'));
    await page.evaluate(() => getSelection().selectAllChildren(document.querySelector('pre')));
    await ctrlC(page);
    assert.match(await clipboardText(page), /^Plain text file\./);
  },

  "viewer and music player: the file's own path": async (ctx) => {
    await setSettings(ctx, {});
    await allowClipboard(ctx);
    const page = await newPage(ctx);
    await page.goto(viewerUrl(ctx, TEST_FILES + 'table.csv'));
    await page.waitForSelector('.csv table');
    await ctrlC(page);
    assert.equal(await clipboardText(page), testFile('table.csv'));
    await page.goto(`chrome-extension://${ctx.id}/player.html?file=${encodeURIComponent(TEST_FILES + 'music/02 - Noon.mp3')}`);
    await page.waitForFunction(() => document.querySelectorAll('#tracks li').length);
    await ctrlC(page);
    assert.equal(await clipboardText(page), testFile('music/02 - Noon.mp3'));
  },
};
