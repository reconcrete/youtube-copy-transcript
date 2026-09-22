# YouTube Copy Transcript

A tiny Chrome / Chromium extension (Manifest V3) that adds a **Copy transcript** button to
YouTube watch pages. One click copies the video's full transcript to the clipboard as plain text.

- **Click** the button → transcript text, one line per caption segment.
- **Shift-click** → the same text with the `mm:ss` timestamp in front of each line.
- Clicking the extension's toolbar icon does the same as clicking the button.

No API keys, no network requests of its own, no data leaves the browser. The extension simply
opens YouTube's built-in transcript panel, reads it, copies the text and closes the panel again
if it was closed before.

## Install (unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions` (or `brave://extensions`, `arc://extensions`, ...).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and pick the repository folder.
5. Open any YouTube video that has a transcript. The button shows up next to **Like / Share**.

## How it works

`content.js` runs on `https://www.youtube.com/*`:

1. On every watch page (also after YouTube's in-app navigation, via the `yt-navigate-finish` event)
   it injects a button into the action bar (`#top-level-buttons-computed`).
2. On click it presses YouTube's own **Show transcript** button if the transcript panel is closed,
   waits for the `ytd-transcript-segment-renderer` elements to appear, reads `.segment-timestamp`
   and `.segment-text` from each of them and joins the lines.
3. The text goes to the clipboard through `navigator.clipboard.writeText`, with a
   `document.execCommand("copy")` fallback.
4. If the panel was closed before, it is closed again.

`background.js` only forwards toolbar-icon clicks to the content script.

## Limitations

- Works only when YouTube offers a transcript for the video (most videos with captions do).
- Relies on YouTube's DOM (`ytd-*` elements). If YouTube changes its markup the selectors in
  `content.js` may need an update.
- The transcript is copied in whatever language the transcript panel is currently set to.

## License

[MIT](LICENSE)
