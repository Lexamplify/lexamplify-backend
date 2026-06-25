import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import VaultView from './VaultView';
import { renderMarkdown, MARKDOWN_CSS } from '../utils/markdownUtils';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';

// ── Utility: strip ```json ... ``` fences before JSON.parse ─────────────────
const stripCodeFences = (raw) =>
  raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

// ── Utility: format ISO/SQLite date strings ─────────────────────────────────
const fmtDate = (str) => {
  if (!str) return '—';
  try {
    return new Date(str).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return str; }
};

const fmtTime = (str) => {
  if (!str) return '';
  try {
    return new Date(str).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return str; }
};

// ────────────────────────────────────────────────────────────────────────────
const WS_CSS = `
  /* ── WORKSPACE SHELL ─────────────────────────────────────────────── */
  .cw-container {
    height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--font-sans);
    background: var(--bg-dark-app, #0f131a);
  }

  /* ── CASE HEADER ─────────────────────────────────────────────────── */
  .cw-header {
    background: var(--bg-dark-sidebar, #121620);
    border-bottom: 1px solid var(--border-dark-subtle, #2C3241);
    padding: 14px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    flex-shrink: 0;
  }
  .cw-header-left { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .cw-case-title {
    font-size: 17px; font-weight: 700; color: var(--text-dark-primary, #fff);
    margin: 0; line-height: 1.25; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; font-family: var(--font-serif, Georgia, serif);
  }
  .cw-case-subtitle {
    font-size: 12px; color: var(--text-dark-muted, #8F9CAE); margin: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 520px;
  }
  .cw-badges { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .cw-badge-active {
    display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px;
    border-radius: 20px; font-size: 11px; font-weight: 700;
    background: rgba(16,185,129,0.12); color: #10B981;
    border: 1px solid rgba(16,185,129,0.25); letter-spacing: 0.3px; text-transform: uppercase;
  }
  .cw-badge-dot {
    width: 5px; height: 5px; border-radius: 50%; background: #10B981;
    box-shadow: 0 0 5px rgba(16,185,129,0.8); animation: cw-pulse 2s ease-in-out infinite;
  }
  @keyframes cw-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
  .cw-badge-suit {
    display: inline-flex; align-items: center; padding: 4px 11px; border-radius: 20px;
    font-size: 11px; font-weight: 600; background: rgba(59,130,246,0.08); color: #93C5FD;
    border: 1px solid rgba(59,130,246,0.2); letter-spacing: 0.3px; font-family: monospace;
  }

  /* ── TAB BAR ─────────────────────────────────────────────────────── */
  .cw-tab-bar {
    display: flex; align-items: flex-end;
    border-bottom: 1px solid var(--border-dark-subtle, #2C3241);
    background: var(--bg-dark-sidebar, #121620);
    flex-shrink: 0; overflow-x: auto; padding: 0 12px; scrollbar-width: none;
  }
  .cw-tab-bar::-webkit-scrollbar { display: none; }
  .cw-tab-btn {
    background: transparent; border: none; border-bottom: 2px solid transparent;
    color: var(--text-dark-muted, #8F9CAE); padding: 11px 18px; font-size: 13px;
    font-weight: 500; cursor: pointer; white-space: nowrap; margin-bottom: -1px;
    font-family: var(--font-sans); transition: color 0.15s, border-color 0.15s;
    border-radius: 0; letter-spacing: 0.01em;
  }
  .cw-tab-btn:hover { color: var(--text-dark-primary, #fff); }
  .cw-tab-btn.cw-active {
    color: var(--accent-primary, #3B82F6);
    border-bottom-color: var(--accent-primary, #3B82F6); font-weight: 600;
  }

  /* ── CONTENT AREA ────────────────────────────────────────────────── */
  .cw-content {
    flex: 1; overflow-y: auto; overflow-x: hidden;
    background: var(--bg-dark-app, #0f131a);
  }
  .cw-tab-panel { padding: 28px; animation: cw-fade-in 0.22s cubic-bezier(0.16,1,0.3,1); }
  @keyframes cw-fade-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ── SHARED CARD ─────────────────────────────────────────────────── */
  .cw-card {
    background: var(--bg-dark-panel, #171c26);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    border-radius: 12px; overflow: hidden;
  }
  .cw-card-head {
    padding: 14px 20px; border-bottom: 1px solid var(--border-dark-subtle, #2C3241);
    display: flex; align-items: center; justify-content: space-between;
    background: rgba(255,255,255,0.015);
  }
  .cw-card-title {
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.8px; color: var(--text-dark-muted, #8F9CAE); margin: 0;
  }
  .cw-card-body { padding: 20px; }

  /* ── BUTTONS ─────────────────────────────────────────────────────── */
  .cw-btn-primary {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 9px 18px; border-radius: 8px; border: none; cursor: pointer;
    font-size: 13px; font-weight: 600; font-family: var(--font-sans);
    background: var(--accent-primary, #3B82F6); color: white;
    transition: background 0.15s, transform 0.1s;
    box-shadow: 0 2px 8px rgba(59,130,246,0.2);
  }
  .cw-btn-primary:hover:not(:disabled) { background: #2563EB; transform: translateY(-1px); }
  .cw-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
  .cw-btn-ghost {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 13px; border-radius: 7px; cursor: pointer;
    font-size: 12px; font-weight: 600; font-family: var(--font-sans);
    background: transparent; color: var(--text-dark-muted, #8F9CAE);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    transition: all 0.15s;
  }
  .cw-btn-ghost:hover { border-color: rgba(59,130,246,0.4); color: #93C5FD; }

  /* ── SPINNER / SKELETON ──────────────────────────────────────────── */
  @keyframes cw-spin { to { transform: rotate(360deg); } }
  .cw-spinner {
    width: 20px; height: 20px; border-radius: 50%;
    border: 2.5px solid rgba(59,130,246,0.2); border-top-color: #3B82F6;
    animation: cw-spin 0.75s linear infinite; flex-shrink: 0;
  }
  @keyframes cw-shimmer {
    from { background-position: -400px 0; }
    to   { background-position: 400px 0; }
  }
  .cw-skeleton {
    border-radius: 6px; background: linear-gradient(90deg,
      rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%);
    background-size: 800px 100%;
    animation: cw-shimmer 1.4s infinite;
  }

  /* ── TAB 1: DASHBOARD ────────────────────────────────────────────── */
  .cw-metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 14px; margin-bottom: 24px;
  }
  .cw-metric-card {
    background: var(--bg-dark-panel, #171c26);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    border-radius: 10px; padding: 18px 20px;
    display: flex; flex-direction: column; gap: 6px;
    transition: border-color 0.2s;
  }
  .cw-metric-card:hover { border-color: rgba(59,130,246,0.3); }
  .cw-metric-label {
    font-size: 10.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.6px; color: var(--text-dark-muted, #8F9CAE);
  }
  .cw-metric-value {
    font-size: 28px; font-weight: 800; color: white;
    font-family: var(--font-serif, Georgia, serif); line-height: 1;
  }
  .cw-metric-sub { font-size: 11.5px; color: var(--text-dark-muted, #8F9CAE); }
  .cw-synopsis-output {
    font-size: 14px; line-height: 1.75; color: #CBD5E1;
    background: rgba(59,130,246,0.04);
    border-left: 3px solid #3B82F6; padding: 16px 20px; border-radius: 0 8px 8px 0;
    margin-top: 16px;
  }
  .cw-synopsis-placeholder {
    font-size: 13px; color: var(--text-dark-muted, #8F9CAE); font-style: italic;
    padding: 12px 0; text-align: center;
  }
  .cw-synopsis-error {
    font-size: 13px; color: #F87171; padding: 10px 14px;
    background: rgba(239,68,68,0.07); border-radius: 7px; margin-top: 12px;
  }

  /* ── TAB 2: LEGAL DRAFTS ─────────────────────────────────────────── */
  .cw-draft-list { display: flex; flex-direction: column; gap: 10px; }
  .cw-draft-item {
    background: var(--bg-dark-panel, #171c26);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    border-left: 3px solid #8B5CF6; border-radius: 9px;
    padding: 14px 18px; display: flex; align-items: flex-start;
    justify-content: space-between; gap: 16px;
    transition: border-color 0.2s, background 0.2s;
  }
  .cw-draft-item:hover { background: rgba(139,92,246,0.04); border-color: rgba(139,92,246,0.4); }
  .cw-draft-info { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .cw-draft-type {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
    color: #A78BFA; background: rgba(139,92,246,0.1);
    padding: 2px 7px; border-radius: 4px; display: inline-block; width: fit-content;
  }
  .cw-draft-title {
    font-size: 14px; font-weight: 600; color: white;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cw-draft-date { font-size: 11px; color: var(--text-dark-muted, #8F9CAE); }
  .cw-draft-actions { display: flex; gap: 8px; flex-shrink: 0; align-items: center; }

  /* ── TAB 3: AI PROVENANCE LOG ────────────────────────────────────── */
  .cw-audit-header {
    display: flex; align-items: center; gap: 10px; margin-bottom: 20px;
    padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,.05);
  }
  .cw-audit-badge {
    font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
    padding: 3px 9px; border-radius: 4px; background: rgba(245,158,11,.1);
    border: 1px solid rgba(245,158,11,.22); color: #F59E0B;
  }
  .cw-audit-scope { font-size: 12px; color: #475569; }
  .cw-audit-list { display: flex; flex-direction: column; gap: 12px; }
  .cw-audit-entry {
    border: 1px solid rgba(255,255,255,.06); border-radius: 10px;
    background: rgba(255,255,255,.018); overflow: hidden;
  }
  .cw-audit-entry-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
    padding: 12px 16px; cursor: pointer; transition: background .12s;
    border-bottom: 1px solid transparent;
  }
  .cw-audit-entry-head:hover { background: rgba(255,255,255,.02); }
  .cw-audit-entry.expanded .cw-audit-entry-head { border-bottom-color: rgba(255,255,255,.06); }
  .cw-audit-doc-title { font-size: 13px; font-weight: 600; color: #C8D8E8; }
  .cw-audit-session-title { font-size: 11px; color: #475569; margin-top: 2px; }
  .cw-audit-meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .cw-audit-folder-tag {
    font-size: 10px; padding: 2px 8px; border-radius: 4px;
    background: rgba(59,130,246,.1); border: 1px solid rgba(59,130,246,.2); color: #7EB3F5;
  }
  .cw-audit-ts { font-size: 10.5px; color: #334155; white-space: nowrap; }
  .cw-audit-chevron { color: #334155; transition: transform .15s; flex-shrink: 0; }
  .cw-audit-entry.expanded .cw-audit-chevron { transform: rotate(90deg); }
  .cw-audit-messages { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
  .cw-audit-msg { padding: 9px 12px; border-radius: 7px; font-size: 12.5px; line-height: 1.6; }
  .cw-audit-msg-user { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); color: #94A3B8; align-self: flex-end; max-width: 88%; border-radius: 7px 7px 2px 7px; }
  .cw-audit-msg-assistant { background: rgba(16,185,129,.04); border: 1px solid rgba(16,185,129,.1); color: #6B7F8F; align-self: flex-start; max-width: 94%; border-radius: 7px 7px 7px 2px; }
  .cw-audit-msg-role { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; color: #334155; }
  .cw-audit-msg-user .cw-audit-msg-role { color: #3D5168; }
  .cw-audit-msg-assistant .cw-audit-msg-role { color: #10B981; }

  /* ── TAB 4: TIMELINE ─────────────────────────────────────────────── */
  .cw-timeline { display: flex; flex-direction: column; gap: 0; padding-left: 12px; }
  .cw-tl-item {
    display: flex; gap: 18px; position: relative; padding-bottom: 28px;
  }
  .cw-tl-item:last-child { padding-bottom: 0; }
  .cw-tl-spine {
    display: flex; flex-direction: column; align-items: center; flex-shrink: 0; width: 20px;
  }
  .cw-tl-dot {
    width: 12px; height: 12px; border-radius: 50%;
    background: #3B82F6; border: 2px solid #1D4ED8;
    box-shadow: 0 0 8px rgba(59,130,246,0.45); flex-shrink: 0; z-index: 1;
    margin-top: 3px;
  }
  .cw-tl-line {
    width: 2px; flex: 1; background: rgba(59,130,246,0.15);
    margin-top: 4px; min-height: 28px;
  }
  .cw-tl-item:last-child .cw-tl-line { display: none; }
  .cw-tl-content { flex: 1; padding-bottom: 4px; }
  .cw-tl-date {
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
    color: #93C5FD; margin-bottom: 5px;
  }
  .cw-tl-desc { font-size: 13.5px; color: #E2E8F0; line-height: 1.6; }
  .cw-tl-error {
    font-size: 13px; color: #F87171; padding: 12px 16px;
    background: rgba(239,68,68,0.07); border-radius: 8px; margin-top: 12px;
  }
  .cw-tl-empty {
    text-align: center; padding: 48px 24px; color: var(--text-dark-muted, #8F9CAE);
    font-size: 13.5px;
  }

  /* ── EMPTY STATE ─────────────────────────────────────────────────── */
  .cw-empty-inline {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 260px; padding: 40px 24px; text-align: center;
  }
  .cw-empty-icon { font-size: 32px; margin-bottom: 14px; }
  .cw-empty-title {
    font-size: 15px; font-weight: 700; color: white; margin: 0 0 7px;
    font-family: var(--font-serif, Georgia, serif);
  }
  .cw-empty-msg { font-size: 13px; color: var(--text-dark-muted, #8F9CAE); line-height: 1.6; max-width: 340px; }
`;

// ────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'legal-draft', label: 'Legal Drafts' },
  { id: 'documents', label: 'Documents' },
  { id: 'chats', label: 'Chats' },
  { id: 'events', label: 'Events' },
];

// ── Spinner helper ───────────────────────────────────────────────────────────
function Spinner() {
  return <div className="cw-spinner" />;
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 1: Dashboard
// ────────────────────────────────────────────────────────────────────────────
function DashboardTab({ documents, loadingDocs, apiBase }) {
  const [synopsis, setSynopsis] = useState('');
  const [synopsisLoading, setSynopsisLoading] = useState(false);
  const [synopsisError, setSynopsisError] = useState('');

  const handleGenerateSynopsis = async () => {
    if (!documents.length) return;
    setSynopsisLoading(true);
    setSynopsisError('');
    setSynopsis('');
    const combined = documents.map(d => d.content || '').join('\n\n');
    const truncated = combined.slice(0, 15000);
    const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
    try {
      const res = await fetch(`${apiBase}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          message: `[Document Analysis Mode]\n\nDocuments:\n${truncated}\n\nSummarize the core facts and current status of this case in 3 bullet points. Be concise and professional.`,
        }),
      });
      const data = await res.json();
      setSynopsis(data.response || 'No synopsis generated.');
    } catch {
      setSynopsisError('Failed to generate synopsis. Check your connection and retry.');
    }
    setSynopsisLoading(false);
  };

  // Derived metrics
  const totalDocs = documents.length;
  const latestDate = documents[0]?.created_at ? fmtDate(documents[0].created_at) : '—';
  const uniqueTypes = [...new Set(documents.map(d => d.doc_type).filter(Boolean))].length;
  const draftCount = documents.filter(d =>
    (d.doc_type || '').toLowerCase().includes('draft') ||
    (d.title || '').toLowerCase().includes('draft')
  ).length;

  if (loadingDocs) {
    return (
      <div className="cw-tab-panel">
        <div className="cw-metrics-grid">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="cw-metric-card">
              <div className="cw-skeleton" style={{ height: 13, width: '55%', marginBottom: 10 }} />
              <div className="cw-skeleton" style={{ height: 32, width: '40%' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="cw-tab-panel">
      {/* Metrics */}
      <div className="cw-metrics-grid">
        <div className="cw-metric-card">
          <span className="cw-metric-label">Total Documents</span>
          <span className="cw-metric-value">{totalDocs}</span>
          <span className="cw-metric-sub">in Case Vault</span>
        </div>
        <div className="cw-metric-card">
          <span className="cw-metric-label">Latest Update</span>
          <span className="cw-metric-value" style={{ fontSize: '18px', marginTop: 4 }}>{latestDate}</span>
          <span className="cw-metric-sub">most recent document</span>
        </div>
        <div className="cw-metric-card">
          <span className="cw-metric-label">Document Types</span>
          <span className="cw-metric-value">{uniqueTypes || '—'}</span>
          <span className="cw-metric-sub">distinct categories</span>
        </div>
        <div className="cw-metric-card">
          <span className="cw-metric-label">Drafts Available</span>
          <span className="cw-metric-value">{draftCount}</span>
          <span className="cw-metric-sub">editable documents</span>
        </div>
      </div>

      {/* AI Synopsis */}
      <div className="cw-card">
        <div className="cw-card-head">
          <h3 className="cw-card-title">AI Case Synopsis</h3>
          <button
            className="cw-btn-primary"
            onClick={handleGenerateSynopsis}
            disabled={synopsisLoading || !totalDocs}
          >
            {synopsisLoading ? (
              <><Spinner /> Generating…</>
            ) : (
              <>✦ Generate Synopsis</>
            )}
          </button>
        </div>
        <div className="cw-card-body">
          {synopsisError && <div className="cw-synopsis-error">{synopsisError}</div>}
          {synopsis ? (
            <div
              className="cw-synopsis-output md-body"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(synopsis) }}
            />
          ) : (
            !synopsisLoading && (
              <p className="cw-synopsis-placeholder">
                {totalDocs
                  ? 'Click "Generate Synopsis" to produce an AI-powered case overview from your vault documents.'
                  : 'Upload documents to the vault first to generate a case synopsis.'}
              </p>
            )
          )}
          {synopsisLoading && !synopsis && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              {[1, 2, 3].map(i => (
                <div key={i} className="cw-skeleton" style={{ height: 16, width: `${90 - i * 12}%` }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 2: Legal Drafts
// ────────────────────────────────────────────────────────────────────────────
function LegalDraftsTab({ documents, loadingDocs }) {
  const navigate = useNavigate();

  const drafts = documents.filter(d =>
    (d.doc_type || '').toLowerCase().includes('draft') ||
    (d.title || '').toLowerCase().includes('draft')
  );

  const handleEdit = (doc) => {
    navigate('/analyzer', {
      state: {
        documentData: {
          file_content: doc.content || '',
          document_reference: doc.title || 'Legal Draft',
        },
      },
    });
  };

  const handleDownload = (doc) => {
    const blob = new Blob([doc.content || '(empty)'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(doc.title || 'draft').replace(/[^a-zA-Z0-9_\- ]/g, '')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loadingDocs) {
    return (
      <div className="cw-tab-panel">
        {[0, 1, 2].map(i => (
          <div key={i} className="cw-skeleton" style={{ height: 74, borderRadius: 9, marginBottom: 10 }} />
        ))}
      </div>
    );
  }

  if (!drafts.length) {
    return (
      <div className="cw-tab-panel">
        <div className="cw-empty-inline">
          <div className="cw-empty-icon">📝</div>
          <h2 className="cw-empty-title">No drafts found</h2>
          <p className="cw-empty-msg">
            Documents saved with "Draft" in their title or type will appear here. Use the InzIQ to generate petitions, notices, or agreements.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="cw-tab-panel">
      <p style={{ fontSize: 12.5, color: 'var(--text-dark-muted)', marginBottom: 18 }}>
        {drafts.length} draft{drafts.length !== 1 ? 's' : ''} found in vault
      </p>
      <div className="cw-draft-list">
        {drafts.map(doc => (
          <div key={doc.id} className="cw-draft-item">
            <div className="cw-draft-info">
              <span className="cw-draft-type">{doc.doc_type || 'Draft'}</span>
              <span className="cw-draft-title" title={doc.title}>{doc.title}</span>
              <span className="cw-draft-date">Created {fmtDate(doc.created_at)}</span>
            </div>
            <div className="cw-draft-actions">
              <button className="cw-btn-primary" style={{ padding: '7px 13px', fontSize: 12 }} onClick={() => handleEdit(doc)}>
                ✏️ Edit in Agent
              </button>
              <button className="cw-btn-ghost" onClick={() => handleDownload(doc)}>
                ⬇ Download
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 3: AI Provenance / Audit Trail
// ────────────────────────────────────────────────────────────────────────────
function ChatsTab({ apiBase, folderId }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
    const url = folderId
      ? `${apiBase}/api/vault/audit-trail?folder_id=${folderId}`
      : `${apiBase}/api/vault/audit-trail`;
    fetch(url, { headers: { ...(token && { Authorization: `Bearer ${token}` }) } })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => { setThreads(data.threads || []); setLoading(false); })
      .catch(() => { setError('Could not load audit trail.'); setLoading(false); });
  }, [apiBase, folderId]);

  if (loading) {
    return (
      <div className="cw-tab-panel">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="cw-skeleton" style={{ height: 72, borderRadius: 10, marginBottom: 10 }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="cw-tab-panel">
        <div style={{ color: '#F87171', fontSize: 13, padding: '12px 16px', background: 'rgba(239,68,68,0.07)', borderRadius: 8 }}>{error}</div>
      </div>
    );
  }

  if (!threads.length) {
    return (
      <div className="cw-tab-panel">
        <div className="cw-empty-inline">
          <div className="cw-empty-icon" style={{ fontSize: 28 }}>🔏</div>
          <h2 className="cw-empty-title">No Provenance Records</h2>
          <p className="cw-empty-msg">
            When you save a document to this folder via the InzIQ, the full AI conversation that produced it is recorded here as a tamper-evident audit trail.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="cw-tab-panel">
      <div className="cw-audit-header">
        <span className="cw-audit-badge">Provenance Log</span>
        <span className="cw-audit-scope">
          {folderId ? `${threads.length} record${threads.length !== 1 ? 's' : ''} in this folder` : `${threads.length} record${threads.length !== 1 ? 's' : ''} across all folders`}
          {' · Read-only · Defensibility Log'}
        </span>
      </div>
      <div className="cw-audit-list">
        {threads.map(t => {
          const msgs = t.messages || [];
          const isExpanded = expanded === t.id;
          return (
            <div key={t.id} className={`cw-audit-entry${isExpanded ? ' expanded' : ''}`}>
              <div className="cw-audit-entry-head" onClick={() => setExpanded(isExpanded ? null : t.id)}>
                <div style={{ minWidth: 0 }}>
                  <div className="cw-audit-doc-title">📄 {t.doc_title || 'Document'}</div>
                  <div className="cw-audit-session-title">From: {t.session_title || 'AI Session'}</div>
                </div>
                <div className="cw-audit-meta">
                  {t.folder_name && <span className="cw-audit-folder-tag">📁 {t.folder_name}</span>}
                  <span className="cw-audit-ts">{fmtTime(t.created_at)}</span>
                  <svg className="cw-audit-chevron" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </div>
              {isExpanded && (
                <div className="cw-audit-messages">
                  {msgs.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#334155', fontStyle: 'italic', padding: '4px 0' }}>No message records available.</div>
                  ) : msgs.map((msg, mi) => (
                    <div
                      key={mi}
                      className={`cw-audit-msg ${msg.role === 'user' ? 'cw-audit-msg-user' : 'cw-audit-msg-assistant'}`}
                    >
                      <div className="cw-audit-msg-role">{msg.role === 'user' ? 'Lawyer' : 'AI Counsel'}</div>
                      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{(msg.text || '').slice(0, 800)}{(msg.text || '').length > 800 ? '…' : ''}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 4: Events / AI Timeline
// ────────────────────────────────────────────────────────────────────────────
function EventsTab({ documents, loadingDocs, apiBase }) {
  const [timeline, setTimeline] = useState([]);
  const [timelineLoading, setTlLoading] = useState(false);
  const [timelineError, setTlError] = useState('');

  const handleExtract = async () => {
    if (!documents.length) return;
    setTlLoading(true);
    setTlError('');
    setTimeline([]);
    const combined = documents.map(d => d.content || '').join('\n\n');
    const truncated = combined.slice(0, 15000);
    const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
    try {
      const res = await fetch(`${apiBase}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          message: `Extract all dates, deadlines, and chronological events from this text. Return ONLY a valid JSON array of objects with 'date' and 'description' keys. No explanation, no markdown fences.\n\nText:\n${truncated}`,
        }),
      });
      const data = await res.json();
      const cleaned = stripCodeFences(data.response || '[]');
      const parsed = JSON.parse(cleaned);
      setTimeline(Array.isArray(parsed) ? parsed : []);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        setTlError('No date events were found in the vault documents.');
      }
    } catch (e) {
      setTlError('Failed to parse timeline. The AI response may not be valid JSON. Try again.');
    }
    setTlLoading(false);
  };

  if (loadingDocs) {
    return <div className="cw-tab-panel"><div style={{ display: 'flex', gap: 12, alignItems: 'center', color: 'var(--text-dark-muted)', fontSize: 13 }}><Spinner /> Loading documents…</div></div>;
  }

  return (
    <div className="cw-tab-panel">
      <div className="cw-card" style={{ marginBottom: 24 }}>
        <div className="cw-card-head">
          <h3 className="cw-card-title">AI Date & Event Extractor</h3>
          <button
            className="cw-btn-primary"
            onClick={handleExtract}
            disabled={timelineLoading || !documents.length}
          >
            {timelineLoading ? <><Spinner /> Extracting…</> : '📅 Extract Dates via AI'}
          </button>
        </div>
        <div className="cw-card-body" style={{ paddingTop: 14, paddingBottom: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--text-dark-muted)', margin: 0 }}>
            {documents.length
              ? `Analyzes ${documents.length} vault document${documents.length !== 1 ? 's' : ''} and builds a chronological timeline of every date, deadline, and hearing found.`
              : 'Upload documents to the vault first to extract a timeline.'}
          </p>
        </div>
      </div>

      {timelineError && !timelineLoading && (
        <div className="cw-tl-error">{timelineError}</div>
      )}

      {timelineLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingLeft: 12 }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ display: 'flex', gap: 18 }}>
              <div className="cw-skeleton" style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0, marginTop: 3 }} />
              <div style={{ flex: 1 }}>
                <div className="cw-skeleton" style={{ height: 12, width: '30%', marginBottom: 8 }} />
                <div className="cw-skeleton" style={{ height: 15, width: `${80 - i * 10}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {!timelineLoading && timeline.length > 0 && (
        <div className="cw-timeline">
          {timeline.map((item, i) => (
            <div key={i} className="cw-tl-item">
              <div className="cw-tl-spine">
                <div className="cw-tl-dot" />
                <div className="cw-tl-line" />
              </div>
              <div className="cw-tl-content">
                <div className="cw-tl-date">{item.date || 'Unknown date'}</div>
                <div className="cw-tl-desc">{item.description || '—'}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!timelineLoading && timeline.length === 0 && !timelineError && (
        <div className="cw-tl-empty">
          <div style={{ fontSize: 28, marginBottom: 12 }}>📅</div>
          <div style={{ fontWeight: 600, color: 'var(--text-dark-primary)', marginBottom: 7, fontSize: 15 }}>No timeline generated yet</div>
          <div>Click "Extract Dates via AI" to build a chronological view from your vault documents.</div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ROOT COMPONENT
// ────────────────────────────────────────────────────────────────────────────
export default function CaseWorkspace() {
  const location = useLocation();
  const targetFolderId = location.state?.targetFolderId ?? null;
  const [activeTab, setActiveTab] = useState('documents');
  const [caseInfo, setCaseInfo] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
    fetch(`${API_BASE}/api/vault/documents`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const docs = data?.documents || [];
        setDocuments(docs);
        if (docs.length > 0) {
          setCaseInfo({ title: docs[0].title, docType: docs[0].doc_type, count: docs.length });
        } else {
          setCaseInfo({ title: 'Case Vault', docType: 'No documents yet', count: 0 });
        }
      })
      .catch(() => setCaseInfo({ title: 'Case Vault', docType: 'Vault Overview', count: 0 }))
      .finally(() => setLoadingDocs(false));
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardTab documents={documents} loadingDocs={loadingDocs} apiBase={API_BASE} />;
      case 'legal-draft':
        return <LegalDraftsTab documents={documents} loadingDocs={loadingDocs} />;
      case 'documents':
        return <VaultView targetFolderId={targetFolderId} />;
      case 'chats':
        return <ChatsTab apiBase={API_BASE} folderId={targetFolderId} />;
      case 'events':
        return <EventsTab documents={documents} loadingDocs={loadingDocs} apiBase={API_BASE} />;
      default:
        return null;
    }
  };

  return (
    <>
      <style>{WS_CSS}</style>
      <style>{MARKDOWN_CSS}</style>
      <div className="cw-container">

        {/* ── CASE HEADER ── */}
        <div className="cw-header">
          <div className="cw-header-left">
            <h1 className="cw-case-title">{caseInfo ? caseInfo.title : '—'}</h1>
            <p className="cw-case-subtitle">{caseInfo ? caseInfo.docType : 'Loading case data…'}</p>
          </div>
          <div className="cw-badges">
            <span className="cw-badge-active">
              <span className="cw-badge-dot" />
              Active
            </span>
            <span className="cw-badge-suit">
              {caseInfo != null ? `${caseInfo.count} Document${caseInfo.count !== 1 ? 's' : ''}` : '—'}
            </span>
          </div>
        </div>

        {/* ── TAB BAR ── */}
        <div className="cw-tab-bar" role="tablist">
          {TABS.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`cw-tab-btn${activeTab === tab.id ? ' cw-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── CONTENT ── */}
        <div className="cw-content" role="tabpanel" key={activeTab}>
          {renderContent()}
        </div>

      </div>
    </>
  );
}
