// Runs on file:// pages, from the start of loading, and on the extension's
// own viewer (viewer.html). Plain arrow keys navigate only on Chrome's
// built-in image and text viewers, where they aren't otherwise used. Elsewhere
// (video, PDF, HTML files) use the Alt+Shift+Left/Right commands instead.
// Images also get F (fullscreen), Space or S (slideshow) and zoom keys; videos
// get F and S (play all videos, one after the other).

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
      // "safe" keeps a zoomed-in image scrollable instead of overflowing to the left.
      body.style.cssText = 'margin: 0; height: 100%; display: flex; align-items: safe center; justify-content: safe center; background: #0e0e0e';
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
    const isVideo = type.startsWith('video/');
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

    // The action for a key press here, if any. Arrows and Backspace only on
    // Chrome's image and text viewers; Home/End, Space and zooming only on
    // images (in text files they scroll, in videos Space plays and pauses);
    // F and S also on videos.
    function keyAction(e) {
      const { key } = e;
      const plain = !e.shiftKey;
      if ((isImage || isTextViewer) && plain) {
        if (key === 'ArrowRight') return () => go({ step: 1 });
        if (key === 'ArrowLeft') return () => go({ step: -1 });
        if (key === 'Backspace') return goToFolder;
      }
      if (isImage) {
        if (plain && key === 'Home') return () => go({ to: 'first' });
        if (plain && key === 'End') return () => go({ to: 'last' });
        if (plain && key === ' ') return () => setSlideshow(!slideshow, true);
        // + needs Shift on some keyboards, so Shift is fine for the zoom keys.
        if (key === '+' || key === '=') return () => zoomBy(1.25);
        if (key === '-') return () => zoomBy(1 / 1.25);
        if (key === '0') return () => setZoom(null);
        if (key === '1') return () => setZoom(1);
      }
      if ((isImage || isVideo) && (key === 'f' || key === 'F')) return toggleFullscreen;
      if ((isImage || isVideo) && (key === 's' || key === 'S')) return () => setSlideshow(!slideshow, true);
      if (key === 'Escape' && (slideshow || fullscreen)) {
        return () => {
          if (slideshow) setSlideshow(false, true);
          if (fullscreen) toggleFullscreen();
        };
      }
    }

    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isEditable(document.activeElement)) return;
      const action = keyAction(e);
      if (!action) return;
      e.preventDefault();
      action();
    });

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
        .i-play { -webkit-mask-image: ${mask("<path d='M8 5.5v13l10.5-6.5z'/>")}; }
        .slide.on .i-play { -webkit-mask-image: ${mask("<path d='M9 6v12M15 6v12'/>")}; }
        .slide[hidden] { display: none; }

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
          <button class="step slide" hidden><span class="i i-play"></span></button>
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
    const slideButton = $('.slide');
    slideButton.hidden = !(isImage || isVideo);
    slideButton.addEventListener('click', () => setSlideshow(!slideshow, true));
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
      body.fn-bar-fit > img:not([style*="zoom-out"]) { position: absolute; inset: 0; margin: auto; width: auto; height: auto; max-width: 100%; max-height: 100%; }
      /* Chrome's video page only ever shrinks a video; in fullscreen it fills the
         screen, like the player's own fullscreen. */
      html.fn-fullscreen video { position: fixed !important; inset: 0 !important; width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; margin: 0 !important; object-fit: contain; }
      /* Zoomed with + / - / 1: a fixed width, scrolled in the page. */
      img.fn-zoomed { width: var(--fn-zoom-width) !important; height: auto !important; max-width: none !important; max-height: none !important; position: static !important; margin: 0 auto !important; }`;
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
    // The window's fullscreen and the slideshow are kept by the background, so
    // they carry on from file to file.
    let fullscreen = false;
    let slideshow = false;
    let slideTimer;
    // In fullscreen the bar only shows while the mouse is near the top.
    let peek = false;
    // null: fitted to the window as Chrome does; otherwise a scale (1 = 100 %).
    let zoom = null;

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
      const wanted = settings.fileBar === 'always' || (settings.fileBar === 'explorer' && fromExplorer);
      // In fullscreen it lies over the page instead of taking room.
      const inLayout = wanted && !fullscreen;
      bar.hidden = !(inLayout || (wanted && peek));
      if (isMedia || isPdf) document.body?.classList.toggle('fn-bar-fit', inLayout);
      else document.documentElement.classList.toggle('fn-bar-push', inLayout);
      document.documentElement.classList.toggle('fn-fullscreen', fullscreen);
      restLabel();
    }

    document.addEventListener('mousemove', (e) => {
      const near = fullscreen && e.clientY < BAR_HEIGHT * 1.5;
      if (near === peek) return;
      peek = near;
      updateBar();
    });

    // Fullscreen is the browser window's, which, unlike page fullscreen, lasts
    // when moving to the next file. The background switches it and reports back.
    const toggleFullscreen = () => chrome.runtime.sendMessage({ type: 'fullscreen', on: !fullscreen });

    function setSlideshow(on, announce) {
      slideshow = on;
      chrome.runtime.sendMessage({ type: 'slideshow', on });
      if (announce && !on) flash('Slideshow off');
      else if (announce) flash(isVideo ? 'Playing all videos · the next one starts when this ends' : `Slideshow · every ${Number(settings.slideshowSeconds)} s`);
      scheduleSlide();
      // Started on a paused video: play it, it's what "play all" means.
      const video = isVideo && document.querySelector('video');
      if (on && announce && video?.paused && !video.ended) video.play().catch(() => {});
    }

    // Images move on after the set time once loaded, videos when they end.
    function scheduleSlide() {
      clearTimeout(slideTimer);
      slideButton.classList.toggle('on', slideshow);
      const label = slideshow ? 'Stop slideshow (S)' : isVideo ? 'Play all videos (S)' : 'Slideshow (Space or S)';
      slideButton.title = label;
      slideButton.setAttribute('aria-label', label);
      const video = isVideo && document.querySelector('video');
      if (video) {
        video.onended = slideshow ? nextSlide : null;
        if (slideshow && video.ended) nextSlide();
      }
      if (!slideshow || !img) return;
      if (!img.complete) return img.addEventListener('load', scheduleSlide, { once: true });
      slideTimer = setTimeout(nextSlide, Number(settings.slideshowSeconds) * 1000);
    }

    async function nextSlide() {
      const res = await chrome.runtime.sendMessage({ type: 'navigate', move: { step: 1 }, url: fileUrl });
      if (!res?.edge) return;
      setSlideshow(false);
      flash('Slideshow finished');
    }

    // The point in the middle of the window stays put while zooming.
    function setZoom(scale) {
      if (!img?.naturalWidth) return;
      const before = img.getBoundingClientRect();
      const fx = (innerWidth / 2 - before.left) / before.width;
      const fy = (innerHeight / 2 - before.top) / before.height;
      zoom = scale === null ? null : Math.min(16, Math.max(0.05, scale));
      img.classList.toggle('fn-zoomed', zoom !== null);
      if (zoom !== null) img.style.setProperty('--fn-zoom-width', `${img.naturalWidth * zoom}px`);
      const after = img.getBoundingClientRect();
      const scroller = document.body.classList.contains('fn-bar-fit') || type === 'image/svg+xml' ? document.body : document.scrollingElement;
      scroller.scrollBy(after.left + fx * after.width - innerWidth / 2, after.top + fy * after.height - innerHeight / 2);
      flash(zoom === null ? 'Fit to window' : `${Math.round(zoom * 100)} %`);
    }

    const zoomBy = (factor) => img && setZoom((zoom ?? img.getBoundingClientRect().width / img.naturalWidth) * factor);

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
        fullscreen = !!state?.fullscreen;
        slideshow = !!state?.slideshow;
        updateBar();
        scheduleSlide();
      })
      .finally(() => {
        clearTimeout(cloakTimer);
        uncloak();
      });
    loadPosition(true);

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'edge') flash(msg.step > 0 ? 'Last file' : 'First file');
      if (msg.type === 'fullscreen' && msg.on !== fullscreen) {
        fullscreen = msg.on;
        peek = false;
        updateBar();
      }
    });
    chrome.storage.onChanged.addListener(async (_changes, area) => {
      if (area !== 'sync') return;
      settings = await getSettings();
      updateBar();
      loadPosition(false);
    });
  }
})();
