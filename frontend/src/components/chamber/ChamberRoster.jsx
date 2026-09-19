import React, { useState, useMemo, useEffect } from 'react';
import { useChamberStore } from '../../stores/useChamberStore';
import MatterDossierCard from './MatterDossierCard';
import NewDossierModal from './NewDossierModal';
import './chamberRoster.css';

export default function ChamberRoster() {
  const matters = useChamberStore((state) => state.matters);
  const filterArchetype = useChamberStore((state) => state.filterArchetype);
  const filterForum = useChamberStore((state) => state.filterForum);
  const searchQuery = useChamberStore((state) => state.searchQuery);
  const setFilterArchetype = useChamberStore((state) => state.setFilterArchetype);
  const setForumFilter = useChamberStore((state) => state.setForumFilter);
  const setSearchQuery = useChamberStore((state) => state.setSearchQuery);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchQuery);

  // Debounce search input to 200ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(localSearch);
    }, 200);
    return () => clearTimeout(timer);
  }, [localSearch, setSearchQuery]);

  // Archetype counts for filter pills
  const counts = useMemo(() => {
    return {
      all: matters.length,
      litigation: matters.filter((m) => m.matterType === 'litigation').length,
      arbitration: matters.filter((m) => m.matterType === 'arbitration').length,
      advisory: matters.filter((m) => m.matterType === 'advisory').length,
    };
  }, [matters]);

  // Filtered matters
  const filteredMatters = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return matters.filter((m) => {
      // Archetype filter
      if (filterArchetype !== 'all' && m.matterType !== filterArchetype) {
        return false;
      }

      // Forum filter
      if (filterForum !== 'all') {
        const forumName = m.forum?.name || '';
        if (!forumName.toLowerCase().includes(filterForum.toLowerCase())) {
          return false;
        }
      }

      // Search query filter (title, CNR, counsel)
      if (q) {
        const titleMatch = m.title?.toLowerCase().includes(q);
        const cnrMatch = m.ecourtsSync?.cnrNumber?.toLowerCase().includes(q);
        const leadMatch = m.counsel?.leadPartner?.toLowerCase().includes(q);
        const aorMatch = m.counsel?.advocateOnRecord?.toLowerCase().includes(q);
        const assocMatch = m.counsel?.leadAssociate?.toLowerCase().includes(q);

        if (!titleMatch && !cnrMatch && !leadMatch && !aorMatch && !assocMatch) {
          return false;
        }
      }

      return true;
    });
  }, [matters, filterArchetype, filterForum, searchQuery]);

  return (
    <div className="cr-workspace">
      {/* ── MASTHEAD ─────────────────────────────────────────────────────── */}
      <section className="cr-masthead" aria-label="Chamber Header">
        <div className="cr-masthead-info">
          <h1>Chamber Roster</h1>
          <p>Active litigation dockets, institutional arbitrations, and transactional dossiers under Indian law.</p>
        </div>

        <button
          type="button"
          className="cr-btn-primary"
          onClick={() => setIsModalOpen(true)}
          id="btnOpenIntake"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Case Dossier
        </button>
      </section>

      {/* ── CONTROLS BAR ─────────────────────────────────────────────────── */}
      <section className="cr-controls" aria-label="Roster Filters and Search">
        <div className="cr-segments" role="tablist" aria-label="Filter by Archetype">
          <button
            type="button"
            className={`cr-seg-btn ${filterArchetype === 'all' ? 'active' : ''}`}
            onClick={() => setFilterArchetype('all')}
          >
            All Matters ({counts.all})
          </button>
          <button
            type="button"
            className={`cr-seg-btn ${filterArchetype === 'litigation' ? 'active' : ''}`}
            onClick={() => setFilterArchetype('litigation')}
          >
            Litigation ({counts.litigation})
          </button>
          <button
            type="button"
            className={`cr-seg-btn ${filterArchetype === 'arbitration' ? 'active' : ''}`}
            onClick={() => setFilterArchetype('arbitration')}
          >
            Arbitration ({counts.arbitration})
          </button>
          <button
            type="button"
            className={`cr-seg-btn ${filterArchetype === 'advisory' ? 'active' : ''}`}
            onClick={() => setFilterArchetype('advisory')}
          >
            Advisory & M&A ({counts.advisory})
          </button>
        </div>

        <div className="cr-filters">
          <div className="cr-search-box">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--muted)', flexShrink: 0 }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              id="rosterSearch"
              placeholder="Search caption, CNR, or counsel..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              aria-label="Search matters"
            />
            {localSearch && (
              <button
                type="button"
                onClick={() => {
                  setLocalSearch('');
                  setSearchQuery('');
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                ✕
              </button>
            )}
          </div>

          <select
            className="cr-forum-select"
            id="forumFilter"
            value={filterForum}
            onChange={(e) => setForumFilter(e.target.value)}
            aria-label="Filter by forum"
          >
            <option value="all">All Forums</option>
            <option value="Supreme Court">Supreme Court</option>
            <option value="High Court">High Courts</option>
            <option value="Arbitral Tribunal">Arbitral Tribunals</option>
            <option value="Corporate Advisory">Corporate Advisory</option>
          </select>
        </div>
      </section>

      {/* ── DOSSIER LIST ─────────────────────────────────────────────────── */}
      <section className="cr-dossier-list" id="dossierList" aria-label="Case Dossier Roster">
        {filteredMatters.map((matter) => (
          <MatterDossierCard key={matter.id} matter={matter} />
        ))}

        {filteredMatters.length === 0 && (
          <div className="cr-empty-state">
            <p style={{ fontSize: '15px', color: 'var(--ink)' }}>No dossiers found matching current criteria</p>
            <p style={{ fontSize: '13px' }}>Try clearing filters or register a new case dossier to initiate tracking.</p>
            <button
              type="button"
              className="cr-btn-primary"
              style={{ marginTop: '8px' }}
              onClick={() => setIsModalOpen(true)}
            >
              + Open New Case Dossier
            </button>
          </div>
        )}
      </section>

      {/* ── 3-STEP INTAKE MODAL ──────────────────────────────────────────── */}
      <NewDossierModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}
