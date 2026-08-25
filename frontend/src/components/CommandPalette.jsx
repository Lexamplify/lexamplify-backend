import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// ═══════════════════════════════════════════════════════
//  SESSION STORE  (localStorage-persisted)
// ═══════════════════════════════════════════════════════
const SESSIONS_KEY = 'lexai_sessions_v2';
const CURRENT_KEY = 'lexai_current_session_v2';
const MAX_SESSIONS = 30;

const genId = () => `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

const loadSessions = () => {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); }
  catch { return []; }
};

const persistSessions = (sessions) => {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS))); }
  catch (_) { }
};

const makeSession = () => ({
  id: genId(),
  title: 'New conversation',
  messages: [],
  pendingSchedule: null,
  pendingDraft: null,
  activeDocument: null,   // persists after draft card is rejected/closed
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

// ═══════════════════════════════════════════════════════
//  NAVIGATION INTENT MAP  (client-side fast-path)
// ═══════════════════════════════════════════════════════
const NAV_MAP = [
  { kw: ['high court', 'highcourt', 'high courts'], route: '/court-resources', tab: 'highcourt' },
  { kw: ['district court', 'subordinate court', 'district courts'], route: '/court-resources', tab: 'district' },
  { kw: ['supreme court'], route: '/court-resources', tab: 'supreme' },
  { kw: ['bare act', 'bare acts', 'ipc', 'crpc', 'laws'], route: '/court-resources', tab: 'laws' },
  { kw: ['legal event', 'legal events'], route: '/court-resources', tab: 'events' },
  { kw: ['court fee', 'fee calculator', 'court fees'], route: '/court-resources', tab: 'courtfee' },
  { kw: ['e-notary', 'enotary', 'notary'], route: '/court-resources', tab: 'enotary' },
  { kw: ['ip tracker', 'iptracker', 'trademark', 'patent'], route: '/court-resources', tab: 'iptracker' },
  { kw: ['court resource', 'ecourt', 'e-court'], route: '/court-resources', tab: null },
  { kw: ['calendar', 'hearing schedule', 'deadlines', 'schedule'], route: '/calendar', tab: null },
  { kw: ['vault', 'case vault', 'document vault'], route: '/vault', tab: null },
  { kw: ['contract analy', 'risk scan', 'analyzer'], route: '/analyzer', tab: null },
  { kw: ['quick draft', 'quickdraft', 'draft studio', 'fast track'], route: '/contract-analyzer', tab: 'quickdraft' },
  { kw: ['conflict engine', 'cross document', 'conflict check'], route: '/conflict-engine', tab: null },
  { kw: ['war room', 'courtroom simulation', 'virtual court'], route: '/war-room', tab: null },
  { kw: ['dashboard', 'home', 'overview'], route: '/dashboard', tab: null },
  { kw: ['firm library', 'templates', 'precedents'], route: '/firm-library', tab: null },
  { kw: ['legal forms', 'forms repository'], route: '/legal-forms', tab: null },
];

const NAV_TRIGGERS = ['go to', 'open', 'navigate to', 'take me to', 'show me', 'switch to', 'open the'];

const resolveNavIntent = (q) => {
  const lower = q.toLowerCase();
  for (const item of NAV_MAP) {
    if (item.kw.some(k => lower.includes(k))) return { route: item.route, tab: item.tab };
  }
  return null;
};

const isNavCommand = (q) => NAV_TRIGGERS.some(t => q.toLowerCase().startsWith(t));

// ═══════════════════════════════════════════════════════
//  HUMAN-READABLE ROUTE LABELS (Replacing raw URLs in TopNav)
// ═══════════════════════════════════════════════════════
const ROUTE_LABELS = {
  '/dashboard': 'Legal Workspace / Advocate Terminal',
  '/contract-analyzer': 'Legal Workspace / Contract Analyzer',
  '/auto-draft': 'Legal Workspace / Auto-Draft Studio',
  '/court-resources': 'Legal Workspace / Court Resources',
  '/conflict-engine': 'Legal Workspace / Conflict Engine',
  '/calendar': 'Legal Workspace / Legal Calendar',
  '/vault': 'Legal Workspace / Case Vault',
  '/war-room': 'Legal Workspace / Litigation War Room',
  '/firm-library': 'Legal Workspace / Firm Library',
  '/legal-forms': 'Legal Workspace / Legal Forms Repository',
  '/analyzer': 'Legal Workspace / Contract Risk Scan',
};

const getHumanRouteLabel = (pathname) => {
  if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname];
  if (pathname.startsWith('/case/')) return 'Legal Workspace / Case Matter';
  return 'Legal Workspace / LexAmplify AI Associate';
};

// ═══════════════════════════════════════════════════════
//  SLASH COMMANDS  (/ prefix autocomplete)
// ═══════════════════════════════════════════════════════
const SLASH_CMDS = [
  { cmd: '/nda', label: 'Mutual NDA Agreement', fill: 'Draft a mutual Non-Disclosure Agreement compliant with the Indian Contract Act, 1872' },
  { cmd: '/notice', label: 'Legal Notice', fill: 'Draft a legal notice for breach of contract with a 15-day cure period' },
  { cmd: '/bail', label: 'Bail Application', fill: 'Draft a regular bail application under Section 439 CrPC / Section 483 BNSS' },
  { cmd: '/petition', label: 'Writ Petition (Art. 226)', fill: 'Draft a writ petition under Article 226 of the Constitution of India' },
  { cmd: '/affidavit', label: 'Supporting Affidavit', fill: 'Draft a supporting affidavit with verification block' },
  { cmd: '/summarize', label: 'Summarize Document', fill: 'Summarize the legal draft and extract key obligations and dates' },
  { cmd: '/arbitration', label: 'Add Arbitration Clause', fill: 'Add a multi-tiered dispute resolution and arbitration clause' },
  { cmd: '/risk', label: 'Risk Analysis', fill: 'Analyze all high-risk, uncapped indemnity, and termination clauses' },
];

// ═══════════════════════════════════════════════════════
//  CATEGORIZED LEGAL TOOLS (Replaces raw quick commands)
// ═══════════════════════════════════════════════════════
const LEGAL_TOOL_CATEGORIES = [
  { id: 'all', label: 'All Tools' },
  { id: 'draft', label: 'Draft' },
  { id: 'research', label: 'Research' },
  { id: 'analyze', label: 'Analyze' },
];

const LEGAL_TOOLS = [
  // Draft Category
  { id: 't-nda', title: 'Draft Mutual NDA', category: 'draft', desc: 'Standard non-disclosure agreement with 3-year survival clause', prompt: 'Draft a comprehensive mutual Non-Disclosure Agreement compliant with the Indian Contract Act, 1872, including confidentiality covenants, permitted disclosures, non-circumvention, and injunctive relief.', icon: 'lock' },
  { id: 't-notice', title: 'Draft Legal Notice', category: 'draft', desc: 'Pre-litigation demand notice for contract breach', prompt: 'Draft a formal legal notice for breach of contract demanding remediation and payment within 15 days with statutory interest, citing the Indian Contract Act, 1872.', icon: 'notice' },
  { id: 't-contract', title: 'Draft Commercial Contract', category: 'draft', desc: 'Master services agreement with warranties & SLA', prompt: 'Draft a commercial Master Services Agreement outlining scope of work, fee schedules, intellectual property assignment, limitation of liability, and dispute resolution via arbitration.', icon: 'draft' },
  { id: 't-bail', title: 'Draft Bail Application', category: 'draft', desc: 'Regular bail under Section 439 CrPC / 483 BNSS', prompt: 'Draft a regular bail application under Section 439 CrPC / Section 483 BNSS highlighting cooperation with investigation, clean antecedents, and parity with co-accused.', icon: 'gavel' },
  
  // Research Category
  { id: 't-sc', title: 'Find Judgments', category: 'research', desc: 'Search binding Supreme Court precedents & ratio', prompt: 'Find landmark Supreme Court and High Court precedents regarding the principles of specific performance, damages, and interim injunctions.', icon: 'scales' },
  { id: 't-sec', title: 'Research Sections', category: 'research', desc: 'Analyze IPC / BNS / CRPC statutory provisions', prompt: 'Research relevant statutory provisions, ingredients, and judicial interpretations under Section 420 IPC / Section 318 BNS for criminal breach of trust.', icon: 'search' },
  { id: 't-cite', title: 'Find Citation', category: 'research', desc: 'Retrieve neutral citation and bench composition', prompt: 'Retrieve the neutral citation, quorum, bench composition, and key ratio decidendi for leading judgments on Section 9 and Section 34 of the Arbitration and Conciliation Act, 1996.', icon: 'bookmark' },
  
  // Analyze Category
  { id: 't-risk', title: 'Analyze Contract', category: 'analyze', desc: 'Audit indemnities, liabilities & termination terms', prompt: 'Analyze this contract for high-risk clauses, uncapped indemnities, one-sided termination terms, and compliance gaps under Indian contract law.', icon: 'shield' },
  { id: 't-clauses', title: 'Identify High-Risk Clauses', category: 'analyze', desc: 'Audit dispute resolution and jurisdiction clauses', prompt: 'Perform an audit of the governing law, dispute resolution, limitation of liability, and jurisdiction clauses in this draft, highlighting any enforceability issues in Indian courts.', icon: 'alert' },
];

// ═══════════════════════════════════════════════════════
//  INTELLIGENT CONVERSATION AUTO-TITLING
// ═══════════════════════════════════════════════════════
const generateConversationTitle = (text) => {
  if (!text) return 'Legal Matter';
  const clean = text.replace(/^📎[^\n]+\n+/, '').replace(/^\[Attached document:[^\]]+\]\n+/i, '').trim();
  
  if (/mutual\s+nda|non[\s-]disclosure|nda\s+agreement/i.test(clean)) return 'Mutual NDA Agreement';
  if (/legal\s+notice|notice\s+for\s+breach|breach\s+of\s+contract/i.test(clean)) return 'Legal Notice — Breach';
  if (/bail\s+application|regular\s+bail|anticipatory\s+bail/i.test(clean)) return 'Bail Application Draft';
  if (/writ\s+petition|article\s+226|article\s+32/i.test(clean)) return 'Writ Petition Draft';
  if (/master\s+service|commercial\s+agreement|service\s+agreement/i.test(clean)) return 'Commercial MSA Draft';
  if (/supreme\s+court|judgment|precedent|citation/i.test(clean)) return 'Supreme Court Research';
  if (/risk\s+analysis|analyze\s+contract|clause\s+review/i.test(clean)) return 'Contract Risk Analysis';
  if (/section\s+\d+|ipc|bns|crpc|cpc/i.test(clean)) {
    const m = clean.match(/(?:section\s+\d+\s+(?:ipc|bns|crpc|cpc)|(?:ipc|bns|crpc|cpc)\s+section\s+\d+)/i);
    return m ? `${m[0].toUpperCase()} Research` : 'Statutory Provisions Research';
  }

  // General clean sentence to title
  const words = clean.replace(/[^\w\s-]/g, '').split(/\s+/).slice(0, 5).join(' ');
  if (!words) return 'Legal Consultation';
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════
const truncate = (str, n) => (str && str.length > n) ? str.slice(0, n) + '…' : (str || '');

const escHtml = (s) =>
  s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

const applyInline = (s) =>
  escHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="md-code">$1</code>');

const renderMarkdown = (text) => {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (/^### /.test(ln)) { out.push(`<h3 class="md-h3">${applyInline(ln.slice(4))}</h3>`); i++; }
    else if (/^## /.test(ln)) { out.push(`<h2 class="md-h2">${applyInline(ln.slice(3))}</h2>`); i++; }
    else if (/^# /.test(ln)) { out.push(`<h1 class="md-h1">${applyInline(ln.slice(2))}</h1>`); i++; }
    else if (/^---+$/.test(ln.trim())) { out.push('<hr class="md-hr">'); i++; }
    else if (/^[*\-] /.test(ln)) {
      const items = [];
      while (i < lines.length && /^[*\-] /.test(lines[i])) {
        items.push(`<li>${applyInline(lines[i].replace(/^[*\-] /, ''))}</li>`);
        i++;
      }
      out.push(`<ul class="md-ul">${items.join('')}</ul>`);
    }
    else if (/^\d+\. /.test(ln)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(`<li>${applyInline(lines[i].replace(/^\d+\. /, ''))}</li>`);
        i++;
      }
      out.push(`<ol class="md-ol">${items.join('')}</ol>`);
    }
    else if (ln.trim() === '') { out.push('<div class="md-gap"></div>'); i++; }
    else { out.push(`<p class="md-p">${applyInline(ln)}</p>`); i++; }
  }
  return out.join('');
};

// Formats draft text with structured legal document hierarchy
const renderDraftHtml = (text) => {
  if (!text) return '';
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    // Section headers: e.g. 01 PARTIES or 1. PARTIES or ## 1. PARTIES
    .replace(/^(?:#{1,3}\s*)?(\d{1,2}\.?\s+[A-Z\s]{3,40})$/gm, '<div class="draft-section-head"><span class="draft-sec-num">§</span> $1</div>')
    // Sub-headings
    .replace(/^#{2,3}\s+(.+)$/gm, '<div class="draft-h2">$1</div>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Horizontal rule
    .replace(/^---+$/gm, '<hr class="draft-hr">')
    // Double newline → paragraph break
    .replace(/\n\n/g, '</p><p class="draft-p">')
    // Single newline → break
    .replace(/\n/g, '<br>')
    // Wrap
    .replace(/^/, '<p class="draft-p">')
    .replace(/$/, '</p>');
};

// Detects and wraps placeholder tokens like [Insert Name], [Effective Date]
const highlightPlaceholders = (html) =>
  html.replace(/\[([A-Za-z0-9\s'\/\-,\.&]{2,50})\]/g,
    '<span class="lex-placeholder" title="Click to fill field">[$1]</span>'
  );

// Extracts distinct placeholders from text
const extractPlaceholders = (text) => {
  if (!text) return [];
  const matches = text.match(/\[([A-Za-z0-9\s'\/\-,\.&]{2,50})\]/g) || [];
  const unique = Array.from(new Set(matches.map(m => m.slice(1, -1).trim())));
  return unique.filter(u => !u.toLowerCase().startsWith('http') && !u.toLowerCase().includes('done') && u.length > 2);
};

// Extracts numbered sections from text for the document outline
const extractSections = (text) => {
  if (!text) return [];
  const lines = text.split('\n');
  const sections = [];
  lines.forEach((l, idx) => {
    const trimmed = l.trim();
    // Match "1. PARTIES", "01. RECITALS", "## 1. DEFINITIONS", "SECTION 1: TITLE"
    const m = trimmed.match(/^(?:#{1,3}\s*)?(\d{1,2})[\.\s:]+([A-Za-z\s]{3,40})$/i)
      || trimmed.match(/^(?:SECTION|CLAUSE)\s+(\d{1,2})[\.\s:]+([A-Za-z\s]{3,40})$/i);
    if (m) {
      sections.push({
        num: String(m[1]).padStart(2, '0'),
        title: m[2].trim(),
        line: idx,
      });
    }
  });
  return sections;
};

const relativeDate = (ts) => {
  const d = Date.now() - ts;
  if (d < 60000) return 'Just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  if (d < 172800000) return 'Yesterday';
  if (d < 604800000) return `${Math.floor(d / 86400000)}d ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

// ═══════════════════════════════════════════════════════
//  SVG ICON REPOSITORY (Clean & consistent visual system)
// ═══════════════════════════════════════════════════════
const Icon = ({ name, size = 16, className = '', style = {} }) => {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '2',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    style: { flexShrink: 0, ...style },
  };

  switch (name) {
    case 'sparkles':
      return (
        <svg {...props}>
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...props}>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );
    case 'notice':
    case 'draft':
      return (
        <svg {...props}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <line x1="10" y1="9" x2="8" y2="9" />
        </svg>
      );
    case 'gavel':
      return (
        <svg {...props}>
          <path d="m14.5 12.5-8 8a2.12 2.12 0 0 1-3-3l8-8" />
          <path d="m16 16 6-6" />
          <path d="m8 8 6-6" />
          <path d="m9 7 8 8" />
        </svg>
      );
    case 'scales':
      return (
        <svg {...props}>
          <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z" />
          <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z" />
          <path d="M7 21h10M12 3v18M3 7h2c2 0 4-1 7-1s5 1 7 1h2" />
        </svg>
      );
    case 'search':
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      );
    case 'bookmark':
      return (
        <svg {...props}>
          <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...props}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
    case 'send':
      return (
        <svg {...props}>
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      );
    case 'stop':
      return (
        <svg {...props} fill="currentColor" stroke="none">
          <rect x="5" y="5" width="14" height="14" rx="2" />
        </svg>
      );
    case 'mic':
      return (
        <svg {...props}>
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
        </svg>
      );
    case 'attach':
      return (
        <svg {...props}>
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      );
    case 'copy':
      return (
        <svg {...props}>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case 'download':
      return (
        <svg {...props}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      );
    case 'print':
      return (
        <svg {...props}>
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
      );
    case 'edit':
      return (
        <svg {...props}>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      );
    case 'check':
      return (
        <svg {...props}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case 'close':
      return (
        <svg {...props}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...props}>
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      );
    case 'outline':
      return (
        <svg {...props}>
          <line x1="21" y1="6" x2="3" y2="6" />
          <line x1="15" y1="12" x2="3" y2="12" />
          <line x1="17" y1="18" x2="3" y2="18" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
  }
};

// ═══════════════════════════════════════════════════════
//  SCOPED CSS ARCHITECTURE (Dual-theme & High-contrast)
// ═══════════════════════════════════════════════════════
const AGENT_CSS = `
  /* Keyframes */
  @keyframes lex-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes lex-fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes lex-pulse-ring {
    0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
    70% { transform: scale(1.05); box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
    100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
  }
  @keyframes lex-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  @keyframes lex-pulse-dot { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.1); } }

  /* Drawer Overlay */
  .LexAmplify-drawer {
    position: fixed; inset: 0; z-index: 9999;
    display: flex; overflow: hidden;
    background: var(--bg-app, #0A0E17);
    color: var(--text-primary, #F3F4F6);
    animation: lex-fade-in 0.2s ease both;
  }
  .LexAmplify-drawer.closing { animation: lex-fade-in 0.18s ease reverse both; }

  /* Light theme color palette as specified in PDF */
  :root[data-theme="light"], [data-theme="light"] {
    --lex-bg-main: #F7F8FC;
    --lex-bg-sidebar: #EEF1F7;
    --lex-bg-card: #FFFFFF;
    --lex-border: #E2E6EF;
    --lex-border-active: #2563EB;
    --lex-text-primary: #172033;
    --lex-text-secondary: #667085;
    --lex-text-muted: #8E98A8;
    --lex-accent-blue: #2563EB;
    --lex-accent-blue-subtle: #EFF6FF;
    --lex-accent-indigo: #6366F1;
  }

  /* Dark theme color palette */
  :root[data-theme="dark"], [data-theme="dark"] {
    --lex-bg-main: #0A0E17;
    --lex-bg-sidebar: #0C101A;
    --lex-bg-card: #111827;
    --lex-border: rgba(255, 255, 255, 0.08);
    --lex-border-active: #3B82F6;
    --lex-text-primary: #F3F4F6;
    --lex-text-secondary: #94A3B8;
    --lex-text-muted: #64748B;
    --lex-accent-blue: #3B82F6;
    --lex-accent-blue-subtle: rgba(59, 130, 246, 0.12);
    --lex-accent-indigo: #818CF8;
  }

  /* ══════════════════════════════════════════════
       SIDEBAR CONVERSATION MANAGER
  ══════════════════════════════════════════════ */
  .lex-sidebar {
    background: var(--lex-bg-sidebar, #EEF1F7) !important;
    border-right: 1px solid var(--lex-border, #E2E6EF) !important;
    display: flex; flex-direction: column; overflow: hidden;
  }

  .lex-sidebar-search-wrap {
    padding: 10px 14px 6px;
    position: relative;
  }
  .lex-sidebar-search-input {
    width: 100%;
    background: var(--lex-bg-card, #FFFFFF);
    border: 1px solid var(--lex-border, #E2E6EF);
    border-radius: 8px;
    padding: 7px 28px 7px 30px;
    font-size: 12px;
    color: var(--lex-text-primary, #172033);
    outline: none;
    transition: all 0.15s ease;
    box-sizing: border-box;
    font-family: inherit;
  }
  .lex-sidebar-search-input:focus {
    border-color: var(--lex-accent-blue, #2563EB);
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
  }
  .lex-sidebar-search-icon {
    position: absolute; left: 22px; top: 18px;
    color: var(--lex-text-muted, #8E98A8); pointer-events: none;
  }
  .lex-sidebar-search-clear {
    position: absolute; right: 22px; top: 17px;
    background: none; border: none; color: var(--lex-text-muted, #8E98A8);
    cursor: pointer; padding: 2px; font-size: 11px;
  }

  /* Conversation Cards */
  .lex-sess-item {
    background: var(--lex-bg-card, #FFFFFF) !important;
    border: 1px solid var(--lex-border, #E2E6EF) !important;
    border-radius: 8px !important;
    margin: 4px 10px !important;
    padding: 9px 12px !important;
    cursor: pointer !important;
    transition: all 0.15s ease !important;
    position: relative !important;
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03) !important;
  }
  .lex-sess-item:hover {
    border-color: var(--lex-accent-blue, #2563EB) !important;
    transform: translateY(-1px) !important;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.06) !important;
  }
  .lex-sess-item.active {
    background: var(--lex-accent-blue-subtle, #EFF6FF) !important;
    border-color: var(--lex-accent-blue, #2563EB) !important;
    border-left: 3.5px solid var(--lex-accent-blue, #2563EB) !important;
    box-shadow: 0 3px 10px rgba(37, 99, 235, 0.12) !important;
  }

  .lex-sess-title {
    font-size: 12.5px !important;
    font-weight: 600 !important;
    color: var(--lex-text-primary, #172033) !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    line-height: 1.3 !important;
  }
  .lex-sess-meta {
    font-size: 10.5px !important;
    color: var(--lex-text-secondary, #667085) !important;
    margin-top: 2px !important;
    display: flex !important;
    align-items: center !important;
    gap: 5px !important;
  }

  /* ══════════════════════════════════════════════
       COMPOSER & COMMAND CENTER (P0)
  ══════════════════════════════════════════════ */
  .lex-composer-container {
    background: var(--lex-bg-card, #FFFFFF);
    border: 1px solid var(--lex-border, #E2E6EF);
    border-radius: 14px;
    padding: 10px 14px 10px 14px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
    display: flex; flex-direction: column; gap: 8px;
  }
  .lex-composer-container:focus-within {
    border-color: var(--lex-accent-blue, #2563EB);
    box-shadow: 0 4px 24px rgba(37, 99, 235, 0.12), 0 0 0 1px var(--lex-accent-blue, #2563EB);
  }

  .lex-textarea {
    width: 100%;
    min-height: 54px;
    max-height: 160px;
    background: transparent;
    border: none;
    outline: none;
    resize: none;
    font-family: inherit;
    font-size: 14.5px;
    line-height: 1.55;
    color: var(--lex-text-primary, #172033);
    box-sizing: border-box;
    padding: 0;
  }
  .lex-textarea::placeholder {
    color: var(--lex-text-muted, #8E98A8);
  }

  .lex-composer-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 4px;
    border-top: 1px solid var(--lex-border, #E2E6EF);
  }

  .lex-composer-tools {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .lex-tool-btn {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 12px;
    color: var(--lex-text-secondary, #667085);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    transition: all 0.15s ease;
    font-family: inherit;
    font-weight: 500;
  }
  .lex-tool-btn:hover:not(:disabled) {
    background: var(--lex-accent-blue-subtle, #EFF6FF);
    color: var(--lex-accent-blue, #2563EB);
    border-color: var(--lex-border, #E2E6EF);
  }
  .lex-tool-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* 3-State Send Button */
  .lex-send-btn {
    background: var(--lex-accent-blue, #2563EB) !important;
    color: #FFFFFF !important;
    border: none !important;
    border-radius: 8px !important;
    padding: 7px 16px !important;
    font-size: 13px !important;
    font-weight: 600 !important;
    cursor: pointer !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 6px !important;
    transition: all 0.15s ease !important;
    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25) !important;
    font-family: inherit !important;
  }
  .lex-send-btn:hover:not(:disabled) {
    background: #1D4ED8 !important;
    transform: translateY(-1px) !important;
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35) !important;
  }
  .lex-send-btn:disabled {
    background: var(--lex-border, #E2E6EF) !important;
    color: var(--lex-text-muted, #8E98A8) !important;
    cursor: not-allowed !important;
    box-shadow: none !important;
    transform: none !important;
  }

  .lex-stop-btn {
    background: #DC2626 !important;
    color: #FFFFFF !important;
    border: none !important;
    border-radius: 8px !important;
    padding: 7px 14px !important;
    font-size: 12.5px !important;
    font-weight: 600 !important;
    cursor: pointer !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 6px !important;
    box-shadow: 0 2px 8px rgba(220, 38, 38, 0.25) !important;
    animation: lex-in 0.2s ease;
  }
  .lex-stop-btn:hover {
    background: #B91C1C !important;
  }

  /* ══════════════════════════════════════════════
       TRANSPARENT AI GENERATION WORKFLOW
  ══════════════════════════════════════════════ */
  .lex-generation-card {
    background: var(--lex-bg-card, #FFFFFF);
    border: 1px solid var(--lex-border, #E2E6EF);
    border-radius: 12px;
    padding: 16px 18px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
    margin: 6px 0;
    animation: lex-in 0.2s ease;
  }
  .lex-gen-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .lex-gen-spinner {
    width: 20px; height: 20px;
    border-radius: 50%;
    border: 2px solid var(--lex-accent-blue-subtle, #EFF6FF);
    border-top-color: var(--lex-accent-blue, #2563EB);
    animation: lex-spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  .lex-gen-steps {
    display: flex; flex-direction: column; gap: 7px;
    padding-left: 6px;
    border-left: 2px solid var(--lex-border, #E2E6EF);
    margin-left: 8px;
  }
  .lex-gen-step {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; color: var(--lex-text-secondary, #667085);
  }
  .lex-gen-step.done { color: #16A34A; font-weight: 500; }
  .lex-gen-step.active { color: var(--lex-accent-blue, #2563EB); font-weight: 600; }
  .lex-step-pulse { animation: lex-pulse-dot 1.2s infinite ease-in-out; }

  /* ══════════════════════════════════════════════
       LEGAL DOCUMENT WORKSPACE & A4 CONTAINER
  ══════════════════════════════════════════════ */
  .lex-doc-container {
    max-width: 820px;
    margin: 0 auto;
    background: var(--lex-bg-card, #FFFFFF);
    border: 1px solid var(--lex-border, #E2E6EF);
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.07);
    overflow: hidden;
    display: flex; flex-direction: column;
  }
  
  .lex-doc-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 18px;
    background: var(--lex-bg-sidebar, #EEF1F7);
    border-bottom: 1px solid var(--lex-border, #E2E6EF);
    flex-wrap: wrap;
    gap: 8px;
  }
  
  .lex-doc-paper {
    padding: 40px 50px;
    font-family: Georgia, 'Times New Roman', Cambria, serif;
    font-size: 14.5px;
    line-height: 1.85;
    color: var(--lex-text-primary, #172033);
    outline: none;
  }

  .lex-doc-paper .draft-section-head {
    font-family: inherit;
    font-size: 14.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--lex-text-primary, #172033);
    margin: 22px 0 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--lex-border, #E2E6EF);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .lex-sec-num {
    color: var(--lex-accent-blue, #2563EB);
    font-size: 14px;
  }

  /* Interactive Placeholders */
  .lex-placeholder {
    background: rgba(245, 158, 11, 0.15) !important;
    border: 1px solid rgba(245, 158, 11, 0.4) !important;
    color: #B45309 !important;
    border-radius: 4px !important;
    padding: 1px 5px !important;
    font-weight: 600 !important;
    cursor: pointer !important;
    transition: all 0.15s ease !important;
  }
  [data-theme="dark"] .lex-placeholder {
    background: rgba(245, 158, 11, 0.2) !important;
    border-color: rgba(245, 158, 11, 0.45) !important;
    color: #FCD34D !important;
  }
  .lex-placeholder:hover {
    background: rgba(245, 158, 11, 0.3) !important;
    transform: scale(1.02);
  }

  /* AI Clause Action Hover Bar */
  .lex-clause-hover-bar {
    display: flex;
    gap: 6px;
    margin: 6px 0 14px;
    padding: 4px 8px;
    background: var(--lex-bg-sidebar, #EEF1F7);
    border: 1px solid var(--lex-border, #E2E6EF);
    border-radius: 6px;
  }
  .lex-clause-btn {
    background: transparent;
    border: none;
    font-size: 11px;
    font-weight: 500;
    color: var(--lex-accent-blue, #2563EB);
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .lex-clause-btn:hover {
    background: var(--lex-accent-blue-subtle, #EFF6FF);
  }

  /* Quick Actions Grid */
  .lex-tools-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .lex-tool-card {
    background: var(--lex-bg-card, #FFFFFF);
    border: 1px solid var(--lex-border, #E2E6EF);
    border-radius: 10px;
    padding: 11px 14px;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
    width: 100%;
  }
  .lex-tool-card:hover {
    border-color: var(--lex-accent-blue, #2563EB);
    background: var(--lex-accent-blue-subtle, #EFF6FF);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  }

  /* Mobile responsiveness */
  @media (max-width: 768px) {
    .lex-tools-grid { grid-template-columns: 1fr !important; }
    .lex-doc-paper { padding: 24px 18px !important; }
    .lex-sidebar {
      position: fixed; top: 0; left: 0; height: 100%; z-index: 30;
      width: 280px; max-width: 85vw;
      transform: translateX(-100%);
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 6px 0 30px rgba(0, 0, 0, 0.4);
    }
    .lex-sidebar.mobile-open { transform: translateX(0); }
  }
`;

// ═══════════════════════════════════════════════════════
//  SMART NAMING HELPER
// ═══════════════════════════════════════════════════════
const DOC_TYPE_ABBREV = {
  'nda': 'NDA', 'non-disclosure': 'NDA',
  'bail': 'Bail', 'bail application': 'Bail',
  'writ petition': 'Writ', 'writ': 'Writ',
  'special leave petition': 'SLP', 'slp': 'SLP',
  'legal notice': 'Notice', 'notice': 'Notice',
  'affidavit': 'Affidavit', 'agreement': 'Contract',
  'employment agreement': 'EA', 'petition': 'Petition',
};

const generateSmartName = (doc_type, sessionTitle) => {
  const rawType = (doc_type || '').toLowerCase().trim();
  let abbrev = DOC_TYPE_ABBREV[rawType] || (doc_type ? doc_type.split(' ')[0].slice(0, 8) : 'Doc');
  let slug = '';
  const cleanTitle = (sessionTitle || '').replace(/^new conversation$/i, '').trim();
  if (cleanTitle) {
    slug = cleanTitle
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .split(' ')
      .filter(w => w.length > 2)
      .slice(0, 2)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
  }
  const now = new Date();
  const day = now.getDate();
  const mon = now.toLocaleString('en-IN', { month: 'short' });
  const hhmm = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return [abbrev, slug, `${day}${mon}_${hhmm}`].filter(Boolean).join('_');
};

// ═══════════════════════════════════════════════════════
//  SAVE TO VAULT MODAL (Preserved Integration)
// ═══════════════════════════════════════════════════════
function SaveToVaultModal({ draft, sessionTitle, apiBase, onConfirm, onClose }) {
  const [flatFolders, setFlatFolders] = useState([]);
  const [flatDocs, setFlatDocs] = useState([]);
  const [navStack, setNavStack] = useState([{ id: null, name: 'Root (Case Vault)' }]);
  const [fileName, setFileName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [selectedTags, setSelectedTags] = useState([]);
  const [saveFormat, setSaveFormat] = useState('native');
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const smartDefault = generateSmartName(draft?.doc_type, sessionTitle);
  useEffect(() => { setFileName(smartDefault); }, [smartDefault]);

  useEffect(() => {
    Promise.all([
      fetch(`${apiBase}/api/vault/folders`),
      fetch(`${apiBase}/api/vault/meta`),
    ])
      .then(([fRes, dRes]) => Promise.all([fRes.ok ? fRes.json() : null, dRes.ok ? dRes.json() : null]))
      .then(([fData, dData]) => {
        if (!isMountedRef.current) return;
        if (fData) setFlatFolders(fData.flat || []);
        if (dData) setFlatDocs(dData.documents || []);
      })
      .catch(() => {})
      .finally(() => { if (isMountedRef.current) setLoadingFolders(false); });
  }, [apiBase]);

  const currentView = navStack[navStack.length - 1];
  const isAtRoot = currentView.id == null;
  const currentChildren = flatFolders
    .filter(f => isAtRoot ? (f.parent_id == null || f.parent_id === 0) : Number(f.parent_id) === Number(currentView.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const destFolderId = isAtRoot ? null : currentView.id;
  const destPath = navStack.map(s => s.name).join(' / ');

  const handleConfirm = () => {
    if (!fileName.trim()) return;
    setSaving(true);
    onConfirm({
      fileName: fileName.trim(),
      folderId: destFolderId,
      folderPath: destPath,
      smartTitle: fileName.trim(),
      tags: selectedTags,
      format: saveFormat,
    });
  };

  return (
    <div className="svm-backdrop" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10020, background: 'rgba(3,6,14,0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'lex-in 0.18s ease' }}>
      <div className="svm-panel" style={{ background: 'var(--lex-bg-card, #FFFFFF)', border: '1px solid var(--lex-border, #E2E6EF)', borderRadius: 14, width: 640, maxWidth: '94vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--lex-border, #E2E6EF)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="draft" size={16} style={{ color: 'var(--lex-accent-blue, #2563EB)' }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--lex-text-primary, #172033)' }}>Save Draft to Case Vault</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--lex-text-muted, #8E98A8)' }}><Icon name="close" size={16} /></button>
        </div>
        <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--lex-text-secondary, #667085)', display: 'block', marginBottom: 6 }}>Document Title</label>
            <input value={fileName} onChange={e => setFileName(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--lex-border, #E2E6EF)', background: 'var(--lex-bg-main, #F7F8FC)', color: 'var(--lex-text-primary, #172033)', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--lex-text-secondary, #667085)', display: 'block', marginBottom: 6 }}>Destination Folder</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--lex-bg-main, #F7F8FC)', borderRadius: 8, border: '1px solid var(--lex-border, #E2E6EF)', fontSize: 12, color: 'var(--lex-accent-blue, #2563EB)', fontWeight: 600 }}>
              📁 {destPath}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6, marginTop: 8, maxHeight: 140, overflowY: 'auto' }}>
              {navStack.length > 1 && (
                <button onClick={() => setNavStack(prev => prev.slice(0, -1))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px dashed var(--lex-border, #E2E6EF)', background: 'transparent', color: 'var(--lex-text-secondary, #667085)', fontSize: 11, cursor: 'pointer', textAlign: 'left' }}>
                  ↖ Back
                </button>
              )}
              {currentChildren.map(f => (
                <button key={f.id} onClick={() => setNavStack(prev => [...prev, { id: f.id, name: f.name }])} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--lex-border, #E2E6EF)', background: 'var(--lex-bg-card, #FFFFFF)', color: 'var(--lex-text-primary, #172033)', fontSize: 11.5, cursor: 'pointer', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  📁 {f.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--lex-border, #E2E6EF)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--lex-bg-sidebar, #EEF1F7)' }}>
          <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--lex-border, #E2E6EF)', background: 'transparent', color: 'var(--lex-text-secondary, #667085)', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          <button onClick={handleConfirm} disabled={saving || !fileName.trim()} style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: 'var(--lex-accent-blue, #2563EB)', color: '#FFFFFF', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>{saving ? 'Saving…' : 'Confirm & Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  SHARE MODAL
// ═══════════════════════════════════════════════════════
function ShareModal({ sessionTitle, onClose }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = `${window.location.origin}/vault?ref=${encodeURIComponent(sessionTitle.slice(0, 40))}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="svm-backdrop" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10020, background: 'rgba(3,6,14,0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'lex-in 0.18s ease' }}>
      <div className="svm-panel" style={{ background: 'var(--lex-bg-card, #FFFFFF)', border: '1px solid var(--lex-border, #E2E6EF)', borderRadius: 14, width: 440, maxWidth: '94vw', padding: '20px 24px', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="sparkles" size={16} style={{ color: 'var(--lex-accent-blue, #2563EB)' }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--lex-text-primary, #172033)' }}>Share Legal Conversation</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--lex-text-muted, #8E98A8)' }}><Icon name="close" size={16} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--lex-text-secondary, #667085)', lineHeight: 1.5, margin: '0 0 14px' }}>
          Share this legal research and drafting thread with colleagues or counsel.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input readOnly value={shareUrl} style={{ flex: 1, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--lex-border, #E2E6EF)', background: 'var(--lex-bg-main, #F7F8FC)', color: 'var(--lex-text-primary, #172033)', fontSize: 11.5, outline: 'none' }} />
          <button onClick={handleCopy} style={{ padding: '7px 14px', borderRadius: 7, background: 'var(--lex-accent-blue, #2563EB)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{copied ? '✓ Copied' : 'Copy'}</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--lex-border, #E2E6EF)', background: 'transparent', color: 'var(--lex-text-secondary, #667085)', cursor: 'pointer', fontSize: 12 }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  CONVERSATION 3-DOTS MENU
// ═══════════════════════════════════════════════════════
function ConversationMenu({ session, onPin, onRename, onShare, onDelete, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={menuRef} style={{ position: 'absolute', right: 8, top: '100%', zIndex: 100, background: 'var(--lex-bg-card, #FFFFFF)', border: '1px solid var(--lex-border, #E2E6EF)', borderRadius: 8, padding: 4, minWidth: 140, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <button onClick={onPin} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'none', border: 'none', borderRadius: 6, color: 'var(--lex-text-primary, #172033)', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>
        <Icon name="bookmark" size={13} style={{ color: session.pinned ? '#F59E0B' : 'inherit' }} />
        {session.pinned ? 'Unpin Matter' : 'Pin Matter'}
      </button>
      <button onClick={onRename} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'none', border: 'none', borderRadius: 6, color: 'var(--lex-text-primary, #172033)', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>
        <Icon name="edit" size={13} />
        Rename
      </button>
      <button onClick={onShare} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'none', border: 'none', borderRadius: 6, color: 'var(--lex-text-primary, #172033)', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>
        <Icon name="sparkles" size={13} />
        Share
      </button>
      <button onClick={onDelete} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'none', border: 'none', borderRadius: 6, color: '#DC2626', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>
        <Icon name="close" size={13} />
        Delete
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  MAIN AI LEGAL ASSOCIATE COMPONENT
// ═══════════════════════════════════════════════════════
function CommandPalette() {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

  const location = useLocation();
  const paramsFromHook = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  // ── Sessions state ──────────────────────────────────
  const [sessions, setSessions] = useState(() => loadSessions());
  const [currentId, setCurrentId] = useState(() => {
    const saved = localStorage.getItem(CURRENT_KEY);
    const all = loadSessions();
    return (saved && all.find(s => s.id === saved)) ? saved : (all[0]?.id || null);
  });

  // ── UI state ─────────────────────────────────────────
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [navRoute, setNavRoute] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [micError, setMicError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [isClosing, setIsClosing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewingSnapshot, setViewingSnapshot] = useState(null);
  const [slashMenu, setSlashMenu] = useState(false);
  const [copyToast, setCopyToast] = useState(false);
  const [isDrawerExpanded, setIsDrawerExpanded] = useState(false);
  
  // ── Upgrades State (P0, P1, P2) ───────────────────────
  const [sessSearch, setSessSearch] = useState('');
  const [toolCategory, setToolCategory] = useState('all');
  const [showCompletionPanel, setShowCompletionPanel] = useState(false);
  const [missingFieldInputs, setMissingFieldInputs] = useState({});
  const [showToolsDropdown, setShowToolsDropdown] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);

  // ── File attachment ──────────────────────────────────
  const [attachedFile, setAttachedFile] = useState(null);
  const [fileLoading, setFileLoading] = useState(false);

  // ── Modals & Menus ───────────────────────────────────
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [shareSessionId, setShareSessionId] = useState(null);

  // ── Refs ─────────────────────────────────────────────
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);
  const searchRef = useRef(null);
  const messagesEndRef = useRef(null);
  const msgRefs = useRef({});
  const drawerBodyRef = useRef(null);
  const lastDocKeyRef = useRef(null);
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // ── Derived Data ─────────────────────────────────────
  const currentSession = sessions.find(s => s.id === currentId) || null;
  const messages = currentSession?.messages || [];
  const pendingSchedule = currentSession?.pendingSchedule || null;
  const pendingDraft = currentSession?.pendingDraft || null;
  const activeDocument = currentSession?.activeDocument || null;

  // Extract missing placeholders and sections from active document
  const activeDocText = viewingSnapshot ? viewingSnapshot.content : (activeDocument?.content || '');
  const missingPlaceholders = useMemo(() => extractPlaceholders(activeDocText), [activeDocText]);
  const docSections = useMemo(() => extractSections(activeDocText), [activeDocText]);

  // Filtered sessions based on search
  const filteredSessions = useMemo(() => {
    if (!sessSearch.trim()) return sessions;
    const q = sessSearch.toLowerCase();
    return sessions.filter(s =>
      (s.title || '').toLowerCase().includes(q) ||
      (s.messages || []).some(m => m.text && m.text.toLowerCase().includes(q))
    );
  }, [sessions, sessSearch]);

  // Session Organizers
  const pinnedSess = filteredSessions.filter(s => s.pinned);
  const unpinnedSess = filteredSessions.filter(s => !s.pinned);
  const todaySess = unpinnedSess.filter(s => Date.now() - s.updatedAt < 86400000);
  const yesterdaySess = unpinnedSess.filter(s => Date.now() - s.updatedAt >= 86400000 && Date.now() - s.updatedAt < 172800000);
  const olderSess = unpinnedSess.filter(s => Date.now() - s.updatedAt >= 172800000);

  // Filtered legal tools
  const filteredTools = useMemo(() => {
    if (toolCategory === 'all') return LEGAL_TOOLS;
    return LEGAL_TOOLS.filter(t => t.category === toolCategory);
  }, [toolCategory]);

  // ── Session Helpers ──────────────────────────────────
  const mutateSessions = useCallback((updater) => {
    setSessions(prev => {
      const next = updater(prev);
      persistSessions(next);
      return next;
    });
  }, []);

  const updateSession = useCallback((id, patchFn) => {
    mutateSessions(prev =>
      prev.map(s => s.id === id ? { ...patchFn(s), updatedAt: Date.now() } : s)
    );
  }, [mutateSessions]);

  const pushMessage = useCallback((sid, msg) => {
    updateSession(sid, s => {
      const isFirstUserMsg = (s.title === 'New conversation' && msg.role === 'user');
      const smartTitle = isFirstUserMsg ? generateConversationTitle(msg.text) : s.title;
      return {
        ...s,
        title: smartTitle,
        messages: [...s.messages, { ...msg, _ts: Date.now() }],
      };
    });
  }, [updateSession]);

  const patchMessage = useCallback((sid, msgId, patchFn) => {
    updateSession(sid, s => ({
      ...s,
      messages: s.messages.map(m => m.id === msgId ? patchFn(m) : m),
    }));
  }, [updateSession]);

  const startNew = useCallback(() => {
    const s = makeSession();
    mutateSessions(prev => [s, ...prev]);
    setCurrentId(s.id);
    localStorage.setItem(CURRENT_KEY, s.id);
    setQuery('');
    setNavRoute(null);
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, [mutateSessions]);

  const selectSession = useCallback((id) => {
    setCurrentId(id);
    localStorage.setItem(CURRENT_KEY, id);
    setQuery('');
    setNavRoute(null);
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, []);

  const deleteSession = useCallback((id) => {
    mutateSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (id === currentId) {
        if (next.length > 0) {
          setCurrentId(next[0].id);
          localStorage.setItem(CURRENT_KEY, next[0].id);
        } else {
          const fresh = makeSession();
          next.unshift(fresh);
          setCurrentId(fresh.id);
          localStorage.setItem(CURRENT_KEY, fresh.id);
        }
      }
      return next;
    });
  }, [currentId, mutateSessions]);

  const pinSession = useCallback((id) => {
    mutateSessions(prev =>
      prev.map(s => s.id === id ? { ...s, pinned: !s.pinned } : s)
    );
  }, [mutateSessions]);

  const renameSession = useCallback((id, newTitle) => {
    if (!newTitle.trim()) return;
    mutateSessions(prev =>
      prev.map(s => s.id === id ? { ...s, title: newTitle.trim() } : s)
    );
  }, [mutateSessions]);

  // Bootstrap session
  useEffect(() => {
    if (sessions.length === 0 || !sessions.find(s => s.id === currentId)) {
      startNew();
    }
  }, []);

  // Global toggle listener (Cmd+K / events)
  useEffect(() => {
    const onToggle = () => setIsOpen(v => !v);
    const onKey = (e) => {
      if (e.key === 'Escape' && isOpen) setIsOpen(false);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('toggle-rag-palette', onToggle);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('toggle-rag-palette', onToggle);
    };
  }, [isOpen]);

  // Sync drawer innerHTML safely without wiping active edits
  useEffect(() => {
    const doc = viewingSnapshot || activeDocument;
    if (!drawerBodyRef.current) return;
    const key = doc ? `${doc.title}::${(doc.content || '').length}` : '__empty__';
    if (key === lastDocKeyRef.current) return;
    lastDocKeyRef.current = key;
    drawerBodyRef.current.innerHTML = doc
      ? highlightPlaceholders(renderDraftHtml(doc.content))
      : '';
  }, [viewingSnapshot, activeDocument]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 80);
  }, [isOpen]);

  useEffect(() => {
    searchRef.current = handleSearch;
    isListeningRef.current = isListening;
  });

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, loading]);

  // ── Speech Recognition Integration ───────────────────
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-IN';

    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
      setQuery(transcript);
    };
    rec.onerror = (e) => setMicError(e.error);
    rec.onend = () => setIsListening(false);
    recognitionRef.current = rec;
  }, []);

  const toggleMic = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setMicError(null);
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  // ── Stop Generation Handler ──────────────────────────
  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
  };

  // ── File Attachment ──────────────────────────────────
  const handleFileAttach = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileLoading(true);
    try {
      const text = await file.text();
      setAttachedFile({ name: file.name, content: text });
    } catch (_) {
      setAttachedFile({ name: file.name, content: `[Attached file: ${file.name}]` });
    } finally {
      setFileLoading(false);
    }
  };

  // ── Batch Placeholder Replacement ────────────────────
  const handleBatchFillPlaceholders = () => {
    if (!activeDocument?.content) return;
    let updated = activeDocument.content;
    Object.entries(missingFieldInputs).forEach(([key, val]) => {
      if (val && val.trim()) {
        const regex = new RegExp(`\\[${key}\\]`, 'g');
        updated = updated.replace(regex, val.trim());
      }
    });
    updateSession(currentId, s => ({
      ...s,
      pendingDraft: { ...s.pendingDraft, content: updated },
      activeDocument: { ...s.activeDocument, content: updated },
    }));
    setShowCompletionPanel(false);
    setMissingFieldInputs({});
  };

  // ── Core Search & Generation Stream ──────────────────
  async function handleSearch(e, directQuery = null) {
    if (e) e.preventDefault();
    const q = (directQuery !== null ? directQuery : query).trim();
    if (!q || loading || navRoute) return;

    let sid = currentId;
    if (!sid || !sessions.find(s => s.id === sid)) {
      const fresh = makeSession();
      mutateSessions(prev => [fresh, ...prev]);
      sid = fresh.id;
      setCurrentId(sid);
    }

    const displayText = attachedFile ? `📎 ${attachedFile.name}\n\n${q}` : q;
    const fullQuery = attachedFile
      ? `[Attached document: ${attachedFile.name}]\n\n${attachedFile.content}\n\n---\n\nUser query: ${q}`
      : q;

    pushMessage(sid, { id: `u_${Date.now()}`, role: 'user', text: displayText });
    setQuery('');
    setAttachedFile(null);
    setLoading(true);

    // Client-side Navigation Fast-Path
    if (isNavCommand(q) && !attachedFile) {
      const intent = resolveNavIntent(q);
      if (intent) {
        const label = intent.route.replace(/^\//, '').replace(/-/g, ' ');
        pushMessage(sid, {
          id: `a_${Date.now()}`, role: 'assistant',
          text: `Navigating to **${label}**${intent.tab ? ` — opening **${intent.tab}** section` : ''}…`,
        });
        setLoading(false);
        setNavRoute(intent.route);
        setTimeout(() => {
          navigate(intent.route, intent.tab ? { state: { openTab: intent.tab } } : undefined);
          setNavRoute(null);
          setIsOpen(false);
        }, 800);
        return;
      }
    }

    // Backend SSE Stream
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const res = await fetch(`${API_BASE}/api/ai/rag-chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: fullQuery,
          currentPath: location.pathname,
          params: {},
          ...(activeDocument && {
            current_draft_context: activeDocument.content,
            current_draft_title: activeDocument.title,
            current_draft_type: activeDocument.doc_type,
            current_draft_case_id: activeDocument.case_id,
          }),
        }),
      });

      if (!res.ok) {
        pushMessage(sid, { id: `e_${Date.now()}`, role: 'error', text: 'Server communication error. Please try again.' });
        setLoading(false);
        return;
      }

      // Check for JSON actions
      const contentType = res.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        const actionPayload = await res.json();
        if (actionPayload.is_action && actionPayload.intent === 'ROUTE') {
          navigate(actionPayload.destination);
          setLoading(false);
          setIsOpen(false);
          return;
        }
      }

      // Read SSE stream
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', accText = '';
      const msgId = `a_${Date.now()}`;
      pushMessage(sid, { id: msgId, role: 'assistant', text: '', sources: [] });

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
          const raw = line.trim();
          if (!raw.startsWith('data:')) continue;
          const json = raw.replace(/^data:\s*/, '').trim();
          if (!json || json === '[DONE]') continue;

          try {
            const p = JSON.parse(json);
            if (p.action === 'update_document') {
              updateSession(sid, s => {
                const updated = { title: p.title || 'Updated Document', content: p.updated_content, doc_type: 'Draft Edit' };
                return { ...s, pendingDraft: updated, activeDocument: updated };
              });
              setDrawerOpen(true);
            } else if (p.action === 'review_document' && p.draft) {
              const smart = generateSmartName(p.draft.doc_type, currentSession?.title);
              const enriched = { ...p.draft, smartTitle: smart };
              updateSession(sid, s => ({ ...s, pendingDraft: enriched, activeDocument: enriched }));
              setDrawerOpen(true);
            } else if (p.token) {
              accText += p.token;
              patchMessage(sid, msgId, m => ({ ...m, text: accText }));
            }
          } catch (_) {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        pushMessage(sid, { id: `e_${Date.now()}`, role: 'error', text: 'Connection interrupted. Please try again.' });
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  }

  // ── Document Actions ─────────────────────────────────
  const handleCopyDraft = () => {
    const text = viewingSnapshot ? viewingSnapshot.content : (activeDocument?.content || '');
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopyToast(true);
      setTimeout(() => setCopyToast(false), 2000);
    });
  };

  const handleDownloadDraft = () => {
    const doc = viewingSnapshot || activeDocument;
    if (!doc?.content) return;
    const blob = new Blob([doc.content], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(doc.title || 'legal_draft').replace(/\s+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintDraft = () => {
    window.print();
  };

  // Close handler with animation
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, 180);
  };

  if (!isOpen) return null;

  return (
    <>
      <style>{AGENT_CSS}</style>

      {/* Main Full-Screen Overlay */}
      <div className={`LexAmplify-drawer ${isClosing ? 'closing' : ''}`} onClick={handleClose}>
        <div style={{ display: 'flex', width: '100%', height: '100%' }} onClick={e => e.stopPropagation()}>

          {/* ══════════════════════════════════════════════
               LEFT: CONVERSATION MANAGER SIDEBAR
          ══════════════════════════════════════════════ */}
          <aside
            className={`lex-sidebar ${sidebarOpen ? 'mobile-open' : ''}`}
            style={{
              flex: sidebarOpen ? '0 0 270px' : '0 0 0px',
              minWidth: 0,
              transition: 'flex-basis 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            {/* Header with New Conversation Button */}
            <div style={{ padding: '16px 14px 10px', borderBottom: '1px solid var(--lex-border, #E2E6EF)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg, #2563EB, #6366F1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#fff' }}>
                  <Icon name="sparkles" size={16} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--lex-text-primary, #172033)' }}>AI Legal Associate</div>
                  <div style={{ fontSize: 10.5, color: 'var(--lex-text-secondary, #667085)' }}>LexAmplify · Junior Counsel</div>
                </div>
              </div>

              <button
                onClick={startNew}
                style={{
                  width: '100%', padding: '8px 12px',
                  background: 'var(--lex-accent-blue-subtle, #EFF6FF)',
                  border: '1px solid var(--lex-border, #E2E6EF)',
                  borderRadius: 8, color: 'var(--lex-accent-blue, #2563EB)',
                  fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all 0.15s ease',
                }}
              >
                <span>+</span> New Conversation
              </button>
            </div>

            {/* Conversation Search Bar */}
            <div className="lex-sidebar-search-wrap">
              <span className="lex-sidebar-search-icon"><Icon name="search" size={13} /></span>
              <input
                className="lex-sidebar-search-input"
                placeholder="Search conversations…"
                value={sessSearch}
                onChange={e => setSessSearch(e.target.value)}
              />
              {sessSearch && (
                <button className="lex-sidebar-search-clear" onClick={() => setSessSearch('')}>×</button>
              )}
            </div>

            {/* Conversation List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
              {filteredSessions.length === 0 ? (
                <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--lex-text-muted, #8E98A8)', fontSize: 12 }}>
                  No matching matters found.
                </div>
              ) : (
                <>
                  {pinnedSess.length > 0 && (
                    <>
                      <div style={{ padding: '8px 14px 2px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--lex-text-secondary, #667085)', letterSpacing: '0.05em' }}>Pinned Matters</div>
                      {pinnedSess.map(s => renderSessionRow(s))}
                    </>
                  )}
                  {todaySess.length > 0 && (
                    <>
                      <div style={{ padding: '8px 14px 2px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--lex-text-secondary, #667085)', letterSpacing: '0.05em' }}>Today</div>
                      {todaySess.map(s => renderSessionRow(s))}
                    </>
                  )}
                  {yesterdaySess.length > 0 && (
                    <>
                      <div style={{ padding: '8px 14px 2px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--lex-text-secondary, #667085)', letterSpacing: '0.05em' }}>Yesterday</div>
                      {yesterdaySess.map(s => renderSessionRow(s))}
                    </>
                  )}
                  {olderSess.length > 0 && (
                    <>
                      <div style={{ padding: '8px 14px 2px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--lex-text-secondary, #667085)', letterSpacing: '0.05em' }}>Earlier</div>
                      {olderSess.map(s => renderSessionRow(s))}
                    </>
                  )}
                </>
              )}
            </div>

            {/* Shortcut Hint Footer */}
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--lex-border, #E2E6EF)', display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--lex-text-muted, #8E98A8)' }}>
              <span><kbd style={{ background: 'var(--lex-bg-card, #FFF)', border: '1px solid var(--lex-border, #E2E6EF)', padding: '1px 5px', borderRadius: 4 }}>Ctrl+K</kbd> Toggle</span>
              <span><kbd style={{ background: 'var(--lex-bg-card, #FFF)', border: '1px solid var(--lex-border, #E2E6EF)', padding: '1px 5px', borderRadius: 4 }}>Esc</kbd> Close</span>
            </div>
          </aside>

          {/* ══════════════════════════════════════════════
               CENTER: AI CONVERSATION & WORKSPACE CANVAS
          ══════════════════════════════════════════════ */}
          <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--lex-bg-main, #F7F8FC)', overflow: 'hidden' }}>

            {/* Professional Top Navigation Bar */}
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', borderBottom: '1px solid var(--lex-border, #E2E6EF)', background: 'var(--lex-bg-card, #FFFFFF)', flexShrink: 0, gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <button onClick={() => setSidebarOpen(v => !v)} style={{ background: 'none', border: 'none', color: 'var(--lex-text-secondary, #667085)', cursor: 'pointer', padding: '4px 6px', borderRadius: 6 }} title="Toggle Sidebar">
                  <Icon name="outline" size={16} />
                </button>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--lex-text-primary, #172033)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {getHumanRouteLabel(location.pathname)}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {activeDocument && (
                  <button
                    onClick={() => setDrawerOpen(v => !v)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
                      background: drawerOpen ? 'var(--lex-accent-blue-subtle, #EFF6FF)' : 'transparent',
                      border: '1px solid var(--lex-accent-blue, #2563EB)', borderRadius: 6,
                      color: 'var(--lex-accent-blue, #2563EB)', fontSize: 12, fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    <Icon name="draft" size={13} />
                    {drawerOpen ? 'Hide Draft' : 'View Draft'}
                  </button>
                )}
                <button onClick={handleClose} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: 'transparent', border: '1px solid var(--lex-border, #E2E6EF)', borderRadius: 6, color: 'var(--lex-text-secondary, #667085)', fontSize: 12, cursor: 'pointer' }}>
                  <Icon name="close" size={13} />
                  Exit Workspace
                </button>
              </div>
            </header>

            {/* Scrollable Conversation Stream */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* ── Empty / Landing State ── */}
              {messages.length === 0 && (
                <div style={{ maxWidth: 740, width: '100%', margin: 'auto' }}>
                  <div style={{ textAlign: 'center', marginBottom: 20 }}>
                    <div style={{ width: 52, height: 52, margin: '0 auto 12px', borderRadius: 14, background: 'linear-gradient(135deg, rgba(37,99,235,0.15), rgba(99,102,241,0.15))', border: '1px solid var(--lex-border, #E2E6EF)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--lex-accent-blue, #2563EB)' }}>
                      <Icon name="scales" size={24} />
                    </div>
                    <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--lex-text-primary, #172033)', margin: '0 0 6px' }}>AI Legal Associate</h2>
                    <p style={{ fontSize: 13, color: 'var(--lex-text-secondary, #667085)', maxWidth: 440, margin: '0 auto', lineHeight: 1.5 }}>
                      Your AI counsel for legal drafting, research, clause risk analysis, and workflow automation.
                    </p>
                  </div>

                  {/* Category Filter Tabs */}
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
                    {LEGAL_TOOL_CATEGORIES.map(c => (
                      <button
                        key={c.id}
                        onClick={() => setToolCategory(c.id)}
                        style={{
                          padding: '4px 12px', borderRadius: 20,
                          background: toolCategory === c.id ? 'var(--lex-accent-blue, #2563EB)' : 'var(--lex-bg-card, #FFFFFF)',
                          color: toolCategory === c.id ? '#FFFFFF' : 'var(--lex-text-secondary, #667085)',
                          border: '1px solid var(--lex-border, #E2E6EF)',
                          fontSize: 11.5, fontWeight: 600, cursor: 'pointer'
                        }}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>

                  {/* Categorized Tools Grid */}
                  <div className="lex-tools-grid">
                    {filteredTools.slice(0, 6).map(t => (
                      <button
                        key={t.id}
                        className="lex-tool-card"
                        onClick={() => {
                          setQuery(t.prompt);
                          setTimeout(() => searchRef.current?.(null, t.prompt), 30);
                        }}
                      >
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--lex-accent-blue-subtle, #EFF6FF)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--lex-accent-blue, #2563EB)', flexShrink: 0 }}>
                          <Icon name={t.icon} size={16} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--lex-text-primary, #172033)' }}>{t.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--lex-text-secondary, #667085)', marginTop: 2, lineHeight: 1.35 }}>{t.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Message Bubbles ── */}
              {messages.map((msg, idx) => {
                if (msg.role === 'user') {
                  return (
                    <div key={idx} className="lex-msg-in" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div style={{ maxWidth: '75%', background: 'var(--lex-accent-blue, #2563EB)', color: '#FFFFFF', borderRadius: '14px 14px 2px 14px', padding: '12px 18px', fontSize: 14, lineHeight: 1.6, wordBreak: 'break-word', boxShadow: '0 2px 8px rgba(37,99,235,0.2)' }}>
                        {msg.text}
                      </div>
                    </div>
                  );
                }

                if (msg.role === 'error') {
                  return (
                    <div key={idx} className="lex-msg-in" style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderLeft: '4px solid #DC2626', borderRadius: '4px 10px 10px 4px', padding: '12px 16px', color: '#DC2626', fontSize: 13 }}>
                      <strong>Error:</strong> {msg.text}
                    </div>
                  );
                }

                // AI Associate Output
                return (
                  <div key={idx} className="lex-msg-in" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg, #2563EB, #6366F1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0, marginTop: 2 }}>
                      <Icon name="sparkles" size={15} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, background: 'var(--lex-bg-card, #FFFFFF)', border: '1px solid var(--lex-border, #E2E6EF)', borderRadius: '2px 14px 14px 14px', padding: '16px 20px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
                      <div className="lex-md" style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--lex-text-primary, #172033)' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
                    </div>
                  </div>
                );
              })}

              {/* ── Transparent AI Progress Indicator (P0) ── */}
              {loading && (
                <div className="lex-generation-card">
                  <div className="lex-gen-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="lex-gen-spinner" />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--lex-text-primary, #172033)' }}>LexAmplify AI Associate is working…</div>
                        <div style={{ fontSize: 11, color: 'var(--lex-text-secondary, #667085)' }}>Analyzing statutory provisions & drafting provisions</div>
                      </div>
                    </div>
                    <button type="button" className="lex-stop-btn" onClick={handleStopGeneration}>
                      <Icon name="stop" size={12} /> Stop
                    </button>
                  </div>
                  <div className="lex-gen-steps">
                    <div className="lex-gen-step done"><span><Icon name="check" size={12} /></span> Understanding legal context & statutory scope</div>
                    <div className="lex-gen-step active"><span className="lex-step-pulse">●</span> Analyzing provisions & Indian legal precedents</div>
                    <div className="lex-gen-step"><span>○</span> Structuring enforceable agreement clauses</div>
                    <div className="lex-gen-step"><span>○</span> Finalizing reviewable legal draft</div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* ══════════════════════════════════════════════
                 COMMAND CENTER / COMPOSER (P0)
            ══════════════════════════════════════════════ */}
            <div style={{ padding: '12px 20px 16px', background: 'var(--lex-bg-card, #FFFFFF)', borderTop: '1px solid var(--lex-border, #E2E6EF)' }}>
              
              {/* Attached file preview badge */}
              {attachedFile && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--lex-accent-blue-subtle, #EFF6FF)', border: '1px solid var(--lex-border, #E2E6EF)', borderRadius: 20, fontSize: 11.5, color: 'var(--lex-accent-blue, #2563EB)', marginBottom: 8 }}>
                  <Icon name="draft" size={13} />
                  <span>{attachedFile.name}</span>
                  <button onClick={() => setAttachedFile(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 2px' }}>×</button>
                </div>
              )}

              <input ref={fileInputRef} type="file" style={{ display: 'none' }} accept=".pdf,.docx,.doc,.txt,.md" onChange={handleFileAttach} />

              <div className="lex-composer-container">
                <textarea
                  ref={inputRef}
                  className="lex-textarea"
                  rows={2}
                  value={query}
                  onChange={e => {
                    setQuery(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSearch(null);
                    }
                  }}
                  placeholder="Ask LexAmplify anything... (Shift+Enter for new line)"
                />

                <div className="lex-composer-bottom">
                  <div className="lex-composer-tools">
                    <button type="button" className="lex-tool-btn" onClick={() => fileInputRef.current?.click()} title="Attach Document (PDF, DOCX, TXT)">
                      <Icon name="attach" size={14} /> Attach
                    </button>
                    <button type="button" className="lex-tool-btn" onClick={toggleMic} style={{ color: isListening ? '#DC2626' : undefined }} title="Voice Command">
                      <Icon name="mic" size={14} /> {isListening ? 'Listening…' : 'Voice'}
                    </button>
                  </div>

                  <div>
                    {loading ? (
                      <button type="button" className="lex-stop-btn" onClick={handleStopGeneration}>
                        <Icon name="stop" size={12} /> Stop
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="lex-send-btn"
                        disabled={!query.trim() && !attachedFile}
                        onClick={() => handleSearch(null)}
                      >
                        <span>Send</span>
                        <Icon name="send" size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Disclaimer */}
              <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--lex-text-muted, #8E98A8)', textAlign: 'center' }}>
                ⓘ LexAmplify provides AI-assisted legal drafting. Always verify critical information independently.
              </div>
            </div>
          </main>

          {/* ══════════════════════════════════════════════
               RIGHT: LEGAL DOCUMENT WORKSPACE DRAWER (P1/P2)
          ══════════════════════════════════════════════ */}
          <aside
            style={{
              flex: drawerOpen && activeDocument ? `0 0 ${isDrawerExpanded ? '60vw' : '480px'}` : '0 0 0px',
              minWidth: 0,
              transition: 'flex-basis 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
              background: 'var(--lex-bg-card, #FFFFFF)',
              borderLeft: '1px solid var(--lex-border, #E2E6EF)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {activeDocument && (
              <>
                {/* Document Drawer Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--lex-border, #E2E6EF)', background: 'var(--lex-bg-sidebar, #EEF1F7)', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Icon name="draft" size={15} style={{ color: 'var(--lex-accent-blue, #2563EB)' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--lex-text-primary, #172033)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {activeDocument.title || 'Legal Document Draft'}
                    </span>
                  </div>

                  {/* Toolbar Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button className="lex-tool-btn" onClick={handleCopyDraft} title="Copy Draft">
                      <Icon name="copy" size={13} /> {copyToast ? 'Copied!' : 'Copy'}
                    </button>
                    <button className="lex-tool-btn" onClick={handleDownloadDraft} title="Download .MD">
                      <Icon name="download" size={13} /> Export
                    </button>
                    <button className="lex-tool-btn" onClick={handlePrintDraft} title="Print / PDF">
                      <Icon name="print" size={13} />
                    </button>
                    <button className="lex-tool-btn" onClick={() => setIsDrawerExpanded(v => !v)} title="Toggle Theater Mode">
                      <Icon name="sparkles" size={13} />
                    </button>
                    <button className="lex-tool-btn" onClick={() => setDrawerOpen(false)} title="Close Draft">
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                </div>

                {/* Document Status & AI Review Badge */}
                <div style={{ padding: '8px 16px', background: 'var(--lex-bg-main, #F7F8FC)', borderBottom: '1px solid var(--lex-border, #E2E6EF)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ color: 'var(--lex-text-secondary, #667085)' }}>
                    AI Generated · Draft · {missingPlaceholders.length} details required
                  </span>
                  {missingPlaceholders.length > 0 && (
                    <button
                      onClick={() => setShowCompletionPanel(v => !v)}
                      style={{ background: 'none', border: 'none', color: '#B45309', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}
                    >
                      {showCompletionPanel ? 'Hide Form' : '⚡ Complete Draft Fields'}
                    </button>
                  )}
                </div>

                {/* Batch Placeholders Completion Panel */}
                {showCompletionPanel && missingPlaceholders.length > 0 && (
                  <div style={{ padding: '12px 16px', background: 'rgba(245,158,11,0.06)', borderBottom: '1px solid rgba(245,158,11,0.2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#B45309' }}>
                      Required Draft Details ({missingPlaceholders.length})
                    </div>
                    {missingPlaceholders.map((field, fi) => (
                      <div key={fi} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11.5, color: 'var(--lex-text-primary, #172033)', width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{field}:</span>
                        <input
                          placeholder={`Enter ${field}`}
                          value={missingFieldInputs[field] || ''}
                          onChange={e => setMissingFieldInputs(prev => ({ ...prev, [field]: e.target.value }))}
                          style={{ flex: 1, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--lex-border, #E2E6EF)', fontSize: 11.5, outline: 'none' }}
                        />
                      </div>
                    ))}
                    <button
                      onClick={handleBatchFillPlaceholders}
                      style={{ marginTop: 4, padding: '6px 12px', background: '#B45309', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Fill All in Draft
                    </button>
                  </div>
                )}

                {/* A4 Paper Document Content Editor */}
                <div
                  ref={drawerBodyRef}
                  className="lex-doc-paper"
                  contentEditable
                  suppressContentEditableWarning
                  style={{ flex: 1, overflowY: 'auto' }}
                  onBlur={e => {
                    const plain = e.currentTarget.innerText || '';
                    lastDocKeyRef.current = `${activeDocument?.title}::${plain.length}`;
                    updateSession(currentId, s => ({
                      ...s,
                      pendingDraft: s.pendingDraft ? { ...s.pendingDraft, content: plain } : null,
                      activeDocument: s.activeDocument ? { ...s.activeDocument, content: plain } : null,
                    }));
                  }}
                />

                {/* Document Drawer Footer with Save Action */}
                <div style={{ padding: '12px 18px', borderTop: '1px solid var(--lex-border, #E2E6EF)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--lex-bg-sidebar, #EEF1F7)' }}>
                  <button
                    onClick={() => {
                      updateSession(currentId, s => ({ ...s, pendingDraft: null, activeDocument: null }));
                      setDrawerOpen(false);
                    }}
                    style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--lex-border, #E2E6EF)', background: 'transparent', color: 'var(--lex-text-secondary, #667085)', cursor: 'pointer', fontSize: 12 }}
                  >
                    Discard
                  </button>
                  <button
                    onClick={() => setShowSaveModal(true)}
                    style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: 'var(--lex-accent-blue, #2563EB)', color: '#FFFFFF', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}
                  >
                    Save to Case Vault
                  </button>
                </div>
              </>
            )}
          </aside>

        </div>
      </div>

      {/* Save to Vault Modal */}
      {showSaveModal && (
        <SaveToVaultModal
          draft={activeDocument}
          sessionTitle={currentSession?.title || ''}
          apiBase={API_BASE}
          onConfirm={({ fileName, folderId, folderPath, tags, format }) => {
            updateSession(currentId, s => ({ ...s, pendingDraft: null, activeDocument: null }));
            setShowSaveModal(false);
            setDrawerOpen(false);
            pushMessage(currentId, {
              id: `sys_${Date.now()}`,
              role: 'assistant',
              text: `✅ Document **${fileName}** saved to Case Vault (${folderPath || 'Root'}).`,
            });
          }}
          onClose={() => setShowSaveModal(false)}
        />
      )}

      {/* Share Modal */}
      {shareSessionId && (
        <ShareModal
          sessionTitle={sessions.find(s => s.id === shareSessionId)?.title || ''}
          onClose={() => setShareSessionId(null)}
        />
      )}
    </>
  );

  // Helper renderer for each session card in the sidebar
  function renderSessionRow(s) {
    const isActive = s.id === currentId;
    const isMenuOpen = openMenuId === s.id;
    return (
      <div
        key={s.id}
        className={`lex-sess-item ${isActive ? 'active' : ''}`}
        onClick={() => selectSession(s.id)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {renamingId === s.id ? (
            <input
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onBlur={() => { renameSession(s.id, renameValue); setRenamingId(null); }}
              onKeyDown={e => {
                if (e.key === 'Enter') { renameSession(s.id, renameValue); setRenamingId(null); }
                if (e.key === 'Escape') setRenamingId(null);
              }}
              style={{ width: '100%', fontSize: 12, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--lex-accent-blue, #2563EB)', outline: 'none' }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <>
              <div className="lex-sess-title">{s.title || 'New conversation'}</div>
              <div className="lex-sess-meta">
                <span>{relativeDate(s.updatedAt)}</span>
                {s.messages?.length > 0 && <span>· {s.messages.length} turns</span>}
              </div>
            </>
          )}
        </div>

        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setOpenMenuId(isMenuOpen ? null : s.id)}
            style={{ background: 'none', border: 'none', color: 'var(--lex-text-muted, #8E98A8)', cursor: 'pointer', padding: '2px 4px', borderRadius: 4 }}
          >
            ⋮
          </button>
          {isMenuOpen && (
            <ConversationMenu
              session={s}
              onPin={() => { pinSession(s.id); setOpenMenuId(null); }}
              onRename={() => { setRenamingId(s.id); setRenameValue(s.title); setOpenMenuId(null); }}
              onShare={() => { setShareSessionId(s.id); setOpenMenuId(null); }}
              onDelete={() => { deleteSession(s.id); setOpenMenuId(null); }}
              onClose={() => setOpenMenuId(null)}
            />
          )}
        </div>
      </div>
    );
  }
}

export default function LexCommandSuite() {
  return <CommandPalette />;
}
