import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ContractTiptapEditor from './ContractTiptapEditor.jsx';
import DraftsModal from './DraftsModal.jsx';
import { useContractStore } from '../store/useContractStore.js';
import { fetchDocuments, extractContractText } from '../services/api.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const DRAFT_STAGES = [
  { title: 'Statutory Interpretation', desc: 'Analyzing instructions and Indian legal framework bounds' },
  { title: 'Statutory Alignment', desc: 'Cross-referencing Indian Contract Act, 1872 & landmark case law' },
  { title: 'Operative Clause Synthesis', desc: 'Drafting structured, multi-tier terms, remedies & obligations' },
  { title: 'Execution Finalization', desc: 'Formatting numbered clauses, statutory indents & signature blocks' },
];

export default function AutoDraftWorkspace() {
  const navigate = useNavigate();
  const isMountedRef = useRef(true);
  const promptTextareaRef = useRef(null);
  const draftUploadInputRef = useRef(null);

  // Shared contract state lifted from store
  const {
    rawText,
    setRawText,
    autoDraftText,
    setAutoDraftText,
    autoDraftPrompt,
    setAutoDraftPrompt,
    autoDraftVersion,
    setAutoDraftVersion,
    openDraftsModal,
  } = useContractStore();

  // Local synthesis studio state
  const [drafting, setDrafting] = useState(false);
  const [draftStep, setDraftStep] = useState(0);
  const [draftProgress, setDraftProgress] = useState(0);
  const [draftError, setDraftError] = useState('');
  const [vaultDocs, setVaultDocs] = useState([]);
  const [selectedContextMode, setSelectedContextMode] = useState('active_contract');
  const [draftDepth, setDraftDepth] = useState('comprehensive');
  const [copied, setCopied] = useState(false);
  const [appended, setAppended] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [uploadingDraft, setUploadingDraft] = useState(false);
  const [draftUploadError, setDraftUploadError] = useState('');

  useEffect(() => {
    isMountedRef.current = true;
    const loadVault = async () => {
      try {
        const res = await fetchDocuments();
        if (!isMountedRef.current) return;
        if (Array.isArray(res)) {
          setVaultDocs(res);
        }
      } catch (e) {}
    };
    loadVault();
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Smooth multi-stage animation & progress tracker during synthesis
  useEffect(() => {
    if (!drafting) {
      setDraftStep(0);
      setDraftProgress(0);
      return;
    }

    setDraftStep(0);
    setDraftProgress(12);

    const stepInterval = setInterval(() => {
      setDraftStep((prev) => (prev < DRAFT_STAGES.length - 1 ? prev + 1 : prev));
    }, 2400);

    const progressInterval = setInterval(() => {
      setDraftProgress((prev) => {
        if (prev >= 94) return prev;
        const inc = Math.max(1, Math.floor((96 - prev) * 0.12));
        return Math.min(94, prev + inc);
      });
    }, 350);

    return () => {
      clearInterval(stepInterval);
      clearInterval(progressInterval);
    };
  }, [drafting]);

  const handleSynthesize = async (e) => {
    if (e) e.preventDefault();
    if (!autoDraftPrompt.trim()) {
      setDraftError('Please enter drafting instructions before synthesizing.');
      if (promptTextareaRef.current) promptTextareaRef.current.focus();
      return;
    }

    setDrafting(true);
    setDraftError('');

    try {
      let contextValue = null;
      if (selectedContextMode === 'active_contract' && rawText.trim()) {
        contextValue = rawText.trim();
      } else if (selectedContextMode !== 'none' && selectedContextMode !== 'active_contract') {
        contextValue = selectedContextMode;
      }

      // Backend now resumes truncated drafts with up to 2 follow-up LLM
      // calls (see ask_groq's max_continuations in utils/ai_helper.py) so a
      // full 20+ clause agreement can take noticeably longer than a single
      // completion. 150s gives that room without waiting forever on a
      // genuine hang — comfortably above the 90s floor this needs at minimum.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 150000);

      let response;
      try {
        response = await fetch(`${API_BASE}/api/documents/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: autoDraftPrompt.trim(),
            context: contextValue,
            depth: draftDepth,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      const data = await response.json();

      if (!isMountedRef.current) return;
      setDraftProgress(100);
      setTimeout(() => {
        if (!isMountedRef.current) return;
        setDrafting(false);
      }, 400);

      if (response.ok && (data.draft || data.clause || data.content)) {
        const generated = (data.draft || data.clause || data.content).replace(/^"|"$/g, '').trim();
        setAutoDraftText(generated);
        setAutoDraftVersion((v) => v + 1);
      } else {
        setDraftError(data.message || 'Failed to synthesize auto-draft clause.');
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setDrafting(false);
      setDraftError(
        err?.name === 'AbortError'
          ? 'The AI reasoning engine took too long to respond (150s). Please retry — a shorter or more focused instruction may complete faster.'
          : 'Network timeout in the AI legal reasoning engine. Please retry.'
      );
    }
  };

  const handleUploadDraft = async (files) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(extension)) {
      setDraftUploadError('Invalid format. Please upload a PDF, DOCX, or TXT file.');
      return;
    }
    if (file.size > 104857600) {
      setDraftUploadError('File exceeds 100MB. Please upload a smaller draft.');
      return;
    }

    setUploadingDraft(true);
    setDraftUploadError('');
    try {
      let extracted;
      if (extension === 'txt') {
        extracted = await file.text();
      } else {
        // Reuses the same /api/contract/extract-text route the Contract
        // Analyzer upload already relies on (PyMuPDF/pdfplumber/PyPDF2 for
        // PDF, python-docx for DOCX) — no new backend parsing needed.
        const res = await extractContractText(file);
        if (res?.error) throw new Error(res.message || 'Failed to extract document text.');
        extracted = typeof res === 'string' ? res : (res?.text || '');
      }

      if (!extracted || !extracted.trim()) {
        throw new Error('No readable text found in the uploaded file.');
      }

      // Same clause-numbering fixup ContractAnalyzer.jsx applies to its own
      // extracted text ("1.1" mis-split across a sentence boundary by PDF
      // extraction) — kept local since it's a one-line regex, not worth a
      // shared util for.
      const cleaned = extracted.replace(/(\w+)\.(\d+)\./g, '$1. $2.');
      setAutoDraftText(cleaned);
      setAutoDraftVersion((v) => v + 1);
    } catch (err) {
      setDraftUploadError(err?.message || 'Failed to read the uploaded draft.');
    } finally {
      setUploadingDraft(false);
      if (draftUploadInputRef.current) draftUploadInputRef.current.value = '';
    }
  };

  const handleAppendToContract = () => {
    if (!autoDraftText.trim()) return;
    const separator = rawText.trim() ? '\n\n' : '';
    setRawText(rawText + separator + autoDraftText);
    setAppended(true);
    setTimeout(() => setAppended(false), 2500);
  };

  const handleCopyDraft = () => {
    if (!autoDraftText.trim()) return;
    navigator.clipboard.writeText(autoDraftText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveToDrafts = async () => {
    if (!autoDraftText.trim()) return;
    const titleMatch = autoDraftPrompt.slice(0, 45).replace(/[^\w\s]/g, '').trim();
    const title = titleMatch ? `Draft: ${titleMatch}…` : 'Synthesized Legal Clause Draft';

    const newDraft = {
      id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      timestamp: new Date().toISOString(),
      rawText: autoDraftText,
      clauses: [],
      summary: 'Auto-Draft Studio synthesized legal draft.',
    };

    try {
      await fetch(`${API_BASE}/api/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDraft),
      });
    } catch (e) {}

    try {
      const existing = JSON.parse(localStorage.getItem('lexamplify_drafts') || '[]');
      const updated = [newDraft, ...existing.filter((d) => d.id !== newDraft.id)];
      localStorage.setItem('lexamplify_drafts', JSON.stringify(updated));
    } catch (e) {}

    window.dispatchEvent(new CustomEvent('lexamplify-drafts-updated'));
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleAddModifier = (modifierText) => {
    const currentPrompt = autoDraftPrompt;
    if (currentPrompt.includes(modifierText)) return;
    setAutoDraftPrompt(currentPrompt.trim() ? `${currentPrompt.trim()}\n- ${modifierText}` : modifierText);
  };

  const PRECEDENTS = [
    {
      label: 'Dispute Escalation & Arbitration',
      badge: 'Arbitration Act 1996',
      prompt: 'Draft a three-tier dispute escalation clause: (1) Good-faith executive negotiation within 15 business days, (2) Conciliation under Indian Mediation Rules, and (3) Binding arbitration under the Arbitration and Conciliation Act, 1996 before a sole arbitrator seated in New Delhi. Language of proceedings shall be English.',
    },
    {
      label: 'Intellectual Property Assignment',
      badge: 'Copyright Act 1957',
      prompt: 'Draft a comprehensive IP Assignment & Work Made for Hire clause. All deliverables, software, documentation, and developments created by Party B shall vest exclusively in Party A under Section 17 of the Copyright Act, 1957. Include worldwide perpetual assignment, waiver of moral rights to the fullest extent permitted by Indian Law, and no residual vendor licenses.',
    },
    {
      label: 'Severability & Statutory Validity',
      badge: 'Contract Act s.24',
      prompt: 'Draft a severability clause under Section 24 of the Indian Contract Act, 1872. If any provision is held invalid, illegal, or unenforceable by a court of competent jurisdiction, such provision shall be modified to the minimum extent necessary to make it enforceable, or severed if modification is impossible, without invalidating the remainder of this Agreement.',
    },
    {
      label: 'Mutual Notice & Service Terms',
      badge: 'General Clauses Act 1897',
      prompt: 'Draft a comprehensive notice clause. All formal legal notices must be in writing and delivered by: (a) Hand delivery with signed receipt, (b) Registered Post AD to the registered office, or (c) Encrypted email with read-receipt. Deemed service dates: hand delivery on same day, registered post within 3 business days, email on acknowledgment.',
    },
    {
      label: 'Indemnification & Third-Party Claims',
      badge: 'Contract Act s.124',
      prompt: 'Draft a mutual indemnification clause under Section 124 of the Indian Contract Act, 1872. Each party shall defend, indemnify, and hold harmless the other party, its directors, officers, and employees against any third-party claims, liabilities, losses, or legal expenses arising from gross negligence, willful misconduct, or breach of confidentiality.',
    },
    {
      label: 'Non-Compete & Confidentiality',
      badge: 'Contract Act s.27',
      prompt: 'Draft a non-disclosure and non-compete provision compliant with Section 27 of the Indian Contract Act, 1872. Restrict disclosure of proprietary trade secrets during the term and for 3 years post-termination. For non-compete, scope shall be narrowly tailored to active client solicitation and misuse of proprietary know-how.',
    },
  ];

  const wordCount = autoDraftText.trim() ? autoDraftText.trim().split(/\s+/).length : 0;
  const charCount = autoDraftText.length;
  const paragraphCount = autoDraftText.trim() ? autoDraftText.split(/\n\s*\n/).length : 0;

  return (
    <div className="autodraft-page-wrapper">
      <style>{`
        .autodraft-page-wrapper {
          padding: 24px 28px;
          max-width: 1560px;
          margin: 0 auto;
          color: var(--text-primary);
          font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        }

        /* Top Header Bar */
        .ad-header-card {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: var(--bg-panel);
          border: 1px solid var(--border-subtle);
          padding: 16px 24px;
          border-radius: 14px;
          margin-bottom: 24px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.12);
        }

        .ad-header-title-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .ad-title-gradient {
          font-size: 20px;
          font-weight: 800;
          margin: 0;
          color: var(--text-primary);
          letter-spacing: -0.02em;
        }

        .ad-sovereign-badge {
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          background: var(--accent-muted, rgba(59,130,246,0.12));
          color: var(--accent-primary, #3B82F6);
          border: 1px solid rgba(59,130,246,0.3);
          padding: 3px 10px;
          border-radius: 20px;
        }

        /* Workspace Grid */
        .ad-workspace-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.25fr) minmax(370px, 0.75fr);
          gap: 24px;
          align-items: start;
        }

        @media (max-width: 1080px) {
          .ad-workspace-grid {
            grid-template-columns: 1fr;
          }
        }

        /* Left Canvas Panel */
        .ad-canvas-panel {
          background: var(--bg-panel);
          border-radius: 16px;
          border: 1px solid var(--border-subtle);
          padding: 24px;
          min-height: 720px;
          display: flex;
          flex-direction: column;
          box-shadow: 0 16px 40px rgba(0,0,0,0.15);
          position: relative;
        }

        .ad-canvas-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--border-subtle);
          margin-bottom: 20px;
        }

        .ad-metric-pill {
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-muted);
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          padding: 4px 10px;
          border-radius: 6px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .ad-action-btn {
          font-size: 12px;
          font-weight: 600;
          padding: 7px 14px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: none;
        }

        .ad-btn-primary {
          background: var(--accent-primary, #3B82F6);
          color: #FFFFFF !important;
          box-shadow: 0 4px 12px rgba(37,99,235,0.25);
        }
        .ad-btn-primary:hover {
          background: var(--accent-hover, #2563EB);
          transform: translateY(-1px);
        }

        .ad-btn-secondary {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
        }
        .ad-btn-secondary:hover {
          background: var(--accent-muted);
          border-color: var(--accent-primary);
        }

        .ad-btn-purple {
          background: rgba(139,92,246,0.14);
          border: 1px solid rgba(139,92,246,0.35);
          color: #8B5CF6;
        }
        .ad-btn-purple:hover {
          background: rgba(139,92,246,0.25);
        }

        /* Right Control Panel */
        .ad-controls-panel {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .ad-card {
          background: var(--bg-panel);
          border-radius: 16px;
          border: 1px solid var(--border-subtle);
          padding: 20px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.1);
        }

        .ad-card-highlight {
          border-color: rgba(59,130,246,0.3);
          background: linear-gradient(180deg, var(--bg-panel), rgba(59,130,246,0.03));
        }

        .ad-card-title {
          font-size: 12.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-primary);
          margin-bottom: 14px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .ad-precedent-grid {
          display: flex;
          flex-direction: column;
          gap: 9px;
          max-height: 480px;
          overflow-y: auto;
          padding-right: 2px;
        }

        .ad-precedent-card {
          display: flex;
          flex-direction: column;
          text-align: left;
          padding: 11px 13px;
          border-radius: 10px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .ad-precedent-card:hover {
          background: var(--accent-muted);
          border-color: var(--accent-primary);
          transform: translateX(3px);
        }

        .ad-precedent-title {
          font-size: 12.5px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .ad-precedent-desc {
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.4;
          margin-top: 3px;
        }

        .ad-precedent-badge {
          font-size: 9.5px;
          font-weight: 700;
          background: rgba(59,130,246,0.12);
          color: var(--accent-primary);
          padding: 2px 7px;
          border-radius: 4px;
          border: 1px solid rgba(59,130,246,0.25);
        }

        .ad-chip-btn {
          font-size: 11px;
          font-weight: 600;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
          padding: 5px 10px;
          border-radius: 14px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .ad-chip-btn:hover {
          background: var(--accent-muted);
          color: var(--accent-primary);
          border-color: var(--accent-primary);
        }

        /* ── ELEGANT AI SYNTHESIS SUITE ANIMATION ── */
        .ad-synthesis-suite {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px 24px;
          flex: 1;
          text-align: center;
        }

        .ad-orbit-wrapper {
          position: relative;
          width: 90px;
          height: 90px;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .ad-orbit-pulse {
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(59,130,246,0.25) 0%, rgba(59,130,246,0) 70%);
          animation: orbGlow 2.4s ease-in-out infinite alternate;
        }

        .ad-orbit-ring-outer {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 2px dashed rgba(59,130,246,0.4);
          animation: spin 10s linear infinite;
        }

        .ad-orbit-ring-inner {
          position: absolute;
          inset: 10px;
          border-radius: 50%;
          border: 2.5px solid transparent;
          border-top-color: #3B82F6;
          border-right-color: #8B5CF6;
          animation: spin 1.8s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite;
        }

        .ad-orbit-core {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: linear-gradient(135deg, #2563EB, #7C3AED);
          color: #FFFFFF;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 18px rgba(37,99,235,0.4);
          position: relative;
          z-index: 2;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes orbGlow {
          0% { transform: scale(0.9); opacity: 0.4; }
          100% { transform: scale(1.15); opacity: 0.9; }
        }

        .ad-synthesis-heading {
          font-size: 16px;
          font-weight: 750;
          color: var(--text-primary);
          margin-bottom: 6px;
          letter-spacing: -0.01em;
        }

        .ad-synthesis-subtext {
          font-size: 12.5px;
          color: var(--text-muted);
          max-width: 460px;
          line-height: 1.5;
          margin-bottom: 24px;
        }

        /* Progress Laser Bar */
        .ad-progress-container {
          width: 100%;
          max-width: 440px;
          margin-bottom: 28px;
        }

        .ad-progress-track {
          width: 100%;
          height: 6px;
          background: rgba(255,255,255,0.06);
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          overflow: hidden;
          position: relative;
        }

        .ad-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #2563EB, #3B82F6, #8B5CF6);
          border-radius: 10px;
          transition: width 0.35s ease;
          position: relative;
        }

        .ad-progress-fill::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent);
          animation: shimmer 1.5s infinite;
        }

        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }

        .ad-progress-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 8px;
          font-size: 11.5px;
          font-weight: 600;
        }

        .ad-stage-name {
          color: var(--accent-primary, #3B82F6);
        }

        .ad-stage-pct {
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
        }

        /* 4-Step Interactive Pipeline Tracker */
        .ad-pipeline-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          width: 100%;
          max-width: 520px;
          text-align: left;
        }

        .ad-step-card {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 10px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          opacity: 0.5;
          transition: all 0.25s ease;
        }

        .ad-step-card.active {
          opacity: 1;
          border-color: var(--accent-primary);
          background: rgba(59,130,246,0.08);
          box-shadow: 0 4px 14px rgba(59,130,246,0.12);
        }

        .ad-step-card.done {
          opacity: 0.9;
          border-color: rgba(16,185,129,0.4);
          background: rgba(16,185,129,0.06);
        }

        .ad-step-badge {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
          background: var(--bg-panel);
          border: 1px solid var(--border-subtle);
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .ad-step-card.active .ad-step-badge {
          background: #3B82F6;
          color: #FFFFFF;
          border-color: #3B82F6;
          box-shadow: 0 0 8px rgba(59,130,246,0.6);
        }

        .ad-step-card.done .ad-step-badge {
          background: #10B981;
          color: #FFFFFF;
          border-color: #10B981;
        }

        .ad-step-info {
          min-width: 0;
        }

        .ad-step-title {
          font-size: 11.5px;
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .ad-step-desc {
          font-size: 10px;
          color: var(--text-muted);
          line-height: 1.35;
          margin-top: 2px;
        }

        /* TipTap Document Canvas Styling */
        .ad-document-canvas .scanner-body .ProseMirror {
          min-height: 520px;
          padding: 28px 32px;
          background: var(--bg-card);
          border-radius: 12px;
          border: 1px solid var(--border-subtle);
          font-size: 14px;
          line-height: 1.8;
          color: var(--text-primary);
          outline: none;
        }

        .ad-document-canvas .scanner-body .ProseMirror h1,
        .ad-document-canvas .scanner-body .ProseMirror h2,
        .ad-document-canvas .scanner-body .ProseMirror h3,
        .ad-document-canvas .scanner-body .ProseMirror h4 {
          font-size: 1.25rem;
          font-weight: 750;
          color: var(--text-primary);
          border-bottom: 1px solid var(--border-subtle);
          padding-bottom: 6px;
          margin-top: 1.8rem;
          margin-bottom: 1.1rem;
        }

        .ad-document-canvas .scanner-body .ProseMirror p {
          margin-bottom: 1.25rem;
          line-height: 1.8;
          text-align: justify;
          color: var(--text-primary);
        }

        .ad-document-canvas .scanner-body .ProseMirror strong,
        .ad-document-canvas .scanner-body .ProseMirror b {
          color: var(--accent-primary, #3B82F6);
          font-weight: 700;
        }

        /* ── TipTap Toolbar Font & Size Select Overrides ── */
        .toolbar-select {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
          font-size: 12.5px;
          font-weight: 550;
          border-radius: 6px;
          padding: 4px 8px;
          height: 32px;
          cursor: pointer;
          font-family: inherit;
          flex-shrink: 0;
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          appearance: auto;
          -webkit-appearance: auto;
          outline: none;
          vertical-align: middle;
        }
        .toolbar-select-font { min-width: 155px; width: auto; }
        .toolbar-select-size { min-width: 110px; width: auto; }
        .toolbar-select option {
          background: #111827;
          color: #F8FAFC;
          font-size: 12.5px;
          padding: 6px 10px;
        }
        .toolbar-select:hover { border-color: var(--accent-primary); }
        .toolbar-select:focus { outline: none; border-color: var(--accent-primary); box-shadow: 0 0 0 2px rgba(59,130,246,0.25); }

        /* ── LIGHT THEME COMPLETE HIGH-CONTRAST OVERRIDES ── */
        :root[data-theme="light"] .ad-header-card {
          background: #FFFFFF !important;
          border-color: #CBD5E1 !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.06) !important;
        }

        :root[data-theme="light"] .ad-title-gradient {
          color: #0F172A !important;
        }

        :root[data-theme="light"] .ad-sovereign-badge {
          background: rgba(37,99,235,0.1) !important;
          color: #1D4ED8 !important;
          border-color: rgba(37,99,235,0.3) !important;
        }

        :root[data-theme="light"] .ad-card {
          background: #FFFFFF !important;
          border-color: #CBD5E1 !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.06) !important;
        }

        :root[data-theme="light"] .ad-card-highlight {
          border-color: #93C5FD !important;
          background: #FFFFFF !important;
        }

        :root[data-theme="light"] .ad-card-title {
          color: #0F172A !important;
          font-weight: 800 !important;
        }

        :root[data-theme="light"] .ad-canvas-panel {
          background: #FFFFFF !important;
          border-color: #CBD5E1 !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.06) !important;
        }

        :root[data-theme="light"] .ad-precedent-card {
          background: #F8FAFC !important;
          border-color: #E2E8F0 !important;
        }

        :root[data-theme="light"] .ad-precedent-card:hover {
          background: #EFF6FF !important;
          border-color: #3B82F6 !important;
        }

        :root[data-theme="light"] .ad-precedent-title {
          color: #0F172A !important;
          font-weight: 700 !important;
        }

        :root[data-theme="light"] .ad-precedent-desc {
          color: #334155 !important;
        }

        :root[data-theme="light"] .ad-precedent-badge {
          background: rgba(37,99,235,0.1) !important;
          color: #1D4ED8 !important;
          border-color: rgba(37,99,235,0.3) !important;
        }

        :root[data-theme="light"] .ad-chip-btn {
          background: #F1F5F9 !important;
          border-color: #CBD5E1 !important;
          color: #0F172A !important;
          font-weight: 600 !important;
        }

        :root[data-theme="light"] .ad-chip-btn:hover {
          background: #DBEAFE !important;
          color: #1D4ED8 !important;
          border-color: #3B82F6 !important;
        }

        :root[data-theme="light"] .ad-progress-track {
          background: #E2E8F0 !important;
        }

        :root[data-theme="light"] .ad-step-card {
          background: #F8FAFC !important;
          border-color: #E2E8F0 !important;
        }

        :root[data-theme="light"] .ad-step-card.active {
          background: #EFF6FF !important;
          border-color: #2563EB !important;
        }

        :root[data-theme="light"] .ad-step-card.done {
          background: #F0FDF4 !important;
          border-color: #86EFAC !important;
        }

        :root[data-theme="light"] .toolbar-select {
          background-color: #FFFFFF !important;
          border: 1px solid #CBD5E1 !important;
          color: #0F172A !important;
          font-weight: 600 !important;
        }

        :root[data-theme="light"] .toolbar-select option {
          background-color: #FFFFFF !important;
          color: #0F172A !important;
        }

        :root[data-theme="light"] .toolbar-select:hover {
          background-color: #F8FAFC !important;
          border-color: #94A3B8 !important;
        }

        :root[data-theme="light"] .toolbar-select:focus {
          border-color: #2563EB !important;
          box-shadow: 0 0 0 2px rgba(37,99,235,0.2) !important;
        }

        :root[data-theme="light"] .ad-document-canvas .scanner-body {
          background: #F8FAFC !important;
          border: 1px solid #CBD5E1 !important;
          border-radius: 12px !important;
        }

        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror {
          background: #FFFFFF !important;
          color: #0F172A !important;
          border: none !important;
        }

        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror p {
          color: #1E293B !important;
        }

        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror h1,
        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror h2,
        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror h3,
        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror h4 {
          color: #0F172A !important;
          border-bottom: 1px solid #E2E8F0 !important;
        }

        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror strong,
        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror b {
          color: #1D4ED8 !important;
          font-weight: 700 !important;
        }

        :root[data-theme="light"] textarea,
        :root[data-theme="light"] select {
          background: #FFFFFF !important;
          border-color: #CBD5E1 !important;
          color: #0F172A !important;
        }

        :root[data-theme="light"] .ad-metric-pill {
          background: #F1F5F9 !important;
          border-color: #CBD5E1 !important;
          color: #334155 !important;
        }

        :root[data-theme="light"] .ad-btn-secondary {
          background: #F8FAFC !important;
          border-color: #CBD5E1 !important;
          color: #0F172A !important;
        }

        /* OVERRIDE FOR MOBILE OPTIMIZATIONS */
        @media (max-width: 768px) {
          .ad-header-card {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 8px !important;
          }
          .ad-sovereign-badge, .ad-active-contract-status {
            position: static !important;
            margin: 8px 0 0 0 !important;
            width: 100% !important;
          }
          .ad-pipeline-grid {
            grid-template-columns: 1fr !important;
          }
          .ad-draft-scope-grid {
            display: flex !important;
            flex-direction: column !important;
            width: 100% !important;
            gap: 8px !important;
          }
          .ad-synthesize-btn {
            width: 100% !important;
            min-height: 48px !important;
            font-size: 14px !important;
          }
          .autodraft-page-wrapper {
            padding-bottom: 96px !important;
            overflow-x: hidden !important;
            width: 100% !important;
            box-sizing: border-box !important;
          }
        }
      `}</style>

      {/* ── TOP HEADER & NAVIGATION ── */}
      <div className="ad-header-card">
        <div>
          <div className="ad-header-title-row">
            <span style={{ fontSize: '22px' }}>⚡</span>
            <h1 className="ad-title-gradient">Auto-Draft Studio</h1>
            <span className="ad-sovereign-badge">Sovereign Legal Engine · Indian Law</span>
          </div>
          <p className="ad-header-desc" style={{ fontSize: '12.5px', margin: '4px 0 0', color: 'var(--text-muted)' }}>
            Synthesize execution-ready Indian legal agreements, clauses, and precedents with AI statutory reasoning
          </p>
        </div>

        {/* Active Contract & Toolbar Shortcuts */}
        <div className="ad-active-contract-status" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              padding: '8px 14px',
              background: rawText.trim() ? 'rgba(16,185,129,0.08)' : 'var(--bg-card)',
              border: rawText.trim() ? '1px solid rgba(16,185,129,0.3)' : '1px solid var(--border-subtle)',
              borderRadius: '8px',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: rawText.trim() ? '#10B981' : '#94A3B8' }} />
            <span>
              {rawText.trim() ? (
                <>Active Contract Loaded: <strong style={{ color: 'var(--text-primary)' }}>{rawText.length.toLocaleString()} chars</strong></>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>No Active Contract (Standalone Clause Synthesis)</span>
              )}
            </span>
          </div>

          <button onClick={openDraftsModal} className="ad-action-btn ad-btn-purple">
            📁 Saved Drafts
          </button>

          <Link to="/contract-analyzer" style={{ textDecoration: 'none' }}>
            <button className="ad-action-btn ad-btn-primary">
              🔍 Open Contract Analyzer →
            </button>
          </Link>
        </div>
      </div>

      {/* ── MAIN WORKSPACE GRID ── */}
      <div className="ad-workspace-grid">

        {/* LEFT COLUMN — Live Editor & Document Canvas */}
        <div className="ad-canvas-panel">
          <div className="ad-canvas-header" style={{ gap: '12px', flexWrap: 'nowrap' }}>
            {/* Left: Title & Stats */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <h3 style={{ fontSize: '15px', fontWeight: 750, color: 'var(--text-primary)', margin: 0, whiteSpace: 'nowrap' }}>
                Synthesized Document
              </h3>
              {autoDraftText && (
                <span className="ad-metric-pill" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  ⚡ {wordCount} words · {charCount} chars
                </span>
              )}
            </div>

            {/* Right: Action Buttons Group */}
            {autoDraftText && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                <button type="button" onClick={handleCopyDraft} className="ad-action-btn ad-btn-secondary" style={{ padding: '6px 12px' }}>
                  {copied ? '✓ Copied!' : '📋 Copy'}
                </button>
                <button type="button" onClick={handleSaveToDrafts} className="ad-action-btn ad-btn-purple" style={{ padding: '6px 12px' }}>
                  {savedSuccess ? '✓ Saved!' : '💾 Save Draft'}
                </button>
                {rawText.trim() && (
                  <button type="button" onClick={handleAppendToContract} className="ad-action-btn ad-btn-primary" style={{ padding: '6px 12px' }}>
                    {appended ? '✓ Appended!' : '➕ Append'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAutoDraftText('')}
                  style={{
                    padding: '6px 12px', borderRadius: '8px', fontSize: '12px', background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Editor Canvas / In-Flight Reasoning State / Standby Hero */}
          <div className="ad-document-canvas" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {drafting ? (
              <div className="ad-synthesis-suite">
                {/* Glowing Orbit Radar Rings */}
                <div className="ad-orbit-wrapper">
                  <div className="ad-orbit-pulse" />
                  <div className="ad-orbit-ring-outer" />
                  <div className="ad-orbit-ring-inner" />
                  <div className="ad-orbit-core">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                  </div>
                </div>

                {/* Status Heading & Active Stage Description */}
                <div className="ad-synthesis-heading">
                  Synthesizing Execution-Ready Legal Agreement
                </div>
                <div className="ad-synthesis-subtext">
                  {DRAFT_STAGES[draftStep]?.desc || 'Cross-referencing Indian Contract Act, statutory enforceability parameters, and precedents…'}
                </div>

                {/* Smooth Progress Laser Bar */}
                <div className="ad-progress-container">
                  <div className="ad-progress-track">
                    <div className="ad-progress-fill" style={{ width: `${draftProgress}%` }} />
                  </div>
                  <div className="ad-progress-meta">
                    <span className="ad-stage-name">{DRAFT_STAGES[draftStep]?.title}</span>
                    <span className="ad-stage-pct">{Math.round(draftProgress)}% Completed</span>
                  </div>
                </div>

                {/* 4-Step Interactive Pipeline Tracker */}
                <div className="ad-pipeline-grid">
                  {DRAFT_STAGES.map((stg, sIdx) => {
                    const isDone = sIdx < draftStep;
                    const isCurrent = sIdx === draftStep;
                    return (
                      <div key={stg.title} className={`ad-step-card ${isDone ? 'done' : isCurrent ? 'active' : ''}`}>
                        <div className="ad-step-badge">
                          {isDone ? '✓' : `0${sIdx + 1}`}
                        </div>
                        <div className="ad-step-info">
                          <div className="ad-step-title">{stg.title}</div>
                          <div className="ad-step-desc">{stg.desc}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : draftError ? (
              <div style={{ padding: '24px', borderRadius: '12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.28)', color: '#EF4444', marginBottom: '16px' }}>
                <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>⚠️</span> Synthesis Error
                </div>
                <div style={{ fontSize: '13px', lineHeight: 1.6, color: '#FCA5A5' }}>{draftError}</div>
                <button onClick={() => setDraftError('')} style={{ marginTop: '14px', padding: '6px 14px', borderRadius: '6px', background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#EF4444', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Dismiss</button>
              </div>
            ) : autoDraftText ? (
              <ContractTiptapEditor
                documentKey={autoDraftVersion}
                initialRawText={autoDraftText}
                onTextChange={setAutoDraftText}
                clauses={[]}
              />
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </div>
                <div style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>Enterprise Auto-Draft Canvas Ready</div>
                <div style={{ fontSize: '13px', maxWidth: '420px', lineHeight: 1.6, color: 'var(--text-muted)' }}>
                  Enter drafting instructions in the top right console or select an Indian Playbook Precedent to synthesize structured, execution-ready contract clauses.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN — Synthesis Control Console (Instructions at the TOP!) */}
        <div className="ad-controls-panel">

          {/* CARD 1 (TOP): AI Synthesis Instructions & Engine */}
          <div className="ad-card ad-card-highlight">
            <div className="ad-card-title">
              <span>✍️</span> Custom Drafting Instructions
            </div>

            <form onSubmit={handleSynthesize} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <textarea
                  ref={promptTextareaRef}
                  required
                  rows={4}
                  placeholder="e.g. Synthesize a complete Non-Disclosure & Non-Circumvention Agreement under the Indian Contract Act, 1872 with 3-year survival, confidential definitions, mutual indemnity, and New Delhi arbitration..."
                  value={autoDraftPrompt}
                  onChange={(e) => setAutoDraftPrompt(e.target.value)}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: '10px',
                    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)', fontSize: '13.5px', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5,
                  }}
                />
              </div>

              {/* Quick Modifier Chips */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Quick Provision Insert Modifiers:
                </div>
                <div className="ad-modifiers-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <button type="button" className="ad-chip-btn" onClick={() => handleAddModifier('Include 30-day written cure period before escalation.')}>
                    + 30-Day Cure
                  </button>
                  <button type="button" className="ad-chip-btn" onClick={() => handleAddModifier('Cap aggregate liability at 100% of fees paid.')}>
                    + 100% Fee Cap
                  </button>
                  <button type="button" className="ad-chip-btn" onClick={() => handleAddModifier('Seat of arbitration shall be New Delhi under Arbitration Act 1996.')}>
                    + New Delhi Seat
                  </button>
                  <button type="button" className="ad-chip-btn" onClick={() => handleAddModifier('Include Section 27 Indian Contract Act exception for trade secrets.')}>
                    + Sec 27 Carve-out
                  </button>
                </div>
              </div>

              {/* Synthesis Depth & Context Controls */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '10px', marginTop: '2px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Reference Context
                  </label>
                  <select
                    value={selectedContextMode}
                    onChange={(e) => setSelectedContextMode(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: '7px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: '12px' }}
                  >
                    <option value="active_contract">Active Contract ({rawText.length} chars)</option>
                    <option value="none">No Context (Standalone)</option>
                    {vaultDocs.length > 0 && (
                      <optgroup label="Vault Documents">
                        {vaultDocs.map((doc) => (
                          <option key={doc.id} value={doc.id}>{doc.filename}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Scope Depth
                  </label>
                  <select
                    value={draftDepth}
                    onChange={(e) => setDraftDepth(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: '7px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: '12px' }}
                  >
                    <option value="comprehensive">Comprehensive</option>
                    <option value="standard">Standard Clause</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <button
                  type="submit"
                  disabled={drafting}
                  className="ad-action-btn ad-btn-primary ad-synthesize-btn"
                  style={{ flex: 1, padding: '13px', fontSize: '14px', fontWeight: 700, borderRadius: '10px', justifyContent: 'center' }}
                >
                  {drafting ? 'Synthesizing Legal Clause…' : '⚡ Synthesize Enterprise Clause'}
                </button>
                <button
                  type="button"
                  disabled={uploadingDraft}
                  onClick={() => draftUploadInputRef.current?.click()}
                  className="ad-action-btn ad-btn-secondary"
                  title="Upload an existing draft (PDF, DOCX, or TXT) directly into the editor"
                  style={{ padding: '13px 16px', fontSize: '13px', fontWeight: 600, borderRadius: '10px', justifyContent: 'center', flexShrink: 0 }}
                >
                  {uploadingDraft ? '…' : '📤 Upload Draft'}
                </button>
                <input
                  type="file"
                  ref={draftUploadInputRef}
                  style={{ display: 'none' }}
                  accept=".pdf,.docx,.txt"
                  onChange={(e) => handleUploadDraft(e.target.files)}
                />
              </div>
              {draftUploadError && (
                <div style={{ fontSize: '11.5px', color: '#EF4444', marginTop: '-4px' }}>
                  {draftUploadError}
                </div>
              )}
            </form>
          </div>

          {/* CARD 2 (BOTTOM): Indian Playbook Precedent Inserts */}
          <div className="ad-card">
            <div className="ad-card-title">
              <span>📜</span> Indian Playbook Precedent Inserts
            </div>
            <div className="ad-precedent-grid">
              {PRECEDENTS.map(({ label, badge, prompt }) => (
                <div
                  key={label}
                  className="ad-precedent-card"
                  onClick={() => {
                    setAutoDraftPrompt(prompt);
                    if (promptTextareaRef.current) {
                      promptTextareaRef.current.focus();
                      promptTextareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  }}
                >
                  <div className="ad-precedent-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                    <span className="ad-precedent-title">{label}</span>
                    <span className="ad-precedent-badge">
                      {badge}
                    </span>
                  </div>
                  <span className="ad-precedent-desc" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {prompt}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>

      <DraftsModal />
    </div>
  );
}
