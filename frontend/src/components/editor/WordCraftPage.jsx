import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import WordCraftEditor from './WordCraftEditor.jsx';
import { inlineEditSelection } from '../../services/api.js';
import { getSession, getVersion, blocksToHtml } from '../../services/draftApi.js';
import { vaultApi } from '../vault/vaultApi.js';
import './editor.css';

// Full-page WordCraft editor for LexAmplify. A draft handed off from the wizard / auto-draft
// (via location.state.openDraft) or loaded from a saved session carries into WordCraft; the
// assistant runs the product's real inline-edit AI on the current selection; export is a real
// .docx straight out of the engine.

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

export default function WordCraftPage() {
  const { docId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const handoff = location.state?.openDraft || null;

  const id = docId || handoff?.id || 'scratch';
  const [title, setTitle] = useState(handoff?.title || 'Untitled draft');
  const [seedHtml, setSeedHtml] = useState(handoff?.html || '');
  const [bridge, setBridge] = useState(null);
  const [selection, setSelection] = useState('');
  const [saved, setSaved] = useState('saved');
  const [busy, setBusy] = useState(false);
  const [savedDocId, setSavedDocId] = useState(null);
  const [savingDoc, setSavingDoc] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [log, setLog] = useState([{ who: 'ai', text: 'Select text in the document, then tell me how to change it — I’ll rewrite just that part.' }]);
  const [input, setInput] = useState('');
  const wsRef = useRef(null);
  const saveTimer = useRef(null);
  const logRef = useRef(null);

  // If opened by session id (and no hand-off html), load that saved draft.
  useEffect(() => {
    let alive = true;
    if (docId && !handoff?.html) {
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
  }, [docId, handoff]);

  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log, busy]);

  // Track the current selection so the assistant knows what to edit.
  useEffect(() => {
    if (!bridge) return undefined;
    const t = setInterval(() => setSelection(bridge.selection()), 500);
    return () => clearInterval(t);
  }, [bridge]);

  const onChange = useCallback(() => {
    setSaved('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaved('saved'), 600);
  }, []);

  async function runEdit(instruction) {
    if (!bridge || busy) return;
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
        bridge.replaceSelection(htmlToPlain(r.html));
        setLog((l) => [...l, { who: 'ai', text: 'Rewrote the selected text.' }]);
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

  // Durable save into the user's real document store (Case Vault). First save creates the
  // document (draft-save); later saves update that same document (save-as).
  async function saveToDocuments() {
    if (!bridge || savingDoc) return;
    const html = bridge.html();
    if (!html || !html.trim()) { setSaveMsg('Nothing to save yet.'); return; }
    setSavingDoc(true);
    setSaveMsg(null);
    try {
      let res;
      if (savedDocId) {
        res = await vaultApi.saveAs(savedDocId, { html, format: 'docx', title });
      } else {
        res = await vaultApi.draftSave({ html, title, format: 'docx', destination: 'vault' });
        const newId = res?.id || res?.document?.id || res?.new_id;
        if (newId) setSavedDocId(newId);
      }
      if (res?.error) setSaveMsg(res.message || 'Could not save.');
      else setSaveMsg('Saved to your Documents.');
    } catch (e) {
      setSaveMsg(e.message || 'Could not save.');
    } finally {
      setSavingDoc(false);
      setTimeout(() => setSaveMsg(null), 4000);
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

  return (
    <div className="wcp" ref={wsRef}>
      <header className="wcp-head">
        <div className="wcp-head-l">
          <button className="wcp-back" onClick={() => navigate(-1)} aria-label="Back">←</button>
          <input className="wcp-title" value={title} onChange={(e) => setTitle(e.target.value)} spellCheck={false} aria-label="Document title" />
          <span className={`wcp-save wcp-save--${saved}`}>{saved === 'saving' ? 'Saving…' : 'Saved on this device'}</span>
        </div>
        <div className="wcp-head-r">
          {saveMsg && <span className="wcp-savemsg">{saveMsg}</span>}
          <button className="wcp-btn" onClick={fullscreen}>Focus</button>
          <button className="wcp-btn" onClick={exportDocx}>Export .docx</button>
          <button className="wcp-btn wcp-btn--primary" onClick={saveToDocuments} disabled={savingDoc}>{savingDoc ? 'Saving…' : 'Save to Documents'}</button>
        </div>
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
    </div>
  );
}
