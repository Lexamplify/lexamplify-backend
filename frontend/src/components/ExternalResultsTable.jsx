import React from 'react';
import { renderWithCitations } from './CitationLink';

// Distinct component for external judgment results — deliberately NOT forced
// into the internal Firm Library table, since the data shape is different
// (court/citation/headnote/url vs. the internal template/precedent shape).
export default function ExternalResultsTable({ results, savedIds, onSaveToLibrary, onInjectToVault }) {
  if (!results || results.length === 0) return null;

  return (
    <div className="fl-ext-results">
      {results.map((r) => (
        <div key={r.id} className="fl-ext-result-card">
          <div className="fl-ext-result-head">
            <div>
              <div className="fl-ext-result-title">{r.title}</div>
              <div className="fl-ext-result-meta">{r.court} · {r.year} · {r.citation}</div>
            </div>
            <a className="fl-ext-result-open" href={r.url} target="_blank" rel="noopener noreferrer">
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
