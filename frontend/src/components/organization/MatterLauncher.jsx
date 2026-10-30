import React, { useState, useMemo, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrganizationStore } from '../../stores/useOrganizationStore';
import { useOrganization, useMatterDetail } from '../../hooks/useOrganization';
import { AuthContext } from '../../context/AuthContext';
import NewMatterModal from './NewMatterModal';
import NewTeamModal from './NewTeamModal';
import AssignTeamModal from './AssignTeamModal';
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
  const authCtx = useContext(AuthContext);
  const user = authCtx?.user;

  const { teams, matters, loading, createMatter, createTeam, assignMatterToTeam, refresh } = useOrganization();
  const activeMatterId = useOrganizationStore((state) => state.activeMatterId);
  const setActiveMatter = useOrganizationStore((state) => state.setActiveMatter);

  // Only the active matter's own deadlines/tasks are fetched in detail —
  // for the hero banner's "N deadlines need attention" line — rather than
  // pulling every matter's full detail just to render the lightweight list.
  const { matter: activeMatterDetail } = useMatterDetail(activeMatterId);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedTeamTab, setSelectedTeamTab] = useState('all');
  const [isMatterModalOpen, setIsMatterModalOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [assignTeamMatterId, setAssignTeamMatterId] = useState(null);

  const firstName = user?.name ? user.name.trim().split(/\s+/)[0] : 'Narendar';
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

  const formattedTodayDate = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
    } catch {
      return '';
    }
  }, []);

  const activeMatter = useMemo(() => matters.find((m) => m.id === activeMatterId) || matters[0], [matters, activeMatterId]);
  const activeTeam = useMemo(() => teams.find((t) => t.id === activeMatter?.team_id), [teams, activeMatter]);

  const urgentDeadlinesCount = activeMatterDetail ? (activeMatterDetail.deadlines?.length ?? 0) : 0;
  const openTasksCount = activeMatterDetail ? 0 : 0; // detail hook doesn't expose task rollups here; kept simple

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filteredMatters = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    return matters.filter((m) => {
      if (selectedTeamTab === 'unassigned') {
        if (m.team_id !== null) return false;
      } else if (selectedTeamTab !== 'all' && m.team_id !== selectedTeamTab) {
        return false;
      }
      if (q) {
        const titleMatch = m.title?.toLowerCase().includes(q);
        const counselMatch = m.lead_counsel?.toLowerCase().includes(q);
        if (!titleMatch && !counselMatch) return false;
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
    return t ? t.name : null;
  };

  const unassignedCount = matters.filter((m) => m.team_id === null).length;

  return (
    <div className="org-gateway-container">
      {/* ── PERSONALIZED HERO BANNER (HOME) ──────────────────────────────── */}
      <section className="hero" aria-label="Home Hero Banner">
        <div className="hero-eyebrow">
          {Icons.gateway}
          HOME · <span id="todayDate">{formattedTodayDate}</span>
        </div>
        <h1 className="hero-title serif">
          Good {timeOfDay}, <span className="accent-word">{firstName}</span>.
        </h1>
        <p className="hero-sub">
          {activeMatter ? (
            <>You're working inside <strong>{activeMatter.title}</strong>.
              {urgentDeadlinesCount > 0 && (
                <> <strong>{urgentDeadlinesCount}</strong> deadline{urgentDeadlinesCount !== 1 ? 's' : ''} need{urgentDeadlinesCount === 1 ? 's' : ''} attention this week.</>
              )}
            </>
          ) : (
            'Choose a matter below to get started.'
          )}
        </p>
      </section>

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
          <button type="button" className="btn-org btn-org-secondary" onClick={() => setIsTeamModalOpen(true)} id="btnOpenNewTeam">
            {Icons.team}
            New team
          </button>
          <button type="button" className="btn-org btn-org-primary" onClick={() => setIsMatterModalOpen(true)} id="btnOpenNewMatter">
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
              <button type="button" onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '12px' }}>
                ✕
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }} role="tablist" aria-label="Filter matters by team">
          <button
            type="button"
            className={`btn-org ${selectedTeamTab === 'all' ? 'btn-org-primary' : 'btn-org-secondary'}`}
            style={{ padding: '6px 14px', fontSize: '12px', borderRadius: '20px' }}
            onClick={() => setSelectedTeamTab('all')}
          >
            All Teams ({matters.length})
          </button>

          {teams.map((team) => {
            const count = matters.filter((m) => m.team_id === team.id).length;
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

          {/* "Unassigned" tab — Home Gateway v4: matters no longer have to
              belong to a team, so this surfaces the ones that don't. */}
          <button
            type="button"
            className={`btn-org ${selectedTeamTab === 'unassigned' ? 'btn-org-primary' : 'btn-org-secondary'}`}
            style={{ padding: '6px 14px', fontSize: '12px', borderRadius: '20px', whiteSpace: 'nowrap' }}
            onClick={() => setSelectedTeamTab('unassigned')}
          >
            Unassigned ({unassignedCount})
          </button>
        </div>
      </section>

      {/* Dynamic Matter Grid */}
      {loading ? (
        <div style={{ padding: '24px', color: 'var(--muted)', fontSize: '13px' }}>Loading matters…</div>
      ) : (
      <section className="matters-grid" id="mattersGrid" aria-label="Matters Grid">
        {filteredMatters.map((matter) => {
          const isCurrentActive = matter.id === activeMatterId;
          const statusText = matter.status ? matter.status.charAt(0).toUpperCase() + matter.status.slice(1) : 'Open';
          const teamName = getTeamName(matter.team_id);

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
                  Lead: {matter.lead_counsel || 'Narendar V'} · Opened {matter.opened_date}
                </p>
              </div>

              <div className="matter-card-bottom">
                <div className="user-avatar-tag">
                  <div className="avatar-circle">NV</div>
                  <span>{matter.lead_counsel || 'Narendar V'}</span>
                </div>
                {teamName ? (
                  <div className="team-pill" title={teamName}>
                    <span>●</span>
                    <span>{teamName}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="team-chip-btn"
                    style={{ padding: '3px 9px', fontSize: '10px' }}
                    onClick={(e) => { e.stopPropagation(); setAssignTeamMatterId(matter.id); }}
                  >
                    + Add to team
                  </button>
                )}
              </div>
            </article>
          );
        })}

        {filteredMatters.length === 0 && (
          <div className="empty-matters-state" style={{ gridColumn: '1 / -1' }}>
            <p style={{ fontSize: '15px', color: 'var(--ink)' }}>No matters found matching your search</p>
            <p style={{ fontSize: '13px' }}>Create a new matter or adjust your team tab filter to proceed.</p>
            <button type="button" className="btn-org btn-org-primary" style={{ marginTop: '8px' }} onClick={() => setIsMatterModalOpen(true)}>
              {Icons.plus} Create New Matter
            </button>
          </div>
        )}
      </section>
      )}

      {/* Modals via React Portal */}
      <NewMatterModal
        isOpen={isMatterModalOpen}
        teams={teams}
        onClose={() => setIsMatterModalOpen(false)}
        onOpenNewTeam={() => {
          setIsMatterModalOpen(false);
          setIsTeamModalOpen(true);
        }}
        onCreate={async (title, teamId) => {
          const newMatter = await createMatter(title, teamId);
          setActiveMatter(newMatter.id);
          return newMatter;
        }}
      />

      <NewTeamModal
        isOpen={isTeamModalOpen}
        onClose={() => setIsTeamModalOpen(false)}
        onCreate={createTeam}
      />

      <AssignTeamModal
        isOpen={!!assignTeamMatterId}
        matterId={assignTeamMatterId}
        matterTitle={matters.find((m) => m.id === assignTeamMatterId)?.title}
        teams={teams.map((t) => ({ ...t, matterCount: matters.filter((m) => m.team_id === t.id).length }))}
        onClose={() => setAssignTeamMatterId(null)}
        onAssign={async (teamId) => {
          await assignMatterToTeam(assignTeamMatterId, teamId);
          setAssignTeamMatterId(null);
        }}
        onCreateTeam={createTeam}
      />
    </div>
  );
}
