import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';

// ═══════════════════════════════════════════════════════
//  SESSION STORE  (localStorage-persisted)
// ═══════════════════════════════════════════════════════
const SESSIONS_KEY  = 'lexai_sessions_v2';
const CURRENT_KEY   = 'lexai_current_session_v2';
const MAX_SESSIONS  = 25;

const genId = () => `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

const loadSessions = () => {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); }
  catch { return []; }
};

const persistSessions = (sessions) => {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS))); }
  catch (_) {}
};

const makeSession = () => ({
  id: genId(),
  title: 'New conversation',
  messages: [],
  pendingSchedule: null,
  pendingDraft: null,
  activeDocument: null,   // persists after draft card is rejected/closed
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

// ═══════════════════════════════════════════════════════
//  NAVIGATION INTENT MAP  (client-side fast-path)
// ═══════════════════════════════════════════════════════
const NAV_MAP = [
  { kw: ['high court', 'highcourt', 'high courts'],               route: '/court-resources', tab: 'highcourt'  },
  { kw: ['district court', 'subordinate court', 'district courts'],route: '/court-resources', tab: 'district'   },
  { kw: ['supreme court'],                                         route: '/court-resources', tab: 'supreme'    },
  { kw: ['bare act', 'bare acts', 'ipc', 'crpc', 'laws'],         route: '/court-resources', tab: 'laws'       },
  { kw: ['legal event', 'legal events'],                           route: '/court-resources', tab: 'events'     },
  { kw: ['court fee', 'fee calculator', 'court fees'],             route: '/court-resources', tab: 'courtfee'  },
  { kw: ['e-notary', 'enotary', 'notary'],                         route: '/court-resources', tab: 'enotary'   },
  { kw: ['ip tracker', 'iptracker', 'trademark', 'patent'],        route: '/court-resources', tab: 'iptracker' },
  { kw: ['court resource', 'ecourt', 'e-court'],                   route: '/court-resources', tab: null        },
  { kw: ['calendar', 'hearing schedule', 'deadlines', 'schedule'], route: '/calendar',        tab: null        },
  { kw: ['vault', 'case vault', 'document vault'],                  route: '/vault',           tab: null        },
  { kw: ['contract analy', 'risk scan', 'analyzer'],               route: '/analyzer',        tab: null        },
  { kw: ['conflict engine', 'cross document', 'conflict check'],   route: '/conflict-engine', tab: null        },
  { kw: ['war room', 'courtroom simulation', 'virtual court'],      route: '/war-room',        tab: null        },
  { kw: ['dashboard', 'home', 'overview'],                         route: '/dashboard',       tab: null        },
];

const NAV_TRIGGERS = ['go to', 'open', 'navigate to', 'take me to', 'show me', 'switch to', 'open the'];

const resolveNavIntent = (q) => {
  const lower = q.toLowerCase();
  for (const item of NAV_MAP) {
    if (item.kw.some(k => lower.includes(k))) return { route: item.route, tab: item.tab };
  }
  return null;
};

const isNavCommand = (q) => NAV_TRIGGERS.some(t => q.toLowerCase().startsWith(t));

// ═══════════════════════════════════════════════════════
//  QUICK COMMANDS  (empty-state suggestions)
// ═══════════════════════════════════════════════════════
const QUICK_CMDS = [
  { icon: '🏛️', text: 'Go to High Courts section',                         category: 'Navigate'  },
  { icon: '📝', text: 'Draft a legal notice for breach of contract',        category: 'Draft'     },
  { icon: '🔒', text: 'Prepare a mutual NDA agreement',                     category: 'Draft'     },
  { icon: '📅', text: 'Show my hearings scheduled for this week',           category: 'Calendar'  },
  { icon: '⚡', text: 'Analyze the uploaded contract for high-risk clauses', category: 'Analysis' },
  { icon: '⚖️', text: 'Find similar Supreme Court judgments',               category: 'Research'  },
  { icon: '🔍', text: 'Research IPC sections related to this matter',       category: 'Research'  },
  { icon: '📋', text: 'Prepare a bail application based on case facts',     category: 'Draft'     },
];

// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════
const truncate = (str, n) => (str && str.length > n) ? str.slice(0, n) + '…' : (str || '');

const renderDraftHtml = (text) => {
  if (!text) return '';
  const escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return escaped
    // H1: **ALL CAPS HEADING** or # Heading at line start
    .replace(/^#{1,2}\s+(.+)$/gm, '<div class="draft-h1">$1</div>')
    .replace(/^###\s+(.+)$/gm, '<div class="draft-h2">$1</div>')
    // Bold → rendered strong
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Horizontal rule
    .replace(/^---+$/gm, '<hr class="draft-hr">')
    // Double newline → paragraph break
    .replace(/\n\n/g, '</p><p class="draft-p">')
    // Single newline → break
    .replace(/\n/g, '<br>')
    // Wrap
    .replace(/^/, '<p class="draft-p">')
    .replace(/$/, '</p>');
};

const relativeDate = (ts) => {
  const d = Date.now() - ts;
  if (d < 60000)     return 'Just now';
  if (d < 3600000)   return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000)  return `${Math.floor(d / 3600000)}h ago`;
  if (d < 172800000) return 'Yesterday';
  if (d < 604800000) return `${Math.floor(d / 86400000)}d ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

// ═══════════════════════════════════════════════════════
//  CSS  (injected once as <style>)
// ═══════════════════════════════════════════════════════
const AGENT_CSS = `
  @keyframes lex-pulse    { 0%,100%{opacity:.45} 50%{opacity:1} }
  @keyframes lex-mic-ring {
    0%   { transform:scale(1);    box-shadow:0 0 0 0   rgba(239,68,68,.45); }
    70%  { transform:scale(1.06); box-shadow:0 0 0 8px rgba(239,68,68,0);   }
    100% { transform:scale(1);    box-shadow:0 0 0 0   rgba(239,68,68,0);   }
  }
  @keyframes lex-in    { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:none} }
  @keyframes lex-navbar{ 0%{width:0} 100%{width:100%} }
  @keyframes lex-dot   { 0%,80%,100%{transform:scale(0)} 40%{transform:scale(1)} }

  .lex-shimmer   { animation: lex-pulse 1.5s infinite ease-in-out; }
  .lex-mic-live  { animation: lex-mic-ring 1.4s infinite!important; background:rgba(239,68,68,.12)!important; color:#ef4444!important; border-color:#ef4444!important; }
  .lex-msg-in    { animation: lex-in .2s ease; }
  .lex-nav-bar   { height:2px; background:linear-gradient(90deg,#3B82F6,#6366F1); animation:lex-navbar 1.1s ease forwards; border-radius:2px; }
  .lex-dot-1     { animation: lex-dot 1.2s infinite ease-in-out; animation-delay:0s;   }
  .lex-dot-2     { animation: lex-dot 1.2s infinite ease-in-out; animation-delay:.18s; }
  .lex-dot-3     { animation: lex-dot 1.2s infinite ease-in-out; animation-delay:.36s; }

  .lex-side-scroll::-webkit-scrollbar       { width:3px; }
  .lex-side-scroll::-webkit-scrollbar-track { background:transparent; }
  .lex-side-scroll::-webkit-scrollbar-thumb { background:#1A2030; border-radius:4px; }

  /* ── Draft Document renderer ── */
  .lex-draft-doc {
    background: var(--bg-dark-card);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 6px;
    padding: 32px 40px;
    font-family: Georgia,'Times New Roman',serif;
    font-size: 13.5px;
    line-height: 1.85;
    color: var(--text-dark-primary);
    max-height: 380px;
    overflow-y: auto;
    box-shadow: 0 2px 16px rgba(0,0,0,.3);
    outline: none;
    cursor: text;
  }
  /* Explicitly target children to defeat global p/span { color } rules */
  .lex-draft-doc p,
  .lex-draft-doc div,
  .lex-draft-doc span,
  .lex-draft-doc strong,
  .lex-draft-doc em { color: var(--text-dark-primary); }
  .lex-draft-doc .draft-h1 {
    text-align:center; font-size:14px; font-weight:700; letter-spacing:.06em;
    text-transform:uppercase; margin:14px 0 6px;
  }
  .lex-draft-doc .draft-h2 { font-size:13px; font-weight:700; margin:12px 0 4px; }
  .lex-draft-doc .draft-p  { margin:6px 0; }
  .lex-draft-doc .draft-hr { border:none; border-top:1px solid var(--border-dark-subtle); margin:14px 0; }

  /* Light theme: restore parchment look */
  [data-theme="light"] .lex-draft-doc {
    background: #FAFAF8;
    border-color: #E8E4DE;
    box-shadow: 0 2px 12px rgba(0,0,0,.06);
  }
  [data-theme="light"] .lex-draft-doc p,
  [data-theme="light"] .lex-draft-doc div,
  [data-theme="light"] .lex-draft-doc span,
  [data-theme="light"] .lex-draft-doc strong,
  [data-theme="light"] .lex-draft-doc em { color: #1A2234; }
  [data-theme="light"] .lex-draft-doc .draft-hr { border-top-color: #D1D5DB; }

  .lex-chat-scroll::-webkit-scrollbar       { width:5px; }
  .lex-chat-scroll::-webkit-scrollbar-track { background:transparent; }
  .lex-chat-scroll::-webkit-scrollbar-thumb { background:#1E2533; border-radius:4px; }
  .lex-chat-scroll::-webkit-scrollbar-thumb:hover { background:#3B82F6; }

  .lex-sess-item { cursor:pointer; padding:8px 10px; border-radius:7px; border:1px solid transparent; transition:all .15s; margin-bottom:2px; }
  .lex-sess-item:hover { background:rgba(59,130,246,.07); border-color:rgba(59,130,246,.14); }
  .lex-sess-item.active { background:rgba(59,130,246,.13); border-color:rgba(59,130,246,.28); }
  .lex-sess-del  { opacity:0; transition:opacity .15s; background:none; border:none; cursor:pointer; color:#3D5168; padding:2px 5px; border-radius:3px; font-size:15px; line-height:1; }
  .lex-sess-item:hover .lex-sess-del { opacity:1; }
  .lex-sess-del:hover { color:#EF4444!important; }

  .lex-quick { cursor:pointer; padding:10px 14px; border-radius:8px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06); display:flex; align-items:flex-start; gap:10px; transition:all .15s; text-align:left; width:100%; }
  .lex-quick:hover { background:rgba(59,130,246,.1); border-color:rgba(59,130,246,.25); }

  .lex-close-btn:hover      { background:rgba(239,68,68,.1)!important; border-color:rgba(239,68,68,.3)!important; color:#EF4444!important; }
  .lex-new-btn:hover        { background:rgba(59,130,246,.2)!important; border-color:rgba(59,130,246,.4)!important; }
  .lex-view-draft-btn       { transition:all .15s; }
  .lex-view-draft-btn:hover { background:rgba(99,102,241,.22)!important; border-color:rgba(99,102,241,.5)!important; color:#C7D2FE!important; }

  .lex-send-btn:not(:disabled):hover { background:#2563EB!important; }
  .lex-mic-btn:not(.lex-mic-live):hover { border-color:rgba(59,130,246,.4)!important; color:#93C5FD!important; }

  .lex-textarea { resize:none; overflow:hidden; font-family:inherit; }
  .lex-textarea:focus { outline:none; }
`;

// ═══════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════
export default function CommandPalette() {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';

  const location      = useLocation();
  const paramsFromHook = useParams();
  const navigate      = useNavigate();

  // ── Sessions ────────────────────────────────────────
  const [sessions, setSessions] = useState(() => loadSessions());
  const [currentId, setCurrentId] = useState(() => {
    const saved = localStorage.getItem(CURRENT_KEY);
    const all   = loadSessions();
    return (saved && all.find(s => s.id === saved)) ? saved : (all[0]?.id || null);
  });

  // ── UI ───────────────────────────────────────────────
  const [isOpen,      setIsOpen]      = useState(false);
  const [query,       setQuery]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [navRoute,    setNavRoute]    = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [micError,    setMicError]    = useState(null);

  // ── File attachment ──────────────────────────────────
  const [attachedFile, setAttachedFile] = useState(null); // { name, content }
  const [fileLoading,  setFileLoading]  = useState(false);

  // ── Refs ─────────────────────────────────────────────
  const inputRef       = useRef(null);
  const fileInputRef   = useRef(null);
  const recognitionRef = useRef(null);
  const searchRef      = useRef(null);
  const messagesEndRef = useRef(null);

  // ── Derived ──────────────────────────────────────────
  const currentSession  = sessions.find(s => s.id === currentId) || null;
  const messages        = currentSession?.messages        || [];
  const pendingSchedule = currentSession?.pendingSchedule || null;
  const pendingDraft    = currentSession?.pendingDraft    || null;
  // activeDocument: the "document on the desk" — survives draft card close/reject
  const activeDocument  = currentSession?.activeDocument  || null;

  // Route params (pathname-aware, works outside <Routes>)
  const matchDoc  = location.pathname.match(/\/case\/([^/]+)\/doc\/([^/]+)/);
  const matchCase = location.pathname.match(/\/case\/([^/]+)/);
  const routeParams = { ...paramsFromHook };
  if (matchDoc)        { routeParams.caseId = matchDoc[1]; routeParams.docId = matchDoc[2]; }
  else if (matchCase)  { routeParams.caseId = matchCase[1]; }

  // ── Session helpers ──────────────────────────────────
  const mutateSessions = useCallback((updater) => {
    setSessions(prev => {
      const next = updater(prev);
      persistSessions(next);
      return next;
    });
  }, []);

  const updateSession = useCallback((id, patchFn) => {
    mutateSessions(prev =>
      prev.map(s => s.id === id ? { ...patchFn(s), updatedAt: Date.now() } : s)
    );
  }, [mutateSessions]);

  const pushMessage = useCallback((sid, msg) => {
    updateSession(sid, s => ({
      ...s,
      title: (s.title === 'New conversation' && msg.role === 'user')
        ? truncate(msg.text, 52) : s.title,
      messages: [...s.messages, { ...msg, _ts: Date.now() }],
    }));
  }, [updateSession]);

  const patchMessage = useCallback((sid, msgId, patchFn) => {
    updateSession(sid, s => ({
      ...s,
      messages: s.messages.map(m => m.id === msgId ? patchFn(m) : m),
    }));
  }, [updateSession]);

  const startNew = useCallback(() => {
    const s = makeSession();
    mutateSessions(prev => [s, ...prev]);
    setCurrentId(s.id);
    localStorage.setItem(CURRENT_KEY, s.id);
    setQuery('');
    setNavRoute(null);
  }, [mutateSessions]);

  const selectSession = useCallback((id) => {
    setCurrentId(id);
    localStorage.setItem(CURRENT_KEY, id);
    setQuery('');
    setNavRoute(null);
  }, []);

  const deleteSession = useCallback((id, e) => {
    e.stopPropagation();
    mutateSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (id === currentId) {
        if (next.length > 0) {
          setCurrentId(next[0].id);
          localStorage.setItem(CURRENT_KEY, next[0].id);
        } else {
          const fresh = makeSession();
          next.unshift(fresh);
          setCurrentId(fresh.id);
          localStorage.setItem(CURRENT_KEY, fresh.id);
        }
      }
      return next;
    });
  }, [currentId, mutateSessions]);

  // Bootstrap: always have a session
  useEffect(() => {
    if (sessions.length === 0 || !sessions.find(s => s.id === currentId)) {
      startNew();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard / toggle ────────────────────────────────
  useEffect(() => {
    const onToggle = () => setIsOpen(v => !v);
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onToggle(); }
      if (e.key === 'Escape' && isOpen) setIsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('toggle-rag-palette', onToggle);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('toggle-rag-palette', onToggle);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 80);
  }, [isOpen]);

  // Keep searchRef always pointing to latest handleSearch
  useEffect(() => { searchRef.current = handleSearch; });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, loading, pendingSchedule, pendingDraft]);

  // ── Speech recognition ────────────────────────────────
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = false; rec.interimResults = true;
    rec.onstart  = () => { setIsListening(true); setMicError(null); };
    rec.onresult = (ev) => {
      let final = '', interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) final   += ev.results[i][0].transcript;
        else                       interim += ev.results[i][0].transcript;
      }
      if (final || interim) setQuery(final || interim);
      if (final) { rec.stop(); searchRef.current?.(null, final); }
    };
    rec.onerror = (ev) => {
      setMicError(ev.error === 'not-allowed' ? 'Mic access denied' : 'Mic error');
      setIsListening(false);
      setTimeout(() => setMicError(null), 3000);
    };
    rec.onend = () => setIsListening(false);
    recognitionRef.current = rec;
    return () => { try { rec.abort(); } catch (_) {} };
  }, []);

  const toggleMic = () => {
    if (!recognitionRef.current) return alert('Speech recognition not supported in this browser.');
    isListening ? recognitionRef.current.stop() : recognitionRef.current.start();
  };

  // ── File attachment handler ───────────────────────────
  const handleFileAttach = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const ext = file.name.split('.').pop().toLowerCase();
    const textTypes = ['txt', 'md', 'json', 'csv', 'js', 'ts', 'py', 'java', 'xml', 'html', 'css'];

    if (['jpg','jpeg','png','gif','webp','bmp','svg'].includes(ext)) {
      setAttachedFile({ name: file.name, content: '[Image attached — image analysis is not yet supported by this model. Describe what you need help with and I will assist.]', isImage: true });
      return;
    }

    if (textTypes.includes(ext)) {
      setFileLoading(true);
      try {
        const text = await file.text();
        setAttachedFile({ name: file.name, content: text.slice(0, 12000) });
      } catch (_) {
        setAttachedFile({ name: file.name, content: '[Could not read file content]' });
      } finally { setFileLoading(false); }
      return;
    }

    // PDF / DOCX — send to backend for extraction
    setFileLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
      const res = await fetch(`${API_BASE}/api/ai/extract-file`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setAttachedFile({ name: file.name, content: data.text || '[Empty document]' });
      } else {
        setAttachedFile({ name: file.name, content: '[Failed to extract text from file — please paste the content manually]' });
      }
    } catch (_) {
      setAttachedFile({ name: file.name, content: '[Failed to read file]' });
    } finally { setFileLoading(false); }
  };

  // ── Main search / stream ─────────────────────────────
  async function handleSearch(e, directQuery = null) {
    if (e) e.preventDefault();
    const q = (directQuery !== null ? directQuery : query).trim();
    if (!q || loading || navRoute) return;

    // Ensure live session
    let sid = currentId;
    if (!sid || !sessions.find(s => s.id === sid)) {
      const fresh = makeSession();
      mutateSessions(prev => { const n = [fresh, ...prev]; persistSessions(n); return n; });
      sid = fresh.id;
      setCurrentId(sid);
      localStorage.setItem(CURRENT_KEY, sid);
    }

    // Build display text and full query (file content appended for backend)
    const displayText = attachedFile ? `📎 ${attachedFile.name}\n\n${q}` : q;
    const fullQuery   = attachedFile
      ? `[Attached document: ${attachedFile.name}]\n\n${attachedFile.content}\n\n---\n\nUser query: ${q}`
      : q;

    pushMessage(sid, { id: `u_${Date.now()}`, role: 'user', text: displayText });
    setQuery('');
    setAttachedFile(null);
    setLoading(true);
    // Reset pendingSchedule only — pendingDraft persists until explicitly rejected/approved.
    // The draft is the "document on the desk"; the lawyer keeps working on it.
    updateSession(sid, s => ({ ...s, pendingSchedule: null }));

    // ── Client-side navigation fast-path ─────────────
    if (isNavCommand(q) && !attachedFile) {
      const intent = resolveNavIntent(q);
      if (intent) {
        const label = intent.route.replace(/^\//, '').replace(/-/g, ' ');
        pushMessage(sid, {
          id: `a_${Date.now()}`, role: 'assistant',
          text: `Navigating to **${label}**${intent.tab ? ` — opening **${intent.tab}** section` : ''}…`,
        });
        setLoading(false);
        setNavRoute(intent.route);
        setTimeout(() => {
          navigate(intent.route, intent.tab ? { state: { openTab: intent.tab } } : undefined);
          setNavRoute(null);
          setIsOpen(false);
        }, 900);
        return;
      }
    }

    // ── Backend stream ───────────────────────────────
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
      const res = await fetch(`${API_BASE}/api/ai/rag-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          query: fullQuery,
          currentPath: location.pathname,
          params: routeParams,
          // Always inject activeDocument — persists even when draft card is closed/rejected
          ...(activeDocument && {
            current_draft_context:  activeDocument.content,
            current_draft_title:    activeDocument.title,
            current_draft_type:     activeDocument.doc_type,
            current_draft_case_id:  activeDocument.case_id,
          }),
        }),
      });

      if (res.status === 401) {
        pushMessage(sid, {
          id: `e_${Date.now()}`, role: 'error',
          text: '⚠️ Session expired. Please log in again to use the AI Legal Associate.',
          isAuth: true,
        });
        setLoading(false);
        return;
      }
      if (!res.ok) {
        pushMessage(sid, { id: `e_${Date.now()}`, role: 'error', text: 'Server communication error. Please try again.' });
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      let buf = '', accText = '';
      const msgId = `a_${Date.now()}`;
      pushMessage(sid, { id: msgId, role: 'assistant', text: '', sources: [] });

      outer: while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();

        for (const line of lines) {
          const raw = line.trim();
          if (!raw.startsWith('data:')) continue;
          const json = raw.replace(/^data:\s*/, '').trim();
          if (!json || json === '[DONE]') continue;

          try {
            const p = JSON.parse(json);

            // ── Draft edit reply: overwrite active draft inline ──────
            if (p.action === 'update_document') {
              updateSession(sid, s => {
                const updated = s.pendingDraft
                  ? { ...s.pendingDraft, content: p.updated_content }
                  : { title: p.title || 'Updated Document', content: p.updated_content, doc_type: 'Legal Document', case_id: 'Unknown' };
                return { ...s, pendingDraft: updated, activeDocument: updated };
              });
              patchMessage(sid, msgId, m => ({
                ...m,
                text: `✏️ Draft updated${p.change_summary ? ' — ' + p.change_summary : ''}.\n\nReview the changes in the draft panel below.`,
              }));
              continue;
            }

            if (p.action === 'simulate_courtroom') {
              patchMessage(sid, msgId, m => ({ ...m, text: 'Litigation strategy loaded. Entering Virtual Courtroom War Room…' }));
              setTimeout(() => { navigate('/war-room', { state: { simulationData: p.simulationData } }); setIsOpen(false); }, 1100);
              break outer;
            }

            if (p.action === 'navigate') {
              const intent = resolveNavIntent(q);
              const finalRoute = p.target_route;
              const finalTab   = intent?.tab;
              setNavRoute(finalRoute);
              patchMessage(sid, msgId, m => ({ ...m, text: `Navigating to ${finalRoute}${finalTab ? ` — opening ${finalTab} section` : ''}…` }));
              setTimeout(() => {
                navigate(finalRoute, finalTab ? { state: { openTab: finalTab } } : undefined);
                setNavRoute(null);
                setIsOpen(false);
              }, 1000);
              break outer;
            }

            if (p.action === 'confirm_schedule') {
              updateSession(sid, s => ({ ...s, pendingSchedule: p.proposed_events }));
              patchMessage(sid, msgId, m => ({ ...m, text: 'I have drafted a schedule. Please review and approve it below.' }));
              continue;
            }

            if (p.action === 'review_document') {
              updateSession(sid, s => ({ ...s, pendingDraft: p.draft, activeDocument: p.draft }));
              patchMessage(sid, msgId, m => ({ ...m, text: 'Document drafted. Review and edit below before saving to the vault.' }));
              continue;
            }

            if (p.metadata) { patchMessage(sid, msgId, m => ({ ...m, sources: p.metadata.sources })); }
            if (p.token)    { accText += p.token; patchMessage(sid, msgId, m => ({ ...m, text: accText })); }
            if (p.error)    { patchMessage(sid, msgId, m => ({ ...m, text: accText + '\n\n[Error: ' + p.error + ']' })); }
          } catch (_) { /* skip malformed chunk */ }
        }
      }
    } catch (_) {
      pushMessage(sid, { id: `e_${Date.now()}`, role: 'error', text: 'Connection failed. Check your network and try again.' });
    } finally {
      setLoading(false);
    }
  }

  // ── Approve schedule ─────────────────────────────────
  async function handleApproveSchedule() {
    if (!pendingSchedule || !currentId) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
      const r = await fetch(`${API_BASE}/api/calendar/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify({ events: pendingSchedule }),
      });
      updateSession(currentId, s => ({ ...s, pendingSchedule: null }));
      pushMessage(currentId, {
        id: `sys_${Date.now()}`, role: r.ok ? 'assistant' : 'error',
        text: r.ok ? '✅ Schedule saved to your Legal Calendar.' : 'Failed to save schedule. Please try again.',
      });
    } catch (_) {
      pushMessage(currentId, { id: `e_${Date.now()}`, role: 'error', text: 'Failed to save schedule.' });
    } finally { setLoading(false); }
  }

  // ── Approve draft ────────────────────────────────────
  async function handleApproveDraft() {
    if (!pendingDraft || !currentId) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
      const r = await fetch(`${API_BASE}/api/vault/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify({
          case_id:  pendingDraft.case_id,
          title:    pendingDraft.title,
          doc_type: pendingDraft.doc_type || '',
          content:  pendingDraft.content,
        }),
      });
      // Approved = filed away; clear both draft card and working document
      updateSession(currentId, s => ({ ...s, pendingDraft: null, activeDocument: null }));
      pushMessage(currentId, {
        id: `sys_${Date.now()}`, role: r.ok ? 'assistant' : 'error',
        text: r.ok ? '✅ Document saved to Case Vault.' : 'Failed to save document. Please try again.',
      });
    } catch (_) {
      pushMessage(currentId, { id: `e_${Date.now()}`, role: 'error', text: 'Failed to save to Case Vault.' });
    } finally { setLoading(false); }
  }

  // ── Close  (does NOT wipe messages) ─────────────────
  const handleClose = () => {
    if (isListening) try { recognitionRef.current?.stop(); } catch (_) {}
    setIsOpen(false);
    setQuery('');
    // Session state is fully preserved — conversation continues on reopen
  };

  // ── Render ────────────────────────────────────────────
  if (!isOpen) return null;
  const isLocked = loading || !!navRoute;

  // Group sessions for sidebar
  const now = Date.now();
  const todaySess     = sessions.filter(s => now - s.updatedAt < 86400000);
  const yesterdaySess = sessions.filter(s => now - s.updatedAt >= 86400000 && now - s.updatedAt < 172800000);
  const olderSess     = sessions.filter(s => now - s.updatedAt >= 172800000);

  // Sidebar session row renderer
  const SessionRow = ({ s }) => (
    <div
      key={s.id}
      className={`lex-sess-item ${s.id === currentId ? 'active' : ''}`}
      onClick={() => selectSession(s.id)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '12px', fontWeight: s.id === currentId ? 600 : 400, color: s.id === currentId ? '#93C5FD' : '#9BAFC0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '1.35' }}>
            {s.title}
          </div>
          <div style={{ fontSize: '10px', color: '#374558', marginTop: '2px' }}>{relativeDate(s.updatedAt)}</div>
        </div>
        <button className="lex-sess-del" onClick={(e) => deleteSession(s.id, e)} title="Delete conversation">×</button>
      </div>
    </div>
  );

  const SectionLabel = ({ label }) => (
    <div style={{ padding: '8px 6px 3px', fontSize: '9.5px', fontWeight: 700, color: '#2D3D50', textTransform: 'uppercase', letterSpacing: '0.7px' }}>
      {label}
    </div>
  );

  return (
    <>
      <style>{AGENT_CSS}</style>

      {/* Full-screen overlay */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(3,6,14,.95)', display: 'flex' }}
        onClick={handleClose}
      >
        {/* Two-column container */}
        <div
          style={{ display: 'flex', width: '100%', height: '100%' }}
          onClick={e => e.stopPropagation()}
        >
          {/* ══════════════════════════════════
               LEFT SIDEBAR
          ══════════════════════════════════ */}
          <aside style={{ width: '255px', flexShrink: 0, background: '#080B14', borderRight: '1px solid #141B28', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Brand header */}
            <div style={{ padding: '18px 14px 12px', borderBottom: '1px solid #141B28' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <div style={{ width: '34px', height: '34px', borderRadius: '9px', background: 'linear-gradient(135deg,#3B82F6,#6366F1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(59,130,246,.3)' }}>
                  <svg width="16" height="16" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#E2E8F0', letterSpacing: '0.2px' }}>AI Legal Associate</div>
                  <div style={{ fontSize: '10px', color: '#3D5168', marginTop: '1px' }}>LexAmplify · Junior Counsel</div>
                </div>
              </div>

              <button
                className="lex-new-btn"
                onClick={startNew}
                style={{ width: '100%', padding: '8px 12px', background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.22)', borderRadius: '7px', color: '#7EB3F5', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px', transition: 'all .15s' }}
              >
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                New Conversation
              </button>
            </div>

            {/* Session list */}
            <div className="lex-side-scroll" style={{ flex: 1, overflowY: 'auto', padding: '6px 6px' }}>
              {sessions.length === 0 ? (
                <div style={{ padding: '24px 10px', textAlign: 'center', color: '#2D3D50', fontSize: '11.5px', lineHeight: '1.5' }}>
                  No conversations yet.<br />Start one above.
                </div>
              ) : (
                <>
                  {todaySess.length > 0 && (
                    <><SectionLabel label="Today" />{todaySess.map(s => <SessionRow key={s.id} s={s} />)}</>
                  )}
                  {yesterdaySess.length > 0 && (
                    <><SectionLabel label="Yesterday" />{yesterdaySess.map(s => <SessionRow key={s.id} s={s} />)}</>
                  )}
                  {olderSess.length > 0 && (
                    <><SectionLabel label="Earlier" />{olderSess.map(s => <SessionRow key={s.id} s={s} />)}</>
                  )}
                </>
              )}
            </div>

            {/* Keyboard shortcut hints */}
            <div style={{ padding: '10px 14px', borderTop: '1px solid #141B28' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#2D3D50' }}>
                <span>
                  <kbd style={{ background: '#0F1420', border: '1px solid #1A2030', borderRadius: '3px', padding: '1px 5px', fontSize: '9px', color: '#3D5168' }}>Ctrl K</kbd>
                  {' '}toggle
                </span>
                <span>
                  <kbd style={{ background: '#0F1420', border: '1px solid #1A2030', borderRadius: '3px', padding: '1px 5px', fontSize: '9px', color: '#3D5168' }}>Esc</kbd>
                  {' '}close
                </span>
              </div>
            </div>
          </aside>

          {/* ══════════════════════════════════
               MAIN CHAT AREA
          ══════════════════════════════════ */}
          <main style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0C1018', overflow: 'hidden' }}>

            {/* Top header bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', borderBottom: '1px solid #141B28', background: '#090C14', flexShrink: 0, gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <span style={{ fontSize: '11px', color: '#2D4057', flexShrink: 0 }}>Context:</span>
                <code style={{ fontSize: '11px', color: '#5B7FA0', background: 'rgba(255,255,255,.04)', padding: '2px 8px', borderRadius: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '320px' }}>
                  {location.pathname}
                </code>
                {navRoute && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 10px', background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.2)', borderRadius: '20px', fontSize: '11px', color: '#7EB3F5', flexShrink: 0 }}>
                    <span className="lex-shimmer" style={{ width: '6px', height: '6px', background: '#3B82F6', borderRadius: '50%', display: 'inline-block' }} />
                    Navigating…
                  </div>
                )}
              </div>
              {/* View Draft pill — shown when a document is active but the card is closed */}
              {activeDocument && !pendingDraft && (
                <button
                  className="lex-view-draft-btn"
                  onClick={() => updateSession(currentId, s => ({ ...s, pendingDraft: s.activeDocument }))}
                  style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 11px', background: 'rgba(99,102,241,.12)', border: '1px solid rgba(99,102,241,.3)', borderRadius: '5px', color: '#A5B4FC', fontSize: '11px', cursor: 'pointer', flexShrink: 0, fontWeight: 500 }}
                  title={`Reopen: ${activeDocument.title}`}
                >
                  📄 View Draft
                </button>
              )}

              <button
                className="lex-close-btn"
                onClick={handleClose}
                style={{ background: 'rgba(255,255,255,.05)', border: '1px solid #1A2030', color: '#4B6280', borderRadius: '6px', padding: '5px 12px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', transition: 'all .15s', flexShrink: 0 }}
              >
                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                Close
              </button>
            </div>

            {/* Navigation progress bar */}
            {navRoute && (
              <div style={{ flexShrink: 0, height: '2px', overflow: 'hidden' }}>
                <div className="lex-nav-bar" />
              </div>
            )}

            {/* ── Messages scroll area ── */}
            <div className="lex-chat-scroll" style={{ flex: 1, overflowY: 'auto', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

              {/* Empty state — quick commands */}
              {messages.length === 0 && !loading && (
                <div style={{ maxWidth: '700px', margin: '0 auto', width: '100%' }}>
                  <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <div style={{ width: '60px', height: '60px', margin: '0 auto 16px', borderRadius: '15px', background: 'linear-gradient(135deg,rgba(59,130,246,.18),rgba(99,102,241,.18))', border: '1px solid rgba(99,102,241,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="26" height="26" fill="none" stroke="#93C5FD" strokeWidth="1.6" viewBox="0 0 24 24">
                        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                        <path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
                      </svg>
                    </div>
                    <h2 style={{ fontSize: '21px', fontWeight: 700, color: '#DDE6F0', margin: '0 0 8px' }}>AI Legal Associate</h2>
                    <p style={{ fontSize: '13.5px', color: '#3E5470', lineHeight: '1.6', maxWidth: '420px', margin: '0 auto' }}>
                      Your junior counsel for LexAmplify. Draft documents, research law,
                      navigate any feature, manage schedules — all through natural conversation.
                    </p>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {QUICK_CMDS.map((cmd, i) => (
                      <button
                        key={i}
                        className="lex-quick"
                        onClick={() => { setQuery(cmd.text); setTimeout(() => searchRef.current?.(null, cmd.text), 40); }}
                      >
                        <span style={{ fontSize: '20px', flexShrink: 0, lineHeight: 1, marginTop: '1px' }}>{cmd.icon}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '12px', color: '#9BAFC0', lineHeight: '1.4', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {cmd.text}
                          </div>
                          <div style={{ fontSize: '10px', color: '#2D3D50', marginTop: '3px' }}>{cmd.category}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Message bubbles */}
              {messages.map((msg, idx) => {
                if (msg.role === 'user') {
                  return (
                    <div key={idx} className="lex-msg-in" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div style={{ maxWidth: '72%', background: 'rgba(59,130,246,.14)', border: '1px solid rgba(59,130,246,.24)', borderRadius: '12px 12px 2px 12px', padding: '11px 16px', fontSize: '13.5px', color: '#D5E2F0', lineHeight: '1.6', wordBreak: 'break-word' }}>
                        {msg.text}
                      </div>
                    </div>
                  );
                }
                if (msg.role === 'error') {
                  return (
                    <div key={idx} className="lex-msg-in" style={{ background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.17)', borderLeft: '3px solid #EF4444', borderRadius: '3px 8px 8px 3px', padding: '10px 14px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', color: '#EF4444', marginBottom: '4px' }}>Error</div>
                      <div style={{ fontSize: '13px', color: '#FCA5A5', lineHeight: '1.5' }}>{msg.text}</div>
                      {msg.isAuth && (
                        <button
                          onClick={() => { handleClose(); navigate('/login'); }}
                          style={{ marginTop: '8px', padding: '5px 14px', background: '#EF4444', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                        >Go to Login →</button>
                      )}
                    </div>
                  );
                }
                // assistant
                return (
                  <div key={idx} className="lex-msg-in" style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'linear-gradient(135deg,#3B82F6,#6366F1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px' }}>
                      <svg width="13" height="13" fill="none" stroke="white" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>
                    </div>
                    <div style={{ flex: 1, background: '#111827', border: '1px solid #1A2030', borderRadius: '2px 12px 12px 12px', padding: '12px 16px', minWidth: 0 }}>
                      {msg.text ? (
                        <div style={{ fontSize: '13.5px', lineHeight: '1.7', color: '#C8D8E8', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {msg.text}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '5px', alignItems: 'center', padding: '4px 0' }}>
                          {[1, 2, 3].map(n => (
                            <span key={n} className={`lex-dot-${n}`} style={{ width: '7px', height: '7px', background: '#3B82F6', borderRadius: '50%', display: 'inline-block' }} />
                          ))}
                        </div>
                      )}
                      {msg.sources && msg.sources.length > 0 && (
                        <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid #1A2030' }}>
                          <div style={{ fontSize: '9.5px', textTransform: 'uppercase', color: '#2D3D50', marginBottom: '5px', letterSpacing: '0.6px' }}>Sources</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                            {msg.sources.map((src, si) => (
                              <span key={si} style={{ background: 'rgba(255,255,255,.03)', border: '1px solid #1A2030', padding: '3px 8px', borderRadius: '20px', fontSize: '10.5px', color: '#506275' }}>
                                Doc #{src.document_id} · Chunk {src.chunk_index}
                                {src.similarity != null && ` · ${Math.round(src.similarity * 100)}%`}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Loading indicator */}
              {loading && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'linear-gradient(135deg,#3B82F6,#6366F1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="13" height="13" fill="none" stroke="white" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>
                  </div>
                  <div style={{ background: '#111827', border: '1px solid #1A2030', borderRadius: '2px 12px 12px 12px', padding: '14px 18px' }}>
                    <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                      {[1, 2, 3].map(n => (
                        <span key={n} className={`lex-dot-${n}`} style={{ width: '7px', height: '7px', background: '#3B82F6', borderRadius: '50%', display: 'inline-block' }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Pending schedule approval card ── */}
              {pendingSchedule && pendingSchedule.length > 0 && (
                <div className="lex-msg-in" style={{ background: '#111827', border: '1px solid #1A2030', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', paddingBottom: '10px', borderBottom: '1px solid #1A2030' }}>
                    <span style={{ fontSize: '16px' }}>📅</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#7EB3F5' }}>Review Proposed Schedule</span>
                    <span style={{ marginLeft: 'auto', fontSize: '10.5px', color: '#2D3D50' }}>{pendingSchedule.length} event{pendingSchedule.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginBottom: '14px' }}>
                    {pendingSchedule.map((ev, i) => {
                      const cols  = { drop_dead: '#EF4444', tickler: '#F59E0B', appearance: '#10B981', task: '#3B82F6' };
                      const icons = { drop_dead: '🚨', tickler: '⏰', appearance: '⚖️', task: '✅' };
                      const col   = cols[ev.event_type] || '#6B7280';
                      return (
                        <div key={i} style={{ padding: '9px 12px', borderLeft: `3px solid ${col}`, background: 'rgba(255,255,255,.02)', borderRadius: '0 5px 5px 0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                            <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#C8D8E8' }}>{ev.title}</span>
                            <span style={{ fontSize: '11px', color: '#3D5168', fontFamily: 'monospace', flexShrink: 0 }}>{ev.event_date}</span>
                          </div>
                          <div style={{ fontSize: '11px', color: col, marginTop: '3px' }}>
                            {icons[ev.event_type] || '📋'} {(ev.event_type || '').replace('_', ' ').toUpperCase()}
                            {ev.related_case_id && ` · Case ${ev.related_case_id}`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => updateSession(currentId, s => ({ ...s, pendingSchedule: null }))}
                      style={{ padding: '7px 16px', fontSize: '12px', color: '#506275', background: 'transparent', border: '1px solid #1A2030', borderRadius: '6px', cursor: 'pointer' }}
                    >Discard</button>
                    <button
                      onClick={handleApproveSchedule}
                      style={{ padding: '7px 18px', fontSize: '12px', color: '#fff', background: '#3B82F6', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                    >Approve & Save</button>
                  </div>
                </div>
              )}

              {/* ── Pending draft approval card ── */}
              {pendingDraft && (
                <div className="lex-msg-in" style={{ background: '#111827', border: '1px solid #1A2030', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingBottom: '10px', borderBottom: '1px solid #1A2030' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px' }}>📄</span>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#7EB3F5' }}>Review Drafted Document</span>
                    </div>
                    {pendingDraft.case_id && (
                      <span style={{ fontSize: '10.5px', color: '#2D3D50', background: 'rgba(255,255,255,.04)', padding: '2px 8px', borderRadius: '4px' }}>
                        Case: {pendingDraft.case_id}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#DDE6F0', marginBottom: '2px' }}>
                    {pendingDraft.title}
                    {pendingDraft.doc_type && (
                      <span style={{ fontWeight: 400, color: '#3D5168', fontSize: '11.5px', marginLeft: '6px' }}>({pendingDraft.doc_type})</span>
                    )}
                  </div>
                  <div style={{ fontSize: '10px', color: '#2D3D50', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Edit below before saving — final content will be stored in the vault
                  </div>
                  <div
                    className="lex-draft-doc"
                    contentEditable
                    suppressContentEditableWarning
                    dangerouslySetInnerHTML={{ __html: renderDraftHtml(pendingDraft.content) }}
                    onBlur={e => {
                      const plain = e.currentTarget.innerText || '';
                      updateSession(currentId, s => ({
                        ...s,
                        pendingDraft:   { ...s.pendingDraft,   content: plain },
                        activeDocument: { ...s.activeDocument, content: plain },
                      }));
                    }}
                  />
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '10px' }}>
                    <button
                      onClick={() => updateSession(currentId, s => ({ ...s, pendingDraft: null }))}
                      style={{ padding: '7px 16px', fontSize: '12px', color: '#506275', background: 'transparent', border: '1px solid #1A2030', borderRadius: '6px', cursor: 'pointer' }}
                    >Reject</button>
                    <button
                      onClick={handleApproveDraft}
                      style={{ padding: '7px 18px', fontSize: '12px', color: '#fff', background: '#3B82F6', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                    >Approve & Save to Vault</button>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* ══════════════════════════════════
                 INPUT BAR
            ══════════════════════════════════ */}
            <div style={{ padding: '12px 20px 16px', borderTop: '1px solid #141B28', background: '#090C14', flexShrink: 0 }}>

              {/* File attachment preview pill */}
              {(attachedFile || fileLoading) && (
                <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {fileLoading ? (
                    <div className="lex-shimmer" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.2)', borderRadius: '20px', fontSize: '12px', color: '#7EB3F5' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3B82F6', display: 'inline-block' }} />
                      Extracting file…
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', background: attachedFile?.isImage ? 'rgba(245,158,11,.1)' : 'rgba(16,185,129,.1)', border: `1px solid ${attachedFile?.isImage ? 'rgba(245,158,11,.25)' : 'rgba(16,185,129,.25)'}`, borderRadius: '20px', fontSize: '12px', color: attachedFile?.isImage ? '#FCD34D' : '#6EE7B7', maxWidth: '320px' }}>
                      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachedFile?.name}</span>
                      <button onClick={() => setAttachedFile(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 2px', lineHeight: 1, fontSize: '14px', opacity: 0.7 }}>×</button>
                    </div>
                  )}
                </div>
              )}

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                accept=".pdf,.docx,.doc,.txt,.md,.json,.csv,.jpg,.jpeg,.png,.gif,.webp"
                onChange={handleFileAttach}
              />

              <form
                onSubmit={handleSearch}
                style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', background: '#111827', border: `1px solid ${isListening ? 'rgba(239,68,68,.5)' : attachedFile ? 'rgba(16,185,129,.35)' : '#1A2030'}`, borderRadius: '10px', padding: '10px 12px', transition: 'border-color .2s' }}
              >
                <textarea
                  ref={inputRef}
                  className="lex-textarea"
                  rows={1}
                  value={query}
                  onChange={e => {
                    setQuery(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px';
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch(null); }
                  }}
                  disabled={isLocked}
                  placeholder={
                    isListening
                      ? '🎤 Listening — speak your command…'
                      : attachedFile
                      ? `Ask something about ${attachedFile.name}…`
                      : 'Command your AI Legal Associate… (Shift+Enter for new line)'
                  }
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: isLocked ? '#2D3D50' : '#C8D8E8', fontSize: '14px', lineHeight: '1.55', overflowY: 'hidden', minHeight: '22px', maxHeight: '130px', cursor: isLocked ? 'not-allowed' : 'text' }}
                />

                {/* Attach file button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLocked || fileLoading}
                  style={{ background: attachedFile ? 'rgba(16,185,129,.12)' : 'transparent', border: `1px solid ${attachedFile ? 'rgba(16,185,129,.3)' : '#1A2030'}`, color: attachedFile ? '#6EE7B7' : '#3D5168', borderRadius: '7px', padding: '6px 9px', cursor: isLocked ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}
                  title="Attach file (PDF, DOCX, TXT, image)"
                >
                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                  </svg>
                </button>

                {/* Mic button */}
                <button
                  type="button"
                  className={`lex-mic-btn ${isListening ? 'lex-mic-live' : ''}`}
                  onClick={toggleMic}
                  style={{ background: 'transparent', border: '1px solid #1A2030', color: isListening ? '#EF4444' : '#3D5168', borderRadius: '7px', padding: '6px 9px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s', position: 'relative' }}
                  title={isListening ? 'Stop listening' : 'Voice command'}
                >
                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
                  </svg>
                  {micError && (
                    <div style={{ position: 'absolute', bottom: 'calc(100% + 7px)', right: 0, background: '#EF4444', color: '#fff', padding: '3px 9px', borderRadius: '4px', fontSize: '10.5px', whiteSpace: 'nowrap', zIndex: 10 }}>
                      {micError}
                    </div>
                  )}
                </button>

                {/* Send button */}
                <button
                  type="submit"
                  className="lex-send-btn"
                  disabled={isLocked || (!query.trim() && !attachedFile)}
                  style={{ background: (isLocked || (!query.trim() && !attachedFile)) ? 'rgba(59,130,246,.18)' : '#3B82F6', border: 'none', color: '#fff', borderRadius: '7px', padding: '7px 18px', fontSize: '13px', fontWeight: 600, cursor: (isLocked || (!query.trim() && !attachedFile)) ? 'not-allowed' : 'pointer', flexShrink: 0, transition: 'all .15s', opacity: (isLocked || (!query.trim() && !attachedFile)) ? 0.45 : 1 }}
                >
                  Send
                </button>
              </form>

              <div style={{ marginTop: '6px', fontSize: '10px', color: '#1E2C3D', textAlign: 'center' }}>
                AI Legal Associate can make mistakes. Always verify critical legal information independently.
              </div>
            </div>
          </main>

        </div>
      </div>
    </>
  );
}
