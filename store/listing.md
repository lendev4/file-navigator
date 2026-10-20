# Chrome Web Store listing

Texts and answers for the Chrome Web Store developer dashboard. Images are in
this folder (regenerate them with `mise exec -- npm run store` in `tests/`).

## Store listing

**Name:** File Navigator

**Summary** (the manifest description, max. 132 characters):

> Browse local files like in a file explorer: folder view with thumbnails, arrow keys to step through files, Markdown, CSV and music.

**Category:** Tools (Productivity)

**Homepage URL:** https://github.com/lendev4/file-navigator

**Support URL:** https://github.com/lendev4/file-navigator/issues

**Language:** English

**Description:**

```
File Navigator makes Chrome a pleasant way to look through files on your computer. Open a folder (or click the toolbar icon) and browse it like in a file explorer, then step from file to file with the arrow keys.

FOLDER VIEW
• Replaces Chrome's plain "Index of" page: folders first, file-type icons, a clickable path, a filter box and sortable columns
• A thumbnail grid for photo and video folders, chosen automatically or per folder
• Full keyboard control: arrow keys, Enter, Backspace for the parent folder, type a name to jump to it, / to filter
• Click to select and double-click to open, like a file manager (or single-click, if you prefer)

STEP THROUGH FILES
• ← and → open the previous or next file of the same kind: images, videos, audio, PDFs or text files
• Alt+Shift+← / → work everywhere, also in PDFs and videos
• A header bar shows the file name, its position in the folder and a way back to the folder (Backspace)

IMAGES AND VIDEOS
• F for fullscreen that stays on while you step through photos
• A slideshow (Space or S), and "play all" for videos
• Zoom with + and −, 0 to fit, 1 for actual size

MORE FILE TYPES
• Markdown is rendered, with syntax highlighting for code, and a switch to the source
• CSV and TSV files open as tables
• A music player for audio files: plays the whole folder, with shuffle, repeat, cover art, titles from MP3 tags and media keys
• Files Chrome would download (YAML, TOML, SQL, .mov videos, ...) open in the browser instead

COPY
• Ctrl+C copies an image, or a file's path

Everything happens on your computer. File Navigator doesn't collect or send any data, and doesn't contact any server.

After installing, open the extension's details page (chrome://extensions) and turn on "Allow access to file URLs". Chrome requires this for any extension that works with local files.
```

**Images:**

| Asset | File |
|---|---|
| Store icon (128 × 128) | `icon-128.png` |
| Screenshots (1280 × 800) | `screenshots/1-folder-view.png` … `5-music-player.png` |
| Small promo tile (440 × 280) | `promo-small.png` |

## Privacy practices

**Single purpose:**

> Browsing local files in Chrome: a file-explorer style view of folders, stepping between the files of a folder, and viewers for file types Chrome shows poorly or downloads (Markdown, CSV, audio, some text and video formats).

**Permission justifications:**

| Permission | Justification |
|---|---|
| `file:///*` (host) | The extension only works on local files: it adds the folder view and keyboard navigation to file:// pages and reads folder listings and files to show them. It doesn't access any websites. |
| `storage` | Saves the user's settings (sort order, layout, start folder, …) and small state such as the last folder browsed. Stays in the browser. |
| `offscreen` | The background service worker can't load file:// URLs, so an offscreen document reads folder listings and files for it, and converts images to PNG when the user copies one. |

**Remote code:** No. All code, including the bundled libraries (marked, DOMPurify, highlight.js), is in the package.

**Data usage:** The extension does not collect or transmit any user data. In the form, leave every data type unchecked and certify:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/lendev4/file-navigator/blob/main/PRIVACY.md

## Distribution

**Visibility:** Public (or Unlisted to try it first)

**Regions:** All
