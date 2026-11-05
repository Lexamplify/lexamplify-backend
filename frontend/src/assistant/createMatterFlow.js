/*
 * "Create a matter" — Phase 1a: local detection, party parsing, slot list, and input normalisation.
 *
 * Plain code only. This module calls nothing and sends nothing. The name-bearing sentence a lawyer speaks or types
 * ("create a matter for Sharma vs Rao") is parsed HERE, in the browser, and the raw sentence never leaves it: only the
 * derived slot values the lawyer then sees and confirms are kept. No model is ever involved in this file.
 *
 * In this commit (1a) the flow stops at a summary step. There is no conflict check and no create call yet.
 */

// Mirrors utils/assistant_router.looks_like_create_matter (the server guard). Narrow on purpose: a creating verb
// directly before a SINGULAR matter/case/brief. The word boundary fails on the plural, so navigation and reads —
// "open matters", "show my cases", "find the Sharma matter", "add a hearing" — never match.
const CREATE_EN = /\b(?:create|make|start|register|set\s*up|open|add|new)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:matter|case|brief)\b/i;
// TODO: the Hinglish/Hindi/Tamil cues are not yet reviewed by a native speaker; review and refine them.
const CREATE_CUES = [
  'naya mukadma', 'naya kes', 'naya mamla', 'naya case',
  'mukadma banao', 'kes banao', 'mamla banao', 'case banao', 'mukadma banana', 'mukadma darj',
  'नया मुकदमा', 'नया मामला', 'नया केस', 'मुकदमा बनाओ', 'मामला बनाओ', 'मुकदमा दर्ज',
  'புதிய வழக்கு', 'வழக்கு உருவாக்கு', 'வழக்கு சேர்',
];

/**
 * Does this sentence read like a request to CREATE a matter? If so, return the remainder (the words after the trigger,
 * e.g. "Sharma vs Rao") so the caller can pre-fill the title locally. The remainder is a derived value, not the sentence.
 */
export function detectCreateMatter(text) {
  const s = String(text ?? '').trim();
  if (!s) return { matched: false, remainder: '' };
  const m = s.match(CREATE_EN);
  if (m) {
    const after = s.slice(m.index + m[0].length).trim();
    const remainder = after.replace(/^(?:for|regarding|about|re|titled|called|:|-)\s+/i, '').trim();
    return { matched: true, remainder };
  }
  const low = s.toLowerCase();
  if (CREATE_CUES.some((c) => low.includes(c))) return { matched: true, remainder: '' };
  return { matched: false, remainder: '' };
}

/** Split "Sharma vs Rao" into a title plus the two parties, by plain code (no model). */
export function parseParties(remainder) {
  const r = String(remainder ?? '').trim();
  if (!r) return { title: '', client: '', opposite_party: '' };
  const parts = r.split(/\s+(?:vs\.?|v\.?|versus|बनाम|எதிர்)\s+/i);
  if (parts.length >= 2) {
    return { title: r, client: parts[0].trim(), opposite_party: parts.slice(1).join(' / ').trim() };
  }
  return { title: r, client: '', opposite_party: '' };
}

// Minimum validation replicated from routes/lpms_cases.py:55-80 (parse_case) and utils/lpms_store.py (CASE_TYPES).
// That backend file is NOT ours, so we do not edit it and the server stays the source of truth; these are only for
// instant in-browser feedback. DRIFT RISK: there is no shared export today, so if those limits or the enum change on
// the backend, this list must be updated by hand.
export const LIMITS = { title: 200, court: 160, case_no: 80, client: 160, opposite_party: 200 };
export const CASE_TYPES = ['Civil', 'Criminal', 'MCOP', 'RTI', 'Family', 'Corporate', 'Consumer', 'Other'];

// The question order (plan §5). case_no is marked required because the create endpoint requires it
// (routes/lpms_cases.py:55-56) — see the report's QUESTION FOR SAURABH about matters that are not yet filed.
export const SLOTS = [
  { key: 'title', label: 'Case title', required: true, prompt: "I'll set up a new matter. What's the case title?" },
  { key: 'court', label: 'Court', required: true, prompt: 'Which court is it in?' },
  { key: 'case_no', label: 'Case number', required: true, prompt: 'What is the case number?' },
  { key: 'case_type', label: 'Case type', required: false, choices: CASE_TYPES, prompt: 'What type of matter is it?' },
  { key: 'client', label: 'Client', required: false, prompt: 'Who are we acting for?' },
  { key: 'opposite_party', label: 'Opposite party', required: false, prompt: 'Who is on the other side? (optional)' },
];
// Hindi/Tamil prompt texts: needs native review before those locales ship.

export function getSlot(key) {
  return SLOTS.find((s) => s.key === key) || null;
}

// Devanagari (U+0966..096F) and Tamil (U+0BE6..0BEF) digits → ASCII.
const INDIC_DIGITS = /[०-९௦-௯]/g;
function indicDigitToAscii(ch) {
  const code = ch.codePointAt(0);
  if (code >= 0x0966 && code <= 0x096F) return String(code - 0x0966);
  if (code >= 0x0BE6 && code <= 0x0BEF) return String(code - 0x0BE6);
  return ch;
}
export function normalizeDigits(text) {
  return String(text ?? '').replace(INDIC_DIGITS, indicDigitToAscii);
}

// Light spoken-number help for case numbers: "forty five" → "45", "twenty" → "20" (0–99). Deliberately small; anything
// it does not recognise is left exactly as spoken.
const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
export function normalizeSpokenNumber(text) {
  return String(text ?? '').replace(/\b([a-z]+)(?:[\s-]+([a-z]+))?\b/gi, (whole, a, b) => {
    const al = a.toLowerCase();
    const bl = (b || '').toLowerCase();
    if (al in TENS && bl in ONES && ONES[bl] < 10 && ONES[bl] > 0) return String(TENS[al] + ONES[bl]);
    if (al in TENS && !b) return String(TENS[al]);
    if (al in ONES && !b) return String(ONES[al]);
    return whole;
  });
}

/** Normalise one answer by slot: Indic digits always; spoken numbers for the case number. Trimmed. Never guesses dates. */
export function normalizeAnswer(key, raw) {
  let v = normalizeDigits(String(raw ?? '')).trim();
  if (key === 'case_no') v = normalizeSpokenNumber(v).replace(/\s{2,}/g, ' ').trim();
  return v;
}

/** '' when valid, else a short message. Mirrors the backend's length/enum checks only. */
export function validateSlot(key, value) {
  const slot = getSlot(key);
  if (!slot) return '';
  const v = String(value ?? '').trim();
  if (!v) return slot.required ? `The ${slot.label.toLowerCase()} is needed.` : '';
  if (LIMITS[key] && v.length > LIMITS[key]) return `Please keep the ${slot.label.toLowerCase()} under ${LIMITS[key]} characters.`;
  if (slot.choices && !slot.choices.includes(v)) return `Choose one of: ${slot.choices.join(', ')}.`;
  return '';
}

export const IDLE_TIMEOUT_MS = 90000; // plan §8: a half-filled form is discarded after 90s idle.

// Endpoints (plan §6/§7). All go through the patched global fetch (utils/authFetch.js:56-68), which adds the auth
// cookie, the CSRF header for POST, and X-Workspace-Id — the same path the Matters page uses.
export const LABEL_ENDPOINT = '/api/assistant/command';
export const CONFLICT_ENDPOINT = '/api/conflict/check';
export const CREATE_ENDPOINT = '/api/practice/cases';                 // Matters page create (Matters.jsx:485)
export const CASES_LIST_ENDPOINT = '/api/practice/cases?per_page=100'; // Matters page list (Matters.jsx:81)
export const CLIENTS_ENDPOINT = '/api/practice/clients?per_page=200';  // read-only clients list (Clients.jsx:24)
export const CONFLICT_TIMEOUT_MS = 15000;
export const CREATE_TIMEOUT_MS = 20000;

export function matterDetailRoute(id) {
  return id != null ? `/matters/${id}` : '/matters';                  // detail route proven at App.jsx:79
}

/*
 * The create body. Keys mirror the Matters page's create call (frontend/src/pages/Matters.jsx:479-489): title, court,
 * case_no, case_type and restricted, with the same defaults (restricted 0). The client goes in the inline `client`
 * object the backend actually consumes (routes/lpms_cases.py:185-186) — the Matters page's flat `client_name` is
 * dropped by the backend (parse_case never reads it). We never send team_id or advocate_id (advocate defaults to the
 * signed-in member, lpms_cases.py:177-178; team is optional, :87). phone/email would ride on `client` if the flow
 * ever collected them; today it does not.
 */
export function buildCreateBody(values) {
  const body = {
    title: (values.title || '').trim(),
    court: (values.court || '').trim(),
    case_no: (values.case_no || '').trim(),
    case_type: values.case_type || '',
    restricted: 0,
  };
  const name = (values.client || '').trim();
  if (name) body.client = { name };
  return body;
}

// The conflict-check body (routes/conflict_routes.py:886-888): entity_name (the client), opposing_party, matter_type.
export function buildConflictBody(values) {
  return {
    entity_name: (values.client || '').trim(),
    opposing_party: (values.opposite_party || '').trim(),
    matter_type: values.case_type || 'Civil',
  };
}

// Duplicate-safe retry: does the list already contain a case with this case number AND title? (plain code, browser-only)
export function findDuplicateCase(cases, values) {
  const no = (values.case_no || '').trim().toLowerCase();
  const title = (values.title || '').trim().toLowerCase();
  if (!no) return null;
  return (cases || []).find((c) => String(c.case_no || '').trim().toLowerCase() === no
    && String(c.title || '').trim().toLowerCase() === title) || null;
}

// Which existing active clients share this name (case-insensitive, name only — mirrors lpms_cases.py:116 linking rule).
export function matchClientNames(clients, name) {
  const n = (name || '').trim().toLowerCase();
  if (!n) return [];
  return (clients || []).filter((c) => String(c.name || '').trim().toLowerCase() === n).map((c) => c.name);
}
