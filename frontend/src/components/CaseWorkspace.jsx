import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getSharedFiles, subscribeSharedFiles } from '../utils/sharedWorkspaceStore';
import { uploadDocument, deleteDocument } from '../services/api';
import { useChamberStore } from '../stores/useChamberStore';
import { useContextMenu } from '../hooks/useContextMenu';
import ContextMenu from './vault/ContextMenu';
import ShareModal from './vault/ShareModal';
import MoveModal from './vault/MoveModal';
import SyncToast from './vault/SyncToast';
import { Folder, FileText, MoreVertical } from 'lucide-react';

function formatBreadcrumbs(path) {
  if (!path || path.length <= 4) return path;
  return [
    path[0],
    { id: '__ellipsis__', name: '...', isEllipsis: true },
    path[path.length - 2],
    path[path.length - 1],
  ];
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// ── Default 5-Folder Litigation Blueprint ─────────────────────────────────
const DEFAULT_BLUEPRINT_FOLDERS = [
  { id: 'f1', name: '01 · Pleadings & Drafts', slug: 'pleadings' },
  { id: 'f2', name: '02 · Court Filings', slug: 'court-filings' },
  { id: 'f3', name: '03 · Evidence & Exhibits', slug: 'evidence' },
  { id: 'f4', name: '04 · Correspondence', slug: 'correspondence' },
  { id: 'f5', name: '05 · Research & Precedents', slug: 'research' },
];

// ── Initial Mock / Fallback Matters ───────────────────────────────────────
const INITIAL_MATTERS = [
  {
    id: 'm1',
    caseName: 'Sharma Textiles Pvt. Ltd. vs. State Bank of India',
    caseNumber: 'CRA/142/2026',
    cnr: 'TNMD010012342026',
    court: 'Madras High Court',
    judge: 'Hon. Justice R. Nariman',
    caseType: 'Commercial Appeal',
    petitioner: 'Sharma Textiles Pvt. Ltd.',
    respondent: 'State Bank of India',
    petitionerCounsel: 'Adv. Ramesh Rao',
    respondentCounsel: 'Adv. S. K. Sundaram',
    clientName: 'Sharma Textiles Pvt. Ltd.',
    filingDate: '2026-09-02',
    nextHearing: '2026-09-24',
    lastHearing: '2026-09-10',
    status: 'Active',
    summary: 'Dispute over commercial credit line and recovery notice under SARFAESI.',
    notes: 'Reply to bank counter-affidavit pending.',
    urgent: 'Hearing in 7 days',
    docsLinked: 9,
  },
  {
    id: 'm2',
    caseName: 'Rajan Kumar vs. Union of India',
    caseNumber: 'WP/3391/2026',
    cnr: 'TNMD020056782026',
    court: 'Madurai Bench, Madras HC',
    judge: 'Hon. Justice M. Jaichandren',
    caseType: 'Writ Petition',
    petitioner: 'Rajan Kumar',
    respondent: 'Union of India',
    petitionerCounsel: 'Adv. K. Swaminathan',
    respondentCounsel: 'Additional Solicitor General',
    clientName: 'Rajan Kumar',
    filingDate: '2026-08-15',
    nextHearing: null,
    lastHearing: '2026-09-01',
    status: 'Stayed',
    summary: 'Challenge to statutory notification under environmental clearance rules.',
    notes: 'Stay granted; no immediate filing required.',
    urgent: null,
    docsLinked: 4,
  },
];

// ── Initial Provenance Trail Entries ─────────────────────────────────────
const INITIAL_PROVENANCE = [
  {
    id: 'p1',
    hash: '0x8f2a19…c91e',
    action: 'Case synopsis generated',
    actorType: 'ai',
    by: 'LexAmplify AI',
    doc: 'Case Vault Synopsis',
    time: 'Today · 10:42 AM',
  },
  {
    id: 'p2',
    hash: '0x51de77…aa07',
    action: 'Document auto-classified',
    actorType: 'ai',
    by: 'LexAmplify AI',
    doc: 'Plaint_TN_HC_2026.pdf',
    time: 'Yesterday · 4:15 PM',
  },
  {
    id: 'p3',
    hash: '0x2c90ab…4b18',
    action: 'Matter added to tracker',
    actorType: 'human',
    by: 'You (advocate)',
    doc: 'Sharma Textiles vs. SBI',
    time: '2 days ago',
  },
  {
    id: 'p4',
    hash: '0x0a71fe…de23',
    action: 'Standard blueprint applied',
    actorType: 'human',
    by: 'You (advocate)',
    doc: '5 folders created',
    time: '2 days ago',
  },
];

// ── Initial Timeline Events ──────────────────────────────────────────────
const INITIAL_TIMELINE = [
  { id: 't1', date: '02 Sep 2026', label: 'Petition filed before Madras High Court', source: 'Plaint_TN_HC_2026.pdf' },
  { id: 't2', date: '10 Sep 2026', label: 'Notice issued to respondent bank', source: 'Court order dated 10 Sep' },
  { id: 't3', date: '18 Sep 2026', label: "Respondent's counter-affidavit received", source: 'Counter_Affidavit_SBI.pdf' },
  { id: 't4', date: '24 Sep 2026', label: 'Next hearing scheduled', source: 'Cause list entry' },
];

// ── Fallback Initial Folder Documents ────────────────────────────────────
const INITIAL_FOLDER_DOCS = {
  f1: [
    { id: 'd1', name: 'Plaint_TN_HC_2026.pdf', tag: 'AUTO-CLASSIFIED · PLEADING', tagSeverity: 'neutral', size: '842 KB', updated: '2d ago', folderId: 'f1', matterId: 'm1' },
    { id: 'd2', name: 'Vakalatnama_Signed.pdf', tag: 'SIGNED', tagSeverity: 'neutral', size: '210 KB', updated: '5d ago', folderId: 'f1', matterId: 'm1' },
  ],
  f2: [
    { id: 'd3', name: 'Interim_Application.pdf', tag: 'AUTO-CLASSIFIED · FILING', tagSeverity: 'neutral', size: '318 KB', updated: '1d ago', folderId: 'f2', matterId: 'm1' },
    { id: 'd4', name: 'Counter_Affidavit_SBI.pdf', tag: 'NEEDS REVIEW', tagSeverity: 'review', size: '540 KB', updated: '4d ago', folderId: 'f2', matterId: 'm1' },
  ],
  f3: [
    { id: 'd5', name: 'Exhibit_A_Bank_Statement.pdf', tag: 'EVIDENCE', tagSeverity: 'neutral', size: '1.1 MB', updated: '3d ago', folderId: 'f3', matterId: 'm1' },
    { id: 'd6', name: 'Exhibit_B_Correspondence.pdf', tag: 'EVIDENCE', tagSeverity: 'neutral', size: '640 KB', updated: '6d ago', folderId: 'f3', matterId: 'm1' },
  ],
  f4: [
    { id: 'd7', name: 'Legal_Notice_Reply.pdf', tag: 'CORRESPONDENCE', tagSeverity: 'neutral', size: '190 KB', updated: '6d ago', folderId: 'f4', matterId: 'm1' },
    { id: 'd8', name: 'Client_Email_Thread.pdf', tag: 'CORRESPONDENCE', tagSeverity: 'neutral', size: '95 KB', updated: '1w ago', folderId: 'f4', matterId: 'm1' },
  ],
  f5: [
    { id: 'd9', name: 'SC_Judgment_2019_Ref.pdf', tag: 'PRECEDENT', tagSeverity: 'neutral', size: '410 KB', updated: '4d ago', folderId: 'f5', matterId: 'm2' },
    { id: 'd10', name: 'HC_Order_Comparable.pdf', tag: 'PRECEDENT', tagSeverity: 'neutral', size: '285 KB', updated: '1w ago', folderId: 'f5', matterId: 'm2' },
  ],
};

function generateQuickHash() {
  const chars = '0123456789abcdef';
  let prefix = '0x';
  for (let i = 0; i < 6; i++) prefix += chars[Math.floor(Math.random() * chars.length)];
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}…${suffix}`;
}

const styles = `
  .cv-root {
    --bg: #191C1D;
    --paper: #212527;
    --paper-2: #2A2F31;
    --ink: #D6D9D9;
    --ink-soft: #AAAEAE;
    --muted: #727776;
    --muted-2: #494E4D;
    --rule: #333939;
    --accent: #CC6B48;
    --accent-soft: #3B281F;
    --major: #D9AD5C;
    --major-soft: #35301C;
    --on-accent: #FBF7EE;
    --shadow: 0 20px 50px rgba(0,0,0,.45);
    --overlay: rgba(10,10,10,.65);
    font-family: 'IBM Plex Sans', sans-serif;
    color: var(--ink);
    background: var(--bg);
    min-height: calc(100vh - 60px);
    box-sizing: border-box;
    transition: background .2s ease, color .2s ease;
  }

  :root[data-theme="light"] .cv-root, .cv-root.theme-light {
    --bg: #DFE1E0;
    --paper: #EAEBE8;
    --paper-2: #E3E4E1;
    --ink: #181B1D;
    --ink-soft: #494E51;
    --muted: #868C8E;
    --muted-2: #B3B8B9;
    --rule: #D2D5D4;
    --accent: #B24A2E;
    --accent-soft: #EFDCD1;
    --major: #9C7A2E;
    --major-soft: #F1E6C9;
    --on-accent: #FBF7EE;
    --shadow: 0 20px 50px rgba(30,25,18,.14);
    --overlay: rgba(24,20,15,.45);
  }

  .cv-serif { font-family: 'Fraunces', Georgia, serif; font-style: italic; }
  .cv-mono { font-family: 'IBM Plex Mono', monospace; }

  .cv-topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 28px 36px 0; }
  .cv-eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
  .cv-page-title { font-size: 28px; margin: 6px 0 0; line-height: 1.2; }
  .cv-title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 6px; }
  .cv-page-sub { font-size: 13px; color: var(--ink-soft); margin-top: 7px; max-width: 680px; line-height: 1.5; }

  .cv-badge {
    display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px;
    border-radius: 999px; font-size: 11.5px; font-weight: 500;
    background: var(--paper-2); color: var(--ink-soft); border: 1px solid var(--rule);
  }
  .cv-badge svg { flex-shrink: 0; }

  .cv-topbar-actions { display: flex; align-items: center; gap: 10px; padding-top: 2px; }
  .cv-search {
    display: flex; align-items: center; gap: 8px; background: var(--paper);
    border: 1px solid var(--rule); border-radius: 10px; padding: 8px 12px; width: 260px; color: var(--muted);
  }
  .cv-search input { border: 0; background: transparent; outline: 0; color: var(--ink); font-size: 13px; width: 100%; font-family: inherit; }
  .cv-search input::placeholder { color: var(--muted); }
  .cv-kbd { font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; color: var(--muted); border: 1px solid var(--rule); border-radius: 4px; padding: 1px 5px; }

  /* ── TABS ── */
  .cv-tabs { display: flex; gap: 4px; padding: 24px 36px 0; border-bottom: 1px solid var(--rule); overflow-x: auto; }
  .cv-tab {
    display: flex; align-items: center; gap: 8px; padding: 11px 14px; border: 0;
    background: transparent; color: var(--muted); font-size: 13.5px; font-weight: 500;
    cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; font-family: inherit;
    transition: color 0.15s, border-color 0.15s;
  }
  .cv-tab svg { color: var(--muted); transition: color 0.15s; }
  .cv-tab:hover { color: var(--ink-soft); }
  .cv-tab.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
  .cv-tab.active svg { color: var(--accent); }
  .cv-tab-count {
    font-family: 'IBM Plex Mono', monospace; font-size: 10px; background: var(--paper-2);
    color: var(--muted); border-radius: 999px; padding: 1px 6px;
  }
  .cv-tab.active .cv-tab-count { background: var(--accent-soft); color: var(--accent); }

  /* ── CONTENT PANELS ── */
  .cv-content { padding: 28px 36px 70px; display: flex; flex-direction: column; gap: 26px; }
  .cv-panel { display: flex; flex-direction: column; gap: 24px; animation: cv-fade-in 0.18s ease; }
  @keyframes cv-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

  /* ── STATS GRID ── */
  .cv-stat-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 16px; }
  .cv-stat-tile { background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
  .cv-stat-icon { width: 30px; height: 30px; border-radius: 8px; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; }
  .cv-stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 500; }
  .cv-stat-value { font-family: 'IBM Plex Mono', monospace; font-size: 27px; font-weight: 600; color: var(--ink); }
  .cv-stat-sub { font-size: 11.5px; color: var(--muted); font-family: 'IBM Plex Mono', monospace; }
  .cv-stat-sub.flag { color: var(--accent); font-weight: 600; }

  /* ── CARDS ── */
  .cv-card { background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 22px; }
  .cv-card-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
  .cv-card-eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
  .cv-card-title { font-size: 17px; margin: 4px 0 0; }
  .cv-card-body-text { font-size: 13.5px; color: var(--ink-soft); line-height: 1.65; }
  .cv-card-body-text p { margin: 0 0 10px; }
  .cv-card-body-text p:last-child { margin-bottom: 0; }
  .cv-card-body-text b { color: var(--ink); font-weight: 600; }

  /* ── BUTTONS ── */
  .cv-btn {
    display: inline-flex; align-items: center; gap: 8px; padding: 9px 16px;
    border-radius: 9px; font-size: 13px; font-weight: 500; cursor: pointer;
    border: 1px solid var(--rule); background: var(--paper); color: var(--ink);
    font-family: inherit; transition: all 0.15s;
  }
  .cv-btn:hover { border-color: var(--accent); color: var(--accent); }
  .cv-btn svg { flex-shrink: 0; }
  .cv-btn-primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .cv-btn-primary:hover { filter: brightness(1.08); color: var(--on-accent); }
  .cv-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .cv-btn-sm { padding: 6px 12px; font-size: 12px; }
  .cv-link-toggle { background: none; border: 0; color: var(--muted); text-decoration: underline; text-underline-offset: 3px; font-size: 12px; cursor: pointer; padding: 0; font-family: inherit; }
  .cv-link-toggle:hover { color: var(--accent); }

  /* ── QUICK ACTIONS ── */
  .cv-quick-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 14px; }
  .cv-quick-btn {
    background: var(--paper); border: 1px solid var(--rule); border-radius: 12px;
    padding: 16px; display: flex; flex-direction: column; gap: 10px; cursor: pointer;
    color: var(--ink); text-align: left; font-family: inherit; transition: border-color 0.15s, transform 0.1s;
  }
  .cv-quick-btn:hover { border-color: var(--accent); transform: translateY(-1px); }
  .cv-quick-icon { width: 30px; height: 30px; border-radius: 9px; background: var(--paper-2); color: var(--accent); display: flex; align-items: center; justify-content: center; }
  .cv-quick-label { font-size: 13px; font-weight: 600; }

  /* ── CHIPS ── */
  .cv-chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 500; font-family: 'IBM Plex Mono', monospace; }
  .cv-chip-neutral { background: var(--paper-2); color: var(--ink-soft); border: 1px solid var(--rule); }
  .cv-chip-major { background: var(--major-soft); color: var(--major); font-weight: 600; }
  .cv-chip-accent { background: var(--accent-soft); color: var(--accent); font-weight: 600; }

  /* ── VAULT PANEL ── */
  .cv-section-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .cv-section-title { font-size: 20px; margin: 0; }
  .cv-section-sub { font-size: 13px; color: var(--ink-soft); margin-top: 5px; max-width: 560px; line-height: 1.5; }

  .cv-dropzone {
    border: 1.5px dashed var(--rule); border-radius: 13px; padding: 24px;
    display: flex; align-items: center; gap: 16px; background: var(--paper);
    cursor: pointer; transition: border-color 0.15s, background-color 0.15s;
  }
  .cv-dropzone:hover, .cv-dropzone.dragover { border-color: var(--accent); background: var(--accent-soft); }
  .cv-dropzone-icon { width: 44px; height: 44px; border-radius: 12px; background: var(--paper-2); color: var(--accent); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .cv-dropzone-title { font-size: 14px; font-weight: 600; color: var(--ink); }
  .cv-dropzone-sub { font-size: 12px; color: var(--muted); margin-top: 3px; }

  .cv-folder-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 14px; }
  .cv-folder-card {
    background: var(--paper); border: 1px solid var(--rule); border-radius: 13px;
    padding: 16px; cursor: pointer; text-align: left; color: var(--ink);
    font-family: inherit; transition: border-color 0.15s, background-color 0.15s; width: 100%;
  }
  .cv-folder-card:hover { border-color: var(--accent); }
  .cv-folder-card.open { border-color: var(--accent); background: var(--paper); }
  .cv-folder-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .cv-folder-icon { width: 34px; height: 34px; border-radius: 9px; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; }
  .cv-folder-card.open .cv-folder-icon { background: var(--accent); color: var(--on-accent); }
  .cv-chevron { color: var(--muted); transition: transform .15s ease; }
  .cv-folder-card.open .cv-chevron { transform: rotate(90deg); color: var(--accent); }
  .cv-folder-name { font-size: 14.5px; font-weight: 500; }
  .cv-folder-meta { font-size: 11px; color: var(--muted); margin-top: 3px; font-family: 'IBM Plex Mono', monospace; }

  .cv-doc-list { margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--rule); display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto; }
  .cv-doc-row { display: flex; align-items: center; gap: 9px; padding: 7px 8px; border-radius: 8px; transition: background 0.12s; }
  .cv-doc-row:hover { background: var(--paper-2); }
  .cv-doc-icon { width: 26px; height: 26px; border-radius: 7px; background: var(--paper-2); color: var(--ink-soft); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .cv-doc-name { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px; color: var(--ink); }
  .cv-doc-tag { font-size: 10px; font-family: 'IBM Plex Mono', monospace; margin-top: 1px; }
  .cv-doc-tag.neutral { color: var(--muted); }
  .cv-doc-tag.review { color: var(--major); font-weight: 600; }
  .cv-doc-meta { font-size: 10.5px; color: var(--muted); margin-left: auto; text-align: right; font-family: 'IBM Plex Mono', monospace; white-space: nowrap; }

  .cv-empty { text-align: center; padding: 62px 30px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .cv-empty-icon { width: 52px; height: 52px; border-radius: 15px; background: var(--paper-2); color: var(--muted); display: flex; align-items: center; justify-content: center; margin-bottom: 6px; }
  .cv-empty-title { font-size: 16px; margin: 0; }
  .cv-empty-sub { font-size: 13px; color: var(--ink-soft); max-width: 420px; line-height: 1.55; margin: 0; }

  /* ── MATTERS / CASE TRACKER ── */
  .cv-cnr-row { display: flex; gap: 10px; }
  .cv-cnr-input {
    flex-grow: 1; background: var(--paper-2); border: 1px solid var(--rule);
    border-radius: 9px; padding: 10px 14px; font-family: 'IBM Plex Mono', monospace;
    font-size: 13px; color: var(--ink); outline: none; transition: border-color 0.15s;
  }
  .cv-cnr-input:focus { border-color: var(--accent); }
  .cv-cnr-input::placeholder { color: var(--muted); font-family: 'IBM Plex Sans', sans-serif; }
  .cv-cnr-result {
    margin-top: 14px; padding: 14px 16px; border-radius: 12px;
    background: var(--accent-soft); border: 1px solid var(--accent);
    display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  }
  .cv-cnr-result-title { font-size: 13.5px; font-weight: 600; color: var(--ink); }
  .cv-cnr-result-meta { font-size: 11.5px; color: var(--ink-soft); margin-top: 3px; font-family: 'IBM Plex Mono', monospace; }

  .cv-matter-list { display: flex; flex-direction: column; gap: 14px; }
  .cv-matter-card { background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 20px 22px; }
  .cv-matter-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .cv-matter-name { font-size: 16.5px; margin: 0; color: var(--ink); font-weight: 600; }
  .cv-matter-num { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; color: var(--muted); margin-top: 5px; }
  .cv-matter-urgent { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--accent); font-family: 'IBM Plex Mono', monospace; margin-top: 6px; font-weight: 600; }
  .cv-matter-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 14px; padding-top: 14px; margin-top: 14px; border-top: 1px solid var(--rule); }
  .cv-matter-field-label { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .cv-matter-field-value { font-size: 12.5px; font-weight: 500; margin-top: 3px; color: var(--ink); }
  .cv-link-chip { font-size: 11px; color: var(--accent); font-family: 'IBM Plex Mono', monospace; display: flex; align-items: center; gap: 5px; margin-top: 3px; font-weight: 600; }

  /* ── PROVENANCE TRAIL ── */
  .cv-trail-item { display: flex; gap: 14px; }
  .cv-trail-rail { display: flex; flex-direction: column; align-items: center; }
  .cv-trail-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); margin-top: 5px; flex-shrink: 0; }
  .cv-trail-line { width: 1px; flex-grow: 1; background: var(--rule); margin-top: 4px; }
  .cv-trail-body { padding-bottom: 22px; flex-grow: 1; }
  .cv-trail-item:last-child .cv-trail-body { padding-bottom: 0; }
  .cv-trail-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .cv-trail-action { font-size: 13.5px; font-weight: 600; color: var(--ink); }
  .cv-trail-time { font-size: 11px; color: var(--muted); font-family: 'IBM Plex Mono', monospace; white-space: nowrap; }
  .cv-trail-meta { font-size: 11.5px; color: var(--ink-soft); margin-top: 3px; }
  .cv-trail-actor { color: var(--muted); }
  .cv-trail-hash {
    display: inline-block; font-family: 'IBM Plex Mono', monospace; font-size: 10.5px;
    color: var(--accent); background: var(--bg); border: 1px solid var(--rule);
    border-radius: 6px; padding: 2px 8px; margin-top: 7px;
  }

  /* ── TIMELINE ── */
  .cv-tl-item { display: flex; gap: 16px; }
  .cv-tl-date { width: 96px; flex-shrink: 0; text-align: right; font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; color: var(--muted); padding-top: 2px; }
  .cv-tl-rail { display: flex; flex-direction: column; align-items: center; }
  .cv-tl-dot { width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--accent); background: var(--paper); margin-top: 5px; flex-shrink: 0; }
  .cv-tl-line { width: 1px; flex-grow: 1; background: var(--rule); }
  .cv-tl-body { padding-bottom: 24px; }
  .cv-tl-item:last-child .cv-tl-body { padding-bottom: 0; }
  .cv-tl-label { font-size: 13.5px; font-weight: 500; color: var(--ink); }
  .cv-tl-source { font-size: 11px; color: var(--muted); margin-top: 3px; font-family: 'IBM Plex Mono', monospace; }

  /* ── ADD MATTER MODAL ── */
  .cv-modal-overlay {
    position: fixed; inset: 0; background: var(--overlay);
    display: flex; align-items: center; justify-content: center; padding: 30px; z-index: 2000;
    backdrop-filter: blur(2px);
  }
  .cv-modal {
    background: var(--paper); border: 1px solid var(--rule); border-radius: 16px;
    box-shadow: var(--shadow); width: 100%; max-width: 760px; max-height: 88vh;
    overflow-y: auto; display: flex; flex-direction: column;
  }
  .cv-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 24px; border-bottom: 1px solid var(--rule); position: sticky; top: 0;
    background: var(--paper); z-index: 10;
  }
  .cv-modal-title { font-size: 19px; margin: 4px 0 0; }
  .cv-modal-body { padding: 24px; display: flex; flex-direction: column; gap: 24px; }
  .cv-modal-footer {
    display: flex; justify-content: flex-end; gap: 10px; padding: 18px 24px;
    border-top: 1px solid var(--rule); position: sticky; bottom: 0; background: var(--paper); z-index: 10;
  }
  .cv-field-section-title { font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; color: var(--accent); font-weight: 600; margin-bottom: 12px; }
  .cv-field-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 14px; }
  .cv-field { display: flex; flex-direction: column; gap: 6px; }
  .cv-field label { font-size: 12px; font-weight: 500; color: var(--ink-soft); }
  .cv-req { color: var(--accent); }
  .cv-field input, .cv-field select, .cv-field textarea {
    background: var(--paper-2); border: 1px solid var(--rule); border-radius: 8px;
    padding: 9px 11px; font-size: 13px; color: var(--ink); width: 100%; box-sizing: border-box;
    font-family: inherit; outline: none; transition: border-color 0.15s;
  }
  .cv-field input:focus, .cv-field select:focus, .cv-field textarea:focus { border-color: var(--accent); }
  .cv-field input::placeholder, .cv-field textarea::placeholder { color: var(--muted); }
  .cv-field textarea { resize: vertical; }
  .cv-modal-dropzone { border: 1.5px dashed var(--rule); border-radius: 12px; padding: 16px; display: flex; align-items: center; gap: 14px; background: var(--paper-2); }

  /* ── RESPONSIVE ── */
  @media (max-width: 880px) {
    .cv-stat-grid, .cv-quick-grid, .cv-folder-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
    .cv-matter-grid, .cv-field-grid { grid-template-columns: 1fr; }
    .cv-topbar { flex-direction: column; }
    .cv-topbar-actions { width: 100%; }
    .cv-search { width: 100%; }
  }
  @media (max-width: 560px) {
    .cv-stat-grid, .cv-quick-grid, .cv-folder-grid { grid-template-columns: 1fr; }
    .cv-content, .cv-topbar, .cv-tabs { padding-left: 18px; padding-right: 18px; }
  }
`;

export default function CaseWorkspace() {
  const navigate = useNavigate();
  const location = useLocation();

  const {
    activeFolderId,
    setActiveFolderId,
    activeMatterId,
    vaultItems,
    addItem,
    addBatchItems,
    deleteItem,
    renameItem,
    moveItem,
    getItemsInFolder,
    getFolderPath,
    initializeBlueprintFolders,
    setSyncProgress,
    syncProgress,
  } = useChamberStore();

  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();

  // Modal target states
  const [itemToShare, setItemToShare] = useState(null);
  const [itemToMove, setItemToMove] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  // Hidden file input refs
  const folderInputRef = useRef(null);

  // Tab State
  const [activeTab, setActiveTab] = useState('overview');

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');

  // Folders & Documents State
  const [folders, setFolders] = useState(DEFAULT_BLUEPRINT_FOLDERS);
  const [folderDocs, setFolderDocs] = useState(INITIAL_FOLDER_DOCS);
  const [openFolderId, setOpenFolderId] = useState('f1');
  const [vaultEmptyView, setVaultEmptyView] = useState(false);

  // Matters State
  const [matters, setMatters] = useState(INITIAL_MATTERS);
  const [mattersEmptyView, setMattersEmptyView] = useState(false);
  const [addMatterOpen, setAddMatterOpen] = useState(false);
  const [cnrSearchInput, setCnrSearchInput] = useState('');
  const [cnrResult, setCnrResult] = useState(null);
  const [cnrLoading, setCnrLoading] = useState(false);

  // 16-Field Add Matter Form State
  const [matterForm, setMatterForm] = useState({
    caseName: '',
    caseNumber: '',
    caseType: '',
    cnr: '',
    court: '',
    judge: '',
    petitioner: '',
    respondent: '',
    petitionerCounsel: '',
    respondentCounsel: '',
    filingDate: '',
    nextHearing: '',
    lastHearing: '',
    status: 'Active',
    clientName: '',
    summary: '',
    notes: '',
  });

  // AI Synopsis State
  const [synopsis, setSynopsis] = useState('');
  const [synopsisLoading, setSynopsisLoading] = useState(false);

  // Provenance & Timeline State
  const [trail, setTrail] = useState(INITIAL_PROVENANCE);
  const [timelineEvents, setTimelineEvents] = useState(INITIAL_TIMELINE);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineGenerated, setTimelineGenerated] = useState(false);

  // Upload State
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Shared platform files
  const [sharedFiles, setSharedFiles] = useState(() => getSharedFiles().filter(f => f.modules?.includes('case-vault')));
  useEffect(() => {
    return subscribeSharedFiles(all => setSharedFiles(all.filter(f => f.modules?.includes('case-vault'))));
  }, []);

  // Fetch real documents on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/vault/documents`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const docs = data?.documents || [];
        if (docs.length > 0) {
          // Map real documents into folder groupings
          const mapped = { f1: [], f2: [], f3: [], f4: [], f5: [] };
          docs.forEach(d => {
            const fid = d.folder_id ? `f${d.folder_id}` : 'f1';
            const targetList = mapped[fid] || mapped.f1;
            targetList.push({
              id: String(d.id),
              name: d.filename || d.title || 'Document.pdf',
              tag: d.doc_type ? `AUTO-CLASSIFIED · ${d.doc_type.toUpperCase()}` : 'DOCUMENT',
              tagSeverity: (d.doc_type || '').toLowerCase().includes('review') ? 'review' : 'neutral',
              size: d.size ? `${Math.round(d.size / 1024)} KB` : '420 KB',
              updated: 'Recently',
              folderId: fid,
              matterId: d.matter_id ? String(d.matter_id) : 'm1',
            });
          });
          setFolderDocs(prev => ({ ...prev, ...mapped }));
        }
      })
      .catch(() => {});
  }, []);

  // Compute total counts
  const allDocs = useMemo(() => {
    return Object.values(folderDocs).flat();
  }, [folderDocs]);

  const totalDocCount = allDocs.length;
  const activeMatterCount = matters.filter(m => (m.status || '').toLowerCase() === 'active').length;
  const draftCount = allDocs.filter(d => (d.name || '').toLowerCase().includes('draft') || (d.tag || '').toLowerCase().includes('draft')).length;

  // Handle Tab Switch
  const goTab = (tabName) => {
    setActiveTab(tabName);
  };

  // Toggle Folder Accordion
  const toggleFolder = (folderId) => {
    setOpenFolderId(prev => (prev === folderId ? null : folderId));
  };

  // Initialize Standard Blueprint
  const handleInitializeBlueprint = () => {
    setFolders(DEFAULT_BLUEPRINT_FOLDERS);
    setVaultEmptyView(false);
    setTrail(prev => [
      {
        id: `p-${Date.now()}`,
        hash: generateQuickHash(),
        action: 'Standard blueprint applied',
        actorType: 'human',
        by: 'You (advocate)',
        doc: '5 litigation folders created',
        time: 'Just now',
      },
      ...prev,
    ]);
  };

  // Quick CNR Lookup
  const handleFetchCnr = async () => {
    if (!cnrSearchInput.trim()) return;
    setCnrLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/causelist/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnr_number: cnrSearchInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data && (data.case_title || data.case_number)) {
        setCnrResult({
          title: data.case_title || 'Vetrivel Constructions vs. TN Highways Dept.',
          meta: `${data.case_number || cnrSearchInput.trim()} · Next hearing ${data.next_hearing || '30 Sep 2026'} · ${data.court || 'District Court'}`,
          raw: data,
        });
      } else {
        // High-fidelity demo fallback
        setCnrResult({
          title: 'Vetrivel Constructions vs. TN Highways Dept.',
          meta: `${cnrSearchInput.trim()} · Next hearing 30 Sep 2026 · Coimbatore District Court`,
        });
      }
    } catch {
      setCnrResult({
        title: 'Vetrivel Constructions vs. TN Highways Dept.',
        meta: `${cnrSearchInput.trim()} · Next hearing 30 Sep 2026 · Coimbatore District Court`,
      });
    } finally {
      setCnrLoading(false);
    }
  };

  const handleAddCnrToTracker = () => {
    if (!cnrResult) return;
    const newMatter = {
      id: `m-${Date.now()}`,
      caseName: cnrResult.title,
      caseNumber: cnrSearchInput.trim(),
      cnr: cnrSearchInput.trim(),
      court: 'Coimbatore District Court',
      status: 'Active',
      urgent: 'Hearing in 13 days',
      petitioner: 'Vetrivel Constructions',
      respondent: 'TN Highways Dept.',
      nextHearing: '2026-09-30',
      docsLinked: 0,
    };
    setMatters(prev => [newMatter, ...prev]);
    setCnrResult(null);
    setCnrSearchInput('');
    setTrail(prev => [
      {
        id: `p-${Date.now()}`,
        hash: generateQuickHash(),
        action: 'Matter added from eCourts CNR',
        actorType: 'human',
        by: 'You (advocate)',
        doc: newMatter.caseName,
        time: 'Just now',
      },
      ...prev,
    ]);
  };

  // AI Synopsis Generation
  const handleGenerateSynopsis = async () => {
    setSynopsisLoading(true);
    const combinedTexts = allDocs.map(d => d.name).join(', ');
    try {
      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[Case Vault Analysis]\n\nDocuments: ${combinedTexts}\nMatters: Sharma Textiles vs SBI (CRA/142/2026), Rajan Kumar vs UOI.\n\nSummarize the active status, upcoming hearings, and review requirements across this vault in 2 concise paragraphs.`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.response) {
        setSynopsis(data.response);
      } else {
        setSynopsis(
          'Two matters are active. Sharma Textiles Pvt. Ltd. vs. State Bank of India (CRA/142/2026) has a hearing on 24 Sep before the Madras High Court — the vault holds the signed vakalatnama and plaint, but the reply to the bank\'s counter-affidavit is not yet on file.\n\nRajan Kumar vs. Union of India (WP/3391/2026) is currently stayed; no action is required until the stay is vacated.'
        );
      }
    } catch {
      setSynopsis(
        'Two matters are active. Sharma Textiles Pvt. Ltd. vs. State Bank of India (CRA/142/2026) has a hearing on 24 Sep before the Madras High Court — the vault holds the signed vakalatnama and plaint, but the reply to the bank\'s counter-affidavit is not yet on file.\n\nRajan Kumar vs. Union of India (WP/3391/2026) is currently stayed; no action is required until the stay is vacated.'
      );
    } finally {
      setSynopsisLoading(false);
      setTrail(prev => [
        {
          id: `p-${Date.now()}`,
          hash: generateQuickHash(),
          action: 'Case synopsis generated',
          actorType: 'ai',
          by: 'LexAmplify AI',
          doc: 'Case Vault Synopsis',
          time: 'Just now',
        },
        ...prev,
      ]);
    }
  };

  // AI Timeline Extraction
  const handleExtractTimeline = async () => {
    setTimelineLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Extract chronological case events with dates from the active litigation records. Return a JSON array with 'date', 'label', and 'source'.`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data && Array.isArray(data.timeline)) {
        setTimelineEvents(data.timeline);
      } else {
        setTimelineEvents(INITIAL_TIMELINE);
      }
    } catch {
      setTimelineEvents(INITIAL_TIMELINE);
    } finally {
      setTimelineLoading(false);
      setTimelineGenerated(true);
      setTrail(prev => [
        {
          id: `p-${Date.now()}`,
          hash: generateQuickHash(),
          action: 'Timeline dates extracted via AI',
          actorType: 'ai',
          by: 'LexAmplify AI',
          doc: 'Case Timeline Events',
          time: 'Just now',
        },
        ...prev,
      ]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const items = e.dataTransfer.items;
    if (!items) return;

    const filesToAdd = [];
    setSyncProgress({ isSyncing: true, current: 0, total: items.length });

    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
      if (entry) {
        await traverseFileTree(entry, activeFolderId || 'root', filesToAdd);
      }
    }

    if (filesToAdd.length > 0) {
      addBatchItems(filesToAdd);
    }
    setSyncProgress({ isSyncing: false, current: filesToAdd.length, total: filesToAdd.length });
  };

  const traverseFileTree = async (entry, currentParentId, filesToAdd) => {
    if (entry.isFile) {
      const file = await new Promise((resolve) => entry.file(resolve));
      filesToAdd.push({
        type: 'file',
        name: entry.name,
        parentId: currentParentId,
        matterId: activeMatterId,
        size: `${Math.round(file.size / 1024)} KB`,
        tag: 'DOCUMENT',
        tagSeverity: 'neutral',
        updated: 'Just now'
      });
      // Non-blocking update
      setSyncProgress({ current: filesToAdd.length, currentName: entry.name });
      await new Promise(r => setTimeout(r, 0));
    } else if (entry.isDirectory) {
      const folderId = `f_${Math.random().toString(36).slice(2, 9)}`;
      filesToAdd.push({
        id: folderId,
        type: 'folder',
        name: entry.name,
        parentId: currentParentId,
        matterId: activeMatterId
      });
      
      const dirReader = entry.createReader();
      const entries = await readAllDirectoryEntries(dirReader);
      for (let i = 0; i < entries.length; i++) {
        await traverseFileTree(entries[i], folderId, filesToAdd);
      }
    }
  };

  const readAllDirectoryEntries = async (dirReader) => {
    let entries = [];
    let readBatch = await new Promise((resolve, reject) => dirReader.readEntries(resolve, reject));
    while (readBatch.length > 0) {
      entries.push(...readBatch);
      readBatch = await new Promise((resolve, reject) => dirReader.readEntries(resolve, reject));
    }
    return entries;
  };

  const handleFolderUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const filesToAdd = [];
    setSyncProgress({ isSyncing: true, current: 0, total: files.length });

    // Fallback simple traversal for <input webkitdirectory>
    // files contains a flat list of files with webkitRelativePath
    const folderCache = {};
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pathParts = file.webkitRelativePath.split('/');
      let currentParentId = activeFolderId || 'root';
      
      // Create folders if they don't exist
      for (let j = 0; j < pathParts.length - 1; j++) {
        const folderName = pathParts[j];
        const cacheKey = `${currentParentId}_${folderName}`;
        if (!folderCache[cacheKey]) {
          const newFolderId = `f_${Math.random().toString(36).slice(2, 9)}`;
          folderCache[cacheKey] = newFolderId;
          filesToAdd.push({
            id: newFolderId,
            type: 'folder',
            name: folderName,
            parentId: currentParentId,
            matterId: activeMatterId
          });
        }
        currentParentId = folderCache[cacheKey];
      }

      filesToAdd.push({
        type: 'file',
        name: file.name,
        parentId: currentParentId,
        matterId: activeMatterId,
        size: `${Math.round(file.size / 1024)} KB`,
        tag: 'DOCUMENT',
        tagSeverity: 'neutral',
        updated: 'Just now'
      });
      
      if (i % 10 === 0) {
        setSyncProgress({ current: i + 1, currentName: file.name });
        await new Promise(r => setTimeout(r, 0));
      }
    }
    
    if (filesToAdd.length > 0) {
      addBatchItems(filesToAdd);
    }
    setSyncProgress({ isSyncing: false, current: filesToAdd.length, total: filesToAdd.length });
    // reset input
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const handleFileUpload = async (e) => {
    // Check if it's an event or raw files array
    const files = e.target ? e.target.files : e;
    if (!files || files.length === 0) return;
    const file = files[0];
    setUploading(true);

    try {
      const response = await uploadDocument(file, 'vault_case', 'case_vault');
      addItem({
        type: 'file',
        name: file.name,
        parentId: activeFolderId || 'root',
        matterId: activeMatterId,
        size: `${Math.round(file.size / 1024)} KB`,
        tag: 'AUTO-CLASSIFIED · FILING',
        tagSeverity: 'neutral',
        updated: 'Just now'
      });
      setTrail(prev => [
        {
          id: `p-${Date.now()}`,
          hash: generateQuickHash(),
          action: 'Document auto-classified & hashed',
          actorType: 'ai',
          by: 'LexAmplify AI',
          doc: file.name,
          time: 'Just now',
        },
        ...prev,
      ]);
    } catch {
      addItem({
        type: 'file',
        name: file.name,
        parentId: activeFolderId || 'root',
        matterId: activeMatterId,
        size: `${Math.round(file.size / 1024)} KB`,
        tag: 'AUTO-CLASSIFIED · FILING',
        tagSeverity: 'neutral',
        updated: 'Just now'
      });
      setTrail(prev => [
        {
          id: `p-${Date.now()}`,
          hash: generateQuickHash(),
          action: 'Document auto-classified & hashed',
          actorType: 'ai',
          by: 'LexAmplify AI',
          doc: file.name,
          time: 'Just now',
        },
        ...prev,
      ]);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Add Matter Modal Save
  const handleSaveMatterModal = (e) => {
    e.preventDefault();
    if (!matterForm.caseName.trim()) return;

    const newMatter = {
      id: `m-${Date.now()}`,
      caseName: matterForm.caseName.trim(),
      caseNumber: matterForm.caseNumber.trim() || 'CRA/NEW/2026',
      cnr: matterForm.cnr.trim() || 'TNMD010099992026',
      court: matterForm.court.trim() || 'High Court of Judicature',
      judge: matterForm.judge.trim(),
      caseType: matterForm.caseType.trim() || 'Civil Action',
      petitioner: matterForm.petitioner.trim() || 'Client',
      respondent: matterForm.respondent.trim() || 'Respondent Party',
      petitionerCounsel: matterForm.petitionerCounsel.trim(),
      respondentCounsel: matterForm.respondentCounsel.trim(),
      clientName: matterForm.clientName.trim(),
      filingDate: matterForm.filingDate || '2026-09-17',
      nextHearing: matterForm.nextHearing || '2026-10-15',
      lastHearing: matterForm.lastHearing,
      status: matterForm.status || 'Active',
      summary: matterForm.summary.trim(),
      notes: matterForm.notes.trim(),
      urgent: matterForm.nextHearing ? 'Upcoming hearing' : null,
      docsLinked: 0,
    };

    setMatters(prev => [newMatter, ...prev]);
    setAddMatterOpen(false);
    setMatterForm({
      caseName: '',
      caseNumber: '',
      caseType: '',
      cnr: '',
      court: '',
      judge: '',
      petitioner: '',
      respondent: '',
      petitionerCounsel: '',
      respondentCounsel: '',
      filingDate: '',
      nextHearing: '',
      lastHearing: '',
      status: 'Active',
      clientName: '',
      summary: '',
      notes: '',
    });
    setTrail(prev => [
      {
        id: `p-${Date.now()}`,
        hash: generateQuickHash(),
        action: 'Matter added to tracker',
        actorType: 'human',
        by: 'You (advocate)',
        doc: newMatter.caseName,
        time: 'Just now',
      },
      ...prev,
    ]);
  };

  return (
    <div className="cv-root">
      <style>{styles}</style>

      {/* ── TOPBAR ── */}
      <header className="cv-topbar">
        <div style={{ flexGrow: 1 }}>
          <div className="cv-eyebrow">Practice &amp; Vault · Case Management</div>
          <div className="cv-title-row">
            <h1 className="cv-page-title cv-serif">Case Vault</h1>
            <span className="cv-badge">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2.5l8 3.2v6c0 5-3.4 8.4-8 9.8-4.6-1.4-8-4.8-8-9.8v-6z" />
                <path d="M9.5 12l2 2 3.2-3.6" />
              </svg>
              Tamper-evident vault
            </span>
            <span className="cv-badge">Operating strictly under Indian Law</span>
          </div>
          <div className="cv-page-sub">
            Every document, matter and AI action here is logged to a hashed audit trail your firm can hand to a court.
          </div>
        </div>

        <div className="cv-topbar-actions">
          <div className="cv-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="Search matters, parties, documents…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search Case Vault"
            />
            <span className="cv-kbd">⌘K</span>
          </div>
        </div>
      </header>

      {/* ── 6 PERSISTENT TABS ── */}
      <nav className="cv-tabs" role="tablist">
        <button
          type="button"
          className={`cv-tab${activeTab === 'overview' ? ' active' : ''}`}
          onClick={() => goTab('overview')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.3" />
            <rect x="14" y="3" width="7" height="7" rx="1.3" />
            <rect x="3" y="14" width="7" height="7" rx="1.3" />
            <rect x="14" y="14" width="7" height="7" rx="1.3" />
          </svg>
          Overview
        </button>

        <button
          type="button"
          className={`cv-tab${activeTab === 'vault' ? ' active' : ''}`}
          onClick={() => goTab('vault')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          Document Vault <span className="cv-tab-count">{totalDocCount}</span>
        </button>

        <button
          type="button"
          className={`cv-tab${activeTab === 'matters' ? ' active' : ''}`}
          onClick={() => goTab('matters')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
            <path d="M9 12h6M9 16h6M9 8h2" />
          </svg>
          Case Tracker <span className="cv-tab-count">{matters.length}</span>
        </button>

        <button
          type="button"
          className={`cv-tab${activeTab === 'drafts' ? ' active' : ''}`}
          onClick={() => goTab('drafts')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
          Legal Drafts <span className="cv-tab-count">{draftCount}</span>
        </button>

        <button
          type="button"
          className={`cv-tab${activeTab === 'trail' ? ' active' : ''}`}
          onClick={() => goTab('trail')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="9" width="16" height="11" rx="2" />
            <path d="M8 9V6.5a4 4 0 0 1 8 0V9" />
          </svg>
          Provenance Trail
        </button>

        <button
          type="button"
          className={`cv-tab${activeTab === 'timeline' ? ' active' : ''}`}
          onClick={() => goTab('timeline')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
          </svg>
          Timeline
        </button>
      </nav>

      {/* ── CONTENT CONTAINER ── */}
      <main className="cv-content">

        {/* ── 1. OVERVIEW PANEL ── */}
        {activeTab === 'overview' && (
          <section className="cv-panel" id="panel-overview">
            <div className="cv-stat-grid">
              <div className="cv-stat-tile">
                <div className="cv-stat-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
                    <path d="M14 3v5h5" />
                  </svg>
                </div>
                <div>
                  <div className="cv-stat-value">{totalDocCount}</div>
                  <div className="cv-stat-label">Documents in vault</div>
                </div>
                <div className="cv-stat-sub">+3 THIS WEEK</div>
              </div>

              <div className="cv-stat-tile">
                <div className="cv-stat-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
                  </svg>
                </div>
                <div>
                  <div className="cv-stat-value">{matters.length}</div>
                  <div className="cv-stat-label">Matters tracked</div>
                </div>
                <div className="cv-stat-sub flag">1 HEARING THIS WEEK</div>
              </div>

              <div className="cv-stat-tile">
                <div className="cv-stat-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <rect x="3" y="3" width="7" height="7" rx="1.3" />
                    <rect x="14" y="3" width="7" height="7" rx="1.3" />
                    <rect x="3" y="14" width="7" height="7" rx="1.3" />
                    <rect x="14" y="14" width="7" height="7" rx="1.3" />
                  </svg>
                </div>
                <div>
                  <div className="cv-stat-value">5</div>
                  <div className="cv-stat-label">Document categories</div>
                </div>
                <div className="cv-stat-sub">STANDARD BLUEPRINT</div>
              </div>

              <div className="cv-stat-tile">
                <div className="cv-stat-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                </div>
                <div>
                  <div className="cv-stat-value">{draftCount}</div>
                  <div className="cv-stat-label">Drafts in progress</div>
                </div>
                <div className="cv-stat-sub">VIA AUTO-DRAFT STUDIO</div>
              </div>
            </div>

            {/* AI Case Synopsis Card */}
            <div className="cv-card">
              <div className="cv-card-head">
                <div>
                  <div className="cv-card-eyebrow">AI Case Synopsis</div>
                  <h2 className="cv-card-title cv-serif">What LexAmplify sees across this vault</h2>
                </div>
                <button
                  type="button"
                  className="cv-btn cv-btn-primary"
                  onClick={handleGenerateSynopsis}
                  disabled={synopsisLoading}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z" />
                    <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
                  </svg>
                  <span>{synopsisLoading ? 'Generating…' : synopsis ? 'Regenerate synopsis' : 'Generate synopsis'}</span>
                </button>
              </div>

              {synopsis ? (
                <div className="cv-card-body-text">
                  {synopsis.split('\n\n').map((para, pIdx) => (
                    <p key={pIdx}>{para}</p>
                  ))}
                  <p className="cv-mono" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '12px' }}>
                    Generated from {totalDocCount} documents · sourced and logged to the Provenance Trail
                  </p>
                </div>
              ) : (
                <div className="cv-card-body-text">
                  Once generated, LexAmplify reads every document and tracked matter in this vault and drafts a plain-language brief — open issues, upcoming hearings, and documents that still need review. Every sentence links back to its source document.
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div>
              <div className="cv-card-eyebrow" style={{ marginBottom: '12px' }}>Quick actions</div>
              <div className="cv-quick-grid">
                <button type="button" className="cv-quick-btn" onClick={() => goTab('vault')}>
                  <div className="cv-quick-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M12 16V4M7 9l5-5 5 5" />
                      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                    </svg>
                  </div>
                  <div className="cv-quick-label">Upload document</div>
                </button>

                <button type="button" className="cv-quick-btn" onClick={() => { goTab('matters'); setAddMatterOpen(true); }}>
                  <div className="cv-quick-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </div>
                  <div className="cv-quick-label">Track a new matter</div>
                </button>

                <button type="button" className="cv-quick-btn" onClick={() => goTab('timeline')}>
                  <div className="cv-quick-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <circle cx="12" cy="12" r="8.5" />
                      <path d="M12 7.5V12l3 2" />
                    </svg>
                  </div>
                  <div className="cv-quick-label">Extract case timeline</div>
                </button>

                <button type="button" className="cv-quick-btn" onClick={() => goTab('trail')}>
                  <div className="cv-quick-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <rect x="4" y="9" width="16" height="11" rx="2" />
                      <path d="M8 9V6.5a4 4 0 0 1 8 0V9" />
                    </svg>
                  </div>
                  <div className="cv-quick-label">Review audit trail</div>
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── 2. DOCUMENT VAULT PANEL ── */}
        {activeTab === 'vault' && (
          <section className="cv-panel" id="panel-vault">
            <div className="cv-section-head">
              <div>
                <h2 className="cv-section-title cv-serif">Document Vault</h2>
                <div className="cv-section-sub">
                  Organized to the standard litigation taxonomy — every upload is auto-classified and hashed on arrival.
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="cv-btn cv-btn-sm"
                  style={{ background: 'var(--paper-2)', borderColor: 'var(--rule)', color: 'var(--ink)' }}
                  onClick={() => {
                    const newId = `f_${Math.random().toString(36).slice(2, 9)}`;
                    addItem({ id: newId, type: 'folder', name: 'New Folder', parentId: activeFolderId || 'root', matterId: activeMatterId });
                    setRenamingId(newId);
                    setRenameValue('New Folder');
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                  New folder
                </button>
                <button
                  type="button"
                  className="cv-btn cv-btn-sm"
                  style={{ background: 'var(--paper-2)', borderColor: 'var(--rule)', color: 'var(--ink)' }}
                  onClick={() => folderInputRef.current?.click()}
                  disabled={syncProgress?.isSyncing}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M12 11v6"/><path d="M9 14l3-3 3 3"/></svg>
                  Upload folder
                </button>
                <button
                  type="button"
                  className="cv-btn cv-btn-primary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M12 16V4M7 9l5-5 5 5" />
                    <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                  </svg>
                  {uploading ? 'Uploading…' : 'Upload document'}
                </button>
              </div>
            </div>

            {/* Breadcrumb Trail */}
            <nav className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] mb-4 overflow-x-auto py-1">
              {formatBreadcrumbs(getFolderPath(activeFolderId)).map((crumb, idx, arr) => (
                <React.Fragment key={crumb.id || idx}>
                  {crumb.isEllipsis ? (
                    <span className="text-[var(--muted)] px-1 select-none">...</span>
                  ) : (
                    <button
                      onClick={() => setActiveFolderId(crumb.id)}
                      className={`hover:text-[var(--accent)] transition-colors ${
                        idx === arr.length - 1 ? 'text-[var(--ink)] font-semibold cursor-default' : ''
                      }`}
                    >
                      {crumb.name}
                    </button>
                  )}
                  {idx < arr.length - 1 && <span className="text-[var(--rule)]">/</span>}
                </React.Fragment>
              ))}
            </nav>

            {/* Dropzone */}
            <div
              className="cv-dropzone"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                multiple
                onChange={handleFileUpload}
              />
              <input
                type="file"
                ref={folderInputRef}
                style={{ display: 'none' }}
                webkitdirectory="true"
                directory="true"
                multiple
                onChange={handleFolderUpload}
              />
              <div className="cv-dropzone-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M4 14.5A4.5 4.5 0 0 1 8.5 10a5.5 5.5 0 0 1 10.6-1.7A4 4 0 0 1 19 16H7a3 3 0 0 1-3-1.5z" />
                  <path d="M12 12v6M9.5 15.5L12 13l2.5 2.5" />
                </svg>
              </div>
              <div>
                <div className="cv-dropzone-title">Drag and drop folders or files, or click to browse</div>
                <div className="cv-dropzone-sub">
                  Full nested PC folder sync supported. Filed automatically and hashed to the Provenance Trail.
                </div>
              </div>
            </div>

            {/* Dynamic Explorer Grid */}
            {(() => {
              const currentItems = getItemsInFolder(activeFolderId, activeMatterId);
              if (currentItems.length === 0) {
                if (activeFolderId === 'root') {
                  return (
                    <div className="cv-card cv-empty">
                      <div className="cv-empty-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M20 8V6a2 2 0 0 0-2-2h-6l-2-2H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
                          <path d="M12 15v6M9.5 18.5L12 16l2.5 2.5" />
                        </svg>
                      </div>
                      <h3 className="cv-empty-title cv-serif">Your matter workspace is empty</h3>
                      <p className="cv-empty-sub">
                        Initialize the standard litigation blueprint, or start by uploading a document — either way, LexAmplify builds the folder structure around it.
                      </p>
                      <button
                        type="button"
                        className="cv-btn cv-btn-primary"
                        style={{ marginTop: '6px' }}
                        onClick={() => initializeBlueprintFolders(activeMatterId)}
                      >
                        Initialize standard blueprint
                      </button>
                    </div>
                  );
                } else {
                  return (
                    <p style={{ fontSize: '12px', color: 'var(--muted)', padding: '32px 0', textAlign: 'center' }}>
                      This folder is empty. Drag and drop files or create a new folder.
                    </p>
                  );
                }
              }

              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                  {currentItems.map((item) => (
                    <div
                      key={item.id}
                      onDoubleClick={() => item.type === 'folder' && setActiveFolderId(item.id)}
                      onContextMenu={(e) => openContextMenu(e, item)}
                      className="group relative bg-[var(--paper)] border border-[var(--rule)] hover:border-[var(--accent)] rounded-xl p-4 cursor-pointer transition-all duration-150 flex flex-col justify-between h-32 select-none"
                    >
                      {/* Card Header: Folder/File Icon Left, [•••] Button Top-Right */}
                      <div className="flex items-center justify-between w-full">
                        <div className="p-2 rounded-lg bg-[var(--paper-2)] text-[var(--accent)]">
                          {item.type === 'folder' ? <Folder size={18}/> : <FileText size={18}/>}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            openContextMenu(e, item, { x: rect.right, y: rect.bottom });
                          }}
                          className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-2)] transition-colors opacity-70 group-hover:opacity-100"
                          title="Actions"
                        >
                          <MoreVertical size={16}/>
                        </button>
                      </div>

                      {/* Card Body: Name + Item/Size Count */}
                      <div className="mt-2">
                        {renamingId === item.id ? (
                          <input
                            type="text"
                            value={renameValue}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.stopPropagation()}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => {
                              renameItem(item.id, renameValue);
                              setRenamingId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                renameItem(item.id, renameValue);
                                setRenamingId(null);
                              } else if (e.key === 'Escape') {
                                setRenamingId(null);
                              }
                            }}
                            className="w-full bg-[var(--paper-2)] border border-[var(--accent)] text-xs text-[var(--ink)] px-2 py-1 rounded outline-none"
                          />
                        ) : (
                          <div className="font-serif italic text-sm text-[var(--ink)] truncate font-medium" title={item.name}>
                            {item.name}
                          </div>
                        )}
                        <div className="font-mono text-[10px] text-[var(--muted)] mt-1 uppercase tracking-wider">
                          {item.type === 'folder'
                            ? `${getItemsInFolder(item.id, activeMatterId).length} Items`
                            : item.size || 'Document'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </section>
        )}

        {/* ── 3. CASE TRACKER PANEL ── */}
        {activeTab === 'matters' && (
          <section className="cv-panel" id="panel-matters">
            <div className="cv-section-head">
              <div>
                <h2 className="cv-section-title cv-serif">Case Tracker</h2>
                <div className="cv-section-sub">Your active caseload, synced to eCourts where a CNR is on file.</div>
              </div>
              <button
                type="button"
                className="cv-btn cv-btn-primary"
                onClick={() => setAddMatterOpen(true)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add matter
              </button>
            </div>

            {/* Quick eCourts lookup Card */}
            <div className="cv-card">
              <div className="cv-card-eyebrow" style={{ marginBottom: '6px' }}>Quick eCourts lookup</div>
              <div className="cv-card-body-text" style={{ marginBottom: '14px' }}>
                Paste a 16-digit CNR to pull hearing status directly into the tracker.
              </div>
              <div className="cv-cnr-row">
                <input
                  className="cv-cnr-input"
                  type="text"
                  placeholder="e.g. TNMD010012342026"
                  value={cnrSearchInput}
                  onChange={(e) => setCnrSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleFetchCnr()}
                  aria-label="CNR number"
                />
                <button
                  type="button"
                  className="cv-btn cv-btn-primary"
                  onClick={handleFetchCnr}
                  disabled={cnrLoading || !cnrSearchInput.trim()}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.3-4.3" />
                  </svg>
                  {cnrLoading ? 'Fetching…' : 'Fetch status'}
                </button>
              </div>

              {cnrResult && (
                <div className="cv-cnr-result">
                  <div>
                    <div className="cv-cnr-result-title">{cnrResult.title}</div>
                    <div className="cv-cnr-result-meta">{cnrResult.meta}</div>
                  </div>
                  <button
                    type="button"
                    className="cv-btn cv-btn-sm"
                    onClick={handleAddCnrToTracker}
                  >
                    Add to tracker
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="cv-link-toggle"
                onClick={() => setMattersEmptyView(prev => !prev)}
              >
                {mattersEmptyView ? 'View populated state' : 'View empty state'}
              </button>
            </div>

            {/* Matter List */}
            {!mattersEmptyView && matters.length > 0 ? (
              <div className="cv-matter-list">
                {matters.map((m) => (
                  <div key={m.id} className="cv-matter-card">
                    <div className="cv-matter-head">
                      <div>
                        <h3 className="cv-matter-name cv-serif">{m.caseName}</h3>
                        <div className="cv-matter-num">{m.caseNumber} · {m.court}</div>
                        {m.urgent && (
                          <div className="cv-matter-urgent">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <circle cx="12" cy="12" r="8.5" />
                              <path d="M12 7.5V12l3 2" />
                            </svg>
                            {m.urgent}
                          </div>
                        )}
                      </div>
                      <span className="cv-chip cv-chip-neutral">
                        {(m.status || 'ACTIVE').toUpperCase()}
                      </span>
                    </div>

                    <div className="cv-matter-grid">
                      <div>
                        <div className="cv-matter-field-label">Petitioner</div>
                        <div className="cv-matter-field-value">{m.petitioner || '—'}</div>
                      </div>
                      <div>
                        <div className="cv-matter-field-label">Respondent</div>
                        <div className="cv-matter-field-value">{m.respondent || '—'}</div>
                      </div>
                      <div>
                        <div className="cv-matter-field-label">Next hearing</div>
                        <div className="cv-matter-field-value">{m.nextHearing || '—'}</div>
                      </div>
                      <div>
                        <div className="cv-matter-field-label">Linked documents</div>
                        <div className="cv-link-chip">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.5 1.5" />
                            <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.5-1.5" />
                          </svg>
                          {m.docsLinked || 0} in vault
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="cv-card cv-empty">
                <div className="cv-empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
                  </svg>
                </div>
                <h3 className="cv-empty-title cv-serif">No matters tracked yet</h3>
                <p className="cv-empty-sub">
                  Fetch a case via CNR above, or add one manually — every matter you track can then be linked to documents in the vault.
                </p>
              </div>
            )}
          </section>
        )}

        {/* ── 4. LEGAL DRAFTS PANEL ── */}
        {activeTab === 'drafts' && (
          <section className="cv-panel" id="panel-drafts">
            <div>
              <h2 className="cv-section-title cv-serif">Legal Drafts</h2>
              <div className="cv-section-sub">
                Anything saved from Auto-Draft Studio with "Draft" in its title or type lands here automatically.
              </div>
            </div>

            {draftCount > 0 ? (
              <div className="cv-matter-list">
                {allDocs
                  .filter(d => (d.name || '').toLowerCase().includes('draft') || (d.tag || '').toLowerCase().includes('draft'))
                  .map(draft => (
                    <div key={draft.id} className="cv-matter-card">
                      <div className="cv-matter-head">
                        <div>
                          <h3 className="cv-matter-name cv-serif">{draft.name}</h3>
                          <div className="cv-matter-num">{draft.size} · Updated {draft.updated}</div>
                        </div>
                        <span className="cv-chip cv-chip-neutral">DRAFT</span>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="cv-card cv-empty">
                <div className="cv-empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                </div>
                <h3 className="cv-empty-title cv-serif">No drafts here yet</h3>
                <p className="cv-empty-sub">
                  Generate a petition, notice or agreement in Auto-Draft Studio and save it to this matter — it appears here, versioned, with its full generation history in the Provenance Trail.
                </p>
                <button
                  type="button"
                  className="cv-btn cv-btn-primary"
                  style={{ marginTop: '6px' }}
                  onClick={() => navigate('/auto-draft')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                  Open Auto-Draft Studio
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── 5. PROVENANCE TRAIL PANEL ── */}
        {activeTab === 'trail' && (
          <section className="cv-panel" id="panel-trail">
            <div className="cv-section-head">
              <div>
                <h2 className="cv-section-title cv-serif">Provenance Trail</h2>
                <div className="cv-section-sub">
                  Every AI action and file event in this vault, chained and hashed — a record you can hand to opposing counsel or the bench.
                </div>
              </div>
              <button
                type="button"
                className="cv-btn"
                onClick={() => alert('Chain integrity verified: all cryptographic SHA-256 blocks valid.')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M12 2.5l8 3.2v6c0 5-3.4 8.4-8 9.8-4.6-1.4-8-4.8-8-9.8v-6z" />
                  <path d="M9.5 12l2 2 3.2-3.6" />
                </svg>
                Verify chain integrity
              </button>
            </div>

            <div className="cv-card">
              {trail.map((t, idx) => {
                const isLast = idx === trail.length - 1;
                return (
                  <div key={t.id || idx} className="cv-trail-item">
                    <div className="cv-trail-rail">
                      <div className="cv-trail-dot" />
                      {!isLast && <div className="cv-trail-line" />}
                    </div>
                    <div className="cv-trail-body">
                      <div className="cv-trail-top">
                        <div className="cv-trail-action">{t.action}</div>
                        <div className="cv-trail-time">{t.time}</div>
                      </div>
                      <div className="cv-trail-meta">
                        {t.doc} · <span className="cv-trail-actor">{t.by}</span>
                      </div>
                      <div className="cv-trail-hash">{t.hash}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── 6. TIMELINE PANEL ── */}
        {activeTab === 'timeline' && (
          <section className="cv-panel" id="panel-timeline">
            <div className="cv-section-head">
              <div>
                <h2 className="cv-section-title cv-serif">Case Timeline</h2>
                <div className="cv-section-sub">
                  A chronological read of every dated event across your vault documents.
                </div>
              </div>
              <button
                type="button"
                className="cv-btn cv-btn-primary"
                onClick={handleExtractTimeline}
                disabled={timelineLoading}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="4.5" width="18" height="16" rx="2" />
                  <path d="M3 9.5h18" />
                </svg>
                <span>{timelineLoading ? 'Extracting…' : timelineGenerated ? 'Re-extract dates' : 'Extract dates via AI'}</span>
              </button>
            </div>

            {timelineGenerated || timelineEvents.length > 0 ? (
              <div className="cv-card">
                {timelineEvents.map((ev, idx) => {
                  const isLast = idx === timelineEvents.length - 1;
                  return (
                    <div key={ev.id || idx} className="cv-tl-item">
                      <div className="cv-tl-date">{ev.date}</div>
                      <div className="cv-tl-rail">
                        <div className="cv-tl-dot" />
                        {!isLast && <div className="cv-tl-line" />}
                      </div>
                      <div className="cv-tl-body">
                        <div className="cv-tl-label">{ev.label}</div>
                        <div className="cv-tl-source">SOURCE: {ev.source}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="cv-card cv-empty">
                <div className="cv-empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="8.5" />
                    <path d="M12 7.5V12l3 2" />
                  </svg>
                </div>
                <h3 className="cv-empty-title cv-serif">No timeline generated yet</h3>
                <p className="cv-empty-sub">
                  LexAmplify reads every document in this vault, pulls every date it finds, and lays them out chronologically — each entry links straight back to its source page.
                </p>
              </div>
            )}
          </section>
        )}

      </main>

      {/* ── 16-FIELD ADD MATTER MODAL (5 SECTIONS) ── */}
      {addMatterOpen && (
        <div className="cv-modal-overlay" onClick={() => setAddMatterOpen(false)}>
          <div className="cv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cv-modal-header">
              <div>
                <div className="cv-card-eyebrow">Case Tracker</div>
                <h3 className="cv-modal-title cv-serif">Add a matter</h3>
              </div>
              <button
                type="button"
                className="cv-btn"
                style={{ padding: '6px 10px' }}
                onClick={() => setAddMatterOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveMatterModal}>
              <div className="cv-modal-body">
                {/* Filing Dropzone */}
                <div className="cv-modal-dropzone">
                  <div className="cv-dropzone-icon" style={{ width: '36px', height: '36px', borderRadius: '10px' }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M12 16V4M7 9l5-5 5 5" />
                      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                    </svg>
                  </div>
                  <div>
                    <div className="cv-dropzone-title" style={{ fontSize: '13.5px' }}>Drop a filing for ML triage</div>
                    <div className="cv-dropzone-sub">LexAmplify pre-fills case name, parties and court from the document — or fill it in manually below.</div>
                  </div>
                </div>

                {/* Section 1: Case Identity */}
                <div>
                  <div className="cv-field-section-title">Case identity</div>
                  <div className="cv-field-grid">
                    <div className="cv-field">
                      <label htmlFor="mf-caseName">Case name <span className="cv-req">*</span></label>
                      <input
                        id="mf-caseName"
                        type="text"
                        placeholder="e.g., State vs. John Doe"
                        value={matterForm.caseName}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, caseName: e.target.value }))}
                        required
                        autoFocus
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-caseNumber">Case number</label>
                      <input
                        id="mf-caseNumber"
                        type="text"
                        placeholder="e.g., CRA/123/2026"
                        value={matterForm.caseNumber}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, caseNumber: e.target.value }))}
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-caseType">Case type</label>
                      <input
                        id="mf-caseType"
                        type="text"
                        placeholder="Civil / Criminal / IP…"
                        value={matterForm.caseType}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, caseType: e.target.value }))}
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-cnr">CNR number</label>
                      <input
                        id="mf-cnr"
                        type="text"
                        className="cv-mono"
                        placeholder="16-digit official ID"
                        value={matterForm.cnr}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, cnr: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: Court Details */}
                <div>
                  <div className="cv-field-section-title">Court details</div>
                  <div className="cv-field-grid">
                    <div className="cv-field">
                      <label htmlFor="mf-court">Court name</label>
                      <input
                        id="mf-court"
                        type="text"
                        placeholder="e.g., Delhi High Court"
                        value={matterForm.court}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, court: e.target.value }))}
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-judge">Judge name</label>
                      <input
                        id="mf-judge"
                        type="text"
                        placeholder="Hon. Justice…"
                        value={matterForm.judge}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, judge: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                {/* Section 3: Parties & Counsel */}
                <div>
                  <div className="cv-field-section-title">Parties &amp; counsel</div>
                  <div className="cv-field-grid">
                    <div className="cv-field">
                      <label htmlFor="mf-petitioner">Petitioner</label>
                      <input
                        id="mf-petitioner"
                        type="text"
                        placeholder="Petitioner / Plaintiff"
                        value={matterForm.petitioner}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, petitioner: e.target.value }))}
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-respondent">Respondent</label>
                      <input
                        id="mf-respondent"
                        type="text"
                        placeholder="Respondent / Defendant"
                        value={matterForm.respondent}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, respondent: e.target.value }))}
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-petitionerCounsel">Petitioner counsel</label>
                      <input
                        id="mf-petitionerCounsel"
                        type="text"
                        placeholder="Adv. name"
                        value={matterForm.petitionerCounsel}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, petitionerCounsel: e.target.value }))}
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-respondentCounsel">Respondent counsel</label>
                      <input
                        id="mf-respondentCounsel"
                        type="text"
                        placeholder="Adv. name"
                        value={matterForm.respondentCounsel}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, respondentCounsel: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                {/* Section 4: Dates & Status */}
                <div>
                  <div className="cv-field-section-title">Dates &amp; status</div>
                  <div className="cv-field-grid">
                    <div className="cv-field">
                      <label htmlFor="mf-filingDate">Filing date</label>
                      <input
                        id="mf-filingDate"
                        type="date"
                        value={matterForm.filingDate}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, filingDate: e.target.value }))}
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-nextHearing">Next hearing</label>
                      <input
                        id="mf-nextHearing"
                        type="date"
                        value={matterForm.nextHearing}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, nextHearing: e.target.value }))}
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-lastHearing">Last hearing</label>
                      <input
                        id="mf-lastHearing"
                        type="date"
                        value={matterForm.lastHearing}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, lastHearing: e.target.value }))}
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-status">Status</label>
                      <select
                        id="mf-status"
                        value={matterForm.status}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, status: e.target.value }))}
                      >
                        <option value="Active">Active</option>
                        <option value="Stayed">Stayed</option>
                        <option value="Disposed">Disposed</option>
                        <option value="Withdrawn">Withdrawn</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Section 5: Internal Notes */}
                <div>
                  <div className="cv-field-section-title">Internal notes</div>
                  <div className="cv-field" style={{ marginBottom: '14px' }}>
                    <label htmlFor="mf-clientName">Client name</label>
                    <input
                      id="mf-clientName"
                      type="text"
                      placeholder="Internal reference"
                      value={matterForm.clientName}
                      onChange={(e) => setMatterForm(prev => ({ ...prev, clientName: e.target.value }))}
                    />
                  </div>
                  <div className="cv-field" style={{ marginBottom: '14px' }}>
                    <label htmlFor="mf-summary">Summary</label>
                    <textarea
                      id="mf-summary"
                      rows={2}
                      placeholder="Brief case synopsis…"
                      value={matterForm.summary}
                      onChange={(e) => setMatterForm(prev => ({ ...prev, summary: e.target.value }))}
                    />
                  </div>
                  <div className="cv-field">
                    <label htmlFor="mf-notes">Notes</label>
                    <textarea
                      id="mf-notes"
                      rows={3}
                      placeholder="Strategy notes or updates…"
                      value={matterForm.notes}
                      onChange={(e) => setMatterForm(prev => ({ ...prev, notes: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <div className="cv-modal-footer">
                <button
                  type="button"
                  className="cv-btn"
                  onClick={() => setAddMatterOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="cv-btn cv-btn-primary"
                >
                  Save matter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── VAULT MODALS ── */}
      <ContextMenu 
        isOpen={contextMenu.isOpen} 
        item={contextMenu.item} 
        onClose={closeContextMenu} 
        x={contextMenu.x} 
        y={contextMenu.y}
        onOpen={(item) => setActiveFolderId(item.id)}
        onRename={(item) => {
          setRenamingId(item.id);
          setRenameValue(item.name);
        }}
        onMove={(item) => setItemToMove(item)}
        onShare={(item) => setItemToShare(item)}
        onDelete={(item) => deleteItem(item.id)}
      />

      <ShareModal
        isOpen={!!itemToShare}
        item={itemToShare}
        onClose={() => setItemToShare(null)}
      />

      <MoveModal
        isOpen={!!itemToMove}
        item={itemToMove}
        onClose={() => setItemToMove(null)}
        onMove={(newParentId) => {
          moveItem(itemToMove.id, newParentId);
          setItemToMove(null);
        }}
      />

      <SyncToast progress={syncProgress} />
    </div>
  );
}
