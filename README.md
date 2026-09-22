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
2. On click it presses YouTube's own **Show transcript** button if the transcript panel is closed
   and waits for whichever transcript panel YouTube opens (the classic
   `engagement-panel-searchable-transcript` or the 2026 `PAmodern_transcript_view`).
3. It reads the lines with the first reader that finds any: the classic
   `ytd-transcript-segment-renderer` markup, the modern `transcript-segment-view-model` markup,
   or a markup-agnostic fallback that treats every `m:ss` text in the panel as the start of a line.
4. The text goes to the clipboard through `navigator.clipboard.writeText`, with a
   `document.execCommand("copy")` fallback.
5. If the panel was closed before, it is closed again.

`background.js` only forwards toolbar-icon clicks to the content script.

## Limitations

- Works only when YouTube offers a transcript for the video (most videos with captions do).
- Relies on YouTube's DOM. If YouTube changes its markup again, the fallback reader should still
  cope; if the button says **No transcript** while the panel shows text, open DevTools and copy the
  `YouTube Copy Transcript: no segments found` warning into an issue.
- The transcript is copied in whatever language the transcript panel is currently set to.

## License

[MIT](LICENSE)
