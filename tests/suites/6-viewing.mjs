// Viewing images: fullscreen, slideshow and zoom.

import assert from 'node:assert/strict';
import { newPage, setSettings, tempFolder, waitForShown, inWorker, barVisible, until, sleep, shown } from '../helpers.mjs';

const photos = () => tempFolder({ 'photo1.png': '@photo1.png', 'photo2.png': '@photo2.png', 'photo3.png': '@photo3.png' });
const windowState = (ctx) => inWorker(ctx, async () => (await chrome.windows.getAll()).find((w) => w.type === 'normal')?.state);
const imgWidth = (page) => page.$eval('img', (i) => Math.round(i.getBoundingClientRect().width));

export default {
  'F switches to fullscreen, which lasts while stepping; Esc leaves it': async (ctx) => {
    const f = photos();
    try {
      await setSettings(ctx, { fileBar: 'always' });
      const page = await newPage(ctx);
      await page.goto(f.url + 'photo1.png');
      await waitForShown(page, 'photo1.png', f.url);
      await page.keyboard.press('f');
      await until(async () => (await windowState(ctx)) === 'fullscreen', { message: 'fullscreen window' });
      // The bar gets out of the way, and comes back near the top.
      await until(async () => !(await barVisible(page)), { message: 'bar hidden in fullscreen' });
      await page.mouse.move(300, 300);
      await page.mouse.move(300, 10);
      await until(() => barVisible(page), { message: 'bar shown near the top' });
      await page.mouse.move(300, 300);
      await page.keyboard.press('ArrowRight');
      await waitForShown(page, 'photo2.png', f.url);
      assert.equal(await windowState(ctx), 'fullscreen');
      assert.equal(await barVisible(page), false);
      await page.keyboard.press('Escape');
      await until(async () => (await windowState(ctx)) !== 'fullscreen', { message: 'fullscreen left' });
      await until(() => barVisible(page), { message: 'bar back' });
    } finally {
      f.remove();
    }
  },

  'Space runs a slideshow to the end of the folder': async (ctx) => {
    const f = photos();
    try {
      await setSettings(ctx, { slideshowSeconds: 1 });
      const page = await newPage(ctx);
      await page.goto(f.url + 'photo1.png');
      await waitForShown(page, 'photo1.png', f.url);
      await page.keyboard.press(' ');
      await until(() => shown(page.url(), f.url) === 'photo2.png', { timeout: 4000, message: 'photo2' });
      await until(() => shown(page.url(), f.url) === 'photo3.png', { timeout: 4000, message: 'photo3' });
      // Stops at the last file instead of going round.
      await sleep(2000);
      assert.equal(shown(page.url(), f.url), 'photo3.png');
      assert.equal(await inWorker(ctx, async () => Object.values(await chrome.storage.session.get(null)).includes(true)), false);
    } finally {
      f.remove();
    }
  },

  'Space again stops the slideshow': async (ctx) => {
    const f = photos();
    try {
      await setSettings(ctx, { slideshowSeconds: 1 });
      const page = await newPage(ctx);
      await page.goto(f.url + 'photo1.png');
      await waitForShown(page, 'photo1.png', f.url);
      await page.keyboard.press(' ');
      await sleep(200);
      await page.keyboard.press(' ');
      await sleep(1800);
      assert.equal(shown(page.url(), f.url), 'photo1.png');
    } finally {
      f.remove();
    }
  },

  'zoom with + - 0 1, keeping the image scrollable': async (ctx) => {
    await setSettings(ctx, {});
    const f = photos();
    try {
      const page = await newPage(ctx, { width: 300, height: 200 });
      await page.goto(f.url + 'photo2.png'); // 480 × 320, fitted to 300 × 200
      await waitForShown(page, 'photo2.png', f.url);
      assert.equal(await imgWidth(page), 300);
      await page.keyboard.press('1');
      assert.equal(await imgWidth(page), 480);
      await page.keyboard.press('+');
      assert.equal(await imgWidth(page), 600);
      assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth), 'scrolls sideways');
      await page.keyboard.press('-');
      assert.equal(await imgWidth(page), 480);
      await page.keyboard.press('0');
      assert.equal(await imgWidth(page), 300);
      assert.deepEqual(page.errors, []);
    } finally {
      f.remove();
    }
  },
};
