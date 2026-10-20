// Stepping between the files of a folder with the keyboard, and the settings
// that change the order.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newPage, setSettings, tempFolder, waitForShown, pressAndSettle } from '../helpers.mjs';

// A small folder with known names and modification dates:
// photo3 is the oldest, then photo10, photo1, photo2.
function folder() {
  const f = tempFolder({
    'photo1.png': '@photo1.png',
    'photo2.png': '@photo2.png',
    'photo3.png': '@photo3.png',
    'photo10.png': '@photo10.png',
    '.hidden.png': '@photo1.png',
    'notes.txt': 'Some notes.\n',
    'clip.webm': '@clip1.webm',
  });
  const dates = { 'photo3.png': '2024-01-01', 'photo10.png': '2024-02-01', 'photo1.png': '2024-03-01', 'photo2.png': '2024-04-01' };
  for (const [name, date] of Object.entries(dates)) fs.utimesSync(path.join(f.dir, name), new Date(date), new Date(date));
  return f;
}

async function walk(ctx, settings, start, keys) {
  const f = folder();
  try {
    await setSettings(ctx, settings);
    const page = await newPage(ctx);
    await page.goto(f.url + start);
    await waitForShown(page, start, f.url);
    const seen = [start];
    for (const key of keys) seen.push(await pressAndSettle(page, key, f.url));
    assert.deepEqual(page.errors, []);
    return seen;
  } finally {
    f.remove();
  }
}

const right = (n) => Array(n).fill('ArrowRight');

export default {
  'natural name order, stopping at the last file': async (ctx) => {
    assert.deepEqual(await walk(ctx, {}, 'photo1.png', right(4)), ['photo1.png', 'photo2.png', 'photo3.png', 'photo10.png', 'photo10.png']);
  },

  'sort by date modified, both directions': async (ctx) => {
    assert.deepEqual(await walk(ctx, { sortBy: 'mtime' }, 'photo3.png', right(3)), ['photo3.png', 'photo10.png', 'photo1.png', 'photo2.png']);
    assert.deepEqual(await walk(ctx, { sortBy: 'mtime', sortDir: 'desc' }, 'photo2.png', right(3)), ['photo2.png', 'photo1.png', 'photo10.png', 'photo3.png']);
  },

  'wrap around at both ends': async (ctx) => {
    assert.deepEqual(await walk(ctx, { wrap: true }, 'photo3.png', ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft']), ['photo3.png', 'photo10.png', 'photo1.png', 'photo10.png', 'photo3.png']);
  },

  'hidden files only when enabled': async (ctx) => {
    assert.deepEqual(await walk(ctx, {}, 'photo1.png', ['ArrowLeft']), ['photo1.png', 'photo1.png']);
    assert.deepEqual(await walk(ctx, { showHidden: true }, 'photo1.png', ['ArrowLeft']), ['photo1.png', '.hidden.png']);
  },

  'Home and End jump to the first and last image': async (ctx) => {
    assert.deepEqual(await walk(ctx, {}, 'photo2.png', ['End', 'Home']), ['photo2.png', 'photo10.png', 'photo1.png']);
  },

  'grouping "all viewable files" mixes kinds': async (ctx) => {
    assert.deepEqual(await walk(ctx, { grouping: 'all' }, 'notes.txt', ['ArrowRight', 'ArrowLeft', 'ArrowLeft']), ['notes.txt', 'photo1.png', 'notes.txt', 'clip.webm']);
  },

  'settings page shows and saves settings': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await page.goto(`chrome-extension://${ctx.id}/options.html`);
    await page.waitForSelector('#commands tr');
    assert.equal(await page.$eval('#sortBy', (e) => e.value), 'name');
    assert.equal(await page.$eval('[name="folderView"]', (e) => e.checked), true);
    await page.select('#sortBy', 'size');
    await page.waitForFunction(async () => (await chrome.storage.sync.get('sortBy')).sortBy === 'size');
    // Previous / next file, and opening the folder view (the toolbar icon's shortcut).
    const commands = await page.$$eval('#commands tr', (rows) => rows.map((r) => r.cells[1].textContent));
    assert.equal(commands.length, 3);
    assert.ok(commands.some((c) => c.startsWith('Open the folder view')));
    assert.deepEqual(page.errors, []);
  },
};
