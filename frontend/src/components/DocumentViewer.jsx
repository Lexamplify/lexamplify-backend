import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { fetchDocumentDetails } from '../services/api';
import { renderMarkdown, MARKDOWN_CSS } from '../utils/markdownUtils';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';

const DV_STYLES = `
  @keyframes dv-spin {
    0%   { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  @keyframes doc-ai-reading {
    0%   { box-shadow: 0 0 0 0px rgba(59,130,246,0); }
    20%  { box-shadow: 0 0 0 3px rgba(59,130,246,0.22), inset 0 0 40px rgba(59,130,246,0.03); }
    80%  { box-shadow: 0 0 0 3px rgba(59,130,246,0.22), inset 0 0 40px rgba(59,130,246,0.03); }
    100% { box-shadow: 0 0 0 0px rgba(59,130,246,0); }
  }
  .doc-ai-scanning {
    animation: doc-ai-reading 1.5s ease-in-out forwards;
  }

  /* ── AI Chat Panel ─────────────────────────────── */
  .dv-ai-panel {
    flex-shrink: 0;
    background: #0d1117;
    border-left: 1px solid rgba(59,130,246,0.18);
    display: flex;
    flex-direction: column;
    overflow: hidden;
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
  const docRef   = useRef(null); // always-current doc for async closures

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
      <div style={{ padding: '40px', color: 'var(--text-dark-muted)', fontStyle: 'italic', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <style>{`@keyframes dv-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        <div style={{ display: 'inline-block', width: '24px', height: '24px', border: '2.5px solid rgba(255,255,255,0.2)', borderRadius: '50%', borderTopColor: 'var(--accent-primary)', animation: 'dv-spin 0.8s linear infinite' }} />
        Reconstructing case document from vectorized semantic chunks...
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
    <div className="document-view-layout" style={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      <style>{DV_STYLES}</style>
      <style>{MARKDOWN_CSS}</style>

      {/* ── LEFT PANEL: Actions ───────────────────────────────────── */}
      <div
        className="analysis-panel"
        style={{
          width: '280px',
          flexShrink: 0,
          backgroundColor: 'var(--bg-dark-app)',
          borderRight: '1px solid var(--border-dark-subtle)',
          padding: '24px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        <div>
          <Link to={backTo} style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontSize: '13px' }}>
            ← {backLabel}
          </Link>
          <h2 style={{ fontSize: '20px', marginTop: '12px', color: 'white' }}>RAG Ingestion</h2>
          <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)' }}>Indexed Database ID: #{doc.id}</span>
        </div>

        <div style={{ background: 'var(--bg-dark-panel)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-dark-subtle)' }}>
          <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-dark-muted)', marginBottom: '8px', letterSpacing: '0.5px' }}>
            AI Executive Summary
          </h4>
          <p style={{ fontSize: '13px', lineHeight: '1.5', color: 'var(--text-dark-primary)', margin: 0 }}>
            {doc.summary || 'No summary generated.'}
          </p>
        </div>

        {/* Inline AI Panel Trigger */}
        <div>
          <button
            onClick={() => triggerAiPanel()}
            disabled={isAnalyzing || showAiPanel}
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
              cursor: isAnalyzing || showAiPanel ? 'default' : 'pointer',
              background: showAiPanel
                ? 'rgba(16,185,129,0.12)'
                : isAnalyzing
                  ? 'rgba(59,130,246,0.3)'
                  : 'var(--accent-primary, #3B82F6)',
              color: showAiPanel ? '#6EE7B7' : 'white',
              boxShadow: showAiPanel ? 'none' : '0 4px 6px rgba(59,130,246,0.15)',
              transition: 'all 0.2s',
            }}
          >
            {isAnalyzing
              ? '🤖 Analyzing document…'
              : showAiPanel
                ? '✓ AI Panel Active'
                : '💬 Ask AI about this Doc'}
          </button>
          <div style={{ fontSize: '10px', color: 'var(--text-dark-muted)', textAlign: 'center', marginTop: '6px' }}>
            {showAiPanel ? 'Chat panel open on the right' : 'Opens inline AI chat panel'}
          </div>
        </div>

        <div style={{ background: 'var(--bg-dark-panel)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-dark-subtle)' }}>
          <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-dark-muted)', marginBottom: '8px', letterSpacing: '0.5px' }}>
            Viewport Settings
          </h4>
          <button
            type="button"
            onClick={() => setFocusMode(!focusMode)}
            style={{
              width: '100%',
              padding: '8px',
              background: focusMode ? 'var(--accent-primary)' : 'var(--bg-dark-app)',
              color: 'white',
              border: '1px solid var(--border-dark-subtle)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500',
              transition: 'all 0.2s',
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
                style={{ fontSize: '10px', background: 'var(--bg-dark-panel)', border: '1px solid var(--border-dark-subtle)', color: 'var(--text-dark-muted)', padding: '2px 8px', borderRadius: '12px' }}
              >
                🏷️ {tag.trim()}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── CENTER + RIGHT: Document Reader + AI Panel ────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Document Paper */}
        <div
          className={`document-viewer-panel${isAnalyzing ? ' doc-ai-scanning' : ''}`}
          style={{
            flex: 1,
            backgroundColor: 'var(--bg-paper-viewer)',
            color: 'var(--text-paper-primary)',
            padding: '40px 60px',
            overflowY: 'auto',
            fontFamily: 'var(--font-serif)',
            lineHeight: '1.8',
            fontSize: '15px',
          }}
        >
          <div style={{ borderBottom: '1px solid var(--border-paper-subtle)', paddingBottom: '16px', marginBottom: '24px' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-paper-secondary)', fontWeight: '600' }}>
              OFFICIAL VAULT COPY
            </span>
            <h1 style={{ fontSize: '26px', marginTop: '4px', color: 'var(--text-paper-primary)', fontFamily: 'var(--font-serif)', fontWeight: '700', lineHeight: '1.3' }}>
              {doc.filename}
            </h1>
          </div>

          {doc.text ? (
            <div
              className="md-body"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.text) }}
              style={{ color: 'var(--text-paper-primary)' }}
            />
          ) : (
            <div style={{ fontStyle: 'italic', color: 'var(--text-paper-secondary)' }}>
              No text chunks found for this document. Try re-uploading the file.
            </div>
          )}
        </div>

        {/* AI Chat Panel */}
        <div
          className="dv-ai-panel"
          style={{
            width: showAiPanel ? '380px' : '0',
            opacity: showAiPanel ? 1 : 0,
            transition: 'width 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
            pointerEvents: showAiPanel ? 'auto' : 'none',
          }}
        >
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
            {aiLoading && (
              <div className="dv-ai-bubble typing">Analyzing document…</div>
            )}
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

      </div>
    </div>
  );
}
