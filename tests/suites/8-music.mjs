// The music player for audio files.

import assert from 'node:assert/strict';
import { TEST_FILES, newPage, setSettings, openFolder, selectedInFolder, waitForShown, until, sleep, shown, tempFolder } from '../helpers.mjs';

const MUSIC = TEST_FILES + 'music/';
const state = (page) =>
  page.evaluate(() => ({
    title: document.getElementById('title').textContent,
    artist: document.getElementById('artist').textContent,
    rows: [...document.querySelectorAll('#tracks li .name')].map((n) => n.firstChild.textContent),
    current: [...document.querySelectorAll('#tracks li')].findIndex((li) => li.classList.contains('current')),
    cover: document.getElementById('cover-img').hidden ? null : document.getElementById('cover-img').src,
  }));
const current = (page) => page.evaluate(() => decodeURIComponent(new URLSearchParams(location.search).get('file')).split('/').pop());

// The player's <audio> isn't in the page, so it's reached through its controls:
// the time shown, the play button's label, and seeking with the slider.
const isPlaying = (page) => page.$eval('#play', (b) => b.getAttribute('aria-label') === 'Pause');
async function skipToEnd(page) {
  await page.waitForFunction(() => document.getElementById('duration').textContent !== '0:00');
  await page.$eval('#seek', (s) => {
    s.value = 995;
    s.dispatchEvent(new Event('change'));
  });
}

async function openPlayer(ctx, page, file = '01 - Morning Light.mp3') {
  await page.goto(MUSIC);
  await page.waitForSelector('#fn-explorer .fn-row');
  await page.evaluate((file) => [...document.querySelectorAll('#fn-explorer .fn-row')].find((r) => r.title === file).click(), file);
  await waitForShown(page, 'player:music/' + file);
  await page.waitForFunction(() => document.querySelectorAll('#tracks li').length > 0);
}

export default {
  'audio opens in the player, with the folder as the playlist': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openPlayer(ctx, page);
    const { rows, current } = await state(page);
    // Names without track numbers; MP3 tags fill in as tracks are read.
    assert.deepEqual(rows.slice(1), ['Noon', 'evening song', 'Night']);
    assert.equal(current, 0);
    await until(() => isPlaying(page), { message: 'playing' });
    assert.deepEqual(page.errors, []);
  },

  'MP3 tags give title, artist, album and the embedded cover': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openPlayer(ctx, page);
    await until(async () => (await state(page)).title === 'Morning Light', { message: 'title from tags' });
    const s = await state(page);
    assert.equal(s.artist, 'The Test Tones · Test Album');
    assert.match(s.cover, /^blob:/);
    assert.equal(await page.$eval('#cover-img', (i) => i.complete && i.naturalWidth), 300);
    assert.equal(await page.title(), 'Morning Light · The Test Tones');
    assert.equal(await page.evaluate(() => navigator.mediaSession.metadata?.title), 'Morning Light');
  },

  'ID3v2.4 UTF-8 text, and the folder cover when there is no embedded one': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openPlayer(ctx, page, '02 - Noon.mp3');
    await until(async () => (await state(page)).title === 'Noon Über Alles ♪', { message: 'UTF-8 title' });
    assert.match((await state(page)).cover, /music\/cover\.jpg$/);
  },

  'plays on to the next track, and stops after the last': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openPlayer(ctx, page, '03_evening_song.ogg');
    await until(() => isPlaying(page));
    await skipToEnd(page);
    await until(async () => (await current(page)) === '04 Night.flac', { message: 'next track' });
    await until(() => isPlaying(page), { message: 'next track playing' });
    await skipToEnd(page);
    await until(async () => !(await isPlaying(page)), { message: 'stopped at the end' });
    assert.equal(await current(page), '04 Night.flac');
  },

  'repeat all goes round, repeat one plays the track again': async (ctx) => {
    await setSettings(ctx, { playerRepeat: 'all' });
    const page = await newPage(ctx);
    await openPlayer(ctx, page, '04 Night.flac');
    await skipToEnd(page);
    await until(async () => (await current(page)) === '01 - Morning Light.mp3', { message: 'wrapped to the first track' });
    await page.keyboard.press('r'); // all → one
    assert.equal(await page.evaluate(async () => (await chrome.storage.sync.get('playerRepeat')).playerRepeat), 'one');
    await skipToEnd(page);
    await sleep(1000);
    assert.equal(await current(page), '01 - Morning Light.mp3');
    await until(() => isPlaying(page), { message: 'playing again' });
  },

  'shuffle plays every track once': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openPlayer(ctx, page);
    await page.keyboard.press('s');
    assert.equal(await page.$eval('#shuffle', (b) => b.getAttribute('aria-pressed')), 'true');
    const seen = [await current(page)];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowRight');
      seen.push(await current(page));
    }
    assert.equal(new Set(seen).size, 4);
    // Past the last one, nothing changes (repeat is off).
    await page.keyboard.press('ArrowRight');
    assert.equal(await current(page), seen.at(-1));
  },

  'keys: Space pauses, ← restarts or goes back, Backspace returns to the folder': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await openPlayer(ctx, page, '02 - Noon.mp3');
    await until(() => isPlaying(page));
    await page.keyboard.press(' ');
    await until(async () => !(await isPlaying(page)), { message: 'paused' });
    await page.keyboard.press('ArrowLeft');
    assert.equal(await current(page), '01 - Morning Light.mp3');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Backspace');
    await until(() => shown(page.url()) === 'music/', { message: 'folder' });
    await page.waitForSelector('#fn-explorer .fn-selected');
    assert.equal(await selectedInFolder(page), '02 - Noon.mp3');
  },

  'opening an audio file directly goes to the player; off means Chrome\'s player': async (ctx) => {
    await setSettings(ctx, {});
    const page = await newPage(ctx);
    await page.goto(MUSIC + '04 Night.flac');
    await waitForShown(page, 'player:music/04 Night.flac');
    await setSettings(ctx, { musicPlayer: false });
    await openFolder(page, MUSIC);
    await page.keyboard.type('04');
    await page.keyboard.press('Enter');
    await waitForShown(page, 'music/04 Night.flac');
    assert.equal(await page.$('audio, video') !== null, true);
  },

  'unplayable files are skipped': async (ctx) => {
    const f = tempFolder({ 'a.mp3': 'not really an mp3', 'b.wav': '@tone1.wav' });
    try {
      await setSettings(ctx, {});
      const page = await newPage(ctx);
      await page.goto(f.url + 'a.mp3');
      await until(() => page.url().includes('player.html'), { message: 'player' });
      await page.waitForSelector('#message:not([hidden])');
      await until(async () => (await current(page)) === 'b.wav', { timeout: 4000, message: 'skipped to b.wav' });
      assert.equal(await page.$eval('#tracks li', (li) => li.classList.contains('unplayable')), true);
    } finally {
      f.remove();
    }
  },
};
