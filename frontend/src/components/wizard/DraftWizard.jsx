import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  blocksToHtml, blocksToText, createSession, deleteSession, downloadDocument, extractFacts, getSession, getType, getVersion,
  listTypes, readFileText, renderDraft, saveSession,
} from '../../services/draftApi.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const FEATURED = ['notice_138', 'bail_application', 'affidavit'];
const STEPS = [
  { id: 'choose', label: 'Choose' },
  { id: 'details', label: 'Add details' },
  { id: 'review', label: 'Review' },
  { id: 'download', label: 'Download' },
];
const CATEGORY = { notice: 'Notices', court: 'Court papers', agreement: 'Agreements', other: 'Other' };
const BRACKET = /(\[Bracketed Field:[^\]]*\])/g;

const STYLES = `
.dw { max-width: 920px; margin: 0 auto; padding: clamp(20px, 4vw, 48px) clamp(16px, 4vw, 32px) 96px; color: var(--ink); }
.dw * { box-sizing: border-box; }
.dw-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.dw-steps { display: flex; gap: 8px; list-style: none; margin: 0; padding: 0; flex-wrap: wrap; }
.dw-steps li { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
.dw-steps li + li::before { content: ''; width: 18px; height: 1px; background: var(--rule); }
.dw-steps b { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--rule); font-size: 12px; font-weight: 600; }
.dw-steps li[aria-current="step"] { color: var(--ink); font-weight: 600; }
.dw-steps li[aria-current="step"] b { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.dw-steps li.done b { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.dw-save { font-size: 12.5px; color: var(--muted); min-height: 18px; }
.dw-save.err { color: #b3261e; }
.dw h1 { font-family: 'Fraunces', Georgia, serif; font-weight: 400; font-size: clamp(28px, 4.2vw, 40px); line-height: 1.1; letter-spacing: -.018em; margin: 28px 0 8px; outline: none; }
.dw a { color: var(--accent-ink); }
.dw-lede { margin: 0 0 24px; color: var(--ink-soft); font-size: 15.5px; line-height: 1.6; max-width: 600px; }
.dw-cards { display: grid; gap: 14px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.dw-card { text-align: left; background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 20px; cursor: pointer; font: inherit; color: inherit; min-height: 150px; display: flex; flex-direction: column; gap: 6px; transition: border-color .2s, transform .2s; }
.dw-card:hover { border-color: var(--accent); transform: translateY(-2px); }
.dw-card:focus-visible, .dw-btn:focus-visible, .dw-seg button:focus-visible, .dw-link:focus-visible, .dw-in:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.dw-card strong { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 20px; line-height: 1.2; }
.dw-card span { font-size: 13.5px; color: var(--ink-soft); line-height: 1.5; }
.dw-card em { margin-top: auto; font-style: normal; font-size: 12px; color: var(--muted); font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: .06em; }
.dw-more { margin-top: 22px; }
.dw-more summary { cursor: pointer; font-size: 14px; color: var(--ink-soft); min-height: 44px; display: flex; align-items: center; }
.dw-more h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); margin: 18px 0 8px; font-weight: 500; }
.dw-list { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.dw-row { text-align: left; background: var(--paper); border: 1px solid var(--rule); border-radius: 10px; padding: 12px 14px; cursor: pointer; font: inherit; color: inherit; min-height: 48px; display: flex; justify-content: space-between; gap: 10px; align-items: center; }
.dw-row:hover { border-color: var(--accent); }
.dw-row small { color: var(--muted); white-space: nowrap; }
.dw-seg { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 18px; }
.dw-seg button { min-height: 52px; background: var(--paper); border: 1px solid var(--rule); border-radius: 10px; padding: 8px 12px; font: inherit; font-size: 14px; color: var(--ink-soft); cursor: pointer; text-align: left; }
.dw-seg button[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--ink); font-weight: 600; }
.dw-panel { background: var(--paper-2); border: 1px solid var(--rule); border-radius: 12px; padding: 16px; margin-bottom: 22px; }
.dw-panel p { margin: 0 0 10px; font-size: 14px; color: var(--ink-soft); line-height: 1.55; }
.dw-in { width: 100%; font: inherit; font-size: 15px; padding: 11px 12px; min-height: 44px; border: 1px solid var(--rule); border-radius: 8px; background: var(--paper); color: var(--ink); }
textarea.dw-in { min-height: 88px; resize: vertical; line-height: 1.5; }
.dw-group { margin: 0 0 26px; }
.dw-group h2 { margin: 0 0 12px; font-size: 12px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); font-weight: 500; }
.dw-field { margin-bottom: 16px; }
.dw-field label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.dw-field label em { font-weight: 400; font-style: normal; color: var(--accent-ink); font-size: 12px; margin-left: 6px; }
.dw-hint { font-size: 12.5px; color: var(--muted); margin-top: 4px; }
.dw-warn { font-size: 13px; color: #b3261e; margin-top: 4px; }
.dw-field.check .dw-in { border-color: #c98a1a; background: color-mix(in srgb, #c98a1a 8%, var(--paper)); }
.dw-src { font-size: 12.5px; margin-top: 6px; padding: 8px 10px; border-left: 3px solid #c98a1a; background: color-mix(in srgb, #c98a1a 8%, var(--paper)); border-radius: 0 6px 6px 0; color: var(--ink-soft); }
.dw-src.ok { border-left-color: var(--accent); background: var(--accent-soft); }
.dw-src button { margin-left: 8px; }
.dw-bar { height: 6px; border-radius: 3px; background: var(--rule); overflow: hidden; margin: 0 0 20px; }
.dw-bar i { display: block; height: 100%; background: var(--accent); transition: width .3s; }
.dw-actions { position: sticky; bottom: 0; background: var(--paper); border-top: 1px solid var(--rule); padding: 12px 0; margin-top: 28px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
.dw-actions .l, .dw-actions .r { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.dw-btn { min-height: 44px; padding: 0 20px; border-radius: 10px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); font: inherit; font-size: 15px; cursor: pointer; }
.dw-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; }
.dw-btn[disabled] { opacity: .55; cursor: not-allowed; }
.dw-link { background: none; border: 0; padding: 0; font: inherit; font-size: 13.5px; color: var(--ink-soft); text-decoration: underline; cursor: pointer; min-height: 44px; }
.dw-alert { border: 1px solid #b3261e; background: color-mix(in srgb, #b3261e 7%, var(--paper)); color: var(--ink); border-radius: 10px; padding: 12px 14px; font-size: 14px; margin: 0 0 16px; line-height: 1.5; }
.dw-alert.note { border-color: #c98a1a; background: color-mix(in srgb, #c98a1a 8%, var(--paper)); }
.dw-alert ul { margin: 6px 0 0; padding-left: 18px; }
.dw-page { background: #fff; color: #111; border: 1px solid var(--rule); border-radius: 4px; padding: clamp(20px, 5vw, 56px); font-family: 'Times New Roman', Times, serif; font-size: 16px; line-height: 1.7; box-shadow: 0 10px 30px -20px rgba(0,0,0,.4); overflow-wrap: anywhere; }
/* The preview is a sheet of white paper in BOTH themes. Global dark-theme rules recolour p/span, which made the text
   near-white on white; pin the ink colour on everything inside the sheet. */
.dw-page, .dw-page p, .dw-page span, .dw-page div, .dw-page td, .dw-page h3, .dw-page b { color: #111 !important; }
.dw-page .dw-chip { color: #5a4300 !important; }
.dw-page p { margin: 0 0 12px; }
.dw-page .t { text-align: center; font-weight: 700; text-decoration: underline; font-size: 18px; margin: 0 0 16px; }
.dw-page .r { text-align: right; } .dw-page .c { text-align: center; } .dw-page .j { text-align: justify; } .dw-page .b { font-weight: 700; }
.dw-page .n { display: grid; grid-template-columns: 2.2em 1fr; text-align: justify; margin: 0 0 12px; }
.dw-page .sig { margin: 0 0 12px 50%; }
.dw-page h3 { font-size: 16px; margin: 18px 0 8px; }
.dw-page table { width: 100%; border-collapse: collapse; margin: 0 0 12px; font-size: 15px; } .dw-page td { border: 1px solid #999; padding: 6px 8px; vertical-align: top; }
.dw-chip { background: #fff3b0; border: 1px dashed #b58900; border-radius: 4px; padding: 0 4px; cursor: pointer; font: inherit; color: #5a4300; }
.dw-done { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 18px 0; }
.dw-done .dw-btn { min-height: 64px; text-align: left; padding: 0 20px; }
.dw-skel { height: 14px; border-radius: 4px; background: linear-gradient(90deg, var(--rule), var(--paper-2), var(--rule)); background-size: 200% 100%; animation: dw-sk 1.2s linear infinite; margin: 10px 0; }
@keyframes dw-sk { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .dw-skel { animation: none; } .dw-card { transition: none; } }
@media (max-width: 720px) { .dw-cards, .dw-list, .dw-done { grid-template-columns: 1fr; } .dw-seg { grid-template-columns: 1fr; } .dw-steps li span { display: none; } .dw-steps li[aria-current="step"] span { display: inline; } .dw-page .sig { margin-left: 25%; } }
`;

const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n)}…` : String(s || ''));

function Blocks({ blocks, onChip }) {
  const withChips = (text) => String(text || '').split(BRACKET).map((part, i) => (
    part.startsWith('[Bracketed Field:')
      ? <button key={i} type="button" className="dw-chip" onClick={() => onChip && onChip(part)} title="Click to fill this in">{part.replace(/^\[Bracketed Field:\s*/, '[').replace(/\]$/, ']')}</button>
      : <span key={i}>{part}</span>
  ));
  return blocks.map((b, i) => {
    switch (b.type) {
      case 'title': return <p key={i} className="t">{withChips(b.text)}</p>;
      case 'heading': return <h3 key={i}>{withChips(b.text)}</h3>;
      case 'right': return <p key={i} className="r">{withChips(b.text)}</p>;
      case 'center': return <p key={i} className={`c${b.bold ? ' b' : ''}`}>{withChips(b.text)}</p>;
      case 'address': return <p key={i}>{(b.lines || []).map((l, k) => <span key={k}>{k > 0 ? <br /> : null}{k === 0 ? <b>{withChips(l)}</b> : withChips(l)}</span>)}</p>;
      case 'signature': return <p key={i} className="sig">{(b.lines || []).map((l, k) => <span key={k}>{k > 0 ? <br /> : null}{withChips(l)}</span>)}</p>;
      case 'numbered': return <div key={i} className="n"><span>{b.number}.</span><span>{withChips(b.text)}</span></div>;
      case 'lettered': return <div key={i} className="n" style={{ marginLeft: '2em' }}><span>{b.letter}</span><span>{withChips(b.text)}</span></div>;
      case 'table': return <table key={i}><tbody>{(b.rows || []).map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{withChips(c)}</td>)}</tr>)}</tbody></table>;
      case 'pagebreak': return <hr key={i} />;
      case 'spacer': return <p key={i}>&nbsp;</p>;
      default: return <p key={i} className={`${b.align === 'justify' ? 'j' : ''}${b.bold ? ' b' : ''}`}>{withChips(b.text)}</p>;
    }
  });
}

const BACKUP_KEY = 'lex_wizard_backup';

/** Last typing, kept in this browser until the server confirms it, so an expired session or a crash never costs work. */
function writeBackup(sid, typeId, facts, synced) {
  try { localStorage.setItem(BACKUP_KEY, JSON.stringify({ sid: sid || null, typeId, facts, synced, at: Date.now() })); } catch { /* storage may be blocked */ }
}
function readBackup() {
  try {
    const b = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null');
    return b && b.typeId && b.facts && typeof b.facts === 'object' ? b : null;
  } catch { return null; }
}

export default function DraftWizard() {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const location = useLocation();
  const headingRef = useRef(null);

  const [step, setStep] = useState('choose');
  const [types, setTypes] = useState(null);
  const [typesError, setTypesError] = useState('');
  const [typeId, setTypeId] = useState('');
  const [def, setDef] = useState(null);
  const [facts, setFacts] = useState({});
  const [prov, setProv] = useState({});                 // slotId -> {source, snippet, confidence, confirmed}
  const [source, setSource] = useState('');             // case | file | manual
  const [cases, setCases] = useState(null);
  const [caseQuery, setCaseQuery] = useState('');
  const [caseNote, setCaseNote] = useState('');
  const [fileNote, setFileNote] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [doc, setDoc] = useState(null);
  const [docError, setDocError] = useState('');
  const [saveState, setSaveState] = useState('idle');   // idle | saving | saved | error
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [confirmReset, setConfirmReset] = useState(false);
  const [exportNote, setExportNote] = useState('');
  const [staleTab, setStaleTab] = useState(false);
  const [restorable, setRestorable] = useState(null);   // unsaved work found in this browser
  const [restoredNote, setRestoredNote] = useState('');
  const [versions, setVersions] = useState([]);          // earlier downloads of this draft (the last 10 are kept)
  const [viewVersion, setViewVersion] = useState(null);  // {when, document} while an earlier version is open
  const [fromNote, setFromNote] = useState(null);       // {label, slots[]}: facts handed over from another screen
  const factsRef = useRef({});
  const typeRef = useRef({ typeId: '', def: null });   // read by the debounced save, which outlives the render that queued it

  const sidRef = useRef(sessionId ? Number(sessionId) : null);
  const handoffDone = useRef(false);
  const createdHere = useRef(false);               // a session this screen just made: do not reload it when the address changes
  const savedStamp = useRef('');
  const dirty = useRef(false);
  const saveTimer = useRef(null);
  const versionSaved = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; clearTimeout(saveTimer.current); }, []);

  // ── load the list of document types, and resume a saved draft if the address has one ──
  const [typesTry, setTypesTry] = useState(0);
  useEffect(() => {
    let live = true;
    setTypesError('');
    listTypes().then((t) => { if (live) setTypes(t); }).catch((e) => { if (live) { setTypes([]); setTypesError(e.message); } });
    return () => { live = false; };
  }, [typesTry]);

  useEffect(() => {
    const h = location.state && location.state.prefill;
    if (!h || !h.type || sessionId || handoffDone.current) return;
    handoffDone.current = true;
    chooseType(h.type, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sessionId || (createdHere.current && sidRef.current === Number(sessionId))) return undefined;
    let live = true;
    (async () => {
      try {
        const s = await getSession(sessionId);
        const d = await getType(s.type);
        if (!live) return;
        sidRef.current = s.id; savedStamp.current = s.updated_at || '';
        let f = s.facts || {};
        const b = readBackup();
        if (b && b.sid === s.id && !b.synced && JSON.stringify(b.facts) !== JSON.stringify(f)) {
          f = b.facts; setRestoredNote('We restored what you last typed here. It was not saved before the page closed.');
          dirty.current = true;
        }
        factsRef.current = f;
        setTypeId(s.type); setDef(d); setFacts(f); setSource('manual');
        setVersions(s.versions || []);
        setStep(s.step === 'review' || s.step === 'download' ? 'review' : 'details');
      } catch (e) {
        if (live) { setError(e.message || 'We could not open that draft.'); setStep('choose'); }
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) return;
    const b = readBackup();
    if (b && !b.synced && Object.values(b.facts).some((v) => String(v || '').trim())) setRestorable(b);
  }, [sessionId]);

  useEffect(() => { if (headingRef.current) headingRef.current.focus({ preventScroll: true }); window.scrollTo?.(0, 0); }, [step]);

  // ── autosave: a refresh, crash or closed tab loses nothing ──
  useEffect(() => { typeRef.current = { typeId, def }; }, [typeId, def]);

  const persist = useCallback(async (nextFacts, nextStep) => {
    const { typeId, def } = typeRef.current;
    if (!typeId) return;
    setSaveState('saving');
    try {
      if (!sidRef.current) {
        const s = await createSession({ type: typeId, facts: nextFacts, title: def?.short });
        sidRef.current = s.id; savedStamp.current = s.updated_at || '';
        createdHere.current = true;
        // Put the id in the address so a refresh resumes this draft. history.replaceState (not navigate) keeps this
        // screen mounted: a router navigation here remounted the page while the advocate was typing.
        try { window.history.replaceState(window.history.state, '', `/draft/${s.id}`); } catch { /* address bar stays as is */ }
      } else {
        const s = await saveSession(sidRef.current, { facts: nextFacts, step: nextStep });
        savedStamp.current = s.updated_at || savedStamp.current;
      }
      dirty.current = false;
      writeBackup(sidRef.current, typeId, nextFacts, true);
      if (alive.current) { setSaveState('saved'); setExpired(false); }
    } catch (e) {
      if (!alive.current) return;
      setSaveState('error');
      if (e.sessionExpired) setExpired(true);
      writeBackup(sidRef.current, typeId, nextFacts, false);
    }
  }, []);

  const queueSave = useCallback((nextFacts, nextStep) => {
    dirty.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(nextFacts, nextStep), 900);
  }, [persist]);

  useEffect(() => {
    const warn = (e) => { if (dirty.current || saveState === 'saving' || saveState === 'error') { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

  // a draft changed in another tab: say so instead of silently overwriting it
  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState !== 'visible' || !sidRef.current || dirty.current) return;
      try {
        const s = await getSession(sidRef.current);
        if (savedStamp.current && s.updated_at && s.updated_at !== savedStamp.current) setStaleTab(true);
      } catch { /* offline: nothing to compare */ }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ── choosing a type ──
  const chooseType = async (id, handed) => {
    if (busy) return;
    setBusy('type'); setError('');
    try {
      const d = await getType(id);
      const start = {}, np = {};
      if (handed && handed.facts) {
        Object.entries(handed.facts).forEach(([k, v]) => {
          if (d.slots.some((s) => s.id === k) && String(v || '').trim()) {
            start[k] = String(v);
            np[k] = { source: handed.label, snippet: String(v), confidence: handed.checkSlots && handed.checkSlots.includes(k) ? 'low' : 'high', confirmed: !(handed.checkSlots && handed.checkSlots.includes(k)) };
          }
        });
      }
      factsRef.current = start;
      setTypeId(id); setDef(d); setFacts(start); setProv(np); setSource(handed ? 'manual' : ''); setDoc(null); sidRef.current = null; versionSaved.current = false;
      setFromNote(handed ? { label: handed.label, slots: Object.keys(start) } : null);
      setVersions([]); setViewVersion(null);
      if (handed) { typeRef.current = { typeId: id, def: d }; writeBackup(null, id, start, false); queueSave(start, 'details'); }
      setStep('details');
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  const restoreBackup = async () => {
    const b = restorable;
    if (!b || busy) return;
    setBusy('type'); setError('');
    try {
      const d = await getType(b.typeId);
      factsRef.current = b.facts;
      setTypeId(b.typeId); setDef(d); setFacts(b.facts); setProv({}); setSource('manual'); setRestorable(null);
      setRestoredNote('We restored what you last typed. It had not reached the server.');
      sidRef.current = b.sid || null;
      typeRef.current = { typeId: b.typeId, def: d };
      setStep('details');
      dirty.current = true;
      queueSave(b.facts, 'details');
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  const setFact = (id, rawValue) => {
    // The page cannot be made to hold more than the server will keep: a huge paste is cut to the field's limit.
    const slot = (def?.slots || []).find((x) => x.id === id);
    const limit = slot && slot.type === 'longtext' ? 2000 : slot && slot.type === 'address' ? 400 : 300;
    const value = String(rawValue == null ? '' : rawValue).slice(0, limit);
    const n = { ...factsRef.current, [id]: value };
    factsRef.current = n;
    setFacts(n);
    writeBackup(sidRef.current, typeId, n, false);
    queueSave(n, 'details');
    setProv((p) => (p[id] ? { ...p, [id]: { ...p[id], confirmed: true, edited: true } } : p));
  };

  // ── source: a case ──
  useEffect(() => {
    if (source !== 'case') return undefined;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/practice/cases?per_page=20&sort=updated&q=${encodeURIComponent(caseQuery.trim())}`);
        if (!res.ok) throw new Error('bad');
        const data = await res.json();
        if (live) { setCases(Array.isArray(data.cases) ? data.cases : []); setCaseNote(''); }
      } catch { if (live) { setCases([]); setCaseNote('We could not load your cases right now. You can type the details in instead.'); } }
    }, caseQuery ? 300 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [source, caseQuery]);

  const pickCase = async (c) => {
    if (busy) return;
    setBusy('case'); setError('');
    try {
      const res = await fetch(`${API_BASE}/api/practice/cases/${c.id}`);
      if (!res.ok) throw new Error('bad');
      const full = (await res.json()).case || c;
      const next = { ...facts }, np = { ...prov }; let filled = 0;
      (def?.slots || []).forEach((s) => {
        const v = s.from_case && String(full[s.from_case] || '').trim();
        if (v && !String(next[s.id] || '').trim()) { next[s.id] = v; np[s.id] = { source: `case "${clip(full.title || c.title, 40)}"`, snippet: v, confidence: 'high', confirmed: true }; filled += 1; }
      });
      factsRef.current = next;
      setFacts(next); setProv(np); writeBackup(sidRef.current, typeId, next, false); queueSave(next, 'details');
      setCaseNote(filled ? `Filled ${filled} detail${filled === 1 ? '' : 's'} from this case. Anything not on the case file is left for you.` : 'This case file has none of the details this document needs. Please type them in.');
    } catch { setError('We could not open that case. Please try again, or type the details in.'); } finally { setBusy(''); }
  };

  // ── source: a file ──
  const onFile = async (files) => {
    const f = files && files[0];
    if (!f || busy) return;
    setFileNote(''); setError('');
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(ext)) { setFileNote('Please upload a PDF, Word (.docx) or text file.'); return; }
    if (f.size > MAX_FILE_BYTES) { setFileNote('That file is over 25 MB. Please upload a smaller file or the relevant pages only.'); return; }
    setBusy('file');
    try {
      const text = await readFileText(f);
      const res = await extractFacts(typeId, text, f.name);
      const next = { ...facts }, np = { ...prov }; let n = 0;
      Object.entries(res.fields || {}).forEach(([id, rec]) => {
        if (!String(next[id] || '').trim()) {
          next[id] = rec.value; n += 1;
          np[id] = { source: `${rec.source_doc}${rec.page ? `, page ${rec.page}` : ''}`, snippet: rec.snippet, confidence: rec.confidence, confirmed: rec.confidence === 'high' };
        }
      });
      factsRef.current = next;
      setFacts(next); setProv(np); writeBackup(sidRef.current, typeId, next, false); queueSave(next, 'details');
      setFileNote(n ? `Read ${n} detail${n === 1 ? '' : 's'} from "${f.name}". Each one shows where it came from. Please check them.` : `We read "${f.name}" but could not pick out the details this document needs. Please type them in below.`);
    } catch (e) { setFileNote(e.message); if (e.sessionExpired) setExpired(true); } finally { setBusy(''); }
  };

  // ── live check of the details (plain-English problems beside each field) ──
  const [problems, setProblems] = useState({});
  useEffect(() => {
    if (step !== 'details' || !typeId || !Object.values(facts).some((v) => String(v || '').trim())) { setProblems({}); return undefined; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      renderDraft(typeId, facts, ctrl.signal).then((d) => {
        const m = {}; (d.warnings || []).forEach((w) => { if (w.slot) m[w.slot] = w.message; }); setProblems(m);
      }).catch(() => {});
    }, 700);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [facts, step, typeId]);

  // ── review ──
  const goReview = async () => {
    if (busy) return;
    setBusy('render'); setDocError('');
    clearTimeout(saveTimer.current);
    try {
      const d = await renderDraft(typeId, facts);
      setDoc(d); setStep('review'); versionSaved.current = false;
      persist(facts, 'review');
    } catch (e) { setDocError(e.message); if (e.sessionExpired) setExpired(true); } finally { setBusy(''); }
  };

  const jumpToField = (labelOrSlot) => {
    setStep('details');
    setTimeout(() => {
      const slot = (def?.slots || []).find((s) => s.id === labelOrSlot || labelOrSlot.includes(s.label));
      const el = slot && document.getElementById(`dw-f-${slot.id}`);
      if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
    }, 60);
  };

  const goDownload = async () => {
    setStep('download');
    if (!versionSaved.current && sidRef.current && doc) {
      versionSaved.current = true;
      saveSession(sidRef.current, { document: doc, status: 'done', step: 'download', note: 'Reviewed' })
        .then((s) => { if (alive.current) setVersions(s.versions || []); })
        .catch(() => { versionSaved.current = false; });
    }
  };

  const download = async (format) => {
    if (busy || !doc) return;
    setBusy(format); setError(''); setExportNote('');
    try {
      const r = await downloadDocument(doc, format);
      setExportNote(r.unresolved ? `${r.unresolved} blank detail${r.unresolved === 1 ? ' is' : 's are'} highlighted in yellow in the file. Fill them in before you use it.` : 'Downloaded. Open it to check it before you use it.');
      if (r.note) setExportNote((m) => `${m} ${r.note}`);
    } catch (e) { setError(e.message); if (e.sessionExpired) setExpired(true); } finally { setBusy(''); }
  };

  const when = (iso) => {
    try { return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(/Z|[+-]\d\d:?\d\d$/.test(iso || '') ? iso : `${iso}Z`)); } catch { return ''; }
  };
  const openVersion = async (v) => {
    if (busy) return;
    setBusy('version'); setError('');
    try { const r = await getVersion(sidRef.current, v.id); setViewVersion({ when: when(r.created_at || v.created_at), document: r.document }); }
    catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const useVersion = () => {
    if (!viewVersion) return;
    setDoc(viewVersion.document); versionSaved.current = false; setViewVersion(null);
  };

  const openInEditor = () => navigate('/auto-draft', { state: { openDraft: { html: blocksToHtml(doc.blocks), text: blocksToText(doc.blocks), title: doc.title } } });

  const startOver = async () => {
    clearTimeout(saveTimer.current);
    const id = sidRef.current;
    sidRef.current = null; dirty.current = false;
    if (id) { try { await deleteSession(id); } catch { /* already gone */ } }
    factsRef.current = {};
    setVersions([]); setViewVersion(null);
    try { localStorage.removeItem(BACKUP_KEY); } catch { /* storage may be blocked */ }
    setFacts({}); setProv({}); setDoc(null); setTypeId(''); setDef(null); setSource(''); setStep('choose'); setConfirmReset(false); setSaveState('idle');
    navigate('/draft', { replace: true });
  };

  const finishLater = async () => {
    clearTimeout(saveTimer.current);
    if (typeId) await persist(facts, step);
    navigate('/start', { state: { savedDraft: true } });
  };

  // ── derived ──
  const groups = useMemo(() => {
    const g = [];
    (def?.slots || []).forEach((s) => {
      let grp = g.find((x) => x.name === (s.group || 'Details'));
      if (!grp) { grp = { name: s.group || 'Details', slots: [] }; g.push(grp); }
      grp.slots.push(s);
    });
    return g;
  }, [def]);
  const required = (def?.slots || []).filter((s) => s.required);
  const filled = required.filter((s) => String(facts[s.id] || '').trim()).length;
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const byCategory = useMemo(() => {
    const rest = (types || []).filter((t) => !FEATURED.includes(t.id));
    const m = {}; rest.forEach((t) => { (m[t.category] = m[t.category] || []).push(t); });
    return m;
  }, [types]);
  const featured = FEATURED.map((id) => (types || []).find((t) => t.id === id)).filter(Boolean);

  const saveLabel = saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'All changes saved' : saveState === 'error' ? 'Not saved yet. Your answers are still on screen.' : '';

  return (
    <section className="dw" aria-labelledby="dw-h">
      <style>{STYLES}</style>

      <div className="dw-top">
        <ol className="dw-steps" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s.id} aria-current={s.id === step ? 'step' : undefined} className={i < stepIndex ? 'done' : ''}>
              <b>{i < stepIndex ? '✓' : i + 1}</b><span>{s.label}</span>
            </li>
          ))}
        </ol>
        <div className={`dw-save${saveState === 'error' ? ' err' : ''}`} role="status" aria-live="polite">{saveLabel}</div>
      </div>

      {expired && (
        <div className="dw-alert" role="alert">Your session has expired. Your answers are saved on this screen. <Link to="/login" state={{ from: window.location.pathname }}>Sign in again</Link> to keep going.</div>
      )}
      {staleTab && <div className="dw-alert note" role="alert">This draft was changed in another tab or window. <button type="button" className="dw-link" onClick={() => window.location.reload()}>Reload to see the latest</button></div>}
      {error && <div className="dw-alert" role="alert">{error}</div>}
      {restoredNote && <div className="dw-alert note" role="status">{restoredNote}</div>}
      {fromNote && step === 'details' && (
        <div className="dw-alert note" role="status">
          <b>Started from {fromNote.label}.</b> Details taken from there are marked so you can check them.{' '}
          <button type="button" className="dw-link" onClick={() => {
            const next = { ...factsRef.current }; fromNote.slots.forEach((k) => { delete next[k]; });
            factsRef.current = next; setFacts(next); setProv({}); setFromNote(null); queueSave(next, 'details');
          }}>Start without them</button>
        </div>
      )}

      {loading && <><div className="dw-skel" style={{ width: '60%', height: 34, marginTop: 30 }} /><div className="dw-skel" /><div className="dw-skel" style={{ width: '80%' }} /></>}

      {!loading && step === 'choose' && (
        <>
          <h1 id="dw-h" ref={headingRef} tabIndex={-1}>What would you like to draft?</h1>
          <p className="dw-lede">Pick a document. Next you will add your case or file, and we ask only for facts you know. Anything missing stays as a highlighted blank. Nothing is made up.</p>
          {restorable && (
            <div className="dw-alert note" role="status">
              <b>You have unsaved work.</b> It was typed in this browser but never reached the server (for example your session ended).
              <div style={{ marginTop: 8 }}><button type="button" className="dw-btn primary" onClick={restoreBackup} disabled={Boolean(busy)}>Restore it</button> <button type="button" className="dw-link" onClick={() => { try { localStorage.removeItem(BACKUP_KEY); } catch { /* storage may be blocked */ } setRestorable(null); }}>Discard</button></div>
            </div>
          )}
          {types === null && <><div className="dw-skel" style={{ height: 120 }} /></>}
          {typesError && (
            <div className="dw-alert" role="alert">
              {typesError} <button type="button" className="dw-link" onClick={() => { setTypes(null); setTypesTry((n) => n + 1); }}>Try again</button>
            </div>
          )}
          <div className="dw-cards">
            {featured.map((t) => (
              <button key={t.id} type="button" className="dw-card" onClick={() => chooseType(t.id)} disabled={Boolean(busy)}>
                <strong>{t.short}</strong>
                <span>{t.required_count} details needed</span>
                <em>ABOUT {t.minutes} MIN</em>
              </button>
            ))}
          </div>
          {Object.keys(byCategory).length > 0 && (
            <details className="dw-more">
              <summary>More document types</summary>
              {Object.entries(byCategory).map(([cat, list]) => (
                <div key={cat}>
                  <h2>{CATEGORY[cat] || 'Other'}</h2>
                  <div className="dw-list">
                    {list.map((t) => (
                      <button key={t.id} type="button" className="dw-row" onClick={() => chooseType(t.id)} disabled={Boolean(busy)}>
                        <span>{t.short}</span><small>~{t.minutes} min</small>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </details>
          )}
          <p className="dw-hint" style={{ marginTop: 28 }}>Need something else, or want to write freely? <Link to="/auto-draft">Open the drafting studio</Link>.</p>
        </>
      )}

      {!loading && step === 'details' && def && (
        <>
          <h1 id="dw-h" ref={headingRef} tabIndex={-1}>{def.short}: add the details</h1>
          <p className="dw-lede">Where should we take the facts from? Pick one, or just type them in. You can change anything.</p>

          <div className="dw-seg" role="group" aria-label="Where the facts come from">
            <button type="button" aria-pressed={source === 'case'} onClick={() => setSource('case')}>From one of my cases</button>
            <button type="button" aria-pressed={source === 'file'} onClick={() => setSource('file')}>From a file I upload</button>
            <button type="button" aria-pressed={source === 'manual'} onClick={() => setSource('manual')}>I will type them in</button>
          </div>

          {source === 'case' && (
            <div className="dw-panel">
              <p>Choose the case. We copy only what the case file already holds (client, opposite party, court, case number).</p>
              <input className="dw-in" type="search" placeholder="Search your cases by name or number" aria-label="Search your cases" value={caseQuery} onChange={(e) => setCaseQuery(e.target.value)} />
              {cases === null && <div className="dw-skel" />}
              {cases && cases.length === 0 && !caseNote && (
                <p style={{ marginTop: 12 }}>No cases found. <Link to="/practice">Add your first case</Link> in Practice, or type the details in.</p>
              )}
              <div className="dw-list" style={{ marginTop: 12, gridTemplateColumns: '1fr' }}>
                {(cases || []).slice(0, 8).map((c) => (
                  <button key={c.id} type="button" className="dw-row" onClick={() => pickCase(c)} disabled={Boolean(busy)}>
                    <span>{c.title || 'Untitled case'}{c.case_no ? ` · ${c.case_no}` : ''}</span><small>{clip(c.court, 28)}</small>
                  </button>
                ))}
              </div>
              {caseNote && <p style={{ marginTop: 12 }}>{caseNote}</p>}
            </div>
          )}

          {source === 'file' && (
            <div className="dw-panel">
              <p>Upload the return memo, a previous notice, or the case papers (PDF, Word or text, up to 25 MB). We read the file and show where each detail came from.</p>
              <input className="dw-in" type="file" accept=".pdf,.docx,.txt" aria-label="Upload a file" onChange={(e) => { onFile(e.target.files); e.target.value = ''; }} disabled={Boolean(busy)} />
              {busy === 'file' && <p style={{ marginTop: 10 }}>Reading the file…</p>}
              {fileNote && <p style={{ marginTop: 10 }} role="status">{fileNote}</p>}
            </div>
          )}

          {def.notes?.length > 0 || def.timelines?.length > 0 ? (
            <div className="dw-alert note">
              <b>Good to know</b>
              <ul>{[...(def.timelines || []), ...(def.notes || [])].map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          ) : null}

          <div className="dw-bar" aria-hidden="true"><i style={{ width: `${required.length ? Math.round((filled / required.length) * 100) : 100}%` }} /></div>
          <p className="dw-hint" style={{ marginTop: -10, marginBottom: 18 }}>{filled} of {required.length} needed details filled. Anything you leave becomes a highlighted blank in the draft.</p>

          {groups.map((g) => (
            <section key={g.name} className="dw-group" aria-label={g.name}>
              <h2>{g.name}</h2>
              {g.slots.map((s) => {
                const p = prov[s.id];
                const needsCheck = p && !p.confirmed && !p.edited;
                const long = s.type === 'longtext' || s.type === 'address';
                const id = `dw-f-${s.id}`;
                return (
                  <div key={s.id} className={`dw-field${needsCheck ? ' check' : ''}`}>
                    <label htmlFor={id}>{s.label}{s.required ? <em>needed</em> : null}</label>
                    {s.type === 'choice' ? (
                      <select id={id} className="dw-in" value={facts[s.id] || ''} onChange={(e) => setFact(s.id, e.target.value)}>
                        <option value="">Choose…</option>
                        {(s.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : long ? (
                      <textarea id={id} className="dw-in" value={facts[s.id] || ''} onChange={(e) => setFact(s.id, e.target.value)} maxLength={s.type === 'longtext' ? 2000 : 400} aria-describedby={`${id}-h`} />
                    ) : (
                      <input id={id} className="dw-in" type="text" inputMode={s.type === 'amount' || s.type === 'number' || s.type === 'cheque_no' ? 'numeric' : undefined} value={facts[s.id] || ''} onChange={(e) => setFact(s.id, e.target.value)} maxLength={300} aria-describedby={`${id}-h`} />
                    )}
                    {s.example && !String(facts[s.id] || '').trim() ? <div className="dw-hint" id={`${id}-h`}>For example: {s.example}</div> : <span id={`${id}-h`} />}
                    {problems[s.id] && String(facts[s.id] || '').trim() ? <div className="dw-warn" role="alert">{problems[s.id]}</div> : null}
                    {p && p.snippet ? (
                      <div className={`dw-src${needsCheck ? '' : ' ok'}`}>
                        {needsCheck ? 'Please check. ' : ''}Read from {p.source}: “{clip(p.snippet, 160)}”
                        {needsCheck ? <button type="button" className="dw-link" onClick={() => setProv((x) => ({ ...x, [s.id]: { ...x[s.id], confirmed: true } }))}>Looks right</button> : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ))}

          {docError && <div className="dw-alert" role="alert">{docError}</div>}
          <div className="dw-actions">
            <div className="l">
              <button type="button" className="dw-btn" onClick={() => { setStep('choose'); }} disabled={Boolean(busy)}>Back</button>
              <button type="button" className="dw-link" onClick={finishLater}>Save and finish later</button>
              <button type="button" className="dw-link" onClick={() => setConfirmReset(true)}>Start over</button>
            </div>
            <div className="r">
              <button type="button" className="dw-btn primary" onClick={goReview} disabled={Boolean(busy)}>{busy === 'render' ? 'Preparing…' : 'Review the draft'}</button>
            </div>
          </div>
        </>
      )}

      {!loading && step === 'review' && (
        <>
          <h1 id="dw-h" ref={headingRef} tabIndex={-1}>Check the draft</h1>
          {!doc && <><div className="dw-skel" /><div className="dw-skel" style={{ width: '70%' }} />
            <button type="button" className="dw-btn primary" onClick={goReview} disabled={Boolean(busy)}>Prepare the draft</button></>}
          {doc && (
            <>
              <p className="dw-lede">This is exactly what goes into the Word file. Yellow blanks are details we were not given; click one to fill it in.</p>
              {doc.unresolved.length > 0 && (
                <div className="dw-alert note" role="status">
                  <b>{doc.unresolved.length} item{doc.unresolved.length === 1 ? ' needs' : 's need'} your attention</b>
                  <ul>{doc.unresolved.slice(0, 8).map((u) => <li key={u.slot}><button type="button" className="dw-link" style={{ minHeight: 28 }} onClick={() => jumpToField(u.slot)}>{u.label}</button></li>)}</ul>
                </div>
              )}
              {doc.warnings.length > 0 && (
                <div className="dw-alert" role="alert"><b>Please check</b><ul>{doc.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul></div>
              )}
              {doc.review?.status === 'unreviewed' && <p className="dw-hint">The fixed wording in this document has not yet been checked by a practising advocate. Please read it before use.</p>}
              <article className="dw-page" aria-label="Draft preview"><Blocks blocks={doc.blocks} onChip={(chip) => jumpToField(chip)} /></article>
              <div className="dw-actions">
                <div className="l"><button type="button" className="dw-btn" onClick={() => setStep('details')}>Back to details</button></div>
                <div className="r"><button type="button" className="dw-btn primary" onClick={goDownload}>Looks good, continue</button></div>
              </div>
            </>
          )}
        </>
      )}

      {!loading && step === 'download' && doc && viewVersion && (
        <>
          <h1 id="dw-h" ref={headingRef} tabIndex={-1}>An earlier version</h1>
          <p className="dw-lede">Saved {viewVersion.when}. You are only looking at it; your current draft is unchanged until you choose to use this one.</p>
          <article className="dw-page" aria-label="Earlier version"><Blocks blocks={viewVersion.document.blocks || []} /></article>
          <div className="dw-actions">
            <div className="l"><button type="button" className="dw-btn" onClick={() => setViewVersion(null)}>Back to my draft</button></div>
            <div className="r"><button type="button" className="dw-btn primary" onClick={useVersion}>Use this version</button></div>
          </div>
        </>
      )}

      {!loading && step === 'download' && doc && !viewVersion && (
        <>
          <h1 id="dw-h" ref={headingRef} tabIndex={-1}>Your draft is ready</h1>
          <p className="dw-lede">{doc.unresolved.length ? `${doc.unresolved.length} blank detail${doc.unresolved.length === 1 ? ' is' : 's are'} highlighted in yellow in the file. Fill ${doc.unresolved.length === 1 ? 'it' : 'them'} in before use.` : 'Every detail is filled in. Read it once more before you use it.'}</p>
          <div className="dw-done">
            <button type="button" className="dw-btn primary" onClick={() => download('docx')} disabled={Boolean(busy)}>{busy === 'docx' ? 'Preparing…' : 'Download Word (.docx)'}</button>
            <button type="button" className="dw-btn" onClick={() => download('pdf')} disabled={Boolean(busy)}>{busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</button>
            <button type="button" className="dw-btn" onClick={openInEditor}>Open in the editor</button>
            <button type="button" className="dw-btn" onClick={startOver}>Do another</button>
          </div>
          {exportNote && <p role="status" className="dw-hint">{exportNote}</p>}
          {versions.length > 1 && (
            <details className="dw-more">
              <summary>Earlier versions ({versions.length - 1})</summary>
              <div className="dw-list" style={{ gridTemplateColumns: '1fr' }}>
                {versions.slice(1).map((v) => (
                  <button key={v.id} type="button" className="dw-row" onClick={() => openVersion(v)} disabled={Boolean(busy)}>
                    <span>Saved {when(v.created_at)}</span><small>Open</small>
                  </button>
                ))}
              </div>
            </details>
          )}
          <p className="dw-hint">This draft is saved. <Link to="/start">Back to Start</Link> · <button type="button" className="dw-link" onClick={() => setStep('review')}>Go back and change something</button></p>
        </>
      )}

      {confirmReset && (
        <div className="dw-alert note" role="alertdialog" aria-label="Start over?" style={{ position: 'fixed', left: '50%', bottom: 90, transform: 'translateX(-50%)', width: 'min(92vw, 460px)', zIndex: 20 }}>
          <b>Start over?</b> This deletes the draft you are working on, including what you typed.
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button type="button" className="dw-btn primary" onClick={startOver}>Yes, start over</button>
            <button type="button" className="dw-btn" onClick={() => setConfirmReset(false)}>Keep working</button>
          </div>
        </div>
      )}
    </section>
  );
}
