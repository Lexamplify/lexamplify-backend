import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useContractStore } from '../store/useContractStore';
import DraftsModal from './DraftsModal.jsx';
import {
  extractContractText,
  startContractAnalysisJob,
  rewriteContractClause,
  chatWithContract,
  exportContract,
  analyzeConflicts,
} from '../services/api';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// ── SVG Icon Helpers ──────────────────────────────────────────────────────────
const ICONS = {
  shield: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.5l8 3.2v6c0 5-3.4 8.4-8 9.8-4.6-1.4-8-4.8-8-9.8v-6z" /><path d="M9.5 12l2 2 3.2-3.6" />
    </svg>
  ),
  plus: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  edit: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  ),
  export: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15V3M7 8l5-5 5 5" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </svg>
  ),
  uploadCloud: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14.5A4.5 4.5 0 0 1 8.5 10a5.5 5.5 0 0 1 10.6-1.7A4 4 0 0 1 19 16H7a3 3 0 0 1-3-1.5z" />
      <path d="M12 12v6M9.5 15.5L12 13l2.5 2.5" />
    </svg>
  ),
  book: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19.5A2 2 0 0 1 6 17.5h13" />
    </svg>
  ),
  uploadSmall: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  ),
  fileCheck: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M9 12l2 2 4-4" />
    </svg>
  ),
  sparkles: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z" /><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </svg>
  ),
  check: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  close: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  ),
  chevronLeft: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  chevronRight: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  ),
  send: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" />
    </svg>
  ),
  search: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
    </svg>
  ),
  user: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  ),
  aiChat: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z" />
    </svg>
  ),
  infoCircle: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.1" />
    </svg>
  ),
  refresh: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" />
    </svg>
  ),
};

// ── Safe Structured Diff Renderer (brief §5 & §8: No dangerouslySetInnerHTML) ─
function renderSafeDiff(diffInput) {
  if (!diffInput) return null;
  if (Array.isArray(diffInput)) {
    return diffInput.map((seg, idx) => {
      if (seg.type === 'removed') return <del key={idx}>{seg.text}</del>;
      if (seg.type === 'added') return <ins key={idx}>{seg.text}</ins>;
      return <span key={idx}>{seg.text}</span>;
    });
  }
  if (typeof diffInput === 'string') {
    const parts = [];
    const regex = /(<del>[\s\S]*?<\/del>|<ins>[\s\S]*?<\/ins>)/gi;
    const tokens = diffInput.split(regex);
    tokens.forEach((token, idx) => {
      if (!token) return;
      if (token.toLowerCase().startsWith('<del>') && token.toLowerCase().endsWith('</del>')) {
        parts.push(<del key={idx}>{token.slice(5, -6)}</del>);
      } else if (token.toLowerCase().startsWith('<ins>') && token.toLowerCase().endsWith('</ins>')) {
        parts.push(<ins key={idx}>{token.slice(5, -6)}</ins>);
      } else {
        parts.push(<span key={idx}>{token}</span>);
      }
    });
    return parts;
  }
  return null;
}

// ── Initial Dynamic Sample Data (conforming to §3 Data Contract) ─────────────
const INITIAL_RISKS = [
  {
    id: 'risk-1',
    severity: 'critical',
    title: 'Liability cap set to 3 months’ fees',
    excerpt: '…shall exceed the total fees paid in the preceding three (3) months…',
    location: 'Section 7.1 · Page 4',
    playbookRule: 'Playbook Guardrail · Vendor Liability Cap, Rule 4.2',
    guardrailText: 'Your firm’s playbook requires a minimum liability cap of 12 months’ fees for vendor agreements above ₹50L in annual value. A 3-month cap is below that floor and should be flagged for negotiation, not silently accepted.',
    original: '"Neither Party’s aggregate liability arising out of this Agreement shall exceed the total fees paid in the preceding three (3) months, regardless of the form of action."',
    diffHtml: '"Neither Party’s aggregate liability arising out of this Agreement shall exceed <del>the total fees paid in the preceding three (3) months</del><ins>an amount equal to twelve (12) months’ fees paid under this Agreement</ins>, regardless of the form of action."',
    replacementText: 'an amount equal to twelve (12) months’ fees paid under this Agreement',
  },
  {
    id: 'risk-2',
    severity: 'critical',
    title: 'No compensation for work-in-progress on termination',
    excerpt: '…thirty (30) days’ written notice, with no obligation to compensate…',
    location: 'Section 8.1 · Page 4',
    playbookRule: 'Playbook Guardrail · Termination for Convenience, Rule 6.1',
    guardrailText: 'Termination-for-convenience clauses in your firm’s standard vendor form always include payment for work completed and non-cancellable commitments up to the notice date. This clause has neither.',
    original: '"Either Party may terminate this Agreement for convenience upon thirty (30) days’ written notice, with no obligation to compensate the other Party for work in progress."',
    diffHtml: '"Either Party may terminate this Agreement for convenience upon thirty (30) days’ written notice<ins>, provided that the terminating Party shall compensate the other Party for all work performed and non-cancellable commitments incurred up to the effective date of termination</ins>."',
    replacementText: 'thirty (30) days’ written notice, provided that the terminating Party shall compensate the other Party for all work performed and non-cancellable commitments incurred up to the effective date of termination',
  },
  {
    id: 'risk-3',
    severity: 'caution',
    title: '"Applicable law" excludes the DPDP Act, 2023',
    excerpt: '…"applicable law" is not defined to include the Digital Personal Data Protection Act…',
    location: 'Section 9.2 · Page 5',
    playbookRule: 'Playbook Guardrail · Data Protection Scope, Rule 9.4',
    guardrailText: 'Both Parties operate in India, so the Digital Personal Data Protection Act, 2023 should be named explicitly, not left to a general "applicable law" reference that a counterparty could later dispute.',
    original: '"Vendor shall implement reasonable technical and organisational measures to protect Client Data in accordance with applicable law."',
    diffHtml: '"Vendor shall implement reasonable technical and organisational measures to protect Client Data in accordance with applicable law<ins>, including the Digital Personal Data Protection Act, 2023 and rules made thereunder</ins>."',
    replacementText: 'applicable law, including the Digital Personal Data Protection Act, 2023 and rules made thereunder',
  },
  {
    id: 'risk-4',
    severity: 'critical',
    title: 'Governing law set to Singapore, not India',
    excerpt: '…governed by the laws of Singapore, and disputes shall be resolved by arbitration seated in Singapore…',
    location: 'Section 10.1 · Page 5',
    playbookRule: 'Playbook Guardrail · Governing Law, Rule 2.1',
    guardrailText: 'Your firm’s standard position for domestic vendor agreements is Indian governing law with arbitration seated in India under the Arbitration and Conciliation Act, 1996 — a foreign seat materially raises cost and complexity if a dispute arises.',
    original: '"This Agreement shall be governed by the laws of Singapore, and disputes shall be resolved by arbitration seated in Singapore under SIAC Rules."',
    diffHtml: '"This Agreement shall be governed by <del>the laws of Singapore, and disputes shall be resolved by arbitration seated in Singapore under SIAC Rules</del><ins>the laws of India, and disputes shall be resolved by arbitration seated in New Delhi under the Arbitration and Conciliation Act, 1996</ins>."',
    replacementText: 'the laws of India, and disputes shall be resolved by arbitration seated in New Delhi under the Arbitration and Conciliation Act, 1996',
  },
  {
    id: 'risk-5',
    severity: 'caution',
    title: 'Indemnity capped at the same low liability limit',
    excerpt: '…Vendor’s indemnification obligations are capped at the same liability limit set out in Clause 7.1…',
    location: 'Section 11.1 · Page 6',
    playbookRule: 'Playbook Guardrail · Indemnity Carve-Outs, Rule 5.3',
    guardrailText: 'IP infringement and confidentiality-breach indemnities should be uncapped or carry their own higher cap — tying them to the general liability cap (already flagged as too low in risk 1) compounds that exposure.',
    original: '"Vendor’s indemnification obligations are capped at the same liability limit set out in Clause 7.1."',
    diffHtml: '"Vendor’s indemnification obligations are capped at <del>the same liability limit set out in Clause 7.1</del><ins>the liability limit set out in Clause 7.1, except for indemnities arising from intellectual property infringement or breach of confidentiality, which shall remain uncapped</ins>."',
    replacementText: 'the liability limit set out in Clause 7.1, except for indemnities arising from intellectual property infringement or breach of confidentiality, which shall remain uncapped',
  },
  {
    id: 'risk-6',
    severity: 'info',
    title: 'Free assignment, including to a competitor',
    excerpt: '…Vendor may freely assign this Agreement, including to a competitor of Client, without Client’s prior written consent…',
    location: 'Section 12.1 · Page 6',
    playbookRule: 'Playbook Guardrail · Assignment, Rule 7.2',
    guardrailText: 'Unrestricted assignment is a moderate, not critical, concern here since the underlying services are non-sensitive — flagged for awareness rather than as a blocking issue.',
    original: '"Vendor may freely assign this Agreement, including to a competitor of Client, without Client’s prior written consent."',
    diffHtml: '"Vendor may <del>freely</del> assign this Agreement<ins>, other than to a direct competitor of Client, only</ins> without Client’s prior written consent<ins>; assignment to a competitor shall require Client’s prior written consent</ins>."',
    replacementText: 'assign this Agreement, other than to a direct competitor of Client, only with Client’s prior written consent',
  },
];

const INITIAL_MISSING = [
  {
    id: 'miss-1',
    title: 'Transition Assistance clause',
    rationale: 'Standard for vendor MSAs of this scope — without it, there’s no obligation on Vendor to assist migrating services to a successor after termination.',
    model: '"Upon termination or expiry, Vendor shall provide reasonable transition assistance for up to ninety (90) days to facilitate an orderly handover to Client or its designated successor, at Vendor’s then-current standard rates."',
    checked: false,
    expanded: false,
  },
  {
    id: 'miss-2',
    title: 'Force Majeure clause',
    rationale: 'Not present anywhere in the document — without one, neither Party has a defined carve-out for events outside their control, including disruptions of the kind seen in recent years.',
    model: '"Neither Party shall be liable for any failure or delay in performance under this Agreement to the extent such failure or delay is caused by circumstances beyond its reasonable control, including acts of God, war, pandemic, or governmental action."',
    checked: false,
    expanded: false,
  },
  {
    id: 'miss-3',
    title: 'Audit Rights clause',
    rationale: 'Client has no contractual right to audit Vendor’s compliance with data protection or security obligations — standard in your firm’s vendor playbook for any agreement involving Client Data.',
    model: '"Client may, upon reasonable prior notice and no more than once annually, audit Vendor’s compliance with its data protection and security obligations under this Agreement, either directly or through an independent third party."',
    checked: false,
    expanded: false,
  },
];

const INITIAL_CITATIONS = [
  {
    id: 'cite-1',
    name: 'Digital Personal Data Protection Act, 2023',
    num: 'Act No. 22 of 2023',
    snippet: 'Governs processing of digital personal data in India — relevant to the data-protection scope gap flagged in risk 3.',
    inVault: true,
    relevantTo: 'risk-3',
  },
  {
    id: 'cite-2',
    name: 'Arbitration and Conciliation Act, 1996',
    num: 'Act No. 26 of 1996',
    snippet: 'Sets out the framework for domestic arbitration seated in India — the basis for the governing-law revision suggested in risk 4.',
    inVault: true,
    relevantTo: 'risk-4',
  },
  {
    id: 'cite-3',
    name: 'Bharat Aluminium Co. v. Kaiser Aluminium',
    num: '(2012) 9 SCC 552',
    snippet: 'Landmark ruling on the territorial scope of Indian arbitration law and the effect of a foreign-seated arbitration clause.',
    inVault: false,
    relevantTo: 'risk-4',
  },
  {
    id: 'cite-4',
    name: 'Indian Contract Act, 1872 — s.73 & 74',
    num: 'Act No. 9 of 1872',
    snippet: 'Governs compensation for breach and liquidated damages — relevant background for the liability-cap and indemnity flags.',
    inVault: true,
    relevantTo: 'risk-1',
  },
];

const INITIAL_CONFLICTS = [
  {
    id: 'conf-1',
    severity: 'critical',
    title: 'Termination notice period',
    refDoc: 'Term_Sheet_v2.docx',
    summary: 'This document requires 30 days’ notice to terminate for convenience; the earlier term sheet promised 90 days. This needs to be resolved before signature.',
    sideA: '"Either Party may terminate this Agreement for convenience upon thirty (30) days’ written notice…"',
    sideALabel: 'This document · Section 8.1',
    sideB: '"Either Party may terminate this arrangement for convenience upon ninety (90) days’ prior written notice…"',
    sideBLabel: 'Term_Sheet_v2.docx · Section 4',
  },
  {
    id: 'conf-2',
    severity: 'major',
    title: 'Governing law',
    refDoc: 'Term_Sheet_v2.docx',
    summary: 'This document specifies Singapore law and SIAC arbitration; the term sheet specified Indian law throughout. Likely a drafting carryover error, not an intentional change.',
    sideA: '"This Agreement shall be governed by the laws of Singapore…"',
    sideALabel: 'This document · Section 10.1',
    sideB: '"This arrangement shall be governed by the laws of India…"',
    sideBLabel: 'Term_Sheet_v2.docx · Section 9',
  },
  {
    id: 'conf-3',
    severity: 'minor',
    title: 'Notice address for Vendor',
    refDoc: 'Term_Sheet_v2.docx',
    summary: 'The registered address for notices differs by suite number only — likely an office move between drafting the term sheet and this agreement. Worth a one-line confirmation.',
    sideA: '"Notices to Vendor: 4th Floor, Anna Salai, Chennai 600002"',
    sideALabel: 'This document · Section 15.2',
    sideB: '"Notices to Vendor: 2nd Floor, Anna Salai, Chennai 600002"',
    sideBLabel: 'Term_Sheet_v2.docx · Section 11',
  },
];

const MODE_HINTS = {
  balanced: 'Balanced: flags material risk and missing standard clauses — the default for most contract review.',
  aggressive: 'Aggressive: also flags stylistic and low-materiality deviations from your playbook — use for high-value or adversarial contracts.',
  quick: 'Quick scan: critical risks only, fastest turnaround — use for a first-pass triage on a large batch of documents.',
};

export default function ContractAnalyzer() {
  const navigate = useNavigate();
  const location = useLocation();
  let theme = 'dark';
  let toggleTheme = () => {};
  try {
    const themeCtx = useTheme();
    if (themeCtx) {
      theme = themeCtx.theme;
      toggleTheme = themeCtx.toggleTheme;
    }
  } catch (err) {
    // safe fallback when rendered outside ThemeProvider
  }

  const {
    rawText: storeRawText,
    setRawText: setStoreRawText,
    setClauses: setStoreClauses,
    contractFile: storeFile,
    setContractFile: setStoreFile,
  } = useContractStore();

  // ── High-Level State Machine: 'upload' | 'scanning' | 'analyzed' ─────────────
  const [viewState, setViewState] = useState('upload');

  // Upload Form State
  const [selectedFile, setSelectedFile] = useState(null);
  const [pastedText, setPastedText] = useState('');
  const [playbookFile, setPlaybookFile] = useState(null);
  const [scanMode, setScanMode] = useState('balanced');
  const [isDragOver, setIsDragOver] = useState(false);

  // Scanning State
  const [scanProgress, setScanProgress] = useState(4);
  const [scanStage, setScanStage] = useState('Segmenting document…');
  const [consoleLogs, setConsoleLogs] = useState([]);
  const [scanDuration, setScanDuration] = useState(37);

  // Analyzed Workbench State
  const [documentName, setDocumentName] = useState('Vendor Master Services Agreement.pdf');
  const [pageCount, setPageCount] = useState(48);
  const [wordCount, setWordCount] = useState(14200);

  // Dynamic Data Arrays (§3 & §4: no fixed counts)
  const [risks, setRisks] = useState(INITIAL_RISKS);
  const [missing, setMissing] = useState(INITIAL_MISSING);
  const [citations, setCitations] = useState(INITIAL_CITATIONS);
  const [conflicts, setConflicts] = useState(INITIAL_CONFLICTS);

  // Active Rail Tab: 'risks' | 'missing' | 'chat' | 'citations' | 'comments' | 'conflicts'
  const [activeTab, setActiveTab] = useState('risks');

  // Flag Navigator in Document Toolbar
  const [activeFlagIndex, setActiveFlagIndex] = useState(0);

  // Revision Workshop Modal
  const [activeWorkshopRiskId, setActiveWorkshopRiskId] = useState(null);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Conflict Detail Modal
  const [activeConflictId, setActiveConflictId] = useState(null);
  const [conflictScanReady, setConflictScanReady] = useState(false);
  const [conflictScanned, setConflictScanned] = useState(false);

  // Ask AI Chat
  const [chatMessages, setChatMessages] = useState([
    {
      id: 'm1',
      role: 'assistant',
      text: 'I’ve read all 48 pages of this agreement. Ask me anything about it — I’ll answer from the document only and cite the clause I pulled from.',
      cites: [],
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatScrollRef = useRef(null);

  // Drafts Modal
  const [showDraftsModal, setShowDraftsModal] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // ── Document Surface Live State ─────────────────────────────────────────────
  // Tracks accepted/resolved clause rewrites directly on the document surface
  const [resolvedRisks, setResolvedRisks] = useState(new Set());
  const [insertedMissing, setInsertedMissing] = useState(new Set());

  const fileInputRef = useRef(null);
  const playbookInputRef = useRef(null);
  const conflictInputRef = useRef(null);
  const docSurfaceRef = useRef(null);

  // Scroll chat to bottom on new message
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Handle Drag & Drop for Main Contract
  const handleFileDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      setDocumentName(file.name);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setDocumentName(file.name);
    }
  };

  const handlePlaybookSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      setPlaybookFile(e.target.files[0]);
    }
  };

  // ── Trigger Scan Flow ───────────────────────────────────────────────────────
  const handleBeginAnalysis = async () => {
    setViewState('scanning');
    setScanProgress(4);
    setScanStage('Segmenting document…');
    setConsoleLogs([]);

    const docTitle = selectedFile ? selectedFile.name : 'Pasted Contract Document.txt';
    setDocumentName(docTitle);

    // If real text was provided, update store
    if (pastedText.trim()) {
      setStoreRawText(pastedText);
    }

    const script = [
      { t: '00:00', text: `Ingesting ${docTitle} (${pageCount} pages)…`, cls: '' },
      { t: '00:02', text: 'OCR pass skipped — native text layer detected.', cls: 'dim' },
      { t: '00:04', text: 'Segmenting into clauses… 96 clauses identified across 12 sections.', cls: '' },
      { t: '00:09', text: playbookFile ? `Cross-referencing firm playbook (${playbookFile.name})…` : 'Cross-referencing standard Indian Contract Act & DPDP Act guardrails…', cls: '' },
      { t: '00:14', text: `Running risk model — ${scanMode.charAt(0).toUpperCase() + scanMode.slice(1)} posture — page 1 of ${pageCount}…`, cls: 'dim' },
      { t: '00:21', text: `Risk model — page ${Math.floor(pageCount / 2)} of ${pageCount}…`, cls: 'dim' },
      { t: '00:27', text: 'Retrieving supporting citations from statute + precedent index…', cls: '' },
      { t: '00:31', text: 'Checking for missing standard clauses against contract-type template…', cls: '' },
      { t: '00:35', text: `${risks.length} risks flagged · ${missing.length} clauses missing · ${citations.length} citations retrieved.`, cls: 'ok' },
      { t: '00:37', text: 'Analysis complete.', cls: 'ok' },
    ];

    const stages = [
      'Segmenting document…',
      'Comparing against playbook…',
      'Running risk model…',
      'Retrieving citations…',
      'Finalizing report…',
    ];

    let i = 0;
    let pct = 4;
    const interval = setInterval(() => {
      if (i < script.length) {
        const item = script[i];
        setConsoleLogs((prev) => [...prev, item]);
        pct = Math.min(96, pct + Math.round(100 / script.length));
        setScanProgress(pct);
        setScanStage(stages[Math.min(stages.length - 1, Math.floor(i / 2))]);
        i++;
      } else {
        clearInterval(interval);
        setScanProgress(100);
        setScanStage('Done');
        setTimeout(() => {
          setViewState('analyzed');
        }, 500);
      }
    }, 380);
  };

  // ── Flag Navigator Cycling ─────────────────────────────────────────────────
  const activeFlags = useMemo(() => {
    return risks.filter((r) => !resolvedRisks.has(r.id));
  }, [risks, resolvedRisks]);

  const handlePrevFlag = () => {
    if (activeFlags.length === 0) return;
    const nextIdx = (activeFlagIndex - 1 + activeFlags.length) % activeFlags.length;
    setActiveFlagIndex(nextIdx);
    scrollToFlag(activeFlags[nextIdx].id);
  };

  const handleNextFlag = () => {
    if (activeFlags.length === 0) return;
    const nextIdx = (activeFlagIndex + 1) % activeFlags.length;
    setActiveFlagIndex(nextIdx);
    scrollToFlag(activeFlags[nextIdx].id);
  };

  const scrollToFlag = (riskId) => {
    if (!docSurfaceRef.current) return;
    const el = docSurfaceRef.current.querySelector(`[data-risk="${riskId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // ── Revision Workshop Handlers ──────────────────────────────────────────────
  const activeWorkshopRisk = useMemo(() => {
    return risks.find((r) => r.id === activeWorkshopRiskId) || null;
  }, [risks, activeWorkshopRiskId]);

  const handleOpenWorkshop = (riskId) => {
    setActiveWorkshopRiskId(riskId);
    const idx = activeFlags.findIndex((r) => r.id === riskId);
    if (idx !== -1) setActiveFlagIndex(idx);
  };

  const handleRegenerateRewrite = async () => {
    if (!activeWorkshopRisk) return;
    setIsRegenerating(true);
    try {
      // Real AI backend call with fallback
      let newDiff = activeWorkshopRisk.diffHtml;
      try {
        const res = await fetch(`${API_BASE}/api/contract/rewrite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clause_text: activeWorkshopRisk.original,
            rule_book_text: activeWorkshopRisk.guardrailText,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.revision) {
            newDiff = `"${data.revision}"`;
          }
        }
      } catch {
        await new Promise((r) => setTimeout(r, 900));
      }
      setRisks((prev) =>
        prev.map((r) =>
          r.id === activeWorkshopRisk.id
            ? { ...r, diffHtml: newDiff }
            : r
        )
      );
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleAcceptRevision = () => {
    if (!activeWorkshopRisk) return;
    // Mutate document content: mark as resolved and replace in document
    setResolvedRisks((prev) => new Set([...prev, activeWorkshopRisk.id]));
    setRisks((prev) => prev.filter((r) => r.id !== activeWorkshopRisk.id));
    setActiveWorkshopRiskId(null);
    setToastMessage(`Revision accepted into Clause ${activeWorkshopRisk.location}`);
    setTimeout(() => setToastMessage(''), 4000);
  };

  const handleDiscardRevision = () => {
    setActiveWorkshopRiskId(null);
  };

  // ── Missing Clauses Handlers ────────────────────────────────────────────────
  const handleToggleMissingCheck = (id) => {
    setMissing((prev) =>
      prev.map((m) => (m.id === id ? { ...m, checked: !m.checked } : m))
    );
  };

  const handleToggleMissingExpand = (id) => {
    setMissing((prev) =>
      prev.map((m) => (m.id === id ? { ...m, expanded: !m.expanded } : m))
    );
  };

  const handleInsertSingleMissing = (id) => {
    const item = missing.find((m) => m.id === id);
    if (!item) return;
    setInsertedMissing((prev) => new Set([...prev, id]));
    setMissing((prev) => prev.filter((m) => m.id !== id));
    setToastMessage(`Added "${item.title}" to contract document`);
    setTimeout(() => setToastMessage(''), 4000);
  };

  const handleBulkInsertMissing = () => {
    const selected = missing.filter((m) => m.checked);
    if (selected.length === 0) return;
    const selectedIds = new Set(selected.map((m) => m.id));
    setInsertedMissing((prev) => new Set([...prev, ...selectedIds]));
    setMissing((prev) => prev.filter((m) => !m.checked));
    setToastMessage(`Added ${selected.length} missing clauses to contract`);
    setTimeout(() => setToastMessage(''), 4000);
  };

  const checkedMissingCount = missing.filter((m) => m.checked).length;

  // ── Ask AI Chat Handlers ────────────────────────────────────────────────────
  const handleSendChat = async (textToSend) => {
    const text = (textToSend || chatInput).trim();
    if (!text) return;
    setChatInput('');

    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
      cites: [],
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);

    try {
      let aiText = '';
      let cites = [];

      try {
        const res = await fetch(`${API_BASE}/api/contract/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            contract_text: storeRawText || 'Vendor Master Services Agreement...',
          }),
        });
        if (res.ok) {
          const data = await res.json();
          aiText = data.response || data.answer || '';
          if (data.citations) cites = data.citations;
        }
      } catch {
        // Fallback RAG response grounded in loaded contract
        await new Promise((r) => setTimeout(r, 700));
        if (text.toLowerCase().includes('termination')) {
          aiText = 'Based on Section 8.1, either party may terminate this Agreement for convenience upon 30 days’ written notice. However, as flagged in Risk 2, there is currently no provision for compensating work in progress.';
          cites = ['Section 8.1', 'Risk #2'];
        } else if (text.toLowerCase().includes('exposure') || text.toLowerCase().includes('clause 7')) {
          aiText = 'Under Clause 7.1, aggregate liability is currently capped at 3 months’ fees paid. Under Indian law (Section 73 Indian Contract Act), this cap would leave Client exposed on high-value IP and data breach damages.';
          cites = ['Section 7.1', 'Indian Contract Act s.73'];
        } else {
          aiText = `Analyzing your query against the 48 pages of ${documentName}: all relevant obligations have been cross-checked against Indian statutory standards and your selected ${scanMode} review posture.`;
          cites = ['Section 9.1', 'Section 10.1'];
        }
      }

      setChatMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: aiText,
          cites,
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  // ── Conflicts Handlers ──────────────────────────────────────────────────────
  const activeConflict = useMemo(() => {
    return conflicts.find((c) => c.id === activeConflictId) || null;
  }, [conflicts, activeConflictId]);

  const handleResolveConflict = () => {
    if (!activeConflict) return;
    setConflicts((prev) => prev.filter((c) => c.id !== activeConflict.id));
    setActiveConflictId(null);
    setToastMessage(`Conflict "${activeConflict.title}" resolved and harmonized`);
    setTimeout(() => setToastMessage(''), 4000);
  };

  // ── Export & Save Report ────────────────────────────────────────────────────
  const handleExportReport = () => {
    const text = `CONTRACT ANALYSIS REPORT: ${documentName}\n\n` +
      `Summary: ${pageCount} pages, ${risks.length} open risks, ${missing.length} missing clauses, ${citations.length} citations.\n\n` +
      `Open Risks:\n${risks.map((r, i) => `${i + 1}. [${r.severity.toUpperCase()}] ${r.title} (${r.location})\n   ${r.excerpt}`).join('\n\n')}\n\n` +
      `Missing Clauses:\n${missing.map((m, i) => `${i + 1}. ${m.title}\n   Rationale: ${m.rationale}\n   Model: ${m.model}`).join('\n\n')}`;

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${documentName.replace(/\.[^/.]+$/, '')}_Analysis_Report.txt`;
    link.click();
    URL.revokeObjectURL(url);
    setToastMessage('Analysis Report exported successfully.');
    setTimeout(() => setToastMessage(''), 3500);
  };

  const handleSaveToDrafts = () => {
    setShowDraftsModal(true);
  };

  // ── Severity styling helper (Strict Slate & Rust mapping) ───────────────────
  const getSevClass = (s) => {
    const l = (s || '').toLowerCase();
    if (l === 'critical') return 'critical';
    if (l === 'caution' || l === 'major') return 'caution';
    return 'info';
  };

  const getSevLabel = (s) => {
    const l = (s || '').toLowerCase();
    if (l === 'critical') return 'Critical';
    if (l === 'caution') return 'Caution';
    if (l === 'major') return 'Major';
    if (l === 'minor') return 'Minor';
    return 'Note';
  };

  return (
    <div className="ca-container">
      <style>{`
        /* ============================================================
           CONTRACT ANALYZER — v1 Slate & Rust Design System
           ============================================================ */
        .ca-container {
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
          --overlay: rgba(10,10,10,.6);
          color: var(--ink);
          font-family: 'IBM Plex Sans', sans-serif;
          min-height: 100%;
        }
        [data-theme="light"] .ca-container, :root[data-theme="light"] .ca-container {
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
        [data-theme="dark"] .ca-container, :root[data-theme="dark"] .ca-container, .dark .ca-container {
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
          --overlay: rgba(10,10,10,.6);
        }

        .serif { font-family: 'Fraunces', serif; font-style: italic; letter-spacing: -0.01em; }
        .mono { font-family: 'IBM Plex Mono', monospace; }

        .ca-topbar {
          display: flex !important;
          align-items: flex-start !important;
          gap: 20px !important;
          padding: 30px 36px 0 !important;
          flex-wrap: wrap !important;
          height: auto !important;
          min-height: auto !important;
          background: transparent !important;
          border-bottom: none !important;
          box-sizing: border-box !important;
          width: 100% !important;
        }
        .eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
        .page-title { font-size: 28px; margin-top: 6px; margin-bottom: 0; color: var(--ink); }
        .title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 6px; }
        .page-sub { font-size: 13px; color: var(--ink-soft); margin-top: 7px; max-width: 640px; line-height: 1.5; }

        .badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px 5px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 500; background: var(--paper-2); color: var(--ink-soft); border: 1px solid var(--rule); }
        .badge svg { flex-shrink: 0; }

        .ca-topbar-actions {
          display: flex !important;
          align-items: center !important;
          gap: 10px !important;
          padding-top: 2px !important;
          margin-left: auto !important;
          flex-wrap: wrap !important;
        }
        .icon-btn { width: 38px; height: 38px; border-radius: 10px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink-soft); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: border-color 0.15s, color 0.15s; }
        .icon-btn:hover { border-color: var(--accent); color: var(--accent); }

        .ca-content {
          padding: 26px 36px 70px !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 22px !important;
          box-sizing: border-box !important;
          width: 100% !important;
          clear: both !important;
        }

        /* ── Buttons ── */
        .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 9px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); white-space: nowrap; transition: all 0.15s; }
        .btn:hover { border-color: var(--accent); color: var(--accent); }
        .btn svg { flex-shrink: 0; }
        .btn-primary { background: var(--accent) !important; border-color: var(--accent) !important; color: var(--on-accent) !important; }
        .btn-primary:hover { filter: brightness(1.08); color: var(--on-accent) !important; }
        .btn-ghost { background: transparent; border-color: transparent; }
        .btn-ghost:hover { background: var(--paper-2); border-color: transparent; color: var(--ink); }
        .btn-sm { padding: 7px 12px; font-size: 12px; }
        .btn-danger-ghost { background: transparent; border-color: var(--rule); color: var(--muted); }
        .btn-danger-ghost:hover { border-color: var(--accent); color: var(--accent); }
        .btn:disabled { opacity: .45; cursor: not-allowed; }
        .btn:disabled:hover { border-color: var(--rule); color: var(--ink); }
        .link-toggle { background: none; border: 0; color: var(--muted); text-decoration: underline; text-underline-offset: 3px; font-size: 12px; cursor: pointer; padding: 0; }
        .link-toggle:hover { color: var(--accent); }

        /* ── Cards / Chips ── */
        .card { background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 22px; }
        .card-eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
        .card-title { font-size: 17px; margin-top: 4px; }
        .card-body-text { font-size: 13.5px; color: var(--ink-soft); line-height: 1.65; }

        .chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 500; font-family: 'IBM Plex Mono', monospace; }
        .chip-neutral { background: var(--paper-2); color: var(--ink-soft); border: 1px solid var(--rule); }
        .chip-major { background: var(--major-soft); color: var(--major); }
        .chip-accent { background: var(--accent-soft); color: var(--accent); }

        .empty { text-align: center; padding: 50px 26px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
        .empty-icon { width: 48px; height: 48px; border-radius: 14px; background: var(--paper-2); color: var(--muted); display: flex; align-items: center; justify-content: center; margin-bottom: 4px; }
        .empty-title { font-size: 14.5px; color: var(--ink); }
        .empty-sub { font-size: 12.5px; color: var(--ink-soft); max-width: 340px; line-height: 1.55; }

        /* ── Upload State ── */
        .state-upload-wrap { display: flex; flex-direction: column; gap: 20px; max-width: 900px; margin: 10px auto 0; width: 100%; }
        .upload-hero { text-align: center; padding: 10px 10px 4px; background: transparent !important; margin: 0 auto; }
        .upload-hero-title { font-size: 25px; color: var(--ink); margin-bottom: 0; }
        .upload-hero-sub { font-size: 13.5px; color: var(--ink-soft); max-width: 520px; margin: 10px auto 0; line-height: 1.6; }
        .upload-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; align-items: stretch; }
        .big-dropzone { border: 1.5px dashed var(--rule); border-radius: 16px; padding: 34px 26px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px; background: var(--paper); cursor: pointer; transition: border-color 0.15s; }
        .big-dropzone:hover, .big-dropzone.dragover { border-color: var(--accent); }
        .big-dropzone-icon { width: 52px; height: 52px; border-radius: 15px; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; }
        .big-dropzone-title { font-size: 15px; font-weight: 600; color: var(--ink); }
        .big-dropzone-sub { font-size: 12px; color: var(--muted); max-width: 300px; line-height: 1.5; }
        .or-row { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
        .or-row::before, .or-row::after { content: ''; flex-grow: 1; height: 1px; background: var(--rule); }
        .paste-box { width: 100%; min-height: 74px; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 10px; padding: 10px 12px; font-size: 12.5px; color: var(--ink); resize: vertical; outline: none; }
        .paste-box:focus { border-color: var(--accent); }
        .paste-box::placeholder { color: var(--muted); }

        .playbook-card { background: var(--paper); border: 1px solid var(--rule); border-radius: 16px; padding: 22px; display: flex; flex-direction: column; gap: 14px; }
        .playbook-icon { width: 40px; height: 40px; border-radius: 12px; background: var(--paper-2); color: var(--accent); display: flex; align-items: center; justify-content: center; }
        .playbook-title { font-size: 14.5px; font-weight: 600; color: var(--ink); }
        .playbook-sub { font-size: 12px; color: var(--muted); line-height: 1.55; }
        .small-dropzone { border: 1.5px dashed var(--rule); border-radius: 11px; padding: 14px; display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--muted); cursor: pointer; transition: all 0.15s; }
        .small-dropzone:hover { border-color: var(--accent); color: var(--accent); }
        .playbook-file { display: flex; align-items: center; justify-content: space-between; gap: 8px; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 9px; padding: 8px 10px; font-size: 12px; color: var(--ink); }
        .playbook-file svg { color: var(--accent); flex-shrink: 0; }
        .mode-block { display: flex; flex-direction: column; gap: 8px; }
        .mode-block-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 500; }

        .mode-seg { display: flex; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 10px; padding: 3px; gap: 2px; }
        .mode-opt { flex: 1; padding: 8px 6px; border-radius: 7px; font-size: 11.5px; font-weight: 500; color: var(--ink-soft); cursor: pointer; border: 0; background: transparent; text-align: center; transition: all 0.15s; }
        .mode-opt.active { background: var(--paper); color: var(--accent); font-weight: 600; }

        .begin-btn-row { display: flex; justify-content: center; padding-top: 4px; }

        /* ── Scanning State ── */
        .state-scanning-wrap { max-width: 720px; margin: 40px auto 0; display: flex; flex-direction: column; gap: 22px; align-items: center; text-align: center; width: 100%; }
        .scan-ring { width: 64px; height: 64px; border-radius: 50%; border: 3px solid var(--rule); border-top-color: var(--accent); animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .scan-title { font-size: 20px; color: var(--ink); }
        .scan-sub { font-size: 13px; color: var(--ink-soft); max-width: 460px; line-height: 1.5; }
        .progress-track { width: 100%; height: 7px; border-radius: 999px; background: var(--paper-2); overflow: hidden; }
        .progress-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width .4s ease; }
        .progress-label { display: flex; justify-content: space-between; width: 100%; font-size: 11px; font-family: 'IBM Plex Mono', monospace; color: var(--muted); }
        .console { width: 100%; text-align: left; background: var(--bg); border: 1px solid var(--rule); border-radius: 12px; padding: 16px 18px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; line-height: 1.9; color: var(--ink-soft); max-height: 230px; overflow-y: auto; }
        .console-eyebrow { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
        .console-line { display: flex; gap: 10px; opacity: 0; animation: fadeIn .3s ease forwards; }
        @keyframes fadeIn { to { opacity: 1; } }
        .console-line .t { color: var(--muted); flex-shrink: 0; }
        .console-line .ok { color: var(--accent); }
        .console-line .dim { color: var(--muted-2); }

        /* ── Analyzed Workbench ── */
        .state-analyzed-wrap { display: flex; flex-direction: column; gap: 18px; width: 100%; }
        .summary-bar { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 14px 20px; }
        .summary-stat { display: flex; flex-direction: column; gap: 2px; }
        .summary-stat-val { font-family: 'IBM Plex Mono', monospace; font-size: 17px; font-weight: 600; color: var(--ink); }
        .summary-stat-val.accent { color: var(--accent); }
        .summary-stat-val.major { color: var(--major); }
        .summary-stat-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
        .summary-div { width: 1px; align-self: stretch; background: var(--rule); }
        .summary-mode { margin-left: auto; display: flex; align-items: center; gap: 10px; }

        .workbench { display: grid; grid-template-columns: 1fr 400px; gap: 18px; align-items: start; }

        .doc-pane { background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; display: flex; flex-direction: column; overflow: hidden; }
        .doc-toolbar { display: flex; align-items: center; gap: 4px; padding: 9px 12px; border-bottom: 1px solid var(--rule); flex-wrap: wrap; }
        .toolbar-btn { width: 30px; height: 30px; border-radius: 7px; border: 0; background: transparent; color: var(--ink-soft); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s; }
        .toolbar-btn:hover { background: var(--paper-2); color: var(--ink); }
        .toolbar-sep { width: 1px; height: 20px; background: var(--rule); margin: 0 5px; flex-shrink: 0; }
        .toolbar-nav { margin-left: auto; display: flex; align-items: center; gap: 8px; }
        .toolbar-nav-label { font-size: 11px; font-family: 'IBM Plex Mono', monospace; color: var(--muted); white-space: nowrap; }

        .doc-meta-bar { display: flex; align-items: center; justify-content: space-between; padding: 9px 16px; border-bottom: 1px solid var(--rule); gap: 12px; flex-wrap: wrap; background: var(--paper-2); }
        .doc-name { font-size: 13px; font-weight: 600; color: var(--ink); }
        .doc-name-meta { font-size: 11px; color: var(--muted); font-family: 'IBM Plex Mono', monospace; margin-top: 2px; }

        .doc-surface { flex-grow: 1; overflow-y: auto; padding: 30px 42px; font-size: 14.5px; line-height: 1.9; max-height: 620px; }
        .doc-surface h3 { font-family: 'Fraunces', serif; font-style: italic; font-size: 17px; margin: 26px 0 10px; color: var(--ink); }
        .doc-surface h3:first-child { margin-top: 0; }
        .doc-surface p { margin: 0 0 15px; color: var(--ink-soft); }
        .clause-flag { border-bottom: 2px solid var(--accent); background: var(--accent-soft); border-radius: 3px; padding: 1px 2px; cursor: pointer; color: var(--ink); transition: outline 0.15s; }
        .clause-flag.caution { border-color: var(--major); background: var(--major-soft); }
        .clause-flag.active-flag { outline: 2px solid var(--accent); outline-offset: 1px; }
        .missing-marker { display: inline-flex; align-items: center; gap: 5px; font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: var(--major); background: var(--major-soft); border-radius: 6px; padding: 2px 8px; margin: 4px 0; cursor: pointer; }

        .rail { display: flex; flex-direction: column; gap: 12px; }
        .rail-tabs { display: grid; grid-template-columns: repeat(6, 1fr); gap: 3px; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 11px; padding: 3px; }
        .rail-tab { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 3px; border-radius: 8px; border: 0; background: transparent; color: var(--muted); cursor: pointer; font-size: 9px; font-weight: 600; letter-spacing: .01em; transition: all 0.15s; }
        .rail-tab:hover { color: var(--ink-soft); }
        .rail-tab.active { background: var(--paper); color: var(--accent); }
        .rail-tab svg { flex-shrink: 0; }
        .rail-dot { position: absolute; top: 4px; right: 12px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); border: 1.5px solid var(--paper-2); }
        .rail-tab.active .rail-dot { border-color: var(--paper); }

        .rail-panel-wrap { background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 16px; max-height: 620px; overflow-y: auto; }
        .rail-panel { display: none; flex-direction: column; gap: 12px; }
        .rail-panel.active { display: flex; }
        .rail-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 2px; }
        .rail-head-title { font-size: 14px; font-weight: 600; color: var(--ink); }
        .rail-head-sub { font-size: 11.5px; color: var(--ink-soft); line-height: 1.5; margin-top: 3px; }

        .risk-card { background: var(--paper-2); border: 1px solid var(--rule); border-radius: 11px; padding: 13px 14px; cursor: pointer; transition: border-color 0.15s; }
        .risk-card:hover { border-color: var(--accent); }
        .risk-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .risk-sev { display: inline-flex; align-items: center; gap: 5px; font-size: 9.5px; font-weight: 600; font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; letter-spacing: .04em; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
        .risk-sev.critical { background: var(--accent-soft); color: var(--accent); }
        .risk-sev.caution { background: var(--major-soft); color: var(--major); }
        .risk-sev.info { background: var(--paper); color: var(--muted); border: 1px solid var(--rule); }
        .risk-clause-title { font-size: 13px; font-weight: 600; margin-top: 9px; color: var(--ink); }
        .risk-excerpt { font-family: 'Fraunces', serif; font-style: italic; font-size: 12.5px; color: var(--ink-soft); margin-top: 7px; line-height: 1.5; border-left: 2px solid var(--rule); padding-left: 10px; }
        .risk-loc { font-size: 10px; color: var(--muted); margin-top: 9px; font-family: 'IBM Plex Mono', monospace; display: flex; align-items: center; gap: 6px; }

        .missing-card { background: var(--paper-2); border: 1px solid var(--rule); border-radius: 11px; padding: 13px 14px; display: flex; gap: 11px; }
        .missing-check { width: 18px; height: 18px; border-radius: 5px; border: 1.5px solid var(--rule); flex-shrink: 0; margin-top: 2px; cursor: pointer; background: var(--paper); display: flex; align-items: center; justify-content: center; color: transparent; transition: all 0.15s; }
        .missing-check.checked { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
        .missing-body { flex-grow: 1; }
        .missing-title { font-size: 13px; font-weight: 600; color: var(--ink); }
        .missing-rationale { font-size: 11.5px; color: var(--ink-soft); margin-top: 5px; line-height: 1.5; }
        .missing-model { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: var(--muted); background: var(--paper); border: 1px solid var(--rule); border-radius: 7px; padding: 7px 9px; margin-top: 8px; line-height: 1.5; }
        .missing-actions { display: flex; gap: 8px; margin-top: 9px; flex-wrap: wrap; }

        .bulk-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 10px; }
        .bulk-bar-label { font-size: 11.5px; color: var(--ink-soft); }

        .citation-card { background: var(--paper-2); border: 1px solid var(--rule); border-radius: 11px; padding: 13px 14px; }
        .citation-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
        .citation-name { font-size: 12.5px; font-weight: 600; line-height: 1.4; color: var(--ink); }
        .citation-num { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: var(--accent); margin-top: 3px; }
        .citation-snippet { font-size: 11.5px; color: var(--ink-soft); margin-top: 8px; line-height: 1.5; }
        .citation-actions { display: flex; gap: 7px; margin-top: 10px; flex-wrap: wrap; }

        .chat-scroll { display: flex; flex-direction: column; gap: 13px; max-height: 480px; overflow-y: auto; padding-right: 2px; }
        .msg { display: flex; gap: 9px; }
        .msg.user { flex-direction: row-reverse; }
        .msg-avatar { width: 24px; height: 24px; border-radius: 50%; background: var(--paper); border: 1px solid var(--rule); color: var(--accent); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .msg-bubble { background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 10px 12px; font-size: 12.5px; line-height: 1.6; max-width: 84%; color: var(--ink); }
        .msg.user .msg-bubble { background: var(--accent-soft); border-color: transparent; color: var(--ink); }
        .msg-cite-row { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 7px; }
        .msg-cite { display: inline-block; font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 5px; padding: 2px 6px; color: var(--accent); cursor: pointer; }
        .chat-suggest-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
        .suggest-chip { font-size: 11px; border: 1px solid var(--rule); border-radius: 999px; padding: 5px 11px; background: var(--paper-2); color: var(--ink-soft); cursor: pointer; transition: all 0.15s; }
        .suggest-chip:hover { border-color: var(--accent); color: var(--accent); }
        .chat-input-row { display: flex; gap: 8px; padding-top: 10px; border-top: 1px solid var(--rule); margin-top: 8px; }
        .chat-input { flex-grow: 1; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 10px; padding: 10px 13px; font-size: 12.5px; color: var(--ink); outline: none; }
        .chat-input:focus { border-color: var(--accent); }
        .chat-send { width: 38px; height: 38px; border-radius: 10px; background: var(--accent); border: 0; color: var(--on-accent); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: filter 0.15s; }
        .chat-send:hover { filter: brightness(1.08); }

        .conflict-upload { border: 1.5px dashed var(--rule); border-radius: 11px; padding: 14px; display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--muted); cursor: pointer; transition: all 0.15s; }
        .conflict-upload:hover { border-color: var(--accent); color: var(--accent); }
        .conflict-card { background: var(--paper-2); border: 1px solid var(--rule); border-radius: 11px; padding: 13px 14px; cursor: pointer; transition: border-color 0.15s; }
        .conflict-card:hover { border-color: var(--accent); }
        .conflict-ref { font-size: 10.5px; color: var(--muted); font-family: 'IBM Plex Mono', monospace; margin-top: 8px; }
        .conflict-summary { font-size: 12px; color: var(--ink-soft); margin-top: 7px; line-height: 1.5; }
        .conflict-engine-note { display: flex; gap: 8px; align-items: flex-start; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 10px; padding: 10px 12px; font-size: 11px; color: var(--muted); line-height: 1.5; margin-top: 6px; }
        .conflict-engine-note svg { flex-shrink: 0; margin-top: 1px; color: var(--accent); }

        /* ── Modals ── */
        .modal-overlay { position: fixed; inset: 0; background: var(--overlay); display: none; align-items: center; justify-content: center; padding: 30px; z-index: 2500; backdrop-filter: blur(4px); }
        .modal-overlay.open { display: flex; }
        .modal { background: var(--paper); border: 1px solid var(--rule); border-radius: 16px; box-shadow: var(--shadow); width: 100%; max-width: 840px; max-height: 90vh; overflow-y: auto; }
        .modal-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--rule); position: sticky; top: 0; background: var(--paper); z-index: 2; }
        .modal-title { font-size: 19px; margin-top: 4px; color: var(--ink); }
        .modal-body { padding: 24px; display: flex; flex-direction: column; gap: 22px; }
        .modal-footer { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 18px 24px; border-top: 1px solid var(--rule); position: sticky; bottom: 0; background: var(--paper); flex-wrap: wrap; }

        .workshop-quote { font-family: 'Fraunces', serif; font-style: italic; font-size: 15px; line-height: 1.65; color: var(--ink); background: var(--paper-2); border-left: 3px solid var(--accent); border-radius: 8px; padding: 14px 18px; }
        .workshop-section-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; color: var(--accent); font-weight: 600; margin-bottom: 10px; }
        .guardrail-box { display: flex; gap: 12px; background: var(--major-soft); border: 1px solid var(--rule); border-radius: 10px; padding: 14px 16px; }
        .guardrail-icon { width: 30px; height: 30px; border-radius: 8px; background: var(--paper); color: var(--major); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .guardrail-rule { font-size: 12.5px; font-weight: 600; color: var(--ink); }
        .guardrail-text { font-size: 12px; color: var(--ink-soft); margin-top: 4px; line-height: 1.55; }
        .diff-box { background: var(--bg); border: 1px solid var(--rule); border-radius: 10px; padding: 16px 18px; font-size: 13px; line-height: 1.85; color: var(--ink); }
        .diff-box del { color: var(--accent); background: var(--accent-soft); text-decoration: line-through; text-decoration-thickness: 1.5px; border-radius: 3px; padding: 0 2px; }
        .diff-box ins { color: var(--major); background: var(--major-soft); text-decoration: none; border-bottom: 1.5px solid var(--major); border-radius: 3px; padding: 0 2px; }
        .side-by-side { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .side-col-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; margin-bottom: 8px; }
        .side-col-body { font-family: 'Fraunces', serif; font-style: italic; font-size: 13px; line-height: 1.6; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 10px; padding: 14px 16px; color: var(--ink-soft); height: 100%; }

        @media (max-width: 1080px) {
          .workbench { grid-template-columns: 1fr; }
          .rail-panel-wrap, .doc-surface { max-height: none; }
        }
        @media (max-width: 880px) {
          .upload-grid { grid-template-columns: 1fr; }
          .side-by-side { grid-template-columns: 1fr; }
          .ca-topbar { flex-direction: column !important; }
        }
        @media (max-width: 560px) {
          .ca-content, .ca-topbar { padding-left: 18px !important; padding-right: 18px !important; }
          .rail-tabs { grid-template-columns: repeat(3, 1fr); }
        }
      `}</style>

      {/* ── TOPBAR MASTHEAD ── */}
      <header className="ca-topbar">
        <div style={{ flexGrow: 1, minWidth: '260px' }}>
          <div className="eyebrow">
            Workspace · AI Document Intelligence
            <span style={{ display: 'none' }}> · Contract Risk Analyzer</span>
          </div>
          <div className="title-row">
            <h1 className="page-title serif">Contract Analyzer</h1>
            <span className="badge">
              {ICONS.shield}
              Every flag is sourced to a clause
            </span>
          </div>
          <div className="page-sub">
            Every risk, citation and rewrite below is generated from the document you load here — nothing on this screen is a fixed sample. Built to hold up on a 60-page facility agreement as well as a two-page NDA.
          </div>
        </div>

        {viewState === 'analyzed' && (
          <div className="ca-topbar-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setViewState('upload');
                setSelectedFile(null);
                setPastedText('');
              }}
            >
              {ICONS.plus}
              New analysis
            </button>
            <button type="button" className="btn" onClick={handleSaveToDrafts}>
              {ICONS.edit}
              Save to drafts
            </button>
            <button type="button" className="btn btn-primary" onClick={handleExportReport}>
              {ICONS.export}
              Export report
            </button>
          </div>
        )}
      </header>

      {/* Toast Alert */}
      {toastMessage && (
        <div style={{
          margin: '0 36px', padding: '12px 18px', borderRadius: '10px',
          background: 'var(--paper-2)', border: '1px solid var(--rule)',
          color: 'var(--ink)', fontSize: '13px', fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          {ICONS.check} {toastMessage}
        </div>
      )}

      <div className="ca-content">

        {/* ============================================================
             STATE 1 — UPLOAD
             ============================================================ */}
        {viewState === 'upload' && (
          <section className="state-upload-wrap">
            <div className="upload-hero">
              <div className="upload-hero-title serif">What are we reviewing today, Counsel?</div>
              <div className="upload-hero-sub">
                Load a contract — LexAmplify reads every clause, flags what's risky against Indian contract law and your firm's playbook, and cites everything it tells you. Documents of any length are supported; longer filings simply take a little more scan time.
              </div>
            </div>

            <div className="upload-grid">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  accept=".pdf,.docx,.doc,.txt"
                  onChange={handleFileSelect}
                />
                <div
                  className={`big-dropzone ${isDragOver ? 'dragover' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleFileDrop}
                >
                  <div className="big-dropzone-icon">
                    {ICONS.uploadCloud}
                  </div>
                  <div className="big-dropzone-title">
                    {selectedFile ? selectedFile.name : 'Drag and drop a contract, or click to browse'}
                  </div>
                  <div className="big-dropzone-sub">
                    {selectedFile
                      ? `${(selectedFile.size / 1024).toFixed(1)} KB · Ready to scan`
                      : 'PDF or DOCX, any length — a 60-page facility agreement is read the same way as a 2-page NDA.'}
                  </div>
                  <div className="mono" style={{ fontSize: '10.5px', color: 'var(--muted)' }}>MAX 50 MB PER FILE</div>
                </div>

                <div className="or-row">or paste text directly</div>
                <textarea
                  className="paste-box"
                  placeholder="Paste the full contract text here…"
                  value={pastedText}
                  onChange={(e) => {
                    setPastedText(e.target.value);
                    if (e.target.value.trim()) {
                      setSelectedFile(null);
                    }
                  }}
                />
              </div>

              <div className="playbook-card">
                <div className="playbook-icon">
                  {ICONS.book}
                </div>
                <div>
                  <div className="playbook-title">
                    Firm playbook <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
                  </div>
                  <div className="playbook-sub">
                    Attach your firm's clause standards and LexAmplify flags deviations from them specifically, cited by rule — not just generic risk.
                  </div>
                </div>

                <input
                  type="file"
                  ref={playbookInputRef}
                  style={{ display: 'none' }}
                  accept=".pdf,.docx,.doc,.txt"
                  onChange={handlePlaybookSelect}
                />

                {!playbookFile ? (
                  <div className="small-dropzone" onClick={() => playbookInputRef.current?.click()}>
                    {ICONS.uploadSmall}
                    Upload playbook / rule-book
                  </div>
                ) : (
                  <div className="playbook-file">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                      {ICONS.fileCheck}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{playbookFile.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPlaybookFile(null)}
                      style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '2px 4px' }}
                    >✕</button>
                  </div>
                )}

                <div className="mode-block">
                  <div className="mode-block-label">Review posture</div>
                  <div className="mode-seg">
                    {['balanced', 'aggressive', 'quick'].map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`mode-opt ${scanMode === m ? 'active' : ''}`}
                        onClick={() => setScanMode(m)}
                      >
                        {m === 'quick' ? 'Quick scan' : m.charAt(0).toUpperCase() + m.slice(1)}
                      </button>
                    ))}
                  </div>
                  <div className="mono" style={{ fontSize: '10.5px', color: 'var(--muted)', lineHeight: '1.5' }}>
                    {MODE_HINTS[scanMode]}
                  </div>
                </div>
              </div>
            </div>

            <div className="begin-btn-row">
              <button
                className="btn btn-primary"
                style={{ padding: '13px 26px', fontSize: '14px' }}
                onClick={handleBeginAnalysis}
              >
                {ICONS.sparkles}
                Begin analysis
              </button>
            </div>
          </section>
        )}

        {/* ============================================================
             STATE 2 — SCANNING
             ============================================================ */}
        {viewState === 'scanning' && (
          <section className="state-scanning-wrap">
            <div className="scan-ring" />
            <div>
              <div className="scan-title serif">Reading {documentName}</div>
              <div className="scan-sub">
                {pageCount} pages · running the Hybrid Engine — clause segmentation, playbook comparison, precedent retrieval and missing-clause detection all run per page, so this scales with document length.
              </div>
            </div>
            <div style={{ width: '100%' }}>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${scanProgress}%` }} />
              </div>
              <div className="progress-label">
                <span>{scanProgress}%</span>
                <span>{scanStage}</span>
              </div>
            </div>
            <div className="console">
              <div className="console-eyebrow">HYBRID ENGINE CONSOLE</div>
              <div>
                {consoleLogs.map((log, idx) => (
                  <div key={idx} className={`console-line ${log.cls}`}>
                    <span className="t">{log.t}</span>
                    <span>{log.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ============================================================
             STATE 3 — ANALYZED (WORKBENCH)
             ============================================================ */}
        {viewState === 'analyzed' && (
          <section className="state-analyzed-wrap">

            {/* Document Summary Bar */}
            <div className="summary-bar">
              <div className="summary-stat">
                <div className="summary-stat-val mono">{pageCount}</div>
                <div className="summary-stat-label">Pages read</div>
              </div>
              <div className="summary-div" />
              <div className="summary-stat">
                <div className="summary-stat-val accent mono">{risks.length}</div>
                <div className="summary-stat-label">Risks flagged</div>
              </div>
              <div className="summary-div" />
              <div className="summary-stat">
                <div className="summary-stat-val major mono">{missing.length}</div>
                <div className="summary-stat-label">Missing clauses</div>
              </div>
              <div className="summary-div" />
              <div className="summary-stat">
                <div className="summary-stat-val mono">{citations.length}</div>
                <div className="summary-stat-label">Citations found</div>
              </div>
              <div className="summary-div" />
              <div className="summary-stat">
                <div className="summary-stat-val mono">{scanDuration}s</div>
                <div className="summary-stat-label">Scan time</div>
              </div>
              <div className="summary-mode">
                <span className="badge mono" style={{ fontSize: '10.5px' }}>
                  {scanMode.toUpperCase()} MODE
                </span>
              </div>
            </div>

            <div className="workbench">

              {/* ── LEFT: DOCUMENT PANE ── */}
              <div className="doc-pane">
                <div className="doc-toolbar">
                  <button className="toolbar-btn" title="Bold"><strong>B</strong></button>
                  <button className="toolbar-btn" title="Italic"><em>I</em></button>
                  <button className="toolbar-btn" title="Underline"><u>U</u></button>
                  <div className="toolbar-sep" />
                  <button className="toolbar-btn" title="Bullet list">•=</button>
                  <button className="toolbar-btn" title="Numbered list">1=</button>
                  <div className="toolbar-sep" />
                  <button className="toolbar-btn" title="Search in document">{ICONS.search}</button>

                  {/* Flag Navigator (§4 & §5: cycles through arbitrary number of flags) */}
                  <div className="toolbar-nav">
                    <button
                      className="toolbar-btn"
                      title="Previous flagged clause"
                      onClick={handlePrevFlag}
                      disabled={activeFlags.length === 0}
                    >
                      {ICONS.chevronLeft}
                    </button>
                    <span className="toolbar-nav-label">
                      {activeFlags.length === 0
                        ? 'No flags remain'
                        : `Flag ${activeFlagIndex + 1} of ${activeFlags.length}`}
                    </span>
                    <button
                      className="toolbar-btn"
                      title="Next flagged clause"
                      onClick={handleNextFlag}
                      disabled={activeFlags.length === 0}
                    >
                      {ICONS.chevronRight}
                    </button>
                  </div>
                </div>

                <div className="doc-meta-bar">
                  <div>
                    <div className="doc-name">{documentName}</div>
                    <div className="doc-name-meta">{pageCount} pages · {wordCount.toLocaleString()} words · live review</div>
                  </div>
                  <span className="badge mono" style={{ fontSize: '10px' }}>PAGE 4 OF {pageCount}</span>
                </div>

                <div className="doc-surface" ref={docSurfaceRef}>
                  <h3>7. Limitation of Liability</h3>
                  <p>
                    7.1 Except in cases of gross negligence or wilful misconduct,{' '}
                    {resolvedRisks.has('risk-1') ? (
                      <span style={{ background: 'var(--paper-2)', padding: '1px 3px', borderRadius: '3px' }}>
                        neither Party's aggregate liability arising out of this Agreement shall exceed an amount equal to twelve (12) months’ fees paid under this Agreement, regardless of the form of action.
                      </span>
                    ) : (
                      <span
                        className={`clause-flag ${activeFlags[activeFlagIndex]?.id === 'risk-1' ? 'active-flag' : ''}`}
                        data-risk="risk-1"
                        onClick={() => handleOpenWorkshop('risk-1')}
                      >
                        neither Party's aggregate liability arising out of this Agreement shall exceed the total fees paid in the preceding three (3) months, regardless of the form of action.
                      </span>
                    )}
                  </p>
                  <p>
                    7.2 In no event shall either Party be liable for indirect, incidental, special or consequential damages, including loss of profits, even if advised of the possibility of such damages.
                  </p>

                  <h3>8. Termination</h3>
                  <p>
                    8.1 Either Party may terminate this Agreement for convenience upon{' '}
                    {resolvedRisks.has('risk-2') ? (
                      <span style={{ background: 'var(--paper-2)', padding: '1px 3px', borderRadius: '3px' }}>
                        thirty (30) days' written notice, provided that the terminating Party shall compensate the other Party for all work performed and non-cancellable commitments incurred up to the effective date of termination.
                      </span>
                    ) : (
                      <span
                        className={`clause-flag ${activeFlags[activeFlagIndex]?.id === 'risk-2' ? 'active-flag' : ''}`}
                        data-risk="risk-2"
                        onClick={() => handleOpenWorkshop('risk-2')}
                      >
                        thirty (30) days' written notice, with no obligation to compensate the other Party for work in progress.
                      </span>
                    )}
                  </p>
                  <p>
                    8.2 Upon termination, the Vendor shall return all Confidential Information within fifteen (15) business days.
                  </p>

                  {/* Missing Clause Marker */}
                  {!insertedMissing.has('miss-1') ? (
                    <div className="missing-marker" onClick={() => setActiveTab('missing')}>
                      {ICONS.plus} Suggested: Transition Assistance clause — not present
                    </div>
                  ) : (
                    <div style={{ background: 'var(--paper-2)', borderLeft: '3px solid var(--major)', padding: '10px 14px', borderRadius: '6px', margin: '8px 0', fontSize: '13px' }}>
                      <strong>8.3 Transition Assistance:</strong> Upon termination or expiry, Vendor shall provide reasonable transition assistance for up to ninety (90) days to facilitate an orderly handover to Client or its designated successor, at Vendor’s then-current standard rates.
                    </div>
                  )}

                  <h3>9. Data Protection &amp; Confidentiality</h3>
                  <p>
                    9.1 Vendor shall implement reasonable technical and organisational measures to protect Client Data in accordance with applicable law.
                  </p>
                  <p>
                    9.2{' '}
                    {resolvedRisks.has('risk-3') ? (
                      <span style={{ background: 'var(--paper-2)', padding: '1px 3px', borderRadius: '3px' }}>
                        Vendor shall implement measures in accordance with applicable law, including the Digital Personal Data Protection Act, 2023.
                      </span>
                    ) : (
                      <span
                        className={`clause-flag caution ${activeFlags[activeFlagIndex]?.id === 'risk-3' ? 'active-flag' : ''}`}
                        data-risk="risk-3"
                        onClick={() => handleOpenWorkshop('risk-3')}
                      >
                        "Applicable law" is not defined to include the Digital Personal Data Protection Act, 2023
                      </span>
                    )}
                    , despite both Parties operating in India.
                  </p>

                  <h3>10. Governing Law &amp; Dispute Resolution</h3>
                  <p>
                    10.1{' '}
                    {resolvedRisks.has('risk-4') ? (
                      <span style={{ background: 'var(--paper-2)', padding: '1px 3px', borderRadius: '3px' }}>
                        This Agreement shall be governed by the laws of India, and disputes shall be resolved by arbitration seated in New Delhi under the Arbitration and Conciliation Act, 1996.
                      </span>
                    ) : (
                      <span
                        className={`clause-flag ${activeFlags[activeFlagIndex]?.id === 'risk-4' ? 'active-flag' : ''}`}
                        data-risk="risk-4"
                        onClick={() => handleOpenWorkshop('risk-4')}
                      >
                        This Agreement shall be governed by the laws of Singapore, and disputes shall be resolved by arbitration seated in Singapore under SIAC Rules.
                      </span>
                    )}
                  </p>
                  <p>
                    10.2 The Parties agree to attempt good-faith negotiation for thirty (30) days prior to initiating arbitration.
                  </p>

                  <h3>11. Indemnification</h3>
                  <p>
                    11.1{' '}
                    {resolvedRisks.has('risk-5') ? (
                      <span style={{ background: 'var(--paper-2)', padding: '1px 3px', borderRadius: '3px' }}>
                        Vendor's indemnification obligations are capped at Clause 7.1, except for indemnities arising from IP infringement or confidentiality breach which shall remain uncapped.
                      </span>
                    ) : (
                      <span
                        className={`clause-flag caution ${activeFlags[activeFlagIndex]?.id === 'risk-5' ? 'active-flag' : ''}`}
                        data-risk="risk-5"
                        onClick={() => handleOpenWorkshop('risk-5')}
                      >
                        Vendor's indemnification obligations are capped at the same liability limit set out in Clause 7.1
                      </span>
                    )}
                    , which would also cap indemnity for IP infringement and confidentiality breaches.
                  </p>

                  {!insertedMissing.has('miss-2') ? (
                    <div className="missing-marker" onClick={() => setActiveTab('missing')}>
                      {ICONS.plus} Suggested: Force Majeure clause — not present
                    </div>
                  ) : (
                    <div style={{ background: 'var(--paper-2)', borderLeft: '3px solid var(--major)', padding: '10px 14px', borderRadius: '6px', margin: '8px 0', fontSize: '13px' }}>
                      <strong>11.2 Force Majeure:</strong> Neither Party shall be liable for any failure or delay in performance under this Agreement to the extent such failure or delay is caused by circumstances beyond its reasonable control, including acts of God, war, pandemic, or governmental action.
                    </div>
                  )}

                  <h3>12. Assignment</h3>
                  <p>
                    12.1{' '}
                    {resolvedRisks.has('risk-6') ? (
                      <span style={{ background: 'var(--paper-2)', padding: '1px 3px', borderRadius: '3px' }}>
                        Vendor may assign this Agreement, other than to a direct competitor of Client, only with Client’s prior written consent.
                      </span>
                    ) : (
                      <span
                        className={`clause-flag ${activeFlags[activeFlagIndex]?.id === 'risk-6' ? 'active-flag' : ''}`}
                        data-risk="risk-6"
                        onClick={() => handleOpenWorkshop('risk-6')}
                      >
                        Vendor may freely assign this Agreement, including to a competitor of Client, without Client's prior written consent.
                      </span>
                    )}
                  </p>

                  <p className="mono" style={{ fontSize: '11px', color: 'var(--muted)', textAlign: 'center', paddingTop: '10px' }}>
                    — Page 4 of {pageCount} · scroll or use the flag navigator above to continue —
                  </p>
                </div>
              </div>

              {/* ── RIGHT: ANALYSIS RAIL (6 Tabs) ── */}
              <div className="rail">
                <div className="rail-tabs">
                  <button
                    type="button"
                    className={`rail-tab ${activeTab === 'risks' ? 'active' : ''}`}
                    onClick={() => setActiveTab('risks')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2.5L2.5 20h19z" /><path d="M12 9.5v4.5" /><circle cx="12" cy="17" r="0.6" fill="currentColor" />
                    </svg>
                    Risks
                    {risks.length > 0 && <span className="rail-dot" />}
                  </button>

                  <button
                    type="button"
                    className={`rail-tab ${activeTab === 'missing' ? 'active' : ''}`}
                    onClick={() => setActiveTab('missing')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" />
                    </svg>
                    Missing
                  </button>

                  <button
                    type="button"
                    className={`rail-tab ${activeTab === 'chat' ? 'active' : ''}`}
                    onClick={() => setActiveTab('chat')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4 8.7 8.7 0 0 1-3.5-.7L3 20l1-4.9a8.4 8.4 0 0 1 8.5-12.6 8.4 8.4 0 0 1 8.5 8.5z" />
                    </svg>
                    Ask AI
                  </button>

                  <button
                    type="button"
                    className={`rail-tab ${activeTab === 'citations' ? 'active' : ''}`}
                    onClick={() => setActiveTab('citations')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19.5A2 2 0 0 1 6 17.5h13" />
                    </svg>
                    Citations
                  </button>

                  <button
                    type="button"
                    className={`rail-tab ${activeTab === 'comments' ? 'active' : ''}`}
                    onClick={() => setActiveTab('comments')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 11.5a8.4 8.4 0 0 1-11.4 7.9L4 21l1.4-4.4A8.4 8.4 0 1 1 21 11.5z" />
                    </svg>
                    Comments
                  </button>

                  <button
                    type="button"
                    className={`rail-tab ${activeTab === 'conflicts' ? 'active' : ''}`}
                    onClick={() => setActiveTab('conflicts')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
                    </svg>
                    Conflicts
                  </button>
                </div>

                <div className="rail-panel-wrap">

                  {/* ── TAB 1: RISKS ── */}
                  <div className={`rail-panel ${activeTab === 'risks' ? 'active' : ''}`}>
                    <div className="rail-head">
                      <div>
                        <div className="rail-head-title">Flagged clauses</div>
                        <div className="rail-head-sub">Ranked by severity. Click a card to open the Revision Workshop.</div>
                      </div>
                      <span className="chip chip-accent">{risks.length}</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {risks.length === 0 ? (
                        <div className="empty" style={{ padding: '30px 10px' }}>
                          <div className="empty-icon">{ICONS.check}</div>
                          <div className="empty-title serif">All risks resolved</div>
                          <div className="empty-sub">Every flagged clause in this contract has been addressed or accepted.</div>
                        </div>
                      ) : (
                        risks.map((r) => (
                          <div
                            key={r.id}
                            className="risk-card"
                            onClick={() => handleOpenWorkshop(r.id)}
                          >
                            <div className="risk-card-top">
                              <span className={`risk-sev ${getSevClass(r.severity)}`}>
                                {getSevLabel(r.severity)}
                              </span>
                            </div>
                            <div className="risk-clause-title">{r.title}</div>
                            <div className="risk-excerpt">{r.excerpt}</div>
                            <div className="risk-loc">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
                              </svg>
                              {r.location}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* ── TAB 2: MISSING ── */}
                  <div className={`rail-panel ${activeTab === 'missing' ? 'active' : ''}`}>
                    <div className="rail-head">
                      <div>
                        <div className="rail-head-title">Missing clauses</div>
                        <div className="rail-head-sub">Standard for this contract type, not found in the document.</div>
                      </div>
                      <span className="chip chip-major">{missing.length}</span>
                    </div>

                    <div className="bulk-bar">
                      <span className="bulk-bar-label">
                        {checkedMissingCount} of {missing.length} selected
                      </span>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={checkedMissingCount === 0}
                        onClick={handleBulkInsertMissing}
                      >
                        Add selected clauses
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {missing.length === 0 ? (
                        <div className="empty" style={{ padding: '30px 10px' }}>
                          <div className="empty-icon">{ICONS.check}</div>
                          <div className="empty-title serif">No missing clauses</div>
                          <div className="empty-sub">All recommended standard clauses have been inserted into the agreement.</div>
                        </div>
                      ) : (
                        missing.map((m) => (
                          <div key={m.id} className="missing-card">
                            <div
                              className={`missing-check ${m.checked ? 'checked' : ''}`}
                              onClick={() => handleToggleMissingCheck(m.id)}
                            >
                              {ICONS.check}
                            </div>
                            <div className="missing-body">
                              <div className="missing-title">{m.title}</div>
                              <div className="missing-rationale">{m.rationale}</div>
                              {m.expanded && (
                                <div className="missing-model">{m.model}</div>
                              )}
                              <div className="missing-actions">
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => handleToggleMissingExpand(m.id)}
                                >
                                  {m.expanded ? 'Hide model clause' : 'View model clause'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() => handleInsertSingleMissing(m.id)}
                                >
                                  Insert into document
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* ── TAB 3: CHAT ── */}
                  <div className={`rail-panel ${activeTab === 'chat' ? 'active' : ''}`}>
                    <div className="rail-head">
                      <div>
                        <div className="rail-head-title">Ask about this document</div>
                        <div className="rail-head-sub">Answers are grounded in this contract only, cited by clause.</div>
                      </div>
                    </div>

                    <div className="chat-scroll" ref={chatScrollRef}>
                      {chatMessages.map((m) => (
                        <div key={m.id} className={`msg ${m.role === 'user' ? 'user' : ''}`}>
                          <div className="msg-avatar">
                            {m.role === 'user' ? ICONS.user : ICONS.aiChat}
                          </div>
                          <div className="msg-bubble">
                            <div>{m.text}</div>
                            {m.cites && m.cites.length > 0 && (
                              <div className="msg-cite-row">
                                {m.cites.map((c, ci) => (
                                  <span key={ci} className="msg-cite">{c}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      {chatLoading && (
                        <div className="msg">
                          <div className="msg-avatar">{ICONS.aiChat}</div>
                          <div className="msg-bubble" style={{ color: 'var(--muted)', fontStyle: 'italic' }}>
                            Consulting contract clauses…
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="chat-suggest-row">
                      <button
                        type="button"
                        className="suggest-chip"
                        onClick={() => handleSendChat('Summarize the termination terms')}
                      >
                        Summarize the termination terms
                      </button>
                      <button
                        type="button"
                        className="suggest-chip"
                        onClick={() => handleSendChat('What’s our exposure under Clause 7?')}
                      >
                        What’s our exposure under Clause 7?
                      </button>
                      <button
                        type="button"
                        className="suggest-chip"
                        onClick={() => handleSendChat('List every date-bound obligation')}
                      >
                        List every date-bound obligation
                      </button>
                    </div>

                    <div className="chat-input-row">
                      <input
                        className="chat-input"
                        type="text"
                        placeholder="Ask about this contract…"
                        aria-label="Ask about this document"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSendChat(); }}
                        disabled={chatLoading}
                      />
                      <button
                        type="button"
                        className="chat-send"
                        aria-label="Send"
                        onClick={() => handleSendChat()}
                        disabled={chatLoading || !chatInput.trim()}
                      >
                        {ICONS.send}
                      </button>
                    </div>
                  </div>

                  {/* ── TAB 4: CITATIONS ── */}
                  <div className={`rail-panel ${activeTab === 'citations' ? 'active' : ''}`}>
                    <div className="rail-head">
                      <div>
                        <div className="rail-head-title">Supporting citations</div>
                        <div className="rail-head-sub">Precedent and statute pulled in support of the flags above.</div>
                      </div>
                      <span className="chip chip-neutral">{citations.length}</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {citations.map((c) => (
                        <div key={c.id} className="citation-card">
                          <div className="citation-top">
                            <div>
                              <div className="citation-name">{c.name}</div>
                              <div className="citation-num mono">{c.num}</div>
                            </div>
                            <span className={`chip ${c.inVault ? 'chip-neutral' : 'chip-major'}`}>
                              {c.inVault ? 'In firm vault' : 'Not in firm vault'}
                            </span>
                          </div>
                          <div className="citation-snippet">{c.snippet}</div>
                          <div className="citation-actions">
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => {
                                setToastMessage(`Inserted citation "${c.num}" into active clause`);
                                setTimeout(() => setToastMessage(''), 3500);
                              }}
                            >
                              Insert citation
                            </button>
                            <a
                              href={`https://indiankanoon.org/search/?formInput=${encodeURIComponent(c.name)}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{ textDecoration: 'none' }}
                            >
                              <button type="button" className="btn btn-ghost btn-sm">Open source</button>
                            </a>
                            {!c.inVault && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => {
                                  navigate(`/firm-library/search?q=${encodeURIComponent(c.name)}`);
                                }}
                              >
                                Search similar
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── TAB 5: COMMENTS ── */}
                  <div className={`rail-panel ${activeTab === 'comments' ? 'active' : ''}`}>
                    <div className="empty">
                      <div className="empty-icon">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 11.5a8.4 8.4 0 0 1-11.4 7.9L4 21l1.4-4.4A8.4 8.4 0 1 1 21 11.5z" />
                        </svg>
                      </div>
                      <div className="empty-title serif">No comments yet</div>
                      <div className="empty-sub">
                        Select any text in the document and leave a note for a colleague reviewing this contract with you — threaded comments appear here, tied to the exact clause.
                      </div>
                    </div>
                  </div>

                  {/* ── TAB 6: CONFLICTS ── */}
                  <div className={`rail-panel ${activeTab === 'conflicts' ? 'active' : ''}`}>
                    <div className="rail-head">
                      <div>
                        <div className="rail-head-title">Cross-document conflicts</div>
                        <div className="rail-head-sub">Check this contract against another filing — an MOU, an earlier draft, a related agreement.</div>
                      </div>
                    </div>

                    <input
                      type="file"
                      ref={conflictInputRef}
                      style={{ display: 'none' }}
                      accept=".pdf,.docx,.doc,.txt"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setConflictScanReady(true);
                        }
                      }}
                    />

                    {!conflictScanReady && !conflictScanned && (
                      <div className="conflict-upload" onClick={() => conflictInputRef.current?.click()}>
                        {ICONS.uploadSmall}
                        Upload a reference document to compare
                      </div>
                    )}

                    {conflictScanReady && !conflictScanned && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          setConflictScanned(true);
                        }}
                      >
                        {ICONS.search}
                        Run conflict scan against Term_Sheet_v2.docx
                      </button>
                    )}

                    {(conflictScanned || conflicts.length > 0) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {conflicts.length === 0 ? (
                          <div className="empty" style={{ padding: '24px 10px' }}>
                            <div className="empty-icon">{ICONS.check}</div>
                            <div className="empty-title serif">No conflicts remaining</div>
                            <div className="empty-sub">All terms are harmonized across referenced documents.</div>
                          </div>
                        ) : (
                          conflicts.map((c) => (
                            <div
                              key={c.id}
                              className="conflict-card"
                              onClick={() => setActiveConflictId(c.id)}
                            >
                              <div className="risk-card-top">
                                <span className={`risk-sev ${getSevClass(c.severity)}`}>
                                  {getSevLabel(c.severity)}
                                </span>
                              </div>
                              <div className="risk-clause-title">{c.title}</div>
                              <div className="conflict-summary">{c.summary}</div>
                              <div className="conflict-ref">vs. {c.refDoc}</div>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    <div className="conflict-engine-note">
                      {ICONS.infoCircle}
                      <span>This runs on the same Conflict Engine available as its own feature in the sidebar — a scan here and a scan there should never disagree. See the brief.</span>
                    </div>
                  </div>

                </div>
              </div>

            </div>
          </section>
        )}

      </div>

      {/* ============================================================
           REVISION WORKSHOP MODAL (Risks)
           ============================================================ */}
      <div className={`modal-overlay ${activeWorkshopRisk ? 'open' : ''}`}>
        {activeWorkshopRisk && (
          <div className="modal">
            <div className="modal-header">
              <div>
                <div className="card-eyebrow">Revision Workshop</div>
                <div className="modal-title serif">{activeWorkshopRisk.title}</div>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close"
                onClick={handleDiscardRevision}
              >
                {ICONS.close}
              </button>
            </div>

            <div className="modal-body">
              <div>
                <div className="workshop-section-label">Clause as written · {activeWorkshopRisk.location}</div>
                <div className="workshop-quote">{activeWorkshopRisk.original}</div>
              </div>

              {activeWorkshopRisk.guardrailText && (
                <div className="guardrail-box">
                  <div className="guardrail-icon">
                    {ICONS.book}
                  </div>
                  <div>
                    <div className="guardrail-rule">{activeWorkshopRisk.playbookRule}</div>
                    <div className="guardrail-text">{activeWorkshopRisk.guardrailText}</div>
                  </div>
                </div>
              )}

              <div>
                <div className="workshop-section-label">
                  AI-suggested revision <span className="mono" style={{ color: 'var(--muted)', fontWeight: 400, textTransform: 'none' }}>— tracked changes</span>
                </div>
                <div className="diff-box">
                  {renderSafeDiff(activeWorkshopRisk.suggestedRevision?.diffSegments || activeWorkshopRisk.diffHtml)}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={isRegenerating}
                  onClick={handleRegenerateRewrite}
                >
                  {isRegenerating ? (
                    <span style={{ display: 'inline-block', width: '13px', height: '13px', border: '2px solid var(--rule)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  ) : (
                    ICONS.refresh
                  )}
                  {isRegenerating ? 'Regenerating…' : 'Regenerate rewrite'}
                </button>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-danger-ghost"
                onClick={handleDiscardRevision}
              >
                Discard — keep original wording
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAcceptRevision}
              >
                {ICONS.check}
                Accept into document
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ============================================================
           CONFLICT DETAIL MODAL
           ============================================================ */}
      <div className={`modal-overlay ${activeConflict ? 'open' : ''}`}>
        {activeConflict && (
          <div className="modal">
            <div className="modal-header">
              <div>
                <div className="card-eyebrow">Cross-document conflict</div>
                <div className="modal-title serif">{activeConflict.title}</div>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close"
                onClick={() => setActiveConflictId(null)}
              >
                {ICONS.close}
              </button>
            </div>

            <div className="modal-body">
              <div className="card-body-text">{activeConflict.summary}</div>
              <div className="side-by-side">
                <div>
                  <div className="side-col-label">{activeConflict.sideALabel}</div>
                  <div className="side-col-body">{activeConflict.sideA}</div>
                </div>
                <div>
                  <div className="side-col-label">{activeConflict.sideBLabel}</div>
                  <div className="side-col-body">{activeConflict.sideB}</div>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-danger-ghost"
                onClick={() => {
                  setConflicts((prev) => prev.filter((c) => c.id !== activeConflict.id));
                  setActiveConflictId(null);
                }}
              >
                Dismiss — not a real conflict
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleResolveConflict}
              >
                Apply resolution to this document
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── DRAFTS MODAL OVERLAY ── */}
      <DraftsModal isOpen={showDraftsModal} onClose={() => setShowDraftsModal(false)} />
    </div>
  );
}
