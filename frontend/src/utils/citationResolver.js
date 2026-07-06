// ── Kanoon Temporal-Bounding URL Algorithm ───────────────────────────────────
// Every citation routes directly to Indian Kanoon's search results — no
// simulated failure, no fallback databases, no network round-trip. Pure,
// synchronous string construction.
//
// SCC/AIR volumes are numbered by publication year, and a judgment delivered
// late in a calendar year is often reported the following year. Widening the
// search window to [YEAR-1 .. YEAR] catches that lag without over-restricting
// the search when the citation year and pronouncement year already match.

export function buildKanoonUrl(rawCitation, year) {
  const exact = `"${rawCitation}"`;
  const query = year
    ? `${exact} fromdate:1-1-${Number(year) - 1} todate:31-12-${Number(year)}`
    : exact;
  return `https://indiankanoon.org/search/?formInput=${encodeURIComponent(query)}`;
}
