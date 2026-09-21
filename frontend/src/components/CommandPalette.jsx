import React, { useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ThemeContext } from '../context/ThemeContext';

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
  activeDocument: null,
  savedAssets: [],
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
//  HUMAN-READABLE ROUTE LABELS
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
  return 'Legal Workspace / AI Legal Associate';
};

// ═══════════════════════════════════════════════════════
//  SLASH COMMANDS  (/ prefix autocomplete)
// ═══════════════════════════════════════════════════════
const SLASH_CMDS = [
  { cmd: '/nda', label: 'Mutual NDA Agreement', fill: 'Draft a mutual Non-Disclosure Agreement compliant with the Indian Contract Act, 1872' },
  { cmd: '/notice', label: 'Legal Notice for Breach', fill: 'Draft a legal notice for breach of contract with a 15-day cure period under Section 73 Indian Contract Act' },
  { cmd: '/bail', label: 'Bail Application', fill: 'Draft a regular bail application under Section 439 CrPC / Section 483 BNSS' },
  { cmd: '/petition', label: 'Writ Petition (Art. 226)', fill: 'Draft a writ petition under Article 226 of the Constitution of India' },
  { cmd: '/affidavit', label: 'Supporting Affidavit', fill: 'Draft a supporting affidavit with verification block' },
  { cmd: '/summarize', label: 'Summarize Document', fill: 'Summarize the legal draft and extract key obligations and dates' },
  { cmd: '/arbitration', label: 'Add Arbitration Clause', fill: 'Add a multi-tiered dispute resolution and arbitration clause' },
  { cmd: '/risk', label: 'Risk Analysis', fill: 'Analyze all high-risk, uncapped indemnity, and termination clauses' },
];

// ═══════════════════════════════════════════════════════
//  PROMPT SUGGESTIONS (Try asking...)
// ═══════════════════════════════════════════════════════
const PROMPT_SUGGESTIONS = [
  { label: '✦ Draft Mutual NDA', prompt: 'Draft a mutual Non-Disclosure Agreement compliant with the Indian Contract Act, 1872, including confidentiality covenants, permitted disclosures, non-circumvention, and injunctive relief.' },
  { label: '✦ Analyze Contract Risks', prompt: 'Analyze this contract for high-risk clauses, uncapped indemnities, one-sided termination terms, and compliance gaps under Indian contract law.' },
  { label: '✦ Supreme Court Precedents', prompt: 'Find landmark Supreme Court and High Court precedents regarding the principles of specific performance, damages, and interim injunctions.' },
  { label: '✦ Section 420 IPC / 318 BNS', prompt: 'Research relevant statutory provisions, ingredients, and judicial interpretations under Section 420 IPC / Section 318 BNS for cheating and dishonestly inducing delivery of property.' },
];

// ═══════════════════════════════════════════════════════
//  ASSISTANT TOOLS
// ═══════════════════════════════════════════════════════
const ASSISTANT_TOOLS = [
  { id: 'citation', label: 'Find Citation', icon: 'bookmark', prompt: 'Retrieve the neutral citation, quorum, bench composition, and key ratio decidendi for leading judgments on Section 9 and Section 34 of the Arbitration and Conciliation Act, 1996.' },
  { id: 'causelist', label: 'Cause List', icon: 'gavel', prompt: 'Open today\'s cause list and courtroom roster for the Supreme Court of India.' },
  { id: 'statute', label: 'Statutory Research', icon: 'search', prompt: 'Research statutory provisions, ingredients, and recent judicial interpretations for criminal breach of trust under the Indian Penal Code and Bharatiya Nyaya Sanhita.' },
];

// ═══════════════════════════════════════════════════════
//  CATEGORIZED LEGAL TOOLS (9 WORKFLOW CARDS)
// ═══════════════════════════════════════════════════════
const LEGAL_TOOL_CATEGORIES = [
  { id: 'all', label: 'All workflows' },
  { id: 'draft', label: 'Drafting' },
  { id: 'research', label: 'Research' },
  { id: 'analyze', label: 'Analysis' },
];

const LEGAL_TOOLS = [
  { id: 't-nda', title: 'Mutual NDA', category: 'draft', desc: 'Standard non-disclosure with 3-year survival covenants', prompt: 'Draft a comprehensive mutual Non-Disclosure Agreement compliant with the Indian Contract Act, 1872, including confidentiality covenants, permitted disclosures, non-circumvention, and injunctive relief.', icon: 'lock' },
  { id: 't-notice', title: 'Legal Notice', category: 'draft', desc: 'Pre-litigation demand notice for contract breach', prompt: 'Draft a formal legal notice for breach of contract demanding remediation and payment within 15 days with statutory interest, citing the Indian Contract Act, 1872.', icon: 'notice' },
  { id: 't-contract', title: 'Commercial Contract', category: 'draft', desc: 'Master services agreement with warranties & SLA', prompt: 'Draft a commercial Master Services Agreement outlining scope of work, fee schedules, intellectual property assignment, limitation of liability, and dispute resolution via arbitration.', icon: 'draft' },
  { id: 't-bail', title: 'Bail Application', category: 'draft', desc: 'Regular bail under Section 439 CrPC / 483 BNSS', prompt: 'Draft a regular bail application under Section 439 CrPC / Section 483 BNSS highlighting cooperation with investigation, clean antecedents, and parity with co-accused.', icon: 'gavel' },
  { id: 't-sc', title: 'SC Judgments', category: 'research', desc: 'Search binding Supreme Court precedents & ratio', prompt: 'Find landmark Supreme Court and High Court precedents regarding the principles of specific performance, damages, and interim injunctions.', icon: 'scales' },
  { id: 't-sec', title: 'Statutes & Codes', category: 'research', desc: 'Analyze IPC / BNS / CrPC statutory provisions', prompt: 'Research relevant statutory provisions, ingredients, and judicial interpretations under Section 420 IPC / Section 318 BNS for criminal breach of trust.', icon: 'search' },
  { id: 't-cite', title: 'Neutral Citations', category: 'research', desc: 'Retrieve neutral citation and bench composition', prompt: 'Retrieve the neutral citation, quorum, bench composition, and key ratio decidendi for leading judgments on Section 9 and Section 34 of the Arbitration and Conciliation Act, 1996.', icon: 'bookmark' },
  { id: 't-risk', title: 'Contract Risk Scan', category: 'analyze', desc: 'Audit indemnities, liabilities & termination terms', prompt: 'Analyze this contract for high-risk clauses, uncapped indemnities, one-sided termination terms, and compliance gaps under Indian contract law.', icon: 'shield' },
  { id: 't-clauses', title: 'Jurisdiction Audit', category: 'analyze', desc: 'Audit dispute resolution and governing law clauses', prompt: 'Perform an audit of the governing law, dispute resolution, limitation of liability, and jurisdiction clauses in this draft, highlighting any enforceability issues in Indian courts.', icon: 'alert' },
];

// ═══════════════════════════════════════════════════════
//  INTELLIGENT CONVERSATION AUTO-TITLING (Anti-Duplicate)
// ═══════════════════════════════════════════════════════
const generateConversationTitle = (text, existingSessions = []) => {
  if (!text) return 'Legal Matter';
  const clean = text.replace(/^📎[^\n]+\n+/, '').replace(/^\[Attached document:[^\]]+\]\n+/i, '').trim();

  let baseTitle = 'Legal Consultation';
  if (/mutual\s+nda|non[\s-]disclosure|nda\s+agreement/i.test(clean)) baseTitle = 'Mutual NDA Agreement';
  else if (/legal\s+notice|notice\s+for\s+breach|breach\s+of\s+contract/i.test(clean)) baseTitle = 'Legal Notice — Breach';
  else if (/bail\s+application|regular\s+bail|anticipatory\s+bail/i.test(clean)) baseTitle = 'Bail Application Draft';
  else if (/writ\s+petition|article\s+226|article\s+32/i.test(clean)) baseTitle = 'Writ Petition Draft';
  else if (/master\s+service|commercial\s+agreement|service\s+agreement/i.test(clean)) baseTitle = 'Commercial MSA Draft';
  else if (/supreme\s+court|judgment|precedent|citation/i.test(clean)) baseTitle = 'Supreme Court Research';
  else if (/risk\s+analysis|analyze\s+contract|clause\s+review/i.test(clean)) baseTitle = 'Contract Risk Analysis';
  else if (/section\s+\d+|ipc|bns|crpc|cpc/i.test(clean)) {
    const m = clean.match(/(?:section\s+\d+\s+(?:ipc|bns|crpc|cpc)|(?:ipc|bns|crpc|cpc)\s+section\s+\d+)/i);
    baseTitle = m ? `${m[0].toUpperCase()} Research` : 'Statutory Provisions Research';
  } else {
    const words = clean.replace(/[^\w\s-]/g, '').split(/\s+/).slice(0, 5).join(' ');
    if (words) baseTitle = words.charAt(0).toUpperCase() + words.slice(1);
  }

  // Check for counterparty or matter context in text
  const partyMatch = clean.match(/(?:between|counterparty|party|for|with|re:?)\s+([A-Z][a-zA-Z0-9\s&.,]{2,25})/);
  let qualifiedTitle = baseTitle;
  if (partyMatch && partyMatch[1]) {
    const candidate = partyMatch[1].trim().replace(/\s+(?:and|or|the)$/i, '');
    if (candidate && !baseTitle.toLowerCase().includes(candidate.toLowerCase())) {
      qualifiedTitle = `${baseTitle} — ${candidate}`;
    }
  }

  // Anti-duplicate check against existing sessions
  const titles = Array.isArray(existingSessions) ? existingSessions.map(s => s.title) : [];
  if (!titles.includes(qualifiedTitle)) {
    return qualifiedTitle;
  }

  let counter = 2;
  while (titles.includes(`${qualifiedTitle} (draft ${counter})`)) {
    counter++;
  }
  return `${qualifiedTitle} (draft ${counter})`;
};

// ═══════════════════════════════════════════════════════
//  DETERMINISTIC STATUTORY GROUNDING EXTRACTION
// ═══════════════════════════════════════════════════════
const KNOWN_STATUTES = [
  { pattern: /indian\s+contract\s+act/i, name: 'Indian Contract Act, 1872' },
  { pattern: /information\s+technology\s+act/i, name: 'Information Technology Act, 2000' },
  { pattern: /arbitration\s+(?:and|\&)\s+conciliation\s+act/i, name: 'Arbitration & Conciliation Act, 1996' },
  { pattern: /specific\s+relief\s+act/i, name: 'Specific Relief Act, 1963' },
  { pattern: /(?:crpc|code\s+of\s+criminal\s+procedure|bnss|bharatiya\s+nagarik\s+suraksha)/i, name: 'Code of Criminal Procedure / BNSS, 2023' },
  { pattern: /(?:ipc|indian\s+penal\s+code|bns|bharatiya\s+nyaya)/i, name: 'Indian Penal Code / BNS, 2023' },
  { pattern: /companies\s+act/i, name: 'Companies Act, 2013' },
  { pattern: /constitution\s+of\s+india/i, name: 'Constitution of India' },
  { pattern: /limitation\s+act/i, name: 'Limitation Act, 1963' },
  { pattern: /negotiable\s+instruments\s+act/i, name: 'Negotiable Instruments Act, 1881' },
  { pattern: /consumer\s+protection\s+act/i, name: 'Consumer Protection Act, 2019' },
  { pattern: /transfer\s+of\s+property\s+act/i, name: 'Transfer of Property Act, 1882' },
  { pattern: /insolvency\s+and\s+bankruptcy|ibc/i, name: 'Insolvency & Bankruptcy Code, 2016' },
];

const extractGroundedStatutes = (docContent = '', citations = []) => {
  const results = [];
  const seen = new Set();

  if (Array.isArray(citations)) {
    for (const c of citations) {
      const label = typeof c === 'string' ? c : (c.statute || c.title || c.source || '');
      if (label && !seen.has(label)) {
        seen.add(label);
        results.push(label);
      }
    }
  }

  if (docContent) {
    for (const s of KNOWN_STATUTES) {
      if (s.pattern.test(docContent) && !seen.has(s.name)) {
        seen.add(s.name);
        results.push(s.name);
      }
    }
  }

  return results;
};

// ═══════════════════════════════════════════════════════
//  MARKDOWN & TABLE RENDERING ENGINE
// ═══════════════════════════════════════════════════════
const escHtml = (s) =>
  s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

const applyInline = (s) =>
  escHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="md-code">$1</code>');

const parseRowCells = (row) => {
  let clean = row.trim();
  if (clean.startsWith('|')) clean = clean.slice(1);
  if (clean.endsWith('|')) clean = clean.slice(0, -1);
  return clean.split('|').map(c => c.trim());
};

const isTableSeparator = (line) => {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  const cells = parseRowCells(trimmed);
  return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c.trim()));
};

const parseMarkdownTable = (lines, startIdx) => {
  const headerLine = lines[startIdx];
  const sepLine = lines[startIdx + 1];
  if (!headerLine || !sepLine) return null;
  if (!headerLine.includes('|') || !isTableSeparator(sepLine)) return null;

  const headers = parseRowCells(headerLine);
  const rows = [];
  let curr = startIdx + 2;
  while (curr < lines.length && lines[curr].trim().includes('|') && !/^---+$/.test(lines[curr].trim())) {
    rows.push(parseRowCells(lines[curr]));
    curr++;
  }

  const tableHtml = `
    <div class="lex-table-responsive">
      <table class="lex-legal-table draft-table">
        <thead>
          <tr>
            ${headers.map(h => `<th>${applyInline(h)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              ${r.map(cell => `<td>${applyInline(cell || '')}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  return { html: tableHtml, nextIdx: curr };
};

const renderMarkdown = (text) => {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    const trimmed = ln.trim();

    // Check for Table
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const tableRes = parseMarkdownTable(lines, i);
      if (tableRes) {
        out.push(tableRes.html);
        i = tableRes.nextIdx;
        continue;
      }
    }

    if (/^### /.test(ln)) { out.push(`<h3 class="md-h3">${applyInline(ln.slice(4))}</h3>`); i++; }
    else if (/^## /.test(ln)) { out.push(`<h2 class="md-h2">${applyInline(ln.slice(3))}</h2>`); i++; }
    else if (/^# /.test(ln)) { out.push(`<h1 class="md-h1">${applyInline(ln.slice(2))}</h1>`); i++; }
    else if (/^---+$/.test(trimmed)) { out.push('<hr class="md-hr">'); i++; }
    else if (/^[*\-] /.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[*\-] /.test(lines[i].trim())) {
        items.push(`<li>${applyInline(lines[i].trim().replace(/^[*\-] /, ''))}</li>`);
        i++;
      }
      out.push(`<ul class="md-ul">${items.join('')}</ul>`);
    }
    else if (/^\d+\. /.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i].trim())) {
        items.push(`<li>${applyInline(lines[i].trim().replace(/^\d+\. /, ''))}</li>`);
        i++;
      }
      out.push(`<ol class="md-ol">${items.join('')}</ol>`);
    }
    else if (trimmed === '') { out.push('<div class="md-gap"></div>'); i++; }
    else { out.push(`<p class="md-p">${applyInline(ln)}</p>`); i++; }
  }
  return out.join('');
};

const renderDraftHtml = (text) => {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  let isFirstHeader = true;

  while (i < lines.length) {
    const ln = lines[i];
    const trimmed = ln.trim();

    // Check for Table
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const tableRes = parseMarkdownTable(lines, i);
      if (tableRes) {
        out.push(tableRes.html);
        i = tableRes.nextIdx;
        continue;
      }
    }

    // Section headers: e.g. 01 PARTIES, ## 1. DEFINITIONS, SECTION 1: CONFIDENTIALITY
    const secMatch = trimmed.match(/^(?:#{1,3}\s*)?(\d{1,2}\.?\s+[A-Z\s]{3,40})$/i)
      || trimmed.match(/^(?:SECTION|CLAUSE)\s+(\d{1,2})[\.\s:]+([A-Za-z\s]{3,40})$/i);
    if (secMatch) {
      const p1 = trimmed.replace(/^#{1,3}\s*/, '');
      const slug = p1.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      out.push(`<div id="sec_${slug}" class="draft-section-head draft-h"><span class="draft-sec-num">§</span> ${applyInline(p1)}</div>`);
      i++;
      continue;
    }

    // Top document Title if starts with H1
    if (/^#\s+/.test(trimmed) && isFirstHeader) {
      isFirstHeader = false;
      out.push(`<h2 class="draft-doc-title serif">${applyInline(trimmed.replace(/^#\s+/, ''))}</h2>`);
      i++;
      continue;
    }

    // Sub-headings
    if (/^#{2,3}\s+/.test(trimmed)) {
      out.push(`<div class="draft-h">${applyInline(trimmed.replace(/^#{2,3}\s+/, ''))}</div>`);
      i++;
      continue;
    }

    // Horizontal Rule
    if (/^---+$/.test(trimmed)) {
      out.push('<hr class="draft-hr" />');
      i++;
      continue;
    }

    // Unordered List
    if (/^[*\-] /.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[*\-] /.test(lines[i].trim())) {
        items.push(`<li>${applyInline(lines[i].trim().replace(/^[*\-] /, ''))}</li>`);
        i++;
      }
      out.push(`<ul class="draft-ul">${items.join('')}</ul>`);
      continue;
    }

    // Ordered List
    if (/^\d+\. /.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i].trim())) {
        items.push(`<li>${applyInline(lines[i].trim().replace(/^\d+\. /, ''))}</li>`);
        i++;
      }
      out.push(`<ol class="draft-ol">${items.join('')}</ol>`);
      continue;
    }

    // Blank line
    if (trimmed === '') {
      out.push('<div class="draft-gap"></div>');
      i++;
      continue;
    }

    // Regular paragraph
    out.push(`<p class="draft-p">${applyInline(ln)}</p>`);
    i++;
  }

  return out.join('');
};

const highlightPlaceholders = (html) =>
  html.replace(/\[([A-Za-z0-9\s'\/\-,\.&]{2,50})\]/g,
    '<span class="lex-placeholder" title="Click to fill field">[$1]</span>'
  );

const extractPlaceholders = (text) => {
  if (!text) return [];
  const matches = text.match(/\[([A-Za-z0-9\s'\/\-,\.&]{2,50})\]/g) || [];
  const unique = Array.from(new Set(matches.map(m => m.slice(1, -1).trim())));
  return unique.filter(u => !u.toLowerCase().startsWith('http') && !u.toLowerCase().includes('done') && u.length > 2);
};

const extractSections = (text) => {
  if (!text) return [];
  const lines = text.split('\n');
  const sections = [];
  lines.forEach((l, idx) => {
    const trimmed = l.trim();
    const m = trimmed.match(/^(?:#{1,3}\s*)?(\d{1,2})[\.\s:]+([A-Za-z\s]{3,40})$/i)
      || trimmed.match(/^(?:SECTION|CLAUSE)\s+(\d{1,2})[\.\s:]+([A-Za-z\s]{3,40})$/i);
    if (m) {
      sections.push({
        num: String(m[1]).padStart(2, '0'),
        title: m[2].trim(),
        full: `${String(m[1]).padStart(2, '0')} ${m[2].trim()}`,
        slug: `${String(m[1]).padStart(2, '0')}_${m[2].trim()}`.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase(),
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
//  SVG ICON REPOSITORY (Slate & Rust ~1.7px Stroke)
// ═══════════════════════════════════════════════════════
const Icon = ({ name, size = 16, className = '', style = {} }) => {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.75',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    style: { flexShrink: 0, ...style },
  };

  switch (name) {
    case 'sparkles':
      return (
        <svg {...props}>
          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...props}>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      );
    case 'notice':
      return (
        <svg {...props}>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <path d="M14 3v6h6M9 13h6M9 17h6" />
        </svg>
      );
    case 'draft':
      return (
        <svg {...props}>
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
      );
    case 'gavel':
      return (
        <svg {...props}>
          <path d="M14 4 6 12l3 3 8-8-3-3z" />
          <path d="M9 15l-5 5M13 8l3 3M2 22h7" />
        </svg>
      );
    case 'scales':
      return (
        <svg {...props}>
          <path d="M12 3v18M5 7l-3 6a4 4 0 0 0 8 0l-3-6zM19 7l-3 6a4 4 0 0 0 8 0l-3-6zM5 7h14M9 3h6" />
        </svg>
      );
    case 'search':
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="7" />
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
          <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4l3 3" />
        </svg>
      );
    case 'caution':
      return (
        <svg {...props}>
          <path d="M12 9v4M12 17h.01" />
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        </svg>
      );
    case 'send':
      return (
        <svg {...props} strokeWidth="2">
          <path d="m22 2-11 11M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
      );
    case 'stop':
      return (
        <svg {...props} fill="currentColor" stroke="none">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      );
    case 'mic':
      return (
        <svg {...props}>
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0M12 19v3" />
        </svg>
      );
    case 'attach':
      return (
        <svg {...props}>
          <path d="M21.44 11.05 12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.19 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.48" />
        </svg>
      );
    case 'copy':
      return (
        <svg {...props}>
          <rect x="9" y="9" width="13" height="13" rx="2" />
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
    case 'check':
      return (
        <svg {...props} strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case 'close':
      return (
        <svg {...props} strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
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
    case 'folder':
      return (
        <svg {...props}>
          <path d="M21 8V5a2 2 0 0 0-2-2h-3.5L12 0 8.5 3H5a2 2 0 0 0-2 2v3" />
          <path d="M3 8v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8" />
          <path d="M8 14h8M8 17h5" />
        </svg>
      );
    case 'sun':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    case 'moon':
      return (
        <svg {...props}>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
};

// ═══════════════════════════════════════════════════════
//  SLATE & RUST DESIGN SYSTEM (Two-Accent Contract)
// ═══════════════════════════════════════════════════════
const AGENT_CSS = `
  @keyframes lex-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes lex-fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes lex-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  @keyframes lex-pulse-halo { 0% { transform: scale(0.7); opacity: 0.9; } 100% { transform: scale(1.6); opacity: 0; } }

  :root, [data-theme="dark"] {
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

    /* Backward compatibility mappings */
    --lex-bg-main: var(--bg);
    --lex-bg-sidebar: var(--paper);
    --lex-sidebar-text: var(--ink);
    --lex-sidebar-secondary: var(--ink-soft);
    --lex-sidebar-muted: var(--muted);
    --lex-sidebar-item-bg: transparent;
    --lex-sidebar-item-hover: var(--paper-2);
    --lex-sidebar-item-active: var(--accent-soft);
    --lex-sidebar-border: var(--rule);
    --lex-bg-card: var(--paper);
    --lex-border: var(--rule);
    --lex-border-active: var(--accent);
    --lex-text-primary: var(--ink);
    --lex-text-secondary: var(--ink-soft);
    --lex-text-muted: var(--muted);
    --lex-accent-blue: var(--accent);
    --lex-accent-blue-subtle: var(--accent-soft);
  }

  [data-theme="light"] {
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

    /* Backward compatibility mappings */
    --lex-bg-main: var(--bg);
    --lex-bg-sidebar: var(--paper);
    --lex-sidebar-text: var(--ink);
    --lex-sidebar-secondary: var(--ink-soft);
    --lex-sidebar-muted: var(--muted);
    --lex-sidebar-item-bg: transparent;
    --lex-sidebar-item-hover: var(--paper-2);
    --lex-sidebar-item-active: var(--accent-soft);
    --lex-sidebar-border: var(--rule);
    --lex-bg-card: var(--paper);
    --lex-border: var(--rule);
    --lex-border-active: var(--accent);
    --lex-text-primary: var(--ink);
    --lex-text-secondary: var(--ink-soft);
    --lex-text-muted: var(--muted);
    --lex-accent-blue: var(--accent);
    --lex-accent-blue-subtle: var(--accent-soft);
  }

  *:focus-visible {
    outline: 2px solid var(--accent) !important;
    outline-offset: 1px;
  }

  .serif { font-family: 'Fraunces', Georgia, serif; font-style: italic; letter-spacing: -0.01em; }
  .mono { font-family: 'IBM Plex Mono', monospace; }

  .LexAmplify-drawer {
    position: fixed; inset: 0; z-index: 9999;
    display: flex; overflow: hidden;
    background: var(--bg);
    color: var(--ink);
    font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: lex-fade-in 0.2s ease both;
  }
  .LexAmplify-drawer.closing { animation: lex-fade-in 0.18s ease reverse both; }

  /* Theme-adaptive Sidebar (Left Rail) */
  .lex-sidebar {
    background: var(--paper) !important;
    border-right: 1px solid var(--rule) !important;
    display: flex; flex-direction: column; overflow: hidden;
    color: var(--ink);
  }
  .rail-id { display: flex; align-items: center; gap: 10px; padding: 14px 14px 10px; }
  .rail-icon { width: 30px; height: 30px; border-radius: 9px; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .rail-title { font-size: 14px; font-weight: 600; color: var(--ink); line-height: 1.2; }
  .rail-sub { font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }

  .new-convo-btn {
    display: flex; align-items: center; justify-content: center; gap: 7px;
    padding: 9px 12px; margin: 0 12px 10px; border-radius: 9px;
    border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent);
    font-size: 12.5px; font-weight: 600; cursor: pointer; transition: all 0.15s ease;
  }
  .new-convo-btn:hover { filter: brightness(1.08); }

  .lex-sidebar-search-wrap { padding: 0 12px 8px; position: relative; }
  .lex-sidebar-search-input {
    width: 100%; background: var(--paper-2);
    border: 1px solid var(--rule); border-radius: 8px;
    padding: 7px 26px 7px 28px; font-size: 12px;
    color: var(--ink); outline: none; box-sizing: border-box; font-family: inherit;
    transition: border-color 0.15s ease;
  }
  .lex-sidebar-search-input:focus { border-color: var(--accent); }
  .lex-sidebar-search-icon { position: absolute; left: 20px; top: 7px; color: var(--muted); pointer-events: none; }
  .lex-sidebar-search-clear { position: absolute; right: 20px; top: 6px; background: none; border: none; color: var(--muted); cursor: pointer; padding: 2px; font-size: 12px; }

  .lex-sess-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 10px; margin: 2px 8px; border-radius: 8px;
    cursor: pointer; border: 1px solid transparent; background: transparent;
    transition: all 0.12s ease;
  }
  .lex-sess-item:hover { background: var(--paper-2); }
  .lex-sess-item.active {
    background: var(--accent-soft) !important;
    border: 1px solid var(--accent) !important;
  }
  .lex-sess-title {
    font-size: 12px; font-weight: 500; color: var(--ink);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3;
  }
  .lex-sess-item.active .lex-sess-title { color: var(--accent) !important; font-weight: 600; }
  .lex-sess-meta { font-size: 10px; color: var(--muted); font-family: 'IBM Plex Mono', monospace; margin-top: 2px; }

  .lex-sidebar-tree {
    margin: 2px 10px 6px 18px; padding-left: 8px;
    border-left: 1.5px solid var(--rule);
    display: flex; flex-direction: column; gap: 3px;
  }
  .lex-sidebar-tree-node {
    display: flex; align-items: center; justify-content: space-between;
    padding: 3px 6px; border-radius: 5px; font-size: 11px;
    color: var(--ink-soft); cursor: pointer; background: transparent;
    border: none; text-align: left; width: 100%; transition: all 0.12s ease;
  }
  .lex-sidebar-tree-node:hover { background: var(--paper-2); color: var(--ink); }

  .rail-foot {
    padding: 8px 12px; border-top: 1px solid var(--rule);
    display: flex; align-items: center; justify-content: space-between;
    font-size: 10px; color: var(--muted);
  }
  .kbd {
    font-family: 'IBM Plex Mono', monospace; background: var(--paper-2);
    border: 1px solid var(--rule); border-radius: 4px; padding: 1px 5px;
    font-size: 9.5px; color: var(--ink-soft); margin: 0 2px;
  }

  /* Topbar */
  .crumbs { font-size: 12.5px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
  .crumbs b { color: var(--ink); font-weight: 600; }
  .btn {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 7px 13px; border-radius: 8px; font-size: 12px; font-weight: 500;
    cursor: pointer; border: 1px solid var(--rule); background: var(--paper);
    color: var(--ink); white-space: nowrap; transition: all 0.15s ease;
  }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  .btn-primary {
    background: var(--accent) !important; border-color: var(--accent) !important;
    color: var(--on-accent) !important; font-weight: 600;
  }
  .btn-primary:hover { filter: brightness(1.08); color: var(--on-accent) !important; }
  .btn-sm { padding: 5px 10px; font-size: 11.5px; border-radius: 6px; }
  .theme-btn {
    width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--rule);
    background: var(--paper); color: var(--ink-soft); cursor: pointer;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    transition: all 0.15s ease;
  }
  .theme-btn:hover { border-color: var(--accent); color: var(--accent); }

  /* View 1: Landing State */
  .landing-wrap {
    max-width: 900px; margin: 0 auto; padding: 32px 20px 8px;
    display: flex; flex-direction: column; align-items: center;
    text-align: center; gap: 8px;
  }
  .hero-mark {
    width: 52px; height: 52px; border-radius: 14px;
    background: var(--accent-soft); color: var(--accent);
    display: flex; align-items: center; justify-content: center; margin-bottom: 4px;
  }
  .hero-title { font-size: 26px; color: var(--ink); margin: 0; font-weight: 600; }
  .hero-desc { font-size: 13px; color: var(--ink-soft); max-width: 540px; line-height: 1.5; margin: 0; }
  .trust-line {
    display: inline-flex; align-items: center; gap: 8px; margin-top: 4px;
    padding: 5px 13px; border-radius: 999px; background: var(--paper-2);
    border: 1px solid var(--rule); font-family: 'IBM Plex Mono', monospace;
    font-size: 10.5px; color: var(--ink-soft);
  }
  .trust-line svg { color: var(--accent); flex-shrink: 0; }
  .trust-line b { color: var(--ink); font-weight: 600; }

  .wf-tabs {
    display: flex; gap: 6px; margin-top: 16px;
    background: var(--paper-2); border: 1px solid var(--rule);
    border-radius: 10px; padding: 3px;
  }
  .wf-tab {
    padding: 6px 14px; border-radius: 7px; font-size: 12px; font-weight: 500;
    border: 0; background: transparent; color: var(--ink-soft); cursor: pointer;
    transition: all 0.12s ease;
  }
  .wf-tab.active { background: var(--accent) !important; color: var(--on-accent) !important; }

  .wf-grid {
    width: 100%; max-width: 900px; margin: 14px auto 0;
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; text-align: left;
  }
  .wf-card {
    border: 1px solid var(--rule); border-radius: 12px; padding: 13px;
    background: var(--paper); display: flex; gap: 11px; cursor: pointer;
    transition: all 0.15s ease; width: 100%;
  }
  .wf-card:hover { border-color: var(--accent); background: var(--paper-2); transform: translateY(-1px); }
  .wf-icon {
    width: 32px; height: 32px; border-radius: 8px; background: var(--paper-2);
    color: var(--accent); display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .wf-body { min-width: 0; flex: 1; }
  .wf-top-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 2px; }
  .wf-title { font-size: 13px; font-weight: 600; color: var(--ink); }
  .wf-cat {
    font-family: 'IBM Plex Mono', monospace; font-size: 8.5px; letter-spacing: .06em;
    text-transform: uppercase; color: var(--muted); background: var(--paper-2);
    border: 1px solid var(--rule); border-radius: 4px; padding: 1px 5px; flex-shrink: 0;
  }
  .wf-desc { font-size: 11px; color: var(--muted); line-height: 1.4; }

  /* TRY Prompt Chips */
  .try-row { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 8px; }
  .try-label { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: .08em; color: var(--muted); }
  .try-chip {
    display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px;
    border-radius: 999px; border: 1px solid var(--rule); background: var(--paper);
    color: var(--ink-soft); font-size: 11px; cursor: pointer; transition: all 0.12s ease;
  }
  .try-chip:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }

  /* Composer & Command Center */
  .lex-unified-command-center {
    background: var(--paper); border: 1px solid var(--rule);
    border-radius: 14px; box-shadow: var(--shadow);
    transition: border-color 0.2s ease; display: flex; flex-direction: column;
    overflow: hidden; position: relative;
  }
  .lex-unified-command-center:focus-within { border-color: var(--accent); }
  .lex-composer-body { padding: 10px 14px 4px; display: flex; flex-direction: column; }
  .lex-textarea {
    width: 100%; min-height: 46px; max-height: 160px;
    background: transparent; border: none; outline: none; resize: none;
    font-family: inherit; font-size: 13.5px; line-height: 1.55;
    color: var(--ink); box-sizing: border-box; padding: 0;
  }
  .lex-textarea::placeholder { color: var(--muted); }

  .lex-composer-bottom {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 12px 8px; background: transparent; flex-wrap: wrap; gap: 8px;
  }
  .lex-composer-tools { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .lex-tool-divider { width: 1px; height: 16px; background: var(--rule); margin: 0 3px; }
  .tool-pill {
    display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px;
    border-radius: 7px; border: 1px solid transparent; background: transparent;
    color: var(--ink-soft); font-size: 11.5px; font-weight: 500; cursor: pointer;
    transition: all 0.12s ease;
  }
  .tool-pill:hover { background: var(--paper-2); color: var(--ink); }
  .tool-pill svg { color: var(--accent); }

  .lex-send-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    padding: 6px 13px; border-radius: 8px; border: none !important;
    background: var(--accent) !important; color: var(--on-accent) !important;
    font-size: 12px; font-weight: 600; cursor: pointer; flex-shrink: 0;
    transition: all 0.15s ease;
  }
  .lex-send-btn:hover:not(:disabled) { filter: brightness(1.08); }
  .lex-send-btn:disabled {
    background: var(--paper-2) !important; color: var(--muted) !important;
    cursor: not-allowed;
  }
  .lex-stop-btn {
    display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
    border-radius: 8px; border: 1px solid var(--rule) !important;
    background: var(--paper) !important; color: var(--ink-soft) !important;
    font-size: 11.5px; font-weight: 500; cursor: pointer; transition: all 0.12s ease;
  }
  .lex-stop-btn:hover { border-color: var(--accent) !important; color: var(--accent) !important; }

  /* Slash Autocomplete Popup */
  .lex-slash-popup {
    position: absolute; bottom: calc(100% + 8px); left: 0; right: 0;
    background: var(--paper); border: 1px solid var(--rule);
    border-radius: 10px; box-shadow: var(--shadow);
    padding: 6px; z-index: 50; display: flex; flex-direction: column; gap: 2px;
    max-height: 220px; overflow-y: auto; animation: lex-in 0.15s ease;
  }
  .lex-slash-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; border-radius: 6px; background: transparent;
    border: none; cursor: pointer; text-align: left; transition: all 0.1s ease;
  }
  .lex-slash-item:hover, .lex-slash-item.selected {
    background: var(--accent-soft);
  }
  .lex-slash-cmd { font-weight: 700; color: var(--accent); font-size: 12px; font-family: 'IBM Plex Mono', monospace; }
  .lex-slash-label { font-size: 11.5px; color: var(--ink-soft); }

  /* Five-state Progress / Working Cards */
  .msg-user-bubble {
    max-width: 78%; background: var(--accent-soft);
    border: 1px solid var(--accent); border-radius: 14px 14px 3px 14px;
    padding: 11px 15px; font-size: 13px; line-height: 1.5; color: var(--ink);
    word-break: break-word;
  }
  .msg-user-label { font-size: 10px; font-family: 'IBM Plex Mono', monospace; color: var(--muted); margin-bottom: 3px; }

  .work-card {
    border: 1px solid var(--rule); border-radius: 12px; background: var(--paper);
    padding: 14px 18px; margin: 6px 0;
  }
  .work-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .work-head-left { display: flex; align-items: center; gap: 10px; }
  .work-spinner {
    width: 16px; height: 16px; border-radius: 50%;
    border: 2px solid var(--rule); border-top-color: var(--accent);
    animation: lex-spin 0.9s linear infinite; flex-shrink: 0;
  }
  .work-title { font-size: 13px; font-weight: 600; color: var(--ink); }
  .work-sub { font-size: 11px; color: var(--muted); margin-top: 1px; }

  .step-list { display: flex; flex-direction: column; gap: 3px; }
  .step-row { display: flex; align-items: center; gap: 10px; padding: 5px 2px; }
  .step-marker {
    width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .step-marker.done { background: var(--accent); color: var(--on-accent); }
  .step-marker.active { border: 2px solid var(--accent); position: relative; }
  .step-marker.active::after {
    content: ''; position: absolute; inset: -3px; border-radius: 50%;
    border: 1px solid var(--accent-soft); animation: lex-pulse-halo 1.6s ease-out infinite;
  }
  .step-marker.pending { border: 2px solid var(--rule); }
  .step-text { font-size: 12px; }
  .step-row.done .step-text { color: var(--muted); }
  .step-row.active .step-text { color: var(--ink); font-weight: 600; }
  .step-row.pending .step-text { color: var(--muted); }

  .stopped-card {
    border: 1px solid var(--rule); border-radius: 12px;
    background: var(--paper); padding: 14px 18px; margin: 6px 0;
  }
  .failed-card {
    border: 1px solid var(--major); border-radius: 12px;
    background: var(--major-soft); padding: 14px 18px; margin: 6px 0;
  }

  /* Generated Artifact Card */
  .lex-artifact-card {
    background: var(--paper); border: 1px solid var(--rule);
    border-left: 3.5px solid var(--accent); border-radius: 10px;
    padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; margin-top: 8px;
  }
  .lex-artifact-tag {
    font-size: 9.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--accent); font-family: 'IBM Plex Mono', monospace;
    display: flex; align-items: center; gap: 5px;
  }
  .lex-artifact-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .lex-artifact-title { font-size: 14px; font-weight: 600; color: var(--ink); line-height: 1.3; }
  .lex-artifact-sub { font-size: 10.5px; color: var(--muted); margin-top: 2px; }
  .lex-artifact-badge {
    font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 10px;
    background: var(--accent-soft); color: var(--accent); font-family: 'IBM Plex Mono', monospace;
  }
  .lex-artifact-meta { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 8px; font-family: 'IBM Plex Mono', monospace; }
  .lex-artifact-actions { display: flex; align-items: center; gap: 8px; margin-top: 3px; }
  .lex-artifact-open-btn {
    padding: 6px 12px; border-radius: 7px; background: var(--accent);
    color: var(--on-accent); border: none; font-size: 11.5px; font-weight: 600;
    cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
    transition: all 0.12s ease;
  }
  .lex-artifact-open-btn:hover { filter: brightness(1.08); }
  .lex-artifact-save-btn {
    padding: 6px 11px; border-radius: 7px; background: var(--paper-2);
    border: 1px solid var(--rule); color: var(--ink); font-size: 11.5px;
    font-weight: 500; cursor: pointer; display: inline-flex; align-items: center;
    gap: 5px; transition: all 0.12s ease;
  }
  .lex-artifact-save-btn:hover { border-color: var(--accent); color: var(--accent); }

  /* Document Drawer & Paper */
  .lex-doc-sticky-toolbar {
    position: sticky; top: 0; z-index: 20;
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 14px; border-bottom: 1px solid var(--rule);
    background: var(--paper); flex-shrink: 0; gap: 8px;
  }
  .lex-doc-canvas {
    background: var(--bg); padding: 20px 16px; overflow-y: auto; flex: 1;
    display: flex; justify-content: center; align-items: flex-start;
  }
  .lex-doc-paper {
    width: 100%; max-width: 720px; min-height: 840px;
    background: var(--paper) !important; color: var(--ink) !important;
    border: 1px solid var(--rule); border-radius: 6px; box-shadow: var(--shadow);
    padding: 34px 42px; font-family: 'Charter', 'Georgia', 'Times New Roman', serif;
    font-size: 14px; line-height: 1.8; outline: none; box-sizing: border-box;
  }
  .draft-trust-bar {
    display: flex; align-items: center; gap: 8px; padding: 9px 16px;
    background: var(--major-soft); border-bottom: 1px solid var(--rule);
  }
  .draft-trust-bar svg { color: var(--major); flex-shrink: 0; }
  .draft-trust-text { font-size: 11px; color: var(--ink-soft); line-height: 1.45; }
  .draft-trust-text b { color: var(--ink); font-weight: 600; }

  .draft-h { font-size: 13.5px; font-weight: 600; margin: 18px 0 8px; padding-bottom: 5px; border-bottom: 1px solid var(--rule); color: var(--ink); }
  .draft-p { font-size: 12.5px; line-height: 1.7; color: var(--ink-soft); margin: 0 0 10px; }
  .draft-sec-num { color: var(--accent); font-size: 13px; margin-right: 4px; }

  /* Semantic Tables */
  .lex-table-responsive { width: 100%; overflow-x: auto; margin: 12px 0; }
  table.lex-legal-table {
    width: 100%; border-collapse: collapse; margin: 8px 0;
    font-size: 12px; line-height: 1.5; font-family: 'IBM Plex Sans', sans-serif;
  }
  table.lex-legal-table th {
    background: var(--paper-2); padding: 7px 10px; font-family: 'IBM Plex Mono', monospace;
    font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--muted); border: 1px solid var(--rule); text-align: left;
  }
  table.lex-legal-table td { padding: 8px 10px; border: 1px solid var(--rule); color: var(--ink-soft); }
  table.lex-legal-table tr:nth-child(even) td { background: var(--paper-2); }
  table.lex-legal-table td b, table.lex-legal-table td strong { color: var(--ink); }

  /* Interactive Placeholders */
  .lex-placeholder {
    background: var(--major-soft) !important;
    border-bottom: 1.5px dashed var(--major) !important;
    border-radius: 3px !important; padding: 1px 5px !important;
    color: var(--major) !important; font-weight: 600 !important;
    cursor: pointer !important; display: inline-block !important;
    transition: all 0.12s ease !important;
  }
  .lex-placeholder:hover { filter: brightness(1.15); }

  /* Outline Panel */
  .lex-outline-panel {
    background: var(--paper-2); border-bottom: 1px solid var(--rule);
    padding: 9px 14px; display: flex; flex-direction: column; gap: 4px;
    max-height: 180px; overflow-y: auto;
  }
  .lex-outline-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 5px 9px; border-radius: 6px; background: var(--paper);
    border: 1px solid var(--rule); font-size: 11.5px; color: var(--ink);
    cursor: pointer; text-align: left; transition: all 0.12s ease;
  }
  .lex-outline-item:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }

  /* Clause AI Actions Bar */
  .lex-section-ai-bar {
    display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
    padding: 6px 14px; background: var(--paper-2); border-bottom: 1px solid var(--rule);
  }
  .lex-clause-action-btn {
    background: var(--paper); border: 1px solid var(--rule);
    border-radius: 5px; padding: 2px 8px; font-size: 11px;
    font-weight: 500; color: var(--accent); cursor: pointer; transition: all 0.12s ease;
  }
  .lex-clause-action-btn:hover { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }

  /* Grounding Chips */
  .ground-chip {
    display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px;
    border-radius: 999px; background: var(--paper-2); border: 1px solid var(--rule);
    font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--ink-soft);
    cursor: pointer; transition: all 0.12s ease;
  }
  .ground-chip:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }

  @media (max-width: 900px) {
    .wf-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 768px) {
    .lex-doc-paper { padding: 20px 14px !important; }
    .lex-sidebar {
      position: fixed; top: 0; left: 0; height: 100%; z-index: 30;
      width: 270px; max-width: 85vw; transform: translateX(-100%);
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: var(--shadow);
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
//  SAVE TO VAULT MODAL (Slate & Rust Architecture)
// ═══════════════════════════════════════════════════════
function SaveToVaultModal({ draft, sessionTitle, apiBase, messages, onConfirm, onClose }) {
  const [flatFolders, setFlatFolders] = useState([]);
  const [navStack, setNavStack] = useState([{ id: null, name: 'Root (Case Vault)' }]);
  const [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const smartDefault = generateSmartName(draft?.doc_type, sessionTitle);
  useEffect(() => { setFileName(smartDefault); }, [smartDefault]);

  useEffect(() => {
    fetch(`${apiBase}/api/vault/folders`)
      .then(res => res.ok ? res.json() : null)
      .then(fData => {
        if (!isMountedRef.current) return;
        if (fData) setFlatFolders(fData.flat || []);
      })
      .catch(() => {});
  }, [apiBase]);

  const currentView = navStack[navStack.length - 1];
  const isAtRoot = currentView.id == null;
  const currentChildren = flatFolders
    .filter(f => isAtRoot ? (f.parent_id == null || f.parent_id === 0) : Number(f.parent_id) === Number(currentView.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const destFolderId = isAtRoot ? null : currentView.id;
  const destPath = navStack.map(s => s.name).join(' / ');

  const handleConfirm = async () => {
    if (!fileName.trim() || saving) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/vault/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: fileName.trim(),
          content: draft?.content || '',
          case_id: draft?.case_id || sessionTitle || 'General',
          folder_id: destFolderId,
          doc_type: draft?.doc_type || 'Draft',
          session_title: sessionTitle || '',
          audit_messages: JSON.stringify((messages || []).map(m => ({ role: m.role, text: m.text }))),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        if (isMountedRef.current) {
          setErrorMsg(data.message || 'Vault database is unavailable.');
          setSaving(false);
        }
        return;
      }
      if (isMountedRef.current) {
        onConfirm({
          fileName: fileName.trim(),
          folderId: destFolderId,
          folderPath: destPath,
          smartTitle: fileName.trim(),
          vaultId: data.id,
        });
      }
    } catch (err) {
      if (isMountedRef.current) {
        setErrorMsg('Network error while saving to Case Vault.');
        setSaving(false);
      }
    }
  };

  return (
    <div className="svm-backdrop" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10020, background: 'rgba(3,6,14,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'lex-in 0.18s ease' }}>
      <div className="svm-panel" style={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 14, width: 600, maxWidth: '94vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="draft" size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Save Draft to Case Vault</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><Icon name="close" size={16} /></button>
        </div>
        <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
          {errorMsg && (
            <div style={{ padding: '8px 12px', background: 'var(--major-soft)', border: '1px solid var(--major)', borderRadius: 6, color: 'var(--major)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="alert" size={14} />
              <span>{errorMsg}</span>
            </div>
          )}
          <div>
            <label style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', display: 'block', marginBottom: 6, fontFamily: 'IBM Plex Mono, monospace' }}>Document Title</label>
            <input value={fileName} onChange={e => setFileName(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--rule)', background: 'var(--paper-2)', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', display: 'block', marginBottom: 6, fontFamily: 'IBM Plex Mono, monospace' }}>Destination Folder</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: 'var(--paper-2)', borderRadius: 8, border: '1px solid var(--rule)', fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>
              📁 {destPath}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 6, marginTop: 8, maxHeight: 140, overflowY: 'auto' }}>
              {navStack.length > 1 && (
                <button onClick={() => setNavStack(prev => prev.slice(0, -1))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px dashed var(--rule)', background: 'transparent', color: 'var(--muted)', fontSize: 11, cursor: 'pointer', textAlign: 'left' }}>
                  ↖ Back
                </button>
              )}
              {currentChildren.map(f => (
                <button key={f.id} onClick={() => setNavStack(prev => [...prev, { id: f.id, name: f.name }])} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 11.5, cursor: 'pointer', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  📁 {f.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--rule)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--paper-2)' }}>
          <button onClick={onClose} className="btn btn-sm">Cancel</button>
          <button onClick={handleConfirm} disabled={saving || !fileName.trim()} className="btn btn-sm btn-primary">{saving ? 'Saving…' : 'Confirm & Save'}</button>
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
  const shareUrl = `${window.location.origin}/vault?ref=${encodeURIComponent((sessionTitle || 'Legal Matter').slice(0, 40))}`;

  const handleCopy = () => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
    }
  };

  return (
    <div className="svm-backdrop" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10020, background: 'rgba(3,6,14,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'lex-in 0.18s ease' }}>
      <div className="svm-panel" style={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 14, width: 440, maxWidth: '94vw', padding: '20px 24px', boxShadow: 'var(--shadow)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="sparkles" size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Share Legal Conversation</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><Icon name="close" size={16} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5, margin: '0 0 14px' }}>
          Share this legal research and drafting thread with colleagues or counsel.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input readOnly value={shareUrl} style={{ flex: 1, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--rule)', background: 'var(--paper-2)', color: 'var(--ink)', fontSize: 11.5, outline: 'none' }} />
          <button onClick={handleCopy} className="btn btn-sm btn-primary">{copied ? '✓ Copied' : 'Copy'}</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn btn-sm">Close</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  CONVERSATION 3-DOTS MENU (Dismisses on Scroll)
// ═══════════════════════════════════════════════════════
function ConversationMenu({ session, x, y, onPin, onRename, onShare, onDelete, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const keyHandler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 10050,
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        borderRadius: 8,
        boxShadow: 'var(--shadow)',
        padding: 4,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 140,
        animation: 'lex-in 0.12s ease',
      }}
    >
      <button
        onClick={onPin}
        style={{ padding: '6px 10px', border: 'none', background: 'transparent', color: 'var(--ink)', fontSize: 11.5, cursor: 'pointer', textAlign: 'left', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <Icon name="bookmark" size={12} />
        {session.pinned ? 'Unpin Matter' : 'Pin Matter'}
      </button>
      <button
        onClick={onRename}
        style={{ padding: '6px 10px', border: 'none', background: 'transparent', color: 'var(--ink)', fontSize: 11.5, cursor: 'pointer', textAlign: 'left', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <Icon name="notice" size={12} />
        Rename
      </button>
      <button
        onClick={onShare}
        style={{ padding: '6px 10px', border: 'none', background: 'transparent', color: 'var(--ink)', fontSize: 11.5, cursor: 'pointer', textAlign: 'left', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <Icon name="sparkles" size={12} />
        Share
      </button>
      <div style={{ height: 1, background: 'var(--rule)', margin: '3px 0' }} />
      <button
        onClick={onDelete}
        style={{ padding: '6px 10px', border: 'none', background: 'transparent', color: 'var(--major)', fontSize: 11.5, cursor: 'pointer', textAlign: 'left', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <Icon name="close" size={12} />
        Delete
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  MAIN AI LEGAL ASSOCIATE COMPONENT
// ═══════════════════════════════════════════════════════
export function CommandPalette() {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

  const location = useLocation();
  const navigate = useNavigate();

  // ── Safe Theme Context Consumer ───────────────────────
  const themeContext = useContext(ThemeContext);
  const [localTheme, setLocalTheme] = useState(() => {
    return document.documentElement.getAttribute('data-theme') || localStorage.getItem('lexai_theme') || 'dark';
  });
  const currentTheme = themeContext?.theme || localTheme;

  const toggleTheme = useCallback(() => {
    if (themeContext?.toggleTheme) {
      themeContext.toggleTheme();
    } else {
      const next = currentTheme === 'dark' ? 'light' : 'dark';
      setLocalTheme(next);
      document.documentElement.setAttribute('data-theme', next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      localStorage.setItem('lexai_theme', next);
    }
  }, [themeContext, currentTheme]);

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
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [isClosing, setIsClosing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewingSnapshot] = useState(null);
  const [copyToast, setCopyToast] = useState(false);
  const [isDrawerExpanded, setIsDrawerExpanded] = useState(false);

  // ── Five-State Lifecycle & Workflows ──────────────────
  const [lifecycleState, setLifecycleState] = useState('idle'); // 'idle' | 'thinking' | 'streaming' | 'stopped' | 'failed'
  const [lastQuery, setLastQuery] = useState('');
  const [streamError, setStreamError] = useState('');
  const [completedSteps, setCompletedSteps] = useState(0);

  // ── Intelligence & Refinements State ─────────────────
  const [sessSearch, setSessSearch] = useState('');
  const [toolCategory, setToolCategory] = useState('all');
  const [showCompletionPanel, setShowCompletionPanel] = useState(false);
  const [missingFieldInputs, setMissingFieldInputs] = useState({});
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [selectedSection, setSelectedSection] = useState(null);
  const [slashIndex, setSlashIndex] = useState(0);

  // ── File attachment ──────────────────────────────────
  const [attachedFile, setAttachedFile] = useState(null);

  // ── Modals & Menus ───────────────────────────────────
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [openMenuState, setOpenMenuState] = useState(null);
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
  const drawerBodyRef = useRef(null);
  const lastDocKeyRef = useRef(null);
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  // ── Derived Data ─────────────────────────────────────
  const currentSession = sessions.find(s => s.id === currentId) || null;
  const messages = currentSession?.messages || [];
  const activeDocument = currentSession?.activeDocument || null;

  // Extract missing placeholders and sections from active document
  const activeDocText = viewingSnapshot ? viewingSnapshot.content : (activeDocument?.content || '');
  const missingPlaceholders = useMemo(() => extractPlaceholders(activeDocText), [activeDocText]);
  const docSections = useMemo(() => extractSections(activeDocText), [activeDocText]);

  // Slash commands popup filter
  const isSlashActive = query.startsWith('/') && !query.includes(' ');
  const filteredSlashCmds = useMemo(() => {
    if (!isSlashActive) return [];
    const search = query.slice(1).toLowerCase();
    return SLASH_CMDS.filter(c => c.cmd.toLowerCase().includes(search) || c.label.toLowerCase().includes(search));
  }, [query, isSlashActive]);

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
    mutateSessions(prevSessions => {
      const target = prevSessions.find(s => s.id === sid);
      if (!target) return prevSessions;
      const isFirstUserMsg = (target.title === 'New conversation' && msg.role === 'user');
      const smartTitle = isFirstUserMsg ? generateConversationTitle(msg.text, prevSessions) : target.title;
      return prevSessions.map(s =>
        s.id === sid
          ? { ...s, title: smartTitle, messages: [...s.messages, { ...msg, _ts: Date.now() }], updatedAt: Date.now() }
          : s
      );
    });
  }, [mutateSessions]);

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
    setLifecycleState('idle');
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, [mutateSessions]);

  const selectSession = useCallback((id) => {
    setCurrentId(id);
    localStorage.setItem(CURRENT_KEY, id);
    setQuery('');
    setNavRoute(null);
    setLifecycleState('idle');
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

  // Sync drawer innerHTML safely
  useEffect(() => {
    const doc = viewingSnapshot || activeDocument;
    if (!drawerBodyRef.current) return;
    const key = doc ? `${doc.title}::${(doc.content || '').length}` : '__empty__';
    if (key === lastDocKeyRef.current) return;
    lastDocKeyRef.current = key;
    drawerBodyRef.current.innerHTML = doc
      ? highlightPlaceholders(renderDraftHtml(doc.content))
      : '';
  }, [viewingSnapshot, activeDocument, isOpen]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 80);
  }, [isOpen]);

  useEffect(() => {
    searchRef.current = handleSearch;
    isListeningRef.current = isListening;
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, loading, lifecycleState]);

  // Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recog = new SpeechRecognition();
    recog.continuous = true;
    recog.interimResults = true;
    recog.lang = 'en-IN';

    recog.onresult = (e) => {
      let finalTranscript = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
      }
      if (finalTranscript) {
        setQuery(prev => (prev ? `${prev} ${finalTranscript}` : finalTranscript));
      }
    };

    recog.onerror = () => setIsListening(false);
    recog.onend = () => {
      if (isListeningRef.current) recog.start();
      else setIsListening(false);
    };

    recognitionRef.current = recog;
    return () => { try { recog.abort(); } catch (_) {} };
  }, []);

  const toggleMic = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (_) {}
    }
  };

  const handleFileAttach = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setAttachedFile({ name: file.name, content: event.target.result });
    };
    reader.readAsText(file);
  };

  const handleBatchFillPlaceholders = () => {
    if (!activeDocument) return;
    let updated = activeDocument.content || '';
    Object.entries(missingFieldInputs).forEach(([key, val]) => {
      if (val.trim()) {
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\[${escapedKey}\\]`, 'g');
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

  const handleScrollToSection = (slug) => {
    if (!drawerBodyRef.current) return;
    const el = drawerBodyRef.current.querySelector(`#sec_${slug}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('highlighted');
      setTimeout(() => el.classList.remove('highlighted'), 1500);
    }
  };

  const handleClauseAction = (sectionTitle, actionType) => {
    const promptMap = {
      improve: `Improve and strengthen clause "${sectionTitle}" in the current draft to provide standard commercial legal protection under Indian law.`,
      simplify: `Simplify and clarify the wording in clause "${sectionTitle}" into plain legal English without losing legal enforceability.`,
      stronger: `Make clause "${sectionTitle}" legally stronger, inserting strict covenants, indemnification, and immediate injunctive relief remedies.`,
      explain: `Explain the practical legal implications and risks of clause "${sectionTitle}" for my client.`,
      protections: `Review clause "${sectionTitle}" and add missing safeguards or standard market carve-outs under the Indian Contract Act, 1872.`,
    };

    const targetPrompt = promptMap[actionType] || `Review clause "${sectionTitle}"`;
    setDrawerOpen(false);
    setQuery(targetPrompt);
    setTimeout(() => searchRef.current?.(null, targetPrompt), 40);
  };

  const handleStopGeneration = () => {
    abortControllerRef.current?.abort();
    setLoading(false);
    setLifecycleState('stopped');
  };

  // Core Search & Stream Handler
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
    setLastQuery(q);
    setAttachedFile(null);
    setLoading(true);
    setLifecycleState('thinking');
    setCompletedSteps(1);
    setStreamError('');

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
        setLifecycleState('idle');
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
      setCompletedSteps(2);
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

      if (!isMountedRef.current) return;

      if (!res.ok) {
        setLifecycleState('failed');
        setStreamError('Server communication error. Please try again.');
        pushMessage(sid, { id: `e_${Date.now()}`, role: 'error', text: 'Server communication error. Please try again.' });
        setLoading(false);
        return;
      }

      const contentType = res.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        const actionPayload = await res.json();
        if (!isMountedRef.current) return;
        if (actionPayload.is_action && actionPayload.intent === 'ROUTE') {
          navigate(actionPayload.destination);
          setLoading(false);
          setLifecycleState('idle');
          setIsOpen(false);
          return;
        }
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', accText = '';
      const msgId = `a_${Date.now()}`;
      pushMessage(sid, { id: msgId, role: 'assistant', text: '', sources: [] });
      setLifecycleState('streaming');
      setCompletedSteps(3);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!isMountedRef.current) { reader.cancel().catch(() => {}); break; }
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
              const updated = {
                case_id: activeDocument?.case_id,
                title: p.title || 'Updated Document',
                content: p.updated_content,
                doc_type: 'Draft Edit',
              };
              updateSession(sid, s => ({
                ...s,
                pendingDraft: updated,
                activeDocument: updated,
              }));
              patchMessage(sid, msgId, m => ({
                ...m,
                docCard: updated,
              }));
              setDrawerOpen(true);
            } else if (p.action === 'review_document' && p.draft) {
              const smart = generateSmartName(p.draft.doc_type, currentSession?.title);
              const enriched = { ...p.draft, smartTitle: smart };
              updateSession(sid, s => ({
                ...s,
                pendingDraft: enriched,
                activeDocument: enriched,
              }));
              patchMessage(sid, msgId, m => ({
                ...m,
                docCard: enriched,
              }));
              setDrawerOpen(true);
            } else if (p.token) {
              accText += p.token;
              patchMessage(sid, msgId, m => ({ ...m, text: accText }));
            }
          } catch (_) {}
        }
      }
      setCompletedSteps(4);
      setLifecycleState('idle');
    } catch (err) {
      if (err.name !== 'AbortError' && isMountedRef.current) {
        setLifecycleState('failed');
        setStreamError('Connection interrupted. Please verify your connection or retry.');
        pushMessage(sid, { id: `e_${Date.now()}`, role: 'error', text: 'Connection interrupted. Please try again.' });
      }
    } finally {
      if (isMountedRef.current) setLoading(false);
      abortControllerRef.current = null;
    }
  }

  const handleCopyDraft = () => {
    const text = viewingSnapshot ? viewingSnapshot.content : (activeDocument?.content || '');
    if (!text) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopyToast(true);
        setTimeout(() => setCopyToast(false), 2000);
      }).catch(() => {});
    } else {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopyToast(true);
        setTimeout(() => setCopyToast(false), 2000);
      } catch (_) {}
    }
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
               LEFT: THEME-ADAPTIVE SIDEBAR (Slate & Rust)
          ══════════════════════════════════════════════ */}
          <aside
            className={`lex-sidebar ${sidebarOpen ? 'mobile-open' : ''}`}
            style={{
              flex: sidebarOpen ? '0 0 264px' : '0 0 0px',
              minWidth: 0,
              transition: 'flex-basis 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            {/* Header / Identity */}
            <div className="rail-id">
              <div className="rail-icon">
                <Icon name="scales" size={16} />
              </div>
              <div>
                <div className="rail-title serif">AI Legal Associate</div>
                <div className="rail-sub mono">DRAFTING &amp; RESEARCH</div>
              </div>
            </div>

            <button className="new-convo-btn" onClick={startNew}>
              <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
              New conversation
            </button>

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
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
              {filteredSessions.length === 0 ? (
                <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                  No matching matters found.
                </div>
              ) : (
                <>
                  {pinnedSess.length > 0 && (
                    <>
                      <div style={{ padding: '6px 14px 2px', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.08em', fontFamily: 'IBM Plex Mono, monospace' }}>Pinned Matters</div>
                      {pinnedSess.map(s => renderSessionRow(s))}
                    </>
                  )}
                  {todaySess.length > 0 && (
                    <>
                      <div style={{ padding: '6px 14px 2px', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.08em', fontFamily: 'IBM Plex Mono, monospace' }}>Today</div>
                      {todaySess.map(s => renderSessionRow(s))}
                    </>
                  )}
                  {yesterdaySess.length > 0 && (
                    <>
                      <div style={{ padding: '6px 14px 2px', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.08em', fontFamily: 'IBM Plex Mono, monospace' }}>Yesterday</div>
                      {yesterdaySess.map(s => renderSessionRow(s))}
                    </>
                  )}
                  {olderSess.length > 0 && (
                    <>
                      <div style={{ padding: '6px 14px 2px', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.08em', fontFamily: 'IBM Plex Mono, monospace' }}>Earlier</div>
                      {olderSess.map(s => renderSessionRow(s))}
                    </>
                  )}
                </>
              )}
            </div>

            {/* Shortcut Hint Footer */}
            <div className="rail-foot">
              <span className="mono"><span className="kbd">Ctrl</span><span className="kbd">K</span> Toggle</span>
              <span className="mono"><span className="kbd">Esc</span> Close</span>
            </div>
          </aside>

          {/* ══════════════════════════════════════════════
               CENTER: AI CONVERSATION & WORKSPACE CANVAS
          ══════════════════════════════════════════════ */}
          <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>

            {/* Professional Top Navigation Bar */}
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', borderBottom: '1px solid var(--rule)', background: 'var(--paper)', flexShrink: 0, gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <button
                  onClick={() => setSidebarOpen(v => !v)}
                  className="theme-btn"
                  title="Toggle Sidebar"
                  style={{ width: 28, height: 28 }}
                >
                  <Icon name="outline" size={13} />
                </button>
                <div className="crumbs">
                  <span>Legal Workspace</span>
                  <span>/</span>
                  <b>AI Legal Associate</b>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  className="theme-btn"
                  onClick={toggleTheme}
                  title={`Switch to ${currentTheme === 'dark' ? 'light' : 'dark'} mode`}
                >
                  <Icon name={currentTheme === 'dark' ? 'sun' : 'moon'} size={14} />
                </button>

                {activeDocument && (
                  <button
                    onClick={() => setDrawerOpen(v => !v)}
                    className="btn btn-sm"
                    style={{
                      background: drawerOpen ? 'var(--accent-soft)' : 'var(--paper)',
                      borderColor: drawerOpen ? 'var(--accent)' : 'var(--rule)',
                      color: drawerOpen ? 'var(--accent)' : 'var(--ink)',
                      fontWeight: 600,
                    }}
                  >
                    <Icon name="draft" size={12} />
                    {drawerOpen ? 'Hide Draft' : 'View Draft'}
                  </button>
                )}

                <button onClick={handleClose} className="btn btn-sm">
                  <Icon name="close" size={12} />
                  Exit workspace
                </button>
              </div>
            </header>

            {/* Scrollable Conversation Stream */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* ── View 1: Landing / Empty State ── */}
              {messages.length === 0 && (
                <div className="landing-wrap">
                  <div className="hero-mark">
                    <Icon name="scales" size={26} />
                  </div>
                  <h2 className="hero-title serif">AI Legal Associate</h2>
                  <p className="hero-desc">
                    Drafting, statutory research, and contract analysis — grounded in Indian law, scoped to whichever matter you're working in.
                  </p>
                  <div className="trust-line">
                    <Icon name="check" size={11} style={{ color: 'var(--accent)' }} />
                    <span><b>Draft-only, not legal advice.</b> Every citation is checked against the statute before it's shown to you.</span>
                  </div>

                  {/* Category Filter Tabs */}
                  <div className="wf-tabs">
                    {LEGAL_TOOL_CATEGORIES.map(c => (
                      <button
                        key={c.id}
                        className={`wf-tab ${toolCategory === c.id ? 'active' : ''}`}
                        onClick={() => setToolCategory(c.id)}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>

                  {/* 9 Workflow Cards */}
                  <div className="wf-grid">
                    {(toolCategory === 'all'
                      ? LEGAL_TOOLS
                      : LEGAL_TOOLS.filter(t => t.category === toolCategory)
                    ).map(t => (
                      <div
                        key={t.id}
                        className="wf-card"
                        onClick={() => {
                          setQuery(t.prompt);
                          setTimeout(() => searchRef.current?.(null, t.prompt), 30);
                        }}
                      >
                        <div className="wf-icon">
                          <Icon name={t.icon} size={16} />
                        </div>
                        <div className="wf-body">
                          <div className="wf-top-row">
                            <span className="wf-title">{t.title}</span>
                            <span className="wf-cat mono">
                              {t.category === 'draft' ? 'Drafting' : t.category === 'research' ? 'Research' : 'Analysis'}
                            </span>
                          </div>
                          <div className="wf-desc">{t.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Message Bubbles ── */}
              {messages.map((msg, idx) => {
                if (msg.role === 'user') {
                  return (
                    <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                      <span className="msg-user-label mono">YOU</span>
                      <div className="msg-user-bubble">
                        {msg.text}
                      </div>
                    </div>
                  );
                }

                if (msg.role === 'error') {
                  return (
                    <div key={idx} className="failed-card" style={{ margin: '4px 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--major)', fontSize: 12.5 }}>
                        <Icon name="caution" size={14} />
                        <span><strong>Error:</strong> {msg.text}</span>
                      </div>
                    </div>
                  );
                }

                // AI Associate Output
                return (
                  <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                      <Icon name="sparkles" size={14} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: '2px 12px 12px 12px', padding: '14px 18px', boxShadow: 'var(--shadow)' }}>
                      {msg.text && (
                        <div className="lex-md" style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink)' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
                      )}

                      {/* Clean Document Artifact Card */}
                      {msg.docCard && (
                        <div className="lex-artifact-card">
                          <div className="lex-artifact-tag">
                            <Icon name="draft" size={12} />
                            <span>DOCUMENT GENERATED</span>
                          </div>
                          <div className="lex-artifact-head">
                            <div>
                              <div className="lex-artifact-title serif" style={{ fontSize: 15, fontWeight: 600 }}>
                                {msg.docCard.title || 'Legal Document Draft'}
                              </div>
                              <div className="lex-artifact-sub mono">Indian Law Compliance · Matter Drafting</div>
                            </div>
                            <span className="lex-artifact-badge">AI Generated · Draft</span>
                          </div>
                          <div className="lex-artifact-meta">
                            <span>§ {extractSections(msg.docCard.content).length} Sections</span>
                            <span>·</span>
                            <span>{extractPlaceholders(msg.docCard.content).length} Details Required</span>
                          </div>
                          <div className="lex-artifact-actions">
                            <button
                              className="lex-artifact-open-btn"
                              onClick={() => {
                                updateSession(currentId, s => ({ ...s, activeDocument: msg.docCard }));
                                setDrawerOpen(true);
                              }}
                            >
                              <Icon name="draft" size={13} />
                              Open Draft in Workspace →
                            </button>
                            <button
                              className="lex-artifact-save-btn"
                              onClick={() => {
                                updateSession(currentId, s => ({ ...s, activeDocument: msg.docCard }));
                                setShowSaveModal(true);
                              }}
                            >
                              <Icon name="folder" size={12} />
                              Save to Case Vault
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* ── View 2: Thinking & Streaming Card (Five-State Lifecycle) ── */}
              {loading && (
                <div className="work-card">
                  <div className="work-head">
                    <div className="work-head-left">
                      <div className="work-spinner" />
                      <div>
                        <div className="work-title">AI Legal Associate is working…</div>
                        <div className="work-sub">Analyzing statutory provisions &amp; drafting clause structure</div>
                      </div>
                    </div>
                    <button type="button" className="lex-stop-btn" onClick={handleStopGeneration}>
                      <Icon name="stop" size={11} /> Stop
                    </button>
                  </div>
                  <div className="step-list">
                    <div className={`step-row ${completedSteps >= 1 ? 'done' : 'active'}`}>
                      <div className={`step-marker ${completedSteps >= 1 ? 'done' : 'active'}`}>
                        {completedSteps >= 1 ? <Icon name="check" size={10} /> : null}
                      </div>
                      <span className="step-text">Understanding legal context &amp; statutory scope</span>
                    </div>
                    <div className={`step-row ${completedSteps >= 2 ? 'done' : completedSteps === 1 ? 'active' : 'pending'}`}>
                      <div className={`step-marker ${completedSteps >= 2 ? 'done' : completedSteps === 1 ? 'active' : 'pending'}`}>
                        {completedSteps >= 2 ? <Icon name="check" size={10} /> : null}
                      </div>
                      <span className="step-text">Analyzing provisions &amp; Indian legal precedents</span>
                    </div>
                    <div className={`step-row ${completedSteps >= 3 ? 'done' : completedSteps === 2 ? 'active' : 'pending'}`}>
                      <div className={`step-marker ${completedSteps >= 3 ? 'done' : completedSteps === 2 ? 'active' : 'pending'}`}>
                        {completedSteps >= 3 ? <Icon name="check" size={10} /> : null}
                      </div>
                      <span className="step-text">Structuring enforceable agreement clauses</span>
                    </div>
                    <div className={`step-row ${completedSteps >= 4 ? 'done' : completedSteps === 3 ? 'active' : 'pending'}`}>
                      <div className={`step-marker ${completedSteps >= 4 ? 'done' : completedSteps === 3 ? 'active' : 'pending'}`}>
                        {completedSteps >= 4 ? <Icon name="check" size={10} /> : null}
                      </div>
                      <span className="step-text">Finalizing reviewable legal draft</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Stopped State Card (Replaces work-card in place) ── */}
              {!loading && lifecycleState === 'stopped' && (
                <div className="stopped-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon name="stop" size={14} style={{ color: 'var(--ink-soft)' }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>You stopped this response</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          if (lastQuery) handleSearch(null, lastQuery);
                        }}
                      >
                        Resume
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => setLifecycleState('idle')}
                      >
                        Start over
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    Generation was halted. Completed clauses and statutory context have been preserved.
                  </div>
                </div>
              )}

              {/* ── Failed State Card (Amber Alert Icon, Never Red) ── */}
              {!loading && lifecycleState === 'failed' && (
                <div className="failed-card">
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <Icon name="caution" size={16} style={{ color: 'var(--major)', marginTop: 2, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>
                        Couldn't reach the drafting model
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 8 }}>
                        {streamError || 'Connection interrupted or server unavailable. Please check connection or retry.'}
                      </div>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => {
                          if (lastQuery) handleSearch(null, lastQuery);
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* ══════════════════════════════════════════════
                 COMPOSER ZONE (Slate & Rust Architecture)
            ══════════════════════════════════════════════ */}
            <div style={{ padding: '6px 20px 14px', background: 'var(--bg)' }}>

              {/* Attached file preview badge */}
              {attachedFile && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 16, fontSize: 11, color: 'var(--accent)', marginBottom: 6 }}>
                  <Icon name="draft" size={12} />
                  <span>{attachedFile.name}</span>
                  <button onClick={() => setAttachedFile(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 2px' }}>×</button>
                </div>
              )}

              <input ref={fileInputRef} type="file" style={{ display: 'none' }} accept=".pdf,.docx,.doc,.txt,.md" onChange={handleFileAttach} />

              <div className="lex-unified-command-center">
                {/* Slash Commands Autocomplete Popup */}
                {isSlashActive && filteredSlashCmds.length > 0 && (
                  <div className="lex-slash-popup">
                    {filteredSlashCmds.map((c, i) => (
                      <button
                        key={c.cmd}
                        className={`lex-slash-item ${i === slashIndex ? 'selected' : ''}`}
                        onClick={() => {
                          setQuery(c.fill);
                          inputRef.current?.focus();
                        }}
                      >
                        <span className="lex-slash-cmd">{c.cmd}</span>
                        <span className="lex-slash-label">{c.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* TRY Prompt Suggestions Strip */}
                <div style={{ padding: '8px 12px 4px', display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto' }}>
                  <span className="try-label mono">TRY:</span>
                  {PROMPT_SUGGESTIONS.map((s, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="try-chip"
                      onClick={() => {
                        setQuery(s.prompt);
                        setTimeout(() => searchRef.current?.(null, s.prompt), 30);
                      }}
                    >
                      <Icon name="sparkles" size={11} />
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>

                {/* Composer Textarea */}
                <div className="lex-composer-body">
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
                      if (isSlashActive && filteredSlashCmds.length > 0) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setSlashIndex(prev => (prev + 1) % filteredSlashCmds.length);
                          return;
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setSlashIndex(prev => (prev - 1 + filteredSlashCmds.length) % filteredSlashCmds.length);
                          return;
                        }
                        if (e.key === 'Enter' || e.key === 'Tab') {
                          e.preventDefault();
                          setQuery(filteredSlashCmds[slashIndex].fill);
                          return;
                        }
                      }
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSearch(null);
                      }
                    }}
                    placeholder="Ask LexAmplify anything… type / for drafting commands (Shift+Enter for new line)"
                  />
                </div>

                {/* Integrated Bottom Toolbar (5 Tools + Send Button) */}
                <div className="lex-composer-bottom">
                  <div className="lex-composer-tools">
                    <button type="button" className="tool-pill" onClick={() => fileInputRef.current?.click()} title="Attach Document (PDF, DOCX, TXT)">
                      <Icon name="attach" size={13} /> Attach
                    </button>
                    <button type="button" className="tool-pill" onClick={toggleMic} style={{ color: isListening ? 'var(--major)' : undefined }} title="Voice Command">
                      <Icon name="mic" size={13} /> {isListening ? 'Listening…' : 'Voice'}
                    </button>

                    <div className="lex-tool-divider" />

                    {/* Integrated Assistant Tools */}
                    {ASSISTANT_TOOLS.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        className="tool-pill"
                        onClick={() => {
                          setQuery(t.prompt);
                          setTimeout(() => searchRef.current?.(null, t.prompt), 30);
                        }}
                      >
                        <Icon name={t.icon} size={12} />
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <div>
                    {loading ? (
                      <button type="button" className="lex-stop-btn" onClick={handleStopGeneration}>
                        <Icon name="stop" size={11} /> Stop
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="lex-send-btn"
                        aria-label="Send message"
                        disabled={!query.trim() && !attachedFile}
                        onClick={() => handleSearch(null)}
                      >
                        <span>Send</span>
                        <Icon name="send" size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Standing Footer Disclaimer */}
              <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--muted)', textAlign: 'center' }}>
                LexAmplify provides AI-assisted legal drafting. Always verify critical statutory information independently.
              </div>
            </div>
          </main>

          {/* ══════════════════════════════════════════════
               RIGHT: DRAFT RESULT WORKSPACE (View 3 Canvas)
          ══════════════════════════════════════════════ */}
          <aside
            style={{
              flex: drawerOpen && activeDocument ? `0 0 ${isDrawerExpanded ? '65vw' : '520px'}` : '0 0 0px',
              minWidth: 0,
              transition: 'flex-basis 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
              background: 'var(--paper)',
              borderLeft: '1px solid var(--rule)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {activeDocument && (
              <>
                {/* Sticky Document Action Bar */}
                <div className="lex-doc-sticky-toolbar">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    <Icon name="draft" size={14} style={{ color: 'var(--accent)' }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {activeDocument.title || 'Legal Document Draft'}
                    </span>
                  </div>

                  {/* Toolbar Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {docSections.length > 0 && (
                      <button
                        className="btn btn-sm"
                        onClick={() => setOutlineOpen(v => !v)}
                        style={{
                          background: outlineOpen ? 'var(--accent-soft)' : 'var(--paper)',
                          borderColor: outlineOpen ? 'var(--accent)' : 'var(--rule)',
                          color: outlineOpen ? 'var(--accent)' : 'var(--ink)',
                        }}
                        title="Toggle Document Outline"
                      >
                        <Icon name="outline" size={12} /> {outlineOpen ? 'Outline ▲' : `Outline (${docSections.length})`}
                      </button>
                    )}
                    <button className="btn btn-sm" onClick={handleCopyDraft} title="Copy Draft">
                      <Icon name="copy" size={12} /> {copyToast ? 'Copied!' : 'Copy'}
                    </button>
                    <button className="btn btn-sm" onClick={handleDownloadDraft} title="Download Markdown (.md)">
                      <Icon name="download" size={12} /> Export
                    </button>
                    <button className="btn btn-sm" onClick={() => window.print()} title="Print or Save as PDF">
                      <Icon name="print" size={12} /> Print
                    </button>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => setShowSaveModal(true)}
                      title="Save to Case Vault"
                    >
                      <Icon name="folder" size={12} /> Save to Case Vault
                    </button>
                    <button className="btn btn-sm" onClick={() => setIsDrawerExpanded(v => !v)} title="Toggle Full Width">
                      <Icon name="sparkles" size={12} />
                    </button>
                    <button className="btn btn-sm" onClick={() => setDrawerOpen(false)} title="Close Draft Workspace">
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                </div>

                {/* Deterministic "GROUNDED IN:" Statutory Authorities Row */}
                {(() => {
                  const groundedStatutes = extractGroundedStatutes(activeDocText, activeDocument.citations || activeDocument.sources);
                  if (groundedStatutes.length === 0) return null;
                  return (
                    <div style={{ padding: '7px 14px', background: 'var(--paper-2)', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <span className="mono" style={{ fontSize: 9.5, letterSpacing: '.08em', color: 'var(--muted)', fontWeight: 600 }}>
                        GROUNDED IN:
                      </span>
                      {groundedStatutes.map((stat, idx) => (
                        <span key={idx} className="ground-chip" title="Verified Statutory Authority">
                          <Icon name="bookmark" size={10} />
                          {stat}
                        </span>
                      ))}
                    </div>
                  );
                })()}

                {/* Document Status & AI Review Badge */}
                <div style={{ padding: '7px 14px', background: 'var(--paper)', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ color: 'var(--ink-soft)' }}>
                    AI Generated · Draft · {missingPlaceholders.length} details required
                  </span>
                  {missingPlaceholders.length > 0 && (
                    <button
                      onClick={() => setShowCompletionPanel(v => !v)}
                      style={{ background: 'none', border: 'none', color: 'var(--major)', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}
                    >
                      {showCompletionPanel ? 'Hide Form' : '⚡ Complete Draft Fields'}
                    </button>
                  )}
                </div>

                {/* Collapsible Document Outline Panel */}
                {outlineOpen && docSections.length > 0 && (
                  <div className="lex-outline-panel">
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.05em', fontFamily: 'IBM Plex Mono, monospace' }}>
                      Document Outline
                    </div>
                    {docSections.map((sec, si) => (
                      <div
                        key={si}
                        className="lex-outline-item"
                        onClick={() => {
                          setSelectedSection(sec.full);
                          handleScrollToSection(sec.slug);
                        }}
                      >
                        <span>§ {sec.full}</span>
                        <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'IBM Plex Mono, monospace' }}>Jump →</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Contextual Clause Action Bar */}
                <div className="lex-section-ai-bar">
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', fontFamily: 'IBM Plex Mono, monospace' }}>
                    CLAUSE AI ACTIONS {selectedSection ? `(${selectedSection})` : ''}:
                  </span>
                  <button className="lex-clause-action-btn" onClick={() => handleClauseAction(selectedSection || 'Key Clauses', 'improve')}>✦ Improve</button>
                  <button className="lex-clause-action-btn" onClick={() => handleClauseAction(selectedSection || 'Key Clauses', 'stronger')}>✦ Legally Stronger</button>
                  <button className="lex-clause-action-btn" onClick={() => handleClauseAction(selectedSection || 'Key Clauses', 'simplify')}>✦ Simplify</button>
                  <button className="lex-clause-action-btn" onClick={() => handleClauseAction(selectedSection || 'Key Clauses', 'explain')}>✦ Explain</button>
                  <button className="lex-clause-action-btn" onClick={() => handleClauseAction(selectedSection || 'Key Clauses', 'protections')}>✦ Add Protections</button>
                </div>

                {/* Batch Placeholders Completion Panel */}
                {showCompletionPanel && missingPlaceholders.length > 0 && (
                  <div style={{ padding: '12px 16px', background: 'var(--major-soft)', borderBottom: '1px solid var(--rule)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--major)', fontFamily: 'IBM Plex Mono, monospace' }}>
                      Required Draft Details ({missingPlaceholders.length})
                    </div>
                    {missingPlaceholders.map((field, fi) => (
                      <div key={fi} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11.5, color: 'var(--ink)', width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{field}:</span>
                        <input
                          placeholder={`Enter ${field}`}
                          value={missingFieldInputs[field] || ''}
                          onChange={e => setMissingFieldInputs(prev => ({ ...prev, [field]: e.target.value }))}
                          style={{ flex: 1, padding: '5px 9px', borderRadius: 6, border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 11.5, outline: 'none' }}
                        />
                      </div>
                    ))}
                    <button
                      onClick={handleBatchFillPlaceholders}
                      className="btn btn-sm btn-primary"
                      style={{ alignSelf: 'flex-start', marginTop: 4 }}
                    >
                      Fill All in Draft
                    </button>
                  </div>
                )}

                {/* Persistent Amber Warning Bar */}
                <div className="draft-trust-bar">
                  <Icon name="caution" size={14} />
                  <span className="draft-trust-text">
                    <b>AI-drafted, not filed.</b> Review every bracketed field and clause against your matter facts before sending to a party or the court.
                  </span>
                </div>

                {/* Centered A4 Document Canvas */}
                <div className="lex-doc-canvas">
                  <div
                    ref={drawerBodyRef}
                    className="lex-doc-paper"
                    contentEditable
                    suppressContentEditableWarning
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
                </div>

                {/* Document Drawer Footer with Save Action */}
                <div style={{ padding: '10px 16px', borderTop: '1px solid var(--rule)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--paper)' }}>
                  <button
                    onClick={() => {
                      updateSession(currentId, s => ({ ...s, pendingDraft: null, activeDocument: null }));
                      setDrawerOpen(false);
                    }}
                    className="btn btn-sm"
                  >
                    Discard
                  </button>
                  <button
                    onClick={() => setShowSaveModal(true)}
                    className="btn btn-sm btn-primary"
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
          messages={messages}
          onConfirm={({ fileName, folderPath, vaultId }) => {
            const savedItem = { id: vaultId ?? `v_${Date.now()}`, name: fileName, path: folderPath };
            updateSession(currentId, s => ({
              ...s,
              savedAssets: [...(s.savedAssets || []), savedItem],
              pendingDraft: null,
              activeDocument: null,
            }));
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

      {/* Fixed-Position Three-Dot Conversation Menu */}
      {openMenuState && (
        <ConversationMenu
          session={openMenuState.session}
          x={openMenuState.x}
          y={openMenuState.y}
          onPin={() => { pinSession(openMenuState.id); setOpenMenuState(null); }}
          onRename={() => { setRenamingId(openMenuState.id); setRenameValue(openMenuState.session.title); setOpenMenuState(null); }}
          onShare={() => { setShareSessionId(openMenuState.id); setOpenMenuState(null); }}
          onDelete={() => { deleteSession(openMenuState.id); setOpenMenuState(null); }}
          onClose={() => setOpenMenuState(null)}
        />
      )}
    </>
  );

  // Helper renderer for each session card in the sidebar
  function renderSessionRow(s) {
    const isActive = s.id === currentId;
    const hasActiveDraft = s.activeDocument;
    const hasSavedAssets = s.savedAssets && s.savedAssets.length > 0;

    return (
      <div key={s.id}>
        <div
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
                style={{ width: '100%', fontSize: 11.5, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--accent)', background: 'var(--paper-2)', color: 'var(--ink)', outline: 'none' }}
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

          <div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (openMenuState?.id === s.id) {
                  setOpenMenuState(null);
                } else {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const bottomFlip = (window.innerHeight - rect.bottom) < 190;
                  setOpenMenuState({
                    id: s.id,
                    session: s,
                    x: Math.max(10, Math.min(rect.right - 140, window.innerWidth - 160)),
                    y: bottomFlip ? Math.max(10, rect.top - 155) : (rect.bottom + 4),
                  });
                }
              }}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '2px 4px', borderRadius: 4 }}
              title="Matter Options"
            >
              ⋮
            </button>
          </div>
        </div>

        {/* Nested Document Tree under Active Session */}
        {isActive && (hasActiveDraft || hasSavedAssets) && (
          <div className="lex-sidebar-tree">
            {hasActiveDraft && (
              <button
                className="lex-sidebar-tree-node"
                onClick={() => setDrawerOpen(true)}
                title="Open Active Draft"
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <Icon name="draft" size={11} style={{ color: 'var(--accent)' }} />
                  {s.activeDocument.title || 'Draft in Progress'}
                </span>
                <span style={{ fontSize: 9.5, color: 'var(--accent)', fontWeight: 600 }}>Open</span>
              </button>
            )}
            {hasSavedAssets && s.savedAssets.map((asset, ai) => (
              <button
                key={ai}
                className="lex-sidebar-tree-node"
                onClick={() => navigate('/vault')}
                title={`Saved to ${asset.path || 'Vault'}`}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <Icon name="folder" size={11} style={{ color: 'var(--accent)' }} />
                  {asset.name}
                </span>
                <span style={{ fontSize: 9, color: 'var(--accent)' }}>Vault</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
}

export default function LexCommandSuite() {
  return <CommandPalette />;
}
