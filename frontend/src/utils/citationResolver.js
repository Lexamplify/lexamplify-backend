// ── Async Citation Resolver ───────────────────────────────────────────────────
// Simulates querying the Kanoon API (`cite: [citation]`) to retrieve a numeric
// document ID. Deterministic per-citation success/failure (hash-based, not
// Math.random()) so the same citation always resolves the same way on repeat
// clicks — no flaky UX where a citation is "found" one click and "not found"
// the next. Resolutions are cached in localStorage to skip the simulated
// network latency on repeat lookups.

import { hashString, normalizeCitationKey } from './citationParser';

const CACHE_KEY = 'lex_citation_resolution_cache';
const CACHE_LIMIT = 200;

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}
function writeCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* storage quota — skip */ }
}

function mockDocId(key) {
  // 6-digit-ish number in the shape of a real Indian Kanoon /doc/<id>/ URL
  return 100000 + (hashString(key) % 900000);
}

/**
 * Resolve a raw citation string to either a found document (with a mocked
 * Indian Kanoon doc URL) or a not-found result. Async to simulate a real
 * network round-trip — callers MUST open any window/tab synchronously
 * *before* awaiting this, or browsers will block it as an unrequested popup.
 */
export async function resolveCitation(rawText) {
  const key = normalizeCitationKey(rawText);
  const cache = readCache();
  if (cache[key]) return cache[key];

  // Simulate querying `cite: "<citation>"` against the Kanoon search API
  await new Promise((resolve) => setTimeout(resolve, 550 + Math.random() * 450));

  const bucket = hashString(key) % 10;
  const found = bucket < 8; // deterministic 80/20 split, stable per citation

  const result = found
    ? { status: 'found', docId: mockDocId(key), url: `https://indiankanoon.org/doc/${mockDocId(key)}/` }
    : { status: 'not_found' };

  const keys = Object.keys(cache);
  if (keys.length >= CACHE_LIMIT) {
    const oldest = keys.sort((a, b) => cache[a].resolvedAt - cache[b].resolvedAt)[0];
    delete cache[oldest];
  }
  cache[key] = { ...result, resolvedAt: Date.now() };
  writeCache(cache);

  return result;
}
