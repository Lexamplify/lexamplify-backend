// Small, pure helpers for voice typing. No React and no network here, so they are easy to test.

export const LANGS = [
  { code: 'auto', label: 'Auto (English + Hindi mix)' },
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'ml', label: 'മലയാളം' },
  { code: 'mr', label: 'मराठी' },
  { code: 'bn', label: 'বাংলা' },
  { code: 'gu', label: 'ગુજરાતી' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ' },
  { code: 'ur', label: 'اردو' },
];

const LANG_KEY = 'lx:stt-lang';
const LANG_EVENT = 'lx:stt-lang';

export function getLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return LANGS.some((l) => l.code === v) ? v : 'auto';
  } catch { return 'auto'; }
}

export function setLang(code) {
  if (!LANGS.some((l) => l.code === code)) return;
  try { localStorage.setItem(LANG_KEY, code); } catch { /* private mode: keep going */ }
  try { window.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: code })); } catch { /* ignore */ }
}

export const LANG_EVENT_NAME = LANG_EVENT;

// Best recording format this browser can make. Chrome/Edge/Firefox: webm or ogg (opus). Safari: mp4.
export function pickMime() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  const wanted = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const t of wanted) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* next */ }
  }
  return '';
}

export function extFor(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mp4') || m.includes('aac') || m.includes('m4a')) return 'm4a';
  if (m.includes('wav')) return 'wav';
  return 'webm';
}

export function isSupported() {
  return typeof navigator !== 'undefined'
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function'
    && typeof MediaRecorder !== 'undefined'
    && (typeof window === 'undefined' || window.isSecureContext !== false);
}

// A plain sentence for every way the microphone can fail.
export function friendlyMicError(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Connect one and try again.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Your microphone is busy in another app. Close it there and try again.';
  return 'We could not start the microphone. Please try again.';
}

// ── spoken punctuation (English) ──────────────────────────────────────────────
// A lawyer dictating a draft says "full stop" and "new paragraph". Whisper writes those words out, so turn
// them back into punctuation. Only a short, unambiguous list: "period" and "colon" are real words in a case.
const COMMANDS = [
  [/[\s,.]*\bnew paragraph\b[.,]?\s*/gi, '\n\n'],
  [/[\s,.]*\bnew line\b[.,]?\s*/gi, '\n'],
  [/[\s,.]*\bfull stop\b[.,]?/gi, '.'],
  [/[\s,.]*\bquestion mark\b[.,]?/gi, '?'],
  [/[\s,.]*\bsemi-?colon\b[.,]?/gi, ';'],
  [/[\s,.]*\bcomma\b[.,]?/gi, ','],
  [/\bopen (?:bracket|parenthesis)\b[.,]?\s*/gi, '('],
  [/[\s,.]*\bclose (?:bracket|parenthesis)\b[.,]?/gi, ')'],
];

export function applySpokenCommands(text) {
  let out = String(text || '');
  for (const [re, rep] of COMMANDS) out = out.replace(re, rep);
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/[ \t]{2,}/g, ' ');
}

// ── placing text in front of what is already there ────────────────────────────

const endsSentence = (s) => /[.!?।]["')\]]?\s*$/.test(s) || /\n\s*$/.test(s);

// Join dictated text onto existing text: one space, a capital after a full stop, no space before punctuation.
export function joinDictation(before, text, after = '', { multiline = true } = {}) {
  let t = String(text || '').trim();
  if (!t) return '';
  if (!multiline) t = t.replace(/\s*\n+\s*/g, ' ');
  const prev = String(before || '');
  if (!prev.trim() || endsSentence(prev)) t = t.charAt(0).toUpperCase() + t.slice(1);
  const needsLead = prev && !/\s$/.test(prev) && !/^[.,;:?!)\]।]/.test(t) && !/^\n/.test(t);
  const next = String(after || '');
  const needsTail = next && !/^\s/.test(next) && !/[\n(]$/.test(t) && !/^[.,;:?!)\]।]/.test(next);
  return (needsLead ? ' ' : '') + t + (needsTail ? ' ' : '');
}

// Put text into a real <input>/<textarea> at the caret and make React notice. React controlled inputs ignore a plain
// `el.value = ...`; going through the native setter and firing an `input` event is the supported way.
export function insertIntoField(el, text, { spoken } = {}) {
  if (!el) return false;
  const multiline = el.tagName === 'TEXTAREA';
  const useCommands = spoken === undefined ? multiline : spoken;
  const value = String(el.value || '');
  let start = value.length;
  let end = value.length;
  try {
    if (typeof el.selectionStart === 'number') { start = el.selectionStart; end = el.selectionEnd; }
  } catch { /* type=email etc. have no selection: append */ }
  // A field the user never clicked into reports caret 0: dictate at the end instead of in front of what is there.
  if (document.activeElement !== el && start === 0 && end === 0 && value) { start = value.length; end = value.length; }
  const before = value.slice(0, start);
  const after = value.slice(end);
  const piece = joinDictation(before, useCommands ? applySpokenCommands(text) : text, after, { multiline });
  if (!piece) return false;
  const proto = multiline ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const next = before + piece + after;
  if (setter) setter.call(el, next); else el.value = next;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const caret = before.length + piece.length;
  try { el.focus({ preventScroll: false }); el.setSelectionRange(caret, caret); } catch { /* ignore */ }
  return true;
}

// ── Start page: which document does "Draft a legal notice for …" mean? ────────
// Order matters: the cheque rule must come before the general notice rule.
const DOC_RULES = [
  [/cheque|\b138\b|dishonou?r|bounced?/i, /cheque|138/i],
  [/reply\b.*\bnotice|notice\b.*\breply|\breply to\b/i, /reply/i],
  [/\bbail\b/i, /bail/i],
  [/affidavit/i, /affidavit/i],
  [/\bnda\b|non[- ]?disclosure|confidentiality agreement/i, /\bnda\b|disclosure/i],
  [/plaint|\bsuit\b/i, /plaint/i],
  [/\brent|lease|tenan/i, /rent|lease/i],
  [/sale deed|\bsale\b/i, /sale/i],
  [/vakalat|power of attorney/i, /vakalat/i],
  [/amend/i, /amend/i],
  [/notice/i, /legal notice|notice \(general\)|general/i],
];

export function matchDocType(prompt, types) {
  const p = String(prompt || '');
  if (!p.trim() || !Array.isArray(types)) return null;
  for (const [ask, target] of DOC_RULES) {
    if (!ask.test(p)) continue;
    const hit = types.find((t) => target.test(`${t.short || ''} ${t.id || ''}`));
    if (hit) return hit.id;
  }
  return null;
}
