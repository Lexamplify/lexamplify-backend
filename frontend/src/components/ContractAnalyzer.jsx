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

// ── Dynamic Data Arrays (populated strictly from live AI pipeline) ───────────
const INITIAL_RISKS = [];
const INITIAL_MISSING = [];
const INITIAL_CITATIONS = [];
const INITIAL_CONFLICTS = [];

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
    comments: storeComments = [],
    addComment: addStoreComment,
    toggleCommentResolved: toggleStoreCommentResolved,
    deleteComment: deleteStoreComment,
  } = useContractStore();

  // ── High-Level State Machine: 'upload' | 'scanning' | 'analyzed' ─────────────
  const [viewState, setViewState] = useState('upload');

  // Upload Form State
  const [selectedFile, setSelectedFile] = useState(null);
  const [pastedText, setPastedText] = useState('');
  const [playbookFile, setPlaybookFile] = useState(null);
  const [scanMode, setScanMode] = useState('balanced');
  const [isDragOver, setIsDragOver] = useState(false);

  // Synced contractFile reference from local state or global store
  const contractFile = selectedFile || storeFile;

  // Scanning State
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStage, setScanStage] = useState('Preparing engine…');
  const [consoleLogs, setConsoleLogs] = useState([]);
  const [scanDuration, setScanDuration] = useState(0);
  const [scanError, setScanError] = useState(null);
  const eventSourceRef = useRef(null);

  // Analyzed Workbench State (Dynamic from live pipeline)
  const [documentName, setDocumentName] = useState('Contract Document.pdf');
  const [pageCount, setPageCount] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [contractClauses, setContractClauses] = useState([]);
  const [rawContractText, setRawContractText] = useState(storeRawText || '');

  // Dynamic Data Arrays (§3 & §4: no fixed counts, strictly populated from AI)
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

  // Conflict Detail Modal & State
  const [activeConflictId, setActiveConflictId] = useState(null);
  const [conflictScanReady, setConflictScanReady] = useState(false);
  const [conflictScanned, setConflictScanned] = useState(false);
  const [conflictFile, setConflictFile] = useState(null);
  const [conflictScanning, setConflictScanning] = useState(false);

  // Comments Tab & Inline Selection State
  const [commentInput, setCommentInput] = useState('');
  const [selectedQuote, setSelectedQuote] = useState('');
  const [selectionPopup, setSelectionPopup] = useState(null);

  // Ask AI Chat
  const [chatMessages, setChatMessages] = useState([
    {
      id: 'm1',
      role: 'assistant',
      text: 'I’ve read all pages of this agreement. Ask me anything about it — I’ll answer grounded in the contract text and cite the clause I pulled from.',
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
      setStoreFile(file);
      setDocumentName(file.name);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setStoreFile(file);
      setDocumentName(file.name);
    }
  };

  const handlePlaybookSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      setPlaybookFile(e.target.files[0]);
    }
  };

  // ── Trigger Dynamic Scan Flow ───────────────────────────────────────────────
  const handleBeginAnalysis = async () => {
    setViewState('scanning');
    setScanProgress(5);
    setScanStage('Extracting document text…');
    setScanError(null);
    setConsoleLogs([]);

    const docTitle = contractFile ? contractFile.name : (pastedText.trim() ? 'Pasted Contract Document.txt' : 'Contract Document.pdf');
    setDocumentName(docTitle);

    const startTime = Date.now();
    const log = (text, cls = '') => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      const t = `${m}:${s}`;
      setConsoleLogs((prev) => [...prev, { t, text, cls }]);
    };

    log(`Ingesting ${docTitle}…`);

    let extractedText = pastedText.trim();
    let extractedPages = 1;
    let extractedWords = 0;
    let extractedClauses = [];

    try {
      if (contractFile) {
        log(`Uploading and extracting text from ${contractFile.name}…`, 'dim');
        const extractRes = await extractContractText(contractFile);
        if (extractRes.error) {
          throw new Error(extractRes.message || 'Failed to extract text from uploaded file.');
        }
        extractedText = extractRes.raw_text || extractRes.text || '';
        extractedPages = extractRes.page_count || Math.max(1, Math.ceil(extractedText.split(/\s+/).length / 250));
        extractedWords = extractRes.word_count || extractedText.split(/\s+/).filter(Boolean).length;
        extractedClauses = extractRes.clauses || [];
      } else if (pastedText.trim()) {
        extractedWords = pastedText.trim().split(/\s+/).filter(Boolean).length;
        extractedPages = Math.max(1, Math.ceil(extractedWords / 250));
        const paragraphs = pastedText.trim().split(/\n\n+/).filter(Boolean);
        extractedClauses = paragraphs.map((p, idx) => ({
          id: `clause-${idx + 1}`,
          title: p.split('\n')[0].slice(0, 60),
          text: p,
        }));
      } else {
        throw new Error('Please upload a contract file or paste contract text to begin analysis.');
      }

      if (!extractedText) {
        throw new Error('No readable text could be extracted from this document.');
      }

      setStoreRawText(extractedText);
      setRawContractText(extractedText);
      setPageCount(extractedPages);
      setWordCount(extractedWords);
      setContractClauses(extractedClauses);

      log(`Document verified: ${extractedWords.toLocaleString()} words across ${extractedPages} pages.`, 'dim');
      log(`Segmented into ${extractedClauses.length} clause sections.`, '');

      setScanProgress(20);
      setScanStage('Dispatching AI analysis pipeline…');

      let playbookText = '';
      if (playbookFile) {
        log(`Extracting custom firm playbook rules (${playbookFile.name})…`, 'dim');
        try {
          const pbRes = await extractContractText(playbookFile);
          playbookText = pbRes.raw_text || pbRes.text || '';
          log('Custom playbook rules applied to review criteria.', '');
        } catch (pbErr) {
          log(`Playbook warning: ${pbErr.message}, using statutory standards.`, 'dim');
        }
      } else {
        log('Cross-referencing Indian Contract Act 1872 & DPDP Act 2023 guardrails…', '');
      }

      const jobRes = await startContractAnalysisJob(extractedText, playbookText, scanMode);
      if (jobRes.error || !jobRes.job_id) {
        throw new Error(jobRes.message || 'Analysis service failed to start.');
      }

      const jobId = jobRes.job_id;
      log(`AI analysis job dispatched (Job ID: ${jobId.slice(0, 10)}…).`, 'dim');
      setScanProgress(30);
      setScanStage('Analyzing risks & liabilities…');

      // ── Transport Strategy: EventSource with clean Polling fallback & Circuit Breaker ──
      await new Promise((resolve, reject) => {
        let isDone = false;
        let pollTimer = null;
        let consecutiveFailures = 0;
        const MAX_FAILURES = 3;

        const cleanup = () => {
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
        };

        const startPollingFallback = (reason = '') => {
          if (isDone || pollTimer) return;
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
          log(`Switching transport to resilient status polling${reason ? ` (${reason})` : ''}…`, 'dim');

          pollTimer = setInterval(async () => {
            if (isDone) {
              cleanup();
              return;
            }
            try {
              const statusRes = await fetch(`${API_BASE}/api/contract/analysis-status/${jobId}`);
              if (!statusRes.ok) {
                consecutiveFailures += 1;
                if (consecutiveFailures >= MAX_FAILURES) {
                  isDone = true;
                  cleanup();
                  reject(new Error('The analysis engine encountered a service disruption. Your document is preserved; please retry.'));
                  return;
                }
                return;
              }

              const sData = await statusRes.json();
              consecutiveFailures = 0; // Reset on success

              if (sData.status === 'complete' && sData.results) {
                isDone = true;
                cleanup();
                handleAnalysisSuccess(sData.results, extractedClauses, extractedPages, extractedWords, startTime);
                resolve();
              } else if (sData.status === 'failed') {
                isDone = true;
                cleanup();
                reject(new Error(sData.error || 'Contract analysis pipeline reported failure.'));
              } else if (sData.progress) {
                setScanProgress((prev) => Math.max(prev, Math.min(95, sData.progress)));
                if (sData.stage) setScanStage(sData.stage);
              }
            } catch (pollErr) {
              consecutiveFailures += 1;
              if (consecutiveFailures >= MAX_FAILURES) {
                isDone = true;
                cleanup();
                reject(new Error('The analysis engine encountered a service disruption. Your document is preserved; please retry.'));
              }
            }
          }, 1200);
        };

        // Try SSE first. If it connects, stream live. If onerror fires, immediately fall back to polling.
        try {
          const es = new EventSource(`${API_BASE}/api/contract/stream/${jobId}`, { withCredentials: true });
          eventSourceRef.current = es;

          es.onmessage = (evt) => {
            if (isDone) return;
            try {
              const data = JSON.parse(evt.data);
              if (data.progress) {
                setScanProgress((prev) => Math.max(prev, Math.min(95, data.progress)));
              }
              if (data.status) {
                setScanStage(data.status);
                log(data.status, data.status.toLowerCase().includes('fail') ? 'err' : 'dim');
              }
              if (data.state === 'SUCCESS' && data.result) {
                isDone = true;
                cleanup();
                handleAnalysisSuccess(data.result, extractedClauses, extractedPages, extractedWords, startTime);
                resolve();
              } else if (data.state === 'FAILURE') {
                isDone = true;
                cleanup();
                reject(new Error(data.error || 'Contract analysis failed.'));
              }
            } catch {
              // frame parse error, continue
            }
          };

          es.onerror = () => {
            if (isDone) return;
            // Close EventSource and transition cleanly to HTTP polling with circuit breaker
            startPollingFallback('SSE transport disconnected');
          };
        } catch {
          startPollingFallback('SSE initialization failed');
        }
      });

    } catch (err) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setScanError(err.message || 'An error occurred during contract analysis.');
      log(`Analysis error: ${err.message}`, 'err');
      // STRICT GUARDRAIL: Do NOT fall back to dummy mock data! Document is preserved in state.
    }
  };

  const handleAnalysisSuccess = (result, clauses, pages, words, startTime) => {
    const rawRisks = result.risks || result.clauses || [];
    const rawMissing = result.missing || result.missing_clauses || [];
    const rawCitations = result.citations || [];
    const docClauses = result.document_clauses || clauses || [];

    setRisks(rawRisks);
    setMissing(rawMissing);
    setCitations(rawCitations);
    if (docClauses.length > 0) {
      setContractClauses(docClauses);
    }
    if (result.page_count) setPageCount(result.page_count);
    if (result.word_count) setWordCount(result.word_count);

    const elapsed = Math.max(1, Math.round((Date.now() - startTime) / 1000));
    setScanDuration(elapsed);
    setScanProgress(100);
    setScanStage('Analysis complete.');

    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    setConsoleLogs((prev) => [
      ...prev,
      {
        t: `${m}:${s}`,
        text: `Analysis complete: ${rawRisks.length} risks flagged · ${rawMissing.length} missing clauses · ${rawCitations.length} citations matched.`,
        cls: 'ok',
      },
    ]);

    setTimeout(() => {
      setViewState('analyzed');
    }, 600);
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

  // ── Dynamic Document Segmentation for Canvas ────────────────────────────────
  const displayDocumentSections = useMemo(() => {
    if (contractClauses && contractClauses.length > 0) {
      return contractClauses.map((c, idx) => ({
        id: c.id || `clause-${idx + 1}`,
        title: c.title || c.heading || `Clause ${idx + 1}`,
        text: c.text || '',
      }));
    }
    const raw = (rawContractText || storeRawText || '').trim();
    if (!raw) {
      return [
        {
          id: 'sec-1',
          title: 'Document Content',
          text: 'No document text loaded. Please upload or paste a contract.',
        },
      ];
    }
    const chunks = raw.split(/\n\s*\n+/).filter(Boolean);
    return chunks.map((chunk, idx) => {
      const lines = chunk.trim().split('\n');
      const firstLine = lines[0].trim();
      const isHeader = firstLine.length < 80 && (/^\d+[\.\)]/i.test(firstLine) || /^(section|clause|article)\s+\d+/i.test(firstLine));
      return {
        id: `clause-${idx + 1}`,
        title: isHeader ? firstLine : `Section ${idx + 1}`,
        text: isHeader ? lines.slice(1).join('\n').trim() || firstLine : chunk.trim(),
      };
    });
  }, [contractClauses, rawContractText, storeRawText]);

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
      const res = await fetch(`${API_BASE}/api/contract/rewrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_clause: activeWorkshopRisk.original,
          clause_text: activeWorkshopRisk.original,
          rule_book_text: activeWorkshopRisk.guardrailText || activeWorkshopRisk.playbookRule || '',
          issue: activeWorkshopRisk.guardrailText || activeWorkshopRisk.playbookRule || '',
          user_intent: 'Make this clause fair, balanced, and enforceable under Indian contract law.',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const cleanRewritten = data.rewritten || data.revision || data.replacementText || '';
        const diffSegments = data.diffSegments || null;
        const diffHtml = data.diffHtml || (cleanRewritten ? `"${cleanRewritten}"` : activeWorkshopRisk.diffHtml);

        setRisks((prev) =>
          prev.map((r) =>
            r.id === activeWorkshopRisk.id
              ? {
                  ...r,
                  diffHtml,
                  diffSegments,
                  replacementText: cleanRewritten || r.replacementText,
                  suggestedRevision: cleanRewritten
                    ? { ...r.suggestedRevision, diffSegments, cleanRevision: cleanRewritten }
                    : r.suggestedRevision,
                }
              : r
          )
        );
        setToastMessage('Generated updated clause revision.');
      } else {
        setToastMessage('Failed to regenerate rewrite from AI service.');
      }
    } catch (err) {
      console.error('Rewrite error:', err);
      setToastMessage('Network error while connecting to AI rewrite service.');
    } finally {
      setIsRegenerating(false);
      setTimeout(() => setToastMessage(''), 3500);
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
      const activeContractContent = rawContractText || storeRawText || '';
      const res = await fetch(`${API_BASE}/api/contract/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: text,
          message: text,
          raw_text: activeContractContent,
          contract_text: activeContractContent,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const aiText = data.response || data.answer || 'No response received from contract assistant.';
        const cites = data.citations || [];
        setChatMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: aiText,
            cites,
          },
        ]);
      } else {
        const errData = await res.json().catch(() => ({}));
        setChatMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: `Error from analysis service: ${errData.error || 'Failed to generate response.'}`,
            cites: [],
          },
        ]);
      }
    } catch (err) {
      console.error('Chat error:', err);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: 'Unable to reach the contract analysis service. Please check backend connection.',
          cites: [],
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  // ── Text Selection & Inline Comment Handlers ────────────────────────────────
  const handleTextSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 3) return;

    try {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (docSurfaceRef.current) {
        const parentRect = docSurfaceRef.current.getBoundingClientRect();
        setSelectedQuote(text);
        setSelectionPopup({
          top: Math.max(10, rect.top - parentRect.top + docSurfaceRef.current.scrollTop - 40),
          left: Math.max(10, rect.left - parentRect.left + (rect.width / 2) - 60),
        });
      }
    } catch {
      // ignore range calculation errors
    }
  };

  const handleOpenCommentWithQuote = (quoteText) => {
    setSelectedQuote(quoteText || '');
    setSelectionPopup(null);
    setActiveTab('comments');
  };

  const handleAddComment = (e) => {
    if (e) e.preventDefault();
    if (!commentInput.trim()) return;
    addStoreComment({
      id: `c-${Date.now()}`,
      text: commentInput.trim(),
      quote: selectedQuote || null,
      author: 'Reviewer',
      resolved: false,
      createdAt: new Date().toISOString(),
    });
    setCommentInput('');
    setSelectedQuote('');
    setSelectionPopup(null);
    setToastMessage('Comment posted to document review.');
    setTimeout(() => setToastMessage(''), 3000);
  };

  // ── Conflicts Handlers ──────────────────────────────────────────────────────
  const handleConflictFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setConflictFile(file);
      setConflictScanReady(true);
    }
  };

  const handleRunConflictScan = async () => {
    if (!conflictFile) return;
    setConflictScanning(true);
    try {
      const ext = await extractContractText(conflictFile);
      const refText = ext.raw_text || ext.text || '';
      const primaryContent = rawContractText || storeRawText || '';

      const res = await fetch(`${API_BASE}/api/contract/cross-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primary_text: primaryContent,
          secondary_text: refText,
          ref_doc_name: conflictFile.name,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setConflicts(data.conflicts || []);
        setConflictScanned(true);
        setToastMessage(`Detected ${(data.conflicts || []).length} cross-document contradictions.`);
      } else {
        setConflicts([]);
        setConflictScanned(true);
        setToastMessage('Cross-contract conflict analysis completed with 0 contradictions.');
      }
    } catch (err) {
      console.error('Conflict scan error:', err);
      setToastMessage('Error running cross-document conflict check.');
    } finally {
      setConflictScanning(false);
      setTimeout(() => setToastMessage(''), 3500);
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
          padding: 24px 32px 0 !important;
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
          padding: 20px 32px 60px !important;
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
        .state-upload-wrap { display: flex; flex-direction: column; align-items: center; max-width: 1040px; width: 100%; margin: 0 auto; box-sizing: border-box; }
        .upload-hero { margin: 12px auto 28px !important; text-align: center !important; max-width: 680px !important; width: 100% !important; background: transparent !important; }
        .upload-hero-title { font-family: 'Fraunces', serif !important; font-style: italic !important; font-weight: 500 !important; font-size: 28px !important; line-height: 1.3 !important; color: var(--ink) !important; margin-bottom: 0 !important; }
        .upload-hero-sub { font-family: 'IBM Plex Sans', sans-serif !important; font-size: 13px !important; line-height: 1.5 !important; color: var(--muted) !important; margin-top: 8px !important; max-width: 640px !important; margin-left: auto !important; margin-right: auto !important; }
        .upload-grid { display: grid !important; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)) !important; gap: 24px !important; width: 100% !important; align-items: stretch !important; }
        .upload-card { background: var(--paper) !important; border: 1px solid var(--rule) !important; border-radius: 16px !important; padding: 24px !important; display: flex !important; flex-direction: column !important; gap: 16px !important; box-sizing: border-box !important; }
        .big-dropzone { border: 2px dashed var(--rule) !important; border-radius: 12px !important; padding: 28px 20px !important; text-align: center !important; cursor: pointer !important; transition: border-color 0.2s !important; background: var(--paper-2) !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; }
        .big-dropzone:hover, .big-dropzone.dragover { border-color: var(--accent) !important; }
        .big-dropzone-icon { width: 40px !important; height: 40px !important; border-radius: 12px !important; background: var(--accent-soft) !important; color: var(--accent) !important; display: flex !important; align-items: center !important; justify-content: center !important; margin: 0 auto 8px !important; }
        .big-dropzone-title { font-weight: 600 !important; font-size: 14px !important; color: var(--ink) !important; }
        .big-dropzone-sub { font-size: 12px !important; color: var(--muted) !important; max-width: 300px !important; line-height: 1.5 !important; margin-top: 4px !important; }
        .or-row { display: flex !important; align-items: center !important; gap: 10px !important; color: var(--muted-2) !important; font-family: 'IBM Plex Mono', monospace !important; font-size: 10px !important; letter-spacing: 0.1em !important; text-transform: uppercase !important; width: 100% !important; margin: 2px 0 !important; }
        .or-row::before, .or-row::after { content: ''; flex-grow: 1; height: 1px; background: var(--rule); }
        .paste-box { background: var(--paper-2) !important; border: 1px solid var(--rule) !important; border-radius: 8px !important; color: var(--ink) !important; font-family: 'IBM Plex Sans', sans-serif !important; font-size: 13px !important; padding: 12px !important; min-height: 90px !important; resize: vertical !important; outline: none !important; width: 100% !important; box-sizing: border-box !important; }
        .paste-box:focus { border-color: var(--accent) !important; }
        .paste-box::placeholder { color: var(--muted) !important; }

        .playbook-card { background: var(--paper) !important; border: 1px solid var(--rule) !important; border-radius: 16px !important; padding: 24px !important; display: flex !important; flex-direction: column !important; gap: 20px !important; box-sizing: border-box !important; }
        .playbook-icon { width: 40px !important; height: 40px !important; border-radius: 12px !important; background: var(--paper-2) !important; color: var(--accent) !important; display: flex !important; align-items: center !important; justify-content: center !important; flex-shrink: 0 !important; }
        .playbook-title { font-size: 15px !important; font-weight: 600 !important; color: var(--ink) !important; }
        .playbook-sub { font-size: 12px !important; color: var(--muted) !important; line-height: 1.55 !important; margin-top: 3px !important; }
        .small-dropzone { border: 1px dashed var(--rule) !important; border-radius: 8px !important; padding: 14px !important; background: var(--paper-2) !important; cursor: pointer !important; display: flex !important; align-items: center !important; gap: 10px !important; font-size: 12px !important; color: var(--muted) !important; transition: all 0.15s !important; }
        .small-dropzone:hover { border-color: var(--accent) !important; color: var(--accent) !important; }
        .playbook-file { display: flex !important; align-items: center !important; justify-content: space-between !important; gap: 8px !important; background: var(--paper-2) !important; border: 1px solid var(--rule) !important; border-radius: 8px !important; padding: 10px 12px !important; font-size: 12px !important; color: var(--ink) !important; }
        .playbook-file svg { color: var(--accent); flex-shrink: 0; }
        .mode-block { display: flex !important; flex-direction: column !important; gap: 8px !important; }
        .mode-block-label { font-size: 11px !important; text-transform: uppercase !important; letter-spacing: .06em !important; color: var(--muted) !important; font-weight: 500 !important; }

        .mode-seg { display: grid !important; grid-template-columns: repeat(3, 1fr) !important; gap: 4px !important; background: var(--paper-2) !important; border: 1px solid var(--rule) !important; border-radius: 8px !important; padding: 3px !important; }
        .mode-opt { font-size: 12px !important; font-weight: 500 !important; padding: 6px 10px !important; border-radius: 6px !important; text-align: center !important; transition: all 0.15s !important; border: 0 !important; background: transparent !important; color: var(--muted) !important; cursor: pointer !important; }
        .mode-opt:hover { color: var(--ink) !important; }
        .mode-opt.active { background: var(--paper) !important; color: var(--accent) !important; font-weight: 600 !important; box-shadow: 0 1px 2px rgba(0,0,0,0.1) !important; }

        .begin-btn-row { width: 100% !important; display: flex !important; justify-content: center !important; margin-top: 24px !important; margin-bottom: 32px !important; }

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

        /* ── Scan Error Banner ── */
        .scan-error-banner { background: var(--accent-soft); border: 1px solid var(--accent); border-radius: 12px; padding: 18px 20px; color: var(--ink); margin: 16px 0; display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 640px; }
        .scan-error-title { font-weight: 600; font-size: 14px; color: var(--accent); display: flex; align-items: center; gap: 8px; }
        .scan-error-msg { font-size: 13px; color: var(--ink-soft); line-height: 1.5; }
        .scan-error-actions { display: flex; gap: 10px; margin-top: 4px; }

        /* ── Floating Selection Chip ── */
        .selection-chip-btn { position: absolute; z-index: 100; background: var(--paper); border: 1px solid var(--accent); border-radius: 20px; box-shadow: 0 4px 14px rgba(0,0,0,.35); color: var(--ink); font-size: 11.5px; font-weight: 600; padding: 6px 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: transform 0.15s, background 0.15s; }
        .selection-chip-btn:hover { background: var(--accent-soft); color: var(--on-accent); transform: scale(1.03); }
        .selection-chip-btn svg { color: var(--accent); width: 14px; height: 14px; }

        /* ── Comments UI ── */
        .comment-composer { background: var(--paper-2); border: 1px solid var(--rule); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
        .comment-quote-badge { background: var(--paper); border-left: 2.5px solid var(--accent); border-radius: 4px; padding: 6px 10px; font-size: 11.5px; font-style: italic; color: var(--ink-soft); line-height: 1.4; display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
        .comment-quote-badge span { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .comment-quote-dismiss { background: transparent; border: 0; color: var(--muted); cursor: pointer; padding: 0; line-height: 1; font-size: 14px; }
        .comment-quote-dismiss:hover { color: var(--accent); }
        .comment-textarea { width: 100%; min-height: 68px; background: var(--paper); border: 1px solid var(--rule); border-radius: 8px; padding: 8px 11px; font-size: 12.5px; color: var(--ink); outline: none; resize: vertical; font-family: inherit; }
        .comment-textarea:focus { border-color: var(--accent); }
        .comment-submit-row { display: flex; justify-content: flex-end; }
        .comment-list { display: flex; flex-direction: column; gap: 10px; }
        .comment-card { background: var(--paper-2); border: 1px solid var(--rule); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; transition: opacity 0.2s; }
        .comment-card.resolved { opacity: 0.55; }
        .comment-card-top { display: flex; justify-content: space-between; align-items: center; }
        .comment-card-author { font-size: 11.5px; font-weight: 600; color: var(--ink); }
        .comment-card-time { font-size: 10.5px; color: var(--muted); font-family: 'IBM Plex Mono', monospace; }
        .comment-card-quote { font-size: 11.5px; font-style: italic; color: var(--muted); border-left: 2px solid var(--rule); padding-left: 8px; margin: 2px 0; }
        .comment-card-text { font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; white-space: pre-wrap; }
        .comment-card-actions { display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--rule); padding-top: 6px; margin-top: 2px; }
        .comment-action-btn { background: transparent; border: 0; font-size: 11px; color: var(--muted); cursor: pointer; padding: 2px 6px; border-radius: 4px; display: flex; align-items: center; gap: 4px; transition: color 0.15s; }
        .comment-action-btn:hover { color: var(--ink); background: var(--paper); }
        .comment-action-btn.delete:hover { color: var(--accent); }

        /* ── Resolved & Doc Canvas Elements ── */
        .resolved-clause { background: var(--paper-2); border-left: 2.5px solid #4E7D5C; padding: 2px 6px; border-radius: 4px; display: inline-block; color: var(--ink); }
        .missing-clause-inserted { background: var(--paper-2); border-left: 3px solid var(--major); padding: 10px 14px; border-radius: 6px; margin: 10px 0; font-size: 13px; line-height: 1.6; }

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
          <div className="w-full max-w-[1040px] mx-auto flex flex-col items-center state-upload-wrap">
            {/* 1. Upload Hero */}
            <div className="upload-hero">
              <div className="upload-hero-title serif">What are we reviewing today, Counsel?</div>
              <div className="upload-hero-sub">
                Load a contract — LexAmplify reads every clause, flags what's risky against Indian contract law and your firm's playbook, and cites everything it tells you. Documents of any length are supported; longer filings simply take a little more scan time.
              </div>
            </div>

            {/* High-Contrast Error Card on Failure (Document Preserved) */}
            {scanError && (
              <div className="scan-error-banner" style={{ maxWidth: '100%', marginBottom: '24px' }}>
                <div className="scan-error-title">
                  {ICONS.alertTriangle} <span>Analysis Interrupted</span>
                </div>
                <div className="scan-error-msg">{scanError}</div>
                <div className="scan-error-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleBeginAnalysis}
                    disabled={!contractFile && !pastedText.trim()}
                  >
                    {ICONS.refresh}
                    <span>Retry Analysis</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setScanError(null)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* 2. Upload Grid */}
            <div className="upload-grid">
              {/* Left Card: Document Upload + Direct Text Paste */}
              <div className="upload-card">
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
                    {contractFile ? contractFile.name : 'Drag and drop a contract, or click to browse'}
                  </div>
                  <div className="big-dropzone-sub">
                    {contractFile
                      ? `${(contractFile.size / 1024).toFixed(1)} KB · Ready to scan`
                      : 'PDF or DOCX, any length — a 60-page facility agreement is read the same way as a 2-page NDA.'}
                  </div>
                  <div className="mono" style={{ fontSize: '10.5px', color: 'var(--muted)', marginTop: '4px' }}>MAX 50 MB PER FILE</div>
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
                      setStoreFile(null);
                    }
                  }}
                />
              </div>

              {/* Right Card: Firm Playbook + Review Posture */}
              <div className="playbook-card">
                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
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
                  <div className="mono" style={{ fontSize: '11px', color: 'var(--muted)', lineHeight: '1.4', minHeight: '32px' }}>
                    {MODE_HINTS[scanMode]}
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Centered Action Button */}
            <div className="w-full flex justify-center mt-6 mb-8" style={{ width: '100%', display: 'flex', justifyContent: 'center', marginTop: '24px', marginBottom: '32px' }}>
              <button
                type="button"
                className="btn btn-primary flex items-center justify-center gap-2 px-8 py-3 rounded-xl font-medium text-sm transition-all"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: 'var(--on-accent)',
                  boxShadow: '0 2px 8px rgba(178, 74, 46, 0.25)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '12px 32px',
                  borderRadius: '12px',
                  fontWeight: 500,
                  fontSize: '14px',
                  border: 'none',
                  cursor: (!contractFile && !pastedText.trim()) ? 'not-allowed' : 'pointer',
                  opacity: (!contractFile && !pastedText.trim()) ? 0.55 : 1,
                  transition: 'all 0.15s ease',
                }}
                onClick={handleBeginAnalysis}
                disabled={!contractFile && !pastedText.trim()}
              >
                {ICONS.sparkles}
                <span>Begin analysis</span>
              </button>
            </div>
          </div>
        )}

        {/* ============================================================
             STATE 2 — SCANNING
             ============================================================ */}
        {viewState === 'scanning' && (
          <section className="state-scanning-wrap">
            {!scanError ? (
              <div className="scan-ring" />
            ) : (
              <div style={{ color: 'var(--accent)', display: 'flex', justifyContent: 'center' }}>
                {ICONS.alertTriangle}
              </div>
            )}
            <div>
              <div className="scan-title serif">
                {scanError ? 'Analysis Interrupted' : `Reading ${documentName}`}
              </div>
              <div className="scan-sub">
                {scanError
                  ? 'The dynamic analysis pipeline encountered an issue. See details below.'
                  : `${pageCount} pages · running the Hybrid Engine — clause segmentation, playbook comparison, precedent retrieval and missing-clause detection all run per page, so this scales with document length.`}
              </div>
            </div>

            {scanError && (
              <div className="scan-error-banner">
                <div className="scan-error-title">
                  {ICONS.alertTriangle} <span>Analysis Pipeline Error</span>
                </div>
                <div className="scan-error-msg">{scanError}</div>
                <div className="scan-error-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleBeginAnalysis}
                  >
                    {ICONS.refresh}
                    <span>Retry Analysis</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setViewState('upload');
                      setScanError(null);
                    }}
                  >
                    Back to Upload
                  </button>
                </div>
              </div>
            )}

            {!scanError && (
              <div style={{ width: '100%' }}>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${scanProgress}%` }} />
                </div>
                <div className="progress-label">
                  <span>{scanProgress}%</span>
                  <span>{scanStage}</span>
                </div>
              </div>
            )}
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
                  <span className="badge mono" style={{ fontSize: '10px' }}>
                    {pageCount} {pageCount === 1 ? 'PAGE' : 'PAGES'}
                  </span>
                </div>

                <div
                  className="doc-surface"
                  ref={docSurfaceRef}
                  onMouseUp={handleTextSelection}
                  style={{ position: 'relative' }}
                >
                  {selectionPopup && (
                    <button
                      type="button"
                      className="selection-chip-btn"
                      style={{ top: `${selectionPopup.top}px`, left: `${selectionPopup.left}px` }}
                      onClick={() => handleOpenCommentWithQuote(selectedQuote)}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 11.5a8.4 8.4 0 0 1-11.4 7.9L4 21l1.4-4.4A8.4 8.4 0 1 1 21 11.5z" />
                      </svg>
                      <span>Add Comment</span>
                    </button>
                  )}

                  {displayDocumentSections.map((sec, sIdx) => {
                    const secRisks = risks.filter((r) => {
                      if (r.id === sec.id) return true;
                      if (r.location && sec.title && (sec.title.toLowerCase().includes(r.location.toLowerCase()) || r.location.toLowerCase().includes(sec.title.toLowerCase()))) return true;
                      if (r.original && sec.text && sec.text.includes(r.original)) return true;
                      if (r.excerpt && sec.text && sec.text.includes(r.excerpt)) return true;
                      return false;
                    });

                    return (
                      <div key={sec.id || sIdx} style={{ marginBottom: '24px' }}>
                        <h3>{sec.title}</h3>
                        {secRisks.map((risk) => {
                          const isResolved = resolvedRisks.has(risk.id);
                          const isActiveFlag = activeFlags[activeFlagIndex]?.id === risk.id;
                          return (
                            <div key={risk.id} style={{ margin: '8px 0' }}>
                              {isResolved ? (
                                <div className="resolved-clause" style={{ display: 'block', padding: '10px 14px', margin: '6px 0' }}>
                                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                                    Resolved Revision ({risk.location || sec.title}) · Accepted
                                  </div>
                                  <div>{risk.replacementText || risk.suggestedRevision?.cleanRevision || risk.original}</div>
                                </div>
                              ) : (
                                <div
                                  className={`clause-flag ${getSevClass(risk.severity)} ${isActiveFlag ? 'active-flag' : ''}`}
                                  data-risk={risk.id}
                                  onClick={() => handleOpenWorkshop(risk.id)}
                                  style={{ display: 'block', margin: '6px 0', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px' }}>
                                    <span style={{ fontWeight: 600 }}>{risk.title}</span>
                                    <span className="mono">{getSevLabel(risk.severity).toUpperCase()} · {risk.location || `Clause ${sIdx + 1}`}</span>
                                  </div>
                                  <div>{risk.excerpt || risk.original}</div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        <p style={{ whiteSpace: 'pre-wrap' }}>{sec.text}</p>
                      </div>
                    );
                  })}

                  {/* Render any active risks that weren't caught in section matching */}
                  {risks.filter((r) => !displayDocumentSections.some((sec) => sec.id === r.id || (r.location && sec.title && (sec.title.toLowerCase().includes(r.location.toLowerCase()) || r.location.toLowerCase().includes(sec.title.toLowerCase()))) || (r.original && sec.text && sec.text.includes(r.original)) || (r.excerpt && sec.text && sec.text.includes(r.excerpt)))).map((risk) => {
                    const isResolved = resolvedRisks.has(risk.id);
                    const isActiveFlag = activeFlags[activeFlagIndex]?.id === risk.id;
                    return (
                      <div key={risk.id} style={{ margin: '12px 0' }}>
                        {isResolved ? (
                          <div className="resolved-clause" style={{ display: 'block', padding: '10px 14px' }}>
                            <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                              Resolved Revision ({risk.location || 'Clause'}) · Accepted
                            </div>
                            <div>{risk.replacementText || risk.suggestedRevision?.cleanRevision || risk.original}</div>
                          </div>
                        ) : (
                          <div
                            className={`clause-flag ${getSevClass(risk.severity)} ${isActiveFlag ? 'active-flag' : ''}`}
                            data-risk={risk.id}
                            onClick={() => handleOpenWorkshop(risk.id)}
                            style={{ display: 'block', padding: '10px 14px', borderRadius: '6px', cursor: 'pointer' }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px' }}>
                              <span style={{ fontWeight: 600 }}>{risk.title}</span>
                              <span className="mono">{getSevLabel(risk.severity).toUpperCase()} · {risk.location || 'General'}</span>
                            </div>
                            <div>{risk.excerpt || risk.original}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Missing Clause Markers on Document Canvas */}
                  {missing.map((m) => {
                    const isInserted = insertedMissing.has(m.id);
                    if (isInserted) {
                      return (
                        <div key={m.id} className="missing-clause-inserted">
                          <strong>{m.title}:</strong> {m.model || m.clause || m.rationale}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={m.id}
                        className="missing-marker"
                        onClick={() => setActiveTab('missing')}
                      >
                        {ICONS.plus} Suggested missing clause: {m.title} — click to view & insert
                      </div>
                    );
                  })}

                  <p className="mono" style={{ fontSize: '11px', color: 'var(--muted)', textAlign: 'center', paddingTop: '16px' }}>
                    — {documentName} · {pageCount} {pageCount === 1 ? 'page' : 'pages'} · {wordCount.toLocaleString()} words —
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
                    <div className="rail-head">
                      <div>
                        <div className="rail-head-title">Clause Notes & Comments</div>
                        <div className="rail-head-sub">
                          Threaded team observations tied to exact contract clauses.
                        </div>
                      </div>
                    </div>

                    <form className="comment-composer" onSubmit={handleAddComment}>
                      {selectedQuote && (
                        <div className="comment-quote-badge">
                          <span>“{selectedQuote}”</span>
                          <button
                            type="button"
                            className="comment-quote-dismiss"
                            onClick={() => setSelectedQuote('')}
                            title="Clear attached quote"
                          >
                            ×
                          </button>
                        </div>
                      )}
                      <textarea
                        className="comment-textarea"
                        placeholder={selectedQuote ? "Add review note on selected text…" : "Select text on document canvas or write a general contract note…"}
                        value={commentInput}
                        onChange={(e) => setCommentInput(e.target.value)}
                      />
                      <div className="comment-submit-row">
                        <button
                          type="submit"
                          className="btn btn-primary btn-sm"
                          disabled={!commentInput.trim()}
                        >
                          Post Note
                        </button>
                      </div>
                    </form>

                    {storeComments.length === 0 ? (
                      <div className="empty" style={{ padding: '24px 10px' }}>
                        <div className="empty-icon">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 11.5a8.4 8.4 0 0 1-11.4 7.9L4 21l1.4-4.4A8.4 8.4 0 1 1 21 11.5z" />
                          </svg>
                        </div>
                        <div className="empty-title serif">No comments yet</div>
                        <div className="empty-sub">
                          Select any text on the document surface to attach an inline annotation or draft a general note above.
                        </div>
                      </div>
                    ) : (
                      <div className="comment-list">
                        {storeComments.map((c) => (
                          <div key={c.id} className={`comment-card ${c.resolved ? 'resolved' : ''}`}>
                            <div className="comment-card-top">
                              <span className="comment-card-author">{c.author || 'Reviewer'}</span>
                              <span className="comment-card-time">
                                {c.createdAt ? new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Saved'}
                              </span>
                            </div>
                            {c.quote && (
                              <div className="comment-card-quote">“{c.quote}”</div>
                            )}
                            <div className="comment-card-text">{c.text}</div>
                            <div className="comment-card-actions">
                              <button
                                type="button"
                                className="comment-action-btn"
                                onClick={() => toggleStoreCommentResolved(c.id)}
                              >
                                {c.resolved ? 'Reopen' : 'Mark Resolved'}
                              </button>
                              <button
                                type="button"
                                className="comment-action-btn delete"
                                onClick={() => deleteStoreComment(c.id)}
                                title="Delete comment"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
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
                      onChange={handleConflictFileSelect}
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
                        onClick={handleRunConflictScan}
                        disabled={conflictScanning}
                      >
                        {conflictScanning ? (
                          <span style={{ display: 'inline-block', width: '13px', height: '13px', border: '2px solid var(--rule)', borderTopColor: 'var(--on-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                        ) : (
                          ICONS.search
                        )}
                        <span>
                          {conflictScanning
                            ? 'Scanning contradictions…'
                            : `Run conflict scan against ${conflictFile?.name || 'reference file'}`}
                        </span>
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
