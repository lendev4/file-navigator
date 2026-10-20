// Makes the Chrome Web Store images in store/: the store icon, screenshots
// (1280 × 800) of a generated demo folder, and the small promo tile (440 × 280).
//   mise exec -- npm run store      (needs ffmpeg for the demo photos)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// The screenshots use a copy of the extension with a proportional font ahead of
// system-ui, which is monospaced on some desktops. Set before loading helpers.
const FONT = process.env.STORE_FONT || 'Adwaita Sans';
const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filenav-store-ext-'));
for (const file of execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)) {
  if (/^(tests|test-files|store)\//.test(file)) continue;
  const target = path.join(copyDir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const content = fs.readFileSync(path.join(ROOT, file));
  if (/\.(css|js|html)$/.test(file) && !file.startsWith('vendor/')) {
    fs.writeFileSync(target, content.toString().replaceAll('system-ui,', `'${FONT}', system-ui,`));
  } else fs.writeFileSync(target, content);
}
process.env.EXTENSION_PATH = copyDir;
const { launch, setSettings, findBrowser, sleep } = await import('./helpers.mjs');

const STORE = path.join(ROOT, 'store');
fs.mkdirSync(path.join(STORE, 'screenshots'), { recursive: true });

// A demo home folder. The path shows in the folder view, so it reads like one.
const home = path.join(os.tmpdir(), 'home', 'alex');
fs.rmSync(home, { recursive: true, force: true });
const dir = (...parts) => {
  const d = path.join(home, ...parts);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const copy = (from, ...to) => fs.copyFileSync(path.join(ROOT, from), path.join(home, ...to));
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

console.log('Making the demo folder…');
const photos = dir('Photos', 'Iceland 2026');
const views = [
  ['mandelbrot=size=1200x800:start_x=-0.743643887:start_y=0.131825904:start_scale=0.012:maxiter=400', ''],
  ['mandelbrot=size=1200x800:start_x=-0.7453:start_y=0.1127:start_scale=0.006:maxiter=400', ',hue=h=140'],
  ['mandelbrot=size=1200x800:start_x=-1.25066:start_y=0.02012:start_scale=0.0025:maxiter=500', ',hue=h=220'],
  ['mandelbrot=size=1200x800:start_x=-0.16:start_y=1.0405:start_scale=0.03:maxiter=300', ',hue=h=300'],
  ['mandelbrot=size=1200x800:start_x=-0.722:start_y=0.246:start_scale=0.02:maxiter=300', ',hue=h=40'],
  ['mandelbrot=size=1200x800:start_x=-0.7463:start_y=0.1102:start_scale=0.004:maxiter=500', ',hue=h=190'],
  ['gradients=s=1200x800:c0=0x0b3d91:c1=0x7fb7e6:c2=0xf2e7c9:nb_colors=3:x0=0:y0=0:x1=0:y1=800:d=1', ''],
  ['gradients=s=1200x800:c0=0x1d2b53:c1=0xff6f61:c2=0xffd166:nb_colors=3:x0=0:y0=0:x1=0:y1=800:d=1', ''],
  ['gradients=s=1200x800:c0=0x10403b:c1=0x2e9d6a:c2=0xd9f2c4:nb_colors=3:x0=0:y0=800:x1=1200:y1=0:d=1', ''],
  ['mandelbrot=size=1200x800:start_x=-0.235125:start_y=0.827215:start_scale=0.0004:maxiter=600', ',hue=h=90'],
  ['gradients=s=1200x800:c0=0x2b1055:c1=0x7597de:nb_colors=2:x0=0:y0=0:x1=1200:y1=800:d=1', ''],
  ['mandelbrot=size=1200x800:start_x=-0.7746806:start_y=0.1374168:start_scale=0.0001:maxiter=700', ',hue=h=260'],
];
views.forEach(([source, filter], i) => {
  ffmpeg('-f', 'lavfi', '-i', source, '-frames:v', '1', '-vf', `format=yuv420p${filter}`, '-q:v', '3', path.join(photos, `IMG_${4012 + i * 7}.jpg`));
});
dir('Photos', 'Screenshots');
const music = dir('Music', 'The Test Tones - Test Album');
for (const f of fs.readdirSync(path.join(ROOT, 'test-files', 'music'))) copy(`test-files/music/${f}`, 'Music', 'The Test Tones - Test Album', f);
dir('Documents');
copy('README.md', 'Documents', 'README.md');
copy('test-files/document1.pdf', 'Documents', 'Report.pdf');
const months = ['January', 'February', 'March', 'April', 'May', 'June'];
fs.writeFileSync(path.join(home, 'Documents', 'Budget 2026.csv'), 'Month;Rent;Food;Travel;Total\n' +
  months.map((m, i) => `${m};950,00;${(310 + i * 17).toFixed(2).replace('.', ',')};${[0, 120, 0, 640, 85, 0][i]},00;${(1260 + i * 17 + [0, 120, 0, 640, 85, 0][i]).toFixed(2).replace('.', ',')}`).join('\n') + '\n');
fs.writeFileSync(path.join(home, 'Documents', 'Packing list.txt'), 'Passport\nCharger\nRain jacket\nHiking boots\n');
dir('Videos');
copy('test-files/clip1.webm', 'Videos', 'Test pattern.webm');
copy('test-files/notes.txt', 'Todo.txt');
copy('test-files/photo3.png', 'Wallpaper.png');
const url = (...parts) => pathToFileURL(path.join(home, ...parts)).href + (parts.at(-1)?.includes('.') ? '' : '/');

// Screenshots --------------------------------------------------------------------

// In English: Chrome's listing supplies the column names and dates.
const look = { args: ['--lang=en-US'], env: { LANG: 'en_US.UTF-8', LANGUAGE: 'en_US' } };
const ctx = await launch(look);
await setSettings(ctx, { fileBar: 'always' });
const shot = async (name, { scheme = 'light', go, settle = 1200 }) => {
  const page = await ctx.browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  await go(page);
  await sleep(settle);
  await page.screenshot({ path: path.join(STORE, 'screenshots', name) });
  console.log(`store/screenshots/${name}`);
  await page.close();
};

await shot('1-folder-view.png', {
  go: async (page) => {
    await page.goto(url());
    await page.waitForSelector('#fn-explorer .fn-row');
    await page.keyboard.type('Pho');
  },
});
await shot('2-photo-grid.png', {
  scheme: 'dark',
  go: async (page) => {
    await page.goto(url('Photos', 'Iceland 2026'));
    await page.waitForSelector('#fn-explorer .fn-grid');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
  },
});
await shot('3-photo-viewer.png', {
  go: async (page) => {
    await page.goto(url('Photos', 'Iceland 2026'));
    await page.waitForSelector('#fn-explorer .fn-grid');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.pathname.endsWith('.jpg'));
  },
});
await shot('4-markdown.png', {
  go: async (page) => {
    await page.goto(url('Documents', 'README.md'));
    await page.waitForSelector('#fn-rendered:not([hidden])');
  },
});
await shot('5-music-player.png', {
  scheme: 'dark',
  settle: 2000,
  go: async (page) => {
    await page.goto(url('Music', 'The Test Tones - Test Album', '01 - Morning Light.mp3'));
    await page.waitForFunction(() => document.getElementById('title')?.textContent === 'Morning Light');
    await page.evaluate(() => document.querySelector('#play').click()); // paused, so the button shows ▶
  },
});
await ctx.browser.close();

// Store icon and promo tile ------------------------------------------------------

const svg = fs.readFileSync(path.join(ROOT, 'icons', 'icon.svg'), 'utf8');
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: look.args, env: { ...process.env, ...look.env } });
const page = await browser.newPage();

// The store wants 96 × 96 artwork with 16 px of transparent padding.
await page.setViewport({ width: 128, height: 128 });
await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:96px;height:96px;margin:16px}</style>${svg}`);
await page.screenshot({ path: path.join(STORE, 'icon-128.png'), omitBackground: true });
console.log('store/icon-128.png');

await page.setViewport({ width: 440, height: 280 });
await page.setContent(`<style>
  html, body { margin: 0; height: 100%; }
  body { display: flex; align-items: center; gap: 22px; padding: 0 34px; box-sizing: border-box;
    background: linear-gradient(135deg, #1f4fa8, #2f6fdb 55%, #5b8ef0); color: #fff; font-family: '${FONT}', system-ui, sans-serif; }
  svg { flex: none; width: 104px; height: 104px; filter: drop-shadow(0 6px 14px rgba(0,0,0,.25)); }
  h1 { margin: 0 0 8px; font-size: 32px; font-weight: 750; letter-spacing: -.5px; }
  p { margin: 0; font-size: 16px; line-height: 1.35; opacity: .92; }
</style>${svg.replace('fill="#2f6fdb"', 'fill="#ffffff" fill-opacity="0.16"')}<div><h1>File Navigator</h1><p>Browse local files<br>like in a file explorer</p></div>`);
await page.screenshot({ path: path.join(STORE, 'promo-small.png') });
console.log('store/promo-small.png');
await browser.close();
fs.rmSync(path.join(os.tmpdir(), 'home'), { recursive: true, force: true });
fs.rmSync(copyDir, { recursive: true, force: true });
