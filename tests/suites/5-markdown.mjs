// Markdown files, rendered in the viewer.

import assert from 'node:assert/strict';
import { TEST_FILES, newPage, setSettings, openFolder, selectedInFolder, groupOf, inExtension, waitForShown, pressAndSettle, viewerUrl, until, sleep, shown } from '../helpers.mjs';

const view = (page) =>
  page.evaluate(() => (document.getElementById('fn-rendered').hidden ? 'source' : 'rendered'));

async function openGuide(ctx, page) {
  await page.goto(viewerUrl(ctx, TEST_FILES + 'guide.md'));
  await page.waitForSelector('#fn-view-switch:not([hidden])');
}

async function clickAndSettle(page, selector) {
  const before = page.url();
  await page.click(selector);
  await until(() => page.url() !== before, { message: `navigation after clicking ${selector}` });
  await page.waitForFunction(() => document.readyState !== 'loading');
  await sleep(300);
  return shown(page.url());
}

export default {
  'renders and sanitises Markdown': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openGuide(ctx, page);
    assert.equal(await view(page), 'rendered');
    // guide.md contains a <script> and an <img onerror> that would change the title.
    assert.equal(await page.title(), 'guide.md');
    assert.equal(await page.$$eval('#fn-rendered script, #fn-rendered [onerror]', (e) => e.length), 0);
    assert.equal(await page.$eval('#fn-rendered img[alt="Photo 1"]', (i) => i.complete && i.naturalWidth), 480);
    assert.deepEqual(await page.$$eval('#fn-rendered h2', (hs) => hs.map((h) => h.id)), ['text', 'lists', 'a-table', 'code', 'an-image', 'raw-html']);
  },

  'highlights code blocks with a known language only': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openGuide(ctx, page);
    await page.waitForFunction(() => document.querySelector('#fn-rendered code.hljs'));
    const blocks = await page.$$eval('#fn-rendered pre > code', (cs) =>
      cs.map((c) => [(c.className.match(/language-(\S+)/) || [, ''])[1], c.classList.contains('hljs')]));
    assert.deepEqual(blocks, [['js', true], ['python', true], ['bash', true], ['diff', true], ['', false], ['klingon', false]]);
    // Not loaded where there's nothing to highlight.
    await page.goto(viewerUrl(ctx, TEST_FILES + 'readme.md'));
    await page.waitForSelector('#fn-view-switch:not([hidden])');
    assert.equal(await page.evaluate(() => typeof hljs), 'undefined');
  },

  'Rendered/Source switch is remembered and stays in place': async (ctx) => {
    await setSettings(ctx, { fileBar: 'always' });
    const page = await newPage(ctx, { width: 1000 });
    await openGuide(ctx, page);
    const position = () => page.$eval('#fn-view-switch', (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
    const rendered = await position();
    await page.click('#fn-view-switch [data-view="source"]');
    assert.equal(await view(page), 'source');
    assert.deepEqual(await position(), rendered);
    await page.reload();
    await page.waitForSelector('#fn-view-switch:not([hidden])');
    assert.equal(await view(page), 'source');
  },

  'setting opens Markdown as source': async (ctx) => {
    await setSettings(ctx, { markdownView: 'source' });
    const page = await newPage(ctx);
    await openGuide(ctx, page);
    assert.equal(await view(page), 'source');
  },

  'links: headings, text files, folders, viewer formats, other Markdown': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openGuide(ctx, page);
    await page.click('a[href="#a-table"]');
    await sleep(300);
    assert.ok(Math.abs((await page.$eval('#a-table', (h) => h.getBoundingClientRect().top)) - 60) <= 2);
    for (const [href, expected] of [['notes.txt', 'notes.txt'], ['subfolder/', 'subfolder/'], ['table.csv', 'viewer:table.csv'], ['readme.md', 'viewer:readme.md']]) {
      await openGuide(ctx, page);
      assert.equal(await clickAndSettle(page, `#fn-rendered a[href$="${href}"]`), expected);
    }
  },

  'Ctrl+click on a link opens a background tab': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openGuide(ctx, page);
    const before = (await ctx.browser.pages()).length;
    await page.keyboard.down('Control');
    await page.click('#fn-rendered a[href$="notes.txt"]');
    await page.keyboard.up('Control');
    await until(async () => (await ctx.browser.pages()).length === before + 1, { message: 'new tab' });
    assert.equal(shown(page.url()), 'viewer:guide.md');
  },

  'opening a .md file directly renders it; Back skips the redirect': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await page.goto(TEST_FILES + 'notes.txt');
    await waitForShown(page, 'notes.txt');
    await page.goto(TEST_FILES + 'guide.md');
    await waitForShown(page, 'viewer:guide.md');
    assert.equal(await view(page), 'rendered');
    await page.goBack();
    await waitForShown(page, 'notes.txt');
    // A #fragment jumps to that heading.
    await page.goto(TEST_FILES + 'guide.md#lists');
    await waitForShown(page, 'viewer:guide.md#lists');
    assert.ok(Math.abs((await page.$eval('#lists', (h) => h.getBoundingClientRect().top)) - 60) <= 2);
  },

  'arrow keys step from Markdown to the next text file': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    const texts = await groupOf(ctx, 'guide.md');
    const next = texts[texts.indexOf('guide.md') + 1];
    const viewer = await inExtension(ctx, (url) => openUrl(url) !== url, TEST_FILES + next);
    await openFolder(page);
    await page.keyboard.type('guide');
    await until(async () => (await selectedInFolder(page)) === 'guide.md');
    await page.keyboard.press('Enter');
    await waitForShown(page, 'viewer:guide.md');
    assert.equal(await pressAndSettle(page, 'ArrowRight'), (viewer ? 'viewer:' : '') + next);
    assert.equal(await pressAndSettle(page, 'ArrowLeft'), 'viewer:guide.md');
    assert.equal(await view(page), 'rendered');
  },

  'no sideways scrolling on narrow screens': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx, { width: 420 });
    await openGuide(ctx, page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  },
};
