import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
//  SLASH COMMANDS  (/ prefix autocomplete)
// ═══════════════════════════════════════════════════════
const SLASH_CMDS = [
  { cmd: '/nda',         label: 'Mutual NDA Agreement',     fill: 'Draft a mutual Non-Disclosure Agreement' },
  { cmd: '/notice',      label: 'Legal Notice',             fill: 'Draft a legal notice for breach of contract' },
  { cmd: '/bail',        label: 'Bail Application',         fill: 'Draft a bail application based on the case facts' },
  { cmd: '/petition',    label: 'Writ Petition (Art. 226)', fill: 'Draft a writ petition under Article 226 of the Constitution' },
  { cmd: '/affidavit',   label: 'Supporting Affidavit',     fill: 'Draft a supporting affidavit' },
  { cmd: '/summarize',   label: 'Summarize Draft',          fill: 'Summarize this draft' },
  { cmd: '/arbitration', label: 'Add Arbitration Clause',   fill: 'Add an arbitration clause to this draft' },
  { cmd: '/risk',        label: 'Risk Analysis',            fill: 'Analyse the high risk clauses in this draft' },
];

// ACTION_PILLS are now LLM-driven — sent via SSE as { suggested_actions: [...] }
// and stored on msg.suggestedActions. No hardcoded array needed.

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

// ═══════════════════════════════════════════════════════
//  MARKDOWN RENDERER  (zero-dependency, for AI chat replies)
// ═══════════════════════════════════════════════════════
const escHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const applyInline = (s) =>
  escHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="md-code">$1</code>');

const renderMarkdown = (text) => {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (/^### /.test(ln))       { out.push(`<h3 class="md-h3">${applyInline(ln.slice(4))}</h3>`); i++; }
    else if (/^## /.test(ln))   { out.push(`<h2 class="md-h2">${applyInline(ln.slice(3))}</h2>`); i++; }
    else if (/^# /.test(ln))    { out.push(`<h1 class="md-h1">${applyInline(ln.slice(2))}</h1>`); i++; }
    else if (/^---+$/.test(ln.trim())) { out.push('<hr class="md-hr">'); i++; }
    else if (/^[*\-] /.test(ln)) {
      const items = [];
      while (i < lines.length && /^[*\-] /.test(lines[i])) {
        items.push(`<li>${applyInline(lines[i].replace(/^[*\-] /, ''))}</li>`);
        i++;
      }
      out.push(`<ul class="md-ul">${items.join('')}</ul>`);
    }
    else if (/^\d+\. /.test(ln)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(`<li>${applyInline(lines[i].replace(/^\d+\. /, ''))}</li>`);
        i++;
      }
      out.push(`<ol class="md-ol">${items.join('')}</ol>`);
    }
    else if (ln.trim() === '') { out.push('<div class="md-gap"></div>'); i++; }
    else { out.push(`<p class="md-p">${applyInline(ln)}</p>`); i++; }
  }
  return out.join('');
};

const highlightPlaceholders = (html) =>
  html.replace(/\[([A-Z][A-Z0-9 ''\/\-,\.&]*)\]/g,
    '<span class="lex-placeholder">[$1]</span>'
  );

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
  @keyframes lex-in      { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:none} }
  @keyframes lex-navbar  { 0%{width:0} 100%{width:100%} }
  @keyframes lex-dot     { 0%,80%,100%{transform:scale(0)} 40%{transform:scale(1)} }
  @keyframes lex-breathe { 0%,100%{opacity:.72;box-shadow:0 0 0 0 rgba(59,130,246,0)} 50%{opacity:1;box-shadow:0 0 18px 5px rgba(59,130,246,.28)} }

  .lex-shimmer      { animation: lex-pulse 1.5s infinite ease-in-out; }
  .lex-mic-live     { animation: lex-mic-ring 1.4s infinite!important; background:rgba(239,68,68,.12)!important; color:#ef4444!important; border-color:#ef4444!important; }
  @keyframes lex-send-wake { 0%,100%{box-shadow:0 0 0 0 rgba(59,130,246,.55)} 50%{box-shadow:0 0 0 5px rgba(59,130,246,0)} }
  .lex-send-awake   { animation: lex-send-wake 1.1s ease-in-out infinite!important; }
  .lex-mic-denied   { opacity:.45; cursor:not-allowed!important; }
  .lex-msg-in       { animation: lex-in .2s ease; }
  .lex-nav-bar      { height:2px; background:linear-gradient(90deg,#3B82F6,#6366F1); animation:lex-navbar 1.1s ease forwards; border-radius:2px; }
  .lex-dot-1        { animation: lex-dot 1.2s infinite ease-in-out; animation-delay:0s;   }
  .lex-dot-2        { animation: lex-dot 1.2s infinite ease-in-out; animation-delay:.18s; }
  .lex-dot-3        { animation: lex-dot 1.2s infinite ease-in-out; animation-delay:.36s; }
  .lex-ai-breathing { animation: lex-breathe 2.2s ease-in-out infinite; border-radius:7px; }

  /* ── InzIQ Co-Pilot Slide-Over Drawer (right-aligned, non-blocking) ── */
  @keyframes inziq-drawer-in  { from { transform: translateX(100%); } to { transform: translateX(0); } }
  @keyframes inziq-drawer-out { from { transform: translateX(0); }    to { transform: translateX(100%); } }
  .inziq-drawer {
    position: fixed; top: 0; right: 0; height: 100vh; z-index: 95;
    display: flex; overflow: hidden;
    background: rgba(8,11,20,.92);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border-left: 1px solid rgba(255,255,255,.1);
    box-shadow: -8px 0 40px rgba(0,0,0,.5);
    animation: inziq-drawer-in .3s cubic-bezier(.4,0,.2,1) both;
    transition: width .3s cubic-bezier(.4,0,.2,1);
  }
  .inziq-drawer.closing { animation: inziq-drawer-out .28s cubic-bezier(.4,0,.2,1) both; }

  /* ── War Room: full-screen immersive mode (overrides the side drawer) ── */
  @keyframes inziq-warroom-in  { from { opacity:0; transform:scale(.985); } to { opacity:1; transform:scale(1); } }
  @keyframes inziq-warroom-out { from { opacity:1; transform:scale(1); }    to { opacity:0; transform:scale(.985); } }
  .inziq-drawer.war-room {
    inset: 0; width: 100vw !important; height: 100vh; z-index: 101;
    border-left: 0; justify-content: center;
    animation: inziq-warroom-in .3s cubic-bezier(.4,0,.2,1) both;
  }
  .inziq-drawer.war-room.closing { animation: inziq-warroom-out .28s cubic-bezier(.4,0,.2,1) both; }
  /* Centered ultra-premium research column with subtle gutters */
  .inziq-drawer.war-room .lex-chat-main {
    flex: 0 1 1000px !important; max-width: 1000px;
    border-left: 1px solid rgba(255,255,255,.05);
    border-right: 1px solid rgba(255,255,255,.05);
  }

  /* ── Context-morphing action chips (above the input) ── */
  .lex-ctx-chips { display:flex; gap:6px; flex-wrap:wrap; padding:0 2px 8px; }
  .lex-ctx-chip {
    display:inline-flex; align-items:center; gap:5px;
    padding:5px 11px; font-size:11.5px; font-weight:500; font-family:inherit;
    color:#93A9C4; background:rgba(255,255,255,.03);
    border:1px solid rgba(255,255,255,.08); border-radius:15px;
    cursor:pointer; white-space:nowrap; transition:all .15s;
  }
  .lex-ctx-chip:hover:not(:disabled) { background:rgba(99,102,241,.12); border-color:rgba(99,102,241,.35); color:#C7D2FE; transform:translateY(-1px); }
  .lex-ctx-chip:disabled { opacity:.4; cursor:default; }
  .lex-ctx-chip svg { color:#6366F1; flex-shrink:0; }

  /* ── Ambient glow on chat canvas ── */
  .lex-chat-main { position:relative; }
  .lex-chat-main::before {
    content:''; position:absolute; top:22%; left:50%; transform:translateX(-50%);
    width:620px; height:380px; pointer-events:none; z-index:0;
    background:radial-gradient(ellipse at center, rgba(59,130,246,.055) 0%, rgba(99,102,241,.03) 45%, transparent 70%);
    filter:blur(55px);
  }

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

  /* ── Sidebar collapse ── */
  .lex-sidebar { transition: width 0.22s ease; }
  .lex-sidebar-toggle { background:none; border:none; color:#3D5168; cursor:pointer; padding:4px 6px; border-radius:4px; line-height:1; transition:all .15s; }
  .lex-sidebar-toggle:hover { color:#7EB3F5; background:rgba(59,130,246,.08); }

  /* ── RHS Draft Drawer ── */
  .lex-drawer-body {
    flex:1; overflow-y:auto; outline:none; cursor:text;
    padding:32px 40px;
    font-family: Georgia, 'Merriweather', 'Times New Roman', serif;
    font-size:13.5px; line-height:1.9; letter-spacing:.01em;
    text-align:justify;
    color: var(--text-dark-primary);
    background: var(--bg-dark-card);
  }
  .lex-drawer-body p, .lex-drawer-body div, .lex-drawer-body span,
  .lex-drawer-body strong, .lex-drawer-body em { color: var(--text-dark-primary); }
  [data-theme="light"] .lex-drawer-body { background:#FAF8F5; border-left:3px solid #EDE8DF; }
  [data-theme="light"] .lex-drawer-body p, [data-theme="light"] .lex-drawer-body div,
  [data-theme="light"] .lex-drawer-body span, [data-theme="light"] .lex-drawer-body strong,
  [data-theme="light"] .lex-drawer-body em { color:#1A1A2E; }
  .lex-drawer-body::-webkit-scrollbar { width:4px; }
  .lex-drawer-body::-webkit-scrollbar-thumb { background:#1E2533; border-radius:4px; }

  /* ── Markdown output in chat bubbles ── */
  .lex-md { word-break:break-word; }
  .lex-md .md-h1 { font-size:15px; font-weight:700; color:#DDE6F0; margin:14px 0 4px; }
  .lex-md .md-h2 { font-size:14px; font-weight:700; color:#C8D8E8; margin:12px 0 4px; }
  .lex-md .md-h3 { font-size:13px; font-weight:700; color:#B0C4D8; margin:10px 0 3px; letter-spacing:.01em; }
  .lex-md .md-p  { margin:4px 0; }
  .lex-md .md-ul, .lex-md .md-ol { margin:5px 0 5px 18px; padding:0; }
  .lex-md li     { margin:2px 0; }
  .lex-md .md-hr { border:none; border-top:1px solid #1A2030; margin:10px 0; }
  .lex-md .md-code { background:#0F1420; border:1px solid #1A2030; padding:1px 5px; border-radius:3px; font-family:monospace; font-size:12px; color:#93C5FD; }
  .lex-md .md-gap { height:6px; }

  /* ── Artifact card in chat (glassmorphism) ── */
  .lex-artifact-card { margin-top:10px; background:rgba(10,14,26,.65); border:1px solid rgba(255,255,255,.06); border-radius:8px; overflow:hidden; box-shadow:0 4px 32px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.05); backdrop-filter:blur(12px); }
  .lex-artifact-card-header { display:flex; align-items:center; gap:8px; padding:8px 12px; }
  .lex-artifact-view-btn { margin-left:auto; padding:3px 10px; background:rgba(99,102,241,.12); border:1px solid rgba(99,102,241,.25); border-radius:4px; cursor:pointer; color:#A5B4FC; font-size:11px; font-weight:500; transition:all .15s; white-space:nowrap; flex-shrink:0; font-family:inherit; letter-spacing:.03em; }
  .lex-artifact-view-btn:hover { background:rgba(99,102,241,.24)!important; border-color:rgba(99,102,241,.45)!important; }
  .lex-artifact-preview { padding:5px 12px 8px; font-size:10.5px; color:#64748B; letter-spacing:.02em; border-top:1px solid rgba(255,255,255,.04); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  /* ── Action pills ── */
  .lex-action-pills { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,.05); }
  .lex-pill { padding:4px 12px; font-size:11px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.07); border-radius:20px; color:#94A3B8; cursor:pointer; transition:all .18s; white-space:nowrap; font-family:inherit; letter-spacing:.03em; }
  .lex-pill:hover { background:rgba(59,130,246,.12)!important; border-color:rgba(59,130,246,.35)!important; color:#93C5FD!important; box-shadow:0 0 10px rgba(59,130,246,.15)!important; }

  /* ── Slash command popup ── */
  .lex-slash-menu { position:absolute; bottom:calc(100% + 6px); left:0; right:0; background:#0D1117; border:1px solid rgba(255,255,255,.07); border-radius:8px; overflow:hidden; box-shadow:0 -8px 32px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.04); z-index:200; backdrop-filter:blur(12px); }
  .lex-slash-item { display:flex; align-items:center; gap:10px; padding:9px 14px; width:100%; text-align:left; background:none; border:none; border-bottom:1px solid rgba(255,255,255,.04); cursor:pointer; transition:background .12s; font-family:inherit; }
  .lex-slash-item:last-child { border-bottom:none; }
  .lex-slash-item:hover { background:rgba(59,130,246,.1); }
  .lex-slash-cmd { font-size:12px; font-weight:700; color:#3B82F6; font-family:monospace; min-width:110px; letter-spacing:.03em; }
  .lex-slash-label { font-size:11.5px; color:#94A3B8; letter-spacing:.02em; }

  /* ── Smart Paper placeholder highlights ── */
  .lex-placeholder { background:rgba(251,191,36,.14); border:1px solid rgba(251,191,36,.32); border-radius:3px; padding:0 3px; color:#FCD34D; font-weight:500; cursor:pointer; transition:background .15s; white-space:nowrap; }
  .lex-placeholder:hover { background:rgba(251,191,36,.28); }
  [data-theme="light"] .lex-placeholder { color:#92400E; background:rgba(251,191,36,.22); border-color:rgba(251,191,36,.5); }

  /* ── Snapshot banner & utility buttons in drawer ── */
  .lex-snapshot-banner { background:rgba(245,158,11,.08); border-bottom:1px solid rgba(245,158,11,.22); padding:5px 14px; display:flex; align-items:center; gap:8px; font-size:11px; color:#FCD34D; flex-shrink:0; }
  .lex-util-btn { background:none; border:none; cursor:pointer; color:#3D5168; padding:3px 6px; border-radius:4px; line-height:1; transition:all .15s; flex-shrink:0; display:flex; align-items:center; }
  .lex-util-btn:hover { color:#7EB3F5; background:rgba(59,130,246,.1); }
  .lex-copy-toast { position:absolute; top:-26px; right:0; background:#1A2030; border:1px solid #1E2A3A; color:#6EE7B7; font-size:10px; padding:2px 8px; border-radius:4px; white-space:nowrap; pointer-events:none; animation:lex-in .2s ease; }

  /* ── Nested document tree in sidebar ── */
  .lex-doc-tree-wrap  { margin-top:5px; padding-left:8px; display:flex; flex-direction:column; gap:1px; border-left:1px solid rgba(59,130,246,.18); }
  .lex-doc-tree-item  { display:flex; align-items:center; gap:5px; padding:3px 7px; width:100%; text-align:left; background:none; border:none; border-radius:4px; cursor:pointer; transition:all .15s; font-family:inherit; }
  .lex-doc-tree-item:hover { background:rgba(59,130,246,.1); }
  .lex-doc-tree-item.lex-saved-asset:hover { background:rgba(16,185,129,.07); }
  .lex-doc-tree-label { font-size:10.5px; color:#5B7FA0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
  .lex-doc-tree-item:hover .lex-doc-tree-label { color:#93C5FD; }
  .lex-doc-tree-item.lex-saved-asset .lex-doc-tree-label { color:#34D399; }
  .lex-doc-tree-item.lex-saved-asset:hover .lex-doc-tree-label { color:#6EE7B7; }
  .lex-doc-section-sep { font-size:8px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:#253040; padding:4px 7px 1px; }

  /* ── Hero ↔ Docked input bar transitions ── */
  @keyframes lex-dock { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
  .lex-input-bar-hero   { animation:lex-in .32s ease; }
  .lex-input-bar-docked { animation:lex-dock .26s cubic-bezier(0.4,0,0.2,1); }

  /* ── RHS Drawer (upgraded transition) ── */
  .lex-drawer { transition: width 0.3s cubic-bezier(0.4,0,0.2,1); }

  /* ══════════════════════════════════════════════
       3-DOTS CONVERSATION MENU
  ══════════════════════════════════════════════ */
  .lex-3dots-btn {
    opacity: 0.25; transition: opacity .15s, color .12s, background .12s;
    background: none; border: none; cursor: pointer;
    color: #3D5168; padding: 2px 5px; border-radius: 3px;
    font-size: 15px; line-height: 1; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .lex-sess-item:hover .lex-3dots-btn { opacity: 1; }
  .lex-sess-item.active .lex-3dots-btn { opacity: 0.6; }
  .lex-sess-item.active:hover .lex-3dots-btn { opacity: 1; }
  .lex-3dots-btn:hover { color: #7EB3F5!important; background: rgba(59,130,246,.1); opacity: 1 !important; }

  .lex-ctx-menu {
    position: absolute; z-index: 10010;
    background: #0D1117; border: 1px solid rgba(255,255,255,.08);
    border-radius: 9px; min-width: 170px;
    box-shadow: 0 12px 40px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.05);
    backdrop-filter: blur(14px); overflow: hidden;
    animation: lex-ctx-in .14s cubic-bezier(0.16,1,0.3,1);
  }
  @keyframes lex-ctx-in {
    from { opacity: 0; transform: scale(0.93) translateY(-4px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  .lex-ctx-item {
    display: flex; align-items: center; gap: 9px;
    padding: 9px 14px; width: 100%; text-align: left;
    background: none; border: none; border-bottom: 1px solid rgba(255,255,255,.04);
    cursor: pointer; transition: background .12s; font-family: inherit;
    font-size: 12.5px; color: #94A3B8; letter-spacing: .02em;
  }
  .lex-ctx-item:last-child { border-bottom: none; }
  .lex-ctx-item:hover { background: rgba(59,130,246,.1); color: #E2E8F0; }
  .lex-ctx-item.danger { color: #F87171; }
  .lex-ctx-item.danger:hover { background: rgba(239,68,68,.1); }
  .lex-ctx-item-icon { width: 14px; height: 14px; flex-shrink: 0; opacity: .8; }

  /* Inline rename input */
  .lex-rename-input {
    flex: 1; background: rgba(59,130,246,.08); border: 1px solid rgba(59,130,246,.3);
    border-radius: 4px; padding: 2px 7px; font-size: 12px; color: #E2E8F0;
    font-family: inherit; outline: none; min-width: 0;
  }
  .lex-rename-input:focus { border-color: rgba(59,130,246,.6); }

  /* Pin badge */
  .lex-pinned-badge {
    font-size: 9px; background: rgba(245,158,11,.12);
    border: 1px solid rgba(245,158,11,.25); color: #F59E0B;
    border-radius: 3px; padding: 0px 5px; flex-shrink: 0;
    font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
  }

  /* Confirm delete overlay */
  .lex-confirm-delete {
    position: absolute; inset: 0; z-index: 10; border-radius: 7px;
    background: rgba(15,10,10,.96); display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 10px; padding: 12px 10px;
    animation: lex-in .18s ease;
  }

  /* ══════════════════════════════════════════════
       SAVE TO VAULT MODAL
  ══════════════════════════════════════════════ */
  .svm-backdrop {
    position: fixed; inset: 0; z-index: 10020;
    background: rgba(3,6,14,.82); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    animation: lex-in .18s ease;
  }
  .svm-panel {
    background: var(--bg-panel, #171c26);
    border: 1px solid rgba(59,130,246,.22);
    border-radius: 14px; width: 660px; max-width: 96vw;
    max-height: 90vh; display: flex; flex-direction: column;
    box-shadow: 0 28px 80px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.04);
    overflow: hidden;
  }
  .svm-header {
    padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,.06);
    display: flex; align-items: center; justify-content: space-between;
    background: rgba(255,255,255,.015); flex-shrink: 0;
  }
  .svm-title { font-size: 14px; font-weight: 700; color: #E2E8F0; }
  .svm-close { background: none; border: none; cursor: pointer; color: #475569; padding: 3px 6px; border-radius: 4px; transition: color .15s; }
  .svm-close:hover { color: #EF4444; }

  .svm-body { flex: 1; overflow-y: auto; padding: 20px 26px; display: flex; flex-direction: column; gap: 20px; }
  .svm-body::-webkit-scrollbar { width: 4px; }
  .svm-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 2px; }

  .svm-section-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .07em; color: #475569; margin-bottom: 6px;
  }

  /* Breadcrumb navigation */
  .svm-breadcrumb {
    display: flex; align-items: center; gap: 2px; padding: 5px 8px;
    background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06);
    border-radius: 6px; margin-bottom: 6px; flex-wrap: wrap; min-height: 30px;
  }
  .svm-breadcrumb-item {
    background: none; border: none; padding: 2px 6px; border-radius: 4px;
    color: #7EB3F5; font-size: 11.5px; cursor: pointer; font-weight: 600;
    transition: background .12s; display: flex; align-items: center; gap: 4px;
    font-family: inherit;
  }
  .svm-breadcrumb-item:hover { background: rgba(59,130,246,.12); }
  .svm-breadcrumb-item.current { color: #E2E8F0; cursor: default; pointer-events: none; }
  .svm-breadcrumb-sep { color: #2D3748; font-size: 13px; flex-shrink: 0; user-select: none; }

  /* Drill-down explorer */
  .svm-tree { display: flex; flex-direction: column; gap: 1px; }
  .svm-explorer { display: flex; flex-direction: column; gap: 2px; }
  .svm-explorer-row {
    display: flex; align-items: center; gap: 9px; padding: 8px 11px;
    border-radius: 7px; cursor: pointer;
    transition: background .14s ease, border-color .14s ease, color .14s ease;
    font-size: 12.5px; color: #94A3B8; user-select: none;
    border: 1px solid transparent;
  }
  .svm-explorer-row:hover {
    background: rgba(59,130,246,.11);
    border-color: rgba(59,130,246,.22);
    color: #CBD5E1;
  }
  .svm-explorer-row:hover .svm-row-chevron {
    color: #3B82F6;
    transform: translateX(3px);
  }
  .svm-row-chevron {
    transition: transform .14s ease, color .14s ease;
    color: #2D3748;
    flex-shrink: 0;
  }
  .svm-explorer-empty {
    font-size: 12px; color: #334155; padding: 14px 10px;
    text-align: center; font-style: italic;
    border: 1px dashed rgba(255,255,255,.06); border-radius: 6px;
  }
  /* Existing document row — non-navigable, visual context only */
  .svm-explorer-doc {
    display: flex; align-items: center; gap: 9px; padding: 6px 11px;
    border-radius: 6px; font-size: 12px; color: #334155; user-select: none;
    border: 1px solid transparent; cursor: default;
    transition: background .12s;
  }
  .svm-explorer-doc:hover { background: rgba(255,255,255,.02); }
  .svm-explorer-doc-name {
    flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: #475569;
  }
  .svm-explorer-doc-type {
    font-size: 10px; color: #1E293B; background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.07); border-radius: 3px;
    padding: 1px 5px; flex-shrink: 0; font-family: monospace;
  }
  /* Divider between folder section and document section */
  .svm-explorer-section-label {
    font-size: 9.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .07em; color: #1E293B; padding: 6px 11px 2px;
    user-select: none;
  }
  /* Count badge on breadcrumb current segment */
  .svm-crumb-count {
    font-size: 9.5px; color: #334155; background: rgba(255,255,255,.05);
    border-radius: 8px; padding: 0 5px; font-family: monospace; margin-left: 3px;
  }

  /* Format selector */
  .svm-format-select {
    width: 100%; background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.1); border-radius: 6px;
    padding: 8px 32px 8px 10px; font-size: 12.5px; color: #CBD5E1;
    cursor: pointer; outline: none; transition: border-color .15s; font-family: inherit;
    appearance: none; -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%23475569' stroke-width='2.5' viewBox='0 0 24 24'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 10px center; box-sizing: border-box;
  }
  .svm-format-select:focus { border-color: rgba(59,130,246,.5); }
  .svm-format-select option { background: #1E2535; color: #E2E8F0; }

  /* New folder inline creator */
  .svm-new-folder-row {
    display: flex; align-items: center; gap: 7px; padding: 5px 8px;
    background: rgba(59,130,246,.06); border: 1px dashed rgba(59,130,246,.22);
    border-radius: 6px; margin-top: 4px;
  }
  .svm-new-folder-input {
    flex: 1; background: transparent; border: none; outline: none;
    font-size: 12.5px; color: #E2E8F0; font-family: inherit;
  }
  .svm-new-folder-input::placeholder { color: #475569; }

  /* Filename input */
  .svm-filename-input {
    width: 100%; background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.1); border-radius: 7px;
    padding: 9px 12px; font-size: 13px; color: #E2E8F0;
    font-family: inherit; outline: none; transition: border-color .15s; box-sizing: border-box;
  }
  .svm-filename-input:focus { border-color: rgba(59,130,246,.5); }

  /* Last-used folder hint */
  .svm-last-folder-hint {
    display: flex; align-items: center; gap: 7px; padding: 8px 12px;
    background: rgba(245,158,11,.06); border: 1px solid rgba(245,158,11,.18);
    border-radius: 7px; font-size: 11.5px; color: #FCD34D; cursor: pointer;
    transition: background .15s;
  }
  .svm-last-folder-hint:hover { background: rgba(245,158,11,.12); }

  .svm-footer {
    padding: 12px 20px; border-top: 1px solid rgba(255,255,255,.06);
    display: flex; align-items: center; justify-content: space-between;
    gap: 10px; flex-shrink: 0; background: rgba(255,255,255,.012);
  }
  .svm-dest-label { font-size: 11px; color: #475569; }
  .svm-dest-path { font-size: 11.5px; color: #7EB3F5; font-weight: 600; }

  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

  /* ── Mini vault folder cards (Save Modal directory browser) ─── */
  .svm-folder-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(178px, 1fr)); gap: 7px;
  }
  .svm-folder-card {
    display: flex; align-items: center; gap: 9px; padding: 9px 11px;
    background: rgba(59,130,246,.035); border: 1px solid rgba(59,130,246,.12);
    border-radius: 8px; cursor: pointer; transition: all 0.17s ease; min-width: 0;
    text-align: left;
  }
  .svm-folder-card:hover {
    background: rgba(59,130,246,.1); border-color: rgba(59,130,246,.3);
    transform: translateY(-1px); box-shadow: 0 4px 14px rgba(59,130,246,.1);
  }
  .svm-folder-card-icon { font-size: 18px; flex-shrink: 0; line-height: 1; }
  .svm-folder-card-info { flex: 1; min-width: 0; }
  .svm-folder-card-name {
    font-size: 12.5px; font-weight: 600; color: #E2E8F0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .svm-folder-card-meta { font-size: 10px; color: #334155; margin-top: 1px; }
  .svm-folder-card-chevron { color: #253244; flex-shrink: 0; transition: all .15s; }
  .svm-folder-card:hover .svm-folder-card-chevron { color: #3B82F6; transform: translateX(3px); }

  /* ── Section divider between folders and docs ────────────────── */
  .svm-grid-section-label {
    font-size: 9.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .07em; color: #1E293B; padding: 0 2px; margin-bottom: 5px;
  }

  /* ── Drill-down micro-animations ─────────────────────────────── */
  @keyframes svm-drill-in {
    from { opacity: 0; transform: translateX(18px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes svm-drill-out {
    from { opacity: 0; transform: translateX(-18px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  .svm-nav-in  { animation: svm-drill-in  0.2s cubic-bezier(0.16,1,0.3,1); }
  .svm-nav-out { animation: svm-drill-out 0.2s cubic-bezier(0.16,1,0.3,1); }

  /* ── Empty folder state in modal ─────────────────────────────── */
  .svm-vault-empty {
    padding: 22px 14px; text-align: center;
    border: 1px dashed rgba(255,255,255,.06); border-radius: 8px;
    color: #334155; font-size: 12px; line-height: 1.6;
  }

  .svm-btn-primary {
    padding: 8px 20px; border-radius: 7px; background: #3B82F6;
    border: none; color: #fff; font-size: 13px; font-weight: 600;
    cursor: pointer; transition: background .15s; font-family: inherit;
    flex-shrink: 0;
  }
  .svm-btn-primary:hover:not(:disabled) { background: #2563EB; }
  .svm-btn-primary:disabled { opacity: .4; cursor: not-allowed; }
  .svm-btn-ghost {
    padding: 8px 16px; border-radius: 7px; background: transparent;
    border: 1px solid rgba(255,255,255,.1); color: #506275;
    font-size: 12px; cursor: pointer; transition: all .15s; font-family: inherit;
  }
  .svm-btn-ghost:hover { border-color: rgba(255,255,255,.2); color: #94A3B8; }

  /* Share modal */
  .svm-share-url {
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1);
    border-radius: 7px; padding: 10px 12px; font-size: 12px; color: #7EB3F5;
    font-family: monospace; word-break: break-all; line-height: 1.5;
  }

  /* ══════════════════════════════════════════════
       RICH TEXT EDITOR TOOLBAR
  ══════════════════════════════════════════════ */
  .lex-rte-toolbar {
    display: flex; align-items: center; gap: 2px; flex-shrink: 0;
    padding: 5px 10px; flex-wrap: wrap;
    border-bottom: 1px solid rgba(255,255,255,.04);
    background: #080B12;
  }
  .lex-rte-btn {
    display: flex; align-items: center; justify-content: center;
    min-width: 28px; height: 26px; padding: 0 6px;
    background: transparent; border: 1px solid transparent;
    border-radius: 4px; cursor: pointer; transition: all .12s;
    color: #506275; font-size: 12.5px; font-family: inherit; line-height: 1;
    user-select: none;
  }
  .lex-rte-btn:hover { background: rgba(59,130,246,.1); border-color: rgba(59,130,246,.22); color: #93C5FD; }
  .lex-rte-sep { width: 1px; height: 18px; background: rgba(255,255,255,.07); margin: 0 3px; flex-shrink: 0; }
  .lex-rte-group { display: flex; align-items: center; gap: 1px; }

  /* ── Document Tags Pill Selector ── */
  .svm-tags-wrap { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .svm-tag-pill {
    display: inline-flex; align-items: center; padding: 4px 11px;
    border-radius: 20px; cursor: pointer; font-size: 11.5px; font-weight: 500;
    transition: all .12s; border: 1px solid rgba(255,255,255,.1);
    color: #475569; background: transparent; font-family: inherit; user-select: none;
  }
  .svm-tag-pill.active { background: rgba(59,130,246,.15); border-color: rgba(59,130,246,.35); color: #7EB3F5; }
  .svm-tag-pill:hover:not(.active) { border-color: rgba(255,255,255,.2); color: #94A3B8; }

  /* ── Vault Save Confirmation Card in Chat Feed ── */
  .lex-vault-save-card {
    display: flex; align-items: center; gap: 14px; padding: 11px 15px;
    border-radius: 9px; border: 1px solid rgba(16,185,129,.2);
    background: rgba(16,185,129,.05); cursor: pointer; transition: all .16s;
    flex: 1; min-width: 0;
  }
  .lex-vault-save-card:hover { background: rgba(16,185,129,.1); border-color: rgba(16,185,129,.35); transform: translateY(-1px); }
  .lex-vault-save-info { flex: 1; min-width: 0; }
  .lex-vault-save-name { font-size: 12.5px; font-weight: 600; color: #DDE6F0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lex-vault-save-path { font-size: 11px; color: #475569; margin-top: 2px; }
  .lex-vault-save-arrow { font-size: 11px; font-weight: 600; color: #10B981; white-space: nowrap; padding: 4px 10px; border: 1px solid rgba(16,185,129,.25); border-radius: 5px; background: rgba(16,185,129,.06); flex-shrink: 0; transition: all .12s; }
  .lex-vault-save-card:hover .lex-vault-save-arrow { background: rgba(16,185,129,.16); border-color: rgba(16,185,129,.4); }
`;

// ═══════════════════════════════════════════════════════
//  SMART NAMING HELPER
// ═══════════════════════════════════════════════════════
const DOC_TYPE_ABBREV = {
  'nda': 'NDA', 'non-disclosure': 'NDA',
  'bail': 'Bail', 'bail application': 'Bail',
  'writ petition': 'Writ', 'writ': 'Writ',
  'special leave petition': 'SLP', 'slp': 'SLP',
  'legal notice': 'Notice', 'notice': 'Notice',
  'affidavit': 'Affidavit',
  'vakalatnama': 'Vakalatnama',
  'fir': 'FIR', 'first information report': 'FIR',
  'agreement': 'Agr', 'contract': 'Contract',
  'employment agreement': 'EA',
  'petition': 'Petition',
  'plaint': 'Plaint',
  'reply': 'Reply',
  'other': 'Doc',
};

const generateSmartName = (doc_type, sessionTitle) => {
  const rawType = (doc_type || '').toLowerCase().trim();
  let abbrev = DOC_TYPE_ABBREV[rawType];
  if (!abbrev) {
    const key = Object.keys(DOC_TYPE_ABBREV).find(k => rawType.startsWith(k));
    abbrev = key ? DOC_TYPE_ABBREV[key] : (doc_type ? doc_type.split(' ')[0].slice(0, 8) : 'Doc');
  }

  let slug = '';
  const cleanTitle = (sessionTitle || '').replace(/^new conversation$/i, '').trim();
  if (cleanTitle) {
    slug = cleanTitle
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .split(' ')
      .filter(w => w.length > 2)
      .slice(0, 2)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
  }

  // Date-time stamp ensures every generated document has a unique name
  const now = new Date();
  const day = now.getDate();
  const mon = now.toLocaleString('en-IN', { month: 'short' });
  const hhmm = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const stamp = `${day}${mon}_${hhmm}`;

  const parts = [abbrev, slug, stamp].filter(Boolean);
  return parts.join('_');
};

// ═══════════════════════════════════════════════════════
//  SAVE TO VAULT MODAL
// ═══════════════════════════════════════════════════════
const LAST_FOLDER_KEY = 'lexai_last_vault_folder'; // { id, path }


// ═══════════════════════════════════════════════════════
//  RICH TEXT EDITOR TOOLBAR
//  onMouseDown + e.preventDefault() is the critical pattern:
//  it prevents the button from stealing focus/selection from
//  the contentEditable editor, so execCommand sees the right range.
// ═══════════════════════════════════════════════════════
function RichTextToolbar({ targetRef }) {
  const exec = (cmd, value = null) => {
    targetRef.current?.focus();
    document.execCommand(cmd, false, value);
  };

  const BoldIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>
    </svg>
  );
  const ItalicIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>
    </svg>
  );
  const UnderlineIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/>
    </svg>
  );
  const StrikeIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="4" y1="12" x2="20" y2="12"/>
      <path d="M8 8c0-2.2 1.8-4 4-4s4 1.8 4 4c0 1.1-.4 2-1 2.7"/>
      <path d="M8 16c0 2.2 1.8 4 4 4s4-1.8 4-4"/>
    </svg>
  );
  const OLIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/>
      <text x="2" y="7" fontSize="6" fill="currentColor" stroke="none" fontWeight="700">1.</text>
      <text x="2" y="13" fontSize="6" fill="currentColor" stroke="none" fontWeight="700">2.</text>
      <text x="2" y="19" fontSize="6" fill="currentColor" stroke="none" fontWeight="700">3.</text>
    </svg>
  );
  const ULIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/>
      <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/>
    </svg>
  );
  const ClearIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.375-9.375z"/>
      <line x1="6" y1="20" x2="10" y2="16" strokeWidth="2.5" stroke="#F87171"/>
    </svg>
  );

  return (
    <div className="lex-rte-toolbar" onMouseDown={e => e.preventDefault()}>
      <div className="lex-rte-group">
        <button className="lex-rte-btn" title="Bold (Ctrl+B)" onMouseDown={() => exec('bold')}>
          <BoldIcon />
        </button>
        <button className="lex-rte-btn" title="Italic (Ctrl+I)" onMouseDown={() => exec('italic')}>
          <ItalicIcon />
        </button>
        <button className="lex-rte-btn" title="Underline (Ctrl+U)" onMouseDown={() => exec('underline')}>
          <UnderlineIcon />
        </button>
        <button className="lex-rte-btn" title="Strikethrough" onMouseDown={() => exec('strikeThrough')}>
          <StrikeIcon />
        </button>
      </div>

      <div className="lex-rte-sep" />

      <div className="lex-rte-group">
        <button className="lex-rte-btn" title="Numbered list" onMouseDown={() => exec('insertOrderedList')}>
          <OLIcon />
        </button>
        <button className="lex-rte-btn" title="Bullet list" onMouseDown={() => exec('insertUnorderedList')}>
          <ULIcon />
        </button>
      </div>

      <div className="lex-rte-sep" />

      <div className="lex-rte-group">
        <button className="lex-rte-btn" title="Clear formatting" onMouseDown={() => exec('removeFormat')}
          style={{ color: '#64748B' }}
        >
          <ClearIcon />
        </button>
      </div>
    </div>
  );
}

const VAULT_TAG_OPTIONS = ['Draft', 'Client Review', 'Final', 'Approved', 'Privileged', 'Court Filing'];

const FORMAT_OPTIONS = [
  { value: 'native', label: 'LexAmplify Native (HTML/Text)' },
  { value: 'pdf',    label: 'PDF Document (.pdf)' },
  { value: 'docx',   label: 'Word Document (.docx)' },
];

function SaveToVaultModal({ draft, sessionTitle, apiBase, onConfirm, onClose }) {
  const [flatFolders,    setFlatFolders]   = useState([]);
  const [flatDocs,       setFlatDocs]      = useState([]);   // lightweight meta — no content
  // navStack drives the drill-down breadcrumb — each entry is { id, name }; null id = root
  const [navStack,       setNavStack]      = useState([{ id: null, name: 'Root (Case Vault)' }]);
  const [fileName,       setFileName]      = useState('');
  const [isCreating,     setIsCreating]    = useState(false);
  const [newFolderName,  setNewFolderName] = useState('');
  const [newFolderError, setNewFolderError] = useState('');
  const [saving,         setSaving]        = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [selectedTags,   setSelectedTags]  = useState([]);
  const [saveFormat,     setSaveFormat]    = useState('native');
  const newFolderInputRef = useRef(null);

  // Navigation animation state (mirrors VaultView navKey/navDir pattern)
  const [navKey, setNavKey] = useState(0);
  const [navDir, setNavDir] = useState('');
  const [creatingFolderLoading, setCreatingFolderLoading] = useState(false);

  const toggleTag = (tag) =>
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);

  const smartDefault = generateSmartName(draft?.doc_type, sessionTitle);
  const fileNameSeeded = useRef(false);
  useEffect(() => {
    if (!fileNameSeeded.current) {
      setFileName(smartDefault);
      fileNameSeeded.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load folders + document metadata in parallel (no content field)
  useEffect(() => {
    const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
    const hdrs  = token ? { Authorization: `Bearer ${token}` } : {};
    Promise.all([
      fetch(`${apiBase}/api/vault/folders`, { headers: hdrs }),
      fetch(`${apiBase}/api/vault/meta`,    { headers: hdrs }),
    ])
      .then(([fRes, dRes]) => Promise.all([
        fRes.ok ? fRes.json() : null,
        dRes.ok ? dRes.json() : null,
      ]))
      .then(([fData, dData]) => {
        if (fData) setFlatFolders(fData.flat || []);
        if (dData) setFlatDocs(dData.documents || []);
      })
      .catch(() => {})
      .finally(() => setLoadingFolders(false));
  }, [apiBase]);

  // Derived: current view + children visible at this level.
  // isAtRoot uses loose null-check so parent_id null/undefined/0/"" all resolve to root.
  const currentView  = navStack[navStack.length - 1];
  const isAtRoot     = currentView.id == null;   // catches null AND undefined

  const _rootPid = (pid) => pid == null || pid === 0 || pid === '';

  const currentChildren = flatFolders
    .filter(f => isAtRoot ? _rootPid(f.parent_id) : Number(f.parent_id) === Number(currentView.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Documents that live in the current folder — lightweight meta, no content
  const currentDocs = flatDocs
    .filter(d => isAtRoot ? _rootPid(d.folder_id) : Number(d.folder_id) === Number(currentView.id))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));

  const destFolderId = isAtRoot ? null : currentView.id;

  // Per-folder counts for card metadata
  const docCountInFolder = useMemo(() => {
    const m = {};
    flatDocs.forEach(d => { if (d.folder_id != null) m[d.folder_id] = (m[d.folder_id] || 0) + 1; });
    return m;
  }, [flatDocs]);

  const childFolderCount = useMemo(() => {
    const m = {};
    flatFolders.forEach(f => { if (f.parent_id != null) m[f.parent_id] = (m[f.parent_id] || 0) + 1; });
    return m;
  }, [flatFolders]);

  const enterFolder = (folder) => {
    setNavDir('in');
    setNavKey(k => k + 1);
    setNavStack(prev => [...prev, { id: folder.id, name: folder.name }]);
    setIsCreating(false);
    setNewFolderName('');
    setNewFolderError('');
  };

  const navigateTo = (index) => {
    setNavDir('out');
    setNavKey(k => k + 1);
    setNavStack(prev => prev.slice(0, index + 1));
    setIsCreating(false);
    setNewFolderName('');
    setNewFolderError('');
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name || creatingFolderLoading) return;
    setNewFolderError('');
    setCreatingFolderLoading(true);
    const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
    try {
      const res = await fetch(`${apiBase}/api/vault/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify({ name, parent_id: currentView.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setNewFolderError(data.message || 'Could not create folder.'); return; }
      setFlatFolders(prev => [...prev, { id: data.id, name: data.name, parent_id: data.parent_id ?? null }]);
      setNewFolderName('');
      setIsCreating(false);
    } catch { setNewFolderError('Network error. Try again.'); }
    finally { setCreatingFolderLoading(false); }
  };

  // Last-used folder shortcut
  const lastFolder = (() => {
    try { return JSON.parse(localStorage.getItem(LAST_FOLDER_KEY) || 'null'); } catch { return null; }
  })();

  const applyLastFolder = () => {
    if (!lastFolder || !flatFolders.length) return;
    const parts = [];
    let id = lastFolder.id;
    const seen = new Set();
    while (id && !seen.has(id)) {
      seen.add(id);
      const node = flatFolders.find(f => f.id === id);
      if (!node) break;
      parts.unshift({ id: node.id, name: node.name });
      id = node.parent_id;
    }
    setNavStack([{ id: null, name: 'Root (Case Vault)' }, ...parts]);
  };

  // Build path from navStack for display
  const destPath = navStack.map(s => s.name).join(' / ');
  const fullPath = `${destPath} / ${fileName || smartDefault}`;

  const handleConfirm = async () => {
    const finalName = (fileName || smartDefault).trim();
    if (!finalName) return;
    setSaving(true);
    if (destFolderId) {
      try { localStorage.setItem(LAST_FOLDER_KEY, JSON.stringify({ id: destFolderId, path: destPath })); } catch {}
    } else {
      try { localStorage.removeItem(LAST_FOLDER_KEY); } catch {}
    }
    await onConfirm({ fileName: finalName, folderId: destFolderId, folderPath: destPath, smartTitle: finalName, tags: selectedTags, format: saveFormat });
    setSaving(false);
  };

  return (
    <div className="svm-backdrop" onClick={onClose}>
      <div className="svm-panel" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="svm-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="15" height="15" fill="none" stroke="#3B82F6" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span className="svm-title">Save to Case Vault</span>
          </div>
          <button type="button" className="svm-close" onClick={onClose}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="svm-body">

          {/* File name */}
          <div>
            <div className="svm-section-label">File Name</div>
            <input
              className="svm-filename-input"
              value={fileName}
              onChange={e => setFileName(e.target.value)}
              placeholder={smartDefault}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
            />
            <div style={{ fontSize: 10.5, color: '#475569', marginTop: 5 }}>
              Smart default: <span style={{ color: '#7EB3F5' }}>{smartDefault}</span>
            </div>
          </div>

          {/* Save as Type */}
          <div>
            <div className="svm-section-label">Save as Type</div>
            <select className="svm-format-select" value={saveFormat} onChange={e => setSaveFormat(e.target.value)}>
              {FORMAT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Document Tags */}
          <div>
            <div className="svm-section-label">
              Document Tags <span style={{ fontSize: 9, opacity: .55, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
            </div>
            <div className="svm-tags-wrap">
              {VAULT_TAG_OPTIONS.map(tag => (
                <button
                  key={tag}
                  type="button"
                  className={`svm-tag-pill${selectedTags.includes(tag) ? ' active' : ''}`}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Last-used folder shortcut */}
          {lastFolder && (
            <div className="svm-last-folder-hint" onClick={applyLastFolder}>
              <span style={{ fontSize: 13 }}>📌</span>
              <span>Last used: <strong>{lastFolder.path}</strong></span>
              <span style={{ marginLeft: 'auto', fontSize: 10.5, opacity: .7 }}>Click to select →</span>
            </div>
          )}

          {/* Explorer-style folder navigator */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="svm-section-label" style={{ marginBottom: 0 }}>Destination Folder</span>
              <button
                type="button"
                onClick={() => { setIsCreating(v => !v); setTimeout(() => newFolderInputRef.current?.focus(), 60); }}
                style={{ background: 'none', border: '1px solid rgba(59,130,246,.25)', borderRadius: 5, color: '#7EB3F5', fontSize: 11, padding: '2px 9px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
              >
                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                New Folder
              </button>
            </div>

            {/* Breadcrumb trail */}
            <div className="svm-breadcrumb">
              {navStack.map((crumb, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="svm-breadcrumb-sep">/</span>}
                  <button
                    type="button"
                    className={`svm-breadcrumb-item${idx === navStack.length - 1 ? ' current' : ''}`}
                    onClick={() => navigateTo(idx)}
                  >
                    {idx === 0 ? (
                      <>
                        <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                          <polyline points="9 22 9 12 15 12 15 22"/>
                        </svg>
                        Root
                      </>
                    ) : crumb.name}
                    {idx === navStack.length - 1 && !loadingFolders && (currentChildren.length + currentDocs.length) > 0 && (
                      <span className="svm-crumb-count">{currentChildren.length + currentDocs.length}</span>
                    )}
                  </button>
                </React.Fragment>
              ))}
            </div>

            {/* Mini-Vault directory browser — card grid + drill animations */}
            <div className="svm-tree" style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 2 }}>
              {loadingFolders ? (
                <div style={{ padding: '16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 12, color: '#334155' }}>
                  <div style={{ width: 13, height: 13, border: '2px solid rgba(59,130,246,.2)', borderTopColor: '#3B82F6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  Loading vault…
                </div>
              ) : (
                <div
                  key={navKey}
                  className={navDir === 'in' ? 'svm-nav-in' : navDir === 'out' ? 'svm-nav-out' : ''}
                >
                  {currentChildren.length === 0 && currentDocs.length === 0 ? (
                    <div className="svm-vault-empty">
                      {isAtRoot
                        ? <>📂 Vault is empty — create a folder or save directly at root</>
                        : <>📁 This folder is empty — save here or add a sub-folder</>}
                    </div>
                  ) : (
                    <>
                      {/* ── Folder card grid ── */}
                      {currentChildren.length > 0 && (
                        <div style={{ marginBottom: currentDocs.length > 0 ? 12 : 0 }}>
                          {currentDocs.length > 0 && (
                            <div className="svm-grid-section-label">Folders</div>
                          )}
                          <div className="svm-folder-grid">
                            {currentChildren.map(folder => {
                              const docs  = docCountInFolder[folder.id]  || 0;
                              const subs  = childFolderCount[folder.id]  || 0;
                              const meta  = [
                                docs  > 0 ? `${docs} doc${docs !== 1 ? 's' : ''}`   : null,
                                subs  > 0 ? `${subs} folder${subs !== 1 ? 's' : ''}` : null,
                              ].filter(Boolean).join(' · ');
                              return (
                                <div
                                  key={folder.id}
                                  className="svm-folder-card"
                                  onClick={() => enterFolder(folder)}
                                >
                                  <span className="svm-folder-card-icon">📁</span>
                                  <div className="svm-folder-card-info">
                                    <div className="svm-folder-card-name">{folder.name}</div>
                                    {meta && <div className="svm-folder-card-meta">{meta}</div>}
                                  </div>
                                  <svg className="svm-folder-card-chevron" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                    <polyline points="9 18 15 12 9 6"/>
                                  </svg>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {/* ── Existing documents (reference context only) ── */}
                      {currentDocs.length > 0 && (
                        <div>
                          <div className="svm-grid-section-label">
                            {currentChildren.length > 0 ? 'Existing Documents' : 'Documents'}
                          </div>
                          <div className="svm-explorer">
                            {currentDocs.map(doc => (
                              <div key={doc.id} className="svm-explorer-doc" title={doc.title}>
                                <span style={{ fontSize: 13, flexShrink: 0, opacity: .6 }}>
                                  {doc.file_format === 'pdf' ? '📋' : doc.file_format === 'docx' ? '📝' : '📄'}
                                </span>
                                <span className="svm-explorer-doc-name">{doc.title}</span>
                                {doc.doc_type && (
                                  <span className="svm-explorer-doc-type">{doc.doc_type}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Inline new-folder creator */}
            {isCreating && (
              <div className="svm-new-folder-row" style={{ marginTop: 8 }}>
                {creatingFolderLoading ? (
                  <div style={{ width: 12, height: 12, border: '2px solid rgba(59,130,246,.2)', borderTopColor: '#3B82F6', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                ) : (
                  <svg width="12" height="12" fill="none" stroke="#3B82F6" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                )}
                <input
                  ref={newFolderInputRef}
                  className="svm-new-folder-input"
                  placeholder={navStack.length > 1 ? `New folder inside "${currentView.name}"…` : 'New root folder name…'}
                  value={newFolderName}
                  onChange={e => { setNewFolderName(e.target.value); setNewFolderError(''); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreateFolder();
                    if (e.key === 'Escape') { setIsCreating(false); setNewFolderName(''); }
                  }}
                  disabled={creatingFolderLoading}
                />
                <button
                  type="button"
                  onClick={handleCreateFolder}
                  disabled={!newFolderName.trim() || creatingFolderLoading}
                  style={{ background: '#3B82F6', border: 'none', color: '#fff', padding: '3px 10px', borderRadius: 4, fontSize: 11.5, cursor: (!newFolderName.trim() || creatingFolderLoading) ? 'not-allowed' : 'pointer', opacity: (!newFolderName.trim() || creatingFolderLoading) ? .45 : 1, flexShrink: 0 }}
                >
                  {creatingFolderLoading ? '…' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => { setIsCreating(false); setNewFolderName(''); setNewFolderError(''); }}
                  style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 14, padding: '0 3px', flexShrink: 0 }}
                >×</button>
              </div>
            )}
            {newFolderError && (
              <div style={{ fontSize: 11, color: '#F87171', marginTop: 5, paddingLeft: 4 }}>{newFolderError}</div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="svm-footer">
          <div>
            <div className="svm-dest-label">Saving to</div>
            <div className="svm-dest-path" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fullPath}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="svm-btn-ghost" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="svm-btn-primary"
              disabled={saving || !(fileName || smartDefault).trim()}
              onClick={handleConfirm}
            >
              {saving ? 'Saving…' : '💾 Confirm Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  CONVERSATION 3-DOTS MENU
// ═══════════════════════════════════════════════════════
function ConversationMenu({ session, isActive, onPin, onRename, onShare, onDelete, onClose }) {
  const menuRef = useRef(null);
  const [flipUp, setFlipUp] = useState(false);

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 20) setFlipUp(true);
    }
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="lex-ctx-menu"
      style={{
        right: 0,
        ...(flipUp ? { bottom: '100%', marginBottom: 4 } : { top: '100%', marginTop: 4 }),
      }}
    >
      <button className="lex-ctx-item" onClick={onPin}>
        <svg className="lex-ctx-item-icon" fill="none" stroke={session.pinned ? '#F59E0B' : 'currentColor'} strokeWidth="2" viewBox="0 0 24 24">
          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
        </svg>
        {session.pinned ? 'Unpin' : 'Pin to top'}
      </button>
      <button className="lex-ctx-item" onClick={onRename}>
        <svg className="lex-ctx-item-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Rename
      </button>
      <button className="lex-ctx-item" onClick={onShare}>
        <svg className="lex-ctx-item-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        Share
      </button>
      <button className="lex-ctx-item danger" onClick={onDelete}>
        <svg className="lex-ctx-item-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/>
        </svg>
        Delete
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  SHARE MODAL  (stub — no backend email route)
// ═══════════════════════════════════════════════════════
function ShareModal({ sessionTitle, onClose }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = `${window.location.origin}/vault?ref=${encodeURIComponent(sessionTitle.slice(0, 40))}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="svm-backdrop" onClick={onClose}>
      <div className="svm-panel" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="svm-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="15" height="15" fill="none" stroke="#3B82F6" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            <span className="svm-title">Share Conversation</span>
          </div>
          <button className="svm-close" onClick={onClose}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="svm-body" style={{ gap: 12 }}>
          <div style={{ fontSize: 12.5, color: '#94A3B8', lineHeight: 1.6 }}>
            Share this conversation with a colleague. They will need a LexAmplify account to view the full chat.
          </div>
          <div>
            <div className="svm-section-label">Shareable Link</div>
            <div className="svm-share-url">{shareUrl}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="svm-btn-primary"
              style={{ flex: 1, textAlign: 'center' }}
              onClick={handleCopy}
            >
              {copied ? '✓ Copied!' : '📋 Copy Link'}
            </button>
            <button
              className="svm-btn-ghost"
              onClick={() => window.open(`mailto:?subject=LexAmplify%20Session%3A%20${encodeURIComponent(sessionTitle)}&body=I%27ve%20shared%20a%20legal%20session%20with%20you%3A%20${encodeURIComponent(shareUrl)}`, '_blank')}
            >
              📧 Email
            </button>
          </div>
          <div style={{ fontSize: 11, color: '#334155', textAlign: 'center', fontStyle: 'italic' }}>
            Full session collaboration (real-time sync) is available on the Firm plan.
          </div>
        </div>
        <div className="svm-footer" style={{ justifyContent: 'flex-end' }}>
          <button className="svm-btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  CONTEXT-MORPHING ACTIONS — route-specific quick prompts.
//  Decoupled config map (no switch). Keyed by exact pathname; the resolver
//  falls back to longest-prefix match so dynamic routes (/case/:id) inherit.
// ═══════════════════════════════════════════════════════
const CONTEXT_ACTIONS = {
  '/contract-analyzer': [
    { label: 'Draft Clause',      prompt: 'Draft a new clause for the contract currently under review, compliant with Indian law.' },
    { label: 'Run Liability Scan', prompt: 'Run a liability exposure scan on this contract and flag every clause that shifts disproportionate risk onto our client.' },
    { label: 'Summarize Risks',   prompt: 'Summarize the top risks in this contract in order of severity, citing the relevant Indian statutes.' },
  ],
  '/conflict-engine': [
    { label: 'Cross-Reference Parties', prompt: 'Cross-reference all parties across our case roster and surface any representation conflicts.' },
    { label: 'Scan for Conflicts',      prompt: 'Run a full conflict-of-interest scan against the firm database and rank matches by confidence.' },
  ],
  '/calendar': [
    { label: 'Calculate Limitation Expiry', prompt: 'Calculate the limitation expiry date for the active matter under the Limitation Act, 1963, and show the countdown.' },
    { label: 'Upcoming Deadlines',          prompt: 'List all upcoming hearing dates, filing deadlines, and limitation cut-offs for the next 30 days.' },
  ],
  '/court-resources': [
    { label: 'Find Citation',    prompt: 'Find binding Indian precedents relevant to the issue I am researching, with neutral citations.' },
    { label: 'Cause List Lookup', prompt: 'Look up the cause list for the relevant court and identify the listing for our matter.' },
  ],
  '/vault': [
    { label: 'Summarize Case File', prompt: 'Summarize the key facts, issues, and current status of this case file.' },
    { label: 'Find Precedents',     prompt: 'Find Indian precedents that support our position in this matter.' },
  ],
  '/case': [
    { label: 'Summarize Case File', prompt: 'Summarize the key facts, issues, and current status of this case file.' },
    { label: 'Draft Next Filing',   prompt: 'Draft the next procedural filing required for this matter under the CPC.' },
  ],
  '/firm-library': [
    { label: 'Search Templates', prompt: 'Search the firm library for the most relevant precedent template for my current task.' },
  ],
  '/dashboard': [
    { label: 'What Needs Attention', prompt: 'What are the most urgent items across my cases, deadlines, and documents that need my attention today?' },
  ],
};

// Exact match first, then longest-prefix fallback at a segment boundary
// (so /case/123 inherits /case, but /casebook never matches /case).
const resolveContextActions = (pathname) => {
  if (CONTEXT_ACTIONS[pathname]) return CONTEXT_ACTIONS[pathname];
  const prefix = Object.keys(CONTEXT_ACTIONS)
    .filter(k => pathname.startsWith(k + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? CONTEXT_ACTIONS[prefix] : [];
};

// ═══════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════
function CommandPalette() {
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
  const [isAwake,       setIsAwake]       = useState(false);
  const [wakeSupported, setWakeSupported] = useState(null); // null=unknown, true=ok, false=denied/unsupported
  const [sidebarOpen,     setSidebarOpen]     = useState(false); // drawer mode: session history collapsed by default
  const [isClosing,       setIsClosing]       = useState(false); // drives the slide-out exit animation
  const [mode,            setMode]            = useState('drawer'); // 'drawer' | 'fullscreen' (War Room)
  const [drawerOpen,      setDrawerOpen]      = useState(false);
  const [viewingSnapshot, setViewingSnapshot] = useState(null); // { content, title, doc_type }
  const [slashMenu,         setSlashMenu]         = useState(false);
  const [copyToast,         setCopyToast]         = useState(false);
  const [isDrawerExpanded,  setIsDrawerExpanded]  = useState(false);

  // ── File attachment ──────────────────────────────────
  const [attachedFile, setAttachedFile] = useState(null); // { name, content }
  const [fileLoading,  setFileLoading]  = useState(false);

  // ── Save to Vault Modal ───────────────────────────────
  const [showSaveModal, setShowSaveModal] = useState(false);

  // ── Conversation 3-dots menu ──────────────────────────
  const [openMenuId,      setOpenMenuId]      = useState(null);   // session id with open menu
  const [renamingId,      setRenamingId]      = useState(null);   // session being renamed
  const [renameValue,     setRenameValue]     = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);   // session pending deletion
  const [shareSessionId,  setShareSessionId]  = useState(null);   // session showing share modal

  // ── Refs ─────────────────────────────────────────────
  const inputRef       = useRef(null);
  const fileInputRef   = useRef(null);
  const recognitionRef = useRef(null);
  const wakeRecRef     = useRef(null);
  const isAwakeRef     = useRef(false);
  const wakeActiveRef  = useRef(false);
  const isOpenRef      = useRef(false);
  const isListeningRef = useRef(false);   // mirrors isListening for SR callbacks (avoids stale closures)
  const searchRef      = useRef(null);
  const messagesEndRef = useRef(null);
  const msgRefs        = useRef({});
  const drawerBodyRef  = useRef(null);   // contentEditable doc editor
  const lastDocKeyRef  = useRef(null);   // guards against overwriting user edits on re-render

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

  const deleteSession = useCallback((id) => {
    mutateSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (id === currentId) {
        if (next.length > 0) {
          const nextActive = next.find(s => s.pinned) || next[0];
          setCurrentId(nextActive.id);
          localStorage.setItem(CURRENT_KEY, nextActive.id);
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

  const pinSession = useCallback((id) => {
    mutateSessions(prev =>
      prev.map(s => s.id === id ? { ...s, pinned: !s.pinned } : s)
    );
  }, [mutateSessions]);

  const renameSession = useCallback((id, newTitle) => {
    if (!newTitle.trim()) return;
    mutateSessions(prev =>
      prev.map(s => s.id === id ? { ...s, title: newTitle.trim() } : s)
    );
  }, [mutateSessions]);

  // Bootstrap: always have a session
  useEffect(() => {
    if (sessions.length === 0 || !sessions.find(s => s.id === currentId)) {
      startNew();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Drawer body: set innerHTML ONLY when the source document changes, never on arbitrary re-renders.
  // This prevents React from wiping user's in-progress edits (the contentEditable + dangerouslySetInnerHTML
  // anti-pattern — any state update resets the DOM and erases what the lawyer typed).
  useEffect(() => {
    const doc = viewingSnapshot || activeDocument;
    if (!drawerBodyRef.current) return;
    const key = doc ? `${doc.title}::${(doc.content || '').length}` : '__empty__';
    if (key === lastDocKeyRef.current) return; // same doc version — don't clobber edits
    lastDocKeyRef.current = key;
    drawerBodyRef.current.innerHTML = doc
      ? highlightPlaceholders(renderDraftHtml(doc.content))
      : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingSnapshot, activeDocument]);

  // ── Keyboard / toggle ────────────────────────────────
  useEffect(() => {
    // Payload-aware: a dispatched { detail: { mode } } opens in that mode;
    // a bare event (legacy) simply toggles open/closed.
    const onToggle = (e) => {
      const m = e?.detail?.mode;
      if (m) { setMode(m); setIsOpen(true); }
      else   { setIsOpen(v => !v); }
    };
    const onKey = (e) => {
      // Ctrl+K is owned by IntelligencePalette — chat opens via toggle-rag-palette event only
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

  // Keep refs current for SR callbacks (no dep array = runs every render)
  useEffect(() => {
    searchRef.current = handleSearch;
    isOpenRef.current = isOpen;
    isListeningRef.current = isListening;
  });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, loading, pendingSchedule, pendingDraft]);

  // ── Command speech recognition (en-IN, pause-tolerant capture) ─────────
  // continuous + interim with a settle debounce: finals accumulate and submit
  // only ~1.1s after speech stops, so natural pauses no longer truncate a
  // command. Locale is pinned to en-IN to stabilise Indian-English phonetics
  // and cut processing latency.
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-IN';

    let finalBuffer = '';
    let settleTimer = null;
    const clearSettle = () => { if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; } };

    rec.onstart = () => { finalBuffer = ''; setIsListening(true); setMicError(null); };

    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalBuffer += t;
        else                       interim += t;
      }
      setQuery((finalBuffer + interim).trim());
      // Re-arm the submit debounce on every token; fire only once speech settles.
      clearSettle();
      if (finalBuffer.trim()) {
        settleTimer = setTimeout(() => { try { rec.stop(); } catch (_) {} }, 1100);
      }
    };

    rec.onerror = (ev) => {
      clearSettle();
      setMicError(ev.error === 'not-allowed' ? 'Mic access denied' : 'Mic error');
      setIsListening(false);
      setTimeout(() => setMicError(null), 3000);
    };

    rec.onend = () => {
      clearSettle();
      setIsListening(false);
      if (isAwakeRef.current) { isAwakeRef.current = false; setIsAwake(false); }
      const toSubmit = finalBuffer.trim();
      finalBuffer = '';
      if (toSubmit) searchRef.current?.(null, toSubmit);
    };

    recognitionRef.current = rec;
    return () => { clearSettle(); try { rec.abort(); } catch (_) {} };
  }, []);

  const toggleMic = () => {
    if (!recognitionRef.current) return alert('Speech recognition not supported in this browser.');
    isListening ? recognitionRef.current.stop() : recognitionRef.current.start();
  };

  // ── Background "Hey InzIQ" wake word listener ─────────
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setWakeSupported(false); return; }

    let dead = false;
    // Matches variations browsers transcribe for "hey inziq":
    //   "hey inziq", "hey inzig", "hey inzick", "in z i q", "a inziq", etc.
    // Phonetic fallbacks — Web Speech API frequently mishears "InzIQ".
    // Match against a normalized (lowercased, whitespace-collapsed) transcript.
    const WAKE_PHRASES = ['hey inziq', 'hey inzik', 'hey in z i q', 'inziq', 'in zik', 'hey insight', 'hey in sync'];

    const wakeRec = new SR();
    wakeRec.continuous = true;
    wakeRec.interimResults = false; // final only — avoids false positives from partial audio
    wakeRec.lang = 'en-IN';

    // Global daemon: restart is gated only by our own live command mic /
    // awake state (single SR instance at a time) — never by panel visibility.
    const tryRestart = () => {
      if (dead || isAwakeRef.current || isListeningRef.current || wakeActiveRef.current) return;
      setTimeout(() => {
        if (dead || isAwakeRef.current || isListeningRef.current || wakeActiveRef.current) return;
        try { wakeRec.start(); wakeActiveRef.current = true; } catch (_) {}
      }, 400);
    };

    wakeRec.onstart = () => setWakeSupported(true);

    wakeRec.onresult = (ev) => {
      if (isAwakeRef.current) return;
      let text = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript;
      }
      const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!WAKE_PHRASES.some(p => normalized.includes(p))) return;
      // Wake word detected — surface the InzIQ command view (works from any
      // route, panel open or closed) and hand off to the command mic.
      isAwakeRef.current = true;
      setIsAwake(true);
      setIsOpen(true);
      wakeActiveRef.current = false;
      try { wakeRec.stop(); } catch (_) {}
      // Chrome needs ~250ms to release mic before a new SR instance can start
      setTimeout(() => {
        if (dead || !recognitionRef.current) return;
        try { recognitionRef.current.start(); } catch (_) {}
      }, 280);
    };

    wakeRec.onerror = (ev) => {
      wakeActiveRef.current = false;
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        dead = true;
        setWakeSupported(false);
        return;
      }
      // Transient errors (network, audio-capture) — onend fires and calls tryRestart
    };

    wakeRec.onend = () => {
      wakeActiveRef.current = false;
      tryRestart();
    };

    wakeRecRef.current = wakeRec;
    return () => {
      dead = true;
      wakeActiveRef.current = false;
      try { wakeRec.abort(); } catch (_) {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Global wake daemon: runs on any authenticated app route (not the public
  // landing/login pages, and never while the command mic is already live).
  // Boots silently on mount; pauses only for our own single-SR-instance rule.
  useEffect(() => {
    if (!wakeRecRef.current || wakeSupported === false) return;
    const authed = !!(localStorage.getItem('token') || localStorage.getItem('lexai_token'));
    const isPublic = location.pathname === '/' || location.pathname === '/login';
    const shouldRun = authed && !isPublic && !isListening && !isAwake;
    if (shouldRun && !wakeActiveRef.current) {
      try { wakeRecRef.current.start(); wakeActiveRef.current = true; } catch (_) {}
    } else if (!shouldRun && wakeActiveRef.current) {
      try { wakeRecRef.current.stop(); } catch (_) {}
      wakeActiveRef.current = false;
    }
  }, [location.pathname, isListening, isAwake, wakeSupported]);

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

    // Freeze both file pieces before setAttachedFile(null) clears state.
    // State updates are async — the closure holds stale values after the setter runs.
    const capturedFileContent = attachedFile?.content ?? null;
    const capturedFileName    = attachedFile?.name    ?? null;

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

      // 401 = missing token; 422 = Flask-JWT-Extended rejecting a malformed/
      // expired token on this @jwt_required() route. Both mean "re-authenticate"
      // — not a payload defect (voice and manual submit share this exact body).
      if (res.status === 401 || res.status === 422) {
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

      // ── Dual-mode: JSON action (tool-call route) vs SSE text stream ──
      // The backend returns application/json when the LLM fires a tool call
      // (trigger_virtual_courtroom / trigger_contract_analyzer).
      // In that case we navigate immediately — no chat bubble is rendered.
      // All other responses are text/event-stream and fall through untouched.
      const contentType = res.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        try {
          const actionPayload = await res.json();
          if (actionPayload.is_action && actionPayload.intent === 'ROUTE') {
            // Force-inject the file content from the attached file state.
            // Never trust the LLM to echo file content back — use what we captured.
            const finalContent = capturedFileContent
              || actionPayload.data?.file_content
              || actionPayload.data?.content
              || '';

            // Reference priority:
            //   1. LLM-returned document_reference (now required, but small models still skip it)
            //   2. Attached filename (reliable when a file was uploaded)
            //   3. Regex-extract the document keyword from the user's own words
            //   4. First 60 chars of query as last resort
            const finalRef = actionPayload.data?.document_reference
              || capturedFileName
              || (() => {
                   const m = q.match(/\bthe\s+(\w+(?:\s+\w+){0,2})\s+(?:draft|document|case|file)\b/i)
                          || q.match(/pull(?:ing)?\s+(?:the\s+)?(\w+(?:\s+\w+){0,2})\s+(?:draft|from|and)/i)
                          || q.match(/(?:simulate|courtroom|war.?room)\s+(?:for\s+)?(?:the\s+)?(\w+(?:\s+\w+){0,2})/i);
                   return m ? m[1].trim() : q.slice(0, 60).trim();
                 })();

            // ── Contextual same-route execution ──────────────────────
            // If the tool target IS the page we're already on, don't re-navigate
            // (a remount would wipe in-progress work). Hand the payload to the
            // live page via a global command event so it runs its local action.
            if (actionPayload.destination === location.pathname) {
              window.dispatchEvent(new CustomEvent('inziq-page-command', {
                detail: {
                  destination: actionPayload.destination,
                  data: { ...actionPayload.data, document_reference: finalRef, file_content: finalContent },
                },
              }));
              setLoading(false);
              setIsOpen(false);
              return;
            }

            setLoading(false);
            setNavRoute(actionPayload.destination);
            setTimeout(() => {
              navigate(actionPayload.destination, {
                state: {
                  documentData: {
                    ...actionPayload.data,
                    document_reference: finalRef,
                    file_content: finalContent,
                  },
                },
              });
              setNavRoute(null);
              setIsOpen(false);
            }, 900);
            return;
          }
        } catch (_) { /* non-action JSON — fall through */ }
      }
      // ─────────────────────────────────────────────────────────────────

      // SSE stream — push placeholder bubble then consume token events
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
                text: `✏️ Draft updated${p.change_summary ? ' — ' + p.change_summary : ''}.`,
                docCard: {
                  title: p.title || 'Updated Document',
                  doc_type: 'Draft Edit',
                  snapshot: p.updated_content,
                  ts: Date.now(),
                  isUpdate: true,
                },
              }));
              setViewingSnapshot(null);
              setDrawerOpen(true);
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
              const sess = sessions.find(s => s.id === sid);
              const sessTitle = sess?.title || '';
              const smart = generateSmartName(p.draft.doc_type, sessTitle);
              const enrichedDraft = { ...p.draft, smartTitle: smart };
              updateSession(sid, s => ({ ...s, pendingDraft: enrichedDraft, activeDocument: enrichedDraft }));
              patchMessage(sid, msgId, m => ({
                ...m,
                text: 'Document drafted. Review and edit it in the draft panel →',
                docCard: {
                  title: smart,
                  doc_type: p.draft.doc_type,
                  snapshot: p.draft.content,
                  ts: Date.now(),
                  isUpdate: false,
                },
              }));
              setViewingSnapshot(null);
              setDrawerOpen(true);
              continue;
            }

            if (p.metadata)           { patchMessage(sid, msgId, m => ({ ...m, sources: p.metadata.sources })); }
            if (p.token)              { accText += p.token; patchMessage(sid, msgId, m => ({ ...m, text: accText })); }
            if (p.suggested_actions)  { patchMessage(sid, msgId, m => ({ ...m, suggestedActions: p.suggested_actions })); }
            if (p.error)              { patchMessage(sid, msgId, m => ({ ...m, text: accText + '\n\n[Error: ' + p.error + ']' })); }
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

  // ── Approve draft — opens SaveToVaultModal ───────────
  function handleApproveDraft() {
    if (!activeDocument || !currentId) return;
    setShowSaveModal(true);
  }

  // ── Called by SaveToVaultModal on Confirm ────────────
  async function handleSaveModalConfirm({ fileName, folderId, folderPath, smartTitle, tags, format }) {
    if (!activeDocument || !currentId) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');

      // Build compact audit snapshot from current session (user+assistant turns only)
      const currentSess = sessions.find(s => s.id === currentId);
      const sessionTitleForAudit = currentSess?.title || 'Untitled Conversation';
      const auditMsgs = (currentSess?.messages || [])
        .filter(m => (m.role === 'user' || m.role === 'assistant') && m.text)
        .map(m => ({ role: m.role, text: (m.text || '').slice(0, 3000), ts: m._ts || Date.now() }));

      const r = await fetch(`${API_BASE}/api/vault/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify({
          case_id:        activeDocument.case_id || 'GENERAL',
          title:          fileName,
          doc_type:       activeDocument.doc_type || '',
          content:        activeDocument.content,
          folder_id:      folderId,
          smart_title:    smartTitle,
          tags:           JSON.stringify(tags || []),
          format:         format || 'native',
          session_title:  sessionTitleForAudit,
          audit_messages: JSON.stringify(auditMsgs),
        }),
      });
      const data = r.ok ? await r.json() : null;
      const displayPath = data?.location || (folderPath ? `${folderPath} / ${fileName}` : fileName);

      if (r.ok) {
        // Clear draft + patch the most recent docCard in history as saved (with folderId for deep-link)
        updateSession(currentId, s => {
          const msgs = s.messages || [];
          let lastDocIdx = -1;
          msgs.forEach((m, i) => { if (m.docCard) lastDocIdx = i; });
          const patched = lastDocIdx >= 0
            ? msgs.map((m, i) => i === lastDocIdx
                ? { ...m, docCard: { ...m.docCard, saved: true, savedPath: displayPath, savedDocId: data?.id, savedFolderId: folderId } }
                : m)
            : msgs;
          return { ...s, pendingDraft: null, activeDocument: null, messages: patched };
        });
        pushMessage(currentId, {
          id: `sys_${Date.now()}`,
          role: 'vault_save',
          vaultSave: {
            docId:      data?.id,
            docTitle:   fileName,
            docType:    activeDocument.doc_type || '',
            folderId,
            folderPath,
            displayPath,
            tags:       tags || [],
          },
        });
      } else {
        updateSession(currentId, s => ({ ...s, pendingDraft: null, activeDocument: null }));
        pushMessage(currentId, { id: `e_${Date.now()}`, role: 'error', text: 'Failed to save document. Please try again.' });
      }

      setDrawerOpen(false);
      setShowSaveModal(false);
    } catch (_) {
      pushMessage(currentId, { id: `e_${Date.now()}`, role: 'error', text: 'Failed to save to Case Vault.' });
      setShowSaveModal(false);
    } finally { setLoading(false); }
  }

  // ── Draft utility actions ─────────────────────────────
  const handleCopyDraft = () => {
    const doc = viewingSnapshot || activeDocument;
    if (!doc) return;
    navigator.clipboard.writeText(doc.content).then(() => {
      setCopyToast(true);
      setTimeout(() => setCopyToast(false), 1800);
    });
  };

  const handleExportDraft = () => {
    const doc = viewingSnapshot || activeDocument;
    if (!doc) return;
    const blob = new Blob([doc.content], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = doc.title.replace(/\s+/g, '_') + '.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Close  (does NOT wipe messages) ─────────────────
  const handleClose = () => {
    if (isClosing) return; // guard against double-fire during the exit animation
    if (isListening) try { recognitionRef.current?.stop(); } catch (_) {}
    // Immediately update isOpenRef so the wake tryRestart loop sees the panel is closed
    isOpenRef.current = false;
    if (isAwakeRef.current) { isAwakeRef.current = false; setIsAwake(false); }
    // Play the slide-out exit animation, then unmount
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      setIsOpen(false);
      setSidebarOpen(false); // reset history overlay for next open
      setQuery('');
      // Session state is fully preserved — conversation continues on reopen
    }, 280);
  };

  // ── Render ────────────────────────────────────────────
  // When closed, surface a persistent global FAB (hidden on public/login routes)
  if (!isOpen) {
    const authed = !!(localStorage.getItem('token') || localStorage.getItem('lexai_token'));
    const isPublic = location.pathname === '/' || location.pathname === '/login';
    if (!authed || isPublic) return null;
    return (
      <button
        className="inziq-fab"
        onClick={() => window.dispatchEvent(new CustomEvent('toggle-rag-palette', { detail: { mode: 'drawer' } }))}
        title='Ask InzIQ (or say "Hey InzIQ")'
        aria-label="Open InzIQ assistant"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M12 7.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="currentColor" stroke="none" />
        </svg>
      </button>
    );
  }
  const isLocked = loading || !!navRoute;

  // Group sessions for sidebar
  const now = Date.now();
  const pinnedSess    = sessions.filter(s => s.pinned);
  const unpinned      = sessions.filter(s => !s.pinned);
  const todaySess     = unpinned.filter(s => now - s.updatedAt < 86400000);
  const yesterdaySess = unpinned.filter(s => now - s.updatedAt >= 86400000 && now - s.updatedAt < 172800000);
  const olderSess     = unpinned.filter(s => now - s.updatedAt >= 172800000);

  // Sidebar session row renderer (with 3-dots menu + nested document tree)
  const SessionRow = ({ s }) => {
    const isActive      = s.id === currentId;
    const docHistory    = isActive ? (s.messages || []).filter(m => m.docCard) : [];
    const activeDrafts  = docHistory.filter(m => !m.docCard.saved);
    const vaultAssets   = docHistory.filter(m => m.docCard.saved);
    const isRenaming = renamingId === s.id;
    const isConfirmDelete = deleteConfirmId === s.id;
    const menuIsOpen = openMenuId === s.id;

    return (
      <div
        className={`lex-sess-item ${isActive ? 'active' : ''}`}
        style={{ position: 'relative' }}
        onClick={() => { if (!isRenaming) selectSession(s.id); }}
      >
        {/* Delete confirmation overlay */}
        {isConfirmDelete && (
          <div className="lex-confirm-delete" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 11.5, color: '#F87171', textAlign: 'center', lineHeight: 1.5 }}>
              Delete "<strong>{truncate(s.title, 30)}</strong>"?<br/>
              <span style={{ color: '#64748B', fontWeight: 400 }}>This cannot be undone.</span>
            </div>
            <div style={{ display: 'flex', gap: 7 }}>
              <button
                onClick={e => { e.stopPropagation(); setDeleteConfirmId(null); }}
                style={{ padding: '5px 13px', background: 'transparent', border: '1px solid #1A2030', borderRadius: 5, color: '#64748B', fontSize: 11, cursor: 'pointer' }}
              >Cancel</button>
              <button
                onClick={e => { e.stopPropagation(); deleteSession(s.id); setDeleteConfirmId(null); }}
                style={{ padding: '5px 13px', background: '#EF4444', border: 'none', borderRadius: 5, color: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
              >Delete</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Pinned badge */}
            {s.pinned && (
              <span className="lex-pinned-badge" style={{ display: 'inline-block', marginBottom: 3 }}>Pinned</span>
            )}

            {isRenaming ? (
              <input
                className="lex-rename-input"
                autoFocus
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => {
                  if (e.key === 'Enter') { renameSession(s.id, renameValue); setRenamingId(null); }
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                onBlur={() => { renameSession(s.id, renameValue); setRenamingId(null); }}
              />
            ) : (
              <div style={{ fontSize: '12px', fontWeight: isActive ? 600 : 400, color: isActive ? '#93C5FD' : '#9BAFC0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '1.35' }}>
                {s.title}
              </div>
            )}
            <div style={{ fontSize: '10px', color: '#64748B', letterSpacing: '.03em', marginTop: '2px' }}>{relativeDate(s.updatedAt)}</div>
          </div>

          {/* 3-dots trigger */}
          <div style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              className="lex-3dots-btn"
              title="More options"
              onClick={e => {
                e.stopPropagation();
                setOpenMenuId(v => v === s.id ? null : s.id);
              }}
            >
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
              </svg>
            </button>

            {menuIsOpen && (
              <ConversationMenu
                session={s}
                isActive={isActive}
                onClose={() => setOpenMenuId(null)}
                onPin={() => { pinSession(s.id); setOpenMenuId(null); }}
                onRename={() => { setRenamingId(s.id); setRenameValue(s.title); setOpenMenuId(null); }}
                onShare={() => { setShareSessionId(s.id); setOpenMenuId(null); }}
                onDelete={() => { setDeleteConfirmId(s.id); setOpenMenuId(null); }}
              />
            )}
          </div>
        </div>

        {/* Nested document tree — Active Drafts + Vault Assets */}
        {isActive && (activeDrafts.length > 0 || vaultAssets.length > 0) && (
          <div className="lex-doc-tree-wrap">
            {/* Active Drafts section */}
            {activeDrafts.length > 0 && (
              <>
                {vaultAssets.length > 0 && <div className="lex-doc-section-sep">Drafts</div>}
                {activeDrafts.map((m, di) => (
                  <button
                    key={`draft-${di}`}
                    className="lex-doc-tree-item"
                    onClick={e => {
                      e.stopPropagation();
                      const snap = { title: m.docCard.title, content: m.docCard.snapshot, doc_type: m.docCard.doc_type, case_id: s.activeDocument?.case_id || 'GENERAL', smartTitle: m.docCard.title };
                      updateSession(currentId, ss => ({ ...ss, pendingDraft: snap, activeDocument: snap }));
                      setViewingSnapshot(null);
                      setDrawerOpen(true);
                      setTimeout(() => msgRefs.current[m.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
                    }}
                  >
                    <svg width="10" height="10" fill="none" stroke={m.docCard.isUpdate ? '#6366F1' : '#7EB3F5'} strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span className="lex-doc-tree-label">
                      {m.docCard.isUpdate ? '↺ ' : ''}{truncate(m.docCard.title, 26)}
                    </span>
                  </button>
                ))}
              </>
            )}
            {/* Vault Assets section — saved documents, click navigates to vault folder */}
            {vaultAssets.length > 0 && (
              <>
                <div className="lex-doc-section-sep" style={{ marginTop: activeDrafts.length > 0 ? 4 : 0 }}>Vault</div>
                {vaultAssets.map((m, di) => (
                  <button
                    key={`vault-${di}`}
                    className="lex-doc-tree-item lex-saved-asset"
                    onClick={e => {
                      e.stopPropagation();
                      navigate('/vault', { state: { targetFolderId: m.docCard.savedFolderId } });
                    }}
                  >
                    <svg width="10" height="10" fill="none" stroke="#10B981" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                    <span className="lex-doc-tree-label">{truncate(m.docCard.title, 26)}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const SectionLabel = ({ label }) => (
    <div style={{ padding: '8px 6px 3px', fontSize: '9px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      {label}
    </div>
  );

  return (
    <>
      <style>{AGENT_CSS}</style>

      {/* Right-aligned Slide-Over Drawer — NO overlay, NON-blocking:
          the document pane stays fully interactive (text selectable) while open. */}
      <div
        className={`inziq-drawer ${mode === 'fullscreen' ? 'war-room' : ''} ${isClosing ? 'closing' : ''}`}
        style={mode === 'fullscreen'
          ? undefined
          : { width: (drawerOpen && activeDocument && isDrawerExpanded) ? 'min(760px, 96vw)' : 'min(400px, 100vw)' }}
      >

          {/* ══════════════════════════════════
               SESSION-HISTORY SIDEBAR — slides OVER the chat within the drawer
          ══════════════════════════════════ */}
          <aside
            className="lex-sidebar"
            style={{
              position: 'absolute', top: 0, left: 0, height: '100%', width: '255px',
              transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
              transition: 'transform .25s cubic-bezier(.4,0,.2,1)',
              zIndex: 6, background: '#080B14', borderRight: '1px solid #141B28',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: sidebarOpen ? '6px 0 32px rgba(0,0,0,.55)' : 'none',
            }}
          >

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
                  {pinnedSess.length > 0 && (
                    <>
                      <SectionLabel label="Pinned Matters" />
                      {pinnedSess.map(s => <SessionRow key={s.id} s={s} />)}
                    </>
                  )}
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

          {/* Dismiss-history scrim — only within the drawer, closes the history overlay on outside tap */}
          {sidebarOpen && (
            <div
              onClick={() => setSidebarOpen(false)}
              style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(0,0,0,.35)' }}
            />
          )}

          {/* ══════════════════════════════════
               MAIN CHAT AREA
          ══════════════════════════════════ */}
          <main className="lex-chat-main" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#0C1018', overflow: 'hidden' }}>

            {/* Top header bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #141B28', background: '#090C14', flexShrink: 0, gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                {/* Session-history toggle — slides the history overlay over the chat */}
                <button
                  className="lex-sidebar-toggle"
                  onClick={() => setSidebarOpen(v => !v)}
                  title={sidebarOpen ? 'Hide session history' : 'Session history'}
                  style={sidebarOpen ? { background: 'rgba(99,102,241,.18)', borderColor: 'rgba(99,102,241,.4)', color: '#A5B4FC' } : undefined}
                >
                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    {sidebarOpen
                      ? <path d="M18 6L6 18M6 6l12 12"/>
                      : <><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></>
                    }
                  </svg>
                </button>
                <span style={{ fontSize: '10px', color: '#475569', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>Context:</span>
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
              {/* Draft drawer toggle — visible whenever an active document exists */}
              {activeDocument && (
                <button
                  className="lex-view-draft-btn"
                  onClick={() => setDrawerOpen(v => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 11px', background: drawerOpen ? 'rgba(99,102,241,.22)' : 'rgba(99,102,241,.12)', border: `1px solid ${drawerOpen ? 'rgba(99,102,241,.5)' : 'rgba(99,102,241,.3)'}`, borderRadius: '5px', color: '#A5B4FC', fontSize: '11px', cursor: 'pointer', flexShrink: 0, fontWeight: 500 }}
                  title={activeDocument.title}
                >
                  📄 {drawerOpen ? 'Hide Draft' : 'View Draft'}
                </button>
              )}

              {/* War Room → Drawer downshift — preserves conversation state */}
              {mode === 'fullscreen' && (
                <button
                  className="lex-close-btn"
                  onClick={() => setMode('drawer')}
                  title="Collapse to side drawer"
                  style={{ background: 'rgba(99,102,241,.12)', border: '1px solid rgba(99,102,241,.3)', color: '#A5B4FC', borderRadius: '6px', padding: '5px 12px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', transition: 'all .15s', flexShrink: 0 }}
                >
                  <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l-5-5 5-5M5 12h9"/></svg>
                  Collapse
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

              {/* ── Hero layout: centered content + inline input bar ── */}
              {messages.length === 0 && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: 0 }}>
                  <div style={{ maxWidth: '700px', width: '100%' }}>
                    <div style={{ textAlign: 'center', marginBottom: '28px' }}>
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
                            <div style={{ fontSize: '9.5px', color: '#64748B', marginTop: '3px', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>{cmd.category}</div>
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* ── Input bar — hero position (floats directly below shortcut tiles) ── */}
                    <div className="lex-input-bar-hero" style={{ marginTop: '24px' }}>
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
                      <input ref={fileInputRef} type="file" style={{ display: 'none' }} accept=".pdf,.docx,.doc,.txt,.md,.json,.csv,.jpg,.jpeg,.png,.gif,.webp" onChange={handleFileAttach} />
                      <div style={{ position: 'relative' }}>
                        {slashMenu && (() => {
                          const slashFilter = query.slice(1).toLowerCase();
                          const filtered = SLASH_CMDS.filter(c => !slashFilter || c.cmd.includes(slashFilter) || c.label.toLowerCase().includes(slashFilter));
                          return filtered.length > 0 ? (
                            <div className="lex-slash-menu">
                              {filtered.map((c, ci) => (
                                <button key={ci} className="lex-slash-item" onMouseDown={e => { e.preventDefault(); setQuery(c.fill); setSlashMenu(false); setTimeout(() => inputRef.current?.focus(), 10); }}>
                                  <span className="lex-slash-cmd">{c.cmd}</span>
                                  <span className="lex-slash-label">{c.label}</span>
                                </button>
                              ))}
                            </div>
                          ) : null;
                        })()}
                        {/* Context-morphing action chips — route-specific quick prompts (hero/welcome state) */}
                        {(() => {
                          const contextActions = resolveContextActions(location.pathname);
                          if (contextActions.length === 0) return null;
                          return (
                            <div className="lex-ctx-chips" style={{ justifyContent: 'center' }}>
                              {contextActions.map((a, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  className="lex-ctx-chip"
                                  disabled={isLocked}
                                  onClick={() => { setQuery(a.prompt); setTimeout(() => searchRef.current?.(null, a.prompt), 30); }}
                                  title={a.prompt}
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                                  {a.label}
                                </button>
                              ))}
                            </div>
                          );
                        })()}
                        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', background: '#111827', border: `1px solid ${(isAwake || isListening) ? 'rgba(239,68,68,.5)' : attachedFile ? 'rgba(16,185,129,.35)' : 'rgba(255,255,255,.08)'}`, borderRadius: '12px', padding: '10px 12px', transition: 'border-color .2s', boxShadow: '0 4px 24px rgba(0,0,0,.35)' }}>
                          <textarea ref={inputRef} className="lex-textarea" rows={1} value={query} onChange={e => { const val = e.target.value; setQuery(val); setSlashMenu(val.startsWith('/') && !val.includes(' ')); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px'; }} onKeyDown={e => { if (e.key === 'Escape' && slashMenu) { e.preventDefault(); setSlashMenu(false); return; } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch(null); } }} disabled={isLocked} placeholder={(isAwake || isListening) ? '🎤 Listening — speak your command…' : attachedFile ? `Ask something about ${attachedFile.name}…` : 'Command your AI Legal Associate… (Shift+Enter for new line)'} style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: isLocked ? '#2D3D50' : '#C8D8E8', fontSize: '14px', lineHeight: '1.55', overflowY: 'hidden', minHeight: '22px', maxHeight: '130px', cursor: isLocked ? 'not-allowed' : 'text' }} />
                          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isLocked || fileLoading} style={{ background: attachedFile ? 'rgba(16,185,129,.12)' : 'transparent', border: `1px solid ${attachedFile ? 'rgba(16,185,129,.3)' : '#1A2030'}`, color: attachedFile ? '#6EE7B7' : '#3D5168', borderRadius: '7px', padding: '6px 9px', cursor: isLocked ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }} title="Attach file"><svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
                          <button type="button" className={`lex-mic-btn ${isListening ? 'lex-mic-live' : ''} ${wakeSupported === false ? 'lex-mic-denied' : ''}`} onClick={wakeSupported === false ? undefined : toggleMic} style={{ background: 'transparent', border: '1px solid #1A2030', color: isListening ? '#EF4444' : wakeSupported === false ? '#3D5168' : '#3D5168', borderRadius: '7px', padding: '6px 9px', cursor: wakeSupported === false ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s', position: 'relative' }} title={wakeSupported === false ? 'Mic access denied — say "Hey InzIQ" unavailable' : isListening ? 'Stop listening' : 'Voice command · or say "Hey InzIQ"'}><svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>{wakeSupported === false && <line x1="2" y1="2" x2="22" y2="22" stroke="#EF4444" strokeWidth="2.5"/>}</svg>{micError && <div style={{ position: 'absolute', bottom: 'calc(100% + 7px)', right: 0, background: '#EF4444', color: '#fff', padding: '3px 9px', borderRadius: '4px', fontSize: '10.5px', whiteSpace: 'nowrap', zIndex: 10 }}>{micError}</div>}</button>
                          <button type="submit" className={`lex-send-btn${isAwake ? ' lex-send-awake' : ''}`} disabled={isLocked || (!query.trim() && !attachedFile)} style={{ background: (isLocked || (!query.trim() && !attachedFile)) ? 'rgba(59,130,246,.18)' : '#3B82F6', border: 'none', color: '#fff', borderRadius: '7px', padding: '7px 18px', fontSize: '13px', fontWeight: 600, cursor: (isLocked || (!query.trim() && !attachedFile)) ? 'not-allowed' : 'pointer', flexShrink: 0, transition: 'all .15s', opacity: (isLocked || (!query.trim() && !attachedFile)) ? 0.45 : 1 }}>Send</button>
                        </form>
                      </div>
                      <div style={{ marginTop: '6px', fontSize: '10px', color: '#1E2C3D', textAlign: 'center' }}>
                        AI Legal Associate can make mistakes. Always verify critical legal information independently.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Message bubbles */}
              {messages.map((msg, idx) => {
                if (msg.role === 'user') {
                  return (
                    <div key={idx} ref={el => { if (el) msgRefs.current[msg.id] = el; }} className="lex-msg-in" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div style={{ maxWidth: '72%', background: 'rgba(59,130,246,.14)', border: '1px solid rgba(59,130,246,.24)', borderRadius: '12px 12px 2px 12px', padding: '11px 16px', fontSize: '13.5px', color: '#D5E2F0', lineHeight: '1.6', wordBreak: 'break-word' }}>
                        {msg.text}
                      </div>
                    </div>
                  );
                }
                if (msg.role === 'error') {
                  return (
                    <div key={idx} ref={el => { if (el) msgRefs.current[msg.id] = el; }} className="lex-msg-in" style={{ background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.17)', borderLeft: '3px solid #EF4444', borderRadius: '3px 8px 8px 3px', padding: '10px 14px' }}>
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
                // vault_save — interactive clickable card
                if (msg.role === 'vault_save') {
                  const vs = msg.vaultSave || {};
                  return (
                    <div key={idx} ref={el => { if (el) msgRefs.current[msg.id] = el; }} className="lex-msg-in" style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'linear-gradient(135deg,#10B981,#059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px' }}>
                        <svg width="13" height="13" fill="none" stroke="white" strokeWidth="2.8" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                      <div
                        className="lex-vault-save-card"
                        onClick={() => { navigate('/vault', { state: { targetFolderId: vs.folderId, targetFolderPath: vs.folderPath } }); setIsOpen(false); }}
                        title="Open Case Vault"
                        role="button"
                      >
                        <div className="lex-vault-save-info">
                          <div className="lex-vault-save-name">📄 {vs.docTitle || vs.displayPath}</div>
                          <div className="lex-vault-save-path">Saved to: {vs.displayPath || 'Case Vault'}</div>
                          {vs.tags?.length > 0 && (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
                              {vs.tags.map(t => (
                                <span key={t} style={{ fontSize: 10, padding: '1px 7px', background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.22)', borderRadius: 10, color: '#7EB3F5' }}>{t}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="lex-vault-save-arrow">Open in Vault →</span>
                      </div>
                    </div>
                  );
                }
                // assistant
                return (
                  <div key={idx} ref={el => { if (el) msgRefs.current[msg.id] = el; }} className="lex-msg-in" style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'linear-gradient(135deg,#3B82F6,#6366F1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px' }}>
                      <svg width="13" height="13" fill="none" stroke="white" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>
                    </div>
                    <div style={{ flex: 1, background: 'rgba(13,17,28,.8)', border: '1px solid rgba(255,255,255,.06)', borderRadius: '2px 12px 12px 12px', padding: '12px 16px', minWidth: 0, boxShadow: '0 4px 24px rgba(0,0,0,.28)', backdropFilter: 'blur(8px)' }}>
                      {msg.text ? (
                        <>
                          <div
                            className="lex-md"
                            style={{ fontSize: '13.5px', lineHeight: '1.7', color: '#C8D8E8' }}
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
                          />
                          {msg.docCard && (
                            <div className="lex-artifact-card">
                              <div className="lex-artifact-card-header">
                                <svg width="12" height="12" fill="none" stroke={msg.docCard.isUpdate ? '#6366F1' : '#7EB3F5'} strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#C8D8E8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {msg.docCard.isUpdate ? '✏️ ' : '📄 '}{msg.docCard.title}
                                </span>
                                {msg.docCard.doc_type && (
                                  <span style={{ fontSize: '10px', color: '#3D5168', background: 'rgba(255,255,255,.04)', padding: '1px 6px', borderRadius: '3px', flexShrink: 0 }}>
                                    {msg.docCard.doc_type}
                                  </span>
                                )}
                                <button
                                  className="lex-artifact-view-btn"
                                  onClick={() => {
                                    if (msg.docCard.snapshot) {
                                      setViewingSnapshot({ content: msg.docCard.snapshot, title: msg.docCard.title, doc_type: msg.docCard.doc_type });
                                    }
                                    setDrawerOpen(true);
                                  }}
                                >
                                  View Version →
                                </button>
                              </div>
                              {msg.docCard.snapshot && (
                                <div className="lex-artifact-preview">
                                  {msg.docCard.snapshot.replace(/\n/g, ' ').slice(0, 120)}…
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ display: 'flex', gap: '5px', alignItems: 'center', padding: '4px 0' }}>
                          {[1, 2, 3].map(n => (
                            <span key={n} className={`lex-dot-${n}`} style={{ width: '7px', height: '7px', background: '#3B82F6', borderRadius: '50%', display: 'inline-block' }} />
                          ))}
                        </div>
                      )}
                      {msg.sources && msg.sources.length > 0 && (
                        <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,.05)' }}>
                          <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748B', marginBottom: '5px', fontWeight: 600 }}>Sources</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                            {msg.sources.map((src, si) => (
                              <span key={si} style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', padding: '2px 8px', borderRadius: '20px', fontSize: '10px', color: '#64748B', letterSpacing: '.03em' }}>
                                Doc #{src.document_id}{src.chunk_index != null && ` · Chunk ${src.chunk_index}`}
                                {src.similarity != null && ` · ${Math.round(src.similarity * 100)}%`}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Action pills — LLM-generated, shown on last assistant message when not loading */}
                      {idx === messages.length - 1 && msg.suggestedActions?.length > 0 && !loading && (
                        <div className="lex-action-pills">
                          {msg.suggestedActions.map((pill, pi) => (
                            <button
                              key={pi}
                              className="lex-pill"
                              onClick={() => searchRef.current?.(null, pill.query)}
                            >
                              {pill.emoji} {pill.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Loading indicator */}
              {loading && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <div className="lex-ai-breathing" style={{ width: '28px', height: '28px', background: 'linear-gradient(135deg,#3B82F6,#6366F1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="13" height="13" fill="none" stroke="white" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>
                  </div>
                  <div style={{ background: 'rgba(13,17,28,.8)', border: '1px solid rgba(255,255,255,.06)', borderRadius: '2px 12px 12px 12px', padding: '14px 18px', boxShadow: '0 4px 24px rgba(0,0,0,.28)', backdropFilter: 'blur(8px)' }}>
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
                    <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#64748B', letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 600 }}>{pendingSchedule.length} event{pendingSchedule.length !== 1 ? 's' : ''}</span>
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

              <div ref={messagesEndRef} />
            </div>

            {/* ══════════════════════════════════
                 INPUT BAR — docked (active mode)
            ══════════════════════════════════ */}
            {messages.length > 0 && (
            <div className="lex-input-bar-docked" style={{ padding: '12px 20px 16px', borderTop: '1px solid rgba(255,255,255,.05)', background: '#090C14', flexShrink: 0 }}>

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

              <div style={{ position: 'relative' }}>
              {/* ── Slash command popup ── */}
              {slashMenu && (() => {
                const slashFilter = query.slice(1).toLowerCase();
                const filtered = SLASH_CMDS.filter(c =>
                  !slashFilter ||
                  c.cmd.includes(slashFilter) ||
                  c.label.toLowerCase().includes(slashFilter)
                );
                return filtered.length > 0 ? (
                  <div className="lex-slash-menu">
                    {filtered.map((c, ci) => (
                      <button
                        key={ci}
                        className="lex-slash-item"
                        onMouseDown={e => {
                          e.preventDefault(); // prevent textarea blur
                          setQuery(c.fill);
                          setSlashMenu(false);
                          setTimeout(() => inputRef.current?.focus(), 10);
                        }}
                      >
                        <span className="lex-slash-cmd">{c.cmd}</span>
                        <span className="lex-slash-label">{c.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null;
              })()}
              {/* Context-morphing action chips — route-specific quick prompts */}
              {(() => {
                const contextActions = resolveContextActions(location.pathname);
                if (contextActions.length === 0) return null;
                return (
                  <div className="lex-ctx-chips">
                    {contextActions.map((a, i) => (
                      <button
                        key={i}
                        type="button"
                        className="lex-ctx-chip"
                        disabled={isLocked}
                        onClick={() => { setQuery(a.prompt); setTimeout(() => searchRef.current?.(null, a.prompt), 30); }}
                        title={a.prompt}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                        {a.label}
                      </button>
                    ))}
                  </div>
                );
              })()}
              <form
                onSubmit={handleSearch}
                style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', background: '#111827', border: `1px solid ${(isAwake || isListening) ? 'rgba(239,68,68,.5)' : attachedFile ? 'rgba(16,185,129,.35)' : '#1A2030'}`, borderRadius: '10px', padding: '10px 12px', transition: 'border-color .2s' }}
              >
                <textarea
                  ref={inputRef}
                  className="lex-textarea"
                  rows={1}
                  value={query}
                  onChange={e => {
                    const val = e.target.value;
                    setQuery(val);
                    setSlashMenu(val.startsWith('/') && !val.includes(' '));
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px';
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Escape' && slashMenu) { e.preventDefault(); setSlashMenu(false); return; }
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch(null); }
                  }}
                  disabled={isLocked}
                  placeholder={
                    (isAwake || isListening)
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
                  className={`lex-mic-btn ${isListening ? 'lex-mic-live' : ''} ${wakeSupported === false ? 'lex-mic-denied' : ''}`}
                  onClick={wakeSupported === false ? undefined : toggleMic}
                  style={{ background: 'transparent', border: '1px solid #1A2030', color: isListening ? '#EF4444' : '#3D5168', borderRadius: '7px', padding: '6px 9px', cursor: wakeSupported === false ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s', position: 'relative' }}
                  title={wakeSupported === false ? 'Mic access denied — say "Hey InzIQ" unavailable' : isListening ? 'Stop listening' : 'Voice command · or say "Hey InzIQ"'}
                >
                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
                    {wakeSupported === false && <line x1="2" y1="2" x2="22" y2="22" stroke="#EF4444" strokeWidth="2.5"/>}
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
                  className={`lex-send-btn${isAwake ? ' lex-send-awake' : ''}`}
                  disabled={isLocked || (!query.trim() && !attachedFile)}
                  style={{ background: (isLocked || (!query.trim() && !attachedFile)) ? 'rgba(59,130,246,.18)' : '#3B82F6', border: 'none', color: '#fff', borderRadius: '7px', padding: '7px 18px', fontSize: '13px', fontWeight: 600, cursor: (isLocked || (!query.trim() && !attachedFile)) ? 'not-allowed' : 'pointer', flexShrink: 0, transition: 'all .15s', opacity: (isLocked || (!query.trim() && !attachedFile)) ? 0.45 : 1 }}
                >
                  Send
                </button>
              </form>
              </div>{/* end slash-command wrapper */}

              <div style={{ marginTop: '6px', fontSize: '10px', color: '#1E2C3D', textAlign: 'center' }}>
                AI Legal Associate can make mistakes. Always verify critical legal information independently.
              </div>
            </div>
            )}{/* end docked input bar */}
          </main>

          {/* ══════════════════════════════════
               RHS DRAFT DRAWER
          ══════════════════════════════════ */}
          <aside
            className="lex-draft-panel"
            style={{
              position: 'absolute', top: 0, right: 0, height: '100%', width: '100%', zIndex: 7,
              transform: (drawerOpen && activeDocument) ? 'translateX(0)' : 'translateX(100%)',
              transition: 'transform .28s cubic-bezier(.4,0,.2,1)',
              background: '#090C14',
              borderLeft: '1px solid #141B28',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              pointerEvents: (drawerOpen && activeDocument) ? 'auto' : 'none',
            }}
          >
            {activeDocument && (
              <>
                {/* Drawer header with utility buttons */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #141B28', background: '#090C14', flexShrink: 0, gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
                    <svg width="12" height="12" fill="none" stroke={viewingSnapshot ? '#F59E0B' : '#7EB3F5'} strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#DDE6F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {viewingSnapshot ? viewingSnapshot.title : activeDocument.title}
                    </span>
                    {(viewingSnapshot || activeDocument).doc_type && (
                      <span style={{ fontSize: '10px', color: '#3D5168', background: 'rgba(255,255,255,.04)', padding: '1px 6px', borderRadius: '3px', flexShrink: 0 }}>
                        {(viewingSnapshot || activeDocument).doc_type}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0, position: 'relative' }}>
                    {copyToast && <span className="lex-copy-toast">Copied!</span>}
                    <button className="lex-util-btn" title="Copy to clipboard" onClick={handleCopyDraft}>
                      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                    <button className="lex-util-btn" title="Export as .txt" onClick={handleExportDraft}>
                      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                    <button
                      className="lex-util-btn"
                      title={isDrawerExpanded ? 'Exit theater mode' : 'Theater mode — expand'}
                      onClick={() => setIsDrawerExpanded(v => !v)}
                      style={{ color: isDrawerExpanded ? '#A5B4FC' : undefined }}
                    >
                      {isDrawerExpanded
                        ? <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                        : <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                      }
                    </button>
                    <button
                      className="lex-util-btn"
                      onClick={() => { setDrawerOpen(false); setIsDrawerExpanded(false); }}
                      title="Hide drawer (draft stays active)"
                      style={{ fontSize: '15px', padding: '2px 6px' }}
                    >×</button>
                  </div>
                </div>

                {/* Snapshot mode banner */}
                {viewingSnapshot ? (
                  <div className="lex-snapshot-banner">
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <span>Viewing historical version — read only</span>
                    <button
                      onClick={() => setViewingSnapshot(null)}
                      style={{ marginLeft: 'auto', color: '#FCD34D', background: 'none', border: '1px solid rgba(253,211,77,.3)', borderRadius: '3px', padding: '1px 8px', cursor: 'pointer', fontSize: '10.5px', fontFamily: 'inherit' }}
                    >← Return to Current</button>
                  </div>
                ) : (
                  <div style={{ padding: '3px 14px 5px', fontSize: '9px', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,.04)', fontWeight: 600 }}>
                    Edit below · Highlighted fields <span style={{ color: '#FCD34D' }}>[require your input]</span> · Approve to save to vault
                  </div>
                )}

                {/* Formatting toolbar — only shown in edit mode (not viewing snapshot) */}
                {!viewingSnapshot && <RichTextToolbar targetRef={drawerBodyRef} />}

                {/* Document body — Smart Paper with placeholder highlighting.
                    Uses ref-based innerHTML (not dangerouslySetInnerHTML) so React re-renders
                    never wipe the lawyer's in-progress edits to the document. */}
                <div
                  className="lex-drawer-body"
                  ref={drawerBodyRef}
                  contentEditable={!viewingSnapshot}
                  suppressContentEditableWarning
                  onBlur={viewingSnapshot ? undefined : e => {
                    const plain = e.currentTarget.innerText || '';
                    // Update the content fingerprint so the effect doesn't reset innerHTML
                    lastDocKeyRef.current = `${(viewingSnapshot || activeDocument)?.title}::${plain.length}`;
                    updateSession(currentId, s => ({
                      ...s,
                      pendingDraft:   s.pendingDraft   ? { ...s.pendingDraft,   content: plain } : null,
                      activeDocument: s.activeDocument ? { ...s.activeDocument, content: plain } : null,
                    }));
                  }}
                />

                {/* Drawer footer */}
                {!viewingSnapshot && (
                  <div style={{ padding: '10px 14px', borderTop: '1px solid #141B28', display: 'flex', gap: '8px', justifyContent: 'flex-end', flexShrink: 0, background: '#090C14' }}>
                    <button
                      onClick={() => {
                        updateSession(currentId, s => ({ ...s, pendingDraft: null, activeDocument: null }));
                        setViewingSnapshot(null);
                        setDrawerOpen(false);
                      }}
                      style={{ padding: '7px 16px', fontSize: '12px', color: '#506275', background: 'transparent', border: '1px solid #1A2030', borderRadius: '6px', cursor: 'pointer' }}
                    >Reject</button>
                    <button
                      onClick={handleApproveDraft}
                      disabled={loading}
                      style={{ padding: '7px 18px', fontSize: '12px', color: '#fff', background: '#3B82F6', border: 'none', borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: loading ? 0.6 : 1 }}
                    >Approve & Save to Vault</button>
                  </div>
                )}
              </>
            )}
          </aside>

      </div>

      {/* ── Save-to-Vault Modal ──────────────────────── */}
      {showSaveModal && (
        <SaveToVaultModal
          draft={activeDocument}
          sessionTitle={currentSession?.title || ''}
          apiBase={API_BASE}
          onConfirm={handleSaveModalConfirm}
          onClose={() => setShowSaveModal(false)}
        />
      )}

      {/* ── Share Modal ──────────────────────────────── */}
      {shareSessionId && (() => {
        const shareSess = sessions.find(s => s.id === shareSessionId);
        return shareSess ? (
          <ShareModal
            sessionTitle={shareSess.title}
            onClose={() => setShareSessionId(null)}
          />
        ) : null;
      })()}
    </>
  );
}

const IP_CSS = `/* removed */`; // sentinel — keep variable so the file parses during transition
function _IntelligencePalette_REMOVED() { return null; } // placeholder
const __REMOVED_BLOCK_START__ = `
  @keyframes ip-in {
    from { opacity:0; transform:translateY(-16px) scale(0.97); }
    to   { opacity:1; transform:translateY(0)     scale(1);    }
  }
  @keyframes ip-out {
    from { opacity:1; transform:translateY(0)     scale(1);    }
    to   { opacity:0; transform:translateY(-10px) scale(0.98); }
  }
  @keyframes ip-results-in {
    from { opacity:0; transform:translateY(6px); }
    to   { opacity:1; transform:translateY(0);   }
  }

  .ip-overlay {
    position:fixed; inset:0; z-index:9500;
    background:rgba(3,6,18,.78);
    backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
    display:flex; align-items:flex-start; justify-content:center;
    padding-top:12vh;
    animation:ip-in .22s cubic-bezier(0.16,1,0.3,1) both;
  }
  .ip-overlay.ip-closing {
    animation:ip-out .18s cubic-bezier(0.4,0,1,1) forwards;
  }

  .ip-modal {
    width:700px; max-width:94vw;
    background:#0C101C;
    border:1px solid rgba(59,130,246,.18);
    border-radius:16px;
    box-shadow:0 32px 80px rgba(0,0,0,.72),0 0 0 1px rgba(255,255,255,.04),inset 0 1px 0 rgba(255,255,255,.05);
    overflow:hidden;
  }

  /* ── Input row ── */
  .ip-search-row {
    display:flex; align-items:center; gap:14px;
    padding:18px 22px;
    border-bottom:1px solid rgba(255,255,255,.05);
  }
  .ip-search-icon { flex-shrink:0; color:#3B82F6; opacity:.8; }
  .ip-input {
    flex:1; background:transparent; border:none; outline:none;
    font-size:22px; font-weight:400; color:#E2E8F0;
    font-family:inherit; letter-spacing:-.01em;
    caret-color:#3B82F6;
  }
  .ip-input::placeholder { color:#1E2A3A; }
  .ip-kbd {
    flex-shrink:0; font-size:11px; color:#2D3748;
    background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07);
    border-radius:5px; padding:2px 7px; font-family:monospace; letter-spacing:.05em;
  }

  /* ── Status bar ── */
  .ip-status-bar {
    display:flex; align-items:center; gap:10px;
    padding:7px 22px; font-size:11.5px; color:#2A3348;
    border-bottom:1px solid rgba(255,255,255,.03);
    min-height:34px;
  }
  .ip-brain-badge {
    display:inline-flex; align-items:center; gap:5px;
    font-size:10px; font-weight:700; letter-spacing:.06em;
    padding:2px 9px; border-radius:20px; text-transform:uppercase;
  }
  .ip-brain-badge.internal {
    background:rgba(99,102,241,.15); border:1px solid rgba(99,102,241,.3); color:#A5B4FC;
  }
  .ip-brain-badge.external {
    background:rgba(59,130,246,.15); border:1px solid rgba(59,130,246,.3); color:#93C5FD;
  }
  .ip-brain-dot { width:5px; height:5px; border-radius:50%; }
  .ip-brain-badge.internal .ip-brain-dot { background:#818CF8; }
  .ip-brain-badge.external .ip-brain-dot { background:#60A5FA; }

  /* ── Results container ── */
  .ip-results { max-height:440px; overflow-y:auto; animation:ip-results-in .18s ease; }
  .ip-results::-webkit-scrollbar { width:3px; }
  .ip-results::-webkit-scrollbar-thumb { background:rgba(59,130,246,.2); border-radius:4px; }

  /* ── INTERNAL: firm library list ── */
  .ip-lib-item {
    display:flex; align-items:center; gap:14px;
    padding:12px 22px; cursor:pointer;
    border-bottom:1px solid rgba(255,255,255,.03);
    transition:background .12s;
  }
  .ip-lib-item:last-child { border-bottom:none; }
  .ip-lib-item:hover { background:rgba(59,130,246,.07); }
  .ip-lib-item.ip-selected { background:rgba(59,130,246,.12); }
  .ip-lib-icon {
    width:32px; height:32px; border-radius:7px; flex-shrink:0;
    background:rgba(99,102,241,.1); border:1px solid rgba(99,102,241,.18);
    display:flex; align-items:center; justify-content:center; font-size:14px;
  }
  .ip-lib-info { flex:1; min-width:0; }
  .ip-lib-title {
    font-size:13.5px; font-weight:600; color:#CBD5E1;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }
  .ip-lib-meta {
    font-size:11px; color:#2D3D52; margin-top:2px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }
  .ip-lib-hint { font-size:10.5px; color:#253040; flex-shrink:0; white-space:nowrap; }
  .ip-lib-item.ip-selected .ip-lib-hint { color:#93C5FD; }

  /* ── EXTERNAL: Legal Intelligence panel ── */
  .ip-ext { padding:20px 22px; animation:ip-results-in .2s ease; }

  .ip-trust-row {
    display:flex; align-items:center; gap:12px; margin-bottom:16px;
  }
  .ip-trust-label {
    font-size:10px; font-weight:700; text-transform:uppercase;
    letter-spacing:.07em; color:#334155; flex-shrink:0; min-width:70px;
  }
  .ip-trust-track {
    flex:1; height:5px; background:rgba(255,255,255,.07); border-radius:10px; overflow:hidden;
  }
  .ip-trust-fill {
    height:100%; border-radius:10px;
    transition:width .5s cubic-bezier(0.16,1,0.3,1);
  }
  .ip-trust-fill.high   { background:linear-gradient(90deg,#10B981,#34D399); }
  .ip-trust-fill.medium { background:linear-gradient(90deg,#F59E0B,#FBBF24); }
  .ip-trust-fill.low    { background:linear-gradient(90deg,#EF4444,#F87171); }
  .ip-trust-pct { font-size:12px; font-weight:700; font-family:monospace; flex-shrink:0; min-width:36px; text-align:right; }
  .ip-trust-pct.high   { color:#34D399; }
  .ip-trust-pct.medium { color:#FBBF24; }
  .ip-trust-pct.low    { color:#F87171; }

  .ip-synthesis {
    font-size:13px; line-height:1.75; color:#94A3B8;
    margin-bottom:16px; padding:14px 16px;
    background:rgba(255,255,255,.02); border:1px solid rgba(255,255,255,.04);
    border-radius:9px; max-height:150px; overflow-y:auto;
  }
  .ip-synthesis::-webkit-scrollbar { width:3px; }
  .ip-synthesis::-webkit-scrollbar-thumb { background:rgba(255,255,255,.08); border-radius:4px; }

  .ip-citations-label {
    font-size:10px; font-weight:700; text-transform:uppercase;
    letter-spacing:.07em; color:#334155; margin-bottom:8px;
  }
  .ip-citation-list { display:flex; flex-wrap:wrap; gap:7px; margin-bottom:16px; }
  .ip-citation-badge {
    display:inline-flex; flex-direction:column; gap:1px;
    padding:6px 12px; border-radius:7px; cursor:default;
    border:1px solid rgba(59,130,246,.2); background:rgba(59,130,246,.06);
    transition:all .14s; max-width:210px;
  }
  .ip-citation-badge:hover {
    background:rgba(59,130,246,.13); border-color:rgba(59,130,246,.38);
    transform:translateY(-1px); box-shadow:0 4px 12px rgba(59,130,246,.15);
  }
  .ip-citation-name { font-size:11px; font-weight:600; color:#93C5FD; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ip-citation-ref  { font-size:10px; color:#334155; font-family:monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

  .ip-fvr {
    display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px;
  }
  .ip-fvr-panel {
    padding:10px 13px; border-radius:8px;
    background:rgba(255,255,255,.02); border:1px solid rgba(255,255,255,.05);
  }
  .ip-fvr-label {
    font-size:9.5px; font-weight:700; text-transform:uppercase;
    letter-spacing:.07em; margin-bottom:5px;
  }
  .ip-fvr-panel:first-child .ip-fvr-label { color:#F59E0B; }
  .ip-fvr-panel:last-child  .ip-fvr-label { color:#3B82F6; }
  .ip-fvr-text { font-size:11.5px; line-height:1.6; color:#475569; }

  .ip-risks { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:4px; }
  .ip-risk-chip {
    display:inline-flex; align-items:center; gap:5px;
    padding:4px 10px; border-radius:6px; font-size:11px; color:#F87171;
    background:rgba(239,68,68,.06); border:1px solid rgba(239,68,68,.18);
  }

  /* ── Idle / Loading / Error states ── */
  .ip-idle {
    padding:36px 22px; text-align:center; font-size:13px; color:#1E2A3A;
    display:flex; flex-direction:column; align-items:center; gap:10px;
  }
  .ip-idle-icon { font-size:30px; }
  .ip-idle-sub  { font-size:11px; color:#172030; margin-top:2px; }

  .ip-loading {
    padding:28px 22px; display:flex; align-items:center; justify-content:center;
    gap:12px; font-size:12.5px; color:#2A3A52;
  }
  .ip-spinner {
    width:18px; height:18px; border-radius:50%;
    border:2px solid rgba(59,130,246,.15); border-top-color:#3B82F6;
    animation:spin .75s linear infinite; flex-shrink:0;
  }

  .ip-no-results { padding:28px 22px; text-align:center; font-size:12.5px; color:#1E2A3A; }

  /* ── Footer ── */
  .ip-footer {
    display:flex; align-items:center; gap:14px;
    padding:8px 20px;
    border-top:1px solid rgba(255,255,255,.04);
    background:rgba(0,0,0,.22);
  }
  .ip-footer-hint { display:inline-flex; align-items:center; gap:5px; font-size:10.5px; color:#1E2A3A; }
  .ip-footer-key {
    display:inline-flex; align-items:center; justify-content:center;
    min-width:18px; height:16px; padding:0 4px;
    background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07);
    border-radius:3px; font-size:9.5px; color:#253040; font-family:monospace;
  }
`;

function IntelligencePalette() {
  const navigate = useNavigate();

  const [open,        setOpen]        = useState(false);
  const [closing,     setClosing]     = useState(false);
  const [query,       setQuery]       = useState('');
  const [status,      setStatus]      = useState('idle');  // 'idle'|'loading'|'loaded'|'error'
  const [result,      setResult]      = useState(null);    // SearchResponse from RAG server
  const [libResults,  setLibResults]  = useState([]);      // INTERNAL: filtered firm lib entries
  const [selectedIdx, setSelectedIdx] = useState(0);

  const debounceRef = useRef(null);
  const inputRef    = useRef(null);

  // ── Firm Library loader (with FL_SEED fallback) ──────────────────────────────
  const loadLibEntries = useCallback(() => {
    try {
      const raw    = localStorage.getItem('lexai_firm_library');
      const parsed = raw ? JSON.parse(raw) : null;
      return (Array.isArray(parsed) && parsed.length > 0) ? parsed : FL_SEED;
    } catch { return FL_SEED; }
  }, []);

  // ── Open / close ─────────────────────────────────────────────────────────────
  const doClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setOpen(false); setClosing(false); setQuery('');
      setResult(null); setLibResults([]); setStatus('idle'); setSelectedIdx(0);
    }, 180);
  }, []);

  const doOpen = useCallback(() => { setOpen(true); setClosing(false); }, []);

  // ── Global Ctrl+K listener ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // Don't steal focus from the AI chat if it is already open
        if (open) doClose(); else doOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, doClose, doOpen]);

  // ── Focus input on open ──────────────────────────────────────────────────────
  useEffect(() => {
    if (open && !closing) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open, closing]);

  // ── RAG search ───────────────────────────────────────────────────────────────
  const performSearch = useCallback(async (q) => {
    if (!q || q.trim().length < 3) {
      setResult(null); setLibResults([]); setStatus('idle'); return;
    }
    setStatus('loading');
    try {
      const res = await fetch(`${RAG_SERVER}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data);
      setSelectedIdx(0);

      if (data.brain === 'INTERNAL') {
        const terms = data.filter_terms || [];
        const entries = loadLibEntries();
        const filtered = terms.length === 0 ? entries : entries.filter(e =>
          terms.some(t => {
            const tl = t.toLowerCase();
            return (
              (e.title    || '').toLowerCase().includes(tl) ||
              (e.category || '').toLowerCase().includes(tl) ||
              (e.tags     || []).some(tag => tag.toLowerCase().includes(tl))
            );
          })
        );
        setLibResults(filtered.slice(0, 8));
      }

      setStatus('loaded');
    } catch (err) {
      console.error('[IntelligencePalette]', err);
      setStatus('error');
    }
  }, [loadLibEntries]);

  // ── Debounced input handler ──────────────────────────────────────────────────
  const handleQueryChange = useCallback((e) => {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResult(null); setLibResults([]); setStatus('idle'); return; }
    debounceRef.current = setTimeout(() => performSearch(q), DEBOUNCE_MS);
  }, [performSearch]);

  // ── Keyboard navigation inside palette ──────────────────────────────────────
  const listLength = result?.brain === 'INTERNAL' ? libResults.length : 0;

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { e.stopPropagation(); doClose(); return; }
    if (listLength === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, listLength - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter' && result?.brain === 'INTERNAL' && libResults[selectedIdx]) {
      e.preventDefault();
      const entry = libResults[selectedIdx];
      navigator.clipboard?.writeText(entry.title).catch(() => {});
      doClose();
    }
  }, [doClose, result, libResults, selectedIdx, listLength]);

  // ── Trust gauge helpers ──────────────────────────────────────────────────────
  const trustTier = (idx) => idx >= 0.8 ? 'high' : idx >= 0.5 ? 'medium' : 'low';

  if (!open && !closing) return null;

  const ri      = result?.reliability_index ?? 0;
  const tier    = trustTier(ri);
  const trustPct = Math.round(ri * 100);

  return (
    <>
      <style>{IP_CSS}</style>
      <div className={`ip-overlay${closing ? ' ip-closing' : ''}`} onClick={doClose}>
        <div className="ip-modal" onClick={e => e.stopPropagation()}>

          {/* ── Search input ── */}
          <div className="ip-search-row">
            <span className="ip-search-icon">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
            </span>
            <input
              ref={inputRef}
              className="ip-input"
              placeholder="Search case law, firm templates, BNS / IPC statutes…"
              value={query}
              onChange={handleQueryChange}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="ip-kbd">Esc</span>
          </div>

          {/* ── Status bar ── */}
          <div className="ip-status-bar">
            {result && (
              <span className={`ip-brain-badge ${result.brain.toLowerCase()}`}>
                <span className="ip-brain-dot" />
                {result.brain === 'INTERNAL' ? 'Firm Library' : 'Legal Intelligence'}
              </span>
            )}
            {status === 'loading' && <span>Routing through Dual-Brain pipeline…</span>}
            {status === 'loaded' && result?.brain === 'INTERNAL' && (
              <span>{libResults.length} template{libResults.length !== 1 ? 's' : ''} matched</span>
            )}
            {status === 'loaded' && result?.brain === 'EXTERNAL' && (
              <span>{result.retrieved_chunks ?? 0} case law fragments retrieved</span>
            )}
            {status === 'error' && (
              <span style={{ color: '#F87171' }}>
                RAG server unreachable — start it with: <code style={{ fontFamily: 'monospace', background: 'rgba(255,255,255,.05)', padding: '0 4px', borderRadius: 3 }}>uvicorn rag_server.main:app --port 8001</code>
              </span>
            )}
          </div>

          {/* ── Loading ── */}
          {status === 'loading' && (
            <div className="ip-loading">
              <div className="ip-spinner" />
              <span>Querying Dual-Brain pipeline…</span>
            </div>
          )}

          {/* ── INTERNAL: Firm Library results ── */}
          {status === 'loaded' && result?.brain === 'INTERNAL' && (
            <div className="ip-results" key="internal">
              {libResults.length === 0 ? (
                <div className="ip-no-results">
                  No firm library templates matched — try rephrasing, or open the Firm Library directly.
                </div>
              ) : libResults.map((entry, idx) => (
                <div
                  key={entry.id}
                  className={`ip-lib-item${idx === selectedIdx ? ' ip-selected' : ''}`}
                  onClick={() => {
                    navigator.clipboard?.writeText(entry.title).catch(() => {});
                    doClose();
                  }}
                  onMouseEnter={() => setSelectedIdx(idx)}
                >
                  <div className="ip-lib-icon">📄</div>
                  <div className="ip-lib-info">
                    <div className="ip-lib-title">{entry.title}</div>
                    <div className="ip-lib-meta">
                      {[entry.category, entry.author, entry.updated ? `Updated ${entry.updated}` : null]
                        .filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <span className="ip-lib-hint">{idx === selectedIdx ? '↵ Copy title' : ''}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── EXTERNAL: Legal Intelligence ── */}
          {status === 'loaded' && result?.brain === 'EXTERNAL' && (
            <div className="ip-results" key="external">
              <div className="ip-ext">

                {/* Trust gauge */}
                <div className="ip-trust-row">
                  <span className="ip-trust-label">Trust Index</span>
                  <div className="ip-trust-track">
                    <div className={`ip-trust-fill ${tier}`} style={{ width: `${trustPct}%` }} />
                  </div>
                  <span className={`ip-trust-pct ${tier}`}>{trustPct}%</span>
                </div>

                {/* Synthesis */}
                {result.synthesis && (
                  <div className="ip-synthesis">{result.synthesis}</div>
                )}

                {/* Facts vs Ruling */}
                {result.facts_vs_ruling && (
                  <div className="ip-fvr">
                    <div className="ip-fvr-panel">
                      <div className="ip-fvr-label">Facts</div>
                      <div className="ip-fvr-text">{result.facts_vs_ruling.facts_summary}</div>
                    </div>
                    <div className="ip-fvr-panel">
                      <div className="ip-fvr-label">Ruling</div>
                      <div className="ip-fvr-text">{result.facts_vs_ruling.ruling_summary}</div>
                    </div>
                  </div>
                )}

                {/* Citations */}
                {result.citations?.length > 0 && (
                  <>
                    <div className="ip-citations-label">Citations</div>
                    <div className="ip-citation-list">
                      {result.citations.map((c, i) => (
                        <div key={i} className="ip-citation-badge" title={c.relevance_note}>
                          <span className="ip-citation-name">{c.case_name}</span>
                          <span className="ip-citation-ref">{c.citation_ref || `${c.court} ${c.year}`}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Risk warnings */}
                {result.risk_warnings?.length > 0 && (
                  <div className="ip-risks">
                    {result.risk_warnings.map((w, i) => (
                      <span key={i} className="ip-risk-chip">
                        <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        {w}
                      </span>
                    ))}
                  </div>
                )}

              </div>
            </div>
          )}

          {/* ── Idle state ── */}
          {status === 'idle' && (
            <div className="ip-idle">
              <div className="ip-idle-icon">⚖️</div>
              <span>Search Indian case law, firm templates, and BNS / IPC statutes.</span>
              <span className="ip-idle-sub">Type 3+ characters to activate the Dual-Brain pipeline.</span>
            </div>
          )}

          {/* ── Keyboard hints footer ── */}
          <div className="ip-footer">
            <span className="ip-footer-hint">
              <span className="ip-footer-key">↑</span>
              <span className="ip-footer-key">↓</span>
              Navigate
            </span>
            <span className="ip-footer-hint">
              <span className="ip-footer-key">↵</span>
              Select
            </span>
            <span className="ip-footer-hint">
              <span className="ip-footer-key">Esc</span>
              Close
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#172030' }}>
              Dual-Brain RAG · Port 8001
            </span>
          </div>

        </div>
      </div>
    </>
  );
}

// ── Root export: InzIQ chat sidebar only (Ctrl+K global RAG removed — Directive 3) ──
export default function LexCommandSuite() {
  return <CommandPalette />;
}
