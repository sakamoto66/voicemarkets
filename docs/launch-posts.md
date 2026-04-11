# Launch Post Drafts

## Hacker News

**Title:**
Show HN: VoiceMarkets – search your bookmarks and browser history by voice (Chrome extension)

**Body:**

I built a Chrome extension that lets you navigate your existing bookmarks and history by voice — no search engine query, no external API, no sign-up.

**The problem:** I have 3,000+ bookmarks and still can't get back to the right page fast. Ctrl+F in the bookmarks manager is painful. Typing URLs from memory is worse.

**How it works:**

1. Click the extension icon, press the mic button
2. Say what you're looking for — a topic, a place, a keyword
3. Click a result to jump to the page

Two-stage search:
- Stage 1: keyword frequency + recency scoring (always runs, pure JS, instant)
- Stage 2: Gemini Nano semantic re-ranking (runs on-device inside Chrome when available)

**Privacy:** Your bookmarks and history never leave the browser. Voice transcription uses the Web Speech API (same path as Chrome's built-in speech input, routes through Google's servers). Gemini Nano ranking runs fully on-device.

**What's interesting technically:**
- `chrome.history.search()` is completely broken for Japanese text — you have to fetch with `text: ''` and filter client-side
- Gemini Nano output is not guaranteed JSON — you always need a try/catch + strip markdown code fences before parsing, with a silent fallback to Stage 1
- Web Speech API gets interrupted when the popup loses focus — `window.onblur` cleanup is required

GitHub: https://github.com/sakamoto66/voicemarkets

Would love to hear from anyone who's tried on-device AI in extensions. Still figuring out how broadly Gemini Nano is available across Chrome versions/hardware.

---

## Reddit — r/chrome / r/sideprojects

**Title:**
I made a Chrome extension that searches your bookmarks and history by voice — on-device AI, no external API

**Body:**

Hey, I built VoiceMarkets — a Chrome extension that lets you search your own bookmarks and browser history by voice.

**Why:** I had 3,000+ bookmarks and was spending way too long trying to find pages I'd already visited. I wanted something faster than the bookmarks manager but more personal than a web search.

**How to use it:**
1. Install (developer mode for now, Chrome Web Store submission in progress)
2. Click the extension icon
3. Press the mic button and describe what you're looking for
4. Click a result

**Tech:**
- Web Speech API for voice input (ja-JP / en-US)
- Stage 1: keyword scoring + recency weighting
- Stage 2: Gemini Nano for semantic re-ranking (Chrome's on-device AI, no API key needed)
- Falls back to keyword-only if Gemini Nano isn't available

**Privacy:** Bookmarks and history stay in the browser. No external service for search or ranking. Only voice transcription touches Google's servers (that's the Web Speech API — same as Chrome's built-in speech input).

GitHub: https://github.com/sakamoto66/voicemarkets

Currently works best in Chrome 127+ (for Gemini Nano). Happy to answer questions about the Gemini Nano integration — it's a bit finicky to set up but works well once running.

---

## Reddit — r/productivity

**Title:**
Stop scrolling through hundreds of bookmarks — use your voice to find pages instantly

**Body:**

If you've got a bookmarks folder that's become a graveyard of links you never revisit, this might help.

VoiceMarkets is a Chrome extension I built that searches your bookmarks and browser history by voice. You press a button, say what you're looking for, and it surfaces the most relevant pages from your own data — not from Google.

Works offline for the ranking step (Gemini Nano runs on-device). Voice transcription goes through Chrome's Web Speech API.

Free, open source: https://github.com/sakamoto66/voicemarkets

Install instructions in the README (requires Chrome developer mode, about 30 seconds).
