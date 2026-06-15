import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
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
`;

export default function DocumentViewer({ focusMode, setFocusMode }) {
  const { caseId, docId } = useParams();
  const location = useLocation();
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

  useEffect(() => { docRef.current = doc; }, [doc]);

  useEffect(() => {
    aiEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages]);

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
    return (
      <div style={{ padding: '40px', color: 'var(--accent-danger)' }}>
        <h3>⚠️ Load Failed</h3>
        <p style={{ marginTop: '8px', color: 'var(--text-dark-muted)' }}>{error || 'Unable to locate document records.'}</p>
        <Link to={backTo} style={{ display: 'inline-block', marginTop: '16px', color: 'var(--accent-primary)', textDecoration: 'none' }}>
          ← {backLabel}
        </Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden', fontFamily: 'var(--font-sans)' }}>
      <style>{DV_STYLES}</style>
      <style>{MARKDOWN_CSS}</style>

      {/* ── LEFT: Document Reader (flex: 1, never resizes) ─── */}
      <div
        className={`document-viewer-panel${isAnalyzing ? ' anim-doc-pulse' : ''}`}
        style={{
          flex: 1,
          backgroundColor: 'var(--bg-paper-viewer, #FAFAF8)',
          color: '#1E293B',
          padding: '40px 60px',
          overflowY: 'auto',
          fontFamily: 'var(--font-serif, Georgia, serif)',
          lineHeight: '1.8',
          fontSize: '15px',
        }}
      >
        <div style={{ borderBottom: '1px solid var(--border-paper-subtle, #E2E8F0)', paddingBottom: '16px', marginBottom: '28px' }}>
          <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1.2px', color: '#64748B', fontWeight: '700' }}>
            OFFICIAL VAULT COPY
          </span>
          <h1 style={{ fontSize: '26px', marginTop: '6px', color: '#0F172A', fontFamily: 'var(--font-serif, Georgia, serif)', fontWeight: '700', lineHeight: '1.3' }}>
            {doc.filename}
          </h1>
        </div>

        {/* Task 1: vault-doc-theme wrapper forces dark text on light background */}
        {doc.text ? (
          <div
            className="vault-doc-theme md-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.text) }}
          />
        ) : (
          <div style={{ fontStyle: 'italic', color: '#64748B' }}>
            No text chunks found for this document. Try re-uploading the file.
          </div>
        )}
      </div>

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
              <Link to={backTo} style={{ color: 'var(--accent-primary, #3B82F6)', textDecoration: 'none', fontSize: '13px' }}>
                ← {backLabel}
              </Link>
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
