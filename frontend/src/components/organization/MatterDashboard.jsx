import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useOrganizationStore } from '../../stores/useOrganizationStore';
import { useOrganization, useMatterDetail } from '../../hooks/useOrganization';
import AssignTeamModal from './AssignTeamModal';
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
};

export default function MatterDashboard() {
  const { matterId } = useParams();
  const navigate = useNavigate();
  const numericMatterId = matterId ? Number(matterId) : null;

  const setActiveMatter = useOrganizationStore((state) => state.setActiveMatter);
  const { teams, createTeam, matters } = useOrganization();
  const {
    matter, deadlines, tasks, notes, documents, activity, loading, error,
    addDeadline, addTask, toggleTask, addNote, uploadDocument, assignTeam,
  } = useMatterDetail(numericMatterId);

  useEffect(() => {
    if (numericMatterId) setActiveMatter(numericMatterId);
  }, [numericMatterId, setActiveMatter]);

  const team = teams.find((t) => t.id === matter?.team_id);

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newDeadlineTitle, setNewDeadlineTitle] = useState('');
  const [newDeadlineDate, setNewDeadlineDate] = useState('');
  const [newDeadlineDesc, setNewDeadlineDesc] = useState('');
  const [newNoteText, setNewNoteText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [assignTeamOpen, setAssignTeamOpen] = useState(false);
  const fileInputRef = useRef(null);

  if (loading && !matter) {
    return (
      <div className="org-gateway-container">
        <div style={{ padding: '24px', color: 'var(--muted)', fontSize: '13px' }}>Loading matter…</div>
      </div>
    );
  }

  if (!matter) {
    return (
      <div className="org-gateway-container">
        <div className="org-workspace-banner">
          <p>{error || 'Matter not found.'}</p>
          <Link to="/workspace/matters" className="btn-org btn-org-primary">
            Return to Gateway
          </Link>
        </div>
      </div>
    );
  }

  const openTasksCount = tasks.filter((t) => !t.done).length;
  const nextDeadline = deadlines[0];

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    await addTask(newTaskTitle.trim());
    setNewTaskTitle('');
  };

  const handleAddDeadline = async (e) => {
    e.preventDefault();
    if (!newDeadlineTitle.trim() || !newDeadlineDate) return;
    await addDeadline(newDeadlineTitle.trim(), newDeadlineDate, newDeadlineDesc.trim());
    setNewDeadlineTitle('');
    setNewDeadlineDate('');
    setNewDeadlineDesc('');
  };

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!newNoteText.trim()) return;
    await addNote(newNoteText.trim());
    setNewNoteText('');
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      await uploadDocument(file);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Matter Upload]', err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="org-gateway-container">
      <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt" style={{ display: 'none' }} onChange={handleFileSelected} />

      {/* ── MATTER WORKSPACE HEADER ───────────────────────────────────────── */}
      <section style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '8px' }} aria-label="Matter Header">
        <div>
          <div className="eyebrow">
            {Icons.briefcase}
            MATTER WORKSPACE
          </div>
          <h1 className="page-title serif" style={{ fontSize: '28px', margin: '6px 0 0' }}>{matter.title}</h1>
          <div className="meta-row">
            <div className="meta-chip">
              <span className="org-chip-status">{matter.status ? matter.status.charAt(0).toUpperCase() + matter.status.slice(1) : 'Open'}</span>
            </div>
            <span className="meta-sep">·</span>
            <div className="meta-chip">
              {team ? (
                <span className="team-chip-static">{team.name}</span>
              ) : (
                <button type="button" className="team-chip-btn" onClick={() => setAssignTeamOpen(true)}>+ Add to team</button>
              )}
            </div>
            <span className="meta-sep">·</span>
            <div className="meta-chip">Lead counsel {matter.lead_counsel || 'Narendar V'}</div>
            <span className="meta-sep">·</span>
            <div className="meta-chip">Opened {matter.opened_date}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {team && (
            <button type="button" className="btn-org btn-org-secondary" onClick={() => navigate(`/workspace/team/${team.id}`)}>
              Open Team Hub
            </button>
          )}
          <button type="button" className="btn-org btn-org-primary" onClick={() => navigate('/workspace/matters')}>
            Gateway Launchpad
          </button>
        </div>
      </section>

      {/* ── MODULE QUICK DOCK ────────────────────────────────────────────── */}
      <section className="quick-dock" aria-label="Module Quick Dock">
        <button type="button" className="qd-item" onClick={() => navigate(`/contract-analyzer?matterId=${matter.id}`)} title="Contract Analyzer for this matter">
          {Icons.contract}
          <span>Contract Analyzer</span>
        </button>
        <button type="button" className="qd-item" onClick={() => navigate(`/auto-draft?matterId=${matter.id}`)} title="Auto-Draft Studio for this matter">
          {Icons.draft}
          <span>Auto-Draft Studio</span>
        </button>
        <button type="button" className="qd-item" onClick={() => navigate(`/war-room?matterId=${matter.id}`)} title="Virtual Courtroom simulation for this matter">
          {Icons.courtroom}
          <span>Virtual Courtroom</span>
        </button>
        <button type="button" className="qd-item" onClick={() => navigate(`/conflict-engine?matterId=${matter.id}`)} title="Conflict Engine for this matter">
          {Icons.shield}
          <span>Conflict Engine</span>
        </button>
      </section>

      {/* ── 4 DYNAMIC METRICS ─────────────────────────────────────────────── */}
      <section className="metric-grid" aria-label="Matter Metrics">
        <div className="metric-tile">
          <span className="metric-label">Documents</span>
          <span className="metric-value">{documents.length}</span>
          <span className="metric-sub">in Case Vault</span>
        </div>
        <div className="metric-tile">
          <span className="metric-label">Open tasks</span>
          <span className="metric-value">{openTasksCount}</span>
          <span className="metric-sub">of {tasks.length} total</span>
        </div>
        <div className="metric-tile">
          <span className="metric-label">Deadlines</span>
          <span className="metric-value">{deadlines.length}</span>
          <span className="metric-sub">{nextDeadline ? `next: ${nextDeadline.date}` : 'none yet'}</span>
        </div>
        <div className="metric-tile">
          <span className="metric-label">Hours logged</span>
          <span className="metric-value muted-val">Not tracked yet</span>
          <span className="metric-sub">no time-entry feature exists</span>
        </div>
      </section>

      {/* ── TWO-COLUMN COLLABORATIVE GRID ────────────────────────────────── */}
      <div className="org-collaborative-grid">
        {/* Left Column: Deadlines, Tasks, Litigation detail, Activity */}
        <div className="org-grid-col">
          {/* Deadlines Widget */}
          <div className="org-widget-card">
            <div className="org-widget-header">
              <h2 className="org-widget-title">Limitation & Deadlines</h2>
              <span className="org-role-chip">{deadlines.length} Listed</span>
            </div>

            <div className="org-deadline-list">
              {deadlines.map((d) => (
                <div key={d.id} className="org-deadline-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                      <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {d.title}
                        {!!d.ai_extracted && <span className="ai-tag" style={{ fontSize: '9px', letterSpacing: '.05em', fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '2px 7px', borderRadius: '999px' }}>AI-EXTRACTED</span>}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>Target: {d.date}</span>
                    </div>
                  </div>
                  {d.description && (
                    <div style={{ fontSize: '11.5px', color: 'var(--muted)', lineHeight: 1.5 }}>{d.description}</div>
                  )}
                </div>
              ))}

              {deadlines.length === 0 && (
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>No limitation dates recorded yet.</div>
              )}
            </div>

            {/* Inline Add Deadline — now with a description field (Home Gateway v4 §8.1) */}
            <form onSubmit={handleAddDeadline} className="org-inline-form">
              <div className="inline-form-row" style={{ display: 'flex', gap: '8px' }}>
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
              </div>
              <textarea
                className="org-inline-input"
                style={{ marginTop: '8px', minHeight: '44px', resize: 'vertical', width: '100%' }}
                placeholder="Description — what needs to happen, and why (optional but recommended)"
                value={newDeadlineDesc}
                onChange={(e) => setNewDeadlineDesc(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button type="submit" className="btn-org btn-org-secondary org-btn-sm">
                  {Icons.plus} Add
                </button>
              </div>
            </form>
          </div>

          {/* Open Tasks Widget */}
          <div className="org-widget-card">
            <div className="org-widget-header">
              <h2 className="org-widget-title">Action Items & Tasks</h2>
              <span className="org-role-chip">{openTasksCount} Pending</span>
            </div>

            <div className="org-task-list">
              {tasks.map((t) => (
                <div key={t.id} className="org-task-item" onClick={() => toggleTask(t.id, !t.done)}>
                  <input type="checkbox" className="org-task-checkbox" checked={Boolean(t.done)} onChange={() => {}} />
                  <span className={`org-task-text ${t.done ? 'completed' : ''}`}>{t.title}</span>
                </div>
              ))}
              {tasks.length === 0 && (
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>No tasks yet.</div>
              )}
            </div>

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
              Forum, eCourts sync status, and conflict-integrity checks aren't available for this matter yet — they'll appear here automatically once a real court-record integration is connected.
            </div>
          </div>

          {/* Matter Activity Stream — now the screen's real spine (Home
              Gateway v4 §8.5): every deadline/task/note/upload/team-
              assignment action writes here server-side (see
              routes/matter_routes.py's _log_activity calls). */}
          <div className="org-widget-card">
            <div className="org-widget-header">
              <h2 className="org-widget-title">Matter Activity Stream</h2>
              <span className="org-role-chip">Audit</span>
            </div>
            <div className="org-activity-list">
              {activity.map((a) => (
                <div key={a.id} className="org-activity-item">
                  <span>{a.text}</span>
                  <span className="org-activity-time">{a.created_at}</span>
                </div>
              ))}
              {activity.length === 0 && (
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>No activity recorded yet.</div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Documents, People, Handoff Notes */}
        <div className="org-grid-col">
          {/* Documents Widget — real upload (Home Gateway v4 §8.2), reuses
              Case Vault's existing storage (case_id = 'matter:<id>') */}
          <div className="org-widget-card">
            <div className="org-widget-header">
              <h2 className="org-widget-title">Case Documents</h2>
              <button
                type="button"
                className="btn-org btn-org-secondary org-btn-sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {Icons.plus} {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {documents.map((doc) => (
                <div key={doc.id} className="org-doc-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: 'var(--accent)' }}>{Icons.file}</span>
                    <span style={{ fontWeight: 500 }}>{doc.title}</span>
                  </div>
                  <span className="org-doc-meta">{doc.size_bytes ? `${Math.round(doc.size_bytes / 1024)} KB` : ''}</span>
                </div>
              ))}
              {documents.length === 0 && (
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
                    <div style={{ fontWeight: 600 }}>{matter.lead_counsel || 'Narendar V'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Lead Counsel / Partner</div>
                  </div>
                </div>
                <span className="org-role-chip" style={{ color: 'var(--accent)' }}>Owner</span>
              </div>
            </div>
          </div>

          {/* Chamber Handoff Notes — now persisted server-side (Home
              Gateway v4 §8.4), not local component state lost on
              navigation. */}
          <div className="org-widget-card">
            <div className="org-widget-header">
              <h2 className="org-widget-title">Chamber Handoff Notes</h2>
              <span className="org-role-chip">Internal</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
              {notes.map((note) => (
                <div key={note.id} style={{ background: 'var(--paper-2)', padding: '8px 12px', borderRadius: '6px', fontSize: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', fontSize: '11px', color: 'var(--muted)' }}>
                    <strong>{note.author_name}</strong>
                    <span>{note.created_at}</span>
                  </div>
                  <div style={{ color: 'var(--ink)' }}>{note.text}</div>
                </div>
              ))}
              {notes.length === 0 && (
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>No handoff notes yet — post one for whoever works this matter next.</div>
              )}
            </div>

            <form onSubmit={handleAddNote} className="org-inline-form">
              <input
                type="text"
                className="org-inline-input"
                placeholder="Post an internal handover note..."
                value={newNoteText}
                onChange={(e) => setNewNoteText(e.target.value)}
              />
              <button type="submit" className="btn-org btn-org-secondary org-btn-sm">
                Post
              </button>
            </form>
          </div>
        </div>
      </div>

      <AssignTeamModal
        isOpen={assignTeamOpen}
        matterId={matter.id}
        matterTitle={matter.title}
        teams={teams.map((t) => ({ ...t, matterCount: matters.filter((m) => m.team_id === t.id).length }))}
        onClose={() => setAssignTeamOpen(false)}
        onAssign={async (teamId) => {
          await assignTeam(teamId);
          setAssignTeamOpen(false);
        }}
        onCreateTeam={createTeam}
      />
    </div>
  );
}
