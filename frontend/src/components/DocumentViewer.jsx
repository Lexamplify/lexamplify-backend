import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchDocumentDetails } from '../services/api';

export default function DocumentViewer({ focusMode, setFocusMode }) {
  const { caseId, docId } = useParams();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── 1. FETCH DOCUMENT & CHUNKED TEXT ────────────────────────────────
  useEffect(() => {
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
  }, [docId]);

  // ── 2. TRIGGER DECOUPLED RAG CHAT PALETTE ───────────────────────────
  const handleOpenRAG = () => {
    window.dispatchEvent(new Event('toggle-rag-palette'));
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', color: 'var(--text-dark-muted)', fontStyle: 'italic', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ display: 'inline-block', width: '24px', height: '24px', border: '2.5px solid rgba(255, 255, 255, 0.2)', borderRadius: '50%', borderTopColor: 'var(--accent-primary)', animation: 'spin 0.8s linear infinite' }}></div>
        Reconstructing case document from vectorized semantic chunks...
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div style={{ padding: '40px', color: 'var(--accent-danger)' }}>
        <h3>⚠️ Load Failed</h3>
        <p style={{ marginTop: '8px', color: 'var(--text-dark-muted)' }}>{error || 'Unable to locate document records.'}</p>
        <Link to={`/case/${caseId}`} style={{ display: 'inline-block', marginTop: '16px', color: 'var(--accent-primary)', textDecoration: 'none' }}>
          ← Return to Case Vault
        </Link>
      </div>
    );
  }

  return (
    <div className="document-view-layout" style={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      
      {/* ── LEFT PANEL: AI COGNITIVE ACTIONS (DARK MODE) ────────────────── */}
      <div 
        className="analysis-panel" 
        style={{ 
          width: '320px', 
          backgroundColor: 'var(--bg-dark-app)', 
          borderRight: '1px solid var(--border-dark-subtle)', 
          padding: '24px', 
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}
      >
        <div>
          <Link to={`/case/${caseId}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontSize: '13px' }}>
            ← Back to Case Directory
          </Link>
          <h2 style={{ fontSize: '20px', marginTop: '12px', color: 'white' }}>RAG Ingestion</h2>
          <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)' }}>Indexed Database ID: #{doc.id}</span>
        </div>

        {/* AI summary */}
        <div style={{ background: 'var(--bg-dark-panel)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-dark-subtle)' }}>
          <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-dark-muted)', marginBottom: '8px', letterSpacing: '0.5px' }}>
            AI Executive Summary
          </h4>
          <p style={{ fontSize: '13px', lineHeight: '1.5', color: 'var(--text-dark-primary)', margin: 0 }}>
            {doc.summary || 'No summary generated.'}
          </p>
        </div>

        {/* Ask RAG Button */}
        <div>
          <button 
            className="btn-accent" 
            onClick={handleOpenRAG}
            style={{ 
              width: '100%', 
              padding: '12px', 
              fontSize: '13px', 
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 6px rgba(59, 130, 246, 0.15)'
            }}
          >
            💬 Ask AI about this Doc
          </button>
          <div style={{ fontSize: '10px', color: 'var(--text-dark-muted)', textAlign: 'center', marginTop: '6px' }}>
            Opens Command Palette (shortcut: Ctrl+K)
          </div>
        </div>

        {/* Aesthetic Controls */}
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
              transition: 'all 0.2s'
            }}
          >
            {focusMode ? "📖 Close Focus Mode" : "🔍 Full-Width Focus Mode"}
          </button>
        </div>

        {/* Case Tags */}
        {doc.tags && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {doc.tags.split(',').map((tag, i) => (
              <span key={i} style={{ fontSize: '10px', background: 'var(--bg-dark-panel)', border: '1px solid var(--border-dark-subtle)', color: 'var(--text-dark-muted)', padding: '2px 8px', borderRadius: '12px' }}>
                🏷️ {tag.trim()}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL: FATIGUE-FREE READER PANEL (PAPER STYLE) ────────── */}
      <div 
        className="document-viewer-panel" 
        style={{ 
          flex: 1, 
          backgroundColor: 'var(--bg-paper-viewer)', 
          color: 'var(--text-paper-primary)', 
          padding: '40px 60px', 
          overflowY: 'auto', 
          fontFamily: 'var(--font-serif)', 
          lineHeight: '1.8', 
          fontSize: '15px' 
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

        {/* Reconstructed raw text output */}
        <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-paper-primary)' }}>
          {doc.text || (
            <div style={{ fontStyle: 'italic', color: 'var(--text-paper-secondary)' }}>
              No text chunks found for this document. Try re-uploading the file.
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
