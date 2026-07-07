import React from 'react';
import { renderWithCitations } from './CitationLink';
import { buildKanoonUrl } from '../utils/citationResolver';

// Court-hierarchy rank for the tie-break — pattern-matched rather than a
// hardcoded name list, so it scales to any court string.
function courtRank(court) {
  if (court === 'Supreme Court of India') return 0;
  if (/high court/i.test(court || '')) return 1;
  return 2;
}

// Missing/unparseable years must never corrupt the comparator (NaN from
// Number(undefined) is spec-undefined as a sort return value) — coerce to
// -Infinity so bad data deterministically sorts last instead of producing
// nondeterministic ordering.
function safeYear(year) {
  const n = Number(year);
  return Number.isFinite(n) ? n : -Infinity;
}

// Display order is enforced here (presentation layer), not by the search
// source — so it stays correct even if the mock is later swapped for a real
// API that returns its own relevance ordering. Chronological descending
// first, then Supreme Court > High Courts > Others within the same year —
// this keeps the newest matters on top without burying landmark cases behind
// unrelated recent ones from a lower court.
function sortResults(results) {
  return [...results].sort((a, b) => {
    const yearDiff = safeYear(b.year) - safeYear(a.year);
    if (yearDiff !== 0) return yearDiff;
    return courtRank(a.court) - courtRank(b.court);
  });
}

// Distinct component for external judgment results — deliberately NOT forced
// into the internal Firm Library table, since the data shape is different
// (court/citation/headnote/url vs. the internal template/precedent shape).
export default function ExternalResultsTable({ results, savedIds, onSaveToLibrary, onInjectToVault }) {
  if (!results || results.length === 0) return null;
  const sorted = sortResults(results);

  return (
    <div className="fl-ext-results">
      {sorted.map((r) => (
        <div key={r.id} className="fl-ext-result-card">
          <div className="fl-ext-result-head">
            <div>
              <div className="fl-ext-result-title">{r.title}</div>
              <div className="fl-ext-result-meta">{r.court} · {r.year} · {r.citation}</div>
            </div>
            <a className="fl-ext-result-open" href={buildKanoonUrl(r.citation, r.year, r.title)} target="_blank" rel="noopener noreferrer">
              Open ↗
            </a>
          </div>

          <div className="fl-ext-result-headnote">{renderWithCitations(r.headnote)}</div>

          <div className="fl-ext-result-actions">
            <button
              type="button"
              className="fl-ext-action-btn"
              disabled={savedIds.has(r.id)}
              onClick={() => onSaveToLibrary(r)}
            >
              {savedIds.has(r.id) ? '✓ Saved to Library' : '+ Save to Firm Library'}
            </button>
            <button
              type="button"
              className="fl-ext-action-btn vault"
              onClick={() => onInjectToVault(r)}
            >
              + Inject into Vault
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
