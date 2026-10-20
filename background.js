// Works out the previous/next file for a file:// URL and navigates the tab.

importScripts('shared.js');

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const byName = (a, b) => collator.compare(a.name, b.name);
const COMPARE = {
  name: byName,
  mtime: (a, b) => a.mtime - b.mtime || byName(a, b),
  size: (a, b) => a.size - b.size || byName(a, b),
};

// Tabs we just navigated, so their next page shows the position overlay.
const justNavigated = new Set();

function splitUrl(fileUrl) {
  const url = new URL(fileUrl);
  url.hash = '';
  url.search = '';
  const slash = url.href.lastIndexOf('/');
  return {
    dirUrl: url.href.slice(0, slash + 1),
    name: decodeURIComponent(url.href.slice(slash + 1)),
  };
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Read the file:// directory listing of the current folder',
    });
  } catch (err) {
    // A concurrent call may have created it already.
    if (!(await chrome.offscreen.hasDocument())) throw err;
  }
}

async function offscreen(message) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', ...message });
  if (!res || res.error) throw new Error(res ? res.error : 'No response from offscreen document');
  return res;
}

const listDir = async (dirUrl) => (await offscreen({ type: 'list-dir', dirUrl })).entries;

// Returns the sorted sibling files in the current file's group and its index.
// `overrides` replace settings, e.g. to always group by kind.
async function siblings(fileUrl, overrides = {}) {
  const settings = { ...(await getSettings()), ...overrides };
  const { dirUrl, name } = splitUrl(fileUrl);
  const cat = categoryOf(name);
  const inGroup = {
    kind: (n) => categoryOf(n) === cat,
    extension: (n) => extOf(n) === extOf(name),
    all: (n) => !categoryOf(n).startsWith('ext:') || categoryOf(n) === cat,
  }[settings.grouping];
  const dir = settings.sortDir === 'desc' ? -1 : 1;
  const compare = COMPARE[settings.sortBy];
  const files = (await listDir(dirUrl))
    // Keep the current file even if it is hidden, so it has a position.
    .filter((e) => !e.isDir && inGroup(e.name) && (settings.showHidden || !e.name.startsWith('.') || e.name === name))
    .sort((a, b) => dir * compare(a, b))
    .map((e) => ({ name: e.name, url: dirUrl + e.href }));
  return { files, index: files.findIndex((f) => f.name === name), wrap: settings.wrap };
}

// Opens fileUrl in the tab, going through the viewer or music player where needed.
async function show(tabId, fileUrl) {
  return chrome.tabs.update(tabId, { url: openUrl(fileUrl, await getSettings()) });
}

// The music player's playlist: the folder's audio files, and its cover image.
async function playlist(fileUrl) {
  const { files, index } = await siblings(fileUrl, { grouping: 'kind' });
  const { dirUrl } = splitUrl(fileUrl);
  const cover = (await listDir(dirUrl)).find((e) => !e.isDir && COVER_NAMES.test(e.name));
  return { files, index, cover: cover && dirUrl + cover.href };
}

// move is { step: 1 | -1 } or { to: 'first' | 'last' }. Returns { edge } when
// there's no file in that direction.
async function navigate(tabId, fileUrl, move) {
  if (!fileUrl?.startsWith('file://') || fileUrl.endsWith('/')) return;
  const { files, index, wrap } = await siblings(fileUrl);
  if (index === -1) return;
  let next = move.to === 'first' ? 0 : move.to === 'last' ? files.length - 1 : index + move.step;
  if (wrap && move.step) next = (next + files.length) % files.length;
  if (next === index) return;
  const target = files[next];
  if (!target) return { edge: move.step };
  justNavigated.add(tabId);
  if (await fromExplorer(tabId, fileUrl)) await markFromExplorer(tabId, target.url);
  await show(tabId, target.url);
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  tab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const step = command === 'next-file' ? 1 : -1;
  // The music player switches tracks itself, without reloading.
  if (tab.url?.startsWith(chrome.runtime.getURL(PLAYER_PAGE))) {
    chrome.tabs.sendMessage(tab.id, { type: 'player-step', step }).catch(() => {});
    return;
  }
  const res = await navigate(tab.id, fileUrlOf(tab.url), { step }).catch(console.error);
  if (res?.edge) chrome.tabs.sendMessage(tab.id, { type: 'edge', step }).catch(() => {});
});

// Per tab, the files opened from the folder view or stepped to from one, for
// the header bar's "only when opened from the folder view" mode. Kept in
// session storage so it survives the service worker restarting.
const explorerKey = (tabId) => `explorer:${tabId}`;
const withoutHash = (url) => url.split('#')[0];

async function explorerFiles(tabId) {
  const key = explorerKey(tabId);
  return (await chrome.storage.session.get(key))[key] || [];
}

async function markFromExplorer(tabId, fileUrl) {
  const files = await explorerFiles(tabId);
  const url = withoutHash(fileUrl);
  if (!files.includes(url)) await chrome.storage.session.set({ [explorerKey(tabId)]: [...files, url] });
}

async function fromExplorer(tabId, fileUrl) {
  return (await explorerFiles(tabId)).includes(withoutHash(fileUrl));
}

// A file or folder opened from the folder view. It's marked before the page
// starts loading, since the page asks right away whether to show the bar. New
// tabs open in the background next to the folder, like Ctrl+click on a link;
// they start blank so they have an id to mark (Chrome replaces that entry).
async function openFromExplorer(fromTab, url, newTab) {
  const tabId = newTab
    ? (await chrome.tabs.create({ url: 'about:blank', index: fromTab.index + 1, openerTabId: fromTab.id, active: false })).id
    : fromTab.id;
  if (!url.endsWith('/')) await markFromExplorer(tabId, url);
  await show(tabId, url);
}

// Slideshows run per tab, across the files they step through.
const slideshowKey = (tabId) => `slideshow:${tabId}`;

// F switches the browser window to fullscreen (page fullscreen would end at the
// next file) and back to how it was before, e.g. maximized.
async function setFullscreen(windowId, on, tabId) {
  const key = `window-state:${windowId}`;
  const win = await chrome.windows.get(windowId);
  if (on && win.state !== 'fullscreen') {
    await chrome.storage.session.set({ [key]: win.state });
    await chrome.windows.update(windowId, { state: 'fullscreen' });
  } else if (!on && win.state === 'fullscreen') {
    const before = (await chrome.storage.session.get(key))[key];
    await chrome.windows.update(windowId, { state: before && before !== 'fullscreen' ? before : 'normal' });
  }
  const { state } = await chrome.windows.get(windowId);
  chrome.tabs.sendMessage(tabId, { type: 'fullscreen', on: state === 'fullscreen' }).catch(() => {});
}

// Lets the window's active tab know, also when F11 changed it.
async function tellFullscreen(windowId) {
  const win = await chrome.windows.get(windowId, { populate: true });
  const tab = win.tabs.find((t) => t.active);
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'fullscreen', on: win.state === 'fullscreen' }).catch(() => {});
}

chrome.windows.onBoundsChanged.addListener((win) => tellFullscreen(win.id).catch(() => {}));

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove([explorerKey(tabId), slideshowKey(tabId)]));

// The folder the toolbar icon (and Alt+Shift+E) opens: the one in the
// settings, else the last folder browsed, else the home folder if it can be
// guessed, else the root. Extensions can't ask for the home folder, so it's
// the only folder in /home (/Users, C:\Users) that isn't a shared one.
async function startFolder() {
  const { startFolder: setting } = await getSettings();
  if (setting?.trim()) return folderUrl(setting.trim());
  const { lastFolder } = await chrome.storage.local.get('lastFolder');
  return lastFolder || (await guessHome()) || (await rootFolder());
}

async function rootFolder() {
  return (await chrome.runtime.getPlatformInfo()).os === 'win' ? 'file:///C:/' : 'file:///';
}

async function guessHome() {
  const { os } = await chrome.runtime.getPlatformInfo();
  const base = { mac: 'file:///Users/', win: 'file:///C:/Users/' }[os] || 'file:///home/';
  const shared = /^(shared|public|default|default user|all users|guest|lost\+found)$/i;
  try {
    const homes = (await listDir(base)).filter((e) => e.isDir && !e.name.startsWith('.') && !shared.test(e.name));
    return homes.length === 1 ? `${base}${homes[0].href}/` : null;
  } catch {
    return null;
  }
}

// A folder URL from what's typed in the settings: a path (/home/me, ~/Music,
// C:\Users\me) or a file:// URL.
async function folderUrl(input) {
  let url = input;
  if (input === '~' || input.startsWith('~/')) {
    const home = (await guessHome()) || (await rootFolder());
    url = home + input.slice(2);
  } else if (!input.startsWith('file://')) {
    const path = input.replace(/\\/g, '/');
    const encoded = path.split('/').map((part) => (/^[a-z]:$/i.test(part) ? part : encodeURIComponent(part))).join('/');
    url = 'file://' + (encoded.startsWith('/') ? '' : '/') + encoded;
  }
  return url.endsWith('/') ? url : url + '/';
}

// Clicking the toolbar icon, or its shortcut, opens the folder view in a new
// tab. Without file access it can't show anything, so the settings page
// (which explains that) opens instead. Settings are also in the icon's
// right-click menu and behind the folder view's ⚙ button.
async function openExplorer(tab) {
  if (!(await chrome.extension.isAllowedFileSchemeAccess())) return chrome.runtime.openOptionsPage();
  await chrome.tabs.create({ url: await startFolder(), index: tab ? tab.index + 1 : undefined, openerTabId: tab?.id });
}

chrome.action.onClicked.addListener((tab) => openExplorer(tab).catch(console.error));

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // Without file access the extension silently does nothing, so point it out.
  if (reason === 'install' && !(await chrome.extension.isAllowedFileSchemeAccess())) {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen') return;
  const tab = sender.tab;
  if (msg.type === 'navigate') {
    navigate(tab.id, msg.url, msg.move)
      .catch(console.error)
      .then(sendResponse);
    return true;
  } else if (msg.type === 'open') {
    openFromExplorer(tab, msg.url, msg.newTab).catch(console.error);
  } else if (msg.type === 'playlist') {
    playlist(msg.url).then(sendResponse, (err) => sendResponse({ error: err.message }));
    return true;
  } else if (msg.type === 'image-png') {
    offscreen({ type: 'image-png', url: msg.url }).then(sendResponse, (err) => sendResponse({ error: err.message }));
    return true;
  } else if (msg.type === 'open-options') {
    chrome.runtime.openOptionsPage();
  } else if (msg.type === 'start-folder') {
    startFolder().then((url) => sendResponse(url));
    return true;
  } else if (msg.type === 'go') {
    show(tab.id, msg.url);
  } else if (msg.type === 'bar-state') {
    Promise.all([fromExplorer(tab.id, msg.url), chrome.windows.get(tab.windowId), chrome.storage.session.get(slideshowKey(tab.id))])
      .then(([opened, win, slides]) =>
        sendResponse({ fromExplorer: opened, fullscreen: win.state === 'fullscreen', slideshow: !!slides[slideshowKey(tab.id)] })
      );
    return true;
  } else if (msg.type === 'fullscreen') {
    setFullscreen(tab.windowId, msg.on, tab.id).catch(console.error);
  } else if (msg.type === 'slideshow') {
    chrome.storage.session.set({ [slideshowKey(tab.id)]: msg.on });
  } else if (msg.type === 'position') {
    const justMoved = justNavigated.delete(tab.id);
    siblings(msg.url)
      .then(({ files, index, wrap }) => {
        const at = (i) => (wrap ? files[(i + files.length) % files.length] : files[i]);
        sendResponse({
          justMoved,
          index,
          total: files.length,
          name: files[index] && files[index].name,
          hasPrev: wrap ? files.length > 1 : index > 0,
          hasNext: wrap ? files.length > 1 : index < files.length - 1,
          neighbors: [at(index - 1), at(index + 1)].filter((f) => f && f.name !== files[index].name).map((f) => f.url),
        });
      })
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});
