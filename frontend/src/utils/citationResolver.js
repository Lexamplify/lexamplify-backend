// ── Kanoon Routing Algorithm — Appellant + Citation Search ───────────────────
// Pure, synchronous URL construction. No network round-trip, no simulated
// success/failure.
//
// THE BUG THIS FIXES: wrapping the full citation (or full case title) in
// strict double-quotes forces an exact-phrase match against Kanoon's index.
// Citations carry punctuation/spacing that can drift from how Kanoon's
// indexed text represents them (extra spaces, "vs" vs "v.", etc.), so an
// exact quoted match silently returns 0 results. Fix: quote only the
// appellant name (a clean proper noun, far less likely to drift) scoped to
// the `title:` field, and leave the citation itself unquoted as a keyword
// term — still relevant, never brittle.
//
// SCC/AIR volumes are numbered by publication year, and a judgment delivered
// late in a calendar year is often reported the following year. Widening the
// search window to [YEAR-1 .. YEAR] catches that lag.

const SEPARATOR_PATTERN = /\s+(?:v\.?|vs\.?|versus)\s+/i;

/**
 * Extract the appellant (party before "v."/"vs"/"versus") from a case title.
 * Returns null for missing titles or titles with no recognizable separator
 * (suo motu matters, "In re: ...", etc.) rather than guessing a bad split.
 */
function extractAppellant(caseTitle) {
  if (!caseTitle || typeof caseTitle !== 'string') return null;
  const match = caseTitle.match(SEPARATOR_PATTERN);
  if (!match) return null;
  // Strip embedded double-quotes — an unescaped `"` inside the appellant
  // name would prematurely close the title:"..." phrase-boundary quoting
  // below and corrupt the rest of the generated query.
  const appellant = caseTitle.slice(0, match.index).trim().replace(/"/g, '');
  return appellant.length > 0 ? appellant : null;
}

function buildDateClause(year) {
  const numericYear = Number(year);
  return year && Number.isFinite(numericYear)
    ? ` fromdate:1-1-${numericYear - 1} todate:31-12-${numericYear}`
    : '';
}

/**
 * Three-tier query construction, most-specific first:
 *   1. Appellant cleanly extracted -> field-scoped title search + citation.
 *   2. Title exists but has no recognizable separator -> whole title
 *      unquoted (never guess-quote a title we couldn't parse).
 *   3. No title at all -> bare citation, never quoted.
 * The citation itself is NEVER wrapped in quotes in any tier — that's the
 * exact behavior that caused the reported 0-results failures.
 */
export function buildKanoonUrl(rawCitation, year, caseTitle) {
  // Guard rawCitation the same way caseTitle already is below — null/
  // undefined/non-string input must not bake the literal text "null"/
  // "undefined" into the generated search query.
  rawCitation = (rawCitation && typeof rawCitation === 'string') ? rawCitation.trim() : '';

  const dateClause = buildDateClause(year);
  const appellant = extractAppellant(caseTitle);

  let query;
  if (appellant) {
    query = `title:"${appellant}" ${rawCitation}${dateClause}`;
  } else if (caseTitle && typeof caseTitle === 'string' && caseTitle.trim()) {
    query = `${caseTitle.trim()} ${rawCitation}${dateClause}`;
  } else {
    query = `${rawCitation}${dateClause}`;
  }

  return `https://indiankanoon.org/search/?formInput=${encodeURIComponent(query)}`;
}
