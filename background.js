// Clicking the toolbar icon copies the transcript of the active YouTube tab.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !tab.url.startsWith("https://www.youtube.com/watch")) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "copy-transcript" });
  } catch (error) {
    // The content script is not loaded in this tab (e.g. the page predates the install).
    console.warn("YouTube Copy Transcript: no content script in tab", tab.id, error);
  }
});
