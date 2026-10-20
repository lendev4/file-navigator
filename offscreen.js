// Reads file:// URLs for the background worker: Chrome's directory listing
// pages, and images to copy. Service workers can't load file:// URLs, but
// extension pages with file access can via XHR.

function readUrl(url, responseType = 'text') {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = responseType;
    xhr.onload = () => resolve(xhr.response);
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

// The clipboard only takes PNG images, so others are drawn and re-encoded.
// File pages can't do this themselves: their own image would taint a canvas.
async function imageAsPng(url) {
  const blob = await readUrl(url, 'blob');
  if (blob.type === 'image/png') return blob;
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  const canvas = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
  canvas.getContext('2d').drawImage(img, 0, 0);
  URL.revokeObjectURL(img.src);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

// Messages carry JSON, so the PNG travels as a data: URL.
const dataUrl = (blob) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  const work =
    msg.type === 'list-dir' ? readUrl(msg.dirUrl).then((html) => ({ entries: parseListing(html) }))
    : msg.type === 'image-png' ? imageAsPng(msg.url).then(dataUrl).then((png) => ({ png }))
    : null;
  if (!work) return;
  work.then(sendResponse, (err) => sendResponse({ error: err.message }));
  return true;
});
