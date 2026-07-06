// ── Indian Legal Citation Parser ─────────────────────────────────────────────
// Detects citations in raw text (AIR, SCC, SCC OnLine, Cri LJ, Supreme Court
// neutral citations, and the post-2023 High Court colon-scheme neutral
// citations) and resolves them to search URLs + a mocked "good law" treatment
// signal. Resolutions are cached in localStorage to avoid redundant work and
// to seed a future firm-wide citation graph.

const CITATION_PATTERNS = [
  // High Court neutral citation scheme (eCourts, 2023+): 2024:DHC:1234, 2024:BHC-AS:1234-DB
  {
    type: 'NEUTRAL_HC',
    regex: /(\d{4}):([A-Z]{2,6}(?:-[A-Z]{2,3})?):(\d+)(-[A-Z]{2,3})?/g,
    parse: (m) => ({ year: m[1], court: m[2], number: m[3], bench: m[4] ? m[4].slice(1) : null }),
  },
  // Supreme Court neutral citation: 2023 INSC 123
  {
    type: 'NEUTRAL_SC',
    regex: /(\d{4})\s+INSC\s+(\d+)/g,
    parse: (m) => ({ year: m[1], number: m[2] }),
  },
  // SCC OnLine — distinct from print SCC (court code, not volume+page): 2019 SCC OnLine SC 1461
  {
    type: 'SCC_ONLINE',
    regex: /(\d{4})\s+SCC\s?Online\s+([A-Za-z]{2,6})\s+(\d+)/gi,
    parse: (m) => ({ year: m[1], court: m[2], page: m[3] }),
  },
  // Print SCC, with optional subject-matter suffix: (2018) 10 SCC 1, (2016) 7 SCC (Cri) 1
  {
    type: 'SCC',
    regex: /\(?\s*(\d{4})\s*\)?\s+(\d{1,2})\s*SCC\s*(?:\(([A-Za-z&]+)\))?\s+(\d+)/g,
    parse: (m) => ({ year: m[1], volume: m[2], subject: m[3] || null, page: m[4] }),
  },
  // AIR: AIR 1973 SC 1461, AIR 2020 Del 45, AIR 1954 P&H 12
  {
    type: 'AIR',
    regex: /AIR\s+(\d{4})\s+([A-Z][A-Za-z&]{1,5})\s+(\d+)/g,
    parse: (m) => ({ year: m[1], court: m[2], page: m[3] }),
  },
  // Criminal Law Journal: 2019 CriLJ 456, 2019 Cri LJ 456, 2019 Cri.L.J. 456
  {
    type: 'CRI_LJ',
    regex: /(\d{4})\s+Cri\.?\s?L\.?\s?J\.?\s+(\d+)/gi,
    parse: (m) => ({ year: m[1], page: m[2] }),
  },
];

/**
 * Scan raw text and return every detected citation, sorted by position with
 * overlapping matches collapsed to the longest (most specific) match — the
 * same interval-collision approach used for risk-clause highlighting.
 */
export function parseCitations(text) {
  if (!text) return [];
  const found = [];

  for (const { type, regex, parse } of CITATION_PATTERNS) {
    regex.lastIndex = 0; // reset stateful global regex before each scan
    let m;
    while ((m = regex.exec(text)) !== null) {
      found.push({
        type,
        raw: m[0],
        index: m.index,
        length: m[0].length,
        components: parse(m),
      });
      if (m.index === regex.lastIndex) regex.lastIndex += 1; // guard zero-width match loops
    }
  }

  found.sort((a, b) => a.index - b.index || b.length - a.length);
  const deduped = [];
  for (const c of found) {
    const overlaps = deduped.some(d => c.index < d.index + d.length && c.index + c.length > d.index);
    if (!overlaps) deduped.push(c);
  }
  return deduped.sort((a, b) => a.index - b.index);
}

// ── "Good law" treatment — mocked pending a real citator backend ───────────
// Deterministic per citation (same input always yields the same badge) and
// weighted realistically: most precedents remain good law.
export const TREATMENT_META = {
  good:          { label: 'Good Law',                                  color: '#34D399' },
  distinguished: { label: 'Distinguished — verify context',            color: '#FBBF24' },
  overruled:     { label: 'Overruled — do not rely without checking',  color: '#F87171' },
};

function mockTreatment(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const bucket = hash % 10;
  if (bucket < 7) return 'good';
  if (bucket < 9) return 'distinguished';
  return 'overruled';
}

// ── Resolution cache (localStorage) ─────────────────────────────────────────
const CACHE_KEY = 'lex_citation_cache';
const CACHE_LIMIT = 200;

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}
function writeCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* storage quota — skip */ }
}
function normalizeKey(raw) {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Resolve a raw citation string to a search URL + treatment signal.
 * Cached in localStorage — repeat encounters of the same citation across
 * documents skip re-computation and lay the groundwork for a firm-wide
 * citation graph once a real backend replaces the mock treatment.
 */
export function resolveCitation(raw) {
  const key = normalizeKey(raw);
  const cache = readCache();
  if (cache[key]) return cache[key];

  const entry = {
    url: `https://indiankanoon.org/search/?formInput=${encodeURIComponent(key)}`,
    treatment: mockTreatment(key),
    resolvedAt: Date.now(),
  };

  const keys = Object.keys(cache);
  if (keys.length >= CACHE_LIMIT) {
    const oldest = keys.sort((a, b) => cache[a].resolvedAt - cache[b].resolvedAt)[0];
    delete cache[oldest];
  }
  cache[key] = entry;
  writeCache(cache);
  return entry;
}

/**
 * Build the tri-database search URL matrix for a raw citation.
 * SCC Online / Manupatra are paywalled with unpublished internal search
 * schemas — we link to their public root rather than guessing a deep-link,
 * and rely on the clipboard-copy fallback so the user can paste the citation
 * directly once past the login wall.
 */
export function buildSearchUrls(raw) {
  const key = normalizeKey(raw);
  return {
    indianKanoon: `https://indiankanoon.org/search/?formInput=${encodeURIComponent(key)}`,
    sccOnline: 'https://www.scconline.com',
    manupatra: 'https://www.manupatrafast.com',
  };
}
