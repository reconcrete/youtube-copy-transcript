// YouTube Copy Transcript – content script.
//
// Adds a "Copy transcript" button next to the Like/Share buttons on watch pages.
// Clicking it opens YouTube's own transcript panel (if it is not open yet),
// reads every segment, copies the text to the clipboard and restores the panel.
// Shift-click keeps the timestamps.

(() => {
  "use strict";

  const BUTTON_ID = "yct-copy-transcript-button";
  const DEFAULT_LABEL = "Copy transcript";
  // YouTube ships (at least) two transcript panels: the classic
  // "engagement-panel-searchable-transcript" and the newer "PAmodern_transcript_view".
  // Both are engagement panels whose target-id mentions "transcript".
  const PANEL_SELECTOR = "[target-id*='transcript' i]";
  const SEGMENT_SELECTOR = "ytd-transcript-segment-renderer";
  const TIMESTAMP_RE = /^\d{1,2}:\d{2}(?::\d{2})?$/;
  const PANEL_OPEN = "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED";
  const PANEL_HIDDEN = "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN";

  const ICON_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M4 4h16v2H4zM4 8h16v2H4zM4 12h16v2H4zM4 16h10v2H4z"/>' +
    "</svg>";

  // ---------- helpers ----------

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor(check, { timeout = 8000, interval = 150 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = check();
      if (value) return value;
      await sleep(interval);
    }
    return null;
  }

  const isWatchPage = () => location.pathname === "/watch";

  // ---------- transcript panel ----------

  const isPanelOpen = (panel) =>
    Boolean(panel) && panel.getAttribute("visibility") === PANEL_OPEN;
  const getOpenPanel = () =>
    [...document.querySelectorAll(PANEL_SELECTOR)].find(isPanelOpen) || null;

  function findShowTranscriptButton() {
    const section = document.querySelector(
      "ytd-video-description-transcript-section-renderer"
    );
    if (section) {
      const button = section.querySelector("button");
      if (button) return button;
    }
    for (const button of document.querySelectorAll("button")) {
      const label = (button.getAttribute("aria-label") || button.textContent || "")
        .trim()
        .toLowerCase();
      if (label === "show transcript") return button;
    }
    return null;
  }

  async function openTranscriptPanel() {
    let panel = getOpenPanel();
    if (panel) return { panel, wasOpen: true };

    // The description (and its "Show transcript" button) renders a bit after
    // the action bar, so give it a moment instead of failing on a fast click.
    const button = await waitFor(findShowTranscriptButton, { timeout: 8000 });
    if (!button) return { panel: null, wasOpen: false };
    button.click();

    panel = await waitFor(getOpenPanel, { timeout: 5000 });
    return { panel, wasOpen: false };
  }

  function closeTranscriptPanel(panel) {
    const closeButton = panel.querySelector(
      '#visibility-button button, button[aria-label="Close transcript"]'
    );
    if (closeButton) closeButton.click();
    else panel.setAttribute("visibility", PANEL_HIDDEN);
  }

  const normalize = (text) => text.replace(/\s+/g, " ").trim();

  // Classic markup: <ytd-transcript-segment-renderer> with .segment-timestamp / .segment-text.
  function readSegmentsClassic(panel) {
    const segments = [];
    for (const node of panel.querySelectorAll(SEGMENT_SELECTOR)) {
      const time = normalize(node.querySelector(".segment-timestamp")?.textContent || "");
      const text = normalize(node.querySelector(".segment-text")?.textContent || "");
      if (text) segments.push({ time, text });
    }
    return segments;
  }

  // Markup-agnostic fallback: every visible "m:ss" / "h:mm:ss" text node in the
  // panel is a timestamp; the smallest ancestor that holds exactly one timestamp
  // is that segment's row, and the row's remaining text is the caption.
  function readSegmentsGeneric(panel) {
    const stamps = [];
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (TIMESTAMP_RE.test(node.textContent.trim())) stamps.push(node.parentElement);
    }

    const segments = [];
    const seenRows = new Set();
    stamps.forEach((stampEl, index) => {
      const prev = stamps[index - 1];
      const next = stamps[index + 1];
      let row = stampEl;
      while (
        row.parentElement &&
        row.parentElement !== panel &&
        !(prev && row.parentElement.contains(prev)) &&
        !(next && row.parentElement.contains(next))
      ) {
        row = row.parentElement;
      }
      if (seenRows.has(row)) return;
      seenRows.add(row);

      const time = normalize(stampEl.textContent);
      const rowText = normalize(row.innerText || row.textContent || "");
      const text = normalize(rowText.replace(time, ""));
      if (text) segments.push({ time, text });
    });
    return segments;
  }

  // Modern markup (YouTube's 2026 "PAmodern_transcript_view" panel):
  // <transcript-segment-view-model> rows with a timestamp span and an attributed string.
  function readSegmentsModern(panel) {
    const segments = [];
    const rows = panel.querySelectorAll(
      "transcript-segment-view-model, .ytwTranscriptSegmentViewModelHost"
    );
    for (const row of rows) {
      const time = normalize(
        row.querySelector(".ytwTranscriptSegmentViewModelTimestamp")?.textContent || ""
      );
      let text = normalize(
        row.querySelector('.ytAttributedStringHost[role="text"], yt-attributed-string')
          ?.textContent || ""
      );
      if (!text) text = normalize(normalize(row.textContent || "").replace(time, ""));
      if (text) segments.push({ time, text });
    }
    return segments;
  }

  function readSegments(panel) {
    return (
      [readSegmentsClassic, readSegmentsModern, readSegmentsGeneric]
        .map((reader) => reader(panel))
        .find((segments) => segments.length) || []
    );
  }

  function describePanel(panel) {
    const tags = new Set();
    panel.querySelectorAll("*").forEach((el) => tags.add(el.tagName.toLowerCase()));
    return [...tags].filter((t) => t.includes("-")).join(", ");
  }

  async function getTranscript() {
    const { panel, wasOpen } = await openTranscriptPanel();
    if (!panel) throw new Error("NO_TRANSCRIPT");

    const segments = await waitFor(
      () => {
        const found = readSegments(panel);
        return found.length ? found : null;
      },
      { timeout: 20000 }
    );

    if (!segments) {
      // Leave the panel open so the user can see what YouTube rendered, and
      // log its custom elements so the markup can be supported.
      console.warn(
        "YouTube Copy Transcript: no segments found in panel",
        panel.getAttribute("target-id"),
        "| elements:",
        describePanel(panel)
      );
      throw new Error("NO_TRANSCRIPT");
    }
    if (!wasOpen) closeTranscriptPanel(panel);
    return segments;
  }

  function formatTranscript(segments, withTimestamps) {
    return segments
      .map((segment) =>
        withTimestamps && segment.time ? `${segment.time} ${segment.text}` : segment.text
      )
      .join("\n");
  }

  // ---------- clipboard ----------

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      // Fall through to the legacy path (e.g. document not focused).
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    if (!ok) throw new Error("COPY_FAILED");
  }

  // ---------- button ----------

  let busy = false;
  let resetTimer = null;

  function setState(label, state) {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.querySelector("span").textContent = label;
    if (state) button.dataset.state = state;
    else delete button.dataset.state;
  }

  async function copyTranscript(withTimestamps) {
    if (busy) return;
    busy = true;
    clearTimeout(resetTimer);
    setState("Copying…", "busy");
    try {
      const segments = await getTranscript();
      await copyText(formatTranscript(segments, withTimestamps));
      setState(`Copied ${segments.length} lines`, "ok");
    } catch (error) {
      setState(error.message === "NO_TRANSCRIPT" ? "No transcript" : "Copy failed", "error");
      console.warn("YouTube Copy Transcript:", error);
    } finally {
      busy = false;
      resetTimer = setTimeout(() => setState(DEFAULT_LABEL, ""), 2500);
    }
  }

  function createButton() {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "yct-button";
    button.title = "Copy the full transcript to the clipboard (Shift-click to include timestamps)";
    button.innerHTML = `${ICON_SVG}<span>${DEFAULT_LABEL}</span>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyTranscript(event.shiftKey);
    });
    return button;
  }

  function ensureButton() {
    if (!isWatchPage()) return false;
    if (document.getElementById(BUTTON_ID)) return true;
    const container =
      document.querySelector("ytd-watch-metadata #top-level-buttons-computed") ||
      document.querySelector("ytd-watch-metadata #actions-inner") ||
      document.querySelector("ytd-watch-metadata #actions");
    if (!container) return false;
    container.appendChild(createButton());
    return true;
  }

  function scheduleEnsure() {
    let attempts = 0;
    const timer = setInterval(() => {
      if (ensureButton() || ++attempts > 40 || !isWatchPage()) clearInterval(timer);
    }, 250);
  }

  // YouTube is a single-page app: re-check after every in-app navigation,
  // plus a cheap periodic safety net in case the action bar is re-rendered.
  document.addEventListener("yt-navigate-finish", scheduleEnsure);
  setInterval(ensureButton, 2000);
  scheduleEnsure();

  // The toolbar icon (see background.js) triggers the same copy.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "copy-transcript") return;
    copyTranscript(Boolean(message.withTimestamps)).then(() => sendResponse({ ok: true }));
    return true;
  });
})();
