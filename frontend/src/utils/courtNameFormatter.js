// ── District Court Display-Name Formatter ────────────────────────────────────
// data/districts.json stores raw eCourts district identifiers ("Kurnool",
// "South East Delhi") — not the formal court-complex names lawyers actually
// use. This formats them for DISPLAY ONLY; callers must keep using the raw
// district name as the <option value>, DB lookup key, and cause-list URL
// input (see CourtResources.jsx) so the eCourts data contract is untouched.
//
// Delhi is a special case: its 11 revenue districts don't each have their own
// court building — they're consolidated into 6 physical complexes. Mapping
// verified against each district's own official dcourts.gov.in site (not
// secondary/blog summaries, which disagreed with each other on North Delhi
// and West Delhi specifically):
//   - Tis Hazari Courts   → Central, North, West Delhi
//   - Rohini Courts       → North West Delhi (districts.json's own URL for
//                           this entry is rohini.dcourts.gov.in — confirms it)
//   - Karkardooma Courts  → East, North East Delhi, Shahdara
//   - Patiala House Courts→ New Delhi
//   - Saket Courts        → South, South East Delhi
//   - Dwarka Courts       → South West Delhi
// Rouse Avenue is deliberately absent here — it's a special-jurisdiction
// complex (CBI/NDPS/economic offences), not tied to a revenue district, and
// its districts.json entry ("Rouse Avenue Court Complex") already contains
// "Court"/"Complex" so the idempotency guard below leaves it untouched.

const DELHI_DISTRICT_COURT_MAP = {
  'central delhi': 'Tis Hazari Courts',
  'north delhi': 'Tis Hazari Courts',
  'west delhi': 'Tis Hazari Courts',
  'north west delhi': 'Rohini Courts',
  'east delhi': 'Karkardooma Courts',
  'north east delhi': 'Karkardooma Courts',
  'shahdara': 'Karkardooma Courts',
  'new delhi': 'Patiala House Courts',
  'south delhi': 'Saket Courts',
  'south east delhi': 'Saket Courts',
  'south west delhi': 'Dwarka Courts',
};

const PLACEHOLDER_RE = /select/i;
// Already a formal court name (or one of the non-district Delhi entries —
// "Rouse Avenue Court Complex", "Delhi Family Court", "Delhi Mediation
// Centre" — that live alongside the 11 real districts in districts.json).
// Matching this must come before the Delhi-specific lookup, not after, or
// those three entries would get double-wrapped.
const ALREADY_FORMATTED_RE = /court|complex|tribunal|centre|bench/i;

/**
 * Formats a raw eCourts district name into the formal court-complex name a
 * lawyer would recognize, for display only. Idempotent: safe to call on a
 * string this function (or the source data) already formatted.
 * @param {string} stateName - e.g. "Delhi", "Andhra Pradesh"
 * @param {string|null|undefined} districtName - raw district.json `name`
 * @returns {string|null|undefined} display text; same value untouched for
 *   null/undefined/placeholder/already-formatted input
 */
export function formatCourtDisplayName(stateName, districtName) {
  if (districtName == null) return districtName;

  const trimmed = String(districtName).trim();
  if (!trimmed || PLACEHOLDER_RE.test(trimmed)) return districtName;
  if (ALREADY_FORMATTED_RE.test(trimmed)) return districtName;

  const isDelhi = typeof stateName === 'string' && stateName.trim().toLowerCase() === 'delhi';
  if (isDelhi) {
    const complex = DELHI_DISTRICT_COURT_MAP[trimmed.toLowerCase()];
    if (complex) return `${complex} (${trimmed})`;
  }

  return `District Court, ${trimmed}`;
}
