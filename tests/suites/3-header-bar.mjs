// The header bar on file pages: when it shows, its buttons, and how pages make
// room for it.

import assert from 'node:assert/strict';
import { TEST_FILES, newPage, setSettings, openFolder, selectedInFolder, groupOf, waitForShown, pressAndSettle, barVisible, barButton, until, sleep, shown } from '../helpers.mjs';

// Opens `name` from the folder view by typing its name and pressing Enter.
async function openFromFolder(page, name) {
  await openFolder(page);
  await page.keyboard.type(name);
  await until(async () => (await selectedInFolder(page)) === name, { message: `${name} selected` });
  await page.keyboard.press('Enter');
  await waitForShown(page, name);
}

async function click(page, which) {
  const before = page.url();
  await page.mouse.click(...barButton(page, which));
  await until(() => page.url() !== before, { timeout: 1500 }).catch(() => {});
  await sleep(400);
  return shown(page.url());
}

const rect = (page, selector) => page.$eval(selector, (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), height: Math.round(r.height) }; });

export default {
  'shown for files opened from the folder view, kept while stepping': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    const images = await groupOf(ctx, 'photo1.png');
    await openFromFolder(page, 'photo1.png');
    assert.equal(await barVisible(page), true);
    const next = images[images.indexOf('photo1.png') + 1];
    assert.equal(await pressAndSettle(page, 'ArrowRight'), next);
    assert.equal(await barVisible(page), true);
    assert.equal(await pressAndSettle(page, 'Backspace'), '(folder)');
    await page.waitForSelector('#fn-explorer .fn-selected');
    assert.equal(await selectedInFolder(page), next);
  },

  'not shown for files opened directly': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await page.goto(TEST_FILES + 'notes.txt');
    await waitForShown(page, 'notes.txt');
    assert.equal(await barVisible(page), false);
  },

  'shown for files opened by mouse click': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openFolder(page);
    await page.evaluate(() => [...document.querySelectorAll('#fn-explorer .fn-row')].find((r) => r.title === 'notes.txt').scrollIntoView());
    await page.click('#fn-explorer .fn-row[title="notes.txt"]');
    await waitForShown(page, 'notes.txt');
    assert.equal(await barVisible(page), true);
  },

  '"always" and "never" modes': async (ctx) => {
    const page = await newPage(ctx);
    await setSettings(ctx, { fileBar: 'always' });
    await page.goto(TEST_FILES + 'notes.txt');
    await waitForShown(page, 'notes.txt');
    assert.equal(await barVisible(page), true);
    await setSettings(ctx, { fileBar: 'never' });
    await openFromFolder(page, 'photo1.png');
    assert.equal(await barVisible(page), false);
  },

  '‹ › buttons step, and do nothing past the last file': async (ctx) => {
    await setSettings(ctx, { fileBar: 'always' });
    const page = await newPage(ctx);
    const images = await groupOf(ctx, 'photo3.png');
    await page.goto(TEST_FILES + 'photo3.png');
    await waitForShown(page, 'photo3.png');
    const next = images[images.indexOf('photo3.png') + 1];
    assert.equal(await click(page, 'next'), next);
    assert.equal(await click(page, 'prev'), 'photo3.png');
    await page.goto(TEST_FILES + images.at(-1));
    await waitForShown(page, images.at(-1));
    assert.equal(await click(page, 'next'), images.at(-1));
  },

  'SVG files get the bar and arrow keys': async (ctx) => {
    await setSettings(ctx, { fileBar: 'always' });
    const page = await newPage(ctx);
    const images = await groupOf(ctx, 'drawing1.svg');
    await page.goto(TEST_FILES + 'drawing1.svg');
    await waitForShown(page, 'drawing1.svg');
    assert.equal(await barVisible(page), true);
    assert.equal(await pressAndSettle(page, 'ArrowRight'), images[images.indexOf('drawing1.svg') + 1]);
    assert.deepEqual(page.errors, []);
  },

  'images fit below the bar and still zoom': async (ctx) => {
    await setSettings(ctx, { fileBar: 'always' });
    const page = await newPage(ctx, { width: 900, height: 320 });
    await page.goto(TEST_FILES + 'photo2.png'); // 480 × 320
    await waitForShown(page, 'photo2.png');
    assert.deepEqual(await rect(page, 'img'), { top: 44, height: 276 });
    await page.setViewport({ width: 900, height: 600 });
    await sleep(200);
    assert.deepEqual(await rect(page, 'img'), { top: 44 + (600 - 44 - 320) / 2, height: 320 });
    await page.setViewport({ width: 300, height: 200 });
    await sleep(200);
    await page.mouse.click(150, 120); // Chrome zooms a shrunk image to 100 %
    await sleep(300);
    assert.equal((await rect(page, 'img')).height, 320);
  },

  'text pages, JSON and PDF make room for the bar': async (ctx) => {
    const page = await newPage(ctx);
    const textTop = async () => (await rect(page, 'pre')).top;
    await setSettings(ctx, { fileBar: 'never' });
    await page.goto(TEST_FILES + 'data.json');
    await waitForShown(page, 'data.json');
    const plain = { pre: await textTop(), strip: (await rect(page, '.json-formatter-container')).top };
    await setSettings(ctx, { fileBar: 'always' });
    await page.reload();
    await waitForShown(page, 'data.json');
    // Chrome's pretty-print strip moves below the bar, the text keeps its distance.
    assert.equal((await rect(page, '.json-formatter-container')).top, plain.strip + 44);
    assert.equal(await textTop(), plain.pre + 44);
    await page.goto(TEST_FILES + 'document1.pdf');
    await waitForShown(page, 'document1.pdf');
    assert.equal((await rect(page, 'body')).top, 44);
  },
};
