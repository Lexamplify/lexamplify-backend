import { useEffect, useRef, useState, useCallback } from 'react';
import useDictation from '../hooks/useDictation.js';
import { getLang, insertIntoField, LANG_EVENT_NAME, LANGS, setLang } from '../utils/dictation.js';
import '../styles/dictation.css';

const NOTICE_KEY = 'lx:stt-notice-seen';

function MicIcon({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
    </svg>
  );
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// The language the user picked, shared by every microphone on the page.
export function useSttLang() {
  const [lang, setLangState] = useState(getLang);
  useEffect(() => {
    const on = (e) => setLangState(e.detail || getLang());
    window.addEventListener(LANG_EVENT_NAME, on);
    return () => window.removeEventListener(LANG_EVENT_NAME, on);
  }, []);
  return [lang, (code) => { setLang(code); setLangState(code); }];
}

export function LangPicker({ className = '', disabled = false }) {
  const [lang, change] = useSttLang();
  return (
    <select className={`mic-lang ${className}`} value={lang} onChange={(e) => change(e.target.value)} disabled={disabled} aria-label="Voice typing language" title="Voice typing language">
      {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
    </select>
  );
}

/**
 * A microphone button. Click to start, click again to finish; Esc throws the recording away.
 *
 * Where the words go (pick one):
 *   getTarget()        returns an <input>/<textarea>; text is inserted at the caret
 *   scope + selector   the nearest ancestor matching `scope` (e.g. "form"), first field inside it
 *   onText(text)       you place the text yourself (e.g. into the document editor)
 *
 * variant "icon" is a round button (default); "pill" shows a label.
 */
export default function MicButton({
  getTarget, scope, selector = 'textarea, input:not([type=checkbox]):not([type=radio]):not([type=date]):not([type=time]):not([type=file]):not([type=hidden])',
  onText, kind = 'legal', spokenCommands, variant = 'icon', label = 'Dictate', title,
  disabled = false, className = '', size = 17, afterInsert, onStateChange, maxSeconds, hotkey = false,
}) {
  const btnRef = useRef(null);
  const [lang] = useSttLang();
  const [showNotice, setShowNotice] = useState(false);

  const deliver = useCallback((text) => {
    let el = getTarget ? getTarget() : null;
    if (!el && scope && btnRef.current) el = btnRef.current.closest(scope)?.querySelector(selector) || null;
    if (el) {
      insertIntoField(el, text, { spoken: spokenCommands });
      afterInsert?.(el, text);
    } else {
      onText?.(text);
    }
  }, [getTarget, scope, selector, onText, spokenCommands, afterInsert]);

  const d = useDictation({ onResult: deliver, kind, lang, maxSeconds });
  const { state, error, notice, level, seconds, start, stop, cancel, supported } = d;

  // The field this mic writes into (same resolution as deliver): a <textarea>/<input> given by getTarget, or the
  // first field inside the `scope` ancestor.
  const resolveTarget = () => {
    let el = getTarget ? getTarget() : null;
    if (!el && scope && btnRef.current) el = btnRef.current.closest(scope)?.querySelector(selector) || null;
    return el;
  };

  // Report "idle" | "recording" | "transcribing" up, only on a real change. The callback is held in a ref so a
  // parent that passes a fresh function each render never re-fires this.
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onStateChangeRef.current = onStateChange; });
  const reportedState = state === 'transcribing' ? 'transcribing' : state === 'idle' ? 'idle' : 'recording';
  const lastReportedRef = useRef('idle');
  useEffect(() => {
    if (lastReportedRef.current === reportedState) return;
    lastReportedRef.current = reportedState;
    onStateChangeRef.current?.(reportedState);
  }, [reportedState]);

  // Optional Ctrl+/ (Cmd+/ on Mac) to toggle, but ONLY while the paired field is focused. Added where `hotkey` is set
  // (the assistant composer); every other mic is unchanged.
  useEffect(() => {
    if (!hotkey || !supported) return undefined;
    const onKey = (e) => {
      if (e.key !== '/' || e.altKey || e.shiftKey || !(e.ctrlKey || e.metaKey)) return;
      if (e.isComposing || e.repeat) return;
      const el = resolveTarget();
      if (!el || document.activeElement !== el) return;
      e.preventDefault();
      if (state === 'recording') stop();
      else if (state === 'idle' && !disabled && !targetDisabled()) start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkey, supported, state, disabled, start, stop]);

  const targetDisabled = () => {
    let el = getTarget ? getTarget() : null;
    if (!el && scope && btnRef.current) el = btnRef.current.closest(scope)?.querySelector(selector) || null;
    return !!(el && (el.disabled || el.readOnly));
  };

  // First use: tell the user, once, where the audio goes.
  useEffect(() => {
    if (state !== 'recording') return;
    try {
      if (localStorage.getItem(NOTICE_KEY) !== '1') {
        localStorage.setItem(NOTICE_KEY, '1');
        setShowNotice(true);
        setTimeout(() => setShowNotice(false), 7000);
      }
    } catch { /* private mode: skip the notice */ }
  }, [state]);

  if (!supported) {
    // Unsupported browser: keep the layout calm, say why on hover/click.
    return (
      <button type="button" ref={btnRef} className={`mic mic--off ${className}`} disabled aria-label="Voice typing is not available in this browser"
        title="Voice typing needs a current Chrome, Edge or Safari on a secure (https) connection.">
        <MicIcon size={size} />
      </button>
    );
  }

  const busy = state === 'starting' || state === 'transcribing';
  const recording = state === 'recording';
  const onClick = () => {
    if (recording) stop();
    else if (state === 'idle' && !disabled && !targetDisabled()) start();
  };
  const tip = title || (recording ? 'Click to finish · Esc to cancel' : hotkey ? 'Speak (Ctrl+/)' : 'Dictate — click, speak, click again');
  const stateText = recording ? `Recording ${fmt(seconds)}` : state === 'transcribing' ? 'Writing it out' : state === 'starting' ? 'Starting the microphone' : '';

  return (
    <span className={`mic-wrap mic-wrap--${variant} ${className}`}>
      <button
        type="button"
        ref={btnRef}
        className={`mic mic--${variant} ${recording ? 'is-rec' : ''} ${busy ? 'is-busy' : ''} ${error ? 'has-err' : ''}`}
        onClick={onClick}
        disabled={disabled || state === 'starting' || state === 'transcribing'}
        aria-label={recording ? 'Stop dictation' : state === 'transcribing' ? 'Writing out your dictation' : 'Start dictation'}
        aria-pressed={recording}
        aria-keyshortcuts={hotkey ? 'Control+/ Meta+/' : undefined}
        title={tip}
      >
        {recording ? (
          <>
            <span className="mic__bars" aria-hidden="true">
              {[0.35, 0.7, 1, 0.7, 0.35].map((w, i) => (
                <i key={i} style={{ transform: `scaleY(${Math.max(0.18, Math.min(1, level * w * 1.6))})` }} />
              ))}
            </span>
            <span className="mic__time" style={seconds >= 225 ? { color: 'var(--risk, #b3412c)' } : undefined}>{fmt(seconds)}</span>
            <span className="mic__stop" aria-hidden="true" />
          </>
        ) : state === 'transcribing' || state === 'starting' ? (
          <>
            <span className="mic__spin" aria-hidden="true" />
            {variant === 'pill' && <span className="mic__label">{state === 'starting' ? 'Starting…' : 'Writing…'}</span>}
          </>
        ) : (
          <>
            <MicIcon size={size} />
            {variant === 'pill' && <span className="mic__label">{label}</span>}
          </>
        )}
      </button>
      {recording && (
        <button type="button" className="mic mic--cancel" onClick={cancel} aria-label="Cancel dictation" title="Cancel (Esc)">×</button>
      )}
      <span className="mic__sr" role="status" aria-live="polite">{stateText}</span>
      {(error || notice || showNotice) && (
        <span className={`mic__msg ${error ? 'mic__msg--err' : ''}`} role={error ? 'alert' : 'status'}>
          {error || notice || 'Your voice is sent to our speech-to-text provider to be typed out. LexAmplify does not save the recording.'}
        </span>
      )}
    </span>
  );
}
