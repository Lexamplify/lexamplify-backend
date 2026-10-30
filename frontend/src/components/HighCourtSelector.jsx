import { useState, useEffect } from 'react';
import { fetchHighCourts } from '../services/api';

const SKELETON_CARDS = 8;

function HighCourtSelector({ activeCourtId, onSelect }) {
  const [courts, setCourts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setIsError(false);
    fetchHighCourts().then((data) => {
      if (cancelled) return;
      if (data.error) {
        setIsError(true);
      } else {
        setCourts(data.courts);
      }
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const safeSearch = query.trim().toLowerCase();
  const filtered = safeSearch
    ? courts.filter((c) => c.name.toLowerCase().includes(safeSearch) || c.jurisdiction.toLowerCase().includes(safeSearch))
    : courts;

  return (
    <div className="hcs-wrap">
      <style>{`
        .hcs-wrap { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }

        .hcs-search {
          width: 100%;
          max-width: 420px;
          padding: 10px 14px;
          border-radius: 8px;
          background: var(--bg-dark-card, #1a2032);
          border: 1px solid var(--border-dark-subtle, rgba(255,255,255,0.1));
          color: var(--text-dark-primary, #E2E8F0);
          font-size: 13.5px;
        }

        .hcs-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          max-height: 400px;
          overflow-y: auto;
          padding: 4px 4px 4px 0;
        }
        @media (max-width: 1024px) {
          .hcs-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 768px) {
          .hcs-grid { grid-template-columns: 1fr; }
        }

        .hcs-card {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
          text-align: left;
          padding: 12px 14px;
          border-radius: 10px;
          background: var(--bg-dark-card, #1a2032);
          border: 1px solid var(--border-dark-subtle, rgba(255,255,255,0.1));
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s ease;
        }
        .hcs-card:hover {
          background: rgba(59,130,246,0.08);
          border-color: rgba(59,130,246,0.3);
        }
        .hcs-card.active {
          background: rgba(59,130,246,0.14);
          border-color: var(--accent-primary, #3B82F6);
        }
        .hcs-card-title { font-weight: 600; color: var(--text-dark-primary, #E2E8F0); font-size: 13.5px; }
        .hcs-card-jurisdiction { font-size: 12px; color: #666; }

        .hcs-skeleton-card {
          height: 62px;
          border-radius: 10px;
          background: linear-gradient(90deg, var(--bg-dark-card, #1a2032) 25%, rgba(255,255,255,0.06) 50%, var(--bg-dark-card, #1a2032) 75%);
          background-size: 200% 100%;
          animation: hcs-shimmer 1.4s ease-in-out infinite;
        }
        @keyframes hcs-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        .hcs-error, .hcs-empty {
          padding: 20px;
          text-align: center;
          border-radius: 8px;
          background: var(--bg-dark-card, #1a2032);
          color: var(--text-dark-muted, #94A3B8);
          font-size: 13px;
        }
        .hcs-error { color: #FCA5A5; }
      `}</style>

      <input
        type="text"
        className="hcs-search"
        placeholder="Search by High Court or State name..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {isLoading ? (
        <div className="hcs-grid">
          {Array.from({ length: SKELETON_CARDS }).map((_, i) => (
            <div key={i} className="hcs-skeleton-card" />
          ))}
        </div>
      ) : isError ? (
        <div className="hcs-error">⚠️ Failed to load High Courts. Please retry.</div>
      ) : filtered.length === 0 ? (
        <div className="hcs-empty">No High Courts match "{query}".</div>
      ) : (
        <div className="hcs-grid">
          {filtered.map((court) => (
            <button
              key={court.id}
              type="button"
              className={`hcs-card${activeCourtId === court.id ? ' active' : ''}`}
              onClick={() => onSelect(court.id)}
              aria-pressed={activeCourtId === court.id}
            >
              <span className="hcs-card-title">{court.name}</span>
              <span className="hcs-card-jurisdiction">{court.jurisdiction}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default HighCourtSelector;
