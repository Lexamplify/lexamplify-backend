import { useRef, useState, useEffect, useCallback } from 'react';

// ── Phonetic patterns for "Hey InzIQ" ────────────────────────────────────────
// Covers: "hey inziq", "hey inzik", "hey insiq", "hey insik",
//         "hey nz iq", "hey in z i q", "hey inz", "a inziq" (misheard 'hey')
const WAKE_PATTERNS = [
  /\bhey\s+in[sz]i[qk]\b/i,
  /\bhey\s+n[sz]\s*i\s*[qk]\b/i,
  /\bhey\s+in\s*[sz]\s*i\s*[qk]\b/i,
  /\bhey\s+inz\b/i,
  /\ba\s+inz[iy]?\b/i,
  /\bhey\s+ins\b/i,
];

const matchWake = (t) => WAKE_PATTERNS.some(re => re.test(t));

const stripWakeWord = (t) =>
  (t.match(
    /(?:hey\s+(?:in[sz]i[qk]|n[sz]\s*i\s*[qk]|in\s*[sz]\s*i\s*[qk]|inz\w*|ins\w*)|a\s+inz\w*)\s*(.*)/i
  ) || [])[1]?.trim() || '';

// ── State enum ────────────────────────────────────────────────────────────────
export const WS = {
  IDLE:      'idle',       // mic off
  PASSIVE:   'passive',    // continuous scanning for wake word
  TRIGGERED: 'triggered',  // wake word matched — flash moment
  DICTATING: 'dictating',  // capturing command after wake word
};

export function useWakeWord() {
  const [wakeState, setWakeState] = useState(WS.IDLE);

  // All mutable flags live in refs to avoid stale closure issues inside rec callbacks
  const stateRef     = useRef(WS.IDLE);
  const recRef       = useRef(null);
  const shouldRunRef = useRef(false);
  const timerRef     = useRef(null);
  const cbRef        = useRef(null);  // onWakeWord(text, isFinal) callback

  const setS = useCallback((s) => { stateRef.current = s; setWakeState(s); }, []);

  // Build ONE SpeechRecognition instance for the entire hook lifetime
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.continuous     = true;
    rec.interimResults = true;
    rec.lang           = 'en-IN';  // Indian English for legal dictation

    rec.onresult = (ev) => {
      let final = '', interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) final   += t;
        else                       interim += t;
      }
      const txt = (final || interim).trim();

      if (stateRef.current === WS.PASSIVE && matchWake(txt)) {
        // ── Wake word detected ───────────────────────────────────────────────
        const after = stripWakeWord(txt);
        setS(WS.TRIGGERED);
        shouldRunRef.current = false;
        try { rec.stop(); } catch (_) {}

        setTimeout(() => {
          // Dispatch open event — if text already captured in same breath, pass it
          cbRef.current?.(after, !!final && !!after);

          if (!after) {
            // No command yet — enter dictation mode
            setS(WS.DICTATING);
            shouldRunRef.current = true;
            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
              if (shouldRunRef.current) try { rec.start(); } catch (_) {}
            }, 200);
          } else {
            // Command came in the same breath — return to passive scanning
            setS(WS.PASSIVE);
            shouldRunRef.current = true;
            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
              if (shouldRunRef.current) try { rec.start(); } catch (_) {}
            }, 150);
          }
        }, 340);  // 340ms for the triggered flash animation to play

      } else if (stateRef.current === WS.DICTATING) {
        // ── Real-time dictation updates ──────────────────────────────────────
        window.dispatchEvent(new CustomEvent('inziq-dictate', { detail: { text: txt } }));
        if (final) {
          cbRef.current?.(final.trim(), true);
          setS(WS.PASSIVE);
          shouldRunRef.current = true;
        }
      }
    };

    rec.onerror = (ev) => {
      if (ev.error === 'not-allowed') {
        shouldRunRef.current = false;
        setS(WS.IDLE);
        window.dispatchEvent(new CustomEvent('inziq-error', {
          detail: { msg: 'Microphone access denied. Enable mic permission in browser settings to use Hey InzIQ.' }
        }));
        return;
      }
      // 'aborted' = intentional stop — ignore.
      // 'no-speech', 'network', 'audio-capture' — let onend restart.
    };

    // Self-healing: Chrome kills recognition after silence — restart automatically
    rec.onend = () => {
      if (!shouldRunRef.current || stateRef.current === WS.TRIGGERED) return;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (!shouldRunRef.current) return;
        try { rec.start(); } catch (_) {}
      }, 100);  // 100ms debounce prevents InvalidStateError on rapid start/stop
    };

    recRef.current = rec;
    return () => {
      shouldRunRef.current = false;
      clearTimeout(timerRef.current);
      try { rec.abort(); } catch (_) {}
    };
  }, [setS]);  // intentionally empty deps — single instance for hook lifetime

  const startListening = useCallback((onWakeWord) => {
    if (!recRef.current) return;
    cbRef.current = onWakeWord;
    shouldRunRef.current = true;
    stateRef.current = WS.PASSIVE;
    setWakeState(WS.PASSIVE);
    try { recRef.current.start(); } catch (_) {}
  }, []);

  const stopListening = useCallback(() => {
    shouldRunRef.current = false;
    clearTimeout(timerRef.current);
    stateRef.current = WS.IDLE;
    setWakeState(WS.IDLE);
    try { recRef.current?.abort(); } catch (_) {}
  }, []);

  const isSupported = !!(
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)
  );

  return { wakeState, isSupported, startListening, stopListening };
}
