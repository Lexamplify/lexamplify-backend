import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import WordCraftEditor from './WordCraftEditor.jsx';
import { inlineEditSelection } from '../../services/api.js';
import { getSession, getVersion, blocksToHtml } from '../../services/draftApi.js';
import { parseInlineRuns } from '../../services/wordcraftBridge.js';
import { vaultApi } from '../vault/vaultApi.js';
import ShareModal from '../vault/ShareModal.jsx';
import './editor.css';

// Full-page WordCraft editor for LexAmplify. Three ways in:
//   /editor/:docId          a saved draft session (versions from the draft API)
//   /editor/vault/:vaultId  an existing Case Vault document (vault mode — saves update that document)
//   location.state.openDraft a draft handed off from the wizard / auto-draft
// The assistant runs the product's real inline-edit AI on the current selection and writes the
// result back with its formatting; export is a real .docx straight out of the engine. Once the
// document lives in Documents it autosaves to the server a moment after each change.

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const AUTOSAVE_MS = 2500;

const QUICK = [
  { label: 'Make formal', instruction: 'Rewrite this in a more formal, professional legal register.' },
  { label: 'Make concise', instruction: 'Make this more concise without losing legal meaning.' },
  { label: 'Plain language', instruction: 'Rewrite this in plainer, clearer language a client can understand.' },
  { label: 'Strengthen', instruction: 'Make this argument more forceful and persuasive, keeping the facts unchanged.' },
];

function htmlToPlain(html) {
  const el = document.createElement('div');
  el.innerHTML = String(html || '').replace(/<br\s*\/?>/gi, '\n');
  return (el.textContent || el.innerText || '').trim();
}

function timeAgo(ts, now) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h === 1 ? '1 hour ago' : `${h} hours ago`;
}

// Local-only marker: set while a server save is failing so a reload keeps the local copy instead
// of the (older) server copy. Cleared on the next successful save.
const dirtyKey = (id) => `lx-wcdirty-${id}`;
const snapKey = (id) => `lx-wcdoc-${id}`;

export default function WordCraftPage() {
  const { docId, vaultId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const handoff = location.state?.openDraft || null;
  const vaultMode = !!vaultId;

  const id = vaultMode ? `vault-${vaultId}` : (docId || handoff?.id || 'scratch');
  const [title, setTitle] = useState(handoff?.title || (vaultMode ? 'Loading…' : 'Untitled draft'));
  const [seedHtml, setSeedHtml] = useState(handoff?.html || '');
  const [bridge, setBridge] = useState(null);
  const [selection, setSelection] = useState('');
  const [saved, setSaved] = useState('saved');
  const [busy, setBusy] = useState(false);
  const [savedDocId, setSavedDocId] = useState(vaultMode ? vaultId : null);
  const [targetId, setTargetId] = useState(null); // the editable copy that saves update in place
  const [savingDoc, setSavingDoc] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [server, setServer] = useState({ state: 'idle', at: null, message: null }); // idle | saving | saved | error
  const [now, setNow] = useState(() => Date.now());
  const [log, setLog] = useState([{ who: 'ai', text: 'Select text in the document, then tell me how to change it — I’ll rewrite just that part.' }]);
  const [input, setInput] = useState('');
  // File to matter
  const [fileOpen, setFileOpen] = useState(false);
  const [cases, setCases] = useState(null);
  const [casesMsg, setCasesMsg] = useState(null);
  const [caseId, setCaseId] = useState('');
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState(null); // {caseTitle, location, id, html}
  const [shareOpen, setShareOpen] = useState(false);
  const [finalised, setFinalised] = useState(false);
  const [finalising, setFinalising] = useState(false);
  const finalisedRef = useRef(false);

  const wsRef = useRef(null);
  const saveTimer = useRef(null);
  const logRef = useRef(null);
  const autosaveTimer = useRef(null);
  const latestRef = useRef({ html: '', text: '' });
  const baselineRef = useRef(null);      // the HTML as first loaded — not an edit
  const lastSavedHtmlRef = useRef(null); // what the server has
  const savedDocIdRef = useRef(vaultMode ? vaultId : null);
  const targetRef = useRef(null);
  const titleRef = useRef(title);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  useEffect(() => { titleRef.current = title; }, [title]);

  // If opened by session id (and no hand-off html), load that saved draft.
  useEffect(() => {
    let alive = true;
    if (!vaultMode && docId && !handoff?.html) {
      // The session GET lists versions without their bodies; the latest version's document
      // comes from getVersion(sid, vid). Prefer an inlined document if the API ever adds one.
      getSession(docId)
        .then(async (s) => {
          if (!alive || !s) return;
          if (s.title) setTitle(s.title);
          let doc = s.document || null;
          if (!doc && Array.isArray(s.versions) && s.versions.length) {
            const latest = s.versions[s.versions.length - 1];
            try { const v = await getVersion(docId, latest.id); doc = v?.document || v || null; } catch { doc = null; }
          }
          if (!alive || !doc) return;
          if (doc.html) setSeedHtml(doc.html);
          else if (Array.isArray(doc.blocks)) setSeedHtml(blocksToHtml(doc.blocks));
          if (doc.title) setTitle(doc.title);
        })
        .catch(() => { /* a scratch doc or an unknown id just starts blank */ });
    }
    return () => { alive = false; };
  }, [docId, handoff, vaultMode]);

  // Vault mode: open the existing document from the Case Vault.
  useEffect(() => {
    if (!vaultMode) return undefined;
    let alive = true;
    vaultApi.content(vaultId)
      .then((c) => {
        if (!alive || !c) return;
        setTitle(c.title || `Document ${vaultId}`);
        // The editor itself owns the editable copy only when the vault row is one of the user's
        // edited copies; otherwise the first save creates one (the original is never touched).
        if (c.edited_copy) { targetRef.current = vaultId; setTargetId(vaultId); }
        let keepLocal = false;
        try { keepLocal = localStorage.getItem(dirtyKey(id)) === '1'; } catch { keepLocal = false; }
        if (keepLocal) {
          setLog((l) => [...l, { who: 'ai', text: 'Restored changes that had not reached the server yet. They will be saved on your next edit.' }]);
        } else {
          try { localStorage.removeItem(snapKey(id)); } catch { /* ignore */ }
        }
        setSeedHtml(c.html || '');
        if (!(c.html || '').trim()) setLog((l) => [...l, { who: 'ai', text: c.note || 'This document has no editable text yet.' }]);
      })
      .catch((e) => {
        if (!alive) return;
        setTitle('Document unavailable');
        setLog((l) => [...l, { who: 'ai', text: e?.message || 'Could not open this document from your Documents.' }]);
      });
    return () => { alive = false; };
  }, [vaultMode, vaultId, id]);

  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log, busy]);

  // Track the current selection so the assistant knows what to edit.
  useEffect(() => {
    if (!bridge) return undefined;
    const t = setInterval(() => setSelection(bridge.selection()), 500);
    return () => clearInterval(t);
  }, [bridge]);

  // Keep the "· 2 min ago" fresh.
  useEffect(() => {
    if (server.state !== 'saved') return undefined;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [server.state]);

  useEffect(() => () => { clearTimeout(autosaveTimer.current); clearTimeout(saveTimer.current); }, []);

  // Durable save into the user's real document store (Case Vault).
  //   vault mode:  save-edit on the opened document; the first save makes the editable copy
  //                (or updates it in place when the opened row already is one), later saves
  //                update that copy (target_id).
  //   otherwise:   the first save creates the document (draft-save); later saves update that
  //                same document (save-as with target_id).
  const persist = useCallback(async (html, { retried = false } = {}) => {
    const t = (titleRef.current || '').trim() || 'Untitled draft';
    try {
      let res;
      if (vaultMode) {
        res = await vaultApi.saveEdit(vaultId, { html, format: 'docx', title: t, target_id: targetRef.current || undefined });
      } else if (savedDocIdRef.current) {
        res = await vaultApi.saveAs(savedDocIdRef.current, { html, format: 'docx', title: t, destination: 'vault', target_id: targetRef.current || savedDocIdRef.current });
      } else {
        res = await vaultApi.draftSave({ html, title: t, format: 'docx', destination: 'vault' });
      }
      const newId = res?.id || res?.document?.id || res?.new_id || null;
      if (newId) {
        if (!savedDocIdRef.current) { savedDocIdRef.current = newId; setSavedDocId(newId); }
        targetRef.current = newId;
        setTargetId(newId);
      }
      lastSavedHtmlRef.current = html;
      try { localStorage.removeItem(dirtyKey(id)); } catch { /* ignore */ }
      return res;
    } catch (e) {
      // A stale edited-copy reference: fall back to creating a fresh copy once.
      if (!retried && e?.status === 404 && targetRef.current) {
        targetRef.current = null;
        setTargetId(null);
        return persist(html, { retried: true });
      }
      throw e;
    }
  }, [vaultMode, vaultId, id]);

  const autosaveNow = useCallback(async () => {
    if (finalisedRef.current) return; // a finalised document is locked
    const html = latestRef.current.html;
    const text = latestRef.current.text;
    if (!savedDocIdRef.current || !html || !(text || '').trim()) return; // never autosave an empty doc
    if (html === lastSavedHtmlRef.current) return;
    if (inFlightRef.current) { pendingRef.current = true; return; }
    inFlightRef.current = true;
    setServer((s) => ({ ...s, state: 'saving' }));
    try {
      await persist(html);
      setServer({ state: 'saved', at: Date.now(), message: null });
      setNow(Date.now());
    } catch (e) {
      try { localStorage.setItem(dirtyKey(id), '1'); } catch { /* ignore */ }
      setServer({ state: 'error', at: Date.now(), message: e?.message || 'Could not reach the server.' });
    } finally {
      inFlightRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        clearTimeout(autosaveTimer.current);
        autosaveTimer.current = setTimeout(() => { autosaveNow(); }, AUTOSAVE_MS);
      }
    }
  }, [persist, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleAutosave = useCallback(() => {
    if (!savedDocIdRef.current) return;
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => { autosaveNow(); }, AUTOSAVE_MS);
  }, [autosaveNow]);

  const onChange = useCallback((payload) => {
    setSaved('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaved('saved'), 600);
    if (!payload) return;
    latestRef.current = { html: payload.html || '', text: payload.text || '' };
    // The first change with content is the carry-in itself, not an edit.
    if (baselineRef.current === null) {
      if ((payload.text || '').trim()) baselineRef.current = payload.html || '';
      return;
    }
    const reference = lastSavedHtmlRef.current ?? baselineRef.current;
    if (payload.html && payload.html !== reference) scheduleAutosave();
  }, [scheduleAutosave]);

  async function runEdit(instruction) {
    if (!bridge || busy) return;
    if (finalised) { setLog((l) => [...l, { who: 'ai', text: 'This document is finalised and locked. Duplicate it to keep editing.' }]); return; }
    const sel = bridge.selection().trim();
    if (!sel) {
      setLog((l) => [...l, { who: 'ai', text: 'Select some text in the document first, then I’ll rewrite exactly that.' }]);
      return;
    }
    setLog((l) => [...l, { who: 'you', text: instruction }]);
    setBusy(true);
    try {
      const r = await inlineEditSelection(sel, instruction);
      if (r?.error || !r?.html) {
        setLog((l) => [...l, { who: 'ai', text: r?.message || 'The assistant could not rewrite that. Please retry.' }]);
      } else {
        // Keep the bold/italic/underline the rewrite carries; plain text if it cannot be parsed.
        let runs = [];
        try { runs = parseInlineRuns(r.html); } catch { runs = []; }
        let note = 'Rewrote the selected text.';
        if (!runs.length) {
          bridge.replaceSelection(htmlToPlain(r.html));
        } else {
          const res = await bridge.replaceSelectionWithRuns(runs);
          if (res.formatted) note = 'Rewrote the selected text, keeping its formatting.';
          if (res.skipped) note += ` ${res.skipped} formatted ${res.skipped === 1 ? 'span' : 'spans'} came back as plain text.`;
        }
        setLog((l) => [...l, { who: 'ai', text: note }]);
      }
    } catch (e) {
      setLog((l) => [...l, { who: 'ai', text: 'Edit failed: ' + (e.message || 'unknown error') }]);
    } finally {
      setBusy(false);
    }
  }

  function onSend(e) {
    e.preventDefault();
    const v = input.trim();
    if (!v) return;
    setInput('');
    runEdit(v);
  }

  function flash(msg) {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(null), 4000);
  }

  async function finalise() {
    if (finalising || finalised) return;
    // A finalised document must already live in the vault, so ensure it is saved first.
    let docId = savedDocIdRef.current;
    if (!docId) { await saveToDocuments(); docId = savedDocIdRef.current; }
    if (!docId) { setSaveMsg('Save to Documents before finalising.'); return; }
    setFinalising(true);
    try {
      await vaultApi.updateDoc(docId, { tags: 'FINAL' });
      finalisedRef.current = true;
      setFinalised(true);
      clearTimeout(autosaveTimer.current);
      setSaveMsg('Finalised and locked.');
    } catch (e) {
      setSaveMsg((e && e.message) || 'Could not finalise.');
    } finally {
      setFinalising(false);
      setTimeout(() => setSaveMsg(null), 4000);
    }
  }

  async function saveToDocuments() {
    if (!bridge || savingDoc) return;
    const html = bridge.html();
    if (!html || !html.trim() || !(bridge.text() || '').trim()) { flash('Nothing to save yet.'); return; }
    clearTimeout(autosaveTimer.current);
    setSavingDoc(true);
    setSaveMsg(null);
    setServer((s) => ({ ...s, state: 'saving' }));
    try {
      const res = await persist(html);
      setServer({ state: 'saved', at: Date.now(), message: null });
      setNow(Date.now());
      if (vaultMode && res?.created) flash(`Saved as “${res.title}” — the original stays unchanged.`);
      else flash('Saved to your Documents.');
    } catch (e) {
      try { localStorage.setItem(dirtyKey(id), '1'); } catch { /* ignore */ }
      setServer({ state: 'error', at: Date.now(), message: e?.message || 'Could not save.' });
      flash(e?.message || 'Could not save.');
    } finally {
      setSavingDoc(false);
    }
  }

  // --- File to matter -------------------------------------------------------------------
  async function openFilePicker() {
    setFileOpen((o) => !o);
    if (cases !== null) return;
    setCasesMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/practice/cases?per_page=50&sort=updated`);
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok) {
        setCases([]);
        setCasesMsg(data?.message || 'Could not load your matters.');
        return;
      }
      const list = Array.isArray(data?.cases) ? data.cases : (Array.isArray(data) ? data : []);
      setCases(list);
      if (!list.length) setCasesMsg('No matters yet. Add a case in Practice first.');
      else setCaseId(String(list[0].id));
    } catch {
      setCases([]);
      setCasesMsg('Could not reach the server.');
    }
  }

  async function fileToMatter() {
    if (!bridge || filing || !caseId) return;
    const html = bridge.html();
    if (!html || !html.trim() || !(bridge.text() || '').trim()) { setCasesMsg('Nothing to file yet.'); return; }
    const c = (cases || []).find((x) => String(x.id) === String(caseId));
    setFiling(true);
    setCasesMsg(null);
    try {
      const res = await vaultApi.draftSave({ html, title: (title || '').trim() || 'Untitled draft', format: 'docx', destination: 'practice', practice_case_id: Number(caseId) });
      const caseTitle = c?.title || c?.case_no || (res?.location || '').replace(/^Practice\s*\/\s*/, '') || 'the matter';
      setFiled({ caseTitle, location: res?.location || `Practice / ${caseTitle}`, id: res?.id || null, html });
      setFileOpen(false);
      flash(`Filed to ${caseTitle}.`);
    } catch (e) {
      setCasesMsg(e?.message || 'Could not file this draft.');
    } finally {
      setFiling(false);
    }
  }

  async function exportDocx() {
    if (!bridge) return;
    const bytes = await bridge.bytes('docx');
    if (!bytes) return;
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (title || 'draft').replace(/[^\w.-]+/g, '_') + '.docx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }

  function fullscreen() {
    const el = wsRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  }

  const shareId = targetId || savedDocId;
  const filedEdited = filed && latestRef.current.html && latestRef.current.html !== filed.html;

  let status;
  let statusClass = saved;
  if (saved === 'saving' || server.state === 'saving') { status = 'Autosaving…'; statusClass = 'saving'; }
  else if (server.state === 'error') { status = 'Not saved to Documents — changes kept here'; statusClass = 'error'; }
  else if (server.state === 'saved' && server.at) status = `Saved to Documents · ${timeAgo(server.at, now)}`;
  else if (savedDocId) status = vaultMode ? 'Opened from Documents — changes autosave' : 'Saved to Documents';
  else status = 'Autosaved locally — use Save to Documents to keep it in your vault';

  const pickerStyle = {
    position: 'absolute', right: 16, top: '100%', marginTop: 8, zIndex: 30, width: 320,
    background: 'var(--paper)', color: 'var(--ink)', border: '1px solid var(--rule)', borderRadius: 12,
    boxShadow: '0 14px 40px rgba(0,0,0,.18)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
  };
  const selectStyle = {
    width: '100%', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--rule)',
    borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none',
  };
  const chipStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 999, fontSize: 11.5,
    fontWeight: 600, letterSpacing: '0.02em', border: '1px solid var(--rule)', color: 'var(--ink-soft)', background: 'var(--paper-2)', whiteSpace: 'nowrap',
  };

  return (
    <div className="wcp" ref={wsRef}>
      <header className="wcp-head" style={{ position: 'relative' }}>
        <div className="wcp-head-l">
          <button className="wcp-back" onClick={() => navigate(-1)} aria-label="Back">←</button>
          <input className="wcp-title" value={title} onChange={(e) => { setTitle(e.target.value); scheduleAutosave(); }} spellCheck={false} aria-label="Document title" />
          <span className={`wcp-save wcp-save--${statusClass}`} style={server.state === 'error' ? { color: 'var(--accent)' } : undefined} title={server.state === 'error' ? `${server.message || 'Could not reach the server.'} Your changes stay in this browser and will be retried on your next edit.` : ''} aria-live="polite">{status}</span>
          {filed && (
            <span style={chipStyle} title={filed.location}>
              {filedEdited ? `Filed to ${filed.caseTitle} · edited since` : `Filed to ${filed.caseTitle}`}
            </span>
          )}
        </div>
        <div className="wcp-head-r">
          {saveMsg && <span className="wcp-savemsg">{saveMsg}</span>}
          <button className="wcp-btn" onClick={fullscreen}>Focus</button>
          <button className="wcp-btn" onClick={exportDocx}>Export .docx</button>
          <button
            className="wcp-btn"
            onClick={() => shareId && setShareOpen(true)}
            disabled={!shareId}
            title={shareId ? 'Share this document with your team' : 'Save to Documents first'}
          >
            Share
          </button>
          <button className="wcp-btn" onClick={openFilePicker} aria-expanded={fileOpen} aria-haspopup="dialog" disabled={finalised}>File to matter</button>
          {finalised ? (
            <span className="wcp-finalchip" title="This document is finalised and locked">Finalised</span>
          ) : (
            <>
              <button className="wcp-btn wcp-btn--primary" onClick={saveToDocuments} disabled={savingDoc}>{savingDoc ? 'Saving…' : 'Save to Documents'}</button>
              <button className="wcp-btn wcp-btn--gold" onClick={finalise} disabled={finalising} title="Lock this draft as the final version">{finalising ? 'Finalising…' : 'Finalise'}</button>
            </>
          )}
        </div>

        {fileOpen && (
          <div style={pickerStyle} role="dialog" aria-label="File this draft to a matter">
            <div style={{ fontSize: 13, fontWeight: 600 }}>File to a Practice matter</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Saves a Word copy of this draft into the matter’s documents and timeline.</div>
            {cases === null && !casesMsg && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Loading your matters…</div>}
            {cases && cases.length > 0 && (
              <select style={selectStyle} value={caseId} onChange={(e) => setCaseId(e.target.value)} aria-label="Matter">
                {cases.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {[c.title || `Case ${c.id}`, c.case_no].filter(Boolean).join(' — ')}
                  </option>
                ))}
              </select>
            )}
            {casesMsg && <div style={{ fontSize: 12.5, color: 'var(--accent)' }}>{casesMsg}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="wcp-btn" onClick={() => setFileOpen(false)}>Cancel</button>
              <button className="wcp-btn wcp-btn--primary" onClick={fileToMatter} disabled={filing || !caseId || !(cases && cases.length)}>
                {filing ? 'Filing…' : 'File to matter'}
              </button>
            </div>
          </div>
        )}
      </header>

      <div className="wcp-body">
        <div className="wcp-editor">
          <WordCraftEditor key={id} docId={id} seedHtml={seedHtml} onBridge={setBridge} onChange={onChange} />
        </div>

        <aside className="wcp-ai">
          <div className="wcp-ai-head">AI assistant</div>
          <div className="wcp-ai-log" ref={logRef} role="log" aria-live="polite" aria-label="AI assistant conversation">
            {log.map((m, i) => <div key={i} className={`wcp-msg wcp-msg--${m.who}`}>{m.text}</div>)}
            {busy && <div className="wcp-msg wcp-msg--ai wcp-typing"><span /><span /><span /></div>}
          </div>
          <div className="wcp-ai-foot">
            <div className="wcp-chips">
              {QUICK.map((q) => <button key={q.label} className="wcp-chip" disabled={busy} onClick={() => runEdit(q.instruction)}>{q.label}</button>)}
            </div>
            <form className="wcp-input" onSubmit={onSend}>
              <input value={input} onChange={(e) => setInput(e.target.value)} aria-label="Describe how to change the selected text" placeholder={selection ? 'Rewrite the selected text…' : 'Select text, then describe the change…'} disabled={busy} />
              <button type="submit" disabled={busy || !input.trim()} aria-label="Send">→</button>
            </form>
            <div className="wcp-hint">{selection ? `Editing ${selection.length} selected characters` : 'Nothing selected — highlight text in the document first'}</div>
          </div>
        </aside>
      </div>

      <ShareModal isOpen={shareOpen && !!shareId} item={shareId ? { id: shareId, type: 'document', name: title } : null} onClose={() => setShareOpen(false)} />
    </div>
  );
}
