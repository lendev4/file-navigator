// Opening the folder view from the toolbar icon or Alt+Shift+E.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, TEST_FILES, newPage, setSettings, openFolder, inWorker, until, sleep } from '../helpers.mjs';

// What the extension should guess as the home folder on this machine.
function expectedHome() {
  const base = { darwin: '/Users', win32: 'C:\\Users' }[process.platform] || '/home';
  const shared = /^(shared|public|default|default user|all users|guest|lost\+found)$/i;
  const homes = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && !shared.test(d.name));
  return homes.length === 1 ? pathToFileURL(path.join(base, homes[0].name)).href + '/' : process.platform === 'win32' ? 'file:///C:/' : 'file:///';
}

// Does what clicking the icon does (headless Chrome has no toolbar to click),
// and returns the URL of the tab it opens.
async function clickIcon(ctx) {
  const before = new Set(await ctx.browser.pages());
  await inWorker(ctx, async () => openExplorer((await chrome.tabs.query({ active: true }))[0]));
  const page = await until(async () => (await ctx.browser.pages()).find((p) => !before.has(p)), { message: 'a new tab' });
  await until(() => page.url().startsWith('file://') || page.url().startsWith('chrome-extension://'), { message: 'the new tab to load' });
  return page.url();
}

export default {
  'Alt+Shift+E is assigned to the toolbar icon': async (ctx) => {
    const shortcut = await inWorker(ctx, async () => (await chrome.commands.getAll()).find((c) => c.name === '_execute_action')?.shortcut);
    assert.ok(shortcut, 'a shortcut is assigned');
    assert.match(shortcut, /E$/);
  },

  // Without the "tabs" permission, the shortcuts still need the address of
  // file pages and of the extension's own viewer and player tabs.
  'the background can read the tab addresses the shortcuts need': async (ctx) => {
    const page = await newPage(ctx);
    for (const url of [TEST_FILES + 'notes.txt', `chrome-extension://${ctx.id}/viewer.html?file=${encodeURIComponent(TEST_FILES + 'table.csv')}`]) {
      await page.goto(url);
      await sleep(300);
      const urls = await inWorker(ctx, async () => (await chrome.tabs.query({})).map((t) => t.url));
      assert.ok(urls.includes(url), `${url} in ${JSON.stringify(urls)}`);
    }
  },

  'opens the home folder at first': async (ctx) => {
    await setSettings(ctx, {});
    assert.equal(await clickIcon(ctx), expectedHome());
  },

  'opens the last folder browsed': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openFolder(page, TEST_FILES + 'music/');
    await sleep(200);
    assert.equal(await clickIcon(ctx), TEST_FILES + 'music/');
  },

  'the start folder setting: a path, ~ and a file URL': async (ctx) => {
    const testFiles = path.join(ROOT, 'test-files');
    for (const [setting, expected] of [
      [testFiles, TEST_FILES],
      [testFiles + '/music/', TEST_FILES + 'music/'],
      ['~', expectedHome()],
      [TEST_FILES + 'subfolder', TEST_FILES + 'subfolder/'],
    ]) {
      await setSettings(ctx, { startFolder: setting });
      assert.equal(await clickIcon(ctx), expected, setting);
    }
  },

  'the settings page shows where it opens; ⚙ in the folder view opens it': async (ctx) => {
    await setSettings(ctx, { startFolder: path.join(ROOT, 'test-files') });
    const page = await newPage(ctx);
    await page.goto(`chrome-extension://${ctx.id}/options.html`);
    await until(async () => (await page.$eval('#start-folder-now', (e) => e.textContent)) !== '…', { message: 'start folder shown' });
    assert.equal(await page.$eval('#start-folder-now', (e) => e.textContent), path.join(ROOT, 'test-files') + '/');
    await openFolder(page, TEST_FILES);
    const before = (await ctx.browser.pages()).length;
    await page.click('#fn-explorer .fn-settings');
    await until(async () => (await ctx.browser.pages()).some((p) => p.url().endsWith('/options.html')), { message: 'settings page' });
    assert.ok((await ctx.browser.pages()).length > before);
  },
};
