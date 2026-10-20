// The extension's viewer, opened as viewer.html?file=<file URL>[&view=rendered|source]:
// - text formats Chrome downloads instead of showing (see VIEWER_EXTS),
// - Markdown, rendered, and CSV/TSV, as a table, each with a switch to the
//   source text,
// - videos Chrome downloads but can play (see VIEWER_VIDEO_EXTS).

const params = new URLSearchParams(location.search);
// The file without its #fragment, which Markdown uses to jump to a heading.
const requested = new URL(params.get('file'));
const fragment = decodeURIComponent(requested.hash.slice(1));
requested.hash = '';

const fileName = decodeURIComponent(requested.pathname.split('/').pop());
const isVideo = VIEWER_VIDEO_EXTS.includes(extOf(fileName));

window.FN_FILE_URL = requested.href;
window.FN_CONTENT_TYPE = isVideo ? 'video/quicktime' : 'text/plain';
document.title = fileName;

// Formats with a second view next to the source text.
const VIEWS = {
  markdown: { matches: isMarkdown, label: 'Rendered', setting: 'markdownView', render: renderMarkdown },
  csv: { matches: (name) => ['csv', 'tsv'].includes(extOf(name)), label: 'Table', setting: 'csvView', render: renderCsv },
};
const format = Object.entries(VIEWS).find(([, v]) => v.matches(fileName))?.[0];

// Extension pages with file access can read file:// URLs with XHR (not fetch).
// This script runs in <head>, so the file can arrive before the page exists.
const loaded =
  !isVideo &&
  new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', FN_FILE_URL);
    xhr.onload = () => resolve(xhr.responseText);
    xhr.onerror = () => resolve(`Could not read ${FN_FILE_URL}.\nIs "Allow access to file URLs" on for File Navigator?`);
    xhr.send();
  });

document.addEventListener('DOMContentLoaded', async () => {
  if (isVideo) return showVideo();
  const text = await loaded;
  document.getElementById('fn-text').textContent = text;
  if (!format) return;
  const view = VIEWS[format];
  document.documentElement.classList.add(`fn-${format}`);
  const container = document.getElementById('fn-rendered');
  container.className = format;
  view.render(text, container);
  setUpSwitch(view.label);
  const settings = await getSettings();
  setView(params.get('view') || settings[view.setting]);
  if (fragment) document.getElementById(fragment)?.scrollIntoView();
});

function setUpSwitch(label) {
  const toggle = document.getElementById('fn-view-switch');
  toggle.querySelector('[data-view="rendered"]').textContent = label;
  toggle.hidden = false;
  toggle.addEventListener('click', (e) => {
    const view = e.target.closest('button')?.dataset.view;
    if (!view) return;
    setView(view);
    // Remembered for this page, so reloading keeps it.
    const url = new URL(location.href);
    url.searchParams.set('view', view);
    history.replaceState(null, '', url);
  });
}

function setView(view) {
  const rendered = view !== 'source';
  document.documentElement.classList.toggle('fn-rendered', rendered);
  document.getElementById('fn-text').hidden = rendered;
  document.getElementById('fn-rendered').hidden = !rendered;
  for (const button of document.querySelectorAll('#fn-view-switch button')) {
    button.setAttribute('aria-pressed', button.dataset.view === (rendered ? 'rendered' : 'source'));
  }
}

// Markdown --------------------------------------------------------------------

// GitHub-style heading ids, so links like #installation work.
function slug(text) {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-');
}

function renderMarkdown(text, article) {
  // Markdown can contain raw HTML, so the result is sanitised before use.
  article.innerHTML = DOMPurify.sanitize(marked.parse(text, { gfm: true }));

  const seen = new Map();
  for (const h of article.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const base = slug(h.textContent);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    h.id = n ? `${base}-${n}` : base;
  }

  // Relative links and images are relative to the file, not to this page.
  for (const img of article.querySelectorAll('img[src]')) {
    img.src = new URL(img.getAttribute('src'), FN_FILE_URL).href;
  }
  for (const a of article.querySelectorAll('a[href]')) {
    if (!a.getAttribute('href').startsWith('#')) a.href = new URL(a.getAttribute('href'), FN_FILE_URL).href;
  }

  // Links to local files and folders go through the background, so Markdown
  // opens rendered again and folders open in the folder view. Web links and
  // #headings work as usual.
  const follow = (e, newTab) => {
    const a = e.target.closest('a[href]');
    if (!a || !a.href.startsWith('file://')) return;
    e.preventDefault();
    chrome.runtime.sendMessage(newTab ? { type: 'open', url: a.href, newTab } : { type: 'go', url: a.href });
  };
  article.addEventListener('click', (e) => follow(e, e.ctrlKey || e.metaKey));
  article.addEventListener('auxclick', (e) => e.button === 1 && follow(e, true));

  highlightCode(article);
}

// Syntax highlighting for code blocks that name a language (```js). The
// library is only loaded when there is something to highlight.
async function highlightCode(article) {
  const blocks = [...article.querySelectorAll('pre > code[class*="language-"]')];
  if (!blocks.length) return;
  await new Promise((resolve, reject) => {
    const script = Object.assign(document.createElement('script'), { src: 'vendor/highlight.min.js' });
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
  for (const code of blocks) {
    const language = code.className.match(/language-(\S+)/)[1];
    // Unknown languages stay plain rather than being guessed.
    if (hljs.getLanguage(language)) hljs.highlightElement(code);
  }
}

// CSV / TSV -------------------------------------------------------------------

const MAX_ROWS = 5000;

// Picks the delimiter used most in the first line (outside quotes). CSV files
// from German or French Excel use semicolons, for instance.
function sniffDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '');
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1]);
  const [best, count] = counts.sort((a, b) => b[1] - a[1])[0];
  return count ? best : ',';
}

// RFC 4180: quoted fields may contain delimiters, line breaks and "" for a quote.
function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') (field += '"'), i++;
      else quoted = false;
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

// Numbers in any common notation: 1234, -1.5, 1,234.56, 1.234,56, 12 %.
const NUMBER = /^[-+]?(\d[\d.,' ]*)?\d([.,]\d+)?\s?%?$/;

function renderCsv(text, container) {
  text = text.replace(/^﻿/, '');
  const delimiter = extOf(fileName) === 'tsv' ? '\t' : sniffDelimiter(text);
  const [head = [], ...body] = parseCsv(text, delimiter);
  const width = [head, ...body].reduce((max, r) => Math.max(max, r.length), 0);
  const shown = body.slice(0, MAX_ROWS);
  // Right-align columns whose cells are all numbers.
  const numeric = [...Array(width)].map((_, j) => {
    const cells = shown.map((r) => (r[j] || '').trim()).filter(Boolean);
    return cells.length > 0 && cells.every((c) => NUMBER.test(c));
  });

  const cell = (tag, value, j) => {
    const el = document.createElement(tag);
    el.textContent = value;
    if (numeric[j]) el.className = 'num';
    if (value.length > 40) el.title = value;
    return el;
  };
  const rowNumber = (tag, n) => Object.assign(document.createElement(tag), { className: 'rownum', textContent: n });

  const table = document.createElement('table');
  const thead = table.createTHead().insertRow();
  thead.append(rowNumber('th', ''), ...[...Array(width)].map((_, j) => cell('th', head[j] || '', j)));
  const tbody = table.createTBody();
  shown.forEach((r, i) => {
    tbody.insertRow().append(rowNumber('td', i + 1), ...[...Array(width)].map((_, j) => cell('td', r[j] || '', j)));
  });
  container.append(table);

  const note = document.createElement('p');
  note.className = 'csv-note';
  const rows = `${body.length.toLocaleString()} ${body.length === 1 ? 'row' : 'rows'}`;
  note.textContent =
    body.length > MAX_ROWS ? `Showing the first ${MAX_ROWS.toLocaleString()} of ${rows}. Switch to Source to see all of it.` : rows;
  container.append(note);
}

// Video -----------------------------------------------------------------------

function showVideo() {
  document.documentElement.classList.add('fn-video');
  const video = Object.assign(document.createElement('video'), { controls: true, autoplay: true, src: FN_FILE_URL });
  video.addEventListener('error', () => {
    const message = document.createElement('p');
    message.className = 'video-error';
    message.textContent = `Chrome can't play ${fileName}. Its video format (codec) isn't supported, for example ProRes or HEVC.`;
    video.replaceWith(message);
  });
  document.body.replaceChildren(video);
}
