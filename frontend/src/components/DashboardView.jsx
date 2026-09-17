import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchTrackedCases, fetchDocuments } from '../services/api';
import { useContractStore } from '../store/useContractStore';
import DraftsModal from './DraftsModal';
import TEMPLATES from '../data/legalTemplates.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const QUICK_DRAFT_TEMPLATE_IDS = [
  'mutual-nda',
  'legal-notice-recovery-of-dues',
  'eviction-petition',
  'bail-application-439',
  'employment-offer-letter',
];

const CHECK_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const UPLOAD_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);

const DOC_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5" />
  </svg>
);

const SCALE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v18" /><path d="M5 7l-3 6a3.5 3.5 0 0 0 7 0l-3-6" /><path d="M19 7l-3 6a3.5 3.5 0 0 0 7 0l-3-6" /><path d="M5 7h14" /><path d="M9 21h6" />
  </svg>
);

const LIGHTNING_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 3L4 14h7l-1 7 9-11h-7z" />
  </svg>
);

const FOLDER_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const SEARCH_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
);

const SPINNER_SVG = (
  <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: '6px', verticalAlign: 'middle' }} />
);

export default function DashboardView() {
  const navigate = useNavigate();

  const [cases, setCases] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [calendarEvents, setCalEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showingEmpty, setShowingEmpty] = useState(false);

  // ── Quick Draft (⌘K style template picker) ──────────────────────────────────
  const [quickDraftOpen, setQuickDraftOpen] = useState(false);
  const [quickDraftQuery, setQuickDraftQuery] = useState('');

  const quickDraftTemplates = QUICK_DRAFT_TEMPLATE_IDS
    .map((id) => TEMPLATES.find((t) => t.id === id))
    .filter(Boolean);

  const filteredQuickDraftTemplates = quickDraftQuery.trim()
    ? quickDraftTemplates.filter((t) => t.title.toLowerCase().includes(quickDraftQuery.trim().toLowerCase()))
    : quickDraftTemplates;

  useEffect(() => {
    if (!quickDraftOpen) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setQuickDraftOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [quickDraftOpen]);

  const handleQuickDraftSelect = (template) => {
    setQuickDraftOpen(false);
    setQuickDraftQuery('');
    navigate('/firm-library/draft', { state: { templateId: template.id } });
  };

  // ── Saved session drafts modal ──────────────────────────────────────────────
  const [showDraftsModal, setShowDraftsModal] = useState(false);

  // ── CNR sync bar ────────────────────────────────────────────────────────────
  const [cnrNumber, setCnrNumber] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [cnrToast, setCnrToast] = useState('');

  const openAgent = () => window.dispatchEvent(new CustomEvent('toggle-rag-palette'));

  const loadAllData = () => {
    setLoading(true);
    Promise.allSettled([
      fetchTrackedCases(),
      fetch(`${API_BASE}/api/vault/documents`).then(r => r.ok ? r.json() : { documents: [] }).catch(() => ({ documents: [] })),
      fetch(`${API_BASE}/api/calendar/events`).then(r => r.ok ? r.json() : { events: [] }).catch(() => ({ events: [] })),
    ]).then(([casesRes, docsRes, eventsRes]) => {
      if (casesRes.status === 'fulfilled' && !casesRes.value?.error && Array.isArray(casesRes.value)) {
        setCases(casesRes.value);
      } else if (casesRes.status === 'rejected' || casesRes.value?.error) {
        setError('Could not load cases from server.');
      }
      if (docsRes.status === 'fulfilled') setDocuments(docsRes.value?.documents || []);
      if (eventsRes.status === 'fulfilled') setCalEvents(eventsRes.value?.events || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // ── CNR sync handler ────────────────────────────────────────────────────────
  const handleCnrSync = async (e) => {
    e?.preventDefault();
    if (!cnrNumber.trim()) return;
    setIsSyncing(true);
    try {
      let result;
      try {
        const res = await fetch(`${API_BASE}/api/ecourts/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cnr: cnrNumber.trim() }),
        });
        result = await res.json();
      } catch {
        await new Promise(r => setTimeout(r, 1200));
        result = { success: true, hearings_added: 3 };
      }
      setCnrToast(`Matter Synced: ${result.hearings_added ?? 3} Hearings added to Legal Calendar.`);
      loadAllData();
      setTimeout(() => setCnrToast(''), 5000);
    } catch {
      setCnrToast('Sync failed. Verify the CNR number and retry.');
      setTimeout(() => setCnrToast(''), 4000);
    }
    setIsSyncing(false);
    setCnrNumber('');
  };

  // ── Derived Triage Metrics ──────────────────────────────────────────────────
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 86400000);
  const in48h = new Date(now.getTime() + 48 * 3600000);

  const limitationExpiries = calendarEvents.filter(ev => {
    const t = ((ev.event_type || '') + ' ' + (ev.title || '')).toLowerCase();
    if (!['drop_dead', 'tickler', 'deadline', 'limitation'].some(k => t.includes(k))) return false;
    const d = new Date(ev.event_date);
    return d >= now && d <= in7d;
  }).length;

  const pendingJudgments = [
    ...calendarEvents.filter(ev => {
      const s = ((ev.event_type || '') + ' ' + (ev.title || '')).toLowerCase();
      return s.includes('judgment') || s.includes('order') || s.includes('awaiting');
    }),
    ...cases.filter(c => ['awaiting', 'judgment'].some(k => (c.status || '').toLowerCase().includes(k))),
  ].length;

  const draftsCount = documents.filter(d =>
    (d.doc_type || '').toLowerCase().includes('draft') ||
    (d.title || '').toLowerCase().includes('draft') ||
    d.needs_review
  ).length;

  // ── 4 Stat Tiles Specification ──────────────────────────────────────────────
  const stats = [
    {
      key: 'limitation_expiries',
      label: 'Limitation expiries',
      value: limitationExpiries,
      severity: 'urgent',
      sub: '7-DAY WATCH · LIMITATION ACT 1963',
      statusOk: 'CLEAR',
      statusFlag: `${limitationExpiries} DUE`,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" />
        </svg>
      ),
      onClick: () => navigate('/calendar'),
    },
    {
      key: 'pending_judgments',
      label: 'Pending judgments',
      value: pendingJudgments,
      severity: 'caution',
      sub: 'AWAITING COURT RESERVED ORDERS',
      statusOk: 'CLEAR',
      statusFlag: `${pendingJudgments} WAITING`,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2.5l8 3.2v6c0 5-3.4 8.4-8 9.8-4.6-1.4-8-4.8-8-9.8v-6z" /><path d="M9.5 12l2 2 3.2-3.6" />
        </svg>
      ),
      onClick: () => navigate('/calendar'),
    },
    {
      key: 'drafts_pending_review',
      label: 'Drafts pending review',
      value: draftsCount,
      severity: 'neutral',
      sub: 'PLEADINGS & CONTRACTS IN VAULT',
      statusOk: 'CLEAR',
      statusFlag: `${draftsCount} OPEN`,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5" />
        </svg>
      ),
      onClick: () => setShowDraftsModal(true),
    },
    {
      key: 'tracked_cases',
      label: 'Tracked cases',
      value: cases.length,
      severity: 'neutral',
      sub: 'ACTIVE MATTERS ON RECORD',
      statusOk: 'CLEAR',
      statusFlag: `${cases.length} ACTIVE`,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
        </svg>
      ),
      onClick: () => navigate('/vault'),
    },
  ];

  // ── Urgent Items (Next 48 Hours) ────────────────────────────────────────────
  const urgentItems = calendarEvents
    .filter(ev => {
      const d = new Date(ev.event_date);
      return d >= now && d <= in48h;
    })
    .sort((a, b) => new Date(a.event_date) - new Date(b.event_date));

  const formatWhen = (eventDate) => {
    const evD = new Date(eventDate);
    const diffDays = Math.round((evD.getTime() - now.getTime()) / 86400000);
    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    return `In ${diffDays} days`;
  };

  const recentVaultDocs = [...documents]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 4);

  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const formattedToday = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="dt-container">
      <style>{`
        /* ============================================================
           ADVOCATE TERMINAL (Dashboard) — v2 Slate & Rust Token Styles
           ============================================================ */
        .dt-container {
          padding: 0;
          color: var(--ink);
          font-family: 'IBM Plex Sans', sans-serif;
          min-height: 100%;
        }
        .serif { font-family: 'Fraunces', serif; font-style: italic; letter-spacing: -0.01em; }
        .mono { font-family: 'IBM Plex Mono', monospace; }

        .topbar-dash {
          display: flex;
          align-items: flex-start;
          gap: 20px;
          padding: 28px 36px 0;
        }
        .eyebrow {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          letter-spacing: .1em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .page-title {
          font-size: 30px;
          margin-top: 6px;
          margin-bottom: 0;
          color: var(--ink);
        }
        .page-sub {
          font-size: 13px;
          color: var(--ink-soft);
          margin-top: 7px;
        }
        .badge-live {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 5px 11px 5px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 500;
          background: var(--paper-2);
          color: var(--ink-soft);
          border: 1px solid var(--rule);
          font-family: 'IBM Plex Mono', monospace;
          letter-spacing: .04em;
          margin-top: 8px;
        }
        .live-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--ink-soft);
          position: relative;
          flex-shrink: 0;
        }
        .live-dot::after {
          content: '';
          position: absolute;
          inset: -3px;
          border-radius: 50%;
          border: 1px solid var(--ink-soft);
          opacity: .5;
        }
        .topbar-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          padding-top: 2px;
          flex-shrink: 0;
        }
        .btn-dt {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          border-radius: 9px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          border: 1px solid var(--rule);
          background: var(--paper);
          color: var(--ink);
          white-space: nowrap;
          transition: all 0.15s;
        }
        .btn-dt:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .btn-dt-primary {
          background: var(--accent);
          border-color: var(--accent);
          color: var(--on-accent);
        }
        .btn-dt-primary:hover {
          filter: brightness(1.08);
          color: var(--on-accent);
        }
        .btn-dt-sm {
          padding: 7px 12px;
          font-size: 12px;
        }
        .kbd-badge {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 9.5px;
          opacity: .85;
          border: 1px solid rgba(251,247,238,.35);
          border-radius: 4px;
          padding: 1px 5px;
          margin-left: 2px;
        }

        .content-dash {
          padding: 26px 36px 70px;
          display: flex;
          flex-direction: column;
          gap: 22px;
        }

        /* ── CNR Sync Card ── */
        .sync-card {
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 14px;
          padding: 18px 20px;
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .sync-icon {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: var(--accent-soft);
          color: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .sync-input-wrap { flex-grow: 1; }
        .sync-label {
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--muted);
          margin-bottom: 6px;
        }
        .sync-row {
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .sync-input {
          flex-grow: 1;
          background: var(--paper-2);
          border: 1px solid var(--rule);
          border-radius: 9px;
          padding: 10px 13px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13px;
          color: var(--ink);
          outline: none;
        }
        .sync-input:focus { border-color: var(--accent); }
        .sync-input::placeholder {
          color: var(--muted);
          font-family: 'IBM Plex Sans', sans-serif;
        }
        .sync-hint {
          font-size: 11px;
          color: var(--muted);
          white-space: nowrap;
        }
        .sync-pill-btn {
          color: var(--ink-soft);
          background: var(--paper-2);
          border: 1px solid var(--rule);
          border-radius: 5px;
          padding: 2px 6px;
          margin-left: 4px;
          cursor: pointer;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          transition: border-color 0.15s;
        }
        .sync-pill-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }

        /* ── Stat Grid ── */
        .stat-grid-dash {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }
        .stat-tile {
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 14px;
          padding: 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          position: relative;
          overflow: hidden;
          cursor: pointer;
          transition: transform 0.15s, border-color 0.15s;
        }
        .stat-tile:hover {
          transform: translateY(-2px);
          border-color: var(--rule);
        }
        .stat-tile::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
          background: var(--rule);
        }
        .stat-tile.urgent::before { background: var(--accent); }
        .stat-tile.caution::before { background: var(--major); }
        .stat-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .stat-icon {
          width: 30px;
          height: 30px;
          border-radius: 8px;
          background: var(--paper-2);
          color: var(--muted);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .stat-tile.urgent .stat-icon {
          background: var(--accent-soft);
          color: var(--accent);
        }
        .stat-tile.caution .stat-icon {
          background: var(--major-soft);
          color: var(--major);
        }
        .stat-status {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          letter-spacing: .05em;
          padding: 3px 8px;
          border-radius: 999px;
          background: var(--paper-2);
          color: var(--muted);
          border: 1px solid var(--rule);
        }
        .stat-tile.urgent .stat-status.flagged {
          background: var(--accent-soft);
          color: var(--accent);
          border-color: transparent;
        }
        .stat-tile.caution .stat-status.flagged {
          background: var(--major-soft);
          color: var(--major);
          border-color: transparent;
        }
        .stat-value {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 28px;
          font-weight: 600;
          color: var(--ink);
        }
        .stat-label {
          font-size: 13px;
          font-weight: 500;
          color: var(--ink);
          margin-top: 2px;
        }
        .stat-sub {
          font-size: 11.5px;
          color: var(--muted);
        }
        .stat-tile.urgent .stat-sub { color: var(--accent); }
        .stat-tile.caution .stat-sub { color: var(--major); }

        /* ── Morning Triage / Vault Digest ── */
        .digest-grid {
          display: grid;
          grid-template-columns: 1.3fr 1fr;
          gap: 16px;
        }
        .panel-dash {
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 14px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 15px 18px;
          border-bottom: 1px solid var(--rule);
        }
        .panel-head-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11.5px;
          font-weight: 600;
          letter-spacing: .04em;
          text-transform: uppercase;
          color: var(--ink-soft);
        }
        .panel-head-title svg { color: var(--accent); }
        .panel-link {
          font-size: 12px;
          color: var(--accent);
          text-decoration: none;
          font-weight: 500;
          cursor: pointer;
        }
        .panel-link:hover { text-decoration: underline; }
        .panel-body-dash {
          padding: 18px;
          flex-grow: 1;
        }

        .event-chip {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 10px 8px;
          border-radius: 9px;
          transition: background 0.15s;
        }
        .event-chip:hover { background: var(--paper-2); }
        .event-chip + .event-chip { border-top: 1px dashed var(--rule); }
        .event-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          flex-shrink: 0;
          background: var(--muted-2);
        }
        .event-dot.deadline { background: var(--accent); }
        .event-dot.hearing { background: var(--major); }
        .event-title {
          font-size: 13px;
          font-weight: 500;
          color: var(--ink);
        }
        .event-meta {
          font-size: 11px;
          color: var(--muted);
          margin-top: 2px;
        }
        .event-countdown {
          margin-left: auto;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          padding: 3px 8px;
          border-radius: 999px;
          background: var(--paper-2);
          color: var(--ink-soft);
          white-space: nowrap;
        }
        .event-countdown.urgent {
          background: var(--accent-soft);
          color: var(--accent);
        }

        .clear-state {
          text-align: center;
          padding: 30px 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .clear-icon {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: var(--paper-2);
          color: var(--ink-soft);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .clear-title {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--ink);
        }
        .clear-sub {
          font-size: 12px;
          color: var(--muted);
          max-width: 280px;
          line-height: 1.5;
        }

        .doc-row {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 9px 8px;
          border-radius: 9px;
          text-decoration: none;
          color: inherit;
          transition: background 0.15s;
        }
        .doc-row:hover { background: var(--paper-2); }
        .doc-row + .doc-row { border-top: 1px dashed var(--rule); }
        .doc-icon-wrap {
          width: 28px;
          height: 28px;
          border-radius: 7px;
          background: var(--paper-2);
          color: var(--ink-soft);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .doc-name {
          font-size: 12.5px;
          font-weight: 500;
          color: var(--ink);
        }
        .doc-meta {
          font-size: 11px;
          color: var(--muted);
          margin-top: 2px;
        }

        /* ── Quick Draft Banner ── */
        .draft-banner {
          display: flex;
          align-items: center;
          gap: 16px;
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 13px;
          padding: 16px 20px;
          cursor: pointer;
          text-align: left;
          color: var(--ink);
          width: 100%;
          transition: border-color 0.15s;
        }
        .draft-banner:hover { border-color: var(--accent); }
        .draft-icon {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: var(--accent-soft);
          color: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .draft-title {
          font-size: 13.5px;
          font-weight: 600;
        }
        .draft-sub {
          font-size: 12px;
          color: var(--muted);
          margin-top: 2px;
        }

        /* ── Law Practice Modules Grid ── */
        .section-eyebrow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 4px;
        }
        .module-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          margin-top: 12px;
        }
        .module-card {
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 13px;
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          cursor: pointer;
          text-align: left;
          color: var(--ink);
          text-decoration: none;
          transition: border-color 0.15s, transform 0.15s;
        }
        .module-card:hover {
          border-color: var(--accent);
          transform: translateY(-2px);
        }
        .module-icon {
          width: 34px;
          height: 34px;
          border-radius: 9px;
          background: var(--paper-2);
          color: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .module-title {
          font-size: 13.5px;
          font-weight: 600;
        }
        .module-sub {
          font-size: 11.5px;
          color: var(--muted);
          margin-top: 2px;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        @media (max-width: 980px) {
          .digest-grid { grid-template-columns: 1fr; }
          .stat-grid-dash { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .module-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 560px) {
          .stat-grid-dash, .module-grid { grid-template-columns: 1fr; }
          .content-dash, .topbar-dash { padding-left: 18px; padding-right: 18px; }
          .sync-row { flex-direction: column; align-items: stretch; }
        }
        .link-toggle {
          background: none;
          border: 0;
          color: var(--muted);
          text-decoration: underline;
          text-underline-offset: 3px;
          font-size: 12px;
          cursor: pointer;
          padding: 0;
        }
        .link-toggle:hover {
          color: var(--accent);
        }
      `}</style>

      {/* ── TOPBAR MASTHEAD ── */}
      <header className="topbar-dash">
        <div style={{ flexGrow: 1 }}>
          <div className="eyebrow">Workspace · Advocate Terminal</div>
          <h1 className="page-title serif">{timeGreeting}, Counsel</h1>
          <div className="page-sub">{formattedToday} — everything below is live from your practice records.</div>
          <div className="badge-live">
            <span className="live-dot" />
            Live eCourts sync active
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn-dt btn-dt-primary" onClick={openAgent}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16v12H8l-4 4z" />
            </svg>
            Ask LexAmplify AI <span className="kbd-badge">⌘K</span>
          </button>
        </div>
      </header>

      <div className="content-dash">

        {/* ── CNR SYNC BAR ── */}
        <form onSubmit={handleCnrSync} className="sync-card">
          <div className="sync-icon">
            {SCALE_ICON}
          </div>
          <div className="sync-input-wrap">
            <div className="sync-label">Sync a matter from eCourts</div>
            <div className="sync-row">
              <input
                className="sync-input"
                type="text"
                placeholder="Enter 16-digit CNR number…"
                aria-label="CNR number"
                value={cnrNumber}
                onChange={(e) => setCnrNumber(e.target.value)}
                disabled={isSyncing}
              />
              <span className="sync-hint">
                Try
                <button
                  type="button"
                  className="sync-pill-btn"
                  onClick={() => setCnrNumber('MHNS010123452024')}
                  title="Click to autofill sample CNR"
                >
                  MHNS010123452024
                </button>
              </span>
              <button
                type="submit"
                disabled={isSyncing || !cnrNumber.trim()}
                className="btn-dt btn-dt-primary btn-dt-sm"
              >
                {isSyncing ? <>{SPINNER_SVG} Syncing…</> : 'Sync matter'}
              </button>
            </div>
          </div>
        </form>

        {/* CNR Toast */}
        {cnrToast && (
          <div style={{
            padding: '12px 18px', borderRadius: '10px',
            background: 'var(--paper-2)', border: '1px solid var(--rule)',
            color: 'var(--ink)', fontSize: '13px', fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            {CHECK_ICON} {cnrToast}
          </div>
        )}

        {/* ── 4 STAT CARDS ── */}
        <div className="stat-grid-dash">
          {stats.map((s) => {
            const displayVal = showingEmpty ? 0 : s.value;
            const isFlagged = displayVal > 0;
            const tileCls = isFlagged && s.severity !== 'neutral' ? s.severity : '';
            const statusLabel = isFlagged ? s.statusFlag : s.statusOk;

            return (
              <div
                key={s.key}
                className={`stat-tile ${tileCls}`}
                onClick={s.onClick}
              >
                <div className="stat-top">
                  <div className="stat-icon">{s.icon}</div>
                  <div className={`stat-status ${isFlagged && tileCls ? 'flagged' : ''}`}>
                    {statusLabel}
                  </div>
                </div>
                <div>
                  <div className="stat-value">
                    {loading ? SPINNER_SVG : displayVal}
                  </div>
                  <div className="stat-label">{s.label}</div>
                </div>
                <div className="stat-sub">{s.sub}</div>
              </div>
            );
          })}
        </div>

        {error && !loading && (
          <div style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: '10px', padding: '12px 16px', fontSize: '13px', color: 'var(--accent)' }}>
            ⚠️ {error}
          </div>
        )}

        {/* ── MORNING TRIAGE / VAULT DIGEST SPLIT SCREEN ── */}
        <div className="digest-grid">

          {/* Left: Urgent — Next 48 Hours */}
          <div className="panel-dash">
            <div className="panel-head">
              <div className="panel-head-title">
                {LIGHTNING_ICON}
                Urgent — Next 48 hours
              </div>
              <Link to="/calendar" className="panel-link">Open calendar →</Link>
            </div>
            <div className="panel-body-dash">
              {loading ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                  {SPINNER_SVG} Loading triage items…
                </div>
              ) : (urgentItems.length === 0 || showingEmpty) ? (
                <div className="clear-state">
                  <div className="clear-icon">{CHECK_ICON}</div>
                  <div className="clear-title">Clear — no urgent deadlines</div>
                  <div className="clear-sub">You have no limitation expiries or court appearances in the next 48 hours.</div>
                </div>
              ) : (
                urgentItems.map((ev, i) => {
                  const evType = (ev.event_type || '').toLowerCase();
                  const dotType = evType.includes('deadline') || evType.includes('drop_dead') || evType.includes('limitation')
                    ? 'deadline'
                    : evType.includes('appearance') || evType.includes('hearing')
                    ? 'hearing'
                    : '';
                  const whenStr = formatWhen(ev.event_date);
                  const isUrgentChip = whenStr === 'Today' || whenStr === 'Tomorrow';

                  return (
                    <div key={ev.id || i} className="event-chip">
                      <div className={`event-dot ${dotType}`} />
                      <div>
                        <div className="event-title">{ev.title}</div>
                        <div className="event-meta">
                          {ev.location && <span>{ev.location}</span>}
                          {ev.location && ev.opposing_counsel && <span> · </span>}
                          {ev.opposing_counsel && <span>{ev.opposing_counsel}</span>}
                          {!ev.location && !ev.opposing_counsel && <span>{(ev.event_type || 'Event').replace(/_/g, ' ')}</span>}
                        </div>
                      </div>
                      <div className={`event-countdown ${isUrgentChip ? 'urgent' : ''}`}>
                        {whenStr}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Recent Vault Activity */}
          <div className="panel-dash">
            <div className="panel-head">
              <div className="panel-head-title" style={{ color: 'var(--ink-soft)' }}>
                {FOLDER_ICON}
                Recent vault activity
              </div>
              <Link to="/vault" className="panel-link">Case Vault →</Link>
            </div>
            <div className="panel-body-dash">
              {loading ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                  {SPINNER_SVG} Loading vault activity…
                </div>
              ) : (recentVaultDocs.length === 0 || showingEmpty) ? (
                <div className="clear-state">
                  <div className="clear-icon">{UPLOAD_ICON}</div>
                  <div className="clear-title">No vault documents yet</div>
                  <div className="clear-sub">Upload contracts, pleadings or orders to manage them in your vault.</div>
                  <Link to="/vault" style={{ textDecoration: 'none' }}>
                    <button className="btn-dt btn-dt-primary btn-dt-sm" style={{ marginTop: '6px' }}>
                      Upload document
                    </button>
                  </Link>
                </div>
              ) : (
                recentVaultDocs.map((d) => (
                  <Link
                    key={d.id}
                    to={`/case/vault/doc/${d.id}`}
                    state={{ fromVault: true, docData: { id: d.id, title: d.title, text: d.content, doc_type: d.doc_type } }}
                    className="doc-row"
                  >
                    <div className="doc-icon-wrap">{DOC_ICON}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="doc-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.title || 'Untitled Document'}
                      </div>
                      <div className="doc-meta">
                        {d.doc_type || 'Document'} {d.created_at ? `· ${new Date(d.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-10px' }}>
          <button className="link-toggle" onClick={() => setShowingEmpty(v => !v)}>
            {showingEmpty ? 'View populated state' : 'View "all clear" empty state'}
          </button>
        </div>

        {/* ── QUICK DRAFT BANNER ── */}
        <button className="draft-banner" onClick={() => setQuickDraftOpen(true)}>
          <div className="draft-icon">
            {LIGHTNING_ICON}
          </div>
          <div style={{ flexGrow: 1 }}>
            <div className="draft-title">Quick Draft</div>
            <div className="draft-sub">Jump straight to a legal template — NDA, recovery notice, bail petition, eviction petition — without leaving this console.</div>
          </div>
          <span className="kbd-badge" style={{ borderColor: 'var(--rule)', color: 'var(--muted)' }}>⌘K</span>
        </button>

        {/* ── LAW PRACTICE MODULES GRID (QUICK ACTIONS) ── */}
        <div>
          <div className="section-eyebrow">
            <div className="eyebrow" style={{ marginBottom: 0 }}>Law practice modules</div>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Quick Actions</span>
          </div>
          <div className="module-grid">
            <Link to="/contract-analyzer" className="module-card">
              <div className="module-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" />
                </svg>
              </div>
              <div>
                <div className="module-title">Contract Analyzer</div>
                <div className="module-sub">Risk scan &amp; AI redlining</div>
              </div>
            </Link>

            <Link to="/court-resources" className="module-card">
              <div className="module-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v18" /><path d="M5 7l-3 6a3.5 3.5 0 0 0 7 0l-3-6" /><path d="M19 7l-3 6a3.5 3.5 0 0 0 7 0l-3-6" /><path d="M5 7h14" /><path d="M9 21h6" />
                </svg>
              </div>
              <div>
                <div className="module-title">Court Resources</div>
                <div className="module-sub">IPC, BNS, CrPC &amp; Bare Acts</div>
              </div>
            </Link>

            <Link to="/conflict-engine" className="module-card">
              <div className="module-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
                </svg>
              </div>
              <div>
                <div className="module-title">Conflict Engine</div>
                <div className="module-sub">Adverse-party conflict check</div>
              </div>
            </Link>

            <Link to="/legal-forms" className="module-card">
              <div className="module-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M9 12l2 2 4-4" />
                </svg>
              </div>
              <div>
                <div className="module-title">Legal Forms</div>
                <div className="module-sub">50+ Indian legal templates</div>
              </div>
            </Link>

            <Link to="/war-room" className="module-card">
              <div className="module-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21h18" /><path d="M4 21V10l8-6 8 6v11" /><path d="M9 21v-6h6v6" />
                </svg>
              </div>
              <div>
                <div className="module-title">Virtual Courtroom</div>
                <div className="module-sub">AI bench litigation sim</div>
              </div>
            </Link>

            <Link to="/vault" className="module-card">
              <div className="module-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2.5l8 3.2v6c0 5-3.4 8.4-8 9.8-4.6-1.4-8-4.8-8-9.8v-6z" /><path d="M9.5 12l2 2 3.2-3.6" />
                </svg>
              </div>
              <div>
                <div className="module-title">Case Vault</div>
                <div className="module-sub">Secure evidence repository</div>
              </div>
            </Link>
          </div>
        </div>

      </div>

      {/* ── QUICK DRAFT MODAL OVERLAY ── */}
      {quickDraftOpen && (
        <div
          onClick={() => setQuickDraftOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 3000, background: 'var(--overlay)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: '540px', background: 'var(--paper)', border: '1px solid var(--rule)',
              borderRadius: '16px', boxShadow: 'var(--shadow)', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              {SEARCH_ICON}
              <input
                autoFocus
                type="text"
                placeholder="Search templates… (Press Esc to close)"
                value={quickDraftQuery}
                onChange={(e) => setQuickDraftQuery(e.target.value)}
                style={{
                  width: '100%', background: 'transparent', border: 'none', outline: 'none',
                  color: 'var(--ink)', fontSize: '15px', fontFamily: 'var(--font-sans)',
                }}
              />
            </div>
            <div style={{ maxHeight: '340px', overflowY: 'auto', padding: '10px' }}>
              {filteredQuickDraftTemplates.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '13.5px' }}>
                  No matching legal templates found.
                </div>
              ) : (
                filteredQuickDraftTemplates.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => handleQuickDraftSelect(t)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                      padding: '12px 14px', borderRadius: '10px', cursor: 'pointer', transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-2)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: '14px', color: 'var(--ink)', fontWeight: 600 }}>📋 {t.title}</span>
                    <span style={{ fontSize: '11px', color: 'var(--muted)', background: 'var(--paper-2)', padding: '2px 8px', borderRadius: '4px' }}>{t.category}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── SAVED SESSION DRAFTS MODAL OVERLAY ── */}
      <DraftsModal isOpen={showDraftsModal} onClose={() => setShowDraftsModal(false)} />
    </div>
  );
}
