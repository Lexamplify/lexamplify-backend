import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSharedFiles, subscribeSharedFiles, addSharedFile } from '../utils/sharedWorkspaceStore';
import { renderWithCitations } from './CitationLink';
import { searchExternalDatabase } from '../utils/externalLegalSearch';
import ExternalResultsTable from './ExternalResultsTable';

// ── Seed data ─────────────────────────────────────────────────────────────────
export const SEED_ENTRIES = [
  {
    id: 1,
    title: 'Standard NDA (Mutual) — Commercial Disputes',
    category: 'Template',
    author: 'Firm Library',
    updated: '2026-06-20',
    tags: ['Contract Act', 'Confidentiality', 'Commercial'],
    description: 'Mutual Non-Disclosure Agreement compliant with Section 27 of the Indian Contract Act, 1872. Approved for use in High Court commercial disputes. Includes arbitration clause per DIAC Rules 2023.',
  },
  {
    id: 2,
    title: 'S. 138 NI Act — Cheque Dishonour Complaint',
    category: 'Precedent',
    author: 'Kumar & Associates',
    updated: '2026-06-15',
    tags: ['NI Act', 'Criminal', 'Delhi HC'],
    description: 'Complaint under Section 138 of the Negotiable Instruments Act, 1881. Delhi High Court approved format with standard prayers, demand notice, and legal notice compliance checklist. Cf. Dashrath Rupsingh Rathod v. State of Maharashtra, (2014) 9 SCC 129, on territorial jurisdiction for filing, and AIR 1999 SC 3762 on the presumption under Section 139.',
  },
  {
    id: 3,
    title: 'Anticipatory Bail Application — BNS 2023',
    category: 'Precedent',
    author: 'Sharma & Co.',
    updated: '2026-06-10',
    tags: ['BNS', 'BNSS', 'Criminal', 'Sessions Court'],
    description: 'Anticipatory bail application template updated for Bharatiya Nyaya Sanhita 2023 and BNSS. Cross-references equivalent CrPC sections for transitional matters. Validated by Sessions Court, Dwarka.',
  },
  {
    id: 4,
    title: 'Employment Agreement — IT Sector (NASSCOM Format)',
    category: 'Template',
    author: 'Firm Library',
    updated: '2026-05-28',
    tags: ['Employment', 'IT', 'ESOP', 'Non-Compete'],
    description: 'Standard employment agreement for the Indian IT sector. Includes ESOP vesting schedule, IP assignment clauses under the Patents Act and Copyright Act, and non-compete provisions tested under Section 27 CA.',
  },
  {
    id: 5,
    title: 'Writ Petition (PIL) — Environmental Violation',
    category: 'Precedent',
    author: 'Green Legal Cell',
    updated: '2026-05-15',
    tags: ['PIL', 'Environment', 'NGT', 'HC'],
    description: 'Public Interest Litigation template for filing before the National Green Tribunal and High Courts. Compliant with Section 16 NGT Act 2010. Includes prayer for interim injunction under Order 39 CPC.',
  },
  {
    id: 6,
    title: 'Due Diligence Checklist — M&A Transactions (India)',
    category: 'Practice Guide',
    author: 'M&A Desk',
    updated: '2026-04-30',
    tags: ['M&A', 'SEBI', 'Companies Act', 'Competition Act'],
    description: '52-point legal due diligence checklist for mergers and acquisitions under the Companies Act 2013, SEBI SAST Regulations 2011, and Competition Act 2002. Covers FEMA implications for cross-border deals.',
  },
  {
    id: 7,
    title: 'Arbitration Clause — DIAC Rules 2023 (B2B)',
    category: 'Standard Form',
    author: 'Firm Library',
    updated: '2026-04-12',
    tags: ['Arbitration', 'DIAC', 'ADR', 'Commercial'],
    description: 'Dispute resolution clause for commercial agreements adopting Delhi International Arbitration Centre Rules 2023. Seat: New Delhi. Provides for emergency arbitrator provisions and expedited procedure for claims under ₹1 Cr.',
  },
  {
    id: 8,
    title: 'Research Memo: BNS 2023 vs IPC 1860 — Key Divergences',
    category: 'Research Memo',
    author: 'Legal Research Team',
    updated: '2026-03-22',
    tags: ['BNS', 'IPC', 'Criminal Law', 'Transitional'],
    description: 'Comparative analysis of 58 key sections changed between IPC 1860 and Bharatiya Nyaya Sanhita 2023. Covers sentencing changes, new offences (organised crime, terrorism financing), and removal of obsolete provisions.',
  },
  {
    id: 9,
    title: 'Consumer Forum Complaint — SCDRC Format',
    category: 'Standard Form',
    author: 'Consumer Cell',
    updated: '2026-03-05',
    tags: ['Consumer Protection', 'SCDRC', 'Deficiency'],
    description: 'State Consumer Disputes Redressal Commission complaint format under Consumer Protection Act 2019. Includes limitation period checklist (2-year rule), deficiency in service heads, and reliefs available under Section 39.',
  },
  {
    id: 10,
    title: 'Section 9 Arbitration — Interim Relief Application',
    category: 'Precedent',
    author: 'Arbitration Desk',
    updated: '2026-02-18',
    tags: ['Arbitration Act', 'Interim Relief', 'HC'],
    description: 'Application for interim measures under Section 9 of the Arbitration and Conciliation Act 1996 (as amended 2021). Drafted for High Court filing with prayer for appointment of receiver and status quo injunction.',
  },
];

const CATEGORIES = ['All', 'Template', 'Precedent', 'Research Memo', 'Standard Form', 'Practice Guide'];

const CAT_COLORS = {
  Template:         { bg: 'rgba(59,130,246,0.12)',  color: '#60A5FA', border: 'rgba(59,130,246,0.25)' },
  Precedent:        { bg: 'rgba(245,158,11,0.12)',  color: '#FBBF24', border: 'rgba(245,158,11,0.25)' },
  'Research Memo':  { bg: 'rgba(139,92,246,0.12)',  color: '#A78BFA', border: 'rgba(139,92,246,0.25)' },
  'Standard Form':  { bg: 'rgba(16,185,129,0.12)',  color: '#34D399', border: 'rgba(16,185,129,0.25)' },
  'Practice Guide': { bg: 'rgba(20,184,166,0.12)',  color: '#2DD4BF', border: 'rgba(20,184,166,0.25)' },
};

const getCatStyle = (cat) =>
  CAT_COLORS[cat] || { bg: 'rgba(107,114,128,0.12)', color: '#9CA3AF', border: 'rgba(107,114,128,0.2)' };

// ── Clause DNA data — per category ───────────────────────────────────────────
const CLAUSE_DNA = {
  Template: [
    { id: 'def',   name: 'Definitions',             risk: 'low',    summary: 'Standard defined terms — verify "Material Breach" threshold aligns with client tolerance' },
    { id: 'pay',   name: 'Payment Terms',             risk: 'medium', summary: 'Net-30, 18% p.a. compound interest on overdue amounts; S.73 Contract Act exposure' },
    { id: 'liab',  name: 'Limitation of Liability',  risk: 'high',   summary: 'Cap at 3× monthly fee — aggressive vendor carve; inadequate for high-value transactions' },
    { id: 'indem', name: 'Indemnification',           risk: 'high',   summary: 'Mutual; excludes gross negligence — verify scope covers third-party IP infringement claims' },
    { id: 'adr',   name: 'Dispute Resolution',        risk: 'low',    summary: 'DIAC arbitration, seat New Delhi, 3-member tribunal per DIAC Rules 2023' },
    { id: 'fm',    name: 'Force Majeure',              risk: 'medium', summary: 'Excludes cyber-attacks and pandemic events — review for SaaS/cloud deployment contexts' },
    { id: 'term',  name: 'Termination',                risk: 'medium', summary: '30-day convenience notice; immediate on material breach with 15-day cure right' },
  ],
  Precedent: [
    { id: 'court', name: 'Jurisdiction & Forum',    risk: 'low',    summary: 'Delhi HC, Original Side — verify pecuniary limits under Commercial Courts Act 2015' },
    { id: 'facts', name: 'Statement of Facts',       risk: 'medium', summary: '14 paragraphs — confirm chronological accuracy; gaps in para 6–8 need corroborating evidence' },
    { id: 'grnd',  name: 'Legal Grounds',            risk: 'low',    summary: '4 statutes cited; SC authority at each ground — strong primary authority chain' },
    { id: 'intm',  name: 'Interim Relief Prayer',    risk: 'high',   summary: 'Ex-parte injunction — balance of convenience critical; urgency affidavit is mandatory' },
    { id: 'costs', name: 'Prayer for Costs',         risk: 'low',    summary: 'Actual costs + 12% interest from filing date — within High Court established norms' },
  ],
  'Research Memo': [
    { id: 'issue', name: 'Issue Presented',          risk: 'low',    summary: 'Precisely framed single dispositive question with clean scope limitation' },
    { id: 'find',  name: 'Primary Findings',         risk: 'low',    summary: '6 propositions, each supported by HC/SC authority — citation density adequate' },
    { id: 'div',   name: 'Diverging Precedents',     risk: 'high',   summary: '2 conflicting Division Bench rulings — refer to Full Bench; do not rely without resolution' },
    { id: 'risk',  name: 'Risk Assessment',          risk: 'medium', summary: 'Moderate risk overall, 60–70% favourable outcome; caveated on witness availability' },
    { id: 'rec',   name: 'Recommendations',          risk: 'low',    summary: '3 ranked action items with cost-benefit analysis and 45-day implementation window' },
  ],
  'Standard Form': [
    { id: 'scope', name: 'Scope of Work',            risk: 'medium', summary: 'Defined by Schedule A — ensure all attachments are physically annexed before execution' },
    { id: 'ip',    name: 'IP Assignment',             risk: 'high',   summary: 'Broad "work made for hire" language — may conflict with existing employee IP rights' },
    { id: 'conf',  name: 'Confidentiality',           risk: 'low',    summary: '3-year post-termination obligation; standard carve-outs for public domain and court orders' },
    { id: 'comp',  name: 'Non-Compete',               risk: 'high',   summary: '2-year, all-India, all competing businesses — enforceability doubtful per S.27 CA 1872' },
    { id: 'sev',   name: 'Severability',              risk: 'low',    summary: 'Blue-pencil doctrine incorporated — non-compete void on face; severs cleanly from agreement' },
  ],
  'Practice Guide': [
    { id: 'pre',   name: 'Pre-Filing Checklist',     risk: 'low',    summary: '12 mandatory items — court rejects filings missing even one; validate before submission' },
    { id: 'doc',   name: 'Document Requirements',    risk: 'medium', summary: 'Attestation rules changed Q1 2026 for e-filed documents — verify current HC circular' },
    { id: 'lim',   name: 'Limitation Period',        risk: 'high',   summary: 'STRICT: missed limitation is fatal — calculate from cause of action, not date of discovery' },
    { id: 'fee',   name: 'Court Fee Schedule',       risk: 'low',    summary: 'Updated April 2026 per Finance Act — use current schedule; old amounts will be rejected' },
    { id: 'svc',   name: 'Service of Process',       risk: 'medium', summary: 'E-service accepted in Delhi, Bombay, Madras HC — verify Calcutta and other HCs separately' },
  ],
};

// Simulated clause headings for the Document Preview scaffold
const DOC_PREVIEW_CLAUSES = {
  Template:         ['1. Definitions and Interpretation', '2. Term and Commencement', '3. Obligations of the Parties', '4. Consideration and Payment'],
  Precedent:        ['IN THE HIGH COURT OF DELHI', 'Statement of Facts', 'Grounds for Relief', 'Prayer'],
  'Research Memo':  ['I. Issue Presented', 'II. Brief Answer', 'III. Analysis', 'IV. Conclusion and Recommendations'],
  'Standard Form':  ['Recitals', 'Article I — Definitions', 'Article II — Scope of Work', 'Article III — Consideration'],
  'Practice Guide': ['A. Overview and Applicability', 'B. Step 1: Pre-Filing Checklist', 'C. Step 2: Document Preparation', 'D. Step 3: Filing and Service'],
};

const RISK_COLOR = {
  low:    { bg: 'rgba(16,185,129,0.1)',  color: 'var(--accent-success)', border: 'rgba(16,185,129,0.28)' },
  medium: { bg: 'rgba(245,158,11,0.1)',  color: '#FBBF24',               border: 'rgba(245,158,11,0.28)' },
  high:   { bg: 'rgba(239,68,68,0.1)',   color: 'var(--accent-danger)',  border: 'rgba(239,68,68,0.28)' },
};

// ── localStorage keys ─────────────────────────────────────────────────────────
const LS_KEY       = 'lexai_firm_library';
const NOTES_KEY    = 'lexai_fl_notes';
const REVIEWED_KEY = 'lexai_fl_reviewed';

// ── Sort icon ─────────────────────────────────────────────────────────────────
const SortIcon = ({ active, dir }) => (
  <svg width="11" height="11" viewBox="0 0 10 14" fill="none" style={{ marginLeft: 4, opacity: active ? 1 : 0.3, flexShrink: 0 }}>
    <path d="M5 1 L5 13 M1 4 L5 1 L9 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ opacity: active && dir === 'asc' ? 1 : 0.35 }} />
    <path d="M1 10 L5 13 L9 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ opacity: active && dir === 'desc' ? 1 : 0.35 }} />
  </svg>
);

// ── Styles ────────────────────────────────────────────────────────────────────
const flStyles = `
  .fl-page {
    padding: 28px 32px;
    font-family: var(--font-sans);
    color: var(--text-primary);
    transition: padding-right 0.32s cubic-bezier(0.16,1,0.3,1);
  }
  .fl-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    margin-bottom: 24px; flex-wrap: wrap; gap: 12px;
  }
  .fl-toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
  .fl-search-wrap { flex: 1; min-width: 220px; position: relative; display: flex; align-items: center; }
  .fl-search-icon { position: absolute; left: 12px; color: var(--text-muted); pointer-events: none; display: flex; align-items: center; }
  .fl-search-input {
    width: 100%; padding: 9px 12px 9px 36px;
    background: var(--bg-panel); border: 1px solid var(--border-subtle);
    border-radius: 8px; outline: none;
    color: var(--text-primary); font-family: var(--font-sans); font-size: 13.5px;
    transition: border-color 0.18s, box-shadow 0.18s;
  }
  .fl-search-input::placeholder { color: var(--text-muted); }
  .fl-search-input:focus { border-color: var(--accent-primary); box-shadow: 0 0 0 3px rgba(59,130,246,0.12); }
  .fl-cat-filter { display: flex; gap: 4px; flex-wrap: wrap; }
  .fl-cat-btn {
    padding: 7px 13px; border-radius: 7px; font-size: 12px; font-weight: 500;
    border: 1px solid var(--border-subtle); background: var(--bg-panel); color: var(--text-muted);
    cursor: pointer; transition: all 0.15s; white-space: nowrap; font-family: var(--font-sans);
  }
  .fl-cat-btn:hover { border-color: var(--accent-primary); color: var(--accent-primary); }
  .fl-cat-btn.active { background: var(--accent-primary); color: #fff; border-color: var(--accent-primary); font-weight: 600; }
  /* Table */
  .fl-table-wrap { background: var(--bg-panel); border: 1px solid var(--border-subtle); border-radius: 12px; overflow: hidden; }
  .fl-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .fl-table th {
    padding: 12px 18px; background: var(--bg-card);
    color: var(--text-muted); font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.06em;
    border-bottom: 1px solid var(--border-subtle); cursor: pointer; user-select: none; white-space: nowrap;
  }
  .fl-table th:hover { color: var(--text-primary); }
  .fl-table th.sorted { color: var(--accent-primary); }
  .fl-table td {
    padding: 13px 18px; border-bottom: 1px solid var(--border-subtle);
    color: var(--text-primary); vertical-align: middle;
  }
  .fl-table tbody tr { transition: background 0.12s; cursor: pointer; }
  .fl-table tbody tr:hover { background: rgba(59,130,246,0.05); }
  .fl-table tbody tr.fl-row-selected {
    background: rgba(59,130,246,0.07);
    box-shadow: inset 3px 0 0 var(--accent-primary);
  }
  .fl-table tbody tr.fl-row-selected:hover { background: rgba(59,130,246,0.1); }
  .fl-table tbody tr:last-child td { border-bottom: none; }
  /* Category chip */
  .fl-cat-chip {
    display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 20px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.03em; white-space: nowrap; border: 1px solid;
  }
  /* Three-dot action menu */
  .fl-row-actions { position: relative; }
  .fl-dots-btn {
    width: 28px; height: 28px; border-radius: 6px;
    background: transparent; border: none; cursor: pointer;
    color: var(--text-muted); display: flex; align-items: center; justify-content: center;
    transition: background 0.15s, color 0.15s; opacity: 0;
  }
  tr:hover .fl-dots-btn, .fl-dots-btn.open { opacity: 1; }
  .fl-dots-btn:hover, .fl-dots-btn.open { background: rgba(59,130,246,0.1); color: var(--accent-primary); }
  .fl-action-menu {
    position: fixed; z-index: 1000;
    background: var(--bg-card); border: 1px solid var(--border-subtle);
    border-radius: 8px; padding: 4px; min-width: 168px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.22);
    animation: fl-menu-in 0.14s cubic-bezier(0.16,1,0.3,1);
  }
  @keyframes fl-menu-in {
    from { opacity: 0; transform: scale(0.94) translateY(-4px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  .fl-menu-item {
    display: flex; align-items: center; gap: 9px; padding: 8px 12px; border-radius: 5px;
    font-size: 13px; color: var(--text-primary); cursor: pointer; transition: background 0.12s;
  }
  .fl-menu-item:hover { background: rgba(59,130,246,0.07); }
  .fl-menu-item.danger { color: var(--accent-danger); }
  .fl-menu-item.danger:hover { background: rgba(239,68,68,0.07); }
  .fl-menu-divider { height: 1px; background: var(--border-subtle); margin: 3px 0; }
  /* Quick Preview panel */
  .fl-preview-panel {
    position: fixed; z-index: 1100; width: 308px;
    background: var(--bg-card); border: 1px solid var(--border-subtle);
    border-radius: 12px; padding: 18px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.28), 0 0 0 1px rgba(59,130,246,0.1);
    pointer-events: auto;
    transition: opacity 0.2s cubic-bezier(0.16,1,0.3,1), transform 0.2s cubic-bezier(0.16,1,0.3,1);
    opacity: 0; transform: scale(0.94) translateY(8px); transform-origin: top center;
    will-change: opacity, transform;
  }
  .fl-preview-panel.visible { opacity: 1; transform: scale(1) translateY(0); }
  .fl-preview-title { font-size: 14px; font-weight: 700; font-family: var(--font-serif); color: var(--text-primary); line-height: 1.35; margin-bottom: 10px; }
  .fl-preview-desc { font-size: 12.5px; color: var(--text-muted); line-height: 1.6; margin-bottom: 12px; }
  .fl-preview-tags { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 14px; }
  .fl-preview-tag { font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: rgba(59,130,246,0.08); color: var(--accent-primary); border: 1px solid rgba(59,130,246,0.18); }
  .fl-preview-actions { display: flex; gap: 7px; }
  .fl-preview-btn { flex: 1; padding: 7px 10px; border-radius: 6px; font-size: 11.5px; font-weight: 600; cursor: pointer; font-family: var(--font-sans); transition: all 0.15s; text-align: center; }
  .fl-preview-btn.primary { background: var(--accent-primary); color: #fff; border: none; }
  .fl-preview-btn.primary:hover { background: var(--accent-hover); }
  .fl-preview-btn.secondary { background: transparent; color: var(--accent-primary); border: 1px solid rgba(59,130,246,0.3); }
  .fl-preview-btn.secondary:hover { background: rgba(59,130,246,0.08); }
  /* Skeleton */
  .fl-skeleton-row td { padding: 16px 18px; }
  .fl-skel-bar {
    height: 13px; border-radius: 5px;
    background: linear-gradient(90deg, var(--border-subtle) 25%, rgba(255,255,255,0.04) 50%, var(--border-subtle) 75%);
    background-size: 200% 100%; animation: fl-shimmer 1.4s infinite;
  }
  @keyframes fl-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  /* Empty state */
  .fl-empty { padding: 56px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .fl-empty-icon { font-size: 32px; }
  /* Add entry modal */
  .fl-modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
    z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  .fl-modal { background: var(--bg-panel); border: 1px solid var(--border-subtle); border-radius: 14px; width: 100%; max-width: 520px; box-shadow: 0 24px 60px rgba(0,0,0,0.35); animation: fl-modal-in 0.22s cubic-bezier(0.16,1,0.3,1); }
  @keyframes fl-modal-in { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: none; } }
  .fl-modal-header { padding: 18px 20px; border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between; }
  .fl-modal-body { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
  .fl-modal-footer { padding: 14px 20px; border-top: 1px solid var(--border-subtle); display: flex; gap: 10px; justify-content: flex-end; }
  .fl-input {
    width: 100%; padding: 9px 12px;
    background: var(--bg-card); border: 1px solid var(--border-subtle);
    border-radius: 7px; outline: none; color: var(--text-primary);
    font-family: var(--font-sans); font-size: 13.5px;
    transition: border-color 0.18s, box-shadow 0.18s;
  }
  .fl-input::placeholder { color: var(--text-muted); }
  .fl-input:focus { border-color: var(--accent-primary); box-shadow: 0 0 0 3px rgba(59,130,246,0.12); }
  .fl-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 5px; display: block; }
  /* Toast */
  .fl-toast {
    position: fixed; bottom: 24px; right: 24px; z-index: 1300;
    background: var(--bg-card); border: 1px solid var(--accent-success); color: var(--accent-success);
    padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    opacity: 0; transform: translateY(8px); transition: all 0.25s; pointer-events: none;
  }
  .fl-toast.show { opacity: 1; transform: translateY(0); }

  /* ── Workspace Drawer ──────────────────────────────────────────────────── */
  .fl-workspace-drawer {
    position: fixed; top: 0; right: 0; bottom: 0; width: 480px;
    background: var(--bg-panel); border-left: 1px solid var(--border-subtle);
    z-index: 1050; display: flex; flex-direction: column; overflow: hidden;
    transform: translateX(100%);
    transition: transform 0.32s cubic-bezier(0.16,1,0.3,1), box-shadow 0.32s ease;
  }
  .fl-workspace-drawer.open {
    transform: translateX(0);
    box-shadow: -16px 0 56px rgba(0,0,0,0.22);
  }
  /* Header */
  .fl-ws-header {
    padding: 18px 20px 0 20px; border-bottom: 1px solid var(--border-subtle); flex-shrink: 0;
  }
  .fl-ws-header-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .fl-ws-close-btn {
    width: 28px; height: 28px; border-radius: 6px; border: none; cursor: pointer;
    background: transparent; color: var(--text-muted);
    display: flex; align-items: center; justify-content: center; transition: background 0.15s, color 0.15s; flex-shrink: 0;
  }
  .fl-ws-close-btn:hover { background: rgba(239,68,68,0.08); color: var(--accent-danger); }
  .fl-ws-title { font-size: 15.5px; font-weight: 700; font-family: var(--font-serif); color: var(--text-primary); line-height: 1.35; margin-bottom: 8px; }
  .fl-ws-meta { font-size: 12px; color: var(--text-muted); margin-bottom: 16px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .fl-ws-meta-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--border-subtle); flex-shrink: 0; }
  /* Tab bar */
  .fl-ws-tabs { display: flex; padding: 0 20px; border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; background: var(--bg-panel); }
  .fl-ws-tab {
    padding: 12px 14px; font-size: 13px; font-weight: 500; color: var(--text-muted);
    background: transparent; border: none; cursor: pointer;
    font-family: var(--font-sans); transition: color 0.15s; position: relative; white-space: nowrap;
  }
  .fl-ws-tab:hover { color: var(--text-primary); }
  .fl-ws-tab.active { color: var(--accent-primary); font-weight: 600; }
  .fl-ws-tab.active::after {
    content: ''; position: absolute; bottom: 0; left: 14px; right: 14px;
    height: 2px; background: var(--accent-primary); border-radius: 2px 2px 0 0;
  }
  .fl-ws-tab-new { font-size: 9px; vertical-align: super; color: var(--accent-primary); margin-left: 2px; }
  /* Scrollable body */
  .fl-ws-body {
    flex: 1; overflow-y: auto; padding: 20px;
    animation: fl-ws-content-in 0.22s cubic-bezier(0.16,1,0.3,1);
  }
  .fl-ws-body::-webkit-scrollbar { width: 4px; }
  .fl-ws-body::-webkit-scrollbar-track { background: transparent; }
  .fl-ws-body::-webkit-scrollbar-thumb { background: var(--border-subtle); border-radius: 4px; }
  @keyframes fl-ws-content-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  /* Overview: sections */
  .fl-ws-section { margin-bottom: 22px; }
  .fl-ws-section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: 8px; }
  .fl-ws-description { font-size: 13.5px; color: var(--text-primary); line-height: 1.7; }
  .fl-ws-meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .fl-ws-meta-card { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 10px 12px; }
  .fl-ws-meta-card-label { font-size: 10px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
  .fl-ws-meta-card-value { font-size: 13px; color: var(--text-primary); font-weight: 500; }
  /* Overview: document preview */
  .fl-ws-doc-preview {
    background: var(--bg-card); border: 1px solid var(--border-subtle);
    border-radius: 10px; padding: 16px 18px;
  }
  .fl-ws-clause-heading {
    font-size: 10.5px; font-weight: 700; color: var(--text-primary);
    margin: 14px 0 6px 0; font-family: var(--font-serif);
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .fl-ws-clause-heading:first-child { margin-top: 0; }
  .fl-ws-clause-line { height: 8px; border-radius: 3px; margin-bottom: 5px; background: var(--border-subtle); opacity: 0.6; }
  /* Clause DNA tab */
  .fl-dna-intro { text-align: center; padding: 20px 0 28px; }
  .fl-dna-icon { font-size: 36px; margin-bottom: 14px; }
  .fl-dna-headline { font-size: 16px; font-weight: 700; font-family: var(--font-serif); color: var(--text-primary); margin-bottom: 8px; }
  .fl-dna-subtext { font-size: 13px; color: var(--text-muted); line-height: 1.65; margin-bottom: 22px; max-width: 320px; display: block; margin-left: auto; margin-right: auto; }
  .fl-dna-scan-btn {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 11px 26px; border-radius: 8px;
    background: var(--accent-primary); color: #fff; border: none;
    font-size: 13.5px; font-weight: 600; cursor: pointer; font-family: var(--font-sans);
    transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
    box-shadow: 0 2px 12px rgba(59,130,246,0.3);
  }
  .fl-dna-scan-btn:hover { background: var(--accent-hover); transform: translateY(-1px); box-shadow: 0 4px 20px rgba(59,130,246,0.38); }
  .fl-dna-scanning-banner {
    display: flex; align-items: center; gap: 10px; padding: 14px 16px;
    background: var(--bg-card); border: 1px solid var(--border-subtle);
    border-radius: 10px; margin-bottom: 12px;
  }
  .fl-spinner {
    width: 16px; height: 16px; flex-shrink: 0;
    border: 2px solid rgba(59,130,246,0.2); border-top-color: var(--accent-primary);
    border-radius: 50%; animation: fl-spin 0.75s linear infinite;
  }
  @keyframes fl-spin { to { transform: rotate(360deg); } }
  .fl-dna-skel { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 9px; padding: 12px 14px; margin-bottom: 8px; }
  .fl-dna-clause-card {
    background: var(--bg-card); border: 1px solid var(--border-subtle);
    border-radius: 9px; padding: 12px 14px; margin-bottom: 8px;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .fl-dna-clause-card:hover { border-color: rgba(59,130,246,0.3); box-shadow: 0 2px 10px rgba(59,130,246,0.06); }
  .fl-dna-clause-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; gap: 8px; }
  .fl-dna-clause-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .fl-dna-risk-badge {
    font-size: 9.5px; font-weight: 700; padding: 2px 8px; border-radius: 20px;
    border: 1px solid; text-transform: uppercase; letter-spacing: 0.06em; flex-shrink: 0;
  }
  .fl-dna-clause-summary { font-size: 12px; color: var(--text-muted); line-height: 1.55; }
  .fl-dna-rescan-btn {
    font-size: 11.5px; background: transparent; border: none;
    color: var(--accent-primary); cursor: pointer; padding: 4px 8px; border-radius: 4px;
    transition: background 0.12s;
  }
  .fl-dna-rescan-btn:hover { background: rgba(59,130,246,0.08); }
  /* Actions tab */
  .fl-ws-action-btn {
    width: 100%; display: flex; align-items: center; gap: 12px; padding: 13px 16px;
    border-radius: 9px; border: 1px solid var(--border-subtle);
    background: var(--bg-card); color: var(--text-primary);
    font-size: 13.5px; font-weight: 500; cursor: pointer;
    font-family: var(--font-sans); transition: all 0.15s; margin-bottom: 8px; text-align: left;
  }
  .fl-ws-action-btn:hover { border-color: var(--accent-primary); background: rgba(59,130,246,0.04); color: var(--accent-primary); }
  .fl-ws-action-btn.primary { background: var(--accent-primary); color: #fff; border-color: var(--accent-primary); font-weight: 600; }
  .fl-ws-action-btn.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: #fff; }
  .fl-ws-action-btn.reviewed { background: rgba(16,185,129,0.08); color: var(--accent-success); border-color: rgba(16,185,129,0.3); font-weight: 600; }
  .fl-ws-action-btn.reviewed:hover { background: rgba(16,185,129,0.13); border-color: var(--accent-success); color: var(--accent-success); }
  .fl-ws-notes {
    width: 100%; padding: 10px 12px;
    background: var(--bg-card); border: 1px solid var(--border-subtle);
    border-radius: 7px; outline: none; color: var(--text-primary);
    font-family: var(--font-sans); font-size: 13px;
    transition: border-color 0.18s, box-shadow 0.18s;
    resize: vertical; min-height: 96px; box-sizing: border-box; line-height: 1.6;
  }
  .fl-ws-notes::placeholder { color: var(--text-muted); }
  .fl-ws-notes:focus { border-color: var(--accent-primary); box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
  /* Light theme overrides */
  :root[data-theme="light"] .fl-table-wrap { box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
  :root[data-theme="light"] .fl-action-menu { box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
  :root[data-theme="light"] .fl-preview-panel { box-shadow: 0 8px 30px rgba(0,0,0,0.12), 0 0 0 1px rgba(59,130,246,0.1); }
  :root[data-theme="light"] .fl-workspace-drawer.open { box-shadow: -8px 0 40px rgba(0,0,0,0.1); }

  /* ── Dual-Brain RAG dossier ────────────────────────────────────────────────── */
  @keyframes fl-rag-in { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
  @keyframes fl-rag-pulse { 0%,100% { opacity:1; } 50% { opacity:0.42; } }
  .fl-rag-loading {
    display: flex; align-items: center; gap: 10px; padding: 14px 16px;
    border-radius: 10px; margin-bottom: 14px;
    background: rgba(99,102,241,0.06); border: 1px solid rgba(99,102,241,0.18);
    font-size: 12.5px; font-weight: 500; color: #A78BFA;
    animation: fl-rag-pulse 1.2s ease-in-out infinite;
  }
  .fl-rag-dossier {
    background: rgba(99,102,241,0.055); border: 1px solid rgba(99,102,241,0.22);
    border-radius: 12px; padding: 18px; margin-bottom: 16px;
    display: flex; flex-direction: column; gap: 14px;
    animation: fl-rag-in 0.22s cubic-bezier(0.16,1,0.3,1);
  }
  .fl-rag-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
  .fl-rag-brain-badge {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 9.5px; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase;
    padding: 3px 10px; border-radius: 4px;
    background: rgba(99,102,241,0.15); color: #A78BFA; border: 1px solid rgba(99,102,241,0.3);
  }
  .fl-rag-reliability { display: flex; align-items: center; gap: 8px; }
  .fl-rag-reliability-bar {
    width: 70px; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden;
  }
  .fl-rag-reliability-fill { height: 100%; border-radius: 2px; transition: width 0.7s cubic-bezier(0.16,1,0.3,1); }
  .fl-rag-reliability-label { font-size: 10.5px; font-weight: 700; }
  .fl-rag-synthesis {
    font-size: 13px; line-height: 1.75; font-weight: 500;
    color: var(--text-primary, #F8FAFC);
  }
  .fl-rag-section-label {
    font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--text-muted, #94A3B8); margin-bottom: 7px;
  }
  .fl-rag-citations { display: flex; flex-direction: column; gap: 6px; }
  .fl-rag-citation {
    font-size: 12px; padding: 9px 12px; border-radius: 7px;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09);
    color: var(--text-secondary, #E2E8F0);
  }
  .fl-rag-citation strong { color: #7EB3F5; display: block; margin-bottom: 3px; font-size: 12.5px; font-weight: 600; }
  .fl-rag-citation-link {
    color: #7EB3F5; display: block; margin-bottom: 3px; font-size: 12.5px; font-weight: 600;
    text-decoration: none; transition: color 0.18s, text-decoration-color 0.18s;
    text-decoration-color: transparent;
  }
  .fl-rag-citation-link:hover { color: #93C5FD; text-decoration: underline; text-decoration-color: rgba(147,197,253,0.5); }
  .fl-rag-ratio {
    font-size: 12px; font-weight: 500; line-height: 1.65;
    color: var(--text-secondary, #E2E8F0);
    padding: 8px 12px; background: rgba(255,255,255,0.04);
    border-radius: 7px; border: 1px solid rgba(255,255,255,0.09);
  }
  .fl-rag-warnings { display: flex; flex-direction: column; gap: 6px; }
  .fl-rag-warning {
    font-size: 11.5px; font-weight: 500; color: #FBBF24;
    display: flex; align-items: flex-start; gap: 7px;
    padding: 7px 11px; border-radius: 6px;
    background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.22); line-height: 1.55;
  }
  .fl-rag-actions { display: flex; gap: 9px; padding-top: 2px; }
  .fl-rag-action-btn {
    flex: 1; padding: 9px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
    cursor: pointer; border: 1px solid; transition: all 0.15s; font-family: var(--font-sans);
    display: flex; align-items: center; justify-content: center; gap: 6px;
  }
  .fl-rag-action-btn.copy {
    background: rgba(59,130,246,0.08); color: #7EB3F5; border-color: rgba(59,130,246,0.25);
  }
  .fl-rag-action-btn.copy:hover { background: rgba(59,130,246,0.16); border-color: rgba(59,130,246,0.45); }
  .fl-rag-action-btn.inject {
    background: rgba(99,102,241,0.1); color: #A78BFA; border-color: rgba(99,102,241,0.28);
  }
  .fl-rag-action-btn.inject:hover { background: rgba(99,102,241,0.18); border-color: rgba(99,102,241,0.5); }
  .fl-rag-action-btn.done { color: #34D399; border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.07); }
  :root[data-theme="light"] .fl-rag-dossier { background: rgba(99,102,241,0.04); }
  :root[data-theme="light"] .fl-rag-synthesis { color: var(--text-primary, #0F172A); }
  :root[data-theme="light"] .fl-rag-citation { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.1); color: var(--text-primary, #0F172A); }
  :root[data-theme="light"] .fl-rag-ratio { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.1); color: var(--text-primary, #0F172A); }

  /* ── Internal / External mode toggle ── */
  .fl-mode-toggle { display: inline-flex; gap: 3px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 9px; padding: 3px; margin-bottom: 16px; }
  .fl-mode-btn { background: transparent; border: none; color: var(--text-muted); font-size: 12.5px; font-weight: 600; padding: 7px 16px; border-radius: 6px; cursor: pointer; transition: all .15s; }
  .fl-mode-btn:hover { color: var(--text-primary); }
  .fl-mode-btn.active { background: var(--accent-primary); color: #fff; }

  /* ── External Acts & Judgments results ── */
  .fl-ext-results { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; }
  .fl-ext-result-card { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 16px 18px; }
  .fl-ext-result-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
  .fl-ext-result-title { font-size: 14.5px; font-weight: 700; color: var(--text-primary); font-family: var(--font-serif); margin-bottom: 3px; }
  .fl-ext-result-meta { font-size: 11.5px; color: var(--text-muted); }
  .fl-ext-result-open { font-size: 12px; font-weight: 600; color: var(--accent-primary); text-decoration: none; white-space: nowrap; flex-shrink: 0; }
  .fl-ext-result-open:hover { text-decoration: underline; }
  .fl-ext-result-headnote { font-size: 13px; color: var(--text-primary); line-height: 1.7; margin-bottom: 12px; }
  .fl-ext-result-actions { display: flex; gap: 8px; }
  .fl-ext-action-btn { background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.25); color: var(--accent-primary); font-size: 12px; font-weight: 600; padding: 7px 14px; border-radius: 7px; cursor: pointer; transition: all .15s; }
  .fl-ext-action-btn:hover:not(:disabled) { background: rgba(59,130,246,0.16); border-color: rgba(59,130,246,0.4); }
  .fl-ext-action-btn:disabled { opacity: .55; cursor: default; color: var(--text-muted); border-color: var(--border-subtle); background: transparent; }
  .fl-ext-action-btn.vault { background: rgba(139,92,246,0.08); border-color: rgba(139,92,246,0.25); color: #A78BFA; }
  .fl-ext-action-btn.vault:hover { background: rgba(139,92,246,0.16); border-color: rgba(139,92,246,0.4); }
`;

// ── LS helpers ────────────────────────────────────────────────────────────────
const loadEntries = () => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const seeded = SEED_ENTRIES.map(e => ({ ...e }));
  try { localStorage.setItem(LS_KEY, JSON.stringify(seeded)); } catch {}
  return seeded;
};
const saveEntries = (entries) => {
  try { localStorage.setItem(LS_KEY, JSON.stringify(entries)); } catch {}
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function FirmLibrary() {
  const navigate = useNavigate();

  // ── Core state ──────────────────────────────────────────────────────────────
  const [entries, setEntries]       = useState(loadEntries);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [catFilter, setCatFilter]   = useState('All');
  const [sortCol, setSortCol]       = useState('updated');
  const [sortDir, setSortDir]       = useState('desc');
  const [menuRow, setMenuRow]       = useState(null);
  const [menuPos, setMenuPos]       = useState({ x: 0, y: 0 });
  const [preview, setPreview]       = useState(null);
  const [previewPos, setPreviewPos] = useState({ x: 0, y: 0 });
  const [showModal, setShowModal]   = useState(false);
  const [toast, setToast]           = useState('');
  const [newEntry, setNewEntry]     = useState({ title: '', category: 'Template', author: '', description: '', tags: '' });

  // ── Internal / External library mode ────────────────────────────────────────
  const [libraryMode, setLibraryMode] = useState('internal'); // 'internal' | 'external'
  const [extQuery, setExtQuery]       = useState('');
  const [extResults, setExtResults]   = useState([]);
  const [extLoading, setExtLoading]   = useState(false);
  const [extSavedIds, setExtSavedIds] = useState(() => new Set());

  // ── Workspace state ─────────────────────────────────────────────────────────
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [activeTab, setActiveTab]         = useState('overview');
  const [dnaScanning, setDnaScanning]     = useState(false);
  const [dnaReady, setDnaReady]           = useState(false);
  const [entryKey, setEntryKey]           = useState(0);
  const [entryNotes, setEntryNotes]       = useState(() => {
    try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}'); } catch { return {}; }
  });
  const [reviewedSet, setReviewedSet]     = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(REVIEWED_KEY) || '[]')); } catch { return new Set(); }
  });

  // ── Dual-Brain RAG state ────────────────────────────────────────────────────
  const [ragResult, setRagResult]   = useState(null);
  const [ragLoading, setRagLoading] = useState(false);
  const [ragCopied, setRagCopied]         = useState(false);
  const [resolvingCitation, setResolvingCitation] = useState(null);

  // ── Shared workspace files ───────────────────────────────────────────────────
  const [sharedFiles, setSharedFiles] = useState(() => getSharedFiles().filter(f => f.modules?.includes('firm-library')));

  useEffect(() => {
    return subscribeSharedFiles(all => setSharedFiles(all.filter(f => f.modules?.includes('firm-library'))));
  }, []);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const hoverTimerRef     = useRef(null);
  const previewHoveredRef = useRef(false);
  const mousePosRef       = useRef({ x: 0, y: 0 });
  const selectedEntryRef  = useRef(null);  // mirrors selectedEntry for stable callbacks
  const wsLastEntryRef    = useRef(null);  // holds last entry during slide-out animation
  const drawerTimerRef    = useRef(null);  // DNA scan timer

  // Keep wsLastEntryRef in sync — content stays rendered during drawer close animation
  if (selectedEntry) wsLastEntryRef.current = selectedEntry;
  const wsEntry = wsLastEntryRef.current;

  // ── Effects ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 480);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!menuRow) return;
    const handler = () => setMenuRow(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [menuRow]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && selectedEntryRef.current) closeWorkspace();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []); // stable — reads from ref

  useEffect(() => {
    return () => clearTimeout(drawerTimerRef.current);
  }, []);

  // ── External Acts & Judgments debounced search ──────────────────────────────
  useEffect(() => {
    if (libraryMode !== 'external') return;
    if (extQuery.trim().length < 3) { setExtResults([]); setExtLoading(false); return; }
    setExtLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchExternalDatabase(extQuery.trim());
        setExtResults(res);
      } catch { setExtResults([]); } finally { setExtLoading(false); }
    }, 400);
    return () => clearTimeout(timer);
  }, [extQuery, libraryMode]);

  const handleSaveToLibrary = (result) => {
    const newLibEntry = {
      id: Date.now(),
      title: result.title,
      category: 'Precedent',
      author: 'External — Indian Kanoon',
      updated: new Date().toISOString().slice(0, 10),
      tags: [String(result.year), result.court],
      description: `${result.citation}. ${result.headnote}`,
    };
    const updated = [newLibEntry, ...entries];
    setEntries(updated);
    saveEntries(updated);
    setExtSavedIds(prev => new Set(prev).add(result.id));
    showToast('Saved to Firm Library');
  };

  const handleInjectExternalToVault = (result) => {
    addSharedFile({
      id: `ext-${result.id}-${Date.now()}`,
      filename: result.title,
      category: 'Precedent',
      tags: [result.citation],
      modules: ['case-vault'],
      source: 'External — Indian Kanoon',
      savedAt: new Date().toISOString(),
    });
    showToast('Injected into Case Vault workspace');
  };

  // ── Dual-Brain RAG debounced search ─────────────────────────────────────────
  useEffect(() => {
    if (search.trim().length < 3) { setRagResult(null); setRagLoading(false); return; }
    setRagLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('http://localhost:8001/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: search.trim() }),
        });
        if (!res.ok) throw new Error('RAG unavailable');
        const data = await res.json();
        setRagResult(data);
      } catch { setRagResult(null); } finally { setRagLoading(false); }
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  // ── Toast ────────────────────────────────────────────────────────────────────
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // ── Sort ─────────────────────────────────────────────────────────────────────
  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  // ── Filter + Search + Sort pipeline ──────────────────────────────────────────
  const filtered = entries
    .filter(e => catFilter === 'All' || e.category === catFilter)
    .filter(e => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        e.title.toLowerCase().includes(q) ||
        e.author.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.tags || []).some(t => t.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => {
      let va = a[sortCol] || '';
      let vb = b[sortCol] || '';
      if (sortCol === 'updated') { va = new Date(va); vb = new Date(vb); }
      else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

  // ── Quick Preview (hover) ─────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e) => {
    mousePosRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleRowMouseEnter = useCallback((entry, e) => {
    // Suppress hover preview when workspace drawer is open
    if (selectedEntryRef.current) return;
    clearTimeout(hoverTimerRef.current);
    mousePosRef.current = { x: e.clientX, y: e.clientY };
    hoverTimerRef.current = setTimeout(() => {
      if (previewHoveredRef.current) return;
      const PANEL_W = 308, PANEL_H = 300, OFFSET = 18, VP_PAD = 12, SIDEBAR_SAFE = 256;
      const { x: mx, y: my } = mousePosRef.current;
      let x = mx + OFFSET;
      if (x + PANEL_W > window.innerWidth - VP_PAD) x = mx - PANEL_W - OFFSET;
      x = Math.max(SIDEBAR_SAFE, Math.min(x, window.innerWidth - PANEL_W - VP_PAD));
      let y = my - 60;
      y = Math.max(VP_PAD, Math.min(y, window.innerHeight - PANEL_H - VP_PAD));
      setPreviewPos({ x, y });
      setPreview(entry);
    }, 620);
  }, []);

  const handleRowMouseLeave = useCallback(() => {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      if (!previewHoveredRef.current) setPreview(null);
    }, 140);
  }, []);

  const handlePreviewMouseEnter = () => {
    previewHoveredRef.current = true;
    clearTimeout(hoverTimerRef.current);
  };
  const handlePreviewMouseLeave = () => {
    previewHoveredRef.current = false;
    setPreview(null);
  };

  // ── Workspace open / close ────────────────────────────────────────────────────
  const openWorkspace = useCallback((entry, e) => {
    e.stopPropagation();
    clearTimeout(hoverTimerRef.current);
    clearTimeout(drawerTimerRef.current);
    previewHoveredRef.current = false;
    setPreview(null);

    if (selectedEntryRef.current?.id === entry.id) {
      // Toggle: clicking the same row again closes the workspace
      selectedEntryRef.current = null;
      setSelectedEntry(null);
      return;
    }

    selectedEntryRef.current = entry;
    setSelectedEntry(entry);
    setActiveTab('overview');
    setDnaScanning(false);
    setDnaReady(false);
    setEntryKey(k => k + 1);
  }, []);

  const closeWorkspace = useCallback(() => {
    clearTimeout(drawerTimerRef.current);
    selectedEntryRef.current = null;
    setSelectedEntry(null);
    setDnaScanning(false);
    setDnaReady(false);
  }, []);

  // ── Clause DNA scan ───────────────────────────────────────────────────────────
  const runDnaScan = useCallback(() => {
    clearTimeout(drawerTimerRef.current);
    setDnaScanning(true);
    setDnaReady(false);
    drawerTimerRef.current = setTimeout(() => {
      setDnaScanning(false);
      setDnaReady(true);
    }, 1800);
  }, []);

  // ── Notes & Reviewed persistence ──────────────────────────────────────────────
  const saveNote = useCallback((id, text) => {
    setEntryNotes(prev => {
      const updated = { ...prev, [id]: text };
      try { localStorage.setItem(NOTES_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  const toggleReviewed = useCallback((id) => {
    setReviewedSet(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      try { localStorage.setItem(REVIEWED_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  // ── Action menu ───────────────────────────────────────────────────────────────
  const openMenu = (id, e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPos({ x: rect.left - 140, y: rect.bottom + 4 });
    setMenuRow(id);
  };

  const deleteEntry = (id) => {
    setEntries(prev => {
      const updated = prev.filter(e => e.id !== id);
      saveEntries(updated);
      return updated;
    });
    if (selectedEntryRef.current?.id === id) closeWorkspace();
    setMenuRow(null);
    showToast('Entry removed from library');
  };

  const copyTitle = (title) => {
    navigator.clipboard.writeText(title).catch(() => {});
    setMenuRow(null);
    showToast('Title copied to clipboard');
  };

  const sendToConflict = (title) => {
    setMenuRow(null);
    navigate(`/conflict-engine?entity=${encodeURIComponent(title)}`);
  };

  // Decoupled bridge to the Case Vault — reuses the existing shared-workspace
  // pub/sub (localStorage + CustomEvent) that CaseVault already subscribes to,
  // tagged for the 'case-vault' module. No new store, no prop drilling.
  const injectToVault = (id) => {
    const entry = entries.find(e => e.id === id);
    setMenuRow(null);
    if (!entry) return;
    addSharedFile({
      id: `fl-${entry.id}-${Date.now()}`,
      filename: entry.title,
      category: entry.category,
      tags: entry.tags || [],
      modules: ['case-vault'],
      source: 'Firm Library',
      savedAt: new Date().toISOString(),
    });
    showToast('Injected into Case Vault workspace');
  };

  // ── Add new entry ─────────────────────────────────────────────────────────────
  const EMPTY_FORM = { title: '', category: 'Template', author: '', description: '', tags: '' };
  const handleAddEntry = (e) => {
    e.preventDefault();
    if (!newEntry.title.trim()) return;
    const entry = {
      id: Date.now(),
      title: newEntry.title.trim(),
      category: newEntry.category,
      author: newEntry.author.trim() || 'Firm Library',
      updated: new Date().toISOString().split('T')[0],
      tags: newEntry.tags.split(',').map(t => t.trim()).filter(Boolean),
      description: newEntry.description.trim(),
    };
    setEntries(prev => {
      const updated = [entry, ...prev];
      saveEntries(updated);
      return updated;
    });
    setShowModal(false);
    setNewEntry(EMPTY_FORM);
    showToast('Entry added to Firm Library');
  };

  const ThHeader = ({ col, label, style }) => (
    <th onClick={() => handleSort(col)} className={sortCol === col ? 'sorted' : ''} style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {label}
        <SortIcon active={sortCol === col} dir={sortDir} />
      </div>
    </th>
  );

  // ── Workspace render helpers ──────────────────────────────────────────────────
  const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <>
      <style>{flStyles}</style>

      {/* Main page — padding-right compresses to make room for the drawer */}
      <div
        className="fl-page"
        style={{ paddingRight: selectedEntry ? 'calc(32px + 480px)' : '32px' }}
      >
        {/* Header */}
        <div className="fl-header">
          <div>
            <h1 style={{ fontSize: '24px', margin: '0 0 4px', fontFamily: 'var(--font-serif)' }}>
              Firm Library
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
              Central knowledge management — precedents, templates, and practice guides.
            </p>
          </div>
          <button
            className="btn-accent"
            onClick={() => setShowModal(true)}
            style={{ padding: '10px 20px', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: 7 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Entry
          </button>
        </div>

        {/* Internal / External mode toggle */}
        <div className="fl-mode-toggle">
          <button
            className={`fl-mode-btn${libraryMode === 'internal' ? ' active' : ''}`}
            onClick={() => setLibraryMode('internal')}
          >
            Internal Firm Files
          </button>
          <button
            className={`fl-mode-btn${libraryMode === 'external' ? ' active' : ''}`}
            onClick={() => setLibraryMode('external')}
          >
            External Database
          </button>
        </div>

        {libraryMode === 'internal' && (
        <>
        {/* Toolbar */}
        <div className="fl-toolbar">
          <div className="fl-search-wrap">
            <span className="fl-search-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
            </span>
            <input
              type="text"
              className="fl-search-input"
              placeholder="Search titles, authors, tags, descriptions…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="fl-cat-filter">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                className={`fl-cat-btn${catFilter === cat ? ' active' : ''}`}
                onClick={() => setCatFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* ── RAG Intelligence Dossier ── */}
        {ragLoading && (
          <div className="fl-rag-loading">
            <div style={{ width: 14, height: 14, border: '2px solid rgba(139,92,246,0.3)', borderTopColor: '#A78BFA', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
            Querying Dual-Brain intelligence layer…
          </div>
        )}
        {!ragLoading && ragResult?.brain === 'EXTERNAL' && ragResult.synthesis && (() => {
          const pct = ragResult.reliability_index != null ? Math.round(ragResult.reliability_index * 100) : null;
          const reliColor = pct == null ? '#94A3B8' : pct >= 75 ? '#34D399' : pct >= 50 ? '#FBBF24' : '#F87171';
          return (
            <div className="fl-rag-dossier">
              <div className="fl-rag-header">
                <span className="fl-rag-brain-badge">⚡ External Intelligence</span>
                {pct != null && (
                  <div className="fl-rag-reliability">
                    <div className="fl-rag-reliability-bar">
                      <div className="fl-rag-reliability-fill" style={{ width: `${pct}%`, background: reliColor }} />
                    </div>
                    <span className="fl-rag-reliability-label" style={{ color: reliColor }}>{pct}% reliable</span>
                  </div>
                )}
              </div>
              <div className="fl-rag-synthesis">{renderWithCitations(ragResult.synthesis)}</div>
              {ragResult.citations?.length > 0 && (
                <div>
                  <div className="fl-rag-section-label">Citations</div>
                  <div className="fl-rag-citations">
                    {ragResult.citations.slice(0, 3).map((c, i) => {
                      const citKey = `${c.case_name}-${c.year}`;
                      const isResolving = resolvingCitation === citKey;
                      return (
                      <div key={i} className="fl-rag-citation">
                        <button
                          className="fl-rag-citation-link"
                          disabled={isResolving}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: isResolving ? 'default' : 'pointer', fontFamily: 'inherit' }}
                          onClick={async () => {
                            const win = window.open('', '_blank');
                            setResolvingCitation(citKey);
                            try {
                              const res = await fetch(`http://localhost:8001/api/resolve-citation?query=${encodeURIComponent(`${c.case_name} ${c.year}`)}`);
                              const { exact_url } = await res.json();
                              win.location.href = exact_url;
                            } catch {
                              win.location.href = `https://indiankanoon.org/search/?formInput=${encodeURIComponent(`${c.case_name} ${c.year}`)}`;
                            } finally {
                              setResolvingCitation(null);
                            }
                          }}
                        >
                          {isResolving ? '⟳ Resolving…' : `${c.case_name} (${c.year})`}
                        </button>
                        {c.relevance_note}
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {ragResult.facts_vs_ruling?.ruling_summary && (
                <div>
                  <div className="fl-rag-section-label">Ratio Decidendi</div>
                  <div className="fl-rag-ratio">{ragResult.facts_vs_ruling.ruling_summary}</div>
                </div>
              )}
              {ragResult.risk_warnings?.length > 0 && (
                <div>
                  <div className="fl-rag-section-label">Risk Advisories</div>
                  <div className="fl-rag-warnings">
                    {ragResult.risk_warnings.slice(0, 2).map((w, i) => (
                      <div key={i} className="fl-rag-warning">⚠ {w}</div>
                    ))}
                  </div>
                </div>
              )}
              {/* ── Action buttons ── */}
              <div className="fl-rag-actions">
                <button
                  className={`fl-rag-action-btn copy${ragCopied ? ' done' : ''}`}
                  onClick={() => {
                    const lines = (ragResult.citations || [])
                      .map(c => `${c.case_name} (${c.year}) — ${c.relevance_note}`)
                      .join('\n');
                    navigator.clipboard.writeText(lines || ragResult.synthesis || '').then(() => {
                      setRagCopied(true);
                      showToast('Citation copied to clipboard');
                      setTimeout(() => setRagCopied(false), 2200);
                    });
                  }}
                >
                  {ragCopied ? '✓ Copied' : '⎘ Copy Citation'}
                </button>
                <button
                  className="fl-rag-action-btn inject"
                  onClick={() => {
                    const memoContent = [
                      `[DUAL-BRAIN INTELLIGENCE — External Case Law]`,
                      `Query: ${search.trim()}`,
                      ``,
                      `SYNTHESIS:`,
                      ragResult.synthesis || '',
                      ``,
                      `CITATIONS:`,
                      ...(ragResult.citations || []).map(c => `• ${c.case_name} (${c.year}) — ${c.relevance_note}`),
                      ``,
                      `RATIO DECIDENDI:`,
                      ragResult.facts_vs_ruling?.ruling_summary || 'N/A',
                      ``,
                      `RISK ADVISORIES:`,
                      ...(ragResult.risk_warnings || []).map(w => `⚠ ${w}`),
                    ].join('\n');
                    const syntheticEntry = {
                      id: Date.now(),
                      title: `Research Brief: ${search.trim()}`,
                      category: 'Research Memo',
                      author: 'AI Intelligence Layer',
                      updated: new Date().toISOString().slice(0, 10),
                      tags: ['Research', 'AI-Generated', 'Case Law'],
                      description: memoContent,
                    };
                    const updated = [syntheticEntry, ...entries];
                    setEntries(updated);
                    saveEntries(updated);
                    showToast(`Brief injected into library`);
                  }}
                >
                  + Inject Brief as Memo
                </button>
              </div>
            </div>
          );
        })()}

        {/* Shared workspace files */}
        {sharedFiles.length > 0 && (
          <div style={{ marginBottom: '16px', background: 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', gap: '7px' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#A78BFA', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Shared from Platform — {sharedFiles.length} file{sharedFiles.length !== 1 ? 's' : ''}</span>
            </div>
            {sharedFiles.map(f => (
              <div key={f.id} style={{ padding: '10px 16px', borderBottom: '1px solid rgba(139,92,246,0.08)', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-dark-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span style={{ fontSize: '13px', color: 'var(--text-dark-primary)', fontWeight: 500, flex: 1 }}>{f.filename}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)', background: 'rgba(139,92,246,0.1)', padding: '2px 8px', borderRadius: '10px' }}>{f.format?.toUpperCase()}</span>
                <span style={{ fontSize: '10.5px', color: 'var(--text-dark-muted)' }}>{new Date(f.savedAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}

        {/* Count */}
        {!loading && (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
            {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
            {search || catFilter !== 'All' ? ' matching filters' : ' in library'}
            {selectedEntry && (
              <span style={{ marginLeft: 12, color: 'var(--accent-primary)', fontWeight: 600 }}>
                · Workspace open
              </span>
            )}
          </div>
        )}

        {/* Data Grid */}
        <div className="fl-table-wrap" onMouseMove={handleMouseMove}>
          <table className="fl-table">
            <thead>
              <tr>
                <ThHeader col="title"    label="Document Title"   style={{ width: '38%' }} />
                <ThHeader col="category" label="Category"         style={{ width: '14%' }} />
                <ThHeader col="updated"  label="Last Updated"     style={{ width: '13%' }} />
                <ThHeader col="author"   label="Author / Source"  style={{ width: '18%' }} />
                <th style={{ width: '48px' }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="fl-skeleton-row">
                    <td><div className="fl-skel-bar" style={{ width: `${55 + (i % 3) * 15}%` }} /></td>
                    <td><div className="fl-skel-bar" style={{ width: '70%' }} /></td>
                    <td><div className="fl-skel-bar" style={{ width: '80%' }} /></td>
                    <td><div className="fl-skel-bar" style={{ width: '60%' }} /></td>
                    <td />
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="5">
                    <div className="fl-empty">
                      <div className="fl-empty-icon">📂</div>
                      <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>No entries found</div>
                      <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                        {search ? `No results for "${search}"` : 'Add the first entry to get started'}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : filtered.map(entry => {
                const catStyle = getCatStyle(entry.category);
                const isSelected = selectedEntry?.id === entry.id;
                return (
                  <tr
                    key={entry.id}
                    className={isSelected ? 'fl-row-selected' : ''}
                    onClick={e => openWorkspace(entry, e)}
                    onMouseEnter={e => handleRowMouseEnter(entry, e)}
                    onMouseLeave={handleRowMouseLeave}
                  >
                    <td>
                      <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: 3, lineHeight: 1.35 }}>
                        {entry.title}
                      </div>
                      {entry.tags?.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {entry.tags.slice(0, 3).map(t => (
                            <span key={t} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', background: 'rgba(59,130,246,0.07)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>{t}</span>
                          ))}
                          {entry.tags.length > 3 && <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>+{entry.tags.length - 3}</span>}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="fl-cat-chip" style={{ background: catStyle.bg, color: catStyle.color, borderColor: catStyle.border }}>
                        {entry.category}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px', whiteSpace: 'nowrap' }}>
                      {fmtDate(entry.updated)}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{entry.author}</td>
                    <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <div className="fl-row-actions">
                        <button
                          className={`fl-dots-btn${menuRow === entry.id ? ' open' : ''}`}
                          onClick={e => openMenu(entry.id, e)}
                          title="Actions"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
        )}

        {libraryMode === 'external' && (
          <>
            <div className="fl-toolbar">
              <div className="fl-search-wrap">
                <span className="fl-search-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                  </svg>
                </span>
                <input
                  type="text"
                  className="fl-search-input"
                  placeholder="Search Acts, Judgments, and case law by name, citation, or court…"
                  value={extQuery}
                  onChange={e => setExtQuery(e.target.value)}
                />
              </div>
            </div>

            {extLoading && (
              <div className="fl-rag-loading">
                <div style={{ width: 14, height: 14, border: '2px solid rgba(139,92,246,0.3)', borderTopColor: '#A78BFA', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                Querying external Acts &amp; Judgments database…
              </div>
            )}

            {!extLoading && extQuery.trim().length >= 3 && extResults.length === 0 && (
              <div className="fl-empty">
                <div className="fl-empty-icon">📂</div>
                <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>No matches found</div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Try a different case name, citation, or court.</div>
              </div>
            )}

            {!extLoading && extQuery.trim().length < 3 && extResults.length === 0 && (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '20px 0' }}>
                Type at least 3 characters to search external Acts and Judgments.
              </div>
            )}

            <ExternalResultsTable
              results={extResults}
              savedIds={extSavedIds}
              onSaveToLibrary={handleSaveToLibrary}
              onInjectToVault={handleInjectExternalToVault}
            />
          </>
        )}
      </div>{/* end .fl-page */}

      {/* Action menu dropdown */}
      {menuRow && (
        <div
          className="fl-action-menu"
          style={{ top: menuPos.y, left: Math.max(8, menuPos.x) }}
          onClick={e => e.stopPropagation()}
        >
          <div className="fl-menu-item" onClick={() => copyTitle(entries.find(e => e.id === menuRow)?.title || '')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Copy Title
          </div>
          <div className="fl-menu-item" onClick={() => sendToConflict(entries.find(e => e.id === menuRow)?.title || '')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            Send to Conflict Engine
          </div>
          <div className="fl-menu-item" onClick={() => injectToVault(menuRow)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Inject into Vault
          </div>
          <div className="fl-menu-divider" />
          <div className="fl-menu-item danger" onClick={() => deleteEntry(menuRow)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>
            </svg>
            Remove from Library
          </div>
        </div>
      )}

      {/* Quick Preview panel — 620ms hover reveal */}
      {preview && !selectedEntry && (
        <div
          className="fl-preview-panel visible"
          style={{ top: previewPos.y, left: previewPos.x }}
          onMouseEnter={handlePreviewMouseEnter}
          onMouseLeave={handlePreviewMouseLeave}
        >
          <span className="fl-cat-chip" style={{ ...getCatStyle(preview.category), marginBottom: 10, display: 'inline-flex' }}>
            {preview.category}
          </span>
          <div className="fl-preview-title">{preview.title}</div>
          {preview.description && (
            <div className="fl-preview-desc">
              {preview.description.length > 200 ? preview.description.slice(0, 200) + '…' : preview.description}
            </div>
          )}
          {preview.tags?.length > 0 && (
            <div className="fl-preview-tags">
              {preview.tags.map(t => <span key={t} className="fl-preview-tag">{t}</span>)}
            </div>
          )}
          <div className="fl-preview-actions">
            <button className="fl-preview-btn secondary" onClick={() => { copyTitle(preview.title); setPreview(null); }}>
              Copy Title
            </button>
            <button className="fl-preview-btn primary" onClick={() => { sendToConflict(preview.title); setPreview(null); }}>
              Conflict Check →
            </button>
          </div>
        </div>
      )}

      {/* ── Workspace Drawer ──────────────────────────────────────────────────── */}
      <div className={`fl-workspace-drawer${selectedEntry ? ' open' : ''}`}>
        {wsEntry && (() => {
          const e        = wsEntry;
          const catStyle = getCatStyle(e.category);
          const clauses  = CLAUSE_DNA[e.category] || CLAUSE_DNA['Template'];
          const previewClauses = DOC_PREVIEW_CLAUSES[e.category] || DOC_PREVIEW_CLAUSES['Template'];
          const isReviewed = reviewedSet.has(e.id);
          const noteText   = entryNotes[e.id] || '';

          return (
            <>
              {/* Header */}
              <div className="fl-ws-header">
                <div className="fl-ws-header-row">
                  <span className="fl-cat-chip" style={{ background: catStyle.bg, color: catStyle.color, borderColor: catStyle.border }}>
                    {e.category}
                  </span>
                  <button className="fl-ws-close-btn" onClick={closeWorkspace} title="Close (Esc)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
                <div className="fl-ws-title">{e.title}</div>
                <div className="fl-ws-meta">
                  <span>{e.author}</span>
                  <div className="fl-ws-meta-dot" />
                  <span>Updated {fmtDate(e.updated)}</span>
                  {isReviewed && (
                    <>
                      <div className="fl-ws-meta-dot" />
                      <span style={{ color: 'var(--accent-success)', fontWeight: 600 }}>✓ Reviewed</span>
                    </>
                  )}
                </div>
              </div>

              {/* Tab bar */}
              <div className="fl-ws-tabs">
                <button className={`fl-ws-tab${activeTab === 'overview' ? ' active' : ''}`} onClick={() => setActiveTab('overview')}>
                  Overview
                </button>
                <button className={`fl-ws-tab${activeTab === 'dna' ? ' active' : ''}`} onClick={() => setActiveTab('dna')}>
                  Clause DNA <span className="fl-ws-tab-new">✦NEW</span>
                </button>
                <button className={`fl-ws-tab${activeTab === 'actions' ? ' active' : ''}`} onClick={() => setActiveTab('actions')}>
                  Actions
                </button>
              </div>

              {/* Tab body — key triggers fade-in animation on row switch */}
              <div className="fl-ws-body" key={entryKey}>

                {/* ── OVERVIEW TAB ── */}
                {activeTab === 'overview' && (
                  <>
                    <div className="fl-ws-section">
                      <div className="fl-ws-section-label">Description</div>
                      <div className="fl-ws-description">{renderWithCitations(e.description)}</div>
                    </div>

                    {e.tags?.length > 0 && (
                      <div className="fl-ws-section">
                        <div className="fl-ws-section-label">Tags</div>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {e.tags.map(t => <span key={t} className="fl-preview-tag">{t}</span>)}
                        </div>
                      </div>
                    )}

                    <div className="fl-ws-section">
                      <div className="fl-ws-section-label">Metadata</div>
                      <div className="fl-ws-meta-grid">
                        <div className="fl-ws-meta-card">
                          <div className="fl-ws-meta-card-label">Author / Source</div>
                          <div className="fl-ws-meta-card-value">{e.author}</div>
                        </div>
                        <div className="fl-ws-meta-card">
                          <div className="fl-ws-meta-card-label">Category</div>
                          <div className="fl-ws-meta-card-value">{e.category}</div>
                        </div>
                        <div className="fl-ws-meta-card">
                          <div className="fl-ws-meta-card-label">Last Updated</div>
                          <div className="fl-ws-meta-card-value">{fmtDate(e.updated)}</div>
                        </div>
                        <div className="fl-ws-meta-card">
                          <div className="fl-ws-meta-card-label">Tag Count</div>
                          <div className="fl-ws-meta-card-value">{e.tags?.length || 0} tag{e.tags?.length !== 1 ? 's' : ''}</div>
                        </div>
                      </div>
                    </div>

                    <div className="fl-ws-section">
                      <div className="fl-ws-section-label">Document Preview</div>
                      <div className="fl-ws-doc-preview">
                        {previewClauses.map((clause, i) => (
                          <React.Fragment key={i}>
                            <div className="fl-ws-clause-heading">{clause}</div>
                            <div className="fl-ws-clause-line" style={{ width: '100%' }} />
                            <div className="fl-ws-clause-line" style={{ width: `${80 - i * 6}%` }} />
                            {i < previewClauses.length - 1 && (
                              <div className="fl-ws-clause-line" style={{ width: `${62 + i * 5}%` }} />
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* ── CLAUSE DNA TAB ── */}
                {activeTab === 'dna' && (
                  <>
                    {/* Intro state */}
                    {!dnaScanning && !dnaReady && (
                      <div className="fl-dna-intro">
                        <div className="fl-dna-icon">🔬</div>
                        <div className="fl-dna-headline">Clause DNA Extractor</div>
                        <span className="fl-dna-subtext">
                          AI-powered clause taxonomy analysis. Identifies key legal provisions, surfaces risk signals, and flags non-standard or aggressive terms for immediate review.
                        </span>
                        <button className="fl-dna-scan-btn" onClick={runDnaScan}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                          </svg>
                          Run Extraction
                        </button>
                      </div>
                    )}

                    {/* Scanning state */}
                    {dnaScanning && (
                      <div>
                        <div className="fl-dna-scanning-banner" style={{ marginBottom: 16 }}>
                          <div className="fl-spinner" />
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>Extracting clause taxonomy…</div>
                            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Analysing document structure and legal provisions</div>
                          </div>
                        </div>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <div key={i} className="fl-dna-skel" style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                              <div className="fl-skel-bar" style={{ width: `${38 + i * 8}%`, height: 11 }} />
                              <div className="fl-skel-bar" style={{ width: '18%', height: 11 }} />
                            </div>
                            <div className="fl-skel-bar" style={{ width: '92%', height: 8 }} />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Results state */}
                    {dnaReady && (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            <span style={{ color: 'var(--accent-success)', fontWeight: 700 }}>✓</span>{' '}
                            {clauses.length} clauses detected
                          </div>
                          <button className="fl-dna-rescan-btn" onClick={runDnaScan}>↻ Re-scan</button>
                        </div>
                        {/* Risk legend */}
                        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                          {['low', 'medium', 'high'].map(r => (
                            <span key={r} className="fl-dna-risk-badge" style={{ background: RISK_COLOR[r].bg, color: RISK_COLOR[r].color, borderColor: RISK_COLOR[r].border }}>
                              {r}
                            </span>
                          ))}
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', alignSelf: 'center' }}>— Risk level indicators</span>
                        </div>
                        {clauses.map(clause => {
                          const rc = RISK_COLOR[clause.risk];
                          return (
                            <div key={clause.id} className="fl-dna-clause-card">
                              <div className="fl-dna-clause-header">
                                <div className="fl-dna-clause-name">{clause.name}</div>
                                <span className="fl-dna-risk-badge" style={{ background: rc.bg, color: rc.color, borderColor: rc.border }}>
                                  {clause.risk}
                                </span>
                              </div>
                              <div className="fl-dna-clause-summary">{clause.summary}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                {/* ── ACTIONS TAB ── */}
                {activeTab === 'actions' && (
                  <>
                    <div style={{ marginBottom: 22 }}>
                      <button className="fl-ws-action-btn primary" onClick={() => sendToConflict(e.title)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                        </svg>
                        Run Conflict Check
                      </button>

                      <button
                        className={`fl-ws-action-btn${isReviewed ? ' reviewed' : ''}`}
                        onClick={() => toggleReviewed(e.id)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        {isReviewed ? '✓ Marked as Reviewed' : 'Mark as Reviewed'}
                      </button>

                      <button
                        className="fl-ws-action-btn"
                        onClick={() => {
                          navigator.clipboard.writeText(e.description || e.title).catch(() => {});
                          showToast('Description copied to clipboard');
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        Copy Description
                      </button>

                      <button
                        className="fl-ws-action-btn"
                        onClick={() => showToast(`"${e.title.slice(0, 40)}…" added to active matter`)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                          <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
                        </svg>
                        Export to Matter
                      </button>
                    </div>

                    <div className="fl-ws-section">
                      <div className="fl-ws-section-label">Case Notes</div>
                      <textarea
                        className="fl-ws-notes"
                        placeholder="Add private notes — observations, client feedback, usage history, risks identified…"
                        value={noteText}
                        onChange={ev => saveNote(e.id, ev.target.value)}
                      />
                      {noteText && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 5 }}>
                          Notes saved automatically
                        </div>
                      )}
                    </div>
                  </>
                )}

              </div>{/* end .fl-ws-body */}
            </>
          );
        })()}
      </div>{/* end .fl-workspace-drawer */}

      {/* Add Entry Modal */}
      {showModal && (
        <div className="fl-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="fl-modal" onClick={ev => ev.stopPropagation()}>
            <div className="fl-modal-header">
              <span style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)' }}>Add to Firm Library</span>
              <button onClick={() => setShowModal(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}>&times;</button>
            </div>
            <form onSubmit={handleAddEntry}>
              <div className="fl-modal-body">
                <div>
                  <label className="fl-label">Document Title *</label>
                  <input required className="fl-input" placeholder="e.g., Standard Lease Agreement — Residential" value={newEntry.title} onChange={ev => setNewEntry(p => ({ ...p, title: ev.target.value }))} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="fl-label">Category</label>
                    <select className="fl-input" value={newEntry.category} onChange={ev => setNewEntry(p => ({ ...p, category: ev.target.value }))}>
                      {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="fl-label">Author / Source</label>
                    <input className="fl-input" placeholder="Firm Library" value={newEntry.author} onChange={ev => setNewEntry(p => ({ ...p, author: ev.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="fl-label">Tags (comma-separated)</label>
                  <input className="fl-input" placeholder="Contract Act, Commercial, High Court" value={newEntry.tags} onChange={ev => setNewEntry(p => ({ ...p, tags: ev.target.value }))} />
                </div>
                <div>
                  <label className="fl-label">Description</label>
                  <textarea className="fl-input" rows="3" placeholder="Brief description of this document's use case and legal basis…" value={newEntry.description} onChange={ev => setNewEntry(p => ({ ...p, description: ev.target.value }))} style={{ resize: 'none' }} />
                </div>
              </div>
              <div className="fl-modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn-accent" style={{ padding: '9px 24px' }}>Add to Library</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast */}
      <div className={`fl-toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  );
}
