import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useInzIQ } from '../context/InzIQContext';
import { WS } from '../hooks/useWakeWord';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';

export default function InzIQView() {
  const { wakeState, currentDictation } = useInzIQ();
  const location  = useLocation();
  const navigate  = useNavigate();

  const [messages,   setMessages]   = useState([]);
  const [query,      setQuery]      = useState('');
  const [aiLoading,  setAiLoading]  = useState(false);

  const inputRef      = useRef(null);
  const messagesEndRef = useRef(null);
  const handleSendRef  = useRef(null);

  // ── Auto-scroll ────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, aiLoading]);

  // ── Consume route state from voice trigger ─────────────────────────────
  useEffect(() => {
    const { query: q = '', autoSubmit = false } = (location.state || {});
    if (q) {
      setQuery(q);
      if (autoSubmit) setTimeout(() => handleSendRef.current?.(null, q), 250);
    }
    // Wipe route state so back-navigation doesn't re-trigger
    window.history.replaceState({}, '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mirror live dictation from voice hook ──────────────────────────────
  useEffect(() => {
    if (wakeState === WS.DICTATING && currentDictation) {
      setQuery(currentDictation);
    }
  }, [currentDictation, wakeState]);

  // ── AI send ────────────────────────────────────────────────────────────
  const handleSend = useCallback(async (e, directQuery = null) => {
    if (e) e.preventDefault();
    const q = (directQuery ?? query).trim();
    if (!q || aiLoading) return;

    setMessages(prev => [...prev, { id: `u_${Date.now()}`, role: 'user', text: q }]);
    setQuery('');
    setAiLoading(true);

    try {
      const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
      const res = await fetch(`${API_BASE}/api/ai/rag-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ query: q, currentPath: '/agent' }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text = data.response || data.answer || data.result || 'No response received.';
      setMessages(prev => [...prev, { id: `a_${Date.now()}`, role: 'assistant', text }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: `e_${Date.now()}`, role: 'error',
        text: `Unable to reach InzIQ. Check connection and try again.`,
      }]);
    } finally {
      setAiLoading(false);
    }
  }, [query, aiLoading]);

  // Keep ref fresh
  useEffect(() => { handleSendRef.current = handleSend; }, [handleSend]);

  // ── Orb state ─────────────────────────────────────────────────────────
  const orbState = aiLoading             ? 'processing' :
                   wakeState === WS.DICTATING  ? 'dictating'  :
                   wakeState !== WS.IDLE       ? 'passive'    : 'idle';

  // ── Status label ──────────────────────────────────────────────────────
  const statusLabel =
    aiLoading                       ? null :   // dots rendered separately
    wakeState === WS.DICTATING      ? 'Listening…' :
    wakeState === WS.TRIGGERED      ? 'InzIQ!' :
    wakeState !== WS.IDLE           ? 'Say "Hey InzIQ" to speak' :
    messages.length === 0           ? 'Your AI Junior Counsel' : '';

  return (
    <div className="inziq-page">
      {/* Atmospheric backdrop glow (color shifts per orb state) */}
      <div className={`inziq-page-backdrop inziq-backdrop-${orbState}`} aria-hidden="true" />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="inziq-header">
        <button
          onClick={() => navigate(-1)}
          className="inziq-back-btn"
          aria-label="Go back"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          Back
        </button>
        <div className="inziq-header-brand">
          <span className="inziq-header-name">InzIQ</span>
          <span className="inziq-header-sub">Always-On Legal AI</span>
        </div>
        <div className={`inziq-header-status inziq-hs-${orbState}`}>
          {orbState === 'passive'    && <><span className="inziq-hs-dot" />Listening</>}
          {orbState === 'dictating'  && <><span className="inziq-hs-dot inziq-hs-dot-hot" />Hot Mic</>}
          {orbState === 'processing' && <><span className="inziq-hs-dot inziq-hs-dot-proc" />Processing</>}
        </div>
      </header>

      {/* ── Orb Stage (fixed, always above conversations) ───────────────── */}
      <div className="inziq-orb-stage">
        <div className={`inziq-orb inziq-orb-${orbState}`}>
          {/* Outer ambient ring — spins during active states */}
          <div className="inziq-orb-ring" />
          {/* Second ring — offset spin for depth */}
          <div className="inziq-orb-ring-2" />
          {/* The core glowing sphere */}
          <div className="inziq-orb-core" />
          {/* Inner specular highlight */}
          <div className="inziq-orb-specular" />
        </div>

        {/* Status / live transcript below orb */}
        <div className="inziq-orb-label">
          {aiLoading ? (
            <span className="inziq-thinking-dots">
              <span />
              <span />
              <span />
            </span>
          ) : (
            <span className={orbState === 'dictating' ? 'inziq-label-hot' : ''}>
              {statusLabel}
            </span>
          )}
        </div>

        {/* Live dictation transcript bubble */}
        {wakeState === WS.DICTATING && currentDictation && (
          <div className="inziq-dictation-bubble">
            {currentDictation}
          </div>
        )}
      </div>

      {/* ── Conversation history (scrollable) ───────────────────────────── */}
      <div className="inziq-messages">
        {messages.length === 0 && !aiLoading && (
          <div className="inziq-empty-state">
            <p>Ask anything. Draft documents, research case law, navigate the platform.</p>
            <div className="inziq-example-queries">
              {[
                'Draft a mutual non-disclosure agreement',
                'What are the limitation periods under the IPC?',
                'Summarize the Supreme Court bail guidelines',
              ].map((ex, i) => (
                <button
                  key={i}
                  className="inziq-example-btn"
                  onClick={() => { setQuery(ex); inputRef.current?.focus(); }}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(m => (
          <div key={m.id} className={`inziq-msg inziq-msg-${m.role}`}>
            <div className="inziq-msg-bubble">
              {m.text}
            </div>
          </div>
        ))}

        {aiLoading && (
          <div className="inziq-msg inziq-msg-assistant">
            <div className="inziq-msg-bubble inziq-msg-thinking">
              <span className="inziq-thinking-dots">
                <span /><span /><span />
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input bar (fixed bottom) ─────────────────────────────────────── */}
      <div className="inziq-input-area">
        <form onSubmit={handleSend} className="inziq-input-form">
          <textarea
            ref={inputRef}
            rows={1}
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(null); }
            }}
            placeholder={
              wakeState === WS.DICTATING ? '🎤 Listening — speak your command…' :
              'Command InzIQ… (Shift+Enter for new line)'
            }
            className="inziq-textarea"
            disabled={aiLoading}
          />
          <button
            type="submit"
            disabled={!query.trim() || aiLoading}
            className={`inziq-send-btn ${query.trim() && !aiLoading ? 'inziq-send-active' : ''}`}
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M22 2L11 13M22 2L15 22 11 13 2 9 22 2z" />
            </svg>
          </button>
        </form>
        <p className="inziq-disclaimer">
          InzIQ can make mistakes. Always verify critical legal information independently.
        </p>
      </div>
    </div>
  );
}
