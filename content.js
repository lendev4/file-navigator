// Runs on file:// pages, from the start of loading, and on the extension's
// own text viewer (viewer.html). Plain arrow keys navigate only on Chrome's
// built-in image and text viewers, where they aren't otherwise used. Elsewhere
// (video, PDF, HTML files) use the Alt+Shift+Left/Right commands instead.

(() => {
  // In the text viewer these describe the file it shows (see viewer.js).
  const fileUrl = window.FN_FILE_URL || location.href;
  const type = window.FN_CONTENT_TYPE || document.contentType || '';
  if (window.top !== window || new URL(fileUrl).pathname.endsWith('/')) return;

  // Markdown opened straight from disk (address bar, bookmark, file manager)
  // moves to the viewer, which renders it. Replacing keeps Back working.
  if (!window.FN_FILE_URL && isMarkdown(decodeURIComponent(location.pathname.split('/').pop()))) {
    location.replace(openUrl(location.href));
    return;
  }

  const XHTML = 'http://www.w3.org/1999/xhtml';
  const BAR_HEIGHT = 44;
  const parts = new URL(fileUrl).pathname.split('/');
  const fileName = decodeURIComponent(parts.at(-1));
  const folderName = decodeURIComponent(parts.at(-2) || '') || '/';

  // Keep the page hidden until it's known whether the header bar shows, so the
  // bar doesn't appear after the page has rendered and push it down. That only
  // takes a few milliseconds; after 400 ms the page shows whatever happens.
  const cloak = (el) => el?.style.setProperty('visibility', 'hidden', 'important');
  const uncloak = () => document.documentElement?.style.removeProperty('visibility');
  cloak(document.documentElement);
  const cloakTimer = setTimeout(uncloak, 400);

  // Started now, used once the page has been parsed.
  const settingsLoaded = getSettings();
  const barState = chrome.runtime.sendMessage({ type: 'bar-state', url: fileUrl });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  function start() {
    // Chrome shows an SVG file as a bare SVG document, which has nowhere to put
    // HTML. Show it like other images instead: centred on a dark background.
    if (type === 'image/svg+xml' && document.documentElement.namespaceURI === 'http://www.w3.org/2000/svg') {
      const make = (tag) => document.createElementNS(XHTML, tag);
      const [html, head, title, body, img] = ['html', 'head', 'title', 'body', 'img'].map(make);
      title.textContent = fileName;
      body.style.cssText = 'margin: 0; height: 100%; display: flex; align-items: center; justify-content: center; background: #0e0e0e';
      html.style.height = '100%';
      cloak(html);
      img.style.cssText = 'max-width: 100%; max-height: 100%';
      img.src = fileUrl;
      head.append(title);
      body.append(img);
      html.append(head, body);
      document.replaceChild(html, document.documentElement);
    }

    const isImage = type.startsWith('image/');
    // Chrome renders any text file (txt, md, json, ...) as a single <pre>.
    const isTextViewer =
      !/html/.test(type) && document.body && document.body.firstElementChild?.tagName === 'PRE';
    // Chrome's image, video, audio and PDF viewers fit their content to the body,
    // so the header bar makes room by shrinking the body; text and HTML pages
    // are pushed down instead.
    const isMedia = isImage || /^(video|audio)\//.test(type);
    const isPdf = type === 'application/pdf';

    // Navigation goes through the background, which also handles the text viewer.
    const go = (move) =>
      chrome.runtime.sendMessage({ type: 'navigate', move, url: fileUrl }).then((res) => {
        if (res?.edge) flash(res.edge > 0 ? 'Last file' : 'First file');
      });

    // Back to the folder, with this file selected in the folder view.
    function goToFolder() {
      const url = new URL('./', fileUrl).href + '#' + encodeURIComponent(fileName);
      chrome.runtime.sendMessage({ type: 'go', url });
    }

    function isEditable(el) {
      return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    }

    if (isImage || isTextViewer) {
      // Home/End only on images: in text files they scroll to the top/bottom.
      const KEYS = { ArrowRight: { step: 1 }, ArrowLeft: { step: -1 } };
      if (isImage) Object.assign(KEYS, { Home: { to: 'first' }, End: { to: 'last' } });
      document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (isEditable(document.activeElement)) return;
        if (e.key === 'Backspace') goToFolder();
        else if (KEYS[e.key]) go(KEYS[e.key]);
        else return;
        e.preventDefault();
      });
    }

    const mask = (svg) => `url("data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'>${svg}</svg>`
    )}")`;

    // On-screen UI, isolated from the page's own styles. Parsed as HTML and moved
    // in, because SVG pages are XML documents where innerHTML expects XML.
    const host = document.createElementNS(XHTML, 'div');
    const root = host.attachShadow({ mode: 'closed' });
    const markup = `
      <style>
        .label {
          position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
          padding: 6px 12px; border-radius: 8px; background: rgba(28, 28, 31, .92); color: #ececea;
          font: 13px system-ui, sans-serif; pointer-events: none; opacity: 0; transition: opacity .3s;
          max-width: 90vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .label.visible { opacity: 1; }

        /* Colours match the folder view (listing.css). */
        .bar {
          --bg: #fbfbfa; --text: #1d1d1b; --muted: #6b6b66; --border: #e4e4e0; --hover: #efefec;
          --dir: #e0a526; --image: #2e9d6a; --video: #d9534f; --audio: #8e5cd9;
          --pdf: #e0663a; --text-file: #5b7fa6; --html: #2f8fd8; --other: #8a8f98;
          position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
          height: ${BAR_HEIGHT}px; box-sizing: border-box; padding: 0 8px;
          display: flex; align-items: center; gap: 4px;
          font: 13px/1.2 system-ui, sans-serif; color: var(--text);
          background: var(--bg); border-bottom: 1px solid var(--border);
        }
        .bar.dark {
          --bg: #1c1c1f; --text: #ececea; --muted: #9a9a96; --border: #2e2e33; --hover: #2c2c31;
          --dir: #e8b84a; --image: #4cc08a; --video: #ec6f6a; --audio: #a982ec;
          --pdf: #f08358; --text-file: #86a6cb; --html: #5aa9ea; --other: #9da2ab;
        }
        .bar[hidden] { display: none; }

        button {
          display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 8px;
          border: 0; border-radius: 7px; background: none; color: inherit; font: inherit; cursor: pointer;
        }
        button:hover:not(:disabled) { background: var(--hover); }
        button:disabled { opacity: .3; cursor: default; }
        .i { flex: none; width: 16px; height: 16px; background: currentColor; -webkit-mask: center / contain no-repeat; }
        .i-back { -webkit-mask-image: ${mask("<path d='M19 12H5M11 18l-6-6 6-6'/>")}; }
        .i-prev { -webkit-mask-image: ${mask("<path d='M15 18l-6-6 6-6'/>")}; }
        .i-next { -webkit-mask-image: ${mask("<path d='M9 18l6-6-6-6'/>")}; }

        .back { flex: none; max-width: 30%; color: var(--muted); }
        .back:hover { color: var(--text); }
        .dir { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .divider { flex: none; width: 1px; height: 18px; margin: 0 6px; background: var(--border); }

        .file { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
        .kind { flex: none; width: 18px; height: 18px; background: var(--other); -webkit-mask: center / contain no-repeat; }
        .kind.dir { background: var(--dir); }
        .kind.image { background: var(--image); }
        .kind.video { background: var(--video); }
        .kind.audio { background: var(--audio); }
        .kind.pdf { background: var(--pdf); }
        .kind.text { background: var(--text-file); }
        .kind.html { background: var(--html); }
        .title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
        .meta { flex: none; color: var(--muted); font-variant-numeric: tabular-nums; }

        .nav { flex: none; display: flex; align-items: center; gap: 2px; }
        .step { width: 30px; justify-content: center; padding: 0; }
        .count { min-width: 3.5em; text-align: center; color: var(--muted); font-variant-numeric: tabular-nums; }

        @media (max-width: 520px) {
          .dir, .meta, .divider { display: none; }
        }
      </style>
      <div class="bar" hidden>
        <button class="back" title="Back to folder (Backspace)"><span class="i i-back"></span><span class="dir"></span></button>
        <span class="divider"></span>
        <span class="file"><span class="kind"></span><span class="title"></span><span class="meta"></span></span>
        <span class="nav">
          <button class="step prev" title="Previous file" aria-label="Previous file" disabled><span class="i i-prev"></span></button>
          <span class="count"></span>
          <button class="step next" title="Next file" aria-label="Next file" disabled><span class="i i-next"></span></button>
        </span>
      </div>
      <div class="label"></div>`;
    const parsed = new DOMParser().parseFromString(markup, 'text/html');
    // The parser puts the leading <style> in <head>.
    root.append(...parsed.head.childNodes, ...parsed.body.childNodes);
    const $ = (sel) => root.querySelector(sel);
    const bar = $('.bar');
    const label = $('.label');
    // Dark over Chrome's dark image, video and PDF viewers; else follow the system.
    const darkScheme = matchMedia('(prefers-color-scheme: dark)');
    const setTheme = () => bar.classList.toggle('dark', isMedia || isPdf || darkScheme.matches);
    darkScheme.addEventListener('change', setTheme);
    setTheme();
    $('.dir').textContent = folderName;
    $('.back').addEventListener('click', goToFolder);
    $('.prev').addEventListener('click', () => go({ step: -1 }));
    $('.next').addEventListener('click', () => go({ step: 1 }));
    const kind = kindOf(fileName);
    $('.kind').classList.add(kind);
    $('.kind').style.webkitMaskImage = KIND_ICONS[kind];
    // HTML pages have their own title; for everything else the file name reads best.
    $('.title').textContent = (/html/.test(type) && document.title) || fileName;
    document.documentElement.appendChild(host);

    // Page-level rules that make room for the bar, switched on by a class so
    // Chrome's own inline styles are left alone. Text pages are pushed down on
    // <html>, keeping the body's own spacing.
    const pageStyle = document.createElementNS(XHTML, 'style');
    pageStyle.textContent = `
      html.fn-bar-push { padding-top: ${BAR_HEIGHT}px !important; }
      /* Chrome's JSON view has a fixed "pretty-print" checkbox strip at the top. */
      html.fn-bar-push .json-formatter-container { top: ${BAR_HEIGHT}px !important; }
      body.fn-bar-fit { position: fixed !important; inset: ${BAR_HEIGHT}px 0 0 0 !important; height: auto !important; margin: 0 !important; overflow: auto; }
      /* Chrome fits images to the window; fit them to the space below the bar
         instead, unless zoomed in (Chrome then shows a zoom-out cursor). */
      body.fn-bar-fit > img:not([style*="zoom-out"]) { position: absolute; inset: 0; margin: auto; width: auto; height: auto; max-width: 100%; max-height: 100%; }`;
    (document.head || document.documentElement).appendChild(pageStyle);

    // Image size next to the name, once it's known.
    const img = isImage && document.querySelector('img');
    if (img) {
      const showSize = () => img.naturalWidth && ($('.meta').textContent = `${img.naturalWidth} × ${img.naturalHeight}`);
      if (img.complete) showSize();
      else img.addEventListener('load', showSize);
    }

    let settings = DEFAULT_SETTINGS;
    let fromExplorer = false;
    let position = null;
    let flashTimer;

    const barShown = () => !bar.hidden;

    // The label's resting state: the position when set to "always" and the bar
    // (which shows it already) is hidden; otherwise hidden.
    function restLabel() {
      const show = settings.label === 'always' && position && !barShown();
      if (show) label.textContent = `${position.index + 1} / ${position.total} · ${position.name}`;
      label.classList.toggle('visible', !!show);
    }

    function flash(text) {
      label.textContent = text;
      label.classList.add('visible');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(restLabel, 1500);
    }

    // Whether the bar shows depends only on settings and how the file was opened,
    // so it's decided before the page is revealed. The position needs the folder
    // listing and fills in a moment later without moving anything.
    function updateBar() {
      const show = settings.fileBar === 'always' || (settings.fileBar === 'explorer' && fromExplorer);
      bar.hidden = !show;
      if (isMedia || isPdf) document.body?.classList.toggle('fn-bar-fit', show);
      else document.documentElement.classList.toggle('fn-bar-push', show);
    }

    function updatePosition() {
      $('.count').textContent = position ? `${position.index + 1} / ${position.total}` : '';
      $('.prev').disabled = !position?.hasPrev;
      $('.next').disabled = !position?.hasNext;
      restLabel();
    }

    async function loadPosition(firstLoad) {
      const res = await chrome.runtime.sendMessage({ type: 'position', url: fileUrl });
      position = res && !res.error && res.index !== -1 ? res : null;
      updatePosition();
      if (!firstLoad || !position) return;
      if (res.justMoved && settings.label === 'brief' && !barShown()) {
        flash(`${res.index + 1} / ${res.total} · ${res.name}`);
      }
      // Warm the cache so the next/previous image shows up instantly.
      if (isImage) res.neighbors.forEach((url) => (new Image().src = url));
    }

    Promise.all([settingsLoaded, barState.catch(() => null)])
      .then(([loaded, state]) => {
        settings = loaded;
        fromExplorer = !!state?.fromExplorer;
        updateBar();
      })
      .finally(() => {
        clearTimeout(cloakTimer);
        uncloak();
      });
    loadPosition(true);

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'edge') flash(msg.step > 0 ? 'Last file' : 'First file');
    });
    chrome.storage.onChanged.addListener(async (_changes, area) => {
      if (area !== 'sync') return;
      settings = await getSettings();
      updateBar();
      loadPosition(false);
    });
  }
})();
