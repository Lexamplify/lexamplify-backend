import React, { useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useOrganizationStore } from '../../stores/useOrganizationStore';
import './organization.css';

// Modern, crisp vector icons (zero emojis)
const Icons = {
  users: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  briefcase: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
  spark: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </svg>
  ),
  arrowRight: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
};

export default function OrgDashboard() {
  const navigate = useNavigate();

  const organization = useOrganizationStore((state) => state.organization);
  const teams = useOrganizationStore((state) => state.teams);
  const matters = useOrganizationStore((state) => state.matters);
  const activities = useOrganizationStore((state) => state.activities);

  // Firm Overview Metrics
  const totalPeople = useMemo(() => {
    return teams.reduce((acc, t) => acc + (t.membersCount || 1), 0);
  }, [teams]);

  const openMattersCount = useMemo(() => {
    return matters.filter((m) => m.status === 'open' || m.status === 'active').length;
  }, [matters]);

  return (
    <div className="org-gateway-container">
      {/* ── MASTHEAD ─────────────────────────────────────────────────────── */}
      <section className="launcher-masthead" aria-label="Firm Console Header">
        <div className="masthead-info">
          <div className="eyebrow">
            {Icons.briefcase}
            Executive Console
          </div>
          <h1 className="masthead-title">{organization?.name || 'LexAmplify'}</h1>
          <p className="masthead-desc">
            Enterprise overview of practice groups, matter pipeline, pooled AI consumption, and compliance telemetry.
          </p>
        </div>

        <div className="action-group">
          <Link to="/workspace/matters" className="btn-org btn-org-primary">
            Open Gateway Launchpad
          </Link>
        </div>
      </section>

      {/* ── 4 FIRM OVERVIEW METRICS ──────────────────────────────────────── */}
      <section className="org-metric-grid" aria-label="Firm Overview Metrics">
        <div className="org-metric-tile">
          <span className="org-metric-label">People</span>
          <span className="org-metric-value">{totalPeople}</span>
          <span className="org-metric-sub">Total members across firm</span>
        </div>

        <div className="org-metric-tile">
          <span className="org-metric-label">Teams</span>
          <span className="org-metric-value">{teams.length}</span>
          <span className="org-metric-sub">Active practice groups</span>
        </div>

        <div className="org-metric-tile">
          <span className="org-metric-label">Open Matters</span>
          <span className="org-metric-value">{openMattersCount}</span>
          <span className="org-metric-sub">of {matters.length} total registered</span>
        </div>

        <div className="org-metric-tile">
          <span className="org-metric-label">AI Runs (30D)</span>
          <span className="org-metric-value">{organization?.totalAiRuns30d || 142}</span>
          <span className="org-metric-sub">Firm pooled LLM executions</span>
        </div>
      </section>

      {/* ── TEAMS GRID ───────────────────────────────────────────────────── */}
      <section aria-label="Firm Practice Groups">
        <div className="org-widget-header" style={{ marginBottom: '16px' }}>
          <h2 className="org-widget-title" style={{ fontSize: '22px' }}>
            Practice Groups & Chamber Workspaces
          </h2>
          <span className="org-role-chip">{teams.length} Active Workspaces</span>
        </div>

        <div className="org-teams-grid">
          {teams.map((t) => {
            const teamMatters = matters.filter((m) => m.teamId === t.id);
            const activeMattersCount = teamMatters.filter((m) => m.status === 'open' || m.status === 'active').length;

            return (
              <div key={t.id} className="org-team-summary-card">
                <div className="org-team-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div className="org-team-avatar-box" style={{ width: '38px', height: '38px', fontSize: '18px' }}>
                      {t.name ? t.name.trim().charAt(0).toUpperCase() : 'T'}
                    </div>
                    <div>
                      <h3 className="org-team-card-title">{t.name}</h3>
                      <span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: "'IBM Plex Mono', monospace" }}>
                        {t.isPrivate ? '🔒 Private Workspace' : 'Collaborative Practice'}
                      </span>
                    </div>
                  </div>
                  <span className="org-role-chip">{t.membersCount || 1} members</span>
                </div>

                <p style={{ fontSize: '12.5px', color: 'var(--ink-soft)', lineHeight: '1.4' }}>
                  {t.description}
                </p>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid var(--rule)' }}>
                  <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    <strong>{activeMattersCount}</strong> active / {teamMatters.length} total matters
                  </span>

                  <button
                    type="button"
                    className="org-btn-open-team"
                    onClick={() => navigate(`/workspace/team/${t.id}`)}
                  >
                    Open team {Icons.arrowRight}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── FIRM ACTIVITY STREAM ─────────────────────────────────────────── */}
      <section className="org-widget-card" aria-label="Firm Activity Stream">
        <div className="org-widget-header">
          <h2 className="org-widget-title">Global Chamber Audit Trail</h2>
          <span className="org-role-chip">Chronological Log</span>
        </div>

        <div className="org-activity-list">
          {activities && activities.map((act) => (
            <div key={act.id} className="org-activity-item">
              <div>
                <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{act.text}</span>
              </div>
              <span className="org-activity-time">{act.timestamp}</span>
            </div>
          ))}

          {(!activities || activities.length === 0) && (
            <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '12px 0' }}>
              No recent chamber activities recorded.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
