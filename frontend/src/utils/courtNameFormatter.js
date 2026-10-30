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

// ── Metro court-complex overrides ────────────────────────────────────────────
// A directive asking to inject named complexes for Mumbai, Kolkata,
// Hyderabad, and Ahmedabad (in addition to Chennai and Bengaluru) was only
// half right: districts.json already splits those four metros' courts into
// multiple correctly-named entries that bypass the generic fallback above on
// their own merit (they contain "Court"), e.g. "Mumbai CMM Court", "Kolkata-
// City Civil Court", "Hyderabad-Metropolitan Sessions Court", "City Civil &
// Sessions Court, Ahmedabad". Replacing those with a hand-typed alternate
// list would have meant discarding real, already-correct eCourts-sourced
// entries in favor of unverified guesses — so only the two states below,
// where a single bare entry ("Chennai" / "Bengaluru") genuinely exists and
// falls through to "District Court, X", get expanded. Complex names verified
// against districts.ecourts.gov.in and bengaluru.dcourts.gov.in.
const METRO_COURT_COMPLEXES = {
  'tamil nadu|chennai': [
    'City Civil Court Complex (High Court Campus)',
    'Chief Metropolitan Magistrate Court, Egmore',
    'Small Causes Court, Chennai',
    'Saidapet Court Complex',
    'George Town Court Complex',
  ],
  'karnataka|bengaluru': [
    'City Civil and Sessions Court Complex, Bengaluru',
    'Chief Metropolitan Magistrate Court Complex',
    'Court of Small Causes, Bengaluru',
    'Mayo Hall Court Complex',
  ],
};

/**
 * Returns the list of metro court-complex names for a (state, raw district)
 * pair, or null if this district has no override. Order here is not
 * meaningful — callers sort by final display label.
 */
export function getMetroComplexes(stateName, districtName) {
  if (typeof stateName !== 'string' || typeof districtName !== 'string') return null;
  const key = `${stateName.trim().toLowerCase()}|${districtName.trim().toLowerCase()}`;
  return METRO_COURT_COMPLEXES[key] || null;
}

/**
 * Resolves a district <select> value back to (a) the real eCourts district
 * name — needed to look up `.url` for the official-site/cause-list buttons,
 * since a metro complex isn't itself a real eCourts district — and (b) the
 * correct display label. Metro-complex values are encoded as
 * "<realDistrictName>::<complexIndex>"; anything else is a normal district
 * name passed straight through formatCourtDisplayName.
 */
export function resolveDistrictSelection(stateName, selectedValue) {
  if (!selectedValue) return { realDistrictName: selectedValue, displayName: selectedValue };

  const sepIndex = selectedValue.lastIndexOf('::');
  if (sepIndex === -1) {
    return { realDistrictName: selectedValue, displayName: formatCourtDisplayName(stateName, selectedValue) };
  }

  const realDistrictName = selectedValue.slice(0, sepIndex);
  const complexIndex = Number(selectedValue.slice(sepIndex + 2));
  const complexes = getMetroComplexes(stateName, realDistrictName);
  const displayName = (complexes && complexes[complexIndex] != null) ? complexes[complexIndex] : realDistrictName;
  return { realDistrictName, displayName };
}
