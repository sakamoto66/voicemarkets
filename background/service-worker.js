// VoiceMarkets - MV3 service worker
//
// Opens the UI as a standalone popup window instead of a Chrome extension popup.
// Extension popups close when they lose focus, which interrupts Web Speech API
// when Chrome shows its microphone permission prompt.
// A standalone window persists through permission prompts.

const POPUP_URL = chrome.runtime.getURL('popup/popup.html');
const POPUP_WIDTH = 400;
const POPUP_HEIGHT = 520;

chrome.action.onClicked.addListener(async () => {
  // If a VoiceMarkets window is already open, focus it instead of opening another.
  const existing = await chrome.windows.getAll({ populate: true });
  for (const win of existing) {
    const hasPopup = win.tabs?.some(tab => tab.url === POPUP_URL);
    if (hasPopup) {
      await chrome.windows.update(win.id, { focused: true });
      return;
    }
  }

  await chrome.windows.create({
    url: POPUP_URL,
    type: 'popup',
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    focused: true,
  });
});
