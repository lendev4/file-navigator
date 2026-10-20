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

async function listDir(dirUrl) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'list-dir', dirUrl });
  if (!res || res.error) throw new Error(res ? res.error : 'No response from offscreen document');
  return res.entries;
}

// Returns the sorted sibling files in the current file's group and its index.
async function siblings(fileUrl) {
  const settings = await getSettings();
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

// Opens fileUrl in the tab, going through the text viewer where needed.
function show(tabId, fileUrl) {
  return chrome.tabs.update(tabId, { url: openUrl(fileUrl) });
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

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(explorerKey(tabId)));

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

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
  } else if (msg.type === 'go') {
    show(tab.id, msg.url);
  } else if (msg.type === 'bar-state') {
    fromExplorer(tab.id, msg.url).then((opened) => sendResponse({ fromExplorer: opened }));
    return true;
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
