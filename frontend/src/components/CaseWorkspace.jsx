import React, { useState, useEffect } from 'react';
import VaultView from './VaultView';

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
  .cw-header-left {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .cw-case-title {
    font-size: 17px;
    font-weight: 700;
    color: var(--text-dark-primary, #fff);
    margin: 0;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-serif, Georgia, serif);
  }
  .cw-case-subtitle {
    font-size: 12px;
    color: var(--text-dark-muted, #8F9CAE);
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 520px;
  }
  .cw-badges {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .cw-badge-active {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 11px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    background: rgba(16,185,129,0.12);
    color: #10B981;
    border: 1px solid rgba(16,185,129,0.25);
    letter-spacing: 0.3px;
    text-transform: uppercase;
  }
  .cw-badge-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #10B981;
    box-shadow: 0 0 5px rgba(16,185,129,0.8);
    animation: cw-pulse 2s ease-in-out infinite;
  }
  @keyframes cw-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.45; }
  }
  .cw-badge-suit {
    display: inline-flex;
    align-items: center;
    padding: 4px 11px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    background: rgba(59,130,246,0.08);
    color: #93C5FD;
    border: 1px solid rgba(59,130,246,0.2);
    letter-spacing: 0.3px;
    font-family: monospace;
  }

  /* ── TAB BAR ─────────────────────────────────────────────────────── */
  .cw-tab-bar {
    display: flex;
    align-items: flex-end;
    border-bottom: 1px solid var(--border-dark-subtle, #2C3241);
    background: var(--bg-dark-sidebar, #121620);
    flex-shrink: 0;
    overflow-x: auto;
    padding: 0 12px;
    scrollbar-width: none;
  }
  .cw-tab-bar::-webkit-scrollbar { display: none; }

  .cw-tab-btn {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-dark-muted, #8F9CAE);
    padding: 11px 18px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    margin-bottom: -1px;
    font-family: var(--font-sans);
    transition: color 0.15s, border-color 0.15s;
    border-radius: 0;
    letter-spacing: 0.01em;
  }
  .cw-tab-btn:hover {
    color: var(--text-dark-primary, #fff);
  }
  .cw-tab-btn.cw-active {
    color: var(--accent-primary, #3B82F6);
    border-bottom-color: var(--accent-primary, #3B82F6);
    font-weight: 600;
  }

  /* ── CONTENT AREA ────────────────────────────────────────────────── */
  .cw-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--bg-dark-app, #0f131a);
  }

  /* ── EMPTY STATE ─────────────────────────────────────────────────── */
  @keyframes cw-fade-in {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .cw-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 400px;
    padding: 56px 24px;
    text-align: center;
    animation: cw-fade-in 0.28s cubic-bezier(0.16,1,0.3,1) forwards;
  }
  .cw-empty-icon-ring {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: rgba(59,130,246,0.07);
    border: 1.5px solid rgba(59,130,246,0.18);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 30px;
    margin-bottom: 20px;
  }
  .cw-empty-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-dark-primary, #fff);
    margin: 0 0 8px 0;
    font-family: var(--font-serif, Georgia, serif);
  }
  .cw-empty-msg {
    font-size: 13px;
    color: var(--text-dark-muted, #8F9CAE);
    line-height: 1.65;
    max-width: 360px;
    margin: 0 auto;
  }
  .cw-coming-soon {
    margin-top: 20px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 13px;
    border-radius: 20px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    background: rgba(59,130,246,0.07);
    color: #93C5FD;
    border: 1px solid rgba(59,130,246,0.18);
  }
`;

const TABS = [
  { id: 'dashboard',   label: 'Dashboard' },
  { id: 'legal-draft', label: 'Legal draft' },
  { id: 'documents',   label: 'Documents' },
  { id: 'chats',       label: 'Chats' },
  { id: 'events',      label: 'Events' },
];

const EMPTY_STATES = {
  dashboard: {
    icon: '📊',
    title: 'Case Dashboard',
    msg: 'Case-level analytics, timeline views, party profiles, and financial summaries will appear here.',
  },
  'legal-draft': {
    icon: '📝',
    title: 'Drafts folder empty',
    msg: 'No legal drafts for this case yet. Use the Universal Agent to generate petitions, notices, or agreements.',
  },
  chats: {
    icon: '💬',
    title: 'No case chats',
    msg: 'Universal Agent conversations scoped to this matter will be stored here for reference.',
  },
  events: {
    icon: '📅',
    title: 'No upcoming events',
    msg: 'No hearings, deadlines, or court appearances have been scheduled for this case.',
  },
};

export default function CaseWorkspace() {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';
  const [activeTab, setActiveTab] = useState('documents');
  const [caseInfo, setCaseInfo] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
    fetch(`${API_BASE}/api/vault/documents`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const docs = data?.documents || [];
        if (docs.length > 0) {
          const latest = docs[0];
          setCaseInfo({
            title: latest.title || 'Case Vault',
            docType: latest.doc_type || 'Document',
            count: docs.length,
          });
        } else {
          setCaseInfo({ title: 'Case Vault', docType: 'No documents yet', count: 0 });
        }
      })
      .catch(() => setCaseInfo({ title: 'Case Vault', docType: 'Vault Overview', count: 0 }));
  }, []);

  return (
    <>
      <style>{WS_CSS}</style>
      <div className="cw-container">

        {/* ── CASE HEADER ── */}
        <div className="cw-header">
          <div className="cw-header-left">
            <h1 className="cw-case-title">
              {caseInfo ? caseInfo.title : '—'}
            </h1>
            <p className="cw-case-subtitle">
              {caseInfo ? caseInfo.docType : 'Loading case data…'}
            </p>
          </div>
          <div className="cw-badges">
            <span className="cw-badge-active">
              <span className="cw-badge-dot" />
              Active
            </span>
            <span className="cw-badge-suit">
              {caseInfo != null
                ? `${caseInfo.count} Document${caseInfo.count !== 1 ? 's' : ''}`
                : '—'}
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
        <div className="cw-content" role="tabpanel">
          {activeTab === 'documents' ? (
            <VaultView />
          ) : (
            <div className="cw-empty">
              <div className="cw-empty-icon-ring">
                {EMPTY_STATES[activeTab].icon}
              </div>
              <h2 className="cw-empty-title">{EMPTY_STATES[activeTab].title}</h2>
              <p className="cw-empty-msg">{EMPTY_STATES[activeTab].msg}</p>
              <span className="cw-coming-soon">Coming soon</span>
            </div>
          )}
        </div>

      </div>
    </>
  );
}
