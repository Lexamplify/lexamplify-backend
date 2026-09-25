import React, { useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useOrganizationStore } from '../../stores/useOrganizationStore';
import { useOrganization } from '../../hooks/useOrganization';
import './organization.css';

// Modern vector icons (zero emojis)
const Icons = {
  userPlus: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
    </svg>
  ),
  folder: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  book: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  arrowRight: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
};

export default function TeamDashboard() {
  const { teamId } = useParams();
  const navigate = useNavigate();

  const organization = useOrganizationStore((state) => state.organization);
  const setActiveTeam = useOrganizationStore((state) => state.setActiveTeam);
  const setActiveMatter = useOrganizationStore((state) => state.setActiveMatter);
  const { teams, matters } = useOrganization();
  const numericTeamId = teamId ? Number(teamId) : null;

  // Synchronize route params: on mount or URL change, set active team in store
  useEffect(() => {
    if (numericTeamId) {
      setActiveTeam(numericTeamId);
    }
  }, [numericTeamId, setActiveTeam]);

  const team = useMemo(() => {
    return teams.find((t) => t.id === numericTeamId) || teams[0];
  }, [teams, numericTeamId]);

  const teamMatters = useMemo(() => {
    if (!team) return [];
    return matters.filter((m) => m.team_id === team.id);
  }, [matters, team]);

  // Guarded Team Performance Bar Calculations
  const total = teamMatters.length;
  const openCount = teamMatters.filter((m) => m.status === 'open').length;
  const activeCount = teamMatters.filter((m) => m.status === 'active').length;
  const holdCount = teamMatters.filter((m) => m.status === 'on_hold').length;
  const closedCount = teamMatters.filter((m) => m.status === 'closed').length;

  const openPct = total === 0 ? 0 : Math.round((openCount / total) * 100);
  const activePct = total === 0 ? 0 : Math.round((activeCount / total) * 100);
  const holdPct = total === 0 ? 0 : Math.round((holdCount / total) * 100);
  const closedPct = total === 0 ? 0 : Math.round((closedCount / total) * 100);

  // 4 Metrics Tiles
  const totalSharedFiles = teamMatters.reduce((acc, m) => acc + (m.documents ? m.documents.length : 0), 0);
  const totalOpenTasks = teamMatters.reduce((acc, m) => acc + (m.tasks ? m.tasks.filter((t) => !t.completed).length : 0), 0);
  const teamAiRuns = Math.round(organization.totalAiRuns30d / Math.max(teams.length, 1));

  if (!team) {
    return (
      <div className="org-gateway-container">
        <div className="org-workspace-banner">
          <p>Team not found.</p>
          <Link to="/workspace/matters" className="btn-org btn-org-primary">
            Return to Gateway
          </Link>
        </div>
      </div>
    );
  }

  const teamInitial = team.name ? team.name.trim().charAt(0).toUpperCase() : 'T';

  const handleMatterRowClick = (mId) => {
    setActiveMatter(mId);
    navigate(`/workspace/matter/${mId}`);
  };

  return (
    <div className="org-gateway-container">
      {/* ── TEAM HEADER ──────────────────────────────────────────────────── */}
      <section style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '8px' }} aria-label="Team Header">
        <div>
          <div className="eyebrow">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
            </svg>
            TEAM WORKSPACE
          </div>
          <h1 className="page-title serif" style={{ fontSize: '28px', margin: '6px 0 0' }}>{team.name}</h1>
          <p className="page-sub" style={{ fontSize: '13px', color: 'var(--ink-soft)', marginTop: '7px' }}>
            {team.description}
          </p>
        </div>

        <button
          type="button"
          className="btn-org btn-org-primary"
          disabled
          title="Real invites aren't wired yet — this is a placeholder, not a working feature."
          style={{ opacity: 0.55, cursor: 'not-allowed' }}
        >
          {Icons.userPlus}
          Invite user
        </button>
      </section>

      {/* ── 4 METRICS TILES ──────────────────────────────────────────────── */}
      <section className="metric-grid" aria-label="Team Metrics">
        <div className="metric-tile">
          <span className="metric-label">Members</span>
          <span className="metric-value">1</span>
          <span className="metric-sub">Owner only for now</span>
        </div>

        <div className="metric-tile">
          <span className="metric-label">Open matters</span>
          <span className="metric-value">{openCount}</span>
          <span className="metric-sub">of {total} total</span>
        </div>

        <div className="metric-tile">
          <span className="metric-label">On hold</span>
          <span className="metric-value">{holdCount}</span>
          <span className="metric-sub">status === 'on_hold'</span>
        </div>

        <div className="metric-tile">
          <span className="metric-value" style={{ fontSize: '13px' }}>{team.is_private ? 'Private' : 'Shared'}</span>
          <span className="metric-label" style={{ marginTop: '2px' }}>Visibility</span>
          <span className="metric-sub">{team.is_private ? 'Confidential' : 'Open to org'}</span>
        </div>
      </section>

      {/* ── GUARDED TEAM PERFORMANCE BAR ─────────────────────────────────── */}
      <section className="org-widget-card" aria-label="Team Performance Posture">
        <div className="org-widget-header">
          <h2 className="org-widget-title">Practice Posture & Matter Pipeline</h2>
          <span className="org-role-chip" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {total} Total Matter{total !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="org-perf-bar-wrapper">
          <div className="org-perf-bar" title={`Open: ${openPct}%, Active: ${activePct}%, On Hold: ${holdPct}%, Closed: ${closedPct}%`}>
            {openPct > 0 && <div className="org-perf-seg open" style={{ width: `${openPct}%` }} />}
            {activePct > 0 && <div className="org-perf-seg active" style={{ width: `${activePct}%` }} />}
            {holdPct > 0 && <div className="org-perf-seg hold" style={{ width: `${holdPct}%` }} />}
            {closedPct > 0 && <div className="org-perf-seg closed" style={{ width: `${closedPct}%` }} />}
          </div>

          <div className="org-perf-chips">
            <span className="org-status-chip">
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)' }} />
              Open: {openCount} ({openPct}%)
            </span>
            <span className="org-status-chip">
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--major)' }} />
              Active: {activeCount} ({activePct}%)
            </span>
            <span className="org-status-chip">
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--muted-2)' }} />
              On hold: {holdCount} ({holdPct}%)
            </span>
            <span className="org-status-chip">
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--muted)' }} />
              Closed: {closedCount} ({closedPct}%)
            </span>
          </div>
        </div>
      </section>

      {/* ── TEAM MATTERS ROSTER ──────────────────────────────────────────── */}
      <section className="org-widget-card" aria-label="Team Matters Roster">
        <div className="org-widget-header">
          <h2 className="org-widget-title">Active Practice Roster</h2>
          <button
            type="button"
            className="btn-org btn-org-primary org-btn-sm"
            onClick={() => navigate('/workspace/matters')}
          >
            + Register New Matter
          </button>
        </div>

        <div className="org-table-wrapper">
          <table className="org-table">
            <thead>
              <tr>
                <th>Matter Caption</th>
                <th>Status</th>
                <th>Lead Counsel</th>
                <th>Opened</th>
                <th>Dossiers</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {teamMatters.map((m) => (
                <tr
                  key={m.id}
                  className="org-table-row"
                  onClick={() => handleMatterRowClick(m.id)}
                >
                  <td style={{ fontWeight: 600 }}>
                    {m.title}
                  </td>
                  <td>
                    <span className="org-chip-status">
                      {m.status ? m.status.charAt(0).toUpperCase() + m.status.slice(1) : 'Open'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--ink-soft)' }}>{m.lead_counsel || 'Narendar V'}</td>
                  <td style={{ fontSize: '11px', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {m.opened_date}
                  </td>
                  <td style={{ fontSize: '11px', fontVariantNumeric: 'tabular-nums' }}>
                    —
                  </td>
                  <td>
                    <span style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600 }}>
                      Open {Icons.arrowRight}
                    </span>
                  </td>
                </tr>
              ))}

              {teamMatters.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--muted)' }}>
                    No matters filed in this team workspace yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── MEMBER ROSTER & SHARED REFERENCE LIBRARY ─────────────────────── */}
      <div className="org-collaborative-grid">
        {/* Members */}
        <div className="org-widget-card">
          <div className="org-widget-header">
            <h2 className="org-widget-title">Practice Group Practitioners</h2>
            <span className="org-role-chip">1 Active</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="org-people-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div className="org-avatar-badge">NV</div>
                <div>
                  <div style={{ fontWeight: 600 }}>Narendar V</div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Lead Practice Partner</div>
                </div>
              </div>
              <span className="org-role-chip" style={{ color: 'var(--accent)' }}>Owner</span>
            </div>

            <div className="org-people-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div className="org-avatar-badge" style={{ background: 'var(--paper)', borderColor: 'var(--rule)', color: 'var(--ink-soft)' }}>
                  KP
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>K. Parameshwar</div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Advocate on Record (AoR)</div>
                </div>
              </div>
              <span className="org-role-chip">Admin</span>
            </div>
          </div>
        </div>

        {/* Shared Library */}
        <div className="org-widget-card">
          <div className="org-widget-header">
            <h2 className="org-widget-title">Shared Practice Precedents</h2>
            <span className="org-role-chip">Repository</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="org-doc-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--accent)' }}>{Icons.book}</span>
                <span style={{ fontWeight: 500 }}>Commercial Appellate Bench Standard Playbook</span>
              </div>
              <span className="org-doc-meta">v3.2 · Master</span>
            </div>

            <div className="org-doc-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--accent)' }}>{Icons.folder}</span>
                <span style={{ fontWeight: 500 }}>Model Vakalatnama & Urgency Applications</span>
              </div>
              <span className="org-doc-meta">Shared · High Court</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
