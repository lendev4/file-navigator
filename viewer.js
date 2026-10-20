// Text viewer for formats Chrome downloads instead of showing (CSV, YAML,
// TOML, ...; see VIEWER_EXTS). Opened as viewer.html?file=<file URL>.

window.FN_FILE_URL = new URLSearchParams(location.search).get('file');
window.FN_CONTENT_TYPE = 'text/plain';

document.title = decodeURIComponent(new URL(FN_FILE_URL).pathname.split('/').pop());

// Extension pages with file access can read file:// URLs with XHR (not fetch).
// This script runs in <head>, so the file can arrive before the <pre> exists.
const loaded = new Promise((resolve) => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', FN_FILE_URL);
  xhr.onload = () => resolve(xhr.responseText);
  xhr.onerror = () => resolve(`Could not read ${FN_FILE_URL}.\nIs "Allow access to file URLs" on for File Navigator?`);
  xhr.send();
});
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('text').textContent = await loaded;
});
