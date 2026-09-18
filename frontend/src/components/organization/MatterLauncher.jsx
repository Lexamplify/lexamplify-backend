import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrgStore } from '../../store/useOrgStore';
import NewMatterModal from './NewMatterModal';
import NewTeamModal from './NewTeamModal';
import './organization.css';

export default function MatterLauncher() {
  const navigate = useNavigate();

  const matters = useOrgStore((state) => state.matters);
  const activeMatterId = useOrgStore((state) => state.activeMatterId);
  const setActiveMatter = useOrgStore((state) => state.setActiveMatter);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isMatterModalOpen, setIsMatterModalOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);

  // Filter matters by search query (title, team, lead counsel) and status
  const filteredMatters = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return matters.filter((m) => {
      const matchesSearch =
        !q ||
        m.title.toLowerCase().includes(q) ||
        m.teamName?.toLowerCase().includes(q) ||
        m.leadCounsel?.toLowerCase().includes(q);

      const matchesStatus =
        statusFilter === 'all' || m.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [matters, searchQuery, statusFilter]);

  const handleSelectMatter = (matter) => {
    setActiveMatter(matter.id);
    navigate('/dashboard');
  };

  const getInitials = (name) => {
    if (!name) return 'L';
    return name
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const formatStatus = (status) => {
    if (status === 'on_hold') return 'On Hold';
    if (!status) return 'Open';
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  return (
    <div className="org-gateway-container">
      {/* Notice Banner */}
      <section className="trial-banner" aria-label="Subscription Notice">
        <div className="trial-banner-left">
          <span>⏱</span>
          <span>3 days remaining in your enterprise trial.</span>
        </div>
        <button
          type="button"
          className="btn-upgrade"
          onClick={() => alert('Enterprise plan upgrade flow initiated.')}
        >
          Upgrade Firm Plan
        </button>
      </section>

      {/* Launcher Masthead */}
      <section className="launcher-masthead">
        <div className="masthead-info">
          <div className="eyebrow">
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
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            Practice Gateway
          </div>
          <h1 className="masthead-title">Choose a matter to get started</h1>
          <p className="masthead-desc">
            Your firm collaborates in teams, and teams manage discrete matters.
            Select an active matter to open its vault, calendar, and AI workspace.
          </p>
        </div>

        <div className="action-group">
          <button
            type="button"
            className="btn-org btn-org-secondary"
            onClick={() => setIsTeamModalOpen(true)}
            id="btnOpenNewTeam"
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
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            New team
          </button>

          <button
            type="button"
            className="btn-org btn-org-primary"
            onClick={() => setIsMatterModalOpen(true)}
            id="btnOpenNewMatter"
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
            New matter
          </button>
        </div>
      </section>

      {/* Search & Filter Controls */}
      <section className="filter-row" aria-label="Search and Filter Matters">
        <div className="filter-bar">
          <svg
            className="filter-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="filter-input"
            id="searchMatters"
            placeholder="Search matters by title, client, or CNR number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
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
              Clear
            </button>
          )}
        </div>

        <select
          className="status-filter-select"
          aria-label="Filter by matter status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="active">Active</option>
          <option value="on_hold">On Hold</option>
          <option value="closed">Closed</option>
        </select>
      </section>

      {/* Matters Card Grid */}
      <section className="matters-grid" id="mattersGrid" aria-label="Matters List">
        {filteredMatters.map((matter) => {
          const isCurrentActive = matter.id === activeMatterId;
          const showLastUsed = matter.lastUsed || isCurrentActive;

          return (
            <article
              key={matter.id}
              className={`matter-card ${isCurrentActive ? 'active-card' : ''}`}
              onClick={() => handleSelectMatter(matter)}
              tabIndex={0}
              role="button"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSelectMatter(matter);
                }
              }}
            >
              <div className="matter-card-top">
                <span className="status-badge">
                  <span className={`status-dot ${matter.status}`} />
                  {formatStatus(matter.status)}
                </span>
                {showLastUsed && (
                  <span className="last-used-tag">⏱ Last used</span>
                )}
              </div>

              <div>
                <h2 className="matter-title">{matter.title}</h2>
                <p className="matter-meta">
                  Lead: {matter.leadCounsel} · Opened {matter.openedAt}
                  {matter.isPrivate && ' · Private'}
                </p>
              </div>

              <div className="matter-card-bottom">
                <div className="user-avatar-tag">
                  <div className="avatar-circle">
                    {getInitials(matter.leadCounsel)}
                  </div>
                  <span>{matter.leadCounsel}</span>
                </div>
                <div className="team-pill" title={matter.teamName}>
                  <span>●</span>
                  <span>{matter.teamName}</span>
                </div>
              </div>
            </article>
          );
        })}

        {filteredMatters.length === 0 && (
          <div className="empty-matters-state" style={{ gridColumn: '1 / -1' }}>
            <p style={{ fontSize: '15px', color: 'var(--ink)' }}>No matters found matching your search</p>
            <p style={{ fontSize: '13px' }}>Try adjusting your query or create a new matter to begin.</p>
            <button
              type="button"
              className="btn-org btn-org-primary"
              style={{ marginTop: '8px' }}
              onClick={() => setIsMatterModalOpen(true)}
            >
              + Create New Matter
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
        onTeamCreated={() => {
          // Re-open matter modal so user can immediately file their matter into the newly created team
          setIsMatterModalOpen(true);
        }}
      />
    </div>
  );
}
