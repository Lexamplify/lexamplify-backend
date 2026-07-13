// ── Look-Ahead Kanoon Doc Resolver ───────────────────────────────────────────
// Browsers can't fetch indiankanoon.org directly (no CORS headers on their
// search results page), so we route the request through a public CORS proxy
// and scrape the first result's document ID out of the returned HTML.
//
// This is best-effort by design: the proxy can be down, rate-limited, slow,
// or blocked by the user's network — none of that should ever surface as an
// unhandled error to the caller. Every failure path resolves to the plain
// Kanoon search URL, which always works.

const KANOON_ORIGIN = 'https://indiankanoon.org';
const PROXY_PREFIX = 'https://api.allorigins.win/get?url=';
const FETCH_TIMEOUT_MS = 4000;

function buildSearchUrl(query) {
  return `${KANOON_ORIGIN}/search/?formInput=${encodeURIComponent(query)}`;
}

/**
 * Resolves a free-text query to the exact Kanoon document URL by looking up
 * the first search result through a CORS proxy. Falls back to the plain
 * search URL — never rejects/throws — if the proxy fails, times out, or the
 * page shape doesn't match what we expect.
 */
export async function resolveKanoonDoc(query) {
  const searchUrl = buildSearchUrl(query);
  if (!query || typeof query !== 'string' || !query.trim()) return searchUrl;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const proxyUrl = `${PROXY_PREFIX}${encodeURIComponent(searchUrl)}`;
    const res = await fetch(proxyUrl, { signal: controller.signal });
    if (!res.ok) return searchUrl;

    const { contents } = await res.json();
    if (!contents) return searchUrl;

    const parsed = new DOMParser().parseFromString(contents, 'text/html');
    const resultLink = parsed.querySelector('.result_title a');
    const href = resultLink?.getAttribute('href') || '';

    const idMatch = href.match(/\/doc\/(\d+)/);
    if (!idMatch) return searchUrl;

    return `${KANOON_ORIGIN}/doc/${idMatch[1]}/`;
  } catch {
    return searchUrl;
  } finally {
    clearTimeout(timeoutId);
  }
}
