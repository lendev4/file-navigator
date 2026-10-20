// Text viewer for formats Chrome downloads instead of showing (CSV, YAML,
// TOML, ...; see VIEWER_EXTS), and for Markdown, which it renders. Opened as
// viewer.html?file=<file URL>[&view=rendered|source].

const params = new URLSearchParams(location.search);
// The file without its #fragment, which Markdown uses to jump to a heading.
const requested = new URL(params.get('file'));
const fragment = decodeURIComponent(requested.hash.slice(1));
requested.hash = '';

window.FN_FILE_URL = requested.href;
window.FN_CONTENT_TYPE = 'text/plain';

const fileName = decodeURIComponent(requested.pathname.split('/').pop());
document.title = fileName;

// Extension pages with file access can read file:// URLs with XHR (not fetch).
// This script runs in <head>, so the file can arrive before the page exists.
const loaded = new Promise((resolve) => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', FN_FILE_URL);
  xhr.onload = () => resolve(xhr.responseText);
  xhr.onerror = () => resolve(`Could not read ${FN_FILE_URL}.\nIs "Allow access to file URLs" on for File Navigator?`);
  xhr.send();
});

document.addEventListener('DOMContentLoaded', async () => {
  const text = await loaded;
  document.getElementById('fn-text').textContent = text;
  if (isMarkdown(fileName)) {
    document.documentElement.classList.add('fn-markdown');
    renderMarkdown(text);
    const { markdownView } = await getSettings();
    setView(params.get('view') || markdownView);
    if (fragment) document.getElementById(fragment)?.scrollIntoView();
  }
});

// GitHub-style heading ids, so links like #installation work.
function slug(text) {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-');
}

function renderMarkdown(text) {
  const article = document.getElementById('fn-markdown');
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

  const toggle = document.getElementById('fn-view-switch');
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
  document.getElementById('fn-markdown').hidden = !rendered;
  for (const button of document.querySelectorAll('#fn-view-switch button')) {
    button.setAttribute('aria-pressed', button.dataset.view === (rendered ? 'rendered' : 'source'));
  }
}
