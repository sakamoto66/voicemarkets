/**
 * voice.js — Web Speech API abstraction for VoiceMarkets popup.
 *
 * createVoice() returns a { start, stop } control interface.
 * All event handling is injected via callbacks so this module
 * has no direct dependency on DOM elements or application state.
 */

export const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

/**
 * Create a speech recognition session.
 * Returns { start, stop }, or null if the API is unsupported.
 *
 * The `errorOccurred` flag is managed internally so that `onEnd`
 * is suppressed when the session ends after an `onerror` event.
 *
 * @param {{
 *   onStart:  () => void,
 *   onResult: (event: SpeechRecognitionEvent) => void,
 *   onError:  (event: SpeechRecognitionErrorEvent) => void,
 *   onEnd:    () => void,
 * }} callbacks
 * @returns {{ start: () => void, stop: () => void } | null}
 */
export function createVoice({ onStart, onResult, onError, onEnd }) {
  if (!SpeechRecognition) return null;

  const r = new SpeechRecognition();
  r.lang            = 'ja-JP';
  r.interimResults  = true;
  r.maxAlternatives = 3;
  r.continuous      = false;

  let errorOccurred = false;

  r.onstart = () => {
    errorOccurred = false;
    onStart();
  };

  r.onresult = onResult;

  r.onerror = (event) => {
    errorOccurred = true;
    onError(event);
  };

  // onend always fires after onerror; skip it in that case.
  // Also skip when the caller already stopped via stop() — the caller
  // checks its own isListening flag inside the onEnd callback.
  r.onend = () => {
    if (!errorOccurred) onEnd();
  };

  return {
    start: () => r.start(),
    stop:  () => { try { r.stop(); } catch (_) {} },
  };
}
