import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useOrganizationStore } from '../../stores/useOrganizationStore';
import './organization.css';

// Modern, high-craft vector icons (zero stock emojis)
const Icons = {
  briefcase: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
  contract: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" />
    </svg>
  ),
  draft: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  courtroom: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" />
    </svg>
  ),
  shield: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  plus: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  file: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  arrowRight: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  ),
};

export default function MatterDashboard() {
  const { matterId } = useParams();
  const navigate = useNavigate();

  const matters = useOrganizationStore((state) => state.matters);
  const teams = useOrganizationStore((state) => state.teams);
  const setActiveMatter = useOrganizationStore((state) => state.setActiveMatter);
  const addTask = useOrganizationStore((state) => state.addTask);
  const toggleTask = useOrganizationStore((state) => state.toggleTask);
  const addDeadline = useOrganizationStore((state) => state.addDeadline);

  // Two-way synchronization: on mount or URL change, set active matter in store
  useEffect(() => {
    if (matterId) {
      setActiveMatter(matterId);
    }
  }, [matterId, setActiveMatter]);

  const matter = useMemo(() => {
    return matters.find((m) => m.id === matterId) || matters[0];
  }, [matters, matterId]);

  const team = useMemo(() => {
    if (!matter) return teams[0];
    return teams.find((t) => t.id === matter.teamId) || teams[0];
  }, [teams, matter]);

  // Form states
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newDeadlineTitle, setNewDeadlineTitle] = useState('');
  const [newDeadlineDate, setNewDeadlineDate] = useState('');
  const [chatNotes, setChatNotes] = useState([
    { id: 'cn_1', author: 'Narendar V', text: 'Reviewed initial pleadings; scheduling chamber review.', time: '2h ago' },
  ]);
  const [newChatNote, setNewChatNote] = useState('');

  if (!matter) {
    return (
      <div className="org-gateway-container">
        <div className="org-workspace-banner">
          <p>Matter not found.</p>
          <Link to="/workspace/matters" className="btn-org btn-org-primary">
            Return to Gateway
          </Link>
        </div>
      </div>
    );
  }

  // 5 Dynamic Metrics
  const docCount = matter.documents ? matter.documents.length : 0;
  const openTasksCount = matter.tasks ? matter.tasks.filter((t) => !t.completed).length : 0;
  const deadlinesCount = matter.deadlines ? matter.deadlines.length : 0;
  const hoursLoggedFormatted = matter.hoursLogged != null ? `${matter.hoursLogged.toFixed(1)}h billable` : '0.0h billable';

  const handleAddTask = (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    addTask(matter.id, newTaskTitle.trim());
    setNewTaskTitle('');
  };

  const handleAddDeadline = (e) => {
    e.preventDefault();
    if (!newDeadlineTitle.trim()) return;
    addDeadline(matter.id, {
      title: newDeadlineTitle.trim(),
      date: newDeadlineDate || '2026-10-05',
      urgency: 'urgent',
    });
    setNewDeadlineTitle('');
    setNewDeadlineDate('');
  };

  const handleAddChatNote = (e) => {
    e.preventDefault();
    if (!newChatNote.trim()) return;
    setChatNotes((prev) => [
      ...prev,
      { id: `cn_${Date.now()}`, author: 'Narendar V', text: newChatNote.trim(), time: 'Just now' },
    ]);
    setNewChatNote('');
  };

  return (
    <div className="org-gateway-container">
      {/* ── MATTER WORKSPACE HEADER ───────────────────────────────────────── */}
      <section style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '8px' }} aria-label="Matter Header">
        <div>
          <div className="eyebrow">
            {Icons.briefcase}
            MATTER WORKSPACE
          </div>
          <h1 className="page-title serif" style={{ fontSize: '28px', margin: '6px 0 0' }}>{matter.title}</h1>
          <p className="page-sub" style={{ fontSize: '13px', color: 'var(--ink-soft)', marginTop: '7px' }}>
            {matter.status ? matter.status.charAt(0).toUpperCase() + matter.status.slice(1) : 'Open'} · {team?.name || 'My Chambers'} · Lead counsel {matter.leadCounsel || 'Narendar V'} · Opened {matter.openedAt || 'Sep 13, 2026'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn-org btn-org-secondary"
            onClick={() => navigate(`/workspace/team/${team?.id}`)}
          >
            Open Team Hub
          </button>
          <button
            type="button"
            className="btn-org btn-org-primary"
            onClick={() => navigate('/workspace/matters')}
          >
            Gateway Launchpad
          </button>
        </div>
      </section>

      {/* ── MODULE QUICK DOCK ────────────────────────────────────────────── */}
      <section className="quick-dock" aria-label="Module Quick Dock">
        <button
          type="button"
          className="qd-item"
          onClick={() => navigate(`/contract-analyzer?matterId=${matter.id}`)}
          title="Contract Analyzer for this matter"
        >
          {Icons.contract}
          <span>Contract Analyzer</span>
        </button>

        <button
          type="button"
          className="qd-item"
          onClick={() => navigate(`/auto-draft?matterId=${matter.id}`)}
          title="Auto-Draft Studio for this matter"
        >
          {Icons.draft}
          <span>Auto-Draft Studio</span>
        </button>

        <button
          type="button"
          className="qd-item"
          onClick={() => navigate(`/war-room?matterId=${matter.id}`)}
          title="Virtual Courtroom simulation for this matter"
        >
          {Icons.courtroom}
          <span>Virtual Courtroom</span>
        </button>

        <button
          type="button"
          className="qd-item"
          onClick={() => navigate(`/conflict-engine?matterId=${matter.id}`)}
          title="Conflict Engine for this matter"
        >
          {Icons.shield}
          <span>Conflict Engine</span>
        </button>
      </section>

      {/* ── 4 DYNAMIC METRICS ─────────────────────────────────────────────── */}
      <section className="metric-grid" aria-label="Matter Metrics">
        <div className="metric-tile">
          <span className="metric-label">Documents</span>
          <span className="metric-value">{docCount}</span>
          <span className="metric-sub">in Case Vault</span>
        </div>

        <div className="metric-tile">
          <span className="metric-label">Open tasks</span>
          <span className="metric-value">{openTasksCount}</span>
          <span className="metric-sub">of {matter.tasks ? matter.tasks.length : 0} total</span>
        </div>

        <div className="metric-tile">
          <span className="metric-label">Deadlines</span>
          <span className="metric-value">{deadlinesCount}</span>
          <span className="metric-sub">
            next: {matter.deadlines && matter.deadlines.length > 0 ? (matter.deadlines[0].date || matter.deadlines[0].title) : 'none'}
          </span>
        </div>

        <div className="metric-tile">
          <span className="metric-label">Hours logged</span>
          <span className="metric-value muted-val">Not tracked yet</span>
          <span className="metric-sub">no time-entry feature exists</span>
        </div>
      </section>

      {/* ── TWO-COLUMN COLLABORATIVE GRID ────────────────────────────────── */}
      <div className="org-collaborative-grid">
        {/* Left Column: Deadlines, Tasks, Activity */}
        <div className="org-grid-col">
          {/* Deadlines Widget */}
          <div className="org-widget-card">
            <div className="org-widget-header">
              <h2 className="org-widget-title">Limitation & Deadlines</h2>
              <span className="org-role-chip">{matter.deadlines?.length || 0} Listed</span>
            </div>

            <div className="org-deadline-list">
              {matter.deadlines && matter.deadlines.map((d) => (
                <div key={d.id} className="org-deadline-item">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontWeight: 600 }}>{d.title}</span>
                    <span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: "'IBM Plex Mono', monospace" }}>
                      Target: {d.date}
                    </span>
                  </div>
                  <span className="org-badge-urgent">{d.urgency || 'urgent'}</span>
                </div>
              ))}

              {(!matter.deadlines || matter.deadlines.length === 0) && (
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>No limitation dates recorded yet.</div>
              )}
            </div>

            {/* Inline Add Deadline */}
            <form onSubmit={handleAddDeadline} className="org-inline-form">
              <input
                type="text"
                className="org-inline-input"
                placeholder="New deadline title..."
                value={newDeadlineTitle}
                onChange={(e) => setNewDeadlineTitle(e.target.value)}
              />
              <input
                type="date"
                className="org-inline-input"
                style={{ maxWidth: '130px' }}
                value={newDeadlineDate}
                onChange={(e) => setNewDeadlineDate(e.target.value)}
              />
              <button type="submit" className="btn-org btn-org-secondary org-btn-sm">
                {Icons.plus} Add
              </button>
            </form>
          </div>

          {/* Open Tasks Widget */}
          <div className="org-widget-card">
            <div className="org-widget-header">
              <h2 className="org-widget-title">Action Items & Tasks</h2>
              <span className="org-role-chip">{openTasksCount} Pending</span>
            </div>

            <div className="org-task-list">
              {matter.tasks && matter.tasks.map((t) => (
                <div
                  key={t.id}
                  className="org-task-item"
                  onClick={() => toggleTask(matter.id, t.id)}
                >
                  <input
                    type="checkbox"
                    className="org-task-checkbox"
                    checked={Boolean(t.completed)}
                    onChange={() => {}} // toggled on item click
                  />
                  <span className={`org-task-text ${t.completed ? 'completed' : ''}`}>
                    {t.title}
                  </span>
                </div>
              ))}

              {(!matter.tasks || matter.tasks.length === 0) && (
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>All tasks completed.</div>
              )}
            </div>

            {/* Inline Add Task */}
            <form onSubmit={handleAddTask} className="org-inline-form">
              <input
                type="text"
                className="org-inline-input"
                placeholder="Add an action item or task..."
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
              />
              <button type="submit" className="btn-org btn-org-primary org-btn-sm">
                {Icons.plus} Add task
              </button>
            </form>
          </div>

          {/* Litigation Detail Widget */}
          <div className="card">
            <div className="card-head">
              <span className="card-title">Litigation detail</span>
              <span className="org-role-chip" style={{ fontSize: '10.5px' }}>eCourts</span>
            </div>
            <div className="empty-note">
              Forum, eCourts sync, and conflict-integrity data aren't available for this matter yet — these fields exist on the record (<code className="inline">forum</code>, <code className="inline">ecourtsSync</code>, <code className="inline">integrity</code>) but stay <code className="inline">null</code>, and the UI, until a real matter has them. Never fill this with placeholder legal detail.
            </div>
          </div>

          {/* Recent Activity Widget */}
          <div className="org-widget-card">
            <div className="org-widget-header">
              <h2 className="org-widget-title">Matter Activity Stream</h2>
              <span className="org-role-chip">Audit</span>
            </div>

            <div className="org-activity-list">
              {matter.activity && matter.activity.map((a) => (
                <div key={a.id} className="org-activity-item">
                  <span>{a.text}</span>
                  <span className="org-activity-time">{a.timestamp}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Documents, People, Matter Chat */}
        <div className="org-grid-col">
          {/* Documents Widget */}
          <div className="org-widget-card">
            <div className="org-widget-header">
              <h2 className="org-widget-title">Case Documents</h2>
              <button
                type="button"
                className="btn-org btn-org-secondary org-btn-sm"
                onClick={() => alert('Document ingestion wizard opened.')}
              >
                {Icons.plus} Upload
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {matter.documents && matter.documents.map((doc) => (
                <div key={doc.id} className="org-doc-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: 'var(--accent)' }}>{Icons.file}</span>
                    <span style={{ fontWeight: 500 }}>{doc.name}</span>
                  </div>
                  <span className="org-doc-meta">{doc.size} · {doc.uploadedAt}</span>
                </div>
              ))}

              {(!matter.documents || matter.documents.length === 0) && (
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>No documents uploaded yet.</div>
              )}
            </div>
          </div>

          {/* People Widget */}
          <div className="org-widget-card">
            <div className="org-widget-header">
              <h2 className="org-widget-title">Allocated Counsel</h2>
              <span className="org-role-chip">Chamber</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div className="org-people-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div className="org-avatar-badge">NV</div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{matter.leadCounsel || 'Narendar V'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Lead Counsel / Partner</div>
                  </div>
                </div>
                <span className="org-role-chip" style={{ color: 'var(--accent)' }}>Owner</span>
              </div>
            </div>
          </div>

          {/* Matter Chat Notes Widget */}
          <div className="org-widget-card">
            <div className="org-widget-header">
              <h2 className="org-widget-title">Chamber Handoff Notes</h2>
              <span className="org-role-chip">Internal</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
              {chatNotes.map((note) => (
                <div key={note.id} style={{ background: 'var(--paper-2)', padding: '8px 12px', borderRadius: '6px', fontSize: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', fontSize: '11px', color: 'var(--muted)' }}>
                    <strong>{note.author}</strong>
                    <span>{note.time}</span>
                  </div>
                  <div style={{ color: 'var(--ink)' }}>{note.text}</div>
                </div>
              ))}
            </div>

            <form onSubmit={handleAddChatNote} className="org-inline-form">
              <input
                type="text"
                className="org-inline-input"
                placeholder="Post an internal handover note..."
                value={newChatNote}
                onChange={(e) => setNewChatNote(e.target.value)}
              />
              <button type="submit" className="btn-org btn-org-secondary org-btn-sm">
                Post
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
