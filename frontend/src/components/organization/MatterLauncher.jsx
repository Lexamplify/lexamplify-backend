import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrganizationStore } from '../../stores/useOrganizationStore';
import NewMatterModal from './NewMatterModal';
import NewTeamModal from './NewTeamModal';
import './organization.css';

// Crisp inline vector icons (no stock emojis)
const Icons = {
  search: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  team: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  plus: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  clock: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  gateway: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
};

export default function MatterLauncher() {
  const navigate = useNavigate();

  const matters = useOrganizationStore((state) => state.matters);
  const teams = useOrganizationStore((state) => state.teams);
  const activeMatterId = useOrganizationStore((state) => state.activeMatterId);
  const setActiveMatter = useOrganizationStore((state) => state.setActiveMatter);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedTeamTab, setSelectedTeamTab] = useState('all');
  const [isMatterModalOpen, setIsMatterModalOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);

  // Debounce search input to 200ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Dynamic filter: search query and selected team tab
  const filteredMatters = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();

    return matters.filter((m) => {
      // Team filter
      if (selectedTeamTab !== 'all' && m.teamId !== selectedTeamTab) {
        return false;
      }

      // Search filter (title, counsel)
      if (q) {
        const titleMatch = m.title?.toLowerCase().includes(q);
        const counselMatch = m.leadCounsel?.toLowerCase().includes(q);
        if (!titleMatch && !counselMatch) {
          return false;
        }
      }

      return true;
    });
  }, [matters, selectedTeamTab, debouncedSearch]);

  const handleCardClick = (matterId) => {
    setActiveMatter(matterId);
    navigate(`/workspace/matter/${matterId}`);
  };

  const getTeamName = (teamId) => {
    const t = teams.find((item) => item.id === teamId);
    return t ? t.name : 'Chamber Team';
  };

  return (
    <div className="org-gateway-container">
      {/* Masthead */}
      <section className="launcher-masthead" aria-label="Practice Gateway Masthead">
        <div className="masthead-info">
          <div className="eyebrow">
            {Icons.gateway}
            Practice Gateway
          </div>
          <h1 className="masthead-title">Choose a matter to get started</h1>
          <p className="masthead-desc">
            Your firm's people work in teams, and teams run the matters — a matter can span several teams and map to its clients or outside professionals. Pick one to begin.
          </p>
        </div>

        <div className="action-group">
          <button
            type="button"
            className="btn-org btn-org-secondary"
            onClick={() => setIsTeamModalOpen(true)}
            id="btnOpenNewTeam"
          >
            {Icons.team}
            New team
          </button>

          <button
            type="button"
            className="btn-org btn-org-primary"
            onClick={() => setIsMatterModalOpen(true)}
            id="btnOpenNewMatter"
          >
            {Icons.plus}
            New matter
          </button>
        </div>
      </section>

      {/* Search & Team Filter Tabs */}
      <section className="filter-row" aria-label="Search and Filter Matters" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '14px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div className="filter-bar" style={{ flex: 1 }}>
            <span style={{ color: 'var(--muted)', display: 'flex' }}>{Icons.search}</span>
            <input
              type="text"
              className="filter-input"
              id="searchMatters"
              placeholder="Search matters by title or counsel..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search matters"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  background: 'none',
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
        </div>

        {/* Dynamic Team Filter Pills */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            overflowX: 'auto',
            paddingBottom: '4px',
          }}
          role="tablist"
          aria-label="Filter matters by team"
        >
          <button
            type="button"
            className={`btn-org ${selectedTeamTab === 'all' ? 'btn-org-primary' : 'btn-org-secondary'}`}
            style={{ padding: '6px 14px', fontSize: '12px', borderRadius: '20px' }}
            onClick={() => setSelectedTeamTab('all')}
          >
            All Teams ({matters.length})
          </button>

          {teams.map((team) => {
            const count = matters.filter((m) => m.teamId === team.id).length;
            const isSelected = selectedTeamTab === team.id;
            return (
              <button
                key={team.id}
                type="button"
                className={`btn-org ${isSelected ? 'btn-org-primary' : 'btn-org-secondary'}`}
                style={{ padding: '6px 14px', fontSize: '12px', borderRadius: '20px', whiteSpace: 'nowrap' }}
                onClick={() => setSelectedTeamTab(team.id)}
              >
                {team.name} ({count})
              </button>
            );
          })}
        </div>
      </section>

      {/* Dynamic Matter Grid */}
      <section className="matters-grid" id="mattersGrid" aria-label="Matters Grid">
        {filteredMatters.map((matter) => {
          const isCurrentActive = matter.id === activeMatterId;
          const statusText = matter.status
            ? matter.status.charAt(0).toUpperCase() + matter.status.slice(1)
            : 'Open';

          return (
            <article
              key={matter.id}
              className={`matter-card ${isCurrentActive ? 'active-card' : ''}`}
              onClick={() => handleCardClick(matter.id)}
              tabIndex={0}
              role="button"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCardClick(matter.id);
                }
              }}
            >
              <div className="matter-card-top">
                <span className="status-badge">
                  <span className={`status-dot ${matter.status || 'open'}`} />
                  {statusText}
                </span>
                {isCurrentActive && (
                  <span className="last-used-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    {Icons.clock} Last used
                  </span>
                )}
              </div>

              <div>
                <h2 className="matter-title">{matter.title}</h2>
                <p className="matter-meta">
                  Lead: {matter.leadCounsel || 'Narendar V'} · Opened {matter.openedAt}
                </p>
              </div>

              <div className="matter-card-bottom">
                <div className="user-avatar-tag">
                  <div className="avatar-circle">
                    NV
                  </div>
                  <span>{matter.leadCounsel || 'Narendar V'}</span>
                </div>
                <div className="team-pill" title={getTeamName(matter.teamId)}>
                  <span>●</span>
                  <span>{getTeamName(matter.teamId)}</span>
                </div>
              </div>
            </article>
          );
        })}

        {filteredMatters.length === 0 && (
          <div className="empty-matters-state" style={{ gridColumn: '1 / -1' }}>
            <p style={{ fontSize: '15px', color: 'var(--ink)' }}>No matters found matching your search</p>
            <p style={{ fontSize: '13px' }}>Create a new matter or adjust your team tab filter to proceed.</p>
            <button
              type="button"
              className="btn-org btn-org-primary"
              style={{ marginTop: '8px' }}
              onClick={() => setIsMatterModalOpen(true)}
            >
              {Icons.plus} Create New Matter
            </button>
          </div>
        )}
      </section>

      {/* Modals via React Portal */}
      <NewMatterModal
        isOpen={isMatterModalOpen}
        onClose={() => setIsMatterModalOpen(false)}
        onOpenNewTeam={() => {
          setIsMatterModalOpen(false);
          setIsTeamModalOpen(true);
        }}
      />

      <NewTeamModal
        isOpen={isTeamModalOpen}
        onClose={() => setIsTeamModalOpen(false)}
      />
    </div>
  );
}
