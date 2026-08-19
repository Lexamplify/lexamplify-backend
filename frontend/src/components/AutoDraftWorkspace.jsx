import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ContractTiptapEditor from './ContractTiptapEditor.jsx';
import DraftsModal from './DraftsModal.jsx';
import { useContractStore } from '../store/useContractStore.js';
import { fetchDocuments } from '../services/api.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export default function AutoDraftWorkspace() {
  const navigate = useNavigate();
  const isMountedRef = useRef(true);

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
  const [draftStatus, setDraftStatus] = useState('');
  const [draftError, setDraftError] = useState('');
  const [vaultDocs, setVaultDocs] = useState([]);
  const [selectedContextMode, setSelectedContextMode] = useState('active_contract');
  const [draftDepth, setDraftDepth] = useState('comprehensive');
  const [copied, setCopied] = useState(false);
  const [appended, setAppended] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

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

  // Cycling in-flight status messages during AI reasoning
  useEffect(() => {
    if (!drafting) return;
    const phases = [
      'Interpreting drafting instructions & statutory bounds…',
      'Cross-referencing Indian Contract Act & Supreme Court precedents…',
      'Synthesizing structured, multi-tier legal provisions…',
      'Refining clause numbering, indents & statutory enforceability…',
    ];
    let i = 0;
    setDraftStatus(phases[0]);
    const id = setInterval(() => {
      i = (i + 1) % phases.length;
      setDraftStatus(phases[i]);
    }, 1600);
    return () => clearInterval(id);
  }, [drafting]);

  const handleSynthesize = async (e) => {
    if (e) e.preventDefault();
    if (!autoDraftPrompt.trim()) {
      setDraftError('Please enter drafting instructions before synthesizing.');
      return;
    }

    setDrafting(true);
    setDraftError('');
    setDraftStatus('Initializing Groq Llama3 Indian Legal Reasoning Engine…');

    try {
      let contextValue = null;
      if (selectedContextMode === 'active_contract' && rawText.trim()) {
        contextValue = rawText.trim();
      } else if (selectedContextMode !== 'none' && selectedContextMode !== 'active_contract') {
        contextValue = selectedContextMode;
      }

      const response = await fetch(`${API_BASE}/api/documents/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: autoDraftPrompt.trim(),
          context: contextValue,
          depth: draftDepth,
        }),
      });
      const data = await response.json();

      if (!isMountedRef.current) return;
      setDrafting(false);
      setDraftStatus('');

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
      setDraftStatus('');
      setDraftError('Network timeout in the AI legal reasoning engine. Please retry.');
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
          grid-template-columns: minmax(0, 1.25fr) minmax(360px, 0.75fr);
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
          min-height: 680px;
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

        .ad-card-title {
          font-size: 12px;
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
          gap: 10px;
        }

        .ad-precedent-card {
          display: flex;
          flex-direction: column;
          text-align: left;
          padding: 12px 14px;
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
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .ad-precedent-desc {
          font-size: 11.5px;
          color: var(--text-muted);
          line-height: 1.4;
        }

        .ad-precedent-badge {
          font-size: 10px;
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
          padding: 4px 10px;
          border-radius: 14px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .ad-chip-btn:hover {
          background: var(--accent-muted);
          color: var(--accent-primary);
          border-color: var(--accent-primary);
        }

        /* TipTap Document Canvas Styling */
        .ad-document-canvas .scanner-body .ProseMirror {
          min-height: 480px;
          padding: 24px;
          background: var(--bg-card);
          border-radius: 12px;
          border: 1px solid var(--border-subtle);
          font-size: 14px;
          line-height: 1.75;
          color: var(--text-primary);
          outline: none;
        }

        .ad-document-canvas .scanner-body .ProseMirror h3 {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--text-primary);
          border-bottom: 1px solid var(--border-subtle);
          padding-bottom: 6px;
          margin-top: 1.6rem;
          margin-bottom: 1rem;
        }

        .ad-document-canvas .scanner-body .ProseMirror p {
          margin-bottom: 1.2rem;
          text-align: justify;
          color: var(--text-primary);
        }

        .ad-document-canvas .scanner-body .ProseMirror strong {
          color: var(--accent-primary);
          font-weight: 700;
        }

        .ad-loading-pulse {
          animation: pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

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

        :root[data-theme="light"] textarea,
        :root[data-theme="light"] select {
          background: #FFFFFF !important;
          border-color: #CBD5E1 !important;
          color: #0F172A !important;
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
          border-bottom-color: #E2E8F0 !important;
        }

        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror strong,
        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror b {
          color: #1D4ED8 !important;
          font-weight: 700 !important;
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
            top: auto !important;
            right: auto !important;
            transform: none !important;
            margin: 8px 0 0 0 !important;
            width: 100% !important;
          }
          .ad-header-desc {
            width: 100% !important;
          }
          .ad-draft-scope-grid {
            display: flex !important;
            flex-direction: column !important;
            width: 100% !important;
            gap: 8px !important;
          }
          .ad-draft-scope-grid button {
            width: 100% !important;
            min-height: 44px !important;
            padding: 10px 14px !important;
            text-align: center !important;
            white-space: normal !important;
            justify-content: center !important;
          }
          .ad-precedent-header {
            display: flex !important;
            flex-wrap: wrap !important;
            justify-content: space-between !important;
            align-items: flex-start !important;
            gap: 6px !important;
          }
          .ad-precedent-title {
            font-size: 13px !important;
            line-height: 1.4 !important;
            flex: 1 1 auto !important;
            max-width: calc(100% - 100px) !important;
          }
          .ad-precedent-badge {
            flex-shrink: 0 !important;
            font-size: 10px !important;
            padding: 2px 6px !important;
          }
          .ad-modifiers-row {
            flex-wrap: wrap !important;
            gap: 6px !important;
          }
          .ad-chip-btn {
            min-height: 32px !important;
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
          <p className="ad-header-desc" style={{ fontSize: '12.5px', margin: '4px 0 0' }}>
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
            {/* Left: Title & Truncated Stats */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0, whiteSpace: 'nowrap' }}>
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
              <div style={{ padding: '60px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', flex: 1, textAlign: 'center' }}>
                <div style={{ position: 'relative', width: '48px', height: '48px' }}>
                  <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '3px solid #3B82F6', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                  <div style={{ position: 'absolute', inset: '8px', borderRadius: '50%', border: '3px solid #8B5CF6', borderBottomColor: 'transparent', animation: 'spin 1.2s linear infinite reverse' }} />
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#3B82F6', marginBottom: '6px' }} className="ad-loading-pulse">
                    {draftStatus || 'Synthesizing clause…'}
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', maxWidth: '420px', lineHeight: 1.6 }}>
                    Cross-referencing Indian Contract Act, statutory enforceability guidelines, and Supreme Court precedent parameters…
                  </div>
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
                  Select an Indian Playbook Precedent from the right console or enter custom legal drafting instructions to synthesize structured, execution-ready contract clauses.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN — Synthesis Control Console */}
        <div className="ad-controls-panel">

          {/* Card 1: Playbook Precedents */}
          <div className="ad-card">
            <div className="ad-card-title">
              <span>📜</span> Indian Playbook Precedent Inserts
            </div>
            <div className="ad-precedent-grid">
              {PRECEDENTS.map(({ label, badge, prompt }) => (
                <div
                  key={label}
                  className="ad-precedent-card"
                  onClick={() => setAutoDraftPrompt(prompt)}
                >
                  <div className="ad-precedent-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
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

          {/* Card 2: Context & Depth Engine */}
          <div className="ad-card">
            <div className="ad-card-title">
              <span>⚙️</span> Synthesis Depth &amp; Reference Context
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                  Reference Context Mode
                </label>
                <select
                  value={selectedContextMode}
                  onChange={(e) => setSelectedContextMode(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: '13px' }}
                >
                  <option value="active_contract">Active Loaded Contract ({rawText.length} chars)</option>
                  <option value="none">No Context (Standalone Clause)</option>
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
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-primary)', marginBottom: '8px' }}>
                  Draft Scope &amp; Legal Detail Depth
                </label>
                <div className="ad-draft-scope-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setDraftDepth('comprehensive')}
                    style={{
                      padding: '8px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                      background: draftDepth === 'comprehensive' ? 'rgba(59,130,246,0.15)' : 'var(--bg-card)',
                      border: draftDepth === 'comprehensive' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                      color: draftDepth === 'comprehensive' ? 'var(--accent-primary)' : 'var(--text-muted)', cursor: 'pointer',
                    }}
                  >
                    Comprehensive (Recitals &amp; Remedies)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftDepth('standard')}
                    style={{
                      padding: '8px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                      background: draftDepth === 'standard' ? 'rgba(59,130,246,0.15)' : 'var(--bg-card)',
                      border: draftDepth === 'standard' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                      color: draftDepth === 'standard' ? 'var(--accent-primary)' : 'var(--text-muted)', cursor: 'pointer',
                    }}
                  >
                    Standard Clause Only
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: AI Synthesis Prompt Engine */}
          <div className="ad-card">
            <div className="ad-card-title">
              <span>✍️</span> Custom Drafting Instructions
            </div>

            <form onSubmit={handleSynthesize} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <textarea
                  required
                  rows={5}
                  placeholder="e.g. Synthesize a non-compete clause limited to 2 years within India under Section 27 of the Indian Contract Act, including a 30-day cure period and New Delhi arbitration..."
                  value={autoDraftPrompt}
                  onChange={(e) => setAutoDraftPrompt(e.target.value)}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '14px', borderRadius: '10px',
                    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)', fontSize: '13.5px', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5,
                  }}
                />
              </div>

              {/* Quick Modifier Chips */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>
                  Quick Provision Insert Modifiers:
                </div>
                <div className="ad-modifiers-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <button type="button" className="ad-chip-btn" onClick={() => handleAddModifier('Include 30-day written cure period before escalation.')}>
                    + 30-Day Cure
                  </button>
                  <button type="button" className="ad-chip-btn" onClick={() => handleAddModifier('Cap aggregate liability at 100% of fees paid.')}>
                    + 100% Fee Cap
                  </button>
                  <button type="button" className="ad-chip-btn" onClick={() => handleAddModifier('Seat of arbitration shall be New Delhi under ICA Rules.')}>
                    + New Delhi Seat
                  </button>
                  <button type="button" className="ad-chip-btn" onClick={() => handleAddModifier('Include Section 27 Indian Contract Act exception for trade secrets.')}>
                    + Sec 27 Carve-out
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={drafting}
                className="ad-action-btn ad-btn-primary ad-synthesize-btn"
                style={{ width: '100%', padding: '14px', fontSize: '14.5px', fontWeight: 700, borderRadius: '10px', justifyContent: 'center' }}
              >
                {drafting ? 'Synthesizing Legal Clause…' : '⚡ Synthesize Enterprise Clause'}
              </button>
            </form>
          </div>

        </div>

      </div>

      <DraftsModal />
    </div>
  );
}
