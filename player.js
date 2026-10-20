// Music player, opened as player.html?file=<file URL>. It plays the whole
// folder in this one page, switching tracks without reloading, so shuffle,
// repeat and playing on to the next track work without gaps.

const $ = (id) => document.getElementById(id);
const audio = new Audio();

let tracks = []; // { name, url, title, artist, album, cover, duration }
let order = []; // indices into tracks, in playing order (shuffled or not)
let index = 0; // the current track
let folderCover; // cover.jpg or similar in the folder
let settings = DEFAULT_SETTINGS;

const startUrl = new URLSearchParams(location.search).get('file');
const folderUrl = new URL('./', startUrl).href;
const folderName = decodeURIComponent(new URL(folderUrl).pathname.split('/').at(-2) || '') || '/';

// "03 - Song Title.mp3" → "Song Title", "04_night_drive.ogg" → "night drive".
function prettyName(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ')
    .replace(/^\s*\d{1,3}(?:[-.]\d{1,3})?\s*[-.)]*\s+(?=\S)/, '')
    .trim();
}

const time = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

async function init() {
  settings = await getSettings();
  $('folder').textContent = folderName;
  $('bar-kind').style.webkitMaskImage = KIND_ICONS.audio;
  document.querySelector('.cover-note').style.webkitMaskImage = KIND_ICONS.audio;
  const { volume } = await chrome.storage.local.get('volume');
  audio.volume = volume ?? 1;

  const list = await chrome.runtime.sendMessage({ type: 'playlist', url: startUrl });
  if (list?.error || !list?.files.length) return showMessage(`Could not read the folder. ${list?.error || ''}`);
  tracks = list.files.map((f) => ({ ...f, title: prettyName(f.name) }));
  folderCover = list.cover;
  renderTracks();
  makeOrder(Math.max(0, list.index));
  updateModes();
  play(Math.max(0, list.index));
  loadDurations();
}

// Playing --------------------------------------------------------------------

function play(i, { autoplay = true } = {}) {
  index = i;
  const track = tracks[i];
  audio.src = track.url;
  // The address shows the current track, so reloading and "back to folder" use it.
  history.replaceState(null, '', `?file=${encodeURIComponent(track.url)}`);
  $('message').hidden = true;
  showTrack();
  readTags(track).then(() => track === tracks[index] && showTrack());
  if (autoplay) audio.play().catch(() => {}); // stays paused if Chrome blocks autoplay
}

// The playing order: as listed, or shuffled with the current track first.
function makeOrder(first) {
  order = tracks.map((_, i) => i);
  if (!settings.playerShuffle) return;
  order.splice(order.indexOf(first), 1);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.unshift(first);
}

// `ended`: moving on by itself at the end of a track, where "repeat one" plays
// it again and the end of the list stops unless repeating all.
function next(ended = false) {
  if (ended && settings.playerRepeat === 'one') return play(index);
  const pos = order.indexOf(index) + 1;
  if (pos < order.length) return play(order[pos]);
  if (settings.playerRepeat === 'all') {
    makeOrder(order[0]);
    return play(order[0]);
  }
  if (ended) showTrack(); // stopped after the last track
}

// Back to the start of the track, or to the previous one near its start.
function previous() {
  if (audio.currentTime > 3) return (audio.currentTime = 0);
  const pos = order.indexOf(index) - 1;
  if (pos >= 0) play(order[pos]);
  else if (settings.playerRepeat === 'all') play(order.at(-1));
  else audio.currentTime = 0;
}

const togglePlay = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());

function seekBy(seconds) {
  if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(Math.max(audio.currentTime + seconds, 0), audio.duration);
}

function setVolume(v) {
  audio.volume = Math.min(Math.max(v, 0), 1);
  audio.muted = false;
  chrome.storage.local.set({ volume: audio.volume });
}

// Shuffle and repeat are settings, so they stay as they were next time.
function toggleShuffle() {
  settings.playerShuffle = !settings.playerShuffle;
  makeOrder(index);
  chrome.storage.sync.set({ playerShuffle: settings.playerShuffle });
  updateModes();
}

function cycleRepeat() {
  const modes = ['off', 'all', 'one'];
  settings.playerRepeat = modes[(modes.indexOf(settings.playerRepeat) + 1) % modes.length];
  chrome.storage.sync.set({ playerRepeat: settings.playerRepeat });
  updateModes();
}

// Ctrl+C: the current track's path (browsers can't copy files themselves).
let noticeTimer;
function copyPath() {
  const path = filePath(tracks[index].url);
  navigator.clipboard.writeText(path).then(() => {
    $('message').textContent = `Copied ${path}`;
    $('message').className = 'message notice';
    $('message').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => ($('message').hidden = true), 2000);
  });
}

function goToFolder() {
  const url = folderUrl + '#' + encodeURIComponent(tracks[index]?.name || '');
  chrome.runtime.sendMessage({ type: 'go', url });
}

audio.addEventListener('ended', () => next(true));
audio.addEventListener('error', () => {
  const track = tracks[index];
  if (!track || !audio.src) return;
  track.unplayable = true;
  showMessage(`Chrome can't play ${track.name}.`);
  renderTracks();
  // Skip it, but don't spin through a whole folder of unplayable files.
  if (tracks.some((t) => !t.unplayable)) setTimeout(() => track === tracks[index] && next(true), 1500);
});
for (const event of ['play', 'pause', 'loadedmetadata', 'timeupdate', 'volumechange']) {
  audio.addEventListener(event, updateControls);
}

// Showing ----------------------------------------------------------------------

function showMessage(text) {
  $('message').textContent = text;
  $('message').className = 'message';
  $('message').hidden = false;
}

function showTrack() {
  const track = tracks[index];
  $('title').textContent = track.title;
  $('artist').textContent = [track.artist, track.album].filter(Boolean).join(' · ');
  $('bar-name').textContent = track.name;
  $('bar-count').textContent = `${index + 1} / ${tracks.length}`;
  document.title = track.artist ? `${track.title} · ${track.artist}` : track.title;

  const cover = track.cover || folderCover;
  const img = $('cover-img');
  img.hidden = !cover;
  if (cover && img.src !== cover) img.src = cover;
  $('cover').classList.toggle('has-image', !!cover);
  // Without a cover, a colour picked from the album or folder name.
  if (!cover) $('cover').style.background = gradientFor(track.album || folderName);

  for (const li of $('tracks').children) li.classList.toggle('current', Number(li.dataset.index) === index);
  $('tracks').children[index]?.scrollIntoView({ block: 'nearest' });
  updateMediaSession(track, cover);
  updateControls();
}

function gradientFor(text) {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue} 60% 55%), hsl(${(hue + 50) % 360} 65% 40%))`;
}

function updateControls() {
  const playing = !audio.paused;
  const play = $('play');
  play.querySelector('.i').className = `i i-${playing ? 'pause' : 'play'}`;
  play.title = playing ? 'Pause (Space)' : 'Play (Space)';
  play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('time').textContent = time(audio.currentTime);
  $('duration').textContent = time(audio.duration);
  if (!seeking) $('seek').value = audio.duration ? (audio.currentTime / audio.duration) * 1000 : 0;
  $('volume').value = audio.muted ? 0 : Math.round(audio.volume * 100);
  $('mute').querySelector('.i').className = `i i-${audio.muted || audio.volume === 0 ? 'muted' : 'volume'}`;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

function updateModes() {
  $('shuffle').setAttribute('aria-pressed', settings.playerShuffle);
  const repeat = $('repeat');
  repeat.setAttribute('aria-pressed', settings.playerRepeat !== 'off');
  repeat.classList.toggle('one', settings.playerRepeat === 'one');
  repeat.title = { off: 'Repeat: off (R)', all: 'Repeat: all (R)', one: 'Repeat: this track (R)' }[settings.playerRepeat];
}

function renderTracks() {
  $('tracks').replaceChildren(
    ...tracks.map((track, i) => {
      const li = document.createElement('li');
      li.dataset.index = i;
      li.classList.toggle('current', i === index);
      li.classList.toggle('unplayable', !!track.unplayable);
      const n = Object.assign(document.createElement('span'), { className: 'n', textContent: i + 1 });
      const name = Object.assign(document.createElement('span'), { className: 'name', textContent: track.title });
      if (track.artist) name.append(' ', Object.assign(document.createElement('span'), { className: 'sub', textContent: `· ${track.artist}` }));
      const len = Object.assign(document.createElement('span'), { className: 'len', textContent: track.duration ? time(track.duration) : '' });
      li.title = track.name;
      li.append(n, name, len);
      return li;
    })
  );
}

$('tracks').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (li) play(Number(li.dataset.index));
});

// Track lengths for the list, read one at a time in the background.
async function loadDurations() {
  for (const track of tracks) {
    if (track.duration) continue;
    const probe = Object.assign(new Audio(), { preload: 'metadata' });
    track.duration = await new Promise((resolve) => {
      probe.onloadedmetadata = () => resolve(probe.duration);
      probe.onerror = () => resolve(0);
      probe.src = track.url;
    });
    probe.removeAttribute('src');
    const len = $('tracks').children[tracks.indexOf(track)]?.querySelector('.len');
    if (len && track.duration) len.textContent = time(track.duration);
  }
}

// Media Session: media keys, and the system's media controls show the track.
function updateMediaSession(track, cover) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist || '',
    album: track.album || folderName,
    artwork: cover ? [{ src: cover }] : [],
  });
}

if ('mediaSession' in navigator) {
  const handlers = {
    play: () => audio.play(),
    pause: () => audio.pause(),
    previoustrack: previous,
    nexttrack: () => next(),
    seekbackward: () => seekBy(-10),
    seekforward: () => seekBy(10),
    seekto: (e) => (audio.currentTime = e.seekTime),
  };
  for (const [action, handler] of Object.entries(handlers)) navigator.mediaSession.setActionHandler(action, handler);
}

// Controls -------------------------------------------------------------------

let seeking = false;
$('seek').addEventListener('input', () => {
  seeking = true;
  $('time').textContent = time((($('seek').value / 1000) * audio.duration) || 0);
});
$('seek').addEventListener('change', () => {
  if (Number.isFinite(audio.duration)) audio.currentTime = ($('seek').value / 1000) * audio.duration;
  seeking = false;
});
$('volume').addEventListener('input', () => setVolume($('volume').value / 100));
// Let go of the sliders afterwards, so the arrow keys change tracks again.
for (const slider of [$('seek'), $('volume')]) slider.addEventListener('pointerup', () => slider.blur());

$('play').addEventListener('click', togglePlay);
$('prev').addEventListener('click', previous);
$('next').addEventListener('click', () => next());
$('shuffle').addEventListener('click', toggleShuffle);
$('repeat').addEventListener('click', cycleRepeat);
$('mute').addEventListener('click', () => (audio.muted = !audio.muted));
$('back').addEventListener('click', goToFolder);

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c' && !String(getSelection()) && tracks.length) {
    e.preventDefault();
    return copyPath();
  }
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const actions = {
    ' ': togglePlay,
    ArrowRight: () => (e.shiftKey ? seekBy(10) : next()),
    ArrowLeft: () => (e.shiftKey ? seekBy(-10) : previous()),
    ArrowUp: () => setVolume(audio.volume + 0.1),
    ArrowDown: () => setVolume(audio.volume - 0.1),
    s: toggleShuffle,
    r: cycleRepeat,
    m: () => (audio.muted = !audio.muted),
    Backspace: goToFolder,
  };
  const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!action) return;
  e.preventDefault();
  // Buttons keep focus after a click; Space should still mean play / pause.
  document.activeElement?.blur();
  action();
});

// Alt+Shift+Left/Right, handled by the background.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'player-step') return;
  if (msg.step > 0) next();
  else previous();
});

// Tags ---------------------------------------------------------------------------

// Title, artist, album and the cover from an MP3's ID3 tags (v2.3, v2.4, and v1
// at the end of the file). Other formats keep the file name.
async function readTags(track) {
  if (track.tagsRead || extOf(track.name) !== 'mp3') return;
  track.tagsRead = true;
  const buffer = await new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', track.url);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () => resolve(null);
    xhr.send();
  });
  if (!buffer) return;
  const tags = parseId3(new Uint8Array(buffer));
  if (tags.title) track.title = tags.title;
  if (tags.artist) track.artist = tags.artist;
  if (tags.album) track.album = tags.album;
  if (tags.picture) track.cover = URL.createObjectURL(tags.picture);
  const li = $('tracks').children[tracks.indexOf(track)];
  if (li) {
    li.querySelector('.name').textContent = track.title;
    if (track.artist) li.querySelector('.name').append(' ', Object.assign(document.createElement('span'), { className: 'sub', textContent: `· ${track.artist}` }));
  }
}

const syncsafe = (b, p) => (b[p] << 21) | (b[p + 1] << 14) | (b[p + 2] << 7) | b[p + 3];
const uint32 = (b, p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;

// ID3 text: an encoding byte (0 Latin-1, 1 UTF-16 with BOM, 2 UTF-16BE, 3 UTF-8).
function decodeText(bytes, encoding) {
  let label = ['latin1', 'utf-16', 'utf-16be', 'utf-8'][encoding] || 'latin1';
  if (encoding === 1 && bytes[0] === 0xfe && bytes[1] === 0xff) label = 'utf-16be';
  else if (encoding === 1) label = 'utf-16le';
  // v2.4 can hold several values separated by NULs; the first is enough.
  return new TextDecoder(label).decode(bytes).split('\0')[0].trim();
}

function parseId3(b) {
  const tags = {};
  const isId3v2 = b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33;
  const version = b[3];
  if (isId3v2 && (version === 3 || version === 4)) {
    const end = Math.min(10 + syncsafe(b, 6), b.length);
    let p = 10;
    // Skip an extended header.
    if (b[5] & 0x40) p += version === 4 ? syncsafe(b, 10) : uint32(b, 10) + 4;
    while (p + 10 <= end) {
      const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding
      const size = version === 4 ? syncsafe(b, p + 4) : uint32(b, p + 4);
      const data = b.subarray(p + 10, p + 10 + size);
      p += 10 + size;
      if (id === 'TIT2') tags.title = decodeText(data.subarray(1), data[0]);
      else if (id === 'TPE1') tags.artist = decodeText(data.subarray(1), data[0]);
      else if (id === 'TALB') tags.album = decodeText(data.subarray(1), data[0]);
      else if (id === 'APIC' && !tags.picture) tags.picture = id3Picture(data);
    }
  }
  // ID3v1: 128 bytes at the end, starting with "TAG".
  const v1 = b.length - 128;
  if (!tags.title && v1 > 0 && b[v1] === 0x54 && b[v1 + 1] === 0x41 && b[v1 + 2] === 0x47) {
    const field = (from, length) => decodeText(b.subarray(v1 + from, v1 + from + length), 0);
    tags.title = field(3, 30);
    tags.artist = tags.artist || field(33, 30);
    tags.album = tags.album || field(63, 30);
  }
  return tags;
}

// APIC: encoding, MIME type, picture type, description, then the image.
function id3Picture(data) {
  const encoding = data[0];
  const mimeEnd = data.indexOf(0, 1);
  if (mimeEnd < 0) return null;
  const mime = new TextDecoder('latin1').decode(data.subarray(1, mimeEnd)).toLowerCase();
  let p = mimeEnd + 2; // after the picture type
  // The description ends with one NUL, or two (aligned) for UTF-16.
  if (encoding === 1 || encoding === 2) {
    while (p + 1 < data.length && (data[p] || data[p + 1])) p += 2;
    p += 2;
  } else {
    while (p < data.length && data[p]) p++;
    p += 1;
  }
  return new Blob([data.subarray(p)], { type: mime.includes('/') ? mime : `image/${mime || 'jpeg'}` });
}

init();
