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
  const appellant = caseTitle.slice(0, match.index).trim();
  return appellant.length > 0 ? appellant : null;
}

function buildDateClause(year) {
  return year ? ` fromdate:1-1-${Number(year) - 1} todate:31-12-${Number(year)}` : '';
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
