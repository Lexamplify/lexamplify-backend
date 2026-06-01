import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { sendUniversalChat } from '../services/api';

const pulseStyle = `
  @keyframes pulse-shimmer {
    0% { opacity: 0.5; }
    50% { opacity: 1; }
    100% { opacity: 0.5; }
  }
  @keyframes mic-pulse-anim {
    0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
    70% { transform: scale(1.05); box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
    100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
  }
  .palette-shimmer {
    animation: pulse-shimmer 1.5s infinite ease-in-out;
  }
  .mic-button-listening {
    animation: mic-pulse-anim 1.5s infinite ease-in-out;
    background-color: rgba(239, 68, 68, 0.15) !important;
    color: #EF4444 !important;
    border-color: #EF4444 !important;
  }
  .palette-scroll::-webkit-scrollbar {
    width: 6px;
  }
  .palette-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .palette-scroll::-webkit-scrollbar-thumb {
    background: #2C3241;
    border-radius: 4px;
  }
  .palette-scroll::-webkit-scrollbar-thumb:hover {
    background: #3B82F6;
  }
  .palette-input:focus {
    box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.2);
  }
`;

export default function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [navigatingRoute, setNavigatingRoute] = useState(null);
  // Message history: { role: 'user' | 'assistant' | 'error', text: string, sources?: array }
  const [messages, setMessages] = useState([]);
  const [pendingSchedule, setPendingSchedule] = useState(null);
  const [pendingDraft, setPendingDraft] = useState(null);

  const [isListening, setIsListening] = useState(false);
  const [micError, setMicError] = useState(null);

  const location = useLocation();
  const paramsFromHook = useParams();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const handleSearchRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Extract params from pathname if useParams is empty due to rendering outside <Routes>
  const matchDoc = location.pathname.match(/\/case\/([^/]+)\/doc\/([^/]+)/);
  const matchCase = location.pathname.match(/\/case\/([^/]+)/);

  const extractedParams = {};
  if (matchDoc) {
    extractedParams.caseId = matchDoc[1];
    extractedParams.docId = matchDoc[2];
  } else if (matchCase) {
    extractedParams.caseId = matchCase[1];
  }

  const params = {
    ...paramsFromHook,
    ...extractedParams
  };

  // ── 1. KEYBOARD SHORTCUT & SCOPE AUTO-ALIGNMENT ─────────────────────────
  useEffect(() => {
    const handleToggle = () => {
      setIsOpen((prev) => !prev);
    };

    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handleToggle();
      }
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('toggle-rag-palette', handleToggle);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('toggle-rag-palette', handleToggle);
    };
  }, []);

  // Autofocus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => {
        inputRef.current.focus();
      }, 50);
    }
  }, [isOpen]);

  // Update handleSearchRef on every render to prevent stale closure in events
  useEffect(() => {
    handleSearchRef.current = handleSearch;
  });

  // Auto-scroll to bottom whenever messages or status change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, navigatingRoute, pendingSchedule, pendingDraft]);

  // Speech Recognition initialization
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = true;

      rec.onstart = () => {
        setIsListening(true);
        setMicError(null);
      };

      rec.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcriptText = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcriptText;
          } else {
            interimTranscript += transcriptText;
          }
        }

        const currentTranscript = finalTranscript || interimTranscript;
        if (currentTranscript) {
          setQuery(currentTranscript);
        }

        if (finalTranscript) {
          rec.stop();
          if (handleSearchRef.current) {
            handleSearchRef.current(null, finalTranscript);
          }
        }
      };

      rec.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          setMicError('Mic access denied');
        } else {
          setMicError(`Error: ${event.error}`);
        }
        setIsListening(false);
        setTimeout(() => setMicError(null), 3000);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = rec;
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Web Speech API is not supported in this browser.');
      return;
    }

    if (isListening) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.error(err);
      }
    } else {
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.error(err);
      }
    }
  };

  // ── 2. HANDLERS ────────────────────────────────────────────────────────
  const handleSearch = async (e, directQuery = null) => {
    if (e) e.preventDefault();
    const activeQuery = (directQuery !== null ? directQuery : query).trim();
    if (!activeQuery || loading || navigatingRoute) return;

    // Append user turn to history immediately
    setMessages(prev => [...prev, { role: 'user', text: activeQuery }]);
    setLoading(true);
    setPendingSchedule(null);
    setPendingDraft(null);

    const payload = {
      query: activeQuery,
      currentPath: location.pathname,
      params,
    };

    // Track whether to restore focus (error path only)
    let shouldRefocus = false;

    try {
      const response = await sendUniversalChat(payload);

      if (response.error) {
        const errorMsg = response.message || 'A server communication error occurred.';
        setMessages(prev => [...prev, { role: 'error', text: errorMsg }]);
        shouldRefocus = true;
        return;
      }

      // Append assistant turn — answer or message text
      const answerText = response.answer || response.message || '';
      if (answerText) {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', text: answerText, sources: response.sources || [] },
        ]);
      }

      if (response.action === 'confirm_schedule' && response.proposed_events) {
        setPendingSchedule(response.proposed_events);
      }
      if (response.action === 'review_document' && response.draft) {
        setPendingDraft(response.draft);
      }
      if (response.action === 'simulate_courtroom' && response.simulationData) {
        setNavigatingRoute('/war-room');
        setTimeout(() => {
          navigate('/war-room', { state: { simulationData: response.simulationData } });
          handleClose();
          setNavigatingRoute(null);
        }, 1200);
      }
      if (response.action === 'analyze' || (response.action === 'navigate' && response.target_route)) {
        const targetRoute = response.action === 'analyze' ? '/analyzer' : response.target_route;
        setNavigatingRoute(targetRoute);
        setTimeout(() => {
          if (targetRoute === '/analyzer' || targetRoute === '/contract-analyzer') {
            navigate(targetRoute, { state: { contractData: response } });
          } else {
            navigate(targetRoute);
          }
          handleClose();
          setNavigatingRoute(null);
        }, 1200);
      }
    } finally {
      setLoading(false);
      // Restore focus after React re-paints with input re-enabled
      if (shouldRefocus) {
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    }
  };

  const handleApproveSchedule = async () => {
    if (!pendingSchedule) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('https://lexamplify-backend.onrender.com/api/calendar/save', {
        method: 'POST',
        headers,
        body: JSON.stringify({ events: pendingSchedule }),
      });

      setPendingSchedule(null);
      if (response.ok) {
        setMessages(prev => [...prev, { role: 'assistant', text: 'Schedule approved and saved to the database.' }]);
      } else {
        setMessages(prev => [...prev, { role: 'error', text: 'Failed to save the schedule. Please try again.' }]);
      }
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'error', text: 'Failed to save the schedule. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveDraft = async () => {
    if (!pendingDraft) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('https://lexamplify-backend.onrender.com/api/vault/save', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          case_id: pendingDraft.case_id,
          title: pendingDraft.title,
          doc_type: pendingDraft.doc_type || '',
          content: pendingDraft.content,
        }),
      });

      setPendingDraft(null);
      if (response.ok) {
        setMessages(prev => [...prev, { role: 'assistant', text: 'Document approved and saved to Case Vault.' }]);
      } else {
        setMessages(prev => [...prev, { role: 'error', text: 'Failed to save to Case Vault. Please try again.' }]);
      }
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'error', text: 'Failed to save to Case Vault. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (recognitionRef.current && isListening) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.error(err);
      }
    }
    setIsOpen(false);
    setQuery('');
    setMessages([]);
    setNavigatingRoute(null);
    setPendingSchedule(null);
    setPendingDraft(null);
  };

  if (!isOpen) return null;

  const isLocked = loading || !!navigatingRoute;

  return (
    <>
      <style>{pulseStyle}</style>
      <div
        className="command-palette-overlay"
        onClick={handleClose}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(5, 5, 8, 0.85)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: '80px',
          zIndex: 9999,
        }}
      >
        <div
          className="command-palette-card"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '640px',
            backgroundColor: 'var(--bg-dark-panel)',
            border: '1px solid var(--border-dark-subtle)',
            borderRadius: '12px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border-dark-subtle)' }}>
            <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Universal Agent Console
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-dark-muted)', background: 'var(--bg-dark-app)', padding: '2px 6px', borderRadius: '4px' }}>
              ESC to Close
            </span>
          </div>

          {/* Search Form */}
          <form onSubmit={handleSearch} style={{ display: 'flex', borderBottom: '1px solid var(--border-dark-subtle)' }}>
            <input
              ref={inputRef}
              type="text"
              className="palette-input"
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                padding: '16px 20px',
                fontSize: '15px',
                color: isLocked ? 'var(--text-dark-muted)' : 'var(--text-dark-primary)',
                outline: 'none',
                cursor: isLocked ? 'not-allowed' : 'text',
              }}
              placeholder="Ask case details or give commands (e.g. 'go to court resources')..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={isLocked}
            />
            {/* Microphone button */}
            <button
              type="button"
              onClick={toggleListening}
              className={`mic-button ${isListening ? 'mic-button-listening' : ''}`}
              style={{
                background: 'transparent',
                border: 'none',
                borderLeft: '1px solid var(--border-dark-subtle)',
                padding: '0 16px',
                cursor: 'pointer',
                color: isListening ? '#EF4444' : 'var(--text-dark-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease-in-out',
                position: 'relative'
              }}
              title={isListening ? "Listening... Click to stop" : "Speak command"}
              disabled={isLocked && !isListening}
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
              </svg>
              {micError && (
                <div style={{
                  position: 'absolute',
                  bottom: '100%',
                  right: 0,
                  transform: 'translateY(-8px)',
                  backgroundColor: '#EF4444',
                  color: 'white',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                  zIndex: 10
                }}>
                  ⚠️ {micError}
                </div>
              )}
            </button>
            <button
              type="submit"
              className="btn-accent"
              style={{
                borderRadius: 0,
                borderLeft: '1px solid var(--border-dark-subtle)',
                padding: '0 24px',
                opacity: isLocked ? 0.6 : 1,
                cursor: isLocked ? 'not-allowed' : 'pointer',
                transition: 'opacity 0.2s',
              }}
              disabled={isLocked}
            >
              Execute
            </button>
          </form>

          {/* Context Indicators Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 20px', background: 'var(--bg-dark-sidebar)', borderBottom: '1px solid var(--border-dark-subtle)', fontSize: '11px' }}>
            <span style={{ color: 'var(--text-dark-muted)' }}>Active Location:</span>
            <span style={{ color: 'white', fontFamily: 'monospace', background: 'rgba(255, 255, 255, 0.05)', padding: '2px 6px', borderRadius: '4px' }}>
              {location.pathname}
            </span>
            {Object.keys(params).length > 0 && (
              <>
                <span style={{ color: 'var(--text-dark-muted)' }}>|</span>
                <span style={{ color: 'var(--text-dark-muted)' }}>Context:</span>
                <span style={{ color: 'var(--accent-primary)', fontFamily: 'monospace' }}>
                  {JSON.stringify(params)}
                </span>
              </>
            )}
          </div>

          {/* ── Results / Message History Panel ───────────────────────────── */}
          <div
            className="palette-scroll"
            style={{
              maxHeight: '380px',
              overflowY: 'auto',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            {/* Empty state */}
            {messages.length === 0 && !loading && !navigatingRoute && (
              <div style={{ color: 'var(--text-dark-muted)', fontSize: '12px', textAlign: 'center', padding: '10px 0' }}>
                Begin your agent command session by typing a query or navigation command above.
              </div>
            )}

            {/* Message history */}
            {messages.map((msg, i) => {
              if (msg.role === 'user') {
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div style={{
                      background: 'rgba(59, 130, 246, 0.1)',
                      border: '1px solid rgba(59, 130, 246, 0.22)',
                      borderRadius: '10px 10px 2px 10px',
                      padding: '10px 14px',
                      fontSize: '13.5px',
                      color: 'var(--text-dark-primary)',
                      maxWidth: '88%',
                      lineHeight: '1.5',
                    }}>
                      {msg.text}
                    </div>
                  </div>
                );
              }

              if (msg.role === 'error') {
                return (
                  <div key={i} style={{
                    background: 'rgba(239, 68, 68, 0.07)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    borderLeft: '3px solid var(--accent-danger)',
                    borderRadius: '4px 8px 8px 4px',
                    padding: '10px 14px',
                  }}>
                    <div style={{ fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--accent-danger)', marginBottom: '4px' }}>
                      Command Breakdown
                    </div>
                    <div style={{ fontSize: '13px', color: '#FCA5A5', lineHeight: '1.5' }}>
                      {msg.text}
                    </div>
                  </div>
                );
              }

              // assistant
              return (
                <div key={i}>
                  <div style={{
                    background: 'var(--bg-dark-app)',
                    border: '1px solid var(--border-dark-subtle)',
                    borderRadius: '8px',
                    padding: '14px 16px',
                  }}>
                    <div style={{ fontSize: '10.5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--accent-primary)', marginBottom: '8px' }}>
                      Agent Response
                    </div>
                    <div style={{ fontSize: '13.5px', lineHeight: '1.65', color: 'var(--text-dark-primary)', fontFamily: 'var(--font-sans)', whiteSpace: 'pre-wrap' }}>
                      {msg.text}
                    </div>
                    {/* RAG sources */}
                    {msg.sources && msg.sources.length > 0 && (
                      <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border-dark-subtle)' }}>
                        <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-dark-muted)', marginBottom: '6px', letterSpacing: '0.5px' }}>
                          Referenced Sources
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {msg.sources.map((src, si) => (
                            <div
                              key={si}
                              style={{
                                background: 'rgba(255,255,255,0.04)',
                                border: '1px solid var(--border-dark-subtle)',
                                padding: '4px 10px',
                                borderRadius: '20px',
                                fontSize: '11px',
                                color: 'var(--text-dark-primary)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '5px',
                              }}
                            >
                              <span style={{ color: 'var(--accent-primary)' }}>Doc #{src.document_id}</span>
                              <span style={{ color: 'var(--text-dark-muted)' }}>|</span>
                              <span>Chunk {src.chunk_index}</span>
                              <span style={{ color: 'var(--text-dark-muted)' }}>|</span>
                              <span style={{ color: 'var(--accent-success)' }}>{Math.round(src.similarity * 100)}% match</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* ── Pending Schedule Approval ──────────────────────────────── */}
            {pendingSchedule && pendingSchedule.length > 0 && (
              <div style={{
                padding: '16px',
                backgroundColor: 'var(--bg-dark-sidebar, #171c26)',
                border: '1px solid var(--border-dark-subtle, #2C3241)',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border-dark-subtle, #2C3241)', paddingBottom: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--accent-primary, #3B82F6)' }}>📅 Review & Approve Proposed Schedule</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {pendingSchedule.map((event, idx) => {
                    let typeColor = 'var(--text-dark-muted, #8F9CAE)';
                    let typeBorder = 'rgba(255, 255, 255, 0.1)';
                    let typeIcon = '📋';

                    if (event.event_type === 'drop_dead') {
                      typeColor = '#EF4444';
                      typeBorder = 'rgba(239, 68, 68, 0.2)';
                      typeIcon = '🚨';
                    } else if (event.event_type === 'tickler') {
                      typeColor = '#F59E0B';
                      typeBorder = 'rgba(245, 158, 11, 0.2)';
                      typeIcon = '⏰';
                    } else if (event.event_type === 'appearance') {
                      typeColor = '#10B981';
                      typeBorder = 'rgba(16, 185, 129, 0.2)';
                      typeIcon = '⚖️';
                    } else if (event.event_type === 'task') {
                      typeColor = '#3B82F6';
                      typeBorder = 'rgba(59, 130, 246, 0.2)';
                      typeIcon = '✅';
                    }

                    return (
                      <div
                        key={idx}
                        style={{
                          padding: '10px 12px',
                          backgroundColor: 'rgba(255, 255, 255, 0.02)',
                          borderLeft: `3px solid ${typeColor}`,
                          border: `1px solid ${typeBorder}`,
                          borderLeftWidth: '3px',
                          borderRadius: '4px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                          <span style={{ fontWeight: '600', color: 'var(--text-dark-primary, #FFFFFF)' }}>{event.title}</span>
                          <span style={{ fontSize: '11px', color: 'var(--text-dark-muted, #8F9CAE)' }}>{event.event_date}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                          <span>{typeIcon}</span>
                          <span style={{ color: typeColor, fontWeight: '500', textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.5px' }}>
                            {event.event_type.replace('_', ' ')}
                          </span>
                          {event.related_case_id && (
                            <>
                              <span style={{ color: 'var(--text-dark-muted, #8F9CAE)' }}>•</span>
                              <span style={{ color: 'var(--text-dark-muted, #8F9CAE)' }}>Case ID: {event.related_case_id}</span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '4px', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setPendingSchedule(null)}
                    style={{ padding: '8px 16px', fontSize: '12px', fontWeight: '500', color: 'var(--text-dark-primary, #FFFFFF)', background: 'transparent', border: '1px solid var(--border-dark-subtle, #2C3241)', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleApproveSchedule}
                    style={{ padding: '8px 16px', fontSize: '12px', fontWeight: '500', color: '#FFFFFF', background: 'var(--accent-primary, #3B82F6)', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    Approve & Save
                  </button>
                </div>
              </div>
            )}

            {/* ── Pending Document Draft Approval ────────────────────────── */}
            {pendingDraft && (
              <div style={{
                padding: '16px',
                backgroundColor: 'var(--bg-dark-sidebar, #171c26)',
                border: '1px solid var(--border-dark-subtle, #2C3241)',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-dark-subtle, #2C3241)', paddingBottom: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--accent-primary, #3B82F6)' }}>📄 Review drafted document</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-dark-muted, #8F9CAE)' }}>Case: {pendingDraft.case_id}</span>
                </div>
                <div style={{ fontSize: '13px', color: 'white', fontWeight: '600' }}>
                  Title: {pendingDraft.title} {pendingDraft.doc_type ? `(${pendingDraft.doc_type})` : ''}
                </div>
                <div
                  className="palette-scroll"
                  style={{
                    maxHeight: '200px',
                    overflowY: 'auto',
                    padding: '12px',
                    backgroundColor: 'var(--bg-dark-app, #0D1117)',
                    border: '1px solid var(--border-dark-subtle, #2C3241)',
                    borderRadius: '6px',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    lineHeight: '1.5',
                    color: '#E6EDF0',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {pendingDraft.content}
                </div>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
                  <button
                    type="button"
                    onClick={() => setPendingDraft(null)}
                    style={{ padding: '8px 16px', fontSize: '12px', fontWeight: '500', color: 'var(--text-dark-primary, #FFFFFF)', background: 'transparent', border: '1px solid var(--border-dark-subtle, #2C3241)', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={handleApproveDraft}
                    style={{ padding: '8px 16px', fontSize: '12px', fontWeight: '500', color: '#FFFFFF', background: 'var(--accent-primary, #3B82F6)', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    Approve & Save to Vault
                  </button>
                </div>
              </div>
            )}

            {/* ── Loading shimmer ─────────────────────────────────────────── */}
            {loading && (
              <div className="palette-shimmer" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ color: 'var(--text-dark-muted)', fontSize: '13px', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ display: 'inline-block', width: '10px', height: '10px', background: 'var(--accent-warning)', borderRadius: '50%', animation: 'pulse-shimmer 1s infinite' }}></span>
                  Processing agent command...
                </div>
                <div style={{ height: '48px', background: 'var(--bg-dark-app)', borderRadius: '6px' }}></div>
              </div>
            )}

            {/* ── Navigation routing indicator ────────────────────────────── */}
            {navigatingRoute && (
              <div style={{ color: 'var(--accent-success)', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '12px', borderRadius: '6px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="palette-shimmer" style={{ display: 'inline-block', width: '8px', height: '8px', background: 'var(--accent-success)', borderRadius: '50%' }}></span>
                <strong>Agentic Routing:</strong> Redirecting client viewpoint to <code>{navigatingRoute}</code>...
              </div>
            )}

            {/* Scroll anchor */}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>
    </>
  );
}
