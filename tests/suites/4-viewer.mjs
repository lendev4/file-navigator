// The extension's viewer for files Chrome would download: text formats, CSV
// and TSV tables, and .mov videos.

import assert from 'node:assert/strict';
import { TEST_FILES, newPage, setSettings, openFolder, selectedInFolder, groupOf, inExtension, waitForShown, pressAndSettle, viewerUrl, barButton, tempFolder, until, sleep, shown } from '../helpers.mjs';

// What a file in the group shows as: in the viewer or as itself.
const asShown = async (ctx, name) =>
  ((await inExtension(ctx, (url) => openUrl(url) !== url, TEST_FILES + name)) ? 'viewer:' : '') + name;

async function openFromFolder(page, name) {
  await openFolder(page);
  await page.keyboard.type(name);
  await until(async () => (await selectedInFolder(page)) === name, { message: `${name} selected` });
  await page.keyboard.press('Enter');
}

const table = (page) =>
  page.evaluate(() => ({
    rows: [...document.querySelectorAll('.csv tr')].map((tr) => [...tr.cells].map((c) => c.textContent)),
    numeric: [...document.querySelectorAll('.csv thead th')].map((th) => th.classList.contains('num')),
    note: document.querySelector('.csv-note')?.textContent,
  }));

export default {
  'text formats Chrome downloads open in the viewer': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    for (const [name, start] of [['config.toml', 'title = '], ['list.yaml', 'name: test']]) {
      await openFromFolder(page, name);
      await waitForShown(page, 'viewer:' + name);
      assert.ok((await page.$eval('#fn-text', (e) => e.textContent)).startsWith(start), name);
    }
    assert.deepEqual(page.errors, []);
  },

  'arrow keys step in and out of the viewer, Backspace returns': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    const texts = await groupOf(ctx, 'notes.txt');
    const i = texts.indexOf('table.csv');
    await openFromFolder(page, 'table.csv');
    await waitForShown(page, 'viewer:table.csv');
    assert.equal(await pressAndSettle(page, 'ArrowLeft'), await asShown(ctx, texts[i - 1]));
    assert.equal(await pressAndSettle(page, 'ArrowRight'), 'viewer:table.csv');
    assert.equal(await pressAndSettle(page, 'Backspace'), '(folder)');
    await page.waitForSelector('#fn-explorer .fn-selected');
    assert.equal(await selectedInFolder(page), 'table.csv');
  },

  'Ctrl+Enter opens a background tab through the viewer': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openFolder(page);
    await page.keyboard.type('table.csv');
    const before = (await ctx.browser.pages()).length;
    await page.keyboard.down('Control');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Control');
    await until(async () => (await ctx.browser.pages()).length === before + 1, { message: 'new tab' });
    const opened = (await ctx.browser.pages()).at(-1);
    await until(() => shown(opened.url()) === 'viewer:table.csv', { message: 'new tab to show table.csv' });
    assert.equal(shown(page.url()), '(folder)');
  },

  'CSV with semicolons, quotes and line breaks becomes a table': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await page.goto(viewerUrl(ctx, TEST_FILES + 'umsatz.csv'));
    await page.waitForSelector('.csv table');
    const { rows, numeric, note } = await table(page);
    assert.deepEqual(rows, [
      ['', 'Name', 'Stadt', 'Betrag', 'Anteil'],
      ['1', 'Müller', 'Berlin; Mitte', '1.234,56', '12%'],
      ['2', 'Schmidt, Anna', 'Köln', '-89,90', '3%'],
      ['3', 'Zitat "mit" Anführungszeichen', 'Zeile 1\nZeile 2', '0,5', '0%'],
    ]);
    assert.deepEqual(numeric, [false, false, false, true, true]);
    assert.equal(note, '3 rows');
  },

  'TSV becomes a table': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await page.goto(viewerUrl(ctx, TEST_FILES + 'fruit.tsv'));
    await page.waitForSelector('.csv table');
    const { rows, numeric } = await table(page);
    assert.deepEqual(rows[3], ['3', '3', 'cherry, sweet', '12']);
    assert.deepEqual(numeric, [false, true, false, true]);
  },

  'Table/Source switch and the CSV setting': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await page.goto(viewerUrl(ctx, TEST_FILES + 'table.csv'));
    await page.waitForSelector('.csv table');
    await page.click('#fn-view-switch [data-view="source"]');
    assert.equal(await page.$eval('#fn-text', (e) => !e.hidden && e.textContent.startsWith('name,value')), true);
    await setSettings(ctx, { csvView: 'source' });
    await page.goto(viewerUrl(ctx, TEST_FILES + 'table.csv'));
    await page.waitForSelector('#fn-view-switch:not([hidden])');
    assert.equal(await page.$eval('#fn-rendered', (e) => e.hidden), true);
  },

  'large CSV files show the first 5,000 rows, header stays in view': async (ctx) => {
    let csv = 'id,name\n';
    for (let i = 0; i < 6000; i++) csv += `${i},Person ${i}\n`;
    const f = tempFolder({ 'big.csv': csv });
    try {
      await setSettings(ctx, { fileBar: 'always' });
      const page = await newPage(ctx, { height: 400 });
      await page.goto(viewerUrl(ctx, f.url + 'big.csv'));
      await page.waitForSelector('.csv table');
      assert.equal(await page.$$eval('.csv tbody tr', (r) => r.length), 5000);
      assert.match((await table(page)).note, /5[.,]?000 of 6[.,]?000 rows/);
      await page.evaluate(() => scrollTo(0, 3000));
      await sleep(100);
      assert.equal(await page.$eval('.csv th', (th) => Math.round(th.getBoundingClientRect().top)), 44);
    } finally {
      f.remove();
    }
  },

  '.mov videos play; unsupported codecs show a message': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openFromFolder(page, 'movie-h264.mov');
    await waitForShown(page, 'viewer:movie-h264.mov');
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
    assert.equal(await page.$eval('video', (v) => `${v.videoWidth}x${v.videoHeight}`), '640x360');
    await openFromFolder(page, 'movie-prores.mov');
    await waitForShown(page, 'viewer:movie-prores.mov');
    await page.waitForSelector('.video-error');
  },

  '‹ › step between .mp4 and .mov videos': async (ctx) => {
    await setSettings(ctx, { fileBar: 'always' });
    const page = await newPage(ctx);
    const videos = await groupOf(ctx, 'clip1.webm');
    const mov = videos.findIndex((n) => n.endsWith('.mov'));
    const before = videos[mov - 1];
    await page.goto(TEST_FILES + before);
    await waitForShown(page, before);
    await page.mouse.click(...barButton(page, 'next'));
    await waitForShown(page, 'viewer:' + videos[mov]);
    await page.mouse.click(...barButton(page, 'prev'));
    await waitForShown(page, before);
  },
};
