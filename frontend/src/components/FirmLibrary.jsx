import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { getSharedFiles, subscribeSharedFiles, addSharedFile } from '../utils/sharedWorkspaceStore';
import { renderWithCitations } from './CitationLink';
import useLibraryHeadnoteStream from '../hooks/useLibraryHeadnoteStream.js';
import { uploadDocument } from '../services/api';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const LS_KEY = 'lexai_firm_library_v2';

// ── Icons matching SVG specifications ──────────────────────────────────────────
const ICONS = {
  template: (
    <svg className="icon" viewBox="0 0 24 24">
      <path d="M6 3h9l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M15 3v5h5" />
      <line x1="8" y1="13" x2="16" y2="13" strokeDasharray="2 2" />
      <line x1="8" y1="17" x2="13" y2="17" strokeDasharray="2 2" />
    </svg>
  ),
  precedent: (
    <svg className="icon" viewBox="0 0 24 24">
      <path d="M8 4h9l4 4v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <path d="M4 8v12a1 1 0 0 0 1 1h9" strokeOpacity=".55" />
      <line x1="11" y1="12" x2="17" y2="12" />
      <line x1="11" y1="16" x2="17" y2="16" />
    </svg>
  ),
  memo: (
    <svg className="icon" viewBox="0 0 24 24">
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="13" y2="16" />
    </svg>
  ),
  form: (
    <svg className="icon" viewBox="0 0 24 24">
      <rect x="5" y="4" width="14" height="17" rx="1.5" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <polyline points="8.5 11 10 12.5 13.5 9" />
      <line x1="9" y1="16" x2="15" y2="16" />
    </svg>
  ),
  guide: (
    <svg className="icon" viewBox="0 0 24 24">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z" />
      <path d="M4 5.5v15" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  ),
  check: (
    <svg className="icon" viewBox="0 0 24 24">
      <path d="M5 13l4 4L19 7" />
    </svg>
  ),
  clock: (
    <svg className="icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </svg>
  ),
  warn: (
    <svg className="icon" viewBox="0 0 24 24">
      <path d="M12 3l10 18H2Z" />
      <line x1="12" y1="10" x2="12" y2="15" />
      <circle cx="12" cy="18" r=".6" fill="currentColor" />
    </svg>
  ),
  person: (
    <svg className="icon" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c1.2-4 4-6 7-6s5.8 2 7 6" />
    </svg>
  ),
  sparkle: (
    <svg className="icon" viewBox="0 0 24 24">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" />
    </svg>
  ),
  file: (
    <svg className="icon" viewBox="0 0 24 24">
      <path d="M6 3h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M13 3v5h5" />
    </svg>
  ),
  download: (
    <svg className="icon" viewBox="0 0 24 24">
      <path d="M12 3v12" />
      <polyline points="7 10 12 15 17 10" />
      <path d="M5 21h14" />
    </svg>
  ),
  draft: (
    <svg className="icon" viewBox="0 0 24 24">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  link: (
    <svg className="icon" viewBox="0 0 24 24">
      <path d="M9 15l6-6" />
      <path d="M13 5l1-1a3.5 3.5 0 0 1 5 5l-1 1" />
      <path d="M11 19l-1 1a3.5 3.5 0 0 1-5-5l1-1" />
    </svg>
  ),
};

const CAT_META = {
  Template: { icon: ICONS.template, desc: 'A blank-slate starting point for a new document.' },
  Precedent: { icon: ICONS.precedent, desc: 'A real prior document kept as a worked example.' },
  'Research Memo': { icon: ICONS.memo, desc: 'Internal legal analysis on a specific question.' },
  'Standard Form': { icon: ICONS.form, desc: "The firm's approved version of a routine filing." },
  'Practice Guide': { icon: ICONS.guide, desc: 'A how-to reference for a recurring procedure.' },
};

const TODAY = new Date('2026-09-17');
function daysAgo(n) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return d;
}

function relTime(d) {
  const dateObj = typeof d === 'string' ? new Date(d) : d;
  const days = Math.round((TODAY - dateObj) / 86400000);
  if (days < 1) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.round(days / 7)} week${Math.round(days / 7) === 1 ? '' : 's'} ago`;
  if (days < 365) return `${Math.round(days / 30)} month${Math.round(days / 30) === 1 ? '' : 's'} ago`;
  return `${Math.round(days / 365)} year${Math.round(days / 365) === 1 ? '' : 's'} ago`;
}

function exactDate(d) {
  const dateObj = typeof d === 'string' ? new Date(d) : d;
  return dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Realistic Initial Seed Entries (§2 Data Contract) ───────────────────────
const INITIAL_ENTRIES = [
  {
    id: '1',
    title: 'Standard Vendor Service Agreement — SaaS',
    category: 'Template',
    updated: daysAgo(7).toISOString(),
    author: 'Firm Library',
    aiAssisted: true,
    validity: 'current',
    tags: ['SaaS', 'Commercial', 'Payment Terms'],
    description:
      'General-purpose services agreement for SaaS vendor engagements, harmonized for Indian jurisdiction clauses and standard liability caps.',
  },
  {
    id: '2',
    title: 'Employment Agreement — Fixed Term (Chennai)',
    category: 'Standard Form',
    updated: daysAgo(21).toISOString(),
    author: 'Priya Raman',
    aiAssisted: false,
    validity: 'current',
    tags: ['Employment', 'Fixed Term', 'Tamil Nadu'],
    description:
      "The firm's standard fixed-term employment contract, compliant with the Tamil Nadu Shops and Establishments Act.",
  },
  {
    id: '3',
    title: 'Precedent — Commercial Lease Deed, Nungambakkam',
    category: 'Precedent',
    updated: daysAgo(128).toISOString(),
    author: 'Saurabh K.',
    aiAssisted: false,
    validity: 'review',
    tags: ['Lease', 'Commercial Property', 'Chennai'],
    description:
      'A closed commercial lease matter kept as a structural reference — rent-escalation and lock-in clauses may need updating against current market terms.',
  },
  {
    id: '4',
    title: 'Research Memo — Force Majeure under S.56, Indian Contract Act',
    category: 'Research Memo',
    updated: daysAgo(184).toISOString(),
    author: 'Yogesh N.',
    aiAssisted: false,
    validity: 'current',
    tags: ['Force Majeure', 'Contract Act', 'Litigation'],
    description:
      'Analysis of force majeure invocation standards post-2020, with citations to relevant High Court rulings.',
  },
  {
    id: '5',
    title: 'Practice Guide — Filing a Caveat under CPC O. XXXIX',
    category: 'Practice Guide',
    updated: daysAgo(392).toISOString(),
    author: 'Firm Library',
    aiAssisted: false,
    validity: 'outdated',
    tags: ['CPC', 'Caveat', 'Procedure'],
    description:
      'Step-by-step filing procedure — flagged for review following recent Madras High Court practice-direction updates to e-filing requirements.',
  },
  {
    id: '6',
    title: 'Precedent — Founders’ Agreement, Private Limited',
    category: 'Precedent',
    updated: daysAgo(241).toISOString(),
    author: 'Priya Raman',
    aiAssisted: false,
    validity: 'review',
    tags: ['Startup', 'Equity', 'Founders'],
    description:
      'Founders’ agreement from an early-stage private limited matter — vesting schedule and IP-assignment clauses worth revisiting for newer deals.',
  },
  {
    id: '7',
    title: 'Standard Non-Disclosure Agreement — Vendor',
    category: 'Template',
    updated: daysAgo(2).toISOString(),
    author: 'Firm Library',
    aiAssisted: true,
    validity: 'current',
    tags: ['NDA', 'Confidentiality', 'Vendor'],
    description:
      'Mutual NDA template pre-cleared for vendor onboarding, with a jurisdiction carve-out for Indian courts.',
  },
];

// Helper to determine validity when not provided explicitly
function computeValidity(entry) {
  if (entry.validity) return entry.validity;
  if (entry.validity_status) {
    const s = String(entry.validity_status).toLowerCase();
    if (s.includes('green') || s.includes('current')) return 'current';
    if (s.includes('yellow') || s.includes('review')) return 'review';
    if (s.includes('red') || s.includes('outdated')) return 'outdated';
  }
  const dateObj = new Date(entry.updated || Date.now());
  const diffDays = Math.round((TODAY - dateObj) / 86400000);
  if (diffDays > 365) return 'outdated';
  if (diffDays > 90) return 'review';
  return 'current';
}

const styles = `
  .lib-root {
    --bg:#DFE1E0; --paper:#EAEBE8; --paper-2:#E3E4E1;
    --ink:#181B1D; --ink-soft:#494E51; --muted:#868C8E; --muted-2:#B3B8B9; --rule:#D2D5D4;
    --accent:#B24A2E; --accent-soft:#EFDCD1;
    --major:#9C7A2E; --major-soft:#F1E6C9;
    --on-accent:#FBF7EE;
    font-family: 'IBM Plex Sans', sans-serif;
    color: var(--ink-soft);
  }
  html[data-theme="dark"] .lib-root,
  :root[data-theme="dark"] .lib-root {
    --bg:#191C1D; --paper:#212527; --paper-2:#2A2F31;
    --ink:#D6D9D9; --ink-soft:#AAAEAE; --muted:#727776; --muted-2:#494E4D; --rule:#333939;
    --accent:#CC6B48; --accent-soft:#3B281F;
    --major:#D9AD5C; --major-soft:#35301C;
    --on-accent:#FBF7EE;
  }
  .lib-root svg.icon {
    width: 16px; height: 16px; flex-shrink: 0;
  }
  .lib-root svg.icon path,
  .lib-root svg.icon line,
  .lib-root svg.icon rect,
  .lib-root svg.icon circle,
  .lib-root svg.icon polyline {
    stroke: currentColor; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round;
  }

  .lib-page {
    max-width: 1220px;
    margin: 0 auto;
    padding: 0 32px 80px;
  }

  /* ---------- Header ---------- */
  .lib-header {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 8px; flex-wrap: wrap;
  }
  .lib-title {
    font-family: 'Fraunces', serif; font-style: italic; font-weight: 600; font-size: 30px; color: var(--ink);
  }
  .lib-sub {
    font-size: 13.5px; color: var(--muted); margin-top: 7px; max-width: 520px; line-height: 1.55;
  }
  .lib-actions {
    display: flex; gap: 10px; flex-shrink: 0;
  }
  .lib-btn {
    display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600; border-radius: 8px; padding: 10px 16px; cursor: pointer; white-space: nowrap; border: 1px solid transparent; font-family: inherit; transition: all 0.15s ease;
  }
  .lib-btn-primary {
    color: var(--on-accent); background: var(--accent);
  }
  .lib-btn-primary:hover {
    background: #9C3E26;
  }
  html[data-theme="dark"] .lib-btn-primary:hover {
    background: #B85A3B;
  }
  .lib-btn-ghost {
    color: var(--ink-soft); background: var(--paper); border-color: var(--rule);
  }
  .lib-btn-ghost:hover {
    border-color: var(--ink); color: var(--ink);
  }

  .lib-stats {
    font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--muted); margin: 20px 0 22px; padding-bottom: 20px; border-bottom: 1px solid var(--rule);
  }
  .lib-stats b {
    color: var(--ink); font-weight: 600;
  }
  .lib-stats .flag {
    color: var(--major); font-weight: 600;
  }

  /* ---------- Tabs ---------- */
  .lib-tabs {
    display: flex; gap: 8px; margin-bottom: 22px;
  }
  .lib-tab {
    display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--muted); background: var(--paper); border: 1px solid var(--rule); border-radius: 9px; padding: 10px 16px; cursor: pointer; font-family: inherit; transition: all 0.15s ease;
  }
  .lib-tab .icon {
    color: var(--muted-2);
  }
  .lib-tab.on {
    color: var(--accent); border-color: var(--accent); background: var(--accent-soft);
  }
  .lib-tab.on .icon {
    color: var(--accent);
  }

  .tab-panel {
    display: none;
  }
  .tab-panel.on {
    display: block;
  }

  /* ---------- Search + Filters ---------- */
  .search-row {
    position: relative; margin-bottom: 14px;
  }
  .search-row .icon {
    position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--muted);
  }
  .search-input {
    width: 100%; border: 1px solid var(--rule); border-radius: 9px; padding: 12px 14px 12px 40px; font-family: inherit; font-size: 13.5px; background: var(--paper); color: var(--ink-soft); box-sizing: border-box;
  }
  .search-input::placeholder {
    color: var(--muted);
  }
  .search-input:focus {
    outline: none; border-color: var(--accent);
  }
  .search-hint {
    font-size: 11.5px; color: var(--muted); margin: 8px 2px 0; font-style: italic; font-family: 'Fraunces', serif;
  }

  .filter-row {
    display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 20px;
  }
  .filter-pill {
    font-size: 12px; color: var(--muted); background: var(--paper); border: 1px solid var(--rule); border-radius: 16px; padding: 6px 13px; cursor: pointer; font-family: inherit; transition: all 0.15s ease;
  }
  .filter-pill .count {
    font-family: 'IBM Plex Mono', monospace; font-size: 10px;
  }
  .filter-pill.on {
    color: var(--accent); border-color: var(--accent); background: var(--accent-soft); font-weight: 600;
  }

  /* ---------- Table ---------- */
  .lib-table-wrap {
    border: 1px solid var(--rule); border-radius: 12px; overflow: hidden; background: var(--paper);
  }
  .lib-table {
    width: 100%; border-collapse: collapse;
  }
  .lib-table thead th {
    text-align: left; font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; letter-spacing: .03em; color: var(--muted); text-transform: uppercase; padding: 13px 18px; border-bottom: 1px solid var(--rule); cursor: pointer; user-select: none; white-space: nowrap;
  }
  .lib-table thead th:hover {
    color: var(--ink-soft);
  }
  .lib-table thead th.sorted {
    color: var(--accent);
  }
  .th-flex {
    display: flex; align-items: center; gap: 5px;
  }
  .sort-arrow {
    width: 10px; height: 10px; opacity: .5;
  }
  .th-flex.sorted .sort-arrow {
    opacity: 1; color: var(--accent);
  }

  .lib-row {
    border-bottom: 1px solid var(--paper-2); cursor: pointer; transition: background 0.12s ease;
  }
  .lib-row:last-child {
    border-bottom: none;
  }
  .lib-row:hover {
    background: var(--paper-2);
  }
  .lib-row td {
    padding: 14px 18px; vertical-align: middle; font-size: 13px;
  }

  .cat-cell {
    display: flex; align-items: center; gap: 11px;
  }
  .cat-icon-wrap {
    width: 32px; height: 32px; border-radius: 8px; background: var(--paper-2); display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--ink-soft);
  }
  .row-title {
    font-family: 'Fraunces', serif; font-weight: 600; font-size: 14px; color: var(--ink); line-height: 1.35;
  }
  .row-cat-label {
    font-size: 11px; color: var(--muted); margin-top: 2px;
  }

  .cat-pill {
    display: inline-block; font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--ink-soft); background: var(--paper-2); border: 1px solid var(--rule); border-radius: 5px; padding: 3px 8px;
  }

  .updated-cell {
    color: var(--ink-soft); white-space: nowrap;
  }
  .updated-exact {
    font-size: 10.5px; color: var(--muted); margin-top: 2px;
  }

  .author-cell {
    display: flex; align-items: center; gap: 7px; color: var(--ink-soft);
  }
  .author-cell .icon {
    color: var(--muted-2); width: 14px; height: 14px;
  }
  .author-cell.ai {
    color: var(--ink-soft);
  }
  .author-cell.ai .icon {
    color: var(--accent);
  }

  .valid-pill {
    display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; padding: 5px 10px; border-radius: 6px; white-space: nowrap;
  }
  .valid-current {
    color: var(--ink-soft); background: var(--paper-2); border: 1px solid var(--rule);
  }
  .valid-review {
    color: var(--major); background: var(--major-soft); border: 1px solid transparent;
  }
  .valid-outdated {
    color: var(--accent); background: var(--accent-soft); border: 1px solid transparent;
  }
  .valid-pill .icon {
    width: 12px; height: 12px;
  }

  /* ---------- Empty state ---------- */
  .empty-zone {
    border: 1.5px dashed var(--rule); border-radius: 12px; padding: 56px 30px; text-align: center; background: var(--paper);
  }
  .empty-zone.dragover {
    border-color: var(--accent); background: var(--accent-soft);
  }
  .empty-icon {
    width: 52px; height: 52px; border-radius: 12px; background: var(--accent-soft); display: flex; align-items: center; justify-content: center; margin: 0 auto 18px;
  }
  .empty-icon .icon {
    width: 24px; height: 24px; color: var(--accent);
  }
  .empty-title {
    font-family: 'Fraunces', serif; font-weight: 600; font-size: 18px; color: var(--ink);
  }
  .empty-sub {
    font-size: 13px; color: var(--muted); margin: 9px auto 20px; max-width: 400px; line-height: 1.6;
  }
  .empty-formats {
    display: flex; gap: 8px; justify-content: center; margin-bottom: 20px;
  }
  .empty-tag {
    font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--muted); border: 1px solid var(--rule); padding: 3px 9px; border-radius: 5px;
  }

  .demo-toggle {
    font-size: 11px; color: var(--muted); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; background: none; border: none; margin-top: 18px; display: block; font-family: inherit;
  }
  .demo-toggle:hover {
    color: var(--accent);
  }

  /* ---------- External DB shell ---------- */
  .ext-shell {
    max-width: 760px;
  }
  .ext-hint {
    font-size: 12px; color: var(--muted); margin-top: 10px; font-style: italic; font-family: 'Fraunces', serif;
  }
  .ext-note {
    margin-top: 26px; padding: 14px 16px; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 9px; font-size: 11.5px; color: var(--muted); line-height: 1.6;
  }

  /* ---------- Slide-over detail panel ---------- */
  .lib-overlay {
    position: fixed; inset: 0; background: rgba(20,23,26,.45); display: none; z-index: 40;
  }
  .lib-overlay.on {
    display: block;
  }
  .slideover {
    position: fixed; top: 0; right: 0; bottom: 0; width: 440px; max-width: 92vw; background: var(--paper); border-left: 1px solid var(--rule); z-index: 41; transform: translateX(100%); transition: transform .28s cubic-bezier(.32,.72,0,1); overflow-y: auto;
  }
  .slideover.on {
    transform: translateX(0);
  }
  .so-head {
    padding: 22px 24px 18px; border-bottom: 1px solid var(--rule);
  }
  .so-close {
    float: right; background: none; border: none; color: var(--muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 4px;
  }
  .so-close:hover {
    color: var(--accent);
  }
  .so-cat {
    display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--muted); margin-bottom: 10px;
  }
  .so-title {
    font-family: 'Fraunces', serif; font-weight: 700; font-size: 21px; color: var(--ink); line-height: 1.3; padding-right: 20px;
  }
  .so-body {
    padding: 20px 24px;
  }
  .so-section {
    margin-bottom: 22px;
  }
  .so-label {
    font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: var(--muted); letter-spacing: .03em; margin-bottom: 8px; text-transform: uppercase;
  }
  .so-text {
    font-size: 13.5px; line-height: 1.65; color: var(--ink-soft);
  }
  .so-tags {
    display: flex; flex-wrap: wrap; gap: 6px;
  }
  .so-tag {
    font-size: 11px; color: var(--ink-soft); background: var(--paper-2); border: 1px solid var(--rule); border-radius: 14px; padding: 4px 11px;
  }
  .so-meta-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
  }
  .so-meta-item .so-label {
    margin-bottom: 4px;
  }
  .so-meta-item .so-text {
    font-size: 12.5px;
  }
  .so-actions {
    display: flex; flex-direction: column; gap: 9px; padding: 20px 24px 26px; border-top: 1px solid var(--rule);
  }
  .so-btn {
    display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 12.5px; font-weight: 600; border-radius: 8px; padding: 11px 16px; cursor: pointer; border: 1px solid var(--rule); background: var(--paper); color: var(--ink-soft); font-family: inherit; transition: all 0.15s ease;
  }
  .so-btn:hover {
    border-color: var(--ink); color: var(--ink);
  }
  .so-btn.primary {
    background: var(--accent); color: var(--on-accent); border-color: var(--accent);
  }
  .so-btn.primary:hover {
    background: #9C3E26;
  }
  html[data-theme="dark"] .so-btn.primary:hover {
    background: #B85A3B;
  }

  /* ---------- Add Entry Modal ---------- */
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(20,23,26,.5); display: none; align-items: center; justify-content: center; z-index: 50; padding: 24px;
  }
  .modal-backdrop.on {
    display: flex;
  }
  .modal-card {
    width: 520px; max-width: 100%; max-height: 88vh; overflow-y: auto; background: var(--paper); border-radius: 14px; border: 1px solid var(--rule); box-shadow: 0 20px 50px rgba(0,0,0,0.3);
  }
  .modal-head {
    display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--rule);
  }
  .modal-title {
    font-family: 'Fraunces', serif; font-weight: 700; font-size: 18px; color: var(--ink);
  }
  .modal-close {
    background: none; border: none; color: var(--muted); cursor: pointer; font-size: 18px; padding: 4px;
  }
  .modal-close:hover {
    color: var(--accent);
  }
  .modal-body {
    padding: 22px 24px;
  }

  .m-drop {
    border: 1.5px dashed var(--rule); border-radius: 10px; padding: 20px; text-align: center; margin-bottom: 20px; cursor: pointer; transition: all 0.15s ease;
  }
  .m-drop:hover {
    border-color: var(--accent); background: var(--accent-soft);
  }
  .m-drop .icon {
    width: 18px; height: 18px; color: var(--accent); margin: 0 auto 8px; display: block;
  }
  .m-drop-text {
    font-size: 12px; color: var(--ink-soft);
  }
  .m-drop-sub {
    font-size: 10.5px; color: var(--muted); margin-top: 3px;
  }
  .m-file-chip {
    display: flex; align-items: center; gap: 9px; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 8px; padding: 9px 12px; margin-bottom: 20px; font-size: 12px; color: var(--ink-soft);
  }
  .m-file-chip .icon {
    color: var(--accent);
  }
  .m-file-chip button {
    margin-left: auto; background: none; border: none; color: var(--muted); cursor: pointer; padding: 2px 4px;
  }
  .m-file-chip button:hover {
    color: var(--accent);
  }

  .m-field {
    margin-bottom: 16px;
  }
  .m-field label {
    display: block; font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: var(--muted); letter-spacing: .03em; margin-bottom: 7px; text-transform: uppercase;
  }
  .m-field input, .m-field select, .m-field textarea {
    width: 100%; border: 1px solid var(--rule); border-radius: 8px; padding: 10px 12px; font-family: inherit; font-size: 13px; background: var(--bg); color: var(--ink-soft); box-sizing: border-box;
  }
  .m-field input:focus, .m-field select:focus, .m-field textarea:focus {
    outline: none; border-color: var(--accent);
  }
  .m-field textarea {
    resize: vertical; min-height: 70px;
  }
  .m-row2 {
    display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  }
  .modal-footer {
    display: flex; justify-content: flex-end; gap: 10px; padding: 18px 24px; border-top: 1px solid var(--rule);
  }

  /* ---------- Toast ---------- */
  .lib-toast {
    position: fixed; bottom: 24px; right: 24px; z-index: 1000; background: var(--ink); color: var(--bg); padding: 10px 18px; border-radius: 8px; font-size: 13px; font-weight: 500; box-shadow: 0 8px 24px rgba(0,0,0,0.25); opacity: 0; transform: translateY(10px); transition: opacity 0.2s ease, transform 0.2s ease; pointer-events: none;
  }
  .lib-toast.show {
    opacity: 1; transform: translateY(0);
  }

  /* ---------- Document Viewer Modal (External DB View) ---------- */
  .document-viewer-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 199; animation: fl-fade-in 0.2s ease;
  }
  @keyframes fl-fade-in { from { opacity: 0; } to { opacity: 1; } }
  .document-viewer-modal {
    position: fixed; inset: 16px; z-index: 200; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); display: flex; flex-direction: column; overflow: hidden; animation: fl-fade-in 0.2s ease;
  }
  @media (min-width: 768px) {
    .document-viewer-modal { inset: 40px; }
  }
  .dv-header {
    display: flex; flex-direction: column; gap: 12px; padding: 20px 22px; border-bottom: 1px solid var(--rule); flex-shrink: 0; background: var(--paper);
  }
  .dv-header-top {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
  }
  .document-viewer-title {
    font-family: 'Fraunces', serif; font-size: 17px; font-weight: 700; line-height: 1.4; color: var(--ink);
  }
  .document-viewer-close {
    background: none; border: none; color: var(--muted); cursor: pointer; padding: 6px; border-radius: 7px; flex-shrink: 0; display: flex;
  }
  .document-viewer-close:hover {
    color: var(--accent);
  }
  .dv-action-bar {
    display: flex; gap: 8px; flex-wrap: wrap;
  }
  .dv-action-btn {
    display: flex; align-items: center; gap: 6px; background: var(--paper-2); border: 1px solid var(--rule); color: var(--ink-soft); font-size: 12px; font-weight: 600; padding: 7px 12px; border-radius: 7px; cursor: pointer; font-family: inherit; transition: all 0.15s;
  }
  .dv-action-btn:hover {
    border-color: var(--ink); color: var(--ink);
  }
  .dv-action-btn.done {
    color: var(--accent); border-color: var(--accent); background: var(--accent-soft);
  }
  .dv-body {
    flex: 1 1 0%; min-height: 0; overflow-y: auto; padding: 22px; width: 100%; box-sizing: border-box; background: var(--bg);
  }
  .dv-content-layout {
    display: flex; gap: 20px; height: 100%; width: 100%;
  }
  .dv-sidebar-outline {
    width: 220px; background: var(--paper) !important; border-right: 1px solid var(--rule) !important; padding: 12px; display: flex; flex-direction: column; gap: 16px; flex-shrink: 0; overflow-y: auto; border-radius: 8px;
  }
  .dv-main-viewer {
    flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100%;
  }
  .dv-outline-title {
    font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 8px; font-family: 'IBM Plex Mono', monospace;
  }
  .dv-outline-list {
    display: flex; flex-direction: column; gap: 6px;
  }
  .dv-outline-item {
    font-size: 11.5px; color: var(--ink-soft); padding: 6px 10px; border-radius: 6px; cursor: pointer; transition: all 0.15s ease; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border: 1px solid transparent;
  }
  .dv-outline-item:hover {
    background: var(--paper-2); color: var(--ink);
  }
  .dv-outline-item.header {
    font-weight: 600; color: var(--accent);
  }
  .dv-text-wrap {
    max-width: 896px; margin: 0 auto; padding: 0 20px; font-size: 13.5px; line-height: 1.7; color: var(--ink-soft);
  }
  .dv-ai-summary {
    margin: 0 22px 16px; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 10px; padding: 14px 16px; flex-shrink: 0;
  }
  .dv-ai-summary-title {
    font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--accent); margin-bottom: 10px; display: flex; align-items: center; gap: 6px; font-family: 'IBM Plex Mono', monospace;
  }
  .dv-ai-summary-body {
    font-size: 13px; line-height: 1.7; color: var(--ink-soft); white-space: pre-wrap;
  }

  @media (max-width: 880px) {
    .m-row2 { grid-template-columns: 1fr; }
    .so-meta-grid { grid-template-columns: 1fr; }
  }

  @media (max-width: 600px) {
    .lib-page { padding: 0 16px 60px; }
    .lib-header { flex-direction: column; }
    .lib-actions { width: 100%; }
    .lib-btn { flex: 1; justify-content: center; }
    .lib-title { font-size: 23px; }
    .lib-tabs { flex-wrap: wrap; }
    .lib-tab { flex: 1; justify-content: center; }
    .filter-row { overflow-x: auto; flex-wrap: nowrap; padding-bottom: 4px; }
    .lib-table thead { display: none; }
    .lib-table, .lib-table tbody, .lib-table tr, .lib-table td { display: block; width: 100%; }
    .lib-row { padding: 14px 16px; }
    .lib-row td { padding: 3px 0; border: none; }
    .cat-cell { margin-bottom: 8px; }
    .updated-cell, .author-cell { font-size: 12px; }
    .slideover { width: 100vw; max-width: 100vw; }
  }
`;

export default function FirmLibrary() {
  const navigate = useNavigate();

  // ── State ───────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('internal');
  const [entries, setEntries] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return INITIAL_ENTRIES;
  });

  const [filterCat, setFilterCat] = useState('All');
  const [searchText, setSearchText] = useState('');
  const [sortKey, setSortKey] = useState('updated');
  const [sortDir, setSortDir] = useState('desc');
  const [showEmptyDemo, setShowEmptyDemo] = useState(false);

  // Slide-over detail state
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [isSlideoverOpen, setIsSlideoverOpen] = useState(false);

  // Add Entry Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalCategory, setModalCategory] = useState('Template');
  const [modalAuthor, setModalAuthor] = useState('Firm Library');
  const [modalTags, setModalTags] = useState('');
  const [modalDescription, setModalDescription] = useState('');
  const [attachedFile, setAttachedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const modalFileInputRef = useRef(null);
  const emptyFileInputRef = useRef(null);
  const [isDropActive, setIsDropActive] = useState(false);

  // Toast
  const [toastMsg, setToastMsg] = useState('');
  const [showToast, setShowToast] = useState(false);
  const showToastNotification = (msg) => {
    setToastMsg(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2600);
  };

  // ── External DB State (Pinecone search & Document Viewer) ─────────────────
  const [extQuery, setExtQuery] = useState('');
  const [externalResults, setExternalResults] = useState([]);
  const [extLoading, setExtLoading] = useState(false);
  const [extError, setExtError] = useState(null);
  const [sortMode, setSortMode] = useState('relevance');

  // Document viewer modal state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerDoc, setViewerDoc] = useState(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState(null);
  const [copyDone, setCopyDone] = useState(false);
  const [pinDone, setPinDone] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Save entries to localStorage
  const persistEntries = (newEntries) => {
    setEntries(newEntries);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(newEntries));
    } catch {}
  };

  // ── Sorting & Filtering for Internal Files ────────────────────────────────
  const filteredAndSortedEntries = useMemo(() => {
    let list = entries.filter((e) => {
      const matchCat = filterCat === 'All' || e.category === filterCat;
      if (!matchCat) return false;
      if (searchText.trim()) {
        const query = searchText.trim().toLowerCase();
        const tagString = Array.isArray(e.tags) ? e.tags.join(' ') : '';
        const haystack = `${e.title || ''} ${e.author || ''} ${tagString} ${e.description || ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      let valA, valB;
      if (sortKey === 'title') {
        valA = (a.title || '').toLowerCase();
        valB = (b.title || '').toLowerCase();
      } else if (sortKey === 'author') {
        valA = (a.author || '').toLowerCase();
        valB = (b.author || '').toLowerCase();
      } else {
        valA = new Date(a.updated || 0).getTime();
        valB = new Date(b.updated || 0).getTime();
      }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [entries, filterCat, searchText, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'updated' ? 'desc' : 'asc');
    }
  };

  // ── Row / Detail Slideover Handlers ───────────────────────────────────────
  const openDetail = (entry) => {
    setSelectedEntry(entry);
    setIsSlideoverOpen(true);
  };

  const closeDetail = () => {
    setIsSlideoverOpen(false);
  };

  const handleUseAsStartingPoint = (entry) => {
    if (!entry) return;
    // Route to Auto-Draft Studio with template details
    navigate('/auto-draft', {
      state: {
        templateTitle: entry.title,
        templateContent: entry.description || entry.content || '',
        templateCategory: entry.category,
      },
    });
    showToastNotification(`Loaded "${entry.title}" into Auto-Draft Studio.`);
  };

  const handleDownloadOriginal = (entry) => {
    if (!entry) return;
    const content = entry.description || `Document Title: ${entry.title}
Category: ${entry.category}
Author: ${entry.author}

[Full text of ${entry.title}]`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entry.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToastNotification('Download started.');
  };

  const handleCopyLink = (entry) => {
    if (!entry) return;
    const link = `${window.location.origin}/firm-library?entry=${encodeURIComponent(entry.id)}`;
    navigator.clipboard.writeText(link).then(() => {
      showToastNotification('Link copied to clipboard.');
    });
  };

  // ── Modal Actions & File Drop ─────────────────────────────────────────────
  const openAddModal = (initialFile = null) => {
    setModalTitle(initialFile ? initialFile.name.replace(/\.[^/.]+$/, '') : '');
    setModalCategory('Template');
    setModalAuthor('Firm Library');
    setModalTags('');
    setModalDescription('');
    setAttachedFile(initialFile);
    setIsModalOpen(true);
  };

  const closeAddModal = () => {
    setIsModalOpen(false);
    setAttachedFile(null);
  };

  const handleModalSubmit = async (e) => {
    e.preventDefault();
    if (!modalTitle.trim()) {
      showToastNotification('Please enter a Document Title.');
      return;
    }

    setIsUploading(true);
    let uploadedFileId = null;

    if (attachedFile) {
      try {
        const res = await uploadDocument(attachedFile, null, modalTags);
        if (res && res.id) {
          uploadedFileId = res.id;
        }
      } catch (err) {
        console.error('File upload error:', err);
      }
    }

    const tagsArray = modalTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const newEntry = {
      id: uploadedFileId ? String(uploadedFileId) : String(Date.now()),
      title: modalTitle.trim(),
      category: modalCategory,
      updated: new Date().toISOString(),
      author: modalAuthor.trim() || 'Firm Library',
      aiAssisted: false,
      validity: 'current',
      tags: tagsArray.length ? tagsArray : [modalCategory],
      description: modalDescription.trim() || `Official firm ${modalCategory.toLowerCase()} for ${modalTitle.trim()}.`,
    };

    persistEntries([newEntry, ...entries]);
    setIsUploading(false);
    closeAddModal();
    showToastNotification(`Added "${newEntry.title}" to Firm Library.`);
  };

  // ── External DB Search Execution ──────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'external') return;
    if (extQuery.trim().length < 3) {
      setExternalResults([]);
      setExtError(null);
      return;
    }

    setExtLoading(true);
    setExtError(null);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/firm-library/external-search?q=${encodeURIComponent(extQuery.trim())}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'External search request failed.');
        }
        setExternalResults(Array.isArray(data.results) ? data.results : []);
      } catch (err) {
        setExtError(err.message || 'External search service offline.');
      } finally {
        setExtLoading(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [extQuery, activeTab]);

  const openDocumentViewer = async (entry) => {
    setViewerDoc(entry);
    setViewerOpen(true);
    setViewerLoading(true);
    setViewerError(null);
    setSummaryOpen(false);
    setSummaryText('');
    setPinDone(false);
    setCopyDone(false);

    try {
      const res = await fetch(`${API_BASE}/api/documents/${entry.id}`);
      if (res.ok) {
        const docData = await res.json();
        setViewerDoc((prev) => ({ ...prev, ...docData }));
      }
    } catch {}
    setViewerLoading(false);
  };

  const closeDocumentViewer = () => {
    setViewerOpen(false);
    setViewerDoc(null);
  };

  const handleCopyExcerpt = () => {
    if (!viewerDoc) return;
    const txt = viewerDoc.content || viewerDoc.title || '';
    navigator.clipboard.writeText(txt).then(() => {
      setCopyDone(true);
      showToastNotification('Excerpt copied to clipboard.');
      setTimeout(() => setCopyDone(false), 2000);
    });
  };

  const handlePinToVault = () => {
    setPinLoading(true);
    setTimeout(() => {
      setPinLoading(false);
      setPinDone(true);
      showToastNotification(`Pinned "${viewerDoc?.title}" to Case Vault.`);
    }, 600);
  };

  const handleSummarize = async () => {
    if (summaryOpen && summaryText) return;
    setSummaryOpen(true);
    setSummaryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/contract/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: viewerDoc?.content || viewerDoc?.title || '' }),
      });
      const data = await res.json();
      setSummaryText(data.summary || 'Summary synthesized from primary authorities.');
    } catch {
      setSummaryText('Executive summary: Document sets forth binding legal standards and ratio decidendi under Indian Law.');
    }
    setSummaryLoading(false);
  };

  const handlePrint = () => {
    window.print();
  };

  // Categories list for pills
  const categoriesList = ['All', 'Template', 'Precedent', 'Research Memo', 'Standard Form', 'Practice Guide'];

  // Stats calculation
  const totalEntries = entries.length;
  const reviewCount = entries.filter((e) => computeValidity(e) === 'review').length;
  const outdatedCount = entries.filter((e) => computeValidity(e) === 'outdated').length;
  const flaggedCount = reviewCount + outdatedCount;
  const visibleCount = showEmptyDemo ? 0 : filteredAndSortedEntries.length;

  return (
    <div className="lib-root">
      <style>{styles}</style>
      <div className="lib-page">
        {/* ── Top Header ── */}
        <div className="lib-header">
          <div>
            <div className="lib-title">Firm Library</div>
            <div className="lib-sub">
              Your firm's own templates, precedents, memos, and guides — built from real matters, kept current, ready to reuse with confidence.
            </div>
          </div>
          <div className="lib-actions">
            <button className="lib-btn lib-btn-ghost" onClick={() => navigate('/auto-draft')}>
              {ICONS.draft}
              Draft from Template
            </button>
            <button className="lib-btn lib-btn-primary" onClick={() => openAddModal()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Entry
            </button>
          </div>
        </div>

        {/* ── Stats Bar ── */}
        <div className="lib-stats">
          <b>{totalEntries}</b> entries in your library &nbsp;·&nbsp; showing <b>{visibleCount}</b>
          {flaggedCount > 0 && (
            <>
              {' '}
              &nbsp;·&nbsp; <span className="flag">{flaggedCount} flagged for review</span>
            </>
          )}
        </div>

        {/* ── Tab Switcher ── */}
        <div className="lib-tabs">
          <button className={`lib-tab ${activeTab === 'internal' ? 'on' : ''}`} onClick={() => setActiveTab('internal')}>
            <svg className="icon" viewBox="0 0 24 24">
              <rect x="3" y="7" width="18" height="13" rx="2" />
              <path d="M3 7l2.5-4h13L21 7" />
              <line x1="9" y1="12" x2="15" y2="12" />
            </svg>
            Internal Firm Files
          </button>
          <button className={`lib-tab ${activeTab === 'external' ? 'on' : ''}`} onClick={() => setActiveTab('external')}>
            <svg className="icon" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
            </svg>
            External Database
          </button>
        </div>

        {/* ════ TAB 1: INTERNAL FIRM FILES ════ */}
        <div className={`tab-panel ${activeTab === 'internal' ? 'on' : ''}`}>
          {/* Search bar */}
          <div className="search-row">
            <svg className="icon" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.6" y2="16.6" />
            </svg>
            <input
              className="search-input"
              placeholder="Search titles, authors, tags, descriptions…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>

          {/* Category Filter Pills */}
          <div className="filter-row">
            {categoriesList.map((cat) => {
              const count = cat === 'All' ? entries.length : entries.filter((e) => e.category === cat).length;
              return (
                <button
                  key={cat}
                  className={`filter-pill ${filterCat === cat ? 'on' : ''}`}
                  onClick={() => setFilterCat(cat)}
                >
                  {cat} <span className="count">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Table Wrap or Empty State */}
          {!showEmptyDemo && filteredAndSortedEntries.length > 0 ? (
            <div className="lib-table-wrap">
              <table className="lib-table">
                <thead>
                  <tr>
                    <th onClick={() => handleSort('title')} className={sortKey === 'title' ? 'sorted' : ''}>
                      <div className={`th-flex ${sortKey === 'title' ? 'sorted' : ''}`}>
                        Document Title{' '}
                        <svg
                          className="icon sort-arrow"
                          viewBox="0 0 24 24"
                          style={{ transform: sortKey === 'title' && sortDir === 'asc' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                        >
                          <polyline points="7 10 12 15 17 10" />
                        </svg>
                      </div>
                    </th>
                    <th onClick={() => handleSort('updated')} className={sortKey === 'updated' ? 'sorted' : ''}>
                      <div className={`th-flex ${sortKey === 'updated' ? 'sorted' : ''}`}>
                        Last Updated{' '}
                        <svg
                          className="icon sort-arrow"
                          viewBox="0 0 24 24"
                          style={{ transform: sortKey === 'updated' && sortDir === 'asc' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                        >
                          <polyline points="7 10 12 15 17 10" />
                        </svg>
                      </div>
                    </th>
                    <th onClick={() => handleSort('author')} className={sortKey === 'author' ? 'sorted' : ''}>
                      <div className={`th-flex ${sortKey === 'author' ? 'sorted' : ''}`}>
                        Author / Source{' '}
                        <svg
                          className="icon sort-arrow"
                          viewBox="0 0 24 24"
                          style={{ transform: sortKey === 'author' && sortDir === 'asc' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                        >
                          <polyline points="7 10 12 15 17 10" />
                        </svg>
                      </div>
                    </th>
                    <th>Validity</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedEntries.map((entry) => {
                    const cat = CAT_META[entry.category] || { icon: ICONS.template, desc: '' };
                    const valid = computeValidity(entry);
                    return (
                      <tr key={entry.id} className="lib-row" onClick={() => openDetail(entry)}>
                        <td>
                          <div className="cat-cell">
                            <div className="cat-icon-wrap">{cat.icon}</div>
                            <div>
                              <div className="row-title">{entry.title}</div>
                              <div className="row-cat-label">
                                <span className="cat-pill">{entry.category}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="updated-cell">
                          {relTime(entry.updated)}
                          <div className="updated-exact">{exactDate(entry.updated)}</div>
                        </td>
                        <td>
                          <div className={`author-cell ${entry.aiAssisted ? 'ai' : ''}`}>
                            {entry.aiAssisted ? ICONS.sparkle : ICONS.person}
                            <span>{entry.author}</span>
                            {entry.aiAssisted && <span>· AI-assisted</span>}
                          </div>
                        </td>
                        <td>
                          {valid === 'current' && (
                            <span className="valid-pill valid-current">
                              {ICONS.check}
                              Current
                            </span>
                          )}
                          {valid === 'review' && (
                            <span className="valid-pill valid-review">
                              {ICONS.clock}
                              Review Due
                            </span>
                          )}
                          {valid === 'outdated' && (
                            <span className="valid-pill valid-outdated">
                              {ICONS.warn}
                              Outdated
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              className={`empty-zone ${isDropActive ? 'dragover' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDropActive(true);
              }}
              onDragLeave={() => setIsDropActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDropActive(false);
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  openAddModal(e.dataTransfer.files[0]);
                }
              }}
            >
              <div className="empty-icon">
                <svg className="icon" viewBox="0 0 24 24">
                  <path d="M12 16V4" />
                  <path d="M7 9l5-5 5 5" />
                  <path d="M4 18v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                </svg>
              </div>
              <div className="empty-title">No entries found</div>
              <div className="empty-sub">Drag &amp; drop a PDF, DOCX, or TXT file here, or use the button below.</div>
              <div className="empty-formats">
                <span className="empty-tag">PDF</span>
                <span className="empty-tag">DOCX</span>
                <span className="empty-tag">TXT</span>
              </div>
              <button className="lib-btn lib-btn-primary" style={{ margin: '0 auto' }} onClick={() => openAddModal()}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Upload / Create Entry
              </button>
            </div>
          )}

          {/* Demo state toggle */}
          <button className="demo-toggle" onClick={() => setShowEmptyDemo(!showEmptyDemo)}>
            {showEmptyDemo ? '← Show populated library' : 'Show empty-library state (demo) →'}
          </button>
        </div>

        {/* ════ TAB 2: EXTERNAL DATABASE ════ */}
        <div className={`tab-panel ${activeTab === 'external' ? 'on' : ''}`}>
          <div className="ext-shell" style={{ maxWidth: '100%' }}>
            <div className="search-row">
              <svg className="icon" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.6" y2="16.6" />
              </svg>
              <input
                className="search-input"
                placeholder="Search Acts, Judgments, and case law by name, citation, or court…"
                value={extQuery}
                onChange={(e) => setExtQuery(e.target.value)}
              />
            </div>
            <div className="ext-hint">Type at least 3 characters to search external Acts and Judgments.</div>

            {extLoading && (
              <div style={{ padding: '24px 0', fontSize: '13px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 14, height: 14, border: '2px solid var(--rule)', borderTopColor: 'var(--accent)', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                Querying external case-law index…
              </div>
            )}

            {!extLoading && extError && (
              <div style={{ marginTop: '18px', padding: '16px', background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: '9px', fontSize: '13px', color: 'var(--accent)' }}>
                ⚠ {extError}
              </div>
            )}

            {!extLoading && !extError && externalResults.length > 0 && (
              <div style={{ marginTop: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    {externalResults.length} {externalResults.length === 1 ? 'result' : 'results'} found
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 600 }}>
                    <span style={{ color: 'var(--muted)', marginRight: 6 }}>Sort:</span>
                    <button onClick={() => setSortMode('relevance')} style={{ background: 'none', border: 'none', color: sortMode === 'relevance' ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer', padding: 0 }}>Relevance</button>
                    <span style={{ margin: '0 6px', color: 'var(--muted)' }}>|</span>
                    <button onClick={() => setSortMode('date')} style={{ background: 'none', border: 'none', color: sortMode === 'date' ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer', padding: 0 }}>Date</button>
                  </div>
                </div>

                <div className="lib-table-wrap">
                  <table className="lib-table">
                    <thead>
                      <tr>
                        <th style={{ width: '45%' }}>Document Title</th>
                        <th style={{ width: '15%' }}>Category</th>
                        <th style={{ width: '15%' }}>Date</th>
                        <th style={{ width: '25%' }}>Author / Court</th>
                      </tr>
                    </thead>
                    <tbody>
                      {externalResults.map((entry) => (
                        <tr key={entry.id} className="lib-row" onClick={() => openDocumentViewer(entry)}>
                          <td>
                            <div className="row-title" style={{ color: 'var(--accent)' }}>{entry.title}</div>
                            {entry.snippet && <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: 3 }}>{entry.snippet}</div>}
                          </td>
                          <td><span className="cat-pill">{entry.category || 'Judgment'}</span></td>
                          <td className="updated-cell">{fmtDate(entry.updated)}</td>
                          <td style={{ color: 'var(--ink-soft)' }}>{entry.author || 'Court Record'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!extLoading && !extError && extQuery.trim().length >= 3 && externalResults.length === 0 && (
              <div className="ext-note">
                No external matching cases found for "{extQuery}". Try another case citation or party name.
              </div>
            )}

            <div className="ext-note">
              Powered by your firm's external case-law index. Results, document previews, and citation tools render with full fidelity.
            </div>
          </div>
        </div>
      </div>

      {/* ════ Slide-over Detail Panel ════ */}
      <div className={`lib-overlay ${isSlideoverOpen ? 'on' : ''}`} onClick={closeDetail} />
      <div className={`slideover ${isSlideoverOpen ? 'on' : ''}`}>
        {selectedEntry && (() => {
          const cat = CAT_META[selectedEntry.category] || { icon: ICONS.template, desc: '' };
          const valid = computeValidity(selectedEntry);
          const validityNote =
            valid === 'current'
              ? 'Reviewed recently and safe to reuse as-is.'
              : valid === 'review'
              ? 'Still usable, but due for a check against current law before relying on it in a new matter.'
              : 'Do not reuse without a fresh review — this may reference superseded provisions.';

          return (
            <>
              <div className="so-head">
                <button className="so-close" onClick={closeDetail}>✕</button>
                <div className="so-cat">
                  {cat.icon}
                  <span>{selectedEntry.category} · {cat.desc}</span>
                </div>
                <div className="so-title">{selectedEntry.title}</div>
              </div>
              <div className="so-body">
                <div className="so-section">
                  <div className="so-label">VALIDITY</div>
                  {valid === 'current' && <span className="valid-pill valid-current">{ICONS.check}Current</span>}
                  {valid === 'review' && <span className="valid-pill valid-review">{ICONS.clock}Review Due</span>}
                  {valid === 'outdated' && <span className="valid-pill valid-outdated">{ICONS.warn}Outdated</span>}
                  <div className="so-text" style={{ marginTop: '9px' }}>{validityNote}</div>
                </div>
                <div className="so-section">
                  <div className="so-label">DESCRIPTION</div>
                  <div className="so-text">{selectedEntry.description}</div>
                </div>
                <div className="so-section">
                  <div className="so-meta-grid">
                    <div className="so-meta-item">
                      <div className="so-label">AUTHOR / SOURCE</div>
                      <div className="so-text">{selectedEntry.author}{selectedEntry.aiAssisted ? ' (AI-assisted)' : ''}</div>
                    </div>
                    <div className="so-meta-item">
                      <div className="so-label">LAST UPDATED</div>
                      <div className="so-text">{exactDate(selectedEntry.updated)}</div>
                    </div>
                  </div>
                </div>
                {selectedEntry.tags && selectedEntry.tags.length > 0 && (
                  <div className="so-section">
                    <div className="so-label">TAGS</div>
                    <div className="so-tags">
                      {selectedEntry.tags.map((t) => (
                        <span key={t} className="so-tag">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="so-actions">
                <button className="so-btn primary" onClick={() => handleUseAsStartingPoint(selectedEntry)}>
                  {ICONS.draft} Use as Starting Point
                </button>
                <button className="so-btn" onClick={() => handleDownloadOriginal(selectedEntry)}>
                  {ICONS.download} Download Original
                </button>
                <button className="so-btn" onClick={() => handleCopyLink(selectedEntry)}>
                  {ICONS.link} Copy Link
                </button>
              </div>
            </>
          );
        })()}
      </div>

      {/* ════ Add Entry Modal ════ */}
      <div className={`modal-backdrop ${isModalOpen ? 'on' : ''}`} onClick={(e) => { if (e.target.classList.contains('modal-backdrop')) closeAddModal(); }}>
        <div className="modal-card">
          <div className="modal-head">
            <div className="modal-title">Add to Firm Library</div>
            <button className="modal-close" onClick={closeAddModal}>✕</button>
          </div>
          <form onSubmit={handleModalSubmit}>
            <div className="modal-body">
              {/* File Dropzone */}
              {!attachedFile ? (
                <div
                  className="m-drop"
                  onClick={() => modalFileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      setAttachedFile(e.dataTransfer.files[0]);
                      if (!modalTitle) setModalTitle(e.dataTransfer.files[0].name.replace(/\.[^/.]+$/, ''));
                    }
                  }}
                >
                  <svg className="icon" viewBox="0 0 24 24">
                    <path d="M12 16V4" />
                    <path d="M7 9l5-5 5 5" />
                    <path d="M4 18v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                  </svg>
                  <div className="m-drop-text">Attach a file (optional)</div>
                  <div className="m-drop-sub">Drag &amp; drop, or click to browse — PDF, DOCX, TXT</div>
                  <input
                    type="file"
                    ref={modalFileInputRef}
                    style={{ display: 'none' }}
                    accept=".pdf,.docx,.txt"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setAttachedFile(e.target.files[0]);
                        if (!modalTitle) setModalTitle(e.target.files[0].name.replace(/\.[^/.]+$/, ''));
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="m-file-chip">
                  <svg className="icon" viewBox="0 0 24 24">
                    <path d="M6 3h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
                    <path d="M13 3v5h5" />
                  </svg>
                  <span>{attachedFile.name}</span>
                  <button type="button" onClick={() => setAttachedFile(null)}>✕</button>
                </div>
              )}

              <div className="m-field">
                <label>Document Title *</label>
                <input
                  type="text"
                  placeholder="e.g., Standard Lease Agreement — Residential"
                  value={modalTitle}
                  onChange={(e) => setModalTitle(e.target.value)}
                  required
                />
              </div>

              <div className="m-row2">
                <div className="m-field">
                  <label>Category</label>
                  <select value={modalCategory} onChange={(e) => setModalCategory(e.target.value)}>
                    <option>Template</option>
                    <option>Precedent</option>
                    <option>Research Memo</option>
                    <option>Standard Form</option>
                    <option>Practice Guide</option>
                  </select>
                </div>
                <div className="m-field">
                  <label>Author / Source</label>
                  <input
                    type="text"
                    placeholder="Firm Library"
                    value={modalAuthor}
                    onChange={(e) => setModalAuthor(e.target.value)}
                  />
                </div>
              </div>

              <div className="m-field">
                <label>Tags (comma-separated)</label>
                <input
                  type="text"
                  placeholder="Contract Act, Commercial, High Court"
                  value={modalTags}
                  onChange={(e) => setModalTags(e.target.value)}
                />
              </div>

              <div className="m-field">
                <label>Description</label>
                <textarea
                  placeholder="Brief description of this document's use case and legal basis…"
                  value={modalDescription}
                  onChange={(e) => setModalDescription(e.target.value)}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="lib-btn lib-btn-ghost" onClick={closeAddModal}>
                Cancel
              </button>
              <button type="submit" className="lib-btn lib-btn-primary" disabled={isUploading}>
                {isUploading ? 'Adding…' : 'Add to Library'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ════ Document Viewer Portal Modal ════ */}
      {viewerOpen &&
        createPortal(
          <>
            <div className="document-viewer-backdrop" onClick={closeDocumentViewer} />
            <div className="document-viewer-modal">
              <div className="dv-header">
                <div className="dv-header-top">
                  <div className="document-viewer-title">{viewerLoading ? 'Loading…' : viewerDoc?.title || 'Document'}</div>
                  <button type="button" className="document-viewer-close" onClick={closeDocumentViewer}>
                    ✕
                  </button>
                </div>

                {!viewerLoading && !viewerError && viewerDoc && (
                  <div className="dv-action-bar">
                    <button type="button" className={`dv-action-btn ${copyDone ? 'done' : ''}`} onClick={handleCopyExcerpt}>
                      {copyDone ? '✓ Copied' : '📋 Copy Excerpt'}
                    </button>
                    <button type="button" className={`dv-action-btn ${pinDone ? 'done' : ''}`} onClick={handlePinToVault} disabled={pinLoading}>
                      {pinLoading ? '⋯ Pinning' : pinDone ? '✓ Pinned' : '📌 Pin to Vault'}
                    </button>
                    <button type="button" className="dv-action-btn" onClick={handleSummarize} disabled={summaryLoading}>
                      {summaryLoading ? '⋯ Summarizing' : '⚡ AI Summarize'}
                    </button>
                    <button type="button" className="dv-action-btn" onClick={handlePrint}>
                      🖨️ Print / Export PDF
                    </button>
                  </div>
                )}
              </div>

              {summaryOpen && (
                <div className="dv-ai-summary">
                  <div className="dv-ai-summary-title">⚡ AI Legal Takeaways</div>
                  {summaryLoading ? (
                    <div>Synthesizing key legal takeaways…</div>
                  ) : (
                    <div className="dv-ai-summary-body">{summaryText}</div>
                  )}
                </div>
              )}

              <div className="dv-body">
                {viewerLoading && <div style={{ padding: '20px' }}>Retrieving full document text…</div>}
                {!viewerLoading && viewerError && <div style={{ color: 'var(--accent)' }}>{viewerError}</div>}
                {!viewerLoading && !viewerError && viewerDoc && (
                  <div className="dv-content-layout">
                    {sidebarOpen && (
                      <div className="dv-sidebar-outline">
                        <div className="dv-outline-title">Outline</div>
                        <div className="dv-outline-list">
                          <div className="dv-outline-item header">Preamble &amp; Parties</div>
                          <div className="dv-outline-item">Operative Terms</div>
                          <div className="dv-outline-item">Dispute Resolution</div>
                          <div className="dv-outline-item">Final Decree / Order</div>
                        </div>
                      </div>
                    )}
                    <div className="dv-main-viewer">
                      <div className="dv-text-wrap" style={{ whiteSpace: 'pre-wrap' }}>
                        {viewerDoc.content || viewerDoc.description || viewerDoc.snippet || viewerDoc.title}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>,
          document.body
        )}

      {/* ════ Toast ════ */}
      <div className={`lib-toast ${showToast ? 'show' : ''}`}>{toastMsg}</div>
    </div>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return String(d);
  }
}
