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
  const PANEL_SELECTOR =
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
  const SEGMENT_SELECTOR = "ytd-transcript-segment-renderer";
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

  const getPanel = () => document.querySelector(PANEL_SELECTOR);
  const isPanelOpen = (panel) =>
    Boolean(panel) && panel.getAttribute("visibility") === PANEL_OPEN;

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
    let panel = getPanel();
    if (isPanelOpen(panel)) return { panel, wasOpen: true };

    // The description (and its "Show transcript" button) renders a bit after
    // the action bar, so give it a moment instead of failing on a fast click.
    const button = await waitFor(findShowTranscriptButton, { timeout: 8000 });
    if (!button) return { panel: null, wasOpen: false };
    button.click();

    panel = await waitFor(
      () => {
        const candidate = getPanel();
        return isPanelOpen(candidate) ? candidate : null;
      },
      { timeout: 5000 }
    );
    return { panel, wasOpen: false };
  }

  function closeTranscriptPanel(panel) {
    const closeButton = panel.querySelector(
      '#visibility-button button, button[aria-label="Close transcript"]'
    );
    if (closeButton) closeButton.click();
    else panel.setAttribute("visibility", PANEL_HIDDEN);
  }

  function readSegments(panel) {
    const segments = [];
    for (const node of panel.querySelectorAll(SEGMENT_SELECTOR)) {
      const time = (node.querySelector(".segment-timestamp")?.textContent || "").trim();
      const text = (node.querySelector(".segment-text")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      if (text) segments.push({ time, text });
    }
    return segments;
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

    if (!wasOpen) closeTranscriptPanel(panel);
    if (!segments) throw new Error("NO_TRANSCRIPT");
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
