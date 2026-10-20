// Reads Chrome's file:// directory listing page. Service workers can't load
// file:// URLs, but extension pages with file access can via XHR.

function readUrl(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.onload = () => resolve(xhr.responseText);
    xhr.onerror = () => reject(new Error('Could not read ' + url));
    xhr.send();
  });
}

// The listing page contains lines like:
//   <script>addRow("name","url-encoded-name",isDir,size,"size",mtime,"mtime");</script>
function parseListing(html) {
  const entries = [];
  const re = /addRow\((.*)\);/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      const [name, href, isDir, size, , mtime] = JSON.parse('[' + m[1] + ']');
      if (name === '..') continue;
      entries.push({ name, href, isDir: !!isDir, size, mtime });
    } catch (_) {
      // Ignore rows we can't parse.
    }
  }
  return entries;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen' || msg.type !== 'list-dir') return;
  readUrl(msg.dirUrl)
    .then((html) => sendResponse({ entries: parseListing(html) }))
    .catch((err) => sendResponse({ error: err.message }));
  return true;
});
