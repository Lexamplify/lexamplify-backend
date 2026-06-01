import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  analyzeContract,
  rewriteContractClause,
  fetchContractSummary,
  fetchContractRecommendations,
  chatWithContract,
  exportContract,
  fetchDocuments
} from '../services/api';

const styles = `
  .analyzer-container {
    font-family: var(--font-sans);
    color: var(--text-dark-primary);
    height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .analyzer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    flex-wrap: wrap;
    gap: 12px;
  }

  .strategy-select-container {
    display: flex;
    align-items: center;
    gap: 8px;
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    padding: 6px 12px;
    border-radius: 8px;
  }

  .strategy-dropdown {
    background: transparent;
    border: none;
    color: white;
    font-weight: 600;
    font-size: 13.5px;
    outline: none;
    cursor: pointer;
  }

  .strategy-dropdown option {
    background-color: var(--bg-dark-panel);
    color: white;
  }

  .summary-banner {
    background-color: rgba(59, 130, 246, 0.08);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 8px;
    padding: 12px 18px;
    margin-bottom: 16px;
    font-size: 13.5px;
    line-height: 1.5;
    flex-shrink: 0;
  }

  /* Split Pane Workspace */
  .workspace-pane {
    flex: 1;
    display: grid;
    grid-template-columns: 1.1fr 0.9fr;
    gap: 20px;
    overflow: hidden;
    height: 100%;
  }

  @media (max-width: 1024px) {
    .workspace-pane {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr 1fr;
      overflow-y: auto;
    }
  }

  /* Left Pane: Editor & Code */
  .editor-column {
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .editor-header-bar {
    background-color: var(--bg-dark-sidebar);
    padding: 12px 20px;
    border-bottom: 1px solid var(--border-dark-subtle);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }

  .editor-tabs {
    display: flex;
    gap: 8px;
  }

  .editor-tab-btn {
    background: transparent;
    border: none;
    color: var(--text-dark-muted);
    padding: 6px 12px;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s;
  }

  .editor-tab-btn:hover {
    color: white;
    background-color: rgba(255, 255, 255, 0.03);
  }

  .editor-tab-btn.active {
    color: white;
    background-color: rgba(255, 255, 255, 0.08);
    font-weight: 600;
  }

  /* Rich Text Formatting Toolbar */
  .rich-text-toolbar {
    background-color: #1f2937 !important; /* bg-gray-800 */
    border-bottom: 1px solid #374151 !important; /* border-gray-700 */
    display: flex;
    gap: 6px;
    padding: 8px 16px;
    flex-wrap: wrap;
    align-items: center;
  }

  .toolbar-btn {
    background: transparent;
    border: none;
    color: #e5e7eb !important; /* text-gray-200 */
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 28px;
    transition: all 0.2s ease-in-out;
  }

  .toolbar-btn:hover {
    background-color: #374151 !important; /* hover bg-gray-700 */
    color: #ffffff !important;
  }

  .toolbar-divider {
    width: 1px;
    height: 18px;
    background-color: #374151; /* gray-700 */
    margin: 0 4px;
  }

  .editor-scroll-area {
    flex: 1;
    overflow-y: auto;
    padding: 32px;
    background-color: #F9F9F9;
    color: #1F2937;
  }

  .scanner-body {
    outline: none;
    font-family: var(--font-serif);
    font-size: 18px !important;
    line-height: 1.625 !important;
    white-space: pre-wrap;
    color: #1F2937;
    min-height: 70vh !important;
    padding: 40px !important;
    background-color: #ffffff;
    border-radius: 4px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
    box-sizing: border-box;
  }

  /* Right Pane: Analysis Workspace */
  .analysis-column {
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .analysis-tabs-bar {
    background-color: var(--bg-dark-sidebar);
    border-bottom: 1px solid var(--border-dark-subtle);
    display: flex;
    overflow-x: auto;
    flex-shrink: 0;
  }

  .analysis-tab-btn {
    background: transparent;
    border: none;
    color: var(--text-dark-muted);
    padding: 14px 16px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
  }

  .analysis-tab-btn:hover {
    color: white;
    background-color: rgba(255, 255, 255, 0.02);
  }

  .analysis-tab-btn.active {
    color: var(--accent-primary);
    border-bottom-color: var(--accent-primary);
    font-weight: 600;
  }

  .analysis-panel-body {
    flex: 1;
    overflow-y: auto;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  /* Initial Upload Layout */
  .upload-layout-container {
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    padding: 30px;
    max-width: 720px;
    margin: 40px auto;
    width: 100%;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
  }

  .drag-drop-zone {
    border: 2px dashed var(--border-dark-subtle);
    background-color: var(--bg-dark-app);
    border-radius: 10px;
    padding: 40px 20px;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.2s, background-color 0.2s;
    margin-bottom: 20px;
  }

  .drag-drop-zone:hover, .drag-drop-zone.dragover {
    border-color: var(--accent-primary);
    background-color: rgba(59, 130, 246, 0.03);
  }

  .input-textarea {
    width: 100%;
    height: 180px;
    background-color: var(--bg-dark-app);
    border: 1px solid var(--border-dark-subtle);
    color: var(--text-dark-primary);
    border-radius: 8px;
    padding: 14px;
    font-family: var(--font-sans);
    font-size: 13.5px;
    resize: none;
    outline: none;
    margin-bottom: 20px;
  }

  /* Risk markers & Details view */
  .risk-stat-bar {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
    font-size: 12.5px;
  }

  .risk-stat-item {
    display: flex;
    align-items: center;
    gap: 6px;
    background-color: rgba(255, 255, 255, 0.03);
    padding: 4px 10px;
    border-radius: 20px;
    border: 1px solid var(--border-dark-subtle);
  }

  .risk-indicator-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .risk-indicator-dot.red { background-color: var(--accent-danger); box-shadow: 0 0 6px var(--accent-danger); }
  .risk-indicator-dot.amber { background-color: var(--accent-warning); box-shadow: 0 0 6px var(--accent-warning); }
  .risk-indicator-dot.green { background-color: var(--accent-success); box-shadow: 0 0 6px var(--accent-success); }

  .inspected-risk-card {
    background-color: var(--bg-dark-card);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .original-clause-box {
    background-color: var(--bg-dark-app);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 6px;
    padding: 12px;
    font-family: var(--font-serif);
    font-size: 13.5px;
    line-height: 1.5;
    margin-top: 8px;
    max-height: 140px;
    overflow-y: auto;
  }

  .autocomplete-dropdown {
    position: absolute;
    background-color: var(--bg-dark-card);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 6px;
    box-shadow: 0 8px 16px rgba(0,0,0,0.4);
    z-index: 100;
    max-height: 180px;
    overflow-y: auto;
    width: 100%;
    margin-top: 2px;
  }

  .autocomplete-item {
    padding: 10px 14px;
    cursor: pointer;
    font-size: 13px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    transition: background-color 0.2s;
  }

  .autocomplete-item:hover {
    background-color: rgba(59, 130, 246, 0.1);
    color: white;
  }

  /* Chat bubble styles */
  .chat-bubble-stream {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-bottom: 16px;
    overflow-y: auto;
    margin-bottom: 12px;
  }

  .chat-message-bubble {
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13.5px;
    line-height: 1.4;
    max-width: 85%;
  }

  .chat-message-bubble.user {
    background-color: var(--accent-primary);
    color: white;
    align-self: flex-end;
    border-top-right-radius: 0;
  }

  .chat-message-bubble.bot {
    background-color: var(--bg-dark-card);
    border: 1px solid var(--border-dark-subtle);
    color: var(--text-dark-primary);
    align-self: flex-start;
    border-top-left-radius: 0;
  }

  /* Precedent precedent matching */
  .precedent-card {
    border: 1px solid var(--border-dark-subtle);
    background-color: var(--bg-dark-card);
    border-radius: 8px;
    padding: 14px;
  }

  .precedent-link {
    color: var(--accent-primary);
    text-decoration: none;
    font-weight: 600;
  }

  .precedent-link:hover {
    text-decoration: underline;
  }

  /* Recommendations Missing protective clauses */
  .rec-protection-card {
    background-color: var(--bg-dark-card);
    border: 1px solid var(--border-dark-subtle);
    border-left: 4px solid var(--accent-warning);
    border-radius: 8px;
    padding: 16px;
  }

  /* Loader and Modals */
  .shimmer-bar {
    background: linear-gradient(90deg, #1A1C26 25%, #222533 50%, #1A1C26 75%);
    background-size: 200% 100%;
    animation: shimmer-animation 1.5s infinite;
    border-radius: 4px;
    height: 14px;
    margin-bottom: 12px;
  }

  @keyframes shimmer-animation {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background-color: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }

  .export-modal-card {
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    width: 100%;
    max-width: 480px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  }

  .format-selection-card {
    border: 1px solid var(--border-dark-subtle);
    border-radius: 8px;
    padding: 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .format-selection-card.selected {
    border-color: var(--accent-primary);
    background-color: rgba(59, 130, 246, 0.05);
  }

  /* Tailwind CSS Utility Polyfills for component scopes */
  .p-4 {
    padding: 1rem !important;
  }
  @media (min-width: 768px) {
    .md\\:p-8 {
      padding: 2rem !important;
    }
  }

  .leading-relaxed {
    line-height: 1.625 !important;
  }
  .text-lg {
    font-size: 1.125rem !important;
  }

  .transition-all {
    transition-property: all !important;
  }
  .duration-300 {
    transition-duration: 300ms !important;
  }
  .ease-in-out {
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1) !important;
  }

  .hover\\:bg-gray-700:hover {
    background-color: #374151 !important;
  }
  .hover\\:-translate-y-0\\.5:hover {
    transform: translateY(-2px) !important;
  }
  .hover\\:shadow-lg:hover {
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.15) !important;
  }

  .transition-opacity {
    transition-property: opacity !important;
  }
  .opacity-0 {
    opacity: 0 !important;
  }
  .opacity-100 {
    opacity: 1 !important;
  }

  /* Form Input Styling for right console ONLY */
  .analysis-column select,
  .analysis-column input[type="text"],
  .analysis-column textarea,
  .input-textarea {
    background-color: #1f2937 !important;
    border: 1px solid #4b5563 !important;
    border-radius: 0.5rem !important;
    padding: 0.75rem !important;
    color: #ffffff !important;
    font-family: var(--font-sans);
    font-size: 14px;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }

  /* Premium Form Focus ring utilities */
  .focus\\:ring-2:focus {
    box-shadow: 0 0 0 2px #9ca3af !important; /* gray-400 focus ring */
  }
  .focus\\:ring-gray-400:focus {
    box-shadow: 0 0 0 2px #9ca3af !important;
  }
  .focus\\:outline-none:focus {
    outline: 2px solid transparent !important;
    outline-offset: 2px !important;
  }

  .analysis-column select:focus,
  .analysis-column input[type="text"]:focus,
  .analysis-column textarea:focus,
  .input-textarea:focus {
    border-color: #9ca3af !important;
    box-shadow: 0 0 0 2px #9ca3af !important;
  }

  /* Smooth Insertion Keyframe Animations (Strictly runs once) */
  @keyframes fadeHighlightIns {
    0% {
      background-color: #FEF08A !important; /* yellow-200 */
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    100% {
      background-color: #D1FAE5 !important; /* light green */
    }
  }

  @keyframes fadeHighlightBlockquote {
    0% {
      background-color: #FEF08A !important; /* yellow-200 */
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    100% {
      background-color: #F3F4F6 !important; /* light gray */
    }
  }

  /* Revision Diff styling */
  .revised-del {
    color: #DC2626 !important;
    text-decoration: line-through !important;
    background-color: #FEE2E2 !important;
    padding: 2px 4px !important;
    border-radius: 4px !important;
    margin-right: 4px !important;
    display: inline !important;
  }
  .revised-ins {
    color: #16A34A !important;
    text-decoration: none !important;
    background-color: #D1FAE5 !important;
    padding: 2px 4px !important;
    border-radius: 4px !important;
    font-weight: 500 !important;
    display: inline !important;
  }

  /* New revision class with animations */
  .newly-revised-ins {
    color: #16A34A !important;
    text-decoration: none !important;
    padding: 2px 4px !important;
    border-radius: 4px !important;
    font-weight: 500 !important;
    display: inline !important;
    animation: fadeHighlightIns 1.5s ease-in-out forwards;
  }

  /* Extensions Append styling */
  .extension-divider {
    border: 0;
    height: 1px;
    background: #E5E7EB;
    margin: 24px 0;
  }
  .extension-blockquote {
    border-left: 4px solid #3B82F6 !important;
    background-color: #F3F4F6 !important;
    padding: 16px 20px !important;
    margin: 0 0 20px 0 !important;
    border-radius: 0 8px 8px 0;
    color: #1F2937 !important;
    font-family: var(--font-serif);
    font-size: 15px;
    line-height: 1.6;
    text-align: left;
  }

  /* New appended blockquote with animations */
  .newly-appended-blockquote {
    border-left: 4px solid #3B82F6 !important;
    padding: 16px 20px !important;
    margin: 0 0 20px 0 !important;
    border-radius: 0 8px 8px 0;
    color: #1F2937 !important;
    font-family: var(--font-serif);
    font-size: 15px;
    line-height: 1.6;
    text-align: left;
    animation: fadeHighlightBlockquote 1.5s ease-in-out forwards;
  }

  .extension-title {
    display: block;
    margin-bottom: 8px;
    color: #1E3A8A;
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .extension-body {
    white-space: pre-wrap;
    outline: none;
  }

  .input-label {
    display: block;
    margin-bottom: 6px;
    color: var(--text-dark-muted);
    font-size: 11.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
`;

export default function ContractAnalyzer({ setFocusMode }) {
  const [isAnalyzed, setIsAnalyzed] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scanStrategy, setScanStrategy] = useState('Defensive');
  const [rawText, setRawText] = useState('');
  const [clauses, setClauses] = useState([]);
  const [summary, setSummary] = useState('');
  
  // Tab states
  const [activeTab, setActiveTab] = useState('risks');
  const [leftTab, setLeftTab] = useState('scanner');
  
  // Tab opacity fade-in transition state
  const [tabOpacity, setTabOpacity] = useState('opacity-100');

  // Document editor states
  const [editorHtml, setEditorHtml] = useState('');
  const [activeClauseId, setActiveClauseId] = useState(null);
  
  // Interactive Rewrite states
  const [intent, setIntent] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [rewrittenText, setRewrittenText] = useState('');
  const [rewriting, setRewriting] = useState(false);
  
  // Recommendations states
  const [recommendations, setRecommendations] = useState([]);
  const [loadingRecs, setLoadingRecs] = useState(false);
  
  // Appended clause extensions
  const [appendedClauses, setAppendedClauses] = useState([]);

  // Auto-Drafting states
  const [vaultDocs, setVaultDocs] = useState([]);
  const [selectedDocId, setSelectedDocId] = useState('');
  const [autoDraftPrompt, setAutoDraftPrompt] = useState('');
  const [autoDraftText, setAutoDraftText] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftStatus, setDraftStatus] = useState('');

  // Chat RAG states
  const [chatHistory, setChatHistory] = useState([
    { sender: 'bot', text: 'Hello. I have loaded this contract. You can ask grounded queries about notice periods, indemnities, or governing law, and I will search the text strictly.' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  
  // Export Modal states
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState('pdf');
  const [includeDoc, setIncludeDoc] = useState(true);
  const [includeDraft, setIncludeDraft] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const fileInputRef = useRef(null);
  const editorRef = useRef(null);
  const suggestionsRef = useRef(null);
  const chatStreamRef = useRef(null);

  // Auto-Collapse Sidebar on Mount (Focus Mode)
  useEffect(() => {
    if (setFocusMode) {
      setFocusMode(true);
    }
    return () => {
      if (setFocusMode) {
        setFocusMode(false);
      }
    };
  }, [setFocusMode]);

  // Load vault documents on mount for auto-draft context
  useEffect(() => {
    const loadVaultDocs = async () => {
      const res = await fetchDocuments();
      if (!res.error) {
        setVaultDocs(res);
      }
    };
    loadVaultDocs();
  }, []);

  // Update highlighted editor HTML when rawText or clauses change
  useEffect(() => {
    if (isAnalyzed) {
      const html = renderDocumentScanner(rawText, clauses);
      setEditorHtml(html);
    }
  }, [rawText, clauses, isAnalyzed]);

  // Autocomplete Suggestions based on inspected clause
  const activeClause = clauses.find(c => c.id === activeClauseId);
  const dynamicIntents = activeClause ? getDynamicIntents(activeClause.text, activeClause.risk) : [];

  // Tab switch helper with fade animations
  const switchTab = (tabId) => {
    setTabOpacity('opacity-0');
    setTimeout(() => {
      setActiveTab(tabId);
      setTabOpacity('opacity-100');
    }, 150);
  };

  // formatting commands helper for ExecCommand
  const handleFormat = (command) => {
    document.execCommand(command, false, null);
  };

  // ── 1. FILE UPLOAD & ANALYZE HANDLERS ────────────────────────────────
  const handleFileUpload = async (files) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    
    // Limits
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx'].includes(extension)) {
      alert('Invalid format. Please upload PDF or DOCX.');
      return;
    }

    setIsAnalyzing(true);
    const res = await analyzeContract(file, '', scanStrategy);
    setIsAnalyzing(false);
    
    if (res.error) {
      alert(res.message || 'Analysis failed. Please verify the backend status.');
    } else {
      loadAnalysisResults(res);
    }
  };

  const handleTextAnalyze = async () => {
    if (!rawText.trim()) {
      alert('Please paste contract text or select a file to analyze.');
      return;
    }
    
    setIsAnalyzing(true);
    const res = await analyzeContract(null, rawText, scanStrategy);
    setIsAnalyzing(false);

    if (res.error) {
      alert(res.message || 'Analysis failed.');
    } else {
      loadAnalysisResults(res);
    }
  };

  const loadAnalysisResults = (data) => {
    const rawClauses = data.clauses || [];
    const mapped = rawClauses.map((c, idx) => ({
      id: c.id != null ? String(c.id) : `auto-${idx}`,
      text: c.text || c.original_text || '',
      risk: c.risk || (c.risk_level === 'High' ? 'RED' : c.risk_level === 'Medium' ? 'AMBER' : 'GREEN'),
      issue: c.issue || c.explanation || 'Risk identified.'
    }));
    
    setClauses(mapped);
    setRawText(data.raw_text || mapped.map(c => c.text).join('\n\n'));
    setSummary(data.summary || 'Summary generated successfully.');
    setIsAnalyzed(true);
    setActiveClauseId(null);
    setRewrittenText('');
    setIntent('');
    setAppendedClauses([]);
  };

  // Re-run analysis on strategy switch
  const handleStrategyChange = async (newStrategy) => {
    setScanStrategy(newStrategy);
    if (isAnalyzed && rawText) {
      setIsAnalyzing(true);
      const res = await analyzeContract(null, rawText, newStrategy);
      setIsAnalyzing(false);
      if (!res.error) {
        loadAnalysisResults(res);
      } else {
        alert('Failed to re-analyze contract: ' + res.message);
      }
    }
  };

  // ── 2. EDIT / INSPECT HANDLERS ──────────────────────────────────────
  const inspectRisk = (id) => {
    setActiveClauseId(id);
    switchTab('risks');
    setIntent('');
    setRewrittenText('');
  };

  const handleEditorClick = (e) => {
    const mark = e.target.closest('mark');
    if (mark && mark.dataset.id) {
      inspectRisk(mark.dataset.id);
    }
  };

  // ── 3. REWRITE HANDLER ──────────────────────────────────────────────
  const handleRewrite = async () => {
    if (!activeClause) return;
    if (!intent.trim()) {
      alert('Please enter rewrite instructions.');
      return;
    }

    setRewriting(true);
    const res = await rewriteContractClause(activeClause.text, activeClause.issue, intent.trim());
    setRewriting(false);

    if (!res.error && res.rewritten) {
      const cleanText = res.rewritten.replace(/^"|"$/g, '').trim();
      setRewrittenText(cleanText);
    } else {
      alert(res.message || 'Failed to rewrite clause.');
    }
  };

  // Applies revision by updating clause state (which is then diffed dynamically with transient animation state)
  const applyRevision = () => {
    if (!activeClause || !rewrittenText.trim()) return;

    setClauses(prev => prev.map(c => {
      if (c.id === activeClause.id) {
        return {
          ...c,
          isRevised: true,
          isNewlyRevised: true,
          revisedText: rewrittenText.trim(),
          risk: 'GREEN',
          issue: 'Approved AI Revision.'
        };
      }
      return c;
    }));

    // Clear the visual fade animation class after 1.5s so it runs exactly once
    setTimeout(() => {
      setClauses(prev => prev.map(c => {
        if (c.id === activeClause.id) {
          return { ...c, isNewlyRevised: false };
        }
        return c;
      }));
    }, 1500);

    setActiveClauseId(null);
    setRewrittenText('');
    setIntent('');
  };

  // ── 4. EXTENSIONS (RECOMMENDATIONS) HANDLERS ─────────────────────────
  const fetchMissingProtections = async () => {
    setLoadingRecs(true);
    let compiledText = rawText;
    clauses.forEach(c => {
      if (c.isRevised && c.revisedText) {
        compiledText = compiledText.replace(c.text, c.revisedText);
      }
    });
    const res = await fetchContractRecommendations(compiledText);
    setLoadingRecs(false);

    if (!res.error && res.recommendations) {
      let parsed = [];
      if (typeof res.recommendations === 'string') {
        try {
          const text = res.recommendations.replace(/```json/g, '').replace(/```/g, '');
          const idxStart = text.indexOf('[');
          const idxEnd = text.lastIndexOf(']');
          parsed = JSON.parse(text.substring(idxStart, idxEnd + 1));
        } catch (e) {
          parsed = [];
        }
      } else {
        parsed = res.recommendations;
      }

      const normalized = parsed.map((item, idx) => ({
        title: item.title || `Missing Clause ${idx + 1}`,
        clause: item.clause || '',
        selected: true
      }));
      setRecommendations(normalized);
    } else {
      alert('Failed to analyze missing protections.');
    }
  };

  const handleRecommendationCheck = (idx) => {
    setRecommendations(prev => prev.map((item, i) => {
      if (i === idx) return { ...item, selected: !item.selected };
      return item;
    }));
  };

  const handleRecommendationChange = (idx, newText) => {
    setRecommendations(prev => prev.map((item, i) => {
      if (i === idx) return { ...item, clause: newText };
      return item;
    }));
  };

  const addSelectedRecommendations = () => {
    const selected = recommendations.filter(r => r.selected && r.clause.trim());
    if (selected.length === 0) {
      alert('Please check at least one missing clause.');
      return;
    }

    const newAppended = selected.map(r => ({
      title: r.title,
      clause: r.clause,
      isNewlyAppended: true
    }));

    setAppendedClauses(prev => [...prev, ...newAppended]);
    setRecommendations(prev => prev.filter(r => !r.selected));
    alert(`${selected.length} missing clauses appended successfully.`);

    // Clear animation class for appended clauses after 1.5s so it runs exactly once
    setTimeout(() => {
      setAppendedClauses(prev => prev.map(item => {
        if (newAppended.some(na => na.title === item.title)) {
          return { ...item, isNewlyAppended: false };
        }
        return item;
      }));
    }, 1500);
  };

  // ── 5. AUTO-DRAFT (SYNTHESIS) HANDLERS ───────────────────────────────
  const handleAutoDraft = async (e) => {
    e.preventDefault();
    if (!autoDraftPrompt.trim()) {
      alert('Please provide instructions.');
      return;
    }
    if (!selectedDocId) {
      alert('Please select a reference context file.');
      return;
    }

    setDrafting(true);
    setDraftStatus('Synthesizing dynamic context node...');
    setAutoDraftText('');

    try {
      const response = await fetch('/api/documents/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: autoDraftPrompt.trim(), context: selectedDocId })
      });
      const data = await response.json();
      
      setDrafting(false);
      setDraftStatus('');

      if (response.ok && data.draft) {
        const clean = data.draft.replace(/^"|"$/g, '').trim();
        setAutoDraftText(clean);
        setLeftTab('autodraft');
      } else {
        alert(data.error || 'Failed to synthesize auto-draft clause.');
      }
    } catch(err) {
      setDrafting(false);
      setDraftStatus('');
      alert('Network timeout in AI reasoning engine.');
    }
  };

  // ── 6. RAG CHAT HANDLER ──────────────────────────────────────────────
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || sendingChat) return;

    const query = chatInput.trim();
    setChatInput('');
    setChatHistory(prev => [...prev, { sender: 'user', text: query }]);
    setSendingChat(true);

    setTimeout(() => {
      if (chatStreamRef.current) chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
    }, 50);

    // Build latest compiled text for chat context
    let compiledText = rawText;
    clauses.forEach(c => {
      if (c.isRevised && c.revisedText) {
        compiledText = compiledText.replace(c.text, c.revisedText);
      }
    });
    if (appendedClauses.length > 0) {
      appendedClauses.forEach(ac => {
        compiledText += `\n\nADDED MISSING CLAUSE: ${ac.title}\n${ac.clause}`;
      });
    }

    const res = await chatWithContract(compiledText, query);
    setSendingChat(false);

    if (!res.error && res.response) {
      setChatHistory(prev => [...prev, { sender: 'bot', text: res.response }]);
    } else {
      setChatHistory(prev => [...prev, { sender: 'bot', text: res.message || 'Error occurred while contacting chatbot.' }]);
    }

    setTimeout(() => {
      if (chatStreamRef.current) chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
    }, 50);
  };

  // ── 7. EXPORT & EXPORTER MODAL ───────────────────────────────────────
  const executeExport = async () => {
    if (!includeDoc && !includeDraft) {
      alert('Please check at least one section to export.');
      return;
    }

    let documentText = '';
    let draftText = '';

    if (includeDoc) {
      // Reconstruct rawText with revisions applied
      let compiledText = rawText;
      clauses.forEach(c => {
        if (c.isRevised && c.revisedText) {
          compiledText = compiledText.replace(c.text, c.revisedText);
        }
      });
      // Append missing clauses
      if (appendedClauses.length > 0) {
        compiledText += '\n\n';
        appendedClauses.forEach(ac => {
          compiledText += `\n----------------------------------------\nADDED MISSING CLAUSE: ${ac.title}\n${ac.clause}\n`;
        });
      }
      documentText = compiledText;
    }
    if (includeDraft) {
      draftText = autoDraftText;
      if (!draftText.trim()) {
        alert('Auto-Draft workspace is empty. Synthesize a clause first.');
        return;
      }
    }

    setExporting(true);
    setExportError('');

    try {
      const defaultFilename = `LexAI_Export.${exportFormat === 'docx' ? 'docx' : 'pdf'}`;
      const mimeType = exportFormat === 'docx' 
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
        : 'application/pdf';

      let fileHandle;
      if (window.showSaveFilePicker) {
        try {
          fileHandle = await window.showSaveFilePicker({
            suggestedName: defaultFilename,
            types: [{
              description: exportFormat === 'docx' ? 'Word Document' : 'PDF Document',
              accept: { [mimeType]: [`.${exportFormat}`] },
            }],
          });
        } catch (err) {
          if (err.name === 'AbortError') {
            setExporting(false);
            return;
          }
        }
      }

      const blob = await exportContract(documentText, draftText, exportFormat);
      
      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      setShowExportModal(false);
    } catch (err) {
      setExportError(err.message || 'Export request failed.');
    } finally {
      setExporting(false);
    }
  };

  // Close autocomplete dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Citation matching Precedent items
  const matchedPrecedents = (() => {
    const text = rawText.toLowerCase();
    const precedents = [];
    if (/\b(liquidated damages|fixed penalty|actual damages|penalty of|reduce the final invoice|payments withheld|discretion of the client)\b/i.test(text)) {
      precedents.push({
        title: 'Kailash Nath Associates v. Delhi Development Authority',
        desc: 'Supreme Court landmark ruling on Section 74 of the Indian Contract Act. Established that penalties can only be awarded if actual loss is proved.',
        url: 'https://indiankanoon.org/doc/11624932/'
      });
    }
    if (/\b(terminate.*convenience|termination.*without cause|terminate this agreement at any time|without prior notice|reject any deliverables)\b/i.test(text)) {
      precedents.push({
        title: 'Indian Oil Corporation Ltd. v. Amritsar Gas Service',
        desc: 'Held that determinable contracts cannot be specifically enforced under the Specific Relief Act, limiting remedies for wrongful termination to notice period damages.',
        url: 'https://indiankanoon.org/doc/45790435/'
      });
    }
    if (/\b(exclusive jurisdiction|seat of arbitration|sole arbitrator|courts located in|inconvenient forum|internal committee|waives all rights to approach any court)\b/i.test(text)) {
      precedents.push({
        title: 'Bharat Aluminium Co. v. Kaiser Aluminium',
        desc: 'Clarified applicability of Part I of the Arbitration and Conciliation Act to foreign-seated arbitrations.',
        url: 'https://indiankanoon.org/doc/137226892/'
      });
    }
    if (/\b(confidential information|trade secret|non-disclosure|maintain secrecy|disclose to others|protect this confidential information)\b/i.test(text)) {
      precedents.push({
        title: 'Zee Telefilms Ltd. v. Sundial Communications Pvt. Ltd.',
        desc: 'Established protection for trade secrets and confidential templates under the breach of confidence framework.',
        url: 'https://indiankanoon.org/doc/84589699/'
      });
    }
    if (/\b(intellectual property|work made for hire|exclusive property|transfer.*ip|no ip rights|moral rights)\b/i.test(text)) {
      precedents.push({
        title: 'Indian Performing Right Society Ltd. v. Eastern Indian Motion Pictures',
        desc: 'Supreme Court copyright ownership rules for works made for hire and rights of commissioning parties.',
        url: 'https://indiankanoon.org/doc/91660613/'
      });
    }
    return precedents;
  })();

  // Risk counts
  const redCount = clauses.filter(c => c.risk === 'RED').length;
  const amberCount = clauses.filter(c => c.risk === 'AMBER').length;
  const greenCount = clauses.filter(c => c.risk === 'GREEN').length;

  // contentEditable editor blur syncing
  const handleEditorBlur = (e) => {
    const editorEl = e.currentTarget;
    
    // 1. Read updates from del, mark, and ins tags to keep clauses state in sync
    const delElements = editorEl.querySelectorAll('del.revised-del');
    const insElements = editorEl.querySelectorAll('ins.revised-ins, ins.newly-revised-ins');
    const markElements = editorEl.querySelectorAll('mark.risk-mark');
    
    const delUpdates = {};
    delElements.forEach(del => {
      const id = del.getAttribute('data-id');
      if (id) {
        delUpdates[id] = del.innerText || del.textContent || '';
      }
    });

    const insUpdates = {};
    insElements.forEach(ins => {
      const id = ins.getAttribute('data-id');
      if (id) {
        insUpdates[id] = ins.innerText || ins.textContent || '';
      }
    });

    const markUpdates = {};
    markElements.forEach(mark => {
      const id = mark.getAttribute('data-id');
      if (id) {
        markUpdates[id] = mark.innerText || mark.textContent || '';
      }
    });

    if (Object.keys(delUpdates).length > 0 || Object.keys(insUpdates).length > 0 || Object.keys(markUpdates).length > 0) {
      setClauses(prev => prev.map(c => {
        const updatedClause = { ...c };
        if (delUpdates[c.id] !== undefined) {
          updatedClause.text = delUpdates[c.id];
        }
        if (markUpdates[c.id] !== undefined) {
          updatedClause.text = markUpdates[c.id];
        }
        if (insUpdates[c.id] !== undefined) {
          updatedClause.revisedText = insUpdates[c.id];
        }
        return updatedClause;
      }));
    }

    // 2. Reconstruct rawText and save it
    const rawTextValue = getRawTextFromNode(editorEl);
    setRawText(rawTextValue);
  };

  return (
    <>
      <style>{styles}</style>
      <div className="analyzer-container p-4 md:p-8">
        
        {/* Header toolbar */}
        <div className="analyzer-header">
          <div>
            <h1 style={{ fontSize: '24px', margin: 0, fontFamily: 'var(--font-serif)' }}>Contract Risk Analyzer</h1>
            <span style={{ fontSize: '12.5px', color: 'var(--text-dark-muted)' }}>
              Double-sided scanner for liability audits, extensions, and revisions under Indian Law.
            </span>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <div className="strategy-select-container">
              <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)', textTransform: 'uppercase' }}>Mode:</span>
              <select 
                className="strategy-dropdown transition-all duration-300 ease-in-out focus:ring-2 focus:ring-gray-400 focus:outline-none" 
                value={scanStrategy}
                onChange={(e) => handleStrategyChange(e.target.value)}
              >
                <option value="Defensive">🛡️ Defensive Scan</option>
                <option value="Aggressive">⚡ Aggressive Scan</option>
              </select>
            </div>

            {isAnalyzed && (
              <>
                <button 
                  className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg" 
                  onClick={() => setShowExportModal(true)}
                  style={{ fontSize: '13px' }}
                >
                  📥 Export Document
                </button>
                <button 
                  className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg" 
                  onClick={() => { 
                    setIsAnalyzed(false); 
                    setRawText(''); 
                    setClauses([]); 
                    setSummary(''); 
                    setAppendedClauses([]); 
                  }}
                  style={{ fontSize: '13px', background: 'transparent', border: '1px solid var(--border-dark-subtle)', color: 'white' }}
                >
                  Reset
                </button>
              </>
            )}
          </div>
        </div>

        {/* Executive Summary at the top (only shown when analyzed) */}
        {isAnalyzed && summary && (
          <div className="summary-banner">
            <strong>Executive Summary:</strong> {summary}
          </div>
        )}

        {/* ────────── INITIAL UPLOAD / INPUT SCREEN ────────── */}
        {!isAnalyzed ? (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div className="upload-layout-container">
              <div className="panel-header" style={{ textAlign: 'center', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '22px' }}>Analyze Case Contract</h2>
                <p>Ingest contract briefs, employment covenants, or MSAs to isolate liabilities and generate revisions.</p>
              </div>

              {isAnalyzing ? (
                <div style={{ padding: '40px', textAlignment: 'center', textAlign: 'center' }}>
                  <div className="shimmer-bar" style={{ width: '80%', margin: '0 auto 15px' }}></div>
                  <div className="shimmer-bar" style={{ width: '60%', margin: '0 auto 15px' }}></div>
                  <div className="shimmer-bar" style={{ width: '40%', margin: '0 auto' }}></div>
                  <p style={{ color: 'var(--accent-primary)', fontWeight: '600', fontSize: '14.5px', marginTop: '20px' }}>
                    Compiling contract vector node and scanning liabilities under Indian Contract Law...
                  </p>
                  <span style={{ fontSize: '12px', color: 'var(--text-dark-muted)' }}>This can take up to 20 seconds for dense PDFs...</span>
                </div>
              ) : (
                <div>
                  {/* File upload zone */}
                  <div 
                    className="drag-drop-zone transition-all duration-300 ease-in-out hover:shadow-lg"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
                    onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('dragover');
                      handleFileUpload(e.dataTransfer.files);
                    }}
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      style={{ display: 'none' }}
                      onChange={(e) => handleFileUpload(e.target.files)}
                      accept=".pdf,.docx"
                    />
                    <div style={{ fontSize: '32px', marginBottom: '10px' }}>📂</div>
                    <h3 style={{ fontSize: '15px', color: 'white', marginBottom: '4px' }}>Upload PDF or DOCX Contract</h3>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-dark-muted)' }}>Drag and drop file here, or click to browse</p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '15px 0' }}>
                    <hr style={{ flex: 1, border: 'none', borderBottom: '1px solid var(--border-dark-subtle)' }} />
                    <span style={{ fontSize: '12px', color: 'var(--text-dark-muted)', textTransform: 'uppercase' }}>or paste raw text</span>
                    <hr style={{ flex: 1, border: 'none', borderBottom: '1px solid var(--border-dark-subtle)' }} />
                  </div>

                  <textarea
                    className="input-textarea bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
                    placeholder="Paste the raw text of your contract here to analyze immediately..."
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                  />

                  <button 
                    className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg" 
                    onClick={handleTextAnalyze}
                    style={{ width: '100%', padding: '12px' }}
                  >
                    ⚡ Start Contract Risk Scan
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          
          // ────────── INTERACTIVE SPLIT PANE WORKSPACE ──────────
          <div className="workspace-pane">
            
            {/* LEFT COLUMN: Document Editor */}
            <div className="editor-column">
              <div className="editor-header-bar">
                <div className="editor-tabs">
                  <button 
                    className={`editor-tab-btn transition-all duration-300 ease-in-out hover:bg-gray-700 ${leftTab === 'scanner' ? 'active' : ''}`}
                    onClick={() => setLeftTab('scanner')}
                  >
                    📝 Contract Text
                  </button>
                  <button 
                    className={`editor-tab-btn transition-all duration-300 ease-in-out hover:bg-gray-700 ${leftTab === 'autodraft' ? 'active' : ''}`}
                    onClick={() => setLeftTab('autodraft')}
                  >
                    🤖 Auto-Draft
                  </button>
                </div>
                
                {leftTab === 'scanner' && (
                  <span style={{ fontSize: '12px', color: 'var(--text-dark-muted)' }}>
                    Editable Workspace. Click highlights to inspect risks.
                  </span>
                )}
              </div>

              {/* Rich-Text Formatting Toolbar */}
              {leftTab === 'scanner' && (
                <div className="rich-text-toolbar">
                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleFormat('undo')}
                    title="Undo"
                    className="toolbar-btn transition-all duration-300 ease-in-out"
                  >
                    ↩️
                  </button>
                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleFormat('redo')}
                    title="Redo"
                    className="toolbar-btn transition-all duration-300 ease-in-out"
                  >
                    ↪️
                  </button>
                  <div className="toolbar-divider"></div>
                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleFormat('bold')}
                    title="Bold"
                    className="toolbar-btn transition-all duration-300 ease-in-out"
                    style={{ fontWeight: 'bold' }}
                  >
                    B
                  </button>
                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleFormat('italic')}
                    title="Italic"
                    className="toolbar-btn transition-all duration-300 ease-in-out"
                    style={{ fontStyle: 'italic' }}
                  >
                    I
                  </button>
                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleFormat('underline')}
                    title="Underline"
                    className="toolbar-btn transition-all duration-300 ease-in-out"
                    style={{ textDecoration: 'underline' }}
                  >
                    U
                  </button>
                  <div className="toolbar-divider"></div>
                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleFormat('justifyLeft')}
                    title="Align Left"
                    className="toolbar-btn transition-all duration-300 ease-in-out"
                  >
                    ⬅️
                  </button>
                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleFormat('justifyCenter')}
                    title="Align Center"
                    className="toolbar-btn transition-all duration-300 ease-in-out"
                  >
                    ↔️
                  </button>
                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleFormat('justifyRight')}
                    title="Align Right"
                    className="toolbar-btn transition-all duration-300 ease-in-out"
                  >
                    ➡️
                  </button>
                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleFormat('justifyFull')}
                    title="Justify"
                    className="toolbar-btn transition-all duration-300 ease-in-out"
                  >
                    ≡
                  </button>
                </div>
              )}

              <div className="editor-scroll-area">
                {leftTab === 'scanner' ? (
                  <>
                    <div
                      ref={editorRef}
                      className="scanner-body"
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={handleEditorBlur}
                      onClick={handleEditorClick}
                      dangerouslySetInnerHTML={{ __html: editorHtml }}
                    />
                    {appendedClauses.length > 0 && (
                      <div className="appended-clauses-container" style={{ marginTop: '24px' }}>
                        {appendedClauses.map((ac, idx) => (
                          <div key={idx} className="appended-clause-wrapper">
                            <hr className="extension-divider" />
                            <blockquote className={ac.isNewlyAppended ? "newly-appended-blockquote" : "extension-blockquote"}>
                              <strong className="extension-title" style={{ userSelect: 'none' }}>
                                Added Missing Clause: {ac.title}
                              </strong>
                              <div 
                                className="extension-body"
                                contentEditable
                                suppressContentEditableWarning
                                onBlur={(e) => {
                                  const text = e.target.innerText || e.target.textContent || '';
                                  setAppendedClauses(prev => prev.map((item, i) => {
                                    if (i === idx) {
                                      return { ...item, clause: text.trim() };
                                    }
                                    return item;
                                  }));
                                }}
                              >
                                {ac.clause}
                              </div>
                            </blockquote>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div>
                    {autoDraftText ? (
                      <div 
                        style={{ fontFamily: 'var(--font-serif)', fontSize: '18px', lineHeight: '1.625', whiteSpace: 'pre-wrap', color: '#1F2937', minHeight: '70vh', padding: '40px', backgroundColor: '#ffffff', borderRadius: '4px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={(e) => setAutoDraftText(e.target.innerText)}
                      >
                        {autoDraftText}
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-dark-muted)', fontStyle: 'italic', fontSize: '13px' }}>
                        No auto-drafted clause generated yet. Execute instructions in the "Auto-Draft" tab on the right to compile legal clauses.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN: Analysis Console */}
            <div className="analysis-column">
              <div className="analysis-tabs-bar">
                <button className={`analysis-tab-btn transition-all duration-300 ease-in-out hover:bg-gray-700 ${activeTab === 'risks' ? 'active' : ''}`} onClick={() => switchTab('risks')}>
                  ⚡ Risks ({redCount + amberCount})
                </button>
                <button className={`analysis-tab-btn transition-all duration-300 ease-in-out hover:bg-gray-700 ${activeTab === 'recs' ? 'active' : ''}`} onClick={() => { switchTab('recs'); if (recommendations.length === 0) fetchMissingProtections(); }}>
                  🛡️ Missing ({recommendations.length})
                </button>
                <button className={`analysis-tab-btn transition-all duration-300 ease-in-out hover:bg-gray-700 ${activeTab === 'draft' ? 'active' : ''}`} onClick={() => switchTab('draft')}>
                  🤖 Auto-Draft
                </button>
                <button className={`analysis-tab-btn transition-all duration-300 ease-in-out hover:bg-gray-700 ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => switchTab('chat')}>
                  💬 RAG Chat
                </button>
                <button className={`analysis-tab-btn transition-all duration-300 ease-in-out hover:bg-gray-700 ${activeTab === 'citations' ? 'active' : ''}`} onClick={() => switchTab('citations')}>
                  📚 Citations ({matchedPrecedents.length})
                </button>
              </div>

              <div className={`analysis-panel-body p-4 md:p-8 gap-5 transition-opacity duration-300 ${tabOpacity}`}>
                
                {/* SUB TAB: Risks (Actions) */}
                {activeTab === 'risks' && (
                  <div className="gap-5" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <div className="risk-stat-bar" style={{ marginBottom: 0 }}>
                      <div className="risk-stat-item">
                        <span className="risk-indicator-dot red"></span>
                        <strong>{redCount}</strong> High
                      </div>
                      <div className="risk-stat-item">
                        <span className="risk-indicator-dot amber"></span>
                        <strong>{amberCount}</strong> Medium
                      </div>
                      <div className="risk-stat-item">
                        <span className="risk-indicator-dot green"></span>
                        <strong>{greenCount}</strong> Resolved
                      </div>
                    </div>

                    {activeClause ? (
                      <div className="gap-5" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="inspected-risk-card" style={{ marginBottom: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                            <span className={`risk-indicator-dot ${activeClause.risk === 'RED' ? 'red' : 'amber'}`}></span>
                            <h3 style={{ fontSize: '15px', color: 'white', margin: 0 }}>
                              {activeClause.risk === 'RED' ? 'High Risk Clause' : 'Medium Risk Clause'}
                            </h3>
                          </div>
                          
                          <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)' }}>ORIGINAL TEXT:</span>
                          <div className="original-clause-box">{activeClause.text}</div>
                        </div>

                        <div style={{ padding: '12px 14px', background: 'rgba(239, 68, 68, 0.05)', borderLeft: '3px solid var(--accent-danger)', fontSize: '13px', color: 'white', lineHeight: '1.4', borderRadius: '4px' }}>
                          <strong>Indian Legal Issue:</strong> {activeClause.issue}
                        </div>

                        {/* Intent Input & Autocomplete */}
                        <div style={{ position: 'relative' }}>
                          <label className="input-label">Drafting Revision Intent</label>
                          <input
                            type="text"
                            placeholder="E.g., Make this notice mutual, cap penalty..."
                            className="bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
                            style={{ width: '100%', boxSizing: 'border-box' }}
                            value={intent}
                            onChange={(e) => { setIntent(e.target.value); setShowSuggestions(true); }}
                            onFocus={() => setShowSuggestions(true)}
                          />

                          {showSuggestions && dynamicIntents.length > 0 && (
                            <div className="autocomplete-dropdown" ref={suggestionsRef}>
                              {dynamicIntents.map((item, idx) => (
                                <div 
                                  key={idx}
                                  className="autocomplete-item"
                                  onClick={() => { setIntent(item); setShowSuggestions(false); }}
                                >
                                  💡 {item}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <button 
                          className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg" 
                          onClick={handleRewrite}
                          disabled={rewriting}
                          style={{ width: '100%', padding: '12px' }}
                        >
                          {rewriting ? 'Generating Revision...' : 'Rewrite Clause with AI'}
                        </button>

                        {/* Rewrite suggested container */}
                        {rewrittenText && (
                          <div className="gap-5" style={{ display: 'flex', flexDirection: 'column' }}>
                            <div>
                              <label className="input-label">AI Suggested Revision</label>
                              <textarea
                                className="bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
                                style={{ height: '100px', width: '100%', boxSizing: 'border-box', border: '1px solid var(--accent-success)', color: 'white', resize: 'none' }}
                                value={rewrittenText}
                                onChange={(e) => setRewrittenText(e.target.value)}
                              />
                            </div>
                            <button 
                              className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg" 
                              onClick={applyRevision}
                              style={{ width: '100%', padding: '12px', background: 'var(--accent-success)' }}
                            >
                              Apply Rewrite to Document
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dark-muted)', fontStyle: 'italic', textAlign: 'center', padding: '40px' }}>
                        Click on any highlighted red/amber clause in the contract text editor on the left to inspect its risk and draft revisions.
                      </div>
                    )}
                  </div>
                )}

                {/* SUB TAB: Recommendations (Extensions) */}
                {activeTab === 'recs' && (
                  <div className="gap-5" style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ fontSize: '15px', color: 'white', margin: 0 }}>Missing Indian Protections</h3>
                      <button 
                        className="btn-accent transition-all duration-300 ease-in-out hover:bg-gray-700" 
                        style={{ fontSize: '11px', padding: '4px 10px', background: 'transparent', border: '1px solid var(--border-dark-subtle)', color: 'white' }}
                        onClick={fetchMissingProtections}
                        disabled={loadingRecs}
                      >
                        🔄 Re-Scan
                      </button>
                    </div>

                    {loadingRecs ? (
                      <div>
                        <div className="shimmer-bar"></div>
                        <div className="shimmer-bar" style={{ width: '80%' }}></div>
                        <div className="shimmer-bar" style={{ width: '60%' }}></div>
                      </div>
                    ) : recommendations.length === 0 ? (
                      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dark-muted)', fontStyle: 'italic', fontSize: '13px' }}>
                        No missing clauses identified yet.
                      </div>
                    ) : (
                      <div className="gap-5" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="gap-5" style={{ display: 'flex', flexDirection: 'column', maxHeight: '400px', overflowY: 'auto', paddingRight: '4px' }}>
                          {recommendations.map((item, idx) => (
                            <div key={idx} className="rec-protection-card" style={{ marginBottom: 0 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                <strong style={{ fontSize: '13.5px', color: 'white' }}>{item.title}</strong>
                                <input 
                                  type="checkbox"
                                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                  checked={item.selected}
                                  onChange={() => handleRecommendationCheck(idx)}
                                />
                              </div>
                              <textarea
                                className="bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
                                style={{ height: '80px', width: '100%', boxSizing: 'border-box', fontSize: '13px', resize: 'none' }}
                                value={item.clause}
                                onChange={(e) => handleRecommendationChange(idx, e.target.value)}
                              />
                            </div>
                          ))}
                        </div>

                        <button 
                          className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg" 
                          onClick={addSelectedRecommendations}
                          style={{ width: '100%', padding: '12px' }}
                        >
                          ➕ Add Selected Clauses to Contract
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* SUB TAB: Auto-Draft */}
                {activeTab === 'draft' && (
                  <div className="gap-5" style={{ display: 'flex', flexDirection: 'column' }}>
                    <form onSubmit={handleAutoDraft}>
                      <div className="gap-5" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="input-group">
                          <label className="input-label">Reference Context File *</label>
                          <select 
                            className="bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
                            style={{ width: '100%' }}
                            required
                            value={selectedDocId}
                            onChange={(e) => setSelectedDocId(e.target.value)}
                          >
                            <option value="">Select Reference File</option>
                            {vaultDocs.map(doc => (
                              <option key={doc.id} value={doc.id}>{doc.filename}</option>
                            ))}
                          </select>
                        </div>

                        <div className="input-group">
                          <label className="input-label">Drafting Instructions *</label>
                          <input 
                            type="text"
                            placeholder="e.g. Synthesize a non-disclosure agreement clause..."
                            className="bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
                            style={{ width: '100%', boxSizing: 'border-box' }}
                            required
                            value={autoDraftPrompt}
                            onChange={(e) => setAutoDraftPrompt(e.target.value)}
                          />
                        </div>

                        <button type="submit" className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg" style={{ alignSelf: 'flex-start', padding: '10px 20px' }} disabled={drafting}>
                          {drafting ? 'Synthesizing...' : '🤖 Synthesize Clause'}
                        </button>
                      </div>
                    </form>

                    {draftStatus && (
                      <div style={{ color: 'var(--text-dark-muted)', fontStyle: 'italic', fontSize: '13px' }}>
                        {draftStatus}
                      </div>
                    )}
                  </div>
                )}

                {/* SUB TAB: Chat */}
                {activeTab === 'chat' && (
                  <div className="gap-5" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <div className="chat-bubble-stream" ref={chatStreamRef}>
                      {chatHistory.map((msg, i) => (
                        <div key={i} className={`chat-message-bubble ${msg.sender}`}>
                          {msg.text}
                        </div>
                      ))}
                      {sendingChat && (
                        <div className="chat-message-bubble bot" style={{ fontStyle: 'italic', color: 'var(--text-dark-muted)' }}>
                          Searching document...
                        </div>
                      )}
                    </div>

                    <form onSubmit={handleChatSubmit} style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--border-dark-subtle)', paddingTop: '10px' }}>
                      <input 
                        type="text"
                        placeholder="Ask a grounded contract query..."
                        className="bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
                        style={{ flex: 1 }}
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                      />
                      <button type="submit" className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg" style={{ padding: '0 20px' }} disabled={sendingChat}>
                        Send
                      </button>
                    </form>
                  </div>
                )}

                {/* SUB TAB: Citations */}
                {activeTab === 'citations' && (
                  <div className="gap-5" style={{ display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ fontSize: '15px', color: 'white', margin: 0 }}>Landmark Indian Contract Precedents</h3>
                    
                    {matchedPrecedents.length === 0 ? (
                      <div style={{ padding: '20px', border: '1px dashed var(--border-dark-subtle)', borderRadius: '8px', color: 'var(--text-dark-muted)', fontStyle: 'italic', fontSize: '13px', textAlign: 'center' }}>
                        No keyword matches. Write or paste clauses regarding liability limits, notice, or IP to trigger citations.
                      </div>
                    ) : (
                      <div className="gap-5" style={{ display: 'flex', flexDirection: 'column', maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}>
                        {matchedPrecedents.map((prec, i) => (
                          <div key={i} className="precedent-card" style={{ marginBottom: 0 }}>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <span>⚖️</span>
                              <div>
                                <a href={prec.url} target="_blank" rel="noopener noreferrer" className="precedent-link">
                                  {prec.title} ↗
                                </a>
                                <p style={{ fontSize: '12.5px', color: 'var(--text-dark-muted)', marginTop: '4px', lineHeight: '1.4' }}>{prec.desc}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              </div>
            </div>

          </div>
        )}

      </div>

      {/* ── EXPORT SETTINGS MODAL ── */}
      {showExportModal && (
        <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="export-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize: '18px', color: 'white', fontFamily: 'var(--font-serif)' }}>Export Document Settings</h2>
              <button 
                onClick={() => setShowExportModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-dark-muted)', fontSize: '20px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: '8px' }}>Export Format</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div 
                    className={`format-selection-card ${exportFormat === 'pdf' ? 'selected' : ''}`}
                    onClick={() => setExportFormat('pdf')}
                  >
                    <span>📄</span>
                    <div>
                      <strong style={{ display: 'block', fontSize: '13px', color: 'white' }}>PDF Format</strong>
                      <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)' }}>Print-ready layout</span>
                    </div>
                  </div>
                  <div 
                    className={`format-selection-card ${exportFormat === 'docx' ? 'selected' : ''}`}
                    onClick={() => setExportFormat('docx')}
                  >
                    <span>📝</span>
                    <div>
                      <strong style={{ display: 'block', fontSize: '13px', color: 'white' }}>Word Document</strong>
                      <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)' }}>Editable DOCX file</span>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: '8px' }}>Include Content Sections</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', cursor: 'pointer' }}>
                    <input 
                      type="checkbox"
                      checked={includeDoc}
                      onChange={(e) => setIncludeDoc(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span>Contract Scanner Text</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', cursor: 'pointer' }}>
                    <input 
                      type="checkbox"
                      checked={includeDraft}
                      onChange={(e) => setIncludeDraft(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span>Auto-Draft Workspace Text</span>
                  </label>
                </div>
              </div>

              {exportError && (
                <div style={{ padding: '10px', background: 'rgba(239,68,68,0.1)', color: 'var(--accent-danger)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', fontSize: '12.5px' }}>
                  {exportError}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button 
                className="btn-accent" 
                style={{ background: 'transparent', border: '1px solid var(--border-dark-subtle)', color: 'white' }} 
                onClick={() => setShowExportModal(false)}
              >
                Cancel
              </button>
              <button 
                className="btn-accent"
                onClick={executeExport}
                disabled={exporting}
              >
                {exporting ? 'Exporting...' : '⬇️ Export & Download'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── UTILITIES ────────────────────────────────────────────────────────
const renderDocumentScanner = (rawText, clauses) => {
  if (!rawText) return '';
  const riskClauses = clauses.filter(c => c.risk === 'RED' || c.risk === 'AMBER' || c.isRevised);
  const sortedClauses = [...riskClauses].sort((a, b) => b.text.length - a.text.length);
  
  const ranges = [];
  sortedClauses.forEach(c => {
    const trimmed = c.text.trim();
    if (!trimmed) return;
    
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flexible = escaped.replace(/\s+/g, '[\\s]+');
    try {
      const regex = new RegExp(flexible);
      const match = regex.exec(rawText);
      if (match) {
        const start = match.index;
        const end = match.index + match[0].length;
        if (!ranges.some(r => start < r.end && end > r.start)) {
          ranges.push({ start, end, clause: c });
        }
      }
    } catch (e) {
      // safe fallback
    }
  });
  
  ranges.sort((a, b) => a.start - b.start);
  
  let html = '';
  let cursor = 0;
  ranges.forEach(r => {
    const c = r.clause;
    
    html += escapeHtml(rawText.slice(cursor, r.start));
    
    if (c.isRevised) {
      const animationClass = c.isNewlyRevised ? 'newly-revised-ins' : 'revised-ins';
      html += `<del class="revised-del" data-id="${c.id}">${escapeHtml(rawText.slice(r.start, r.end))}</del><ins class="${animationClass}" data-id="${c.id}">${escapeHtml(c.revisedText)}</ins>`;
    } else {
      const bgColor = c.risk === 'RED' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(245, 158, 11, 0.25)';
      const borderColor = c.risk === 'RED' ? 'var(--accent-danger)' : 'var(--accent-warning)';
      html += `<mark id="clause-left-${c.id}" data-id="${c.id}" class="risk-mark" style="background-color: ${bgColor}; border-left: 2px solid ${borderColor}; cursor: pointer; padding: 2px 4px; border-radius: 3px; color: inherit; box-decoration-break: clone; -webkit-box-decoration-break: clone;">${escapeHtml(rawText.slice(r.start, r.end))}</mark>`;
    }
    
    cursor = r.end;
  });
  
  html += escapeHtml(rawText.slice(cursor));
  html = html.replace(/\n\n/g, '</p><p style="margin-bottom: 15px;">').replace(/\n/g, '<br>');
  return `<p style="margin-bottom: 15px;">${html}</p>`;
};

const escapeHtml = (str) => {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const getRawTextFromNode = (node) => {
  if (!node) return '';
  let text = '';
  const traverse = (n) => {
    if (n.nodeType === 3) { // TEXT_NODE
      text += n.nodeValue;
    } else if (n.nodeType === 1) { // ELEMENT_NODE
      const tagName = n.tagName.toLowerCase();
      if (tagName === 'ins') {
        // Ignore inserted text in rawText
        return;
      }
      if (tagName === 'br') {
        text += '\n';
        return;
      }
      
      const isBlock = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName);
      
      n.childNodes.forEach(child => traverse(child));
      
      if (tagName === 'p') {
        text += '\n\n';
      } else if (isBlock && tagName !== 'div') {
        text += '\n';
      }
    }
  };
  node.childNodes.forEach(child => traverse(child));
  return text.replace(/\n\n+$/g, '\n\n').trim();
};

const getDynamicIntents = (clauseText, riskLevel) => {
  const text = (clauseText || "").toLowerCase();
  const intents = [];

  if (text.includes('liability') || text.includes('penalty') || text.includes('damages') || text.includes('$') || text.includes('rs') || text.includes('inr')) {
    intents.push("Cap total liability to 12 months of fees paid");
    intents.push("Make the financial penalty mutual for both parties");
    intents.push("Exclude indirect, punitive, and consequential damages");
  }
  if (text.includes('terminate') || text.includes('termination') || text.includes('notice')) {
    intents.push("Add a 30-day written notice and cure period before termination");
    intents.push("Ensure termination rights are mutual for both parties");
  }
  if (text.includes('confidential') || text.includes('information')) {
    intents.push("Limit the survival of confidentiality obligations to 3 years");
    intents.push("Exclude publicly known information from confidentiality restrictions");
  }
  if (text.includes('jurisdiction') || text.includes('law') || text.includes('court') || text.includes('dispute') || text.includes('committee')) {
    intents.push("Change governing law to the laws of India");
    intents.push("Mandate neutral arbitration before approaching courts");
  }
  if (text.includes('intellectual') || text.includes('property') || text.includes('ip ')) {
    intents.push("Ensure the Vendor retains pre-existing Intellectual Property rights");
    intents.push("Grant a perpetual, royalty-free license instead of full IP transfer");
  }
  if (text.includes('discretion') || text.includes('withheld') || text.includes('reduce')) {
    intents.push("Require mutual written consent before altering payment terms");
    intents.push("Remove the unilateral right to withhold or reduce payments");
  }

  if (riskLevel === 'RED') {
    intents.push("Remove this clause entirely as it imposes severe disproportionate risk");
    intents.push("Make this clause perfectly mutual and balanced");
  } else {
    intents.push("Clarify the ambiguous terms to prevent future legal disputes");
    intents.push("Align this clause with standard Indian industry practices");
  }

  return [...new Set(intents)].slice(0, 5);
};
