import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useOrganizationStore } from '../../stores/useOrganizationStore';
import './organization.css';

// Modern, high-craft vector icons (zero stock emojis)
const Icons = {
  spark: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </svg>
  ),
  vault: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      <circle cx="12" cy="16" r="1.5" />
    </svg>
  ),
  contract: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  ),
  courtroom: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 21 18 0" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 10v6" /><path d="M15 10v6" />
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
      {/* ── BANNER ───────────────────────────────────────────────────────── */}
      <section className="org-workspace-banner" aria-label="Workspace Greeting Banner">
        <div className="org-banner-greeting">
          Good morning, naren. You're working inside <strong>{team?.name || 'My Private Space'}</strong>.
        </div>

        <div className="org-active-chip-row">
          <div className="org-active-chip">
            <span style={{ color: 'var(--muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Active Matter:
            </span>
            <strong>{matter.title}</strong>
            <span className="org-chip-status">
              {matter.status ? matter.status.charAt(0).toUpperCase() + matter.status.slice(1) : 'Open'}
            </span>
          </div>

          <button
            type="button"
            className="btn-org btn-org-secondary"
            onClick={() => navigate(`/workspace/team/${team?.id}`)}
            style={{ padding: '6px 14px', fontSize: '12px', gap: '6px' }}
          >
            Open Team Hub {Icons.arrowRight}
          </button>
        </div>
      </section>

      {/* ── 5 DYNAMIC METRICS ────────────────────────────────────────────── */}
      <section className="org-metric-grid" aria-label="Matter Metrics">
        <div className="org-metric-tile">
          <span className="org-metric-label">Documents</span>
          <span className="org-metric-value">{docCount}</span>
          <span className="org-metric-sub">Vault dossiers</span>
        </div>

        <div className="org-metric-tile">
          <span className="org-metric-label">Open Tasks</span>
          <span className="org-metric-value">{openTasksCount}</span>
          <span className="org-metric-sub">Action items pending</span>
        </div>

        <div className="org-metric-tile">
          <span className="org-metric-label">Deadlines</span>
          <span className="org-metric-value">{deadlinesCount}</span>
          <span className="org-metric-sub">Limitation dates</span>
        </div>

        <div className="org-metric-tile">
          <span className="org-metric-label">Hours Logged</span>
          <span className="org-metric-value" style={{ fontSize: '22px' }}>{hoursLoggedFormatted}</span>
          <span className="org-metric-sub">Recorded time</span>
        </div>

        <div className="org-metric-tile">
          <span className="org-metric-label">Team</span>
          <span className="org-metric-value">1 member</span>
          <span className="org-metric-sub">Assigned counsel</span>
        </div>
      </section>

      {/* ── MODULE QUICK JUMP BAR ────────────────────────────────────────── */}
      <section className="org-quick-jump-bar" aria-label="Module Quick Jump Bar">
        <span className="org-jump-label">Direct Modules:</span>

        <Link
          to={`/contract-analyzer?tab=ask-ai&matterId=${matter.id}`}
          className="org-jump-btn"
          title="Open AI Legal Assistant for this matter"
        >
          {Icons.spark}
          <span>Ask AI</span>
        </Link>

        <Link
          to={`/vault?matterId=${matter.id}`}
          className="org-jump-btn"
          title="Open Case Vault for this matter"
        >
          {Icons.vault}
          <span>Case Vault</span>
        </Link>

        <Link
          to={`/contract-analyzer?matterId=${matter.id}`}
          className="org-jump-btn"
          title="Scan and analyze contracts for this matter"
        >
          {Icons.contract}
          <span>Contract Analyzer</span>
        </Link>

        <Link
          to={`/war-room?matterId=${matter.id}`}
          className="org-jump-btn"
          title="Open Virtual Courtroom simulation for this matter"
        >
          {Icons.courtroom}
          <span>Virtual Courtroom</span>
        </Link>
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
