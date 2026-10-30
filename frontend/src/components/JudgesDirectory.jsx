import React, { useState, useEffect, useMemo } from 'react';
import { fetchJudgesDirectory } from '../services/api';

const SKELETON_ROWS = 8;

function SkeletonRow() {
  return (
    <tr className="jd-skeleton-row">
      <td><span className="jd-skeleton-line" style={{ width: '70%' }} /></td>
      <td><span className="jd-skeleton-line" style={{ width: '55%' }} /></td>
      <td><span className="jd-skeleton-line" style={{ width: '60%' }} /></td>
      <td><span className="jd-skeleton-line" style={{ width: '45%' }} /></td>
    </tr>
  );
}

function JudgesDirectory() {
  const [judges, setJudges] = useState([]);
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [courtFilter, setCourtFilter] = useState('All');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchJudgesDirectory().then((data) => {
      if (cancelled) return;
      setJudges(data.judges || []);
      setErrors(data.errors || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const courts = useMemo(() => {
    const set = new Set(judges.map((j) => j.court));
    return ['All', ...Array.from(set).sort()];
  }, [judges]);

  const filteredJudges = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return judges.filter((j) => {
      if (courtFilter !== 'All' && j.court !== courtFilter) return false;
      if (!q) return true;
      return j.name.toLowerCase().includes(q) || (j.designation || '').toLowerCase().includes(q);
    });
  }, [judges, searchQuery, courtFilter]);

  return (
    <div className="resource-panel jd-panel">
      <style>{`
        .jd-panel { display: flex; flex-direction: column; gap: 16px; }

        .jd-controls-sticky {
          position: sticky;
          top: 0;
          z-index: 5;
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
          padding: 12px 0;
          background: var(--bg-panel);
          border-bottom: 1px solid var(--border-subtle);
        }
        .jd-search-input {
          flex: 1 1 260px;
          min-width: 220px;
          padding: 10px 14px;
          border-radius: 8px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
          font-size: 13.5px;
        }
        .jd-court-select {
          padding: 10px 14px;
          border-radius: 8px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
          font-size: 13.5px;
          min-width: 200px;
        }
        .jd-result-count {
          font-size: 12px;
          color: var(--text-muted);
          white-space: nowrap;
        }

        .jd-table-wrap {
          overflow-x: auto;
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
        }
        .jd-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .jd-table thead th {
          position: sticky;
          top: 0;
          text-align: left;
          padding: 10px 14px;
          background: var(--bg-card);
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid var(--border-subtle);
          white-space: nowrap;
        }
        .jd-table tbody td {
          padding: 12px 14px;
          border-bottom: 1px solid var(--border-subtle);
          color: var(--text-primary);
          vertical-align: top;
        }
        .jd-table tbody tr:last-child td { border-bottom: none; }
        .jd-table tbody tr:hover { background: var(--accent-muted, rgba(59,130,246,0.06)); }
        .jd-judge-name { font-weight: 600; }
        .jd-court-badge {
          font-size: 10.5px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 10px;
          background: rgba(59,130,246,0.12);
          color: var(--accent-primary, #3B82F6);
          border: 1px solid rgba(59,130,246,0.25);
          white-space: nowrap;
        }
        .jd-muted { color: var(--text-muted); }

        .jd-skeleton-line {
          display: inline-block;
          height: 12px;
          border-radius: 4px;
          background: linear-gradient(90deg, var(--bg-card) 25%, var(--border-subtle) 50%, var(--bg-card) 75%);
          background-size: 200% 100%;
          animation: jd-shimmer 1.4s ease-in-out infinite;
        }
        @keyframes jd-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        .jd-error-banner {
          padding: 10px 14px;
          border-radius: 8px;
          background: rgba(239,68,68,0.08);
          border: 1px solid rgba(239,68,68,0.25);
          color: #FCA5A5;
          font-size: 12.5px;
          line-height: 1.5;
        }

        .jd-empty-state {
          padding: 48px 20px;
          text-align: center;
          color: var(--text-muted);
          font-style: italic;
        }
      `}</style>

      <div className="panel-header">
        <h2>Judges Directory</h2>
        <p>Live sitting-judge roster, scraped directly from official court websites and cached for 24 hours.</p>
      </div>

      {errors.length > 0 && (
        <div className="jd-error-banner">
          ⚠️ {errors.length === 1 ? 'One source' : `${errors.length} sources`} could not be refreshed right now: {errors.join('; ')}.
          {judges.length > 0 && ' Showing results from the remaining source(s) below.'}
        </div>
      )}

      <div className="jd-controls-sticky">
        <input
          type="text"
          className="jd-search-input"
          placeholder="Search by name or designation…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select
          className="jd-court-select"
          value={courtFilter}
          onChange={(e) => setCourtFilter(e.target.value)}
        >
          {courts.map((c) => (
            <option key={c} value={c}>{c === 'All' ? 'Select Court — All' : c}</option>
          ))}
        </select>
        {!loading && (
          <span className="jd-result-count">{filteredJudges.length} of {judges.length} judges</span>
        )}
      </div>

      <div className="jd-table-wrap">
        <table className="jd-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Court</th>
              <th>Designation</th>
              <th>Term of Office</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: SKELETON_ROWS }).map((_, i) => <SkeletonRow key={i} />)
            ) : filteredJudges.length > 0 ? (
              filteredJudges.map((j, i) => (
                <tr key={`${j.court}-${j.name}-${i}`}>
                  <td className="jd-judge-name">{j.name}</td>
                  <td><span className="jd-court-badge">{j.court}</span></td>
                  <td>{j.designation || <span className="jd-muted">—</span>}</td>
                  <td>{j.term || <span className="jd-muted">—</span>}</td>
                </tr>
              ))
            ) : null}
          </tbody>
        </table>
        {!loading && filteredJudges.length === 0 && (
          <div className="jd-empty-state">
            {judges.length === 0
              ? 'No judges available right now — all live sources failed to respond.'
              : 'No judges match your search.'}
          </div>
        )}
      </div>
    </div>
  );
}

export default JudgesDirectory;
