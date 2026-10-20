// Opt-in folder view: replaces Chrome's file:// directory listing with a
// file-explorer style list that can be driven from the keyboard. Built from
// the rows Chrome already put on the page, so its sizes, dates and column
// names stay in the browser's language.

(() => {
  if (!location.pathname.endsWith('/')) return;

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const COMPARE = {
    name: (a, b) => collator.compare(a.name, b.name),
    size: (a, b) => a.size - b.size,
    mtime: (a, b) => a.mtime - b.mtime,
  };

  let settings = DEFAULT_SETTINGS;
  let built = false;
  let entries = []; // every row of Chrome's listing
  let visible = []; // entries after the hidden-file and text filters, in display order
  let sort; // { key, dir }
  let selected = 0;
  let typed = '';
  let typedTimer;
  let ui; // elements of the view, set by build()

  const enabled = () => document.documentElement.classList.contains('fn-explorer');

  function whenReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  async function apply() {
    settings = await getSettings();
    // Set as early as possible: the CSS hides Chrome's listing under this class.
    document.documentElement.classList.toggle('fn-explorer', settings.folderView);
    if (!settings.folderView) return;
    if (!built) return whenReady(build);
    sort = { key: settings.sortBy, dir: settings.sortDir };
    render();
  }

  function readEntries() {
    return [...document.querySelectorAll('#tbody tr')].map((tr) => {
      const [nameCell, sizeCell, dateCell] = tr.cells;
      const link = nameCell.querySelector('a');
      const isDir = link.classList.contains('dir');
      // Chrome appends a slash to folder names.
      const name = isDir ? nameCell.dataset.value.replace(/\/$/, '') : nameCell.dataset.value;
      return {
        name,
        isDir,
        href: link.href,
        kind: isDir ? 'dir' : kindOf(name),
        size: Number(sizeCell.dataset.value),
        sizeText: sizeCell.textContent,
        mtime: Number(dateCell.dataset.value),
        dateText: dateCell.textContent,
      };
    });
  }

  const text = (id, fallback) => document.getElementById(id)?.textContent.trim() || fallback;

  function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  }

  function build() {
    if (built) return;
    built = true;
    entries = readEntries();
    sort = { key: settings.sortBy, dir: settings.sortDir };
    const hasParent = document.getElementById('parentDirLinkBox')?.style.display === 'block';
    const upLabel = text('parentDirText', 'Parent folder').replace(/^\[|\]$/g, '');

    const up = el('button', { className: 'fn-up', title: `${upLabel} (← / Backspace)`, disabled: !hasParent });
    up.setAttribute('aria-label', upLabel);
    up.addEventListener('click', goUp);

    const filter = el('input', { className: 'fn-filter', type: 'search', placeholder: 'Filter', spellcheck: false });
    filter.setAttribute('aria-label', 'Filter files');
    filter.addEventListener('input', () => {
      render();
      select(0);
    });

    const heads = Object.fromEntries(
      [
        ['name', text('nameColumnHeader', 'Name')],
        ['size', text('sizeColumnHeader', 'Size')],
        ['mtime', text('dateColumnHeader', 'Modified')],
      ].map(([key, label]) => {
        const button = el('button', { className: `fn-col fn-col-${key}` }, [el('span', { textContent: label }), el('span', { className: 'fn-sort' })]);
        button.addEventListener('click', () => {
          sort = { key, dir: sort.key === key && sort.dir === 'asc' ? 'desc' : 'asc' };
          render();
        });
        return [key, button];
      })
    );

    const rows = el('div', { className: 'fn-rows' });
    rows.setAttribute('role', 'listbox');
    // Clicks go through open() too, so files opened by mouse get the header bar.
    // Shift+click (new window) is left to the browser.
    const onRowClick = (e, newTab) => {
      const row = e.target.closest('.fn-row');
      if (!row || e.shiftKey || e.altKey) return;
      e.preventDefault();
      open(visible[Number(row.dataset.index)], newTab);
    };
    rows.addEventListener('click', (e) => onRowClick(e, e.ctrlKey || e.metaKey));
    rows.addEventListener('auxclick', (e) => e.button === 1 && onRowClick(e, true));
    rows.setAttribute('aria-label', 'Files');
    const empty = el('div', { className: 'fn-empty', textContent: 'No matching files', hidden: true });
    const count = el('span', { className: 'fn-count' });
    const keys = el('span', { className: 'fn-keys' });
    keys.innerHTML =
      '<kbd>↑</kbd><kbd>↓</kbd> select <kbd>Enter</kbd> open <kbd>←</kbd> up ' +
      '<span class="fn-key-extra">type to jump <kbd>/</kbd> filter <kbd>Esc</kbd> clear</span>';

    const app = el('div', { id: 'fn-explorer' }, [
      el('header', { className: 'fn-bar' }, [up, crumbs(), filter]),
      el('div', { className: 'fn-list' }, [el('div', { className: 'fn-head' }, Object.values(heads)), rows, empty]),
      el('footer', { className: 'fn-foot' }, [count, keys]),
    ]);
    ui = { app, filter, heads, rows, empty, count, list: app.querySelector('.fn-list') };
    document.body.append(app);
    // On narrow windows, keep the current folder in view rather than the root.
    const nav = app.querySelector('.fn-crumbs');
    new ResizeObserver(() => (nav.scrollLeft = nav.scrollWidth)).observe(nav);

    render();
    // Coming up from a subfolder, its name is in the hash: select it.
    const from = decodeURIComponent(location.hash.slice(1));
    if (from) history.replaceState(null, '', location.pathname);
    select(Math.max(0, visible.findIndex((e) => e.name === from)));
    document.addEventListener('keydown', onKey);
  }

  // Clickable path: / › home › len › folder
  function crumbs() {
    const nav = el('nav', { className: 'fn-crumbs' });
    nav.setAttribute('aria-label', 'Path');
    // Parts stay URL-encoded for the links and are decoded for display.
    const parts = location.pathname.split('/').filter(Boolean);
    let href = 'file:///';
    nav.append(el('a', { href, textContent: '/', className: 'fn-crumb' }));
    parts.forEach((part, i) => {
      href += part + '/';
      if (i) nav.append(el('span', { className: 'fn-crumb-sep', textContent: '›' }));
      const last = i === parts.length - 1;
      const label = decodeURIComponent(part);
      nav.append(el(last ? 'span' : 'a', { href, textContent: label, className: last ? 'fn-crumb fn-current' : 'fn-crumb' }));
    });
    return nav;
  }

  function icon(kind) {
    const span = el('span', { className: 'fn-icon' });
    span.style.webkitMaskImage = KIND_ICONS[kind];
    return span;
  }

  function render() {
    const keep = visible[selected]?.name;
    const query = ui.filter.value.trim().toLowerCase();
    const dir = sort.dir === 'desc' ? -1 : 1;
    const hidden = settings.showHidden ? [] : entries.filter((e) => e.name.startsWith('.'));
    visible = entries
      .filter((e) => !hidden.includes(e) && (!query || e.name.toLowerCase().includes(query)))
      // Folders first, like a file manager.
      .sort((a, b) => b.isDir - a.isDir || dir * COMPARE[sort.key](a, b) || COMPARE.name(a, b));

    ui.rows.replaceChildren(
      ...visible.map((e, i) => {
        const row = el('a', { className: `fn-row fn-${e.kind}`, href: e.href, id: `fn-row-${i}`, tabIndex: -1 }, [
          el('span', { className: 'fn-name' }, [icon(e.kind), el('span', { className: 'fn-label', textContent: e.name })]),
          el('span', { className: 'fn-size', textContent: e.isDir ? '' : e.sizeText }),
          el('span', { className: 'fn-date', textContent: e.dateText }),
        ]);
        row.setAttribute('role', 'option');
        row.dataset.index = i;
        row.title = e.name;
        return row;
      })
    );
    ui.empty.hidden = visible.length > 0;
    for (const [key, button] of Object.entries(ui.heads)) {
      button.classList.toggle('fn-sorted', key === sort.key);
      button.querySelector('.fn-sort').textContent = key === sort.key ? (sort.dir === 'asc' ? '▲' : '▼') : '';
    }
    const n = visible.length;
    ui.count.textContent =
      `${n} ${n === 1 ? 'item' : 'items'}` + (hidden.length ? ` · ${hidden.length} hidden` : '');
    const keepIndex = visible.findIndex((e) => e.name === keep);
    select(keepIndex === -1 ? 0 : keepIndex, false);
  }

  function select(i, scroll = true) {
    ui.rows.querySelector('.fn-selected')?.classList.remove('fn-selected');
    ui.rows.querySelector('[aria-selected]')?.removeAttribute('aria-selected');
    if (!visible.length) return;
    selected = Math.min(Math.max(i, 0), visible.length - 1);
    const row = ui.rows.children[selected];
    row.classList.add('fn-selected');
    row.setAttribute('aria-selected', 'true');
    ui.rows.setAttribute('aria-activedescendant', row.id);
    if (scroll) row.scrollIntoView({ block: 'nearest' });
  }

  // Files open through the background, which remembers they came from here
  // (for the header bar) and sends text formats Chrome would download to the
  // extension's text viewer.
  function open(entry, newTab) {
    if (!entry) return;
    if (entry.isDir && !newTab) location.href = entry.href;
    else chrome.runtime.sendMessage({ type: 'open', url: entry.href, newTab });
  }

  function goUp() {
    if (ui.app.querySelector('.fn-up').disabled) return;
    const current = decodeURIComponent(location.pathname.split('/').at(-2));
    location.href = new URL('../', location.href).href + '#' + encodeURIComponent(current);
  }

  // Rows that fit in the list, for PageUp/PageDown.
  function pageSize() {
    const row = ui.rows.firstElementChild;
    return row ? Math.max(1, Math.floor(ui.list.clientHeight / row.offsetHeight) - 2) : 10;
  }

  // Typing letters jumps to the next name starting with them; pressing the
  // same letter again cycles through the names starting with it.
  function typeAhead(ch) {
    clearTimeout(typedTimer);
    typedTimer = setTimeout(() => (typed = ''), 800);
    typed += ch.toLowerCase();
    const repeat = [...typed].every((c) => c === typed[0]);
    const prefix = repeat ? typed[0] : typed;
    const start = repeat ? selected + 1 : selected;
    for (let k = 0; k < visible.length; k++) {
      const i = (start + k) % visible.length;
      if (visible[i].name.toLowerCase().startsWith(prefix)) return select(i);
    }
  }

  function onKey(e) {
    if (!enabled() || e.defaultPrevented) return;
    const inFilter = document.activeElement === ui.filter;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      return open(visible[selected], true);
    }
    // Leave browser shortcuts such as Alt+Left (Back) alone.
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    switch (e.key) {
      case 'ArrowDown': select(selected + 1); break;
      case 'ArrowUp': select(selected - 1); break;
      case 'PageDown': select(selected + pageSize()); break;
      case 'PageUp': select(selected - pageSize()); break;
      case 'Enter': open(visible[selected]); break;
      case 'Escape':
        if (ui.filter.value) {
          ui.filter.value = '';
          render();
        }
        ui.filter.blur();
        break;
      default: {
        // Inside the filter box, these keys edit the text instead.
        if (inFilter) return;
        if (e.key === 'Home') select(0);
        else if (e.key === 'End') select(visible.length - 1);
        else if (e.key === 'ArrowRight') open(visible[selected]);
        else if (e.key === 'ArrowLeft' || e.key === 'Backspace') goUp();
        else if (e.key === '/') ui.filter.focus();
        else if (e.key.length === 1 && e.key !== ' ') typeAhead(e.key);
        else return;
      }
    }
    e.preventDefault();
  }

  chrome.storage.onChanged.addListener(apply);
  apply();
})();
