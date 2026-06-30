import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, Link, useNavigate } from 'react-router-dom';
import { fetchDocumentDetails } from '../services/api';
import { renderMarkdown, MARKDOWN_CSS } from '../utils/markdownUtils';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';

const DV_STYLES = `
  /* ── Spinners / utility ──────────────────────────────── */
  @keyframes dv-spin {
    to { transform: rotate(360deg); }
  }

  /* ── Task 3: Document pulse while AI reads ───────────── */
  @keyframes doc-pulse {
    0%   { opacity: 1; box-shadow: inset 0 0 0 transparent; }
    50%  { opacity: 0.6; box-shadow: inset 0 0 20px rgba(59,130,246,0.15); background: #F8FAFC; }
    100% { opacity: 1; box-shadow: inset 0 0 0 transparent; }
  }
  .anim-doc-pulse {
    animation: doc-pulse 1.5s ease-in-out;
  }

  /* ── Task 1: Light-theme markdown override ───────────── */
  /* Applied to the paper document area so MARKDOWN_CSS dark  */
  /* colors don't bleed through on the white/cream background */
  .vault-doc-theme .md-p,
  .vault-doc-theme p    { color: #1E293B !important; }
  .vault-doc-theme .md-h2,
  .vault-doc-theme h1,
  .vault-doc-theme h2   { color: #0F172A !important; font-weight: 800; }
  .vault-doc-theme .md-h3,
  .vault-doc-theme h3   { color: #1E293B !important; font-weight: 700; }
  .vault-doc-theme .md-h4,
  .vault-doc-theme h4, h5, h6 { color: #334155 !important; }
  .vault-doc-theme .md-b,
  .vault-doc-theme strong { color: #0F172A !important; }
  .vault-doc-theme .md-i,
  .vault-doc-theme em   { color: #334155 !important; }
  .vault-doc-theme .md-code,
  .vault-doc-theme code { background: rgba(37,99,235,0.07) !important; color: #1D4ED8 !important; }
  .vault-doc-theme .md-dot  { color: #2563EB !important; }
  .vault-doc-theme .md-num-n { color: #2563EB !important; }
  .vault-doc-theme .md-bullet span:last-child,
  .vault-doc-theme .md-num   span:last-child { color: #1E293B !important; }
  .vault-doc-theme li,
  .vault-doc-theme blockquote,
  .vault-doc-theme a    { color: #1E293B !important; }
  .vault-doc-theme a    { text-decoration: underline; }

  /* ── Task 2: Right-column layout ────────────────────── */
  .dv-right-col {
    width: 400px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-dark-app, #0f131a);
    border-left: 1px solid var(--border-dark-subtle, #2C3241);
    overflow: hidden;
  }

  /* Sidebar (info panel) inside right col */
  .dv-sidebar {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    scrollbar-width: thin;
    scrollbar-color: rgba(59,130,246,0.15) transparent;
  }
  .dv-sidebar::-webkit-scrollbar { width: 3px; }
  .dv-sidebar::-webkit-scrollbar-thumb { background: rgba(59,130,246,0.15); border-radius: 2px; }

  /* Task 2: AI panel fade-in when it mounts */
  @keyframes dv-panel-fade {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .dv-ai-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: dv-panel-fade 0.3s ease;
  }
  .dv-ai-header {
    padding: 14px 18px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }
  .dv-ai-title {
    font-size: 12.5px;
    font-weight: 700;
    color: white;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-sans);
    letter-spacing: 0.2px;
  }
  .dv-ai-live-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #10B981;
    box-shadow: 0 0 6px #10B981;
    animation: dv-ai-pulse 2s ease-in-out infinite;
  }
  @keyframes dv-ai-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
  .dv-ai-close-btn {
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.4);
    cursor: pointer;
    font-size: 16px;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 5px;
    transition: all 0.15s;
    line-height: 1;
  }
  .dv-ai-close-btn:hover { color: white; background: rgba(255,255,255,0.08); }
  .dv-ai-messages {
    flex: 1;
    overflow-y: auto;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    scrollbar-width: thin;
    scrollbar-color: rgba(59,130,246,0.15) transparent;
  }
  .dv-ai-messages::-webkit-scrollbar { width: 3px; }
  .dv-ai-messages::-webkit-scrollbar-thumb { background: rgba(59,130,246,0.2); border-radius: 2px; }
  .dv-ai-bubble {
    padding: 10px 13px;
    border-radius: 10px;
    font-size: 13px;
    line-height: 1.6;
    font-family: var(--font-sans);
    word-break: break-word;
  }
  .dv-ai-bubble.user {
    align-self: flex-end;
    max-width: 85%;
    background: #2563EB;
    color: #EFF6FF;
    border-bottom-right-radius: 3px;
    box-shadow: 0 2px 10px rgba(37,99,235,0.25);
  }
  .dv-ai-bubble.bot {
    align-self: flex-start;
    max-width: 94%;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07);
    color: #CBD5E1;
    border-bottom-left-radius: 3px;
  }
  .dv-ai-bubble.typing {
    align-self: flex-start;
    max-width: 80%;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    color: rgba(139,148,162,0.75);
    font-style: italic;
    border-bottom-left-radius: 3px;
    animation: dv-typing-blink 1.1s ease-in-out infinite;
  }
  @keyframes dv-typing-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  .dv-ai-input-row {
    display: flex;
    border-top: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.02);
    flex-shrink: 0;
  }
  .dv-ai-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: white;
    font-size: 13px;
    font-family: var(--font-sans);
    padding: 12px 14px;
  }
  .dv-ai-input::placeholder { color: rgba(139,148,162,0.55); }
  .dv-ai-send {
    background: #2563EB;
    border: none;
    padding: 0 16px;
    cursor: pointer;
    color: white;
    font-size: 12px;
    font-weight: 700;
    font-family: var(--font-sans);
    letter-spacing: 0.3px;
    transition: background 0.15s;
    flex-shrink: 0;
  }
  .dv-ai-send:hover:not(:disabled) { background: #1D4ED8; }
  .dv-ai-send:disabled { opacity: 0.3; cursor: not-allowed; }

  /* ── Objective 2: Bulletproof title on white paper ── */
  .dv-doc-title {
    color: #0F172A !important;
    font-family: var(--font-serif, Georgia, serif);
    font-weight: 700;
    line-height: 1.3;
    font-size: 26px;
    margin: 6px 0 0;
  }

  /* ── Objective 3: Light-theme RTE toolbar ── */
  .dv-rte-toolbar {
    display: flex; align-items: center; gap: 2px;
    padding: 6px 14px; flex-wrap: wrap; flex-shrink: 0;
    background: #F1F5F9; border-bottom: 1px solid #E2E8F0;
    position: sticky; top: 0; z-index: 10;
  }
  .dv-rte-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .07em; color: #94A3B8; margin-right: 4px;
  }
  .dv-rte-btn {
    display: flex; align-items: center; justify-content: center;
    min-width: 30px; height: 28px; padding: 0 7px;
    background: transparent; border: 1px solid transparent;
    border-radius: 4px; cursor: pointer; transition: all .12s;
    color: #475569; font-size: 12.5px; font-family: inherit; line-height: 1;
    user-select: none;
  }
  .dv-rte-btn:hover { background: rgba(59,130,246,.1); border-color: rgba(59,130,246,.25); color: #2563EB; }
  .dv-rte-sep { width: 1px; height: 20px; background: #CBD5E1; margin: 0 4px; flex-shrink: 0; }
  .dv-rte-group { display: flex; align-items: center; gap: 1px; }

  /* ── Floating save FAB ── */
  @keyframes dv-fab-rise {
    from { opacity: 0; transform: translateX(-50%) translateY(14px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  .dv-save-fab {
    position: fixed; bottom: 28px;
    left: calc(50vw - 200px); transform: translateX(-50%);
    z-index: 500;
    display: flex; align-items: center; gap: 8px;
    padding: 11px 26px; border-radius: 10px; border: none; cursor: pointer;
    font-size: 13px; font-weight: 700; font-family: var(--font-sans);
    transition: background 0.2s, box-shadow 0.2s, transform 0.2s;
    box-shadow: 0 6px 24px rgba(0,0,0,0.3);
    animation: dv-fab-rise 0.28s cubic-bezier(0.34,1.56,0.64,1) forwards;
    white-space: nowrap;
  }
  .dv-save-fab.dirty  { background: #2563EB; color: white; }
  .dv-save-fab.dirty:hover  { background: #1D4ED8; box-shadow: 0 8px 28px rgba(37,99,235,.4); transform: translateX(-50%) translateY(-1px); }
  .dv-save-fab.saving { background: rgba(37,99,235,0.55); color: white; cursor: not-allowed; }
  .dv-save-fab.success { background: #059669; color: white; cursor: default; }

  /* ── Dirty indicator badge (sidebar) ── */
  .dv-dirty-badge {
    display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600;
    color: #F59E0B; background: rgba(245,158,11,0.1);
    border: 1px solid rgba(245,158,11,0.22); border-radius: 5px; padding: 5px 9px;
  }

  /* ── Editable body (no focus ring) ── */
  .dv-editable-body { outline: none !important; caret-color: #2563EB; min-height: 200px; }
  .dv-editable-body:focus { outline: none !important; }
`;

// ─── Light-theme Rich Text Toolbar ──────────────────────────────────────────
// onMouseDown e.preventDefault() keeps selection/focus on the contentEditable
// body instead of shifting to the button, so execCommand sees the right range.
function DVRichTextToolbar({ targetRef }) {
  const exec = (cmd, val = null) => { targetRef.current?.focus(); document.execCommand(cmd, false, val); };
  return (
    <div className="dv-rte-toolbar" onMouseDown={e => e.preventDefault()}>
      <span className="dv-rte-label">Format</span>
      <div className="dv-rte-group">
        <button className="dv-rte-btn" title="Bold (Ctrl+B)" onMouseDown={() => exec('bold')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>
        </button>
        <button className="dv-rte-btn" title="Italic (Ctrl+I)" onMouseDown={() => exec('italic')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
        </button>
        <button className="dv-rte-btn" title="Underline (Ctrl+U)" onMouseDown={() => exec('underline')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg>
        </button>
        <button className="dv-rte-btn" title="Strikethrough" onMouseDown={() => exec('strikeThrough')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="4" y1="12" x2="20" y2="12"/><path d="M8 8c0-2.2 1.8-4 4-4s4 1.8 4 4c0 1.1-.4 2-1 2.7"/><path d="M8 16c0 2.2 1.8 4 4 4s4-1.8 4-4"/></svg>
        </button>
      </div>
      <div className="dv-rte-sep"/>
      <div className="dv-rte-group">
        <button className="dv-rte-btn" title="Numbered list" onMouseDown={() => exec('insertOrderedList')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="2" y="7" fontSize="6" fill="currentColor" stroke="none" fontWeight="700">1.</text><text x="2" y="13" fontSize="6" fill="currentColor" stroke="none" fontWeight="700">2.</text><text x="2" y="19" fontSize="6" fill="currentColor" stroke="none" fontWeight="700">3.</text></svg>
        </button>
        <button className="dv-rte-btn" title="Bullet list" onMouseDown={() => exec('insertUnorderedList')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
        </button>
      </div>
      <div className="dv-rte-sep"/>
      <div className="dv-rte-group">
        <button className="dv-rte-btn" title="Clear formatting" onMouseDown={() => exec('removeFormat')} style={{ color: '#94A3B8' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.375-9.375z"/><line x1="6" y1="20" x2="10" y2="16" strokeWidth="2.5" stroke="#F87171"/></svg>
        </button>
      </div>
    </div>
  );
}

export default function DocumentViewer({ focusMode, setFocusMode }) {
  const { caseId, docId } = useParams();
  const location = useLocation();
  const navigate  = useNavigate();
  const fromVault = caseId === 'vault' || location.state?.fromVault;
  const backTo    = fromVault ? '/vault' : `/case/${caseId}`;
  const backLabel = fromVault ? 'Back to Document Vault' : 'Back to Case Directory';

  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // AI panel state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiMessages, setAiMessages] = useState([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiEndRef = useRef(null);
  const docRef   = useRef(null);

  // Rich-text editor state
  const [isDirty,     setIsDirty]     = useState(false);
  const [isSaving,    setIsSaving]    = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError,   setSaveError]   = useState(null);
  const docBodyRef = useRef(null);

  useEffect(() => { docRef.current = doc; }, [doc]);

  useEffect(() => {
    aiEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages]);

  // ── Initialize contentEditable with rendered HTML ─────────────────────────
  useEffect(() => {
    if (docBodyRef.current && doc !== null) {
      docBodyRef.current.innerHTML = doc.text ? renderMarkdown(doc.text) : '';
      setIsDirty(false);
    }
  }, [doc]);

  // ── Warn before browser tab/window close with unsaved changes ─────────────
  useEffect(() => {
    const guard = (e) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [isDirty]);

  // ── Save handler ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!doc?.id || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
    const newContent = docBodyRef.current?.innerText || '';
    try {
      const res = await fetch(`${API_BASE}/api/vault/documents/${doc.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ content: newContent }),
      });
      if (res.ok) {
        setIsDirty(false);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2600);
      } else {
        setSaveError('Save failed — server error. Please retry.');
      }
    } catch {
      setSaveError('Save failed — network error.');
    }
    setIsSaving(false);
  };

  // ── Navigate back with dirty-check ────────────────────────────────────────
  const handleBack = () => {
    if (isDirty && !window.confirm('You have unsaved changes. Are you sure you want to leave?')) return;
    navigate(backTo);
  };

  // ── Document load ─────────────────────────────────────────────────────────
  useEffect(() => {
    const injected = location.state?.docData;
    if (injected) {
      setDoc(injected);
      setLoading(false);
      const autoQuery = location.state?.autoQuery;
      if (autoQuery) triggerAiPanel(autoQuery);
      return;
    }

    const loadDocument = async () => {
      setLoading(true);
      setError(null);
      const response = await fetchDocumentDetails(docId);
      if (response.error) {
        setError(response.message);
      } else {
        setDoc(response);
      }
      setLoading(false);
    };
    loadDocument();
  }, [docId, location.state]);

  // ── AI Chat ───────────────────────────────────────────────────────────────
  const submitAiMessage = async (text) => {
    if (!text?.trim() || aiLoading) return;
    const query = text.trim();
    setAiInput('');
    setAiMessages(prev => [...prev, { role: 'user', text: query }]);
    setAiLoading(true);

    const currentDoc = docRef.current;
    const docContext = (currentDoc?.text || '').substring(0, 3000);
    const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');

    try {
      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: `[Document Analysis Mode]\n\nDocument Title: ${currentDoc?.filename || 'Legal Document'}\n\nDocument Excerpt:\n${docContext}\n\nQuestion: ${query}`,
        }),
      });
      const data = await res.json();
      setAiMessages(prev => [...prev, { role: 'bot', text: data.response || 'No response received.' }]);
    } catch {
      setAiMessages(prev => [...prev, { role: 'bot', text: 'Connection error. Please retry.' }]);
    }
    setAiLoading(false);
  };

  const triggerAiPanel = (initialQuery = null) => {
    if (showAiPanel || isAnalyzing) return;
    setIsAnalyzing(true);
    setTimeout(() => {
      setIsAnalyzing(false);
      setShowAiPanel(true);
      setAiMessages([{ role: 'bot', text: 'Document ingested. What would you like to know?' }]);
      if (initialQuery) setAiInput(initialQuery);
    }, 1500);
  };

  const handleAiSubmit = (e) => {
    e.preventDefault();
    submitAiMessage(aiInput);
  };

  // ── Render: Loading ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: '40px', color: 'var(--text-dark-muted)', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <style>{`@keyframes dv-spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ width: '24px', height: '24px', border: '2.5px solid rgba(255,255,255,0.2)', borderRadius: '50%', borderTopColor: 'var(--accent-primary)', animation: 'dv-spin 0.8s linear infinite' }} />
        <span style={{ fontStyle: 'italic', fontSize: '13px' }}>Reconstructing case document from vectorized semantic chunks...</span>
      </div>
    );
  }

  if (error || !doc) {
    const isSynthetic = String(docId).startsWith('rag-') || String(docId).startsWith('template-') || String(docId).startsWith('fl-');
    return (
      <div style={{ padding: '48px 40px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
        <h3 style={{ margin: 0, fontSize: 18, color: isSynthetic ? 'var(--text-primary, #F8FAFC)' : 'var(--accent-danger)' }}>
          {isSynthetic ? '📄 Document not synced' : '⚠️ Load Failed'}
        </h3>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-dark-muted)', lineHeight: 1.6 }}>
          {isSynthetic
            ? 'This document was generated in-session and has not been persisted to the backend. Navigate back to the Vault and open it again — the editor will load from the injected content.'
            : (error || 'Unable to locate document records.')}
        </p>
        <Link to={backTo} style={{ display: 'inline-block', marginTop: 8, color: 'var(--accent-primary)', textDecoration: 'none', fontSize: 13 }}>
          ← {backLabel}
        </Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden', fontFamily: 'var(--font-sans)' }}>
      <style>{DV_STYLES}</style>
      <style>{MARKDOWN_CSS}</style>

      {/* ── LEFT: Document Editor (flex: 1) ─── */}
      <div
        className={`document-viewer-panel${isAnalyzing ? ' anim-doc-pulse' : ''}`}
        style={{
          flex: 1,
          backgroundColor: 'var(--bg-paper-viewer, #FAFAF8)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          fontFamily: 'var(--font-serif, Georgia, serif)',
          lineHeight: '1.8',
          fontSize: '15px',
        }}
      >
        {/* Sticky Rich-Text Toolbar — Objective 3 */}
        <DVRichTextToolbar targetRef={docBodyRef} />

        {/* Paper content area */}
        <div style={{ padding: '40px 60px', color: '#1E293B', flex: 1 }}>
          {/* Title header — Objective 2 */}
          <div style={{ borderBottom: '1px solid #E2E8F0', paddingBottom: '16px', marginBottom: '28px' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1.2px', color: '#64748B', fontWeight: '700' }}>
              OFFICIAL VAULT COPY
            </span>
            <h1 className="dv-doc-title">{doc.filename}</h1>
          </div>

          {/* Editable document body — Objective 3 */}
          {doc.text !== undefined ? (
            <div
              ref={docBodyRef}
              className="vault-doc-theme md-body dv-editable-body"
              contentEditable={true}
              suppressContentEditableWarning={true}
              onInput={() => { if (!isDirty) setIsDirty(true); }}
            />
          ) : (
            <div style={{ fontStyle: 'italic', color: '#64748B' }}>
              No text chunks found for this document. Try re-uploading the file.
            </div>
          )}
        </div>
      </div>

      {/* ── Floating Save FAB — Objective 3 ─── */}
      {(isDirty || isSaving || saveSuccess) && (
        <button
          className={`dv-save-fab ${isSaving ? 'saving' : saveSuccess ? 'success' : 'dirty'}`}
          onClick={handleSave}
          disabled={isSaving || saveSuccess}
          title={saveError || undefined}
        >
          {isSaving ? (
            <>
              <div style={{ width: '12px', height: '12px', border: '2px solid rgba(255,255,255,.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'dv-spin 0.7s linear infinite', flexShrink: 0 }}/>
              Saving…
            </>
          ) : saveSuccess ? (
            <>✓ Saved to Vault</>
          ) : (
            <>
              <svg width="12" height="12" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              Save Changes
            </>
          )}
        </button>
      )}

      {/* ── RIGHT: Fixed 400px column — sidebar OR AI chat ─── */}
      <div className="dv-right-col">

        {showAiPanel ? (
          /* AI Chat Panel — fades in, scrolls independently */
          <div className="dv-ai-panel">
            <div className="dv-ai-header">
              <div className="dv-ai-title">
                <div className="dv-ai-live-dot" />
                Document AI
              </div>
              <button
                className="dv-ai-close-btn"
                onClick={() => setShowAiPanel(false)}
                title="Close AI panel"
              >
                ✕
              </button>
            </div>

            <div className="dv-ai-messages">
              {aiMessages.map((m, i) => (
                <div key={i} className={`dv-ai-bubble ${m.role}`}>
                  {m.role === 'bot' ? (
                    <div
                      className="md-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }}
                    />
                  ) : (
                    m.text
                  )}
                </div>
              ))}
              {aiLoading && <div className="dv-ai-bubble typing">Analyzing document…</div>}
              <div ref={aiEndRef} />
            </div>

            <form className="dv-ai-input-row" onSubmit={handleAiSubmit}>
              <input
                className="dv-ai-input"
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                placeholder="Ask about this document…"
                disabled={aiLoading}
              />
              <button
                type="submit"
                className="dv-ai-send"
                disabled={aiLoading || !aiInput.trim()}
              >
                Send
              </button>
            </form>
          </div>

        ) : (
          /* Sidebar — info panel */
          <div className="dv-sidebar">
            <div>
              <button
                onClick={handleBack}
                style={{ background: 'none', border: 'none', color: 'var(--accent-primary, #3B82F6)', textDecoration: 'none', fontSize: '13px', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-sans)' }}
              >
                ← {backLabel}
              </button>
              {isDirty && (
                <div className="dv-dirty-badge" style={{ marginTop: '10px' }}>
                  ✏️ Unsaved changes
                </div>
              )}
              <h2 style={{ fontSize: '18px', marginTop: '14px', marginBottom: '2px', color: 'white' }}>RAG Ingestion</h2>
              <span style={{ fontSize: '11px', color: 'var(--text-dark-muted, #8F9CAE)' }}>Indexed Database ID: #{doc.id}</span>
            </div>

            <div style={{ background: 'var(--bg-dark-panel, #171c26)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-dark-subtle, #2C3241)' }}>
              <h4 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-dark-muted, #8F9CAE)', marginBottom: '9px', letterSpacing: '0.6px', margin: '0 0 9px' }}>
                AI Executive Summary
              </h4>
              <p style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--text-dark-primary, white)', margin: 0 }}>
                {doc.summary || 'No summary generated.'}
              </p>
            </div>

            <div>
              <button
                onClick={() => triggerAiPanel()}
                disabled={isAnalyzing}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '13px',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: isAnalyzing ? 'default' : 'pointer',
                  background: isAnalyzing ? 'rgba(59,130,246,0.3)' : 'var(--accent-primary, #3B82F6)',
                  color: 'white',
                  boxShadow: '0 4px 6px rgba(59,130,246,0.15)',
                  transition: 'all 0.2s',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {isAnalyzing ? '🤖 Analyzing document…' : '💬 Ask AI about this Doc'}
              </button>
              <div style={{ fontSize: '10.5px', color: 'var(--text-dark-muted, #8F9CAE)', textAlign: 'center', marginTop: '7px' }}>
                Opens inline AI chat — document stays stable
              </div>
            </div>

            <div style={{ background: 'var(--bg-dark-panel, #171c26)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-dark-subtle, #2C3241)' }}>
              <h4 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-dark-muted, #8F9CAE)', marginBottom: '9px', letterSpacing: '0.6px', margin: '0 0 9px' }}>
                Viewport Settings
              </h4>
              <button
                type="button"
                onClick={() => setFocusMode(!focusMode)}
                style={{
                  width: '100%',
                  padding: '9px',
                  background: focusMode ? 'var(--accent-primary, #3B82F6)' : 'var(--bg-dark-app, #0f131a)',
                  color: 'white',
                  border: '1px solid var(--border-dark-subtle, #2C3241)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: '500',
                  transition: 'all 0.2s',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {focusMode ? '📖 Close Focus Mode' : '🔍 Full-Width Focus Mode'}
              </button>
            </div>

            {doc.tags && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {doc.tags.split(',').map((tag, i) => (
                  <span
                    key={i}
                    style={{ fontSize: '10px', background: 'var(--bg-dark-panel, #171c26)', border: '1px solid var(--border-dark-subtle, #2C3241)', color: 'var(--text-dark-muted, #8F9CAE)', padding: '3px 9px', borderRadius: '12px' }}
                  >
                    🏷️ {tag.trim()}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
