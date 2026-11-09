/*
 * "What is my day" — Phase 2: the Today briefing. Local detection + read-only data, plain code only.
 *
 * This module calls nothing by itself and holds no state. It does two things:
 *   1. detectTodayBriefing(text): does this sentence ask for the day's briefing? (browser only — the words are NEVER
 *      sent to the router model; the only thing that leaves the browser is the fixed-label ping below.)
 *   2. loadCases / loadDraftCount / summarizeCases: read the SAME endpoints the Start page (pages/Today.jsx) reads and
 *      apply the SAME filters, so the briefing's numbers match /start exactly. No model ever sees this data.
 *
 * The AI model must never see client data, matter names or hearing details. It doesn't: the briefing is read here, in
 * the browser, by the patched global fetch (utils/authFetch.js adds the auth cookie + X-Workspace-Id), and only a fixed
 * label ("today_briefing_opened") is ever POSTed to the assistant.
 */

// ── the fixed-label ping (mirrors create_matter's) ────────────────────────────────────────────────────────────────────
// The browser POSTs ONLY this fixed label, never the lawyer's words. The server checks the flag and stores the label.
export const PING_ENDPOINT = '/api/assistant/command';
export const BRIEFING_FLOW = 'today_briefing';
export const BRIEFING_EVENT = 'opened';
export const BRIEFING_LABEL = 'today_briefing_opened';     // the fixed label stored in history (whitelisted on the server)

// ── the read-only data endpoints (identical to pages/Today.jsx:80-82) ─────────────────────────────────────────────────
export const CASES_ENDPOINT = '/api/practice/cases?per_page=100&sort=next_hearing';
export const DRAFTS_ENDPOINT = '/api/drafts/sessions';
export const BRIEFING_TIMEOUT_MS = 10000;                  // each section gives up after ~10s, then says "Couldn't load"

// ── the trigger phrases ───────────────────────────────────────────────────────────────────────────────────────────────
// A FIXED list on purpose (not read at runtime from features.json), so the briefing's triggers can never widen silently
// when the registry changes. START_ALIAS_TRIGGERS are the subset that are ALSO start aliases today; a test asserts they
// are still present in features.json, so a removed alias is caught. EXTRA_TRIGGERS are added briefing phrases (all
// multi-word; English only — the Indic triggers come from the aliases above and still work).
// Stored already-normalised (straight apostrophe, lower case) so matching is a plain equality after normalise().
export const START_ALIAS_TRIGGERS = [
  'today', 'my day', 'what is on today',   // en
  'aaj', 'आज',                             // hi
  'indru', 'இன்று',                        // ta
];
export const EXTRA_TRIGGERS = [
  'my day today', 'what is my day', "what's my day", 'how is my day',
  'what do i have today', 'brief me on my day',
];
const TRIGGERS = new Set([...START_ALIAS_TRIGGERS, ...EXTRA_TRIGGERS].map((p) => p.toLowerCase()));

// Leading/trailing punctuation a keyboard or dictation adds: . , ! ? ; : and the Hindi danda / double danda.
// (Mirrors utils/feature_registry._EDGE_PUNCTUATION.)
const EDGE_PUNCTUATION = '.,!?;:।॥';
const FILLER_WORDS = new Set(['please', 'the', 'my']);
// The only words that turn a bare phrase into "open it" — same short list obvious_match uses, longest first.
const LEADING_VERBS = ['take me to', 'switch to', 'go to', 'open', 'show', 'view', 'kholo', 'dikhao'];
const TRAILING_VERBS = ['kholo', 'dikhao'];

/** NFC, straight apostrophe, lower case, single-spaced, leading/trailing edge punctuation removed. Internal text untouched. */
export function normalize(text) {
  let s = String(text ?? '').normalize('NFC');
  s = s.replace(/[‘’ʼ]/g, "'");          // curly / modifier apostrophes → straight '
  s = s.toLowerCase();
  s = s.replace(/\s+/g, ' ').trim();
  // strip leading then trailing edge punctuation (and any spaces they leave)
  while (s && (EDGE_PUNCTUATION.includes(s[0]) || s[0] === ' ')) s = s.slice(1);
  while (s && (EDGE_PUNCTUATION.includes(s[s.length - 1]) || s[s.length - 1] === ' ')) s = s.slice(0, -1);
  return s;
}

function stripOneVerb(cleaned) {
  for (const v of LEADING_VERBS) {
    if (cleaned === v) return '';
    if (cleaned.startsWith(v + ' ')) return cleaned.slice(v.length + 1).trim();
  }
  for (const v of TRAILING_VERBS) {
    if (cleaned.endsWith(' ' + v)) return cleaned.slice(0, -(v.length + 1)).trim();
  }
  return cleaned;
}

/**
 * Does this WHOLE sentence ask for the day's briefing? Whole-text only (like obvious_match), so "today's hearing in
 * Sharma case" or "draft a notice today" never match. The cleaned text is tried as-is, with the filler words
 * (please/the/my) removed, and with one leading/trailing verb stripped — so "open today" and "show my day" also match.
 */
export function detectTodayBriefing(text) {
  const cleaned = normalize(text);
  if (!cleaned) return { matched: false };
  const withoutFillers = cleaned.split(' ').filter((w) => !FILLER_WORDS.has(w)).join(' ');
  const variants = new Set();
  for (const base of [cleaned, withoutFillers]) {
    if (!base) continue;
    variants.add(base);
    const stripped = stripOneVerb(base);
    if (stripped) variants.add(stripped);
  }
  for (const v of variants) {
    if (TRIGGERS.has(v)) return { matched: true };
  }
  return { matched: false };
}

// ── the numbers, read the same way pages/Today.jsx reads them ─────────────────────────────────────────────────────────
// daysUntil is an exact copy of pages/Today.jsx:20-25 (browser-local midnight, i.e. IST for users; hearing dates are
// date-only). Kept identical ON PURPOSE so the briefing and /start can never drift; a parity test renders the real
// Today.jsx and compares.
export function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}

/** The three case-derived numbers, from the SAME filters as pages/Today.jsx:102-113. */
export function summarizeCases(cases) {
  const open = (Array.isArray(cases) ? cases : []).filter((c) => !c.closed);
  const withHearing = open.filter((c) => c.next_hearing && daysUntil(c.next_hearing) != null && daysUntil(c.next_hearing) >= 0);
  return {
    openMatters: open.length,
    hearingsToday: withHearing.filter((c) => daysUntil(c.next_hearing) === 0).length,
    hearingsThisWeek: withHearing.filter((c) => daysUntil(c.next_hearing) <= 7).length,
  };
}

/** Draft count the SAME way pages/Today.jsx:86-88 counts it: ALL sessions (sessions|items|array).length. */
export function countDrafts(data) {
  const list = data?.sessions || data?.items || (Array.isArray(data) ? data : []);
  return Array.isArray(list) ? list.length : 0;
}

// Each loader throws on a non-OK response or a network/timeout error, so the card shows "Couldn't load" for that
// section and NEVER a 0. Both go through the patched global fetch (auth cookie + X-Workspace-Id added for us).
export async function loadCases(signal) {
  const res = await fetch(CASES_ENDPOINT, { method: 'GET', signal });
  if (!res.ok) throw new Error(`cases ${res.status}`);
  const data = await res.json();
  return summarizeCases(Array.isArray(data?.cases) ? data.cases : []);
}

export async function loadDraftCount(signal) {
  const res = await fetch(DRAFTS_ENDPOINT, { method: 'GET', signal });
  if (!res.ok) throw new Error(`drafts ${res.status}`);
  return countDrafts(await res.json());
}
