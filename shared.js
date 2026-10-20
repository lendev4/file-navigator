// Shared by the background worker, the content scripts and the options page.

// Text formats Chrome downloads instead of showing (it goes by the system's
// file type for each extension). They open in the extension's text viewer.
const VIEWER_EXTS = ['csv', 'tsv', 'yaml', 'yml', 'toml', 'sql', 'srt', 'php', 'pl', 'rb', 'fish', 'tsx', 'mts', 'cts'];
// Markdown also opens in the text viewer, which renders it.
const MARKDOWN_EXTS = ['md', 'markdown', 'mdown', 'mkd'];
// Videos Chrome downloads although it can usually play them (QuickTime .mov is
// mostly H.264). The viewer shows them in a video player.
const VIEWER_VIDEO_EXTS = ['mov'];

const CATEGORIES = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico', 'jxl'],
  video: ['mp4', 'webm', 'm4v', 'ogv', 'mkv', ...VIEWER_VIDEO_EXTS],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus'],
  pdf: ['pdf'],
  text: [
    'txt', ...MARKDOWN_EXTS, 'log', 'json', 'xml', 'ini', 'conf', 'cfg', 'env', 'lock', 'properties', 'diff', 'patch',
    'rst', 'tex', 'bib', 'vtt', 'org', 'adoc', 'c', 'h', 'cpp', 'hpp', 'css', 'scss', 'less', 'go', 'java',
    'kt', 'swift', 'js', 'mjs', 'jsx', 'ts', 'lua', 'nix', 'py', 'rs', 'sh', 'bash', 'zsh', 'gradle', 'svelte', 'vue',
    ...VIEWER_EXTS,
  ],
  html: ['html', 'htm'],
};
// Left out on purpose: tiff. Chrome downloads it and can't show it.

function extOf(name) {
  return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
}

// Unknown types form their own group per extension.
function categoryOf(name) {
  const ext = extOf(name);
  for (const [cat, exts] of Object.entries(CATEGORIES)) {
    if (exts.includes(ext)) return cat;
  }
  return 'ext:' + ext;
}

// What a file looks like in the UI: its category, or 'other' for unknown types.
function kindOf(name) {
  const cat = categoryOf(name);
  return cat.startsWith('ext:') ? 'other' : cat;
}

const VIEWER_PAGE = 'viewer.html';
const PLAYER_PAGE = 'player.html';

const isMarkdown = (name) => MARKDOWN_EXTS.includes(extOf(name));

// The URL to show a file at: the file itself, the viewer for Markdown and for
// formats Chrome would download, or the music player for audio (if it's on).
function openUrl(fileUrl, settings = DEFAULT_SETTINGS) {
  const name = decodeURIComponent(new URL(fileUrl).pathname.split('/').pop());
  const ext = extOf(name);
  const page =
    settings.musicPlayer && categoryOf(name) === 'audio' ? PLAYER_PAGE
    : VIEWER_EXTS.includes(ext) || VIEWER_VIDEO_EXTS.includes(ext) || isMarkdown(name) ? VIEWER_PAGE
    : null;
  return page ? `${chrome.runtime.getURL(page)}?file=${encodeURIComponent(fileUrl)}` : fileUrl;
}

// The file a tab shows, also when that's the viewer or the music player.
function fileUrlOf(tabUrl) {
  const page = [VIEWER_PAGE, PLAYER_PAGE].find((p) => tabUrl?.startsWith(chrome.runtime.getURL(p)));
  return page ? new URL(tabUrl).searchParams.get('file') : tabUrl;
}

// Images in a music folder used as its cover.
const COVER_NAMES = /^(cover|folder|front|album|albumart)\.(jpe?g|png|webp)$/i;

// File-type icons, used as CSS masks by the folder view and the header bar.
const KIND_ICONS = {
  other: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cmask id='m'%3E%3Crect width='24' height='24' fill='white'/%3E%3Cpath d='M13.5 2v5a1.5 1.5 0 0 0 1.5 1.5h5' fill='none' stroke='black' stroke-width='1.6'/%3E%3C/mask%3E%3Cpath d='M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z' mask='url%28%23m%29'/%3E%3C/svg%3E")`,
  text: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cmask id='m'%3E%3Crect width='24' height='24' fill='white'/%3E%3Cpath d='M13.5 2v5a1.5 1.5 0 0 0 1.5 1.5h5' fill='none' stroke='black' stroke-width='1.6'/%3E%3Cpath d='M8 13h8M8 16.5h5.5' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/mask%3E%3Cpath d='M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z' mask='url%28%23m%29'/%3E%3C/svg%3E")`,
  pdf: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cmask id='m'%3E%3Crect width='24' height='24' fill='white'/%3E%3Cpath d='M13.5 2v5a1.5 1.5 0 0 0 1.5 1.5h5' fill='none' stroke='black' stroke-width='1.6'/%3E%3Crect x='7' y='12' width='10' height='6' rx='1.2' fill='black'/%3E%3C/mask%3E%3Cpath d='M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z' mask='url%28%23m%29'/%3E%3C/svg%3E")`,
  html: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cmask id='m'%3E%3Crect width='24' height='24' fill='white'/%3E%3Cpath d='M13.5 2v5a1.5 1.5 0 0 0 1.5 1.5h5' fill='none' stroke='black' stroke-width='1.6'/%3E%3Cpath d='M10 12.5 7.6 15l2.4 2.5M14 12.5l2.4 2.5-2.4 2.5' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/mask%3E%3Cpath d='M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z' mask='url%28%23m%29'/%3E%3C/svg%3E")`,
  image: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cmask id='m'%3E%3Crect width='24' height='24' fill='white'/%3E%3Ccircle cx='8.8' cy='8.8' r='1.9' fill='black'/%3E%3Cpath d='M5.5 18.5 10 13l3 3.5 2.2-2.4 3.3 4.4z' fill='black'/%3E%3C/mask%3E%3Cpath d='M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z' mask='url%28%23m%29'/%3E%3C/svg%3E")`,
  video: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cmask id='m'%3E%3Crect width='24' height='24' fill='white'/%3E%3Cpath d='M10 9v6l5.2-3z' fill='black'/%3E%3C/mask%3E%3Cpath d='M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z' mask='url%28%23m%29'/%3E%3C/svg%3E")`,
  audio: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='7.5' cy='17.5' r='3'/%3E%3Ccircle cx='17.5' cy='15.5' r='3'/%3E%3Cpath d='M8.7 17.5V6.2L20.5 3.5v12h-1.8V7.6L10.5 9.5v8z'/%3E%3C/svg%3E")`,
  dir: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M2 6a2 2 0 0 1 2-2h5l2 2.5h9a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z'/%3E%3C/svg%3E")`,
};

const DEFAULT_SETTINGS = {
  sortBy: 'name', // name | mtime | size
  sortDir: 'asc', // asc | desc
  grouping: 'kind', // kind | extension | all
  showHidden: false,
  wrap: false,
  label: 'brief', // off | brief | always
  folderView: true,
  folderLayout: 'auto', // auto | list | grid
  fileBar: 'explorer', // explorer | always | never
  markdownView: 'rendered', // rendered | source
  csvView: 'rendered', // rendered (a table) | source
  slideshowSeconds: 5,
  musicPlayer: true,
  // Changed in the music player itself.
  playerShuffle: false,
  playerRepeat: 'off', // off | all | one
};

async function getSettings() {
  const stored = await chrome.storage.sync.get(null);
  // Before 0.7 there were ‹ › buttons at the page edges; they're in the header
  // bar now, so keep them visible for anyone who had them on.
  const hadArrows = (stored.arrows && stored.arrows !== 'off') || stored.edgeArrows;
  if (hadArrows && !('fileBar' in stored)) stored.fileBar = 'always';
  return { ...DEFAULT_SETTINGS, ...stored };
}
