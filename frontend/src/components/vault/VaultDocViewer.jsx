import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { marked } from 'marked';
import ContractTiptapEditor from '../ContractTiptapEditor.jsx';
import { rawTextToHtml, sanitizeHtml } from '../../tiptap/textToHtml.js';
import { vaultApi } from './vaultApi.js';

// In-app viewer for a Case Vault document: Preview (the real file, never a download) and Edit (the same Tiptap
// editor Auto-Draft Studio uses), with a separate assistant that reads only this document. Edits are saved as a
// new DOCX copy in the vault - the original file is never overwritten.

const QUICK = [
  { label: 'Summarise', prompt: 'Summarise this document for me in plain language: what it is, who is involved, and what it asks for or decides.' },
  { label: 'Key dates & deadlines', prompt: 'List every date, deadline and next step mentioned in this document, in order, with what happens on each.' },
  { label: 'Parties & claims', prompt: 'Who are the parties, their counsel, and what does each side claim or admit in this document?' },
  { label: 'Next steps', prompt: 'Based only on this document, what should the advocate do next on this matter, and by when?' },
  { label: 'Client update', prompt: 'Draft a short, plain-language update for the client about this document (no legal jargon, 120 words).' },
  { label: 'Spot gaps', prompt: 'Point out anything missing, inconsistent or risky in this document that the advocate should check.' },
];
const SELECTION_QUICK = [
  { label: 'Improve wording', prompt: 'Rewrite my selected text to be clearer and more precise, keeping the legal meaning. Return only the rewritten text.' },
  { label: 'More formal', prompt: 'Rewrite my selected text in formal legal drafting language. Return only the rewritten text.' },
  { label: 'Explain selection', prompt: 'Explain my selected text in plain language and say what to watch out for.' },
];

const styles = `
  .vdv-root { --vdv-page:#FFFFFF; --vdv-page-ink:#23262A; position: fixed; inset: 0; z-index: 10000; display: flex; flex-direction: column; background: var(--paper, #FBFAF7); color: var(--ink, #1B1D1F); font-family: 'IBM Plex Sans', sans-serif; }
  :root[data-theme="dark"] .vdv-root { --vdv-page:#26292B; --vdv-page-ink:#EDEBE5; }
  .vdv-head { display: flex; align-items: center; gap: 14px; padding: 12px 18px; border-bottom: 1px solid var(--rule, #E5E1D8); flex-shrink: 0; flex-wrap: wrap; }
  .vdv-title { font-family: 'Source Serif 4', Georgia, serif; font-size: 19px; font-weight: 600; margin: 0; max-width: 46vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .vdv-chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .vdv-chip { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--rule, #E5E1D8); background: var(--paper-2, #F3F0E9); color: var(--ink-soft, #55595C); cursor: default; }
  .vdv-chip.link { cursor: pointer; color: var(--accent, #C8553D); border-color: var(--accent, #C8553D); background: transparent; }
  .vdv-spacer { flex: 1; }
  .vdv-seg { display: inline-flex; border: 1px solid var(--rule, #E5E1D8); border-radius: 9px; overflow: hidden; }
  .vdv-seg button { border: 0; background: transparent; color: var(--ink-soft, #55595C); padding: 7px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .vdv-seg button.on { background: var(--accent, #C8553D); color: #fff; }
  .vdv-seg button:disabled { opacity: .45; cursor: not-allowed; }
  .vdv-btn { border: 1px solid var(--rule, #E5E1D8); background: var(--paper, #FBFAF7); color: var(--ink, #1B1D1F); border-radius: 9px; padding: 7px 13px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .vdv-btn:hover:not(:disabled) { background: var(--paper-2, #F3F0E9); }
  .vdv-btn.primary { background: var(--accent, #C8553D); border-color: var(--accent, #C8553D); color: #fff; }
  .vdv-btn.primary:hover:not(:disabled) { filter: brightness(1.06); background: var(--accent, #C8553D); }
  .vdv-btn:disabled { opacity: .5; cursor: not-allowed; }
  .vdv-main { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 392px; }
  .vdv-main.noai { grid-template-columns: minmax(0, 1fr); }
  .vdv-stage { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--paper-2, #F3F0E9); }
  .vdv-toolbar-slot { flex-shrink: 0; border-bottom: 1px solid var(--rule, #E5E1D8); background: var(--paper, #FBFAF7); padding: 4px 12px; min-height: 0; overflow-x: auto; }
  .vdv-toolbar-slot:empty { display: none; }
  .vdv-banner { flex-shrink: 0; padding: 9px 18px; font-size: 12.5px; border-bottom: 1px solid var(--rule, #E5E1D8); background: var(--accent-soft, #F7E3DC); color: var(--ink, #1B1D1F); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .vdv-banner.ok { background: rgba(46,125,50,.12); }
  .vdv-banner.err { background: rgba(198,40,40,.12); }
  .vdv-banner button { border: 0; background: transparent; color: inherit; font-weight: 700; cursor: pointer; text-decoration: underline; font-size: 12.5px; }
  .vdv-scroll { flex: 1; min-height: 0; overflow: auto; padding: 28px 24px 60px; }
  .vdv-frame { width: 100%; height: 100%; border: 0; background: #fff; display: block; }
  .vdv-img-wrap { display: flex; justify-content: center; }
  .vdv-img-wrap img { max-width: 100%; height: auto; box-shadow: var(--shadow, 0 10px 30px rgba(0,0,0,.2)); background: #fff; }
  .vdv-page { max-width: 820px; margin: 0 auto; background: var(--vdv-page); color: var(--vdv-page-ink); border-radius: 6px; box-shadow: var(--shadow, 0 10px 30px rgba(0,0,0,.18)); padding: 64px 72px; min-height: 900px; font-family: 'Source Serif 4', Georgia, serif; font-size: 11pt; line-height: 1.7; }
  .vdv-page h1, .vdv-page h2, .vdv-page h3, .vdv-page h4 { font-size: 1.2em; margin: 26px 0 8px; }
  .vdv-page h1:first-child, .vdv-page h2:first-child, .vdv-page h3:first-child { margin-top: 0; }
  .vdv-page p { margin: 0 0 12px; }
  .vdv-edit-wrap .ProseMirror { max-width: 820px; margin: 0 auto; background: var(--vdv-page); color: var(--vdv-page-ink); border-radius: 6px; box-shadow: var(--shadow, 0 10px 30px rgba(0,0,0,.18)); padding: 64px 72px; min-height: 900px; font-family: 'Source Serif 4', Georgia, serif; font-size: 11pt; line-height: 1.7; outline: none; }
  .vdv-edit-wrap .ProseMirror p { margin: 0 0 12px; }
  .vdv-edit-wrap .ProseMirror h1, .vdv-edit-wrap .ProseMirror h2, .vdv-edit-wrap .ProseMirror h3 { font-size: 1.2em; margin: 24px 0 8px; }
  .vdv-edit-wrap .tiptap-editor-shell { border: none !important; box-shadow: none !important; background: transparent !important; }
  .vdv-edit-wrap .rich-text-toolbar { border: 0 !important; background: transparent !important; padding: 0 !important; }
  .vdv-state { margin: auto; text-align: center; color: var(--ink-soft, #55595C); font-size: 14px; max-width: 420px; padding: 40px 20px; line-height: 1.6; }
  .vdv-ai { border-left: 1px solid var(--rule, #E5E1D8); background: var(--paper, #FBFAF7); display: flex; flex-direction: column; min-height: 0; }
  .vdv-ai-head { padding: 14px 16px 10px; border-bottom: 1px solid var(--rule, #E5E1D8); flex-shrink: 0; }
  .vdv-ai-title { font-family: 'Source Serif 4', Georgia, serif; font-size: 16px; font-weight: 600; margin: 0 0 3px; display: flex; align-items: center; gap: 8px; }
  .vdv-ai-sub { font-size: 11.5px; color: var(--muted, #7A7E80); line-height: 1.5; }
  .vdv-quick { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 16px; border-bottom: 1px solid var(--rule, #E5E1D8); flex-shrink: 0; }
  .vdv-quick button { border: 1px solid var(--rule, #E5E1D8); background: var(--paper-2, #F3F0E9); color: var(--ink, #1B1D1F); border-radius: 999px; padding: 5px 11px; font-size: 11.5px; font-weight: 600; cursor: pointer; }
  .vdv-quick button:hover:not(:disabled) { border-color: var(--accent, #C8553D); color: var(--accent, #C8553D); }
  .vdv-quick button:disabled { opacity: .5; cursor: not-allowed; }
  .vdv-chat { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
  .vdv-empty { font-size: 12.5px; color: var(--muted, #7A7E80); line-height: 1.6; }
  .vdv-msg { max-width: 100%; font-size: 13px; line-height: 1.6; border-radius: 12px; padding: 10px 12px; word-break: break-word; }
  .vdv-msg.user { align-self: flex-end; background: var(--accent-soft, #F7E3DC); border: 1px solid transparent; }
  .vdv-msg.assistant { background: var(--paper-2, #F3F0E9); border: 1px solid var(--rule, #E5E1D8); }
  .vdv-msg p { margin: 0 0 8px; } .vdv-msg p:last-child { margin-bottom: 0; }
  .vdv-msg ul, .vdv-msg ol { margin: 4px 0 8px 18px; padding: 0; }
  .vdv-msg-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .vdv-msg-actions button { border: 0; background: transparent; color: var(--accent, #C8553D); font-size: 11.5px; font-weight: 700; cursor: pointer; padding: 0; }
  .vdv-warn { font-size: 11px; color: var(--muted, #7A7E80); margin-top: 6px; }
  .vdv-typing { font-size: 12px; color: var(--muted, #7A7E80); }
  .vdv-compose { border-top: 1px solid var(--rule, #E5E1D8); padding: 10px 14px 14px; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; }
  .vdv-sel { font-size: 11.5px; color: var(--accent, #C8553D); font-weight: 600; display: flex; gap: 8px; align-items: center; }
  .vdv-compose textarea { width: 100%; resize: none; border: 1px solid var(--rule, #E5E1D8); border-radius: 10px; padding: 9px 11px; font: inherit; font-size: 13px; background: var(--paper, #FBFAF7); color: inherit; outline: none; }
  .vdv-compose textarea:focus { border-color: var(--accent, #C8553D); }
  @media (max-width: 960px) {
    .vdv-main { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 46vh); }
    .vdv-ai { border-left: 0; border-top: 1px solid var(--rule, #E5E1D8); }
    .vdv-page, .vdv-edit-wrap .ProseMirror { padding: 36px 24px; }
    .vdv-title { max-width: 60vw; }
  }
`;

function mdToHtml(text) {
  try {
    return sanitizeHtml(marked.parse(String(text || ''), { async: false }));
  } catch {
    return sanitizeHtml(rawTextToHtml(text));
  }
}

export default function VaultDocViewer({ docId, fallbackName, onClose, onChanged }) {
  const navigate = useNavigate();
  const [load, setLoad] = useState({ loading: true, error: null, doc: null });
  const [mode, setMode] = useState('preview');
  const [fileUrl, setFileUrl] = useState(null);
  const [html, setHtml] = useState('');
  const [liveText, setLiveText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [toolbarEl, setToolbarEl] = useState(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState('');
  const editorRef = useRef(null);
  const chatRef = useRef(null);
  const abortRef = useRef(null);

  // ── load the document ──
  useEffect(() => {
    const ac = new AbortController();
    let url = null;
    setLoad({ loading: true, error: null, doc: null });
    setMode('preview'); setFileUrl(null); setMsgs([]); setDirty(false); setSavedId(null); setNotice(null);
    (async () => {
      try {
        const doc = await vaultApi.content(docId, ac.signal);
        if (ac.signal.aborted) return;
        setHtml(doc.html || ''); setLiveText(doc.text || '');
        setLoad({ loading: false, error: null, doc });
        if (doc.previewable) {
          try {
            const blob = await vaultApi.viewBlob(docId, ac.signal);
            if (ac.signal.aborted) return;
            url = URL.createObjectURL(blob);
            setFileUrl(url);
          } catch (e) {
            if (e?.name !== 'AbortError') setNotice({ kind: 'err', text: e.message || 'The file could not be shown; its text is available in Edit.' });
          }
        }
      } catch (e) {
        if (e?.name === 'AbortError') return;
        setLoad({ loading: false, error: e.message || 'Could not open this document.', doc: null });
      }
    })();
    return () => { ac.abort(); if (url) URL.revokeObjectURL(url); };
  }, [docId]);

  const doc = load.doc;
  const title = doc?.title || fallbackName || 'Document';
  const isFile = doc?.previewable;                       // pdf / image / txt: preview shows the file itself
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(doc?.ext);
  const canEdit = !!doc && doc.can_edit !== false;

  const requestClose = useCallback(() => {
    if (dirty) setConfirmClose(true); else onClose();
  }, [dirty, onClose]);

  // The editor reports changes on a short debounce; read it directly so a quick Save never misses the last keystrokes.
  const currentHtml = useCallback(() => {
    const ed = editorRef.current;
    return mode === 'edit' && ed && !ed.isDestroyed ? ed.getHTML() : html;
  }, [mode, html]);

  const save = useCallback(async () => {
    if (!doc || saving) return;
    setSaving(true); setNotice(null);
    try {
      const target = savedId || (doc.edited_copy ? docId : undefined);
      const r = await vaultApi.saveEdit(docId, { html: currentHtml(), target_id: target });
      setSavedId(r.id); setDirty(false);
      setNotice({ kind: 'ok', text: r.created ? `Saved as a new DOCX in your vault: “${r.title}”. The original is unchanged.` : `Saved changes to “${r.title}”.` });
      onChanged?.();
    } catch (e) {
      setNotice({ kind: 'err', text: e.message || 'Could not save.' });
    } finally {
      setSaving(false);
    }
  }, [doc, saving, savedId, docId, currentHtml, onChanged]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); requestClose(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && mode === 'edit') { e.preventDefault(); save(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [requestClose, save, mode]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { const el = chatRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, busy]);

  const onEditorReady = useCallback((ed) => {
    editorRef.current = ed;
    if (!ed || ed.__vdvBound) return;
    ed.__vdvBound = true;
    const sync = () => {
      const { from, to } = ed.state.selection;
      setSelection(from === to ? '' : ed.state.doc.textBetween(from, to, '\n').slice(0, 4000));
    };
    ed.on('selectionUpdate', sync);
    ed.on('blur', () => {});
  }, []);

  const ask = useCallback(async (text) => {
    const q = (text || '').trim();
    if (!q || busy || !doc) return;
    const history = msgs.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: 'user', content: q }]);
    setDraft(''); setBusy(true);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await vaultApi.assistant(docId, {
        message: q, history,
        selection: mode === 'edit' ? selection : '',
        document_text: mode === 'edit' ? liveText : undefined,
      }, ac.signal);
      setMsgs((m) => [...m, { role: 'assistant', content: r.answer, ai: r.ai !== false }]);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      setMsgs((m) => [...m, { role: 'assistant', content: e.message || 'The assistant could not answer just now.', ai: false, failed: true }]);
    } finally {
      setBusy(false);
    }
  }, [busy, doc, msgs, docId, mode, selection, liveText]);

  const insertIntoEditor = (content) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.chain().focus().insertContent(rawTextToHtml(content)).run();
  };
  const copy = async (content) => {
    try { await navigator.clipboard.writeText(content); setNotice({ kind: 'ok', text: 'Copied.' }); } catch { setNotice({ kind: 'err', text: 'Copy is blocked by the browser here.' }); }
  };

  const exportDocx = async () => {
    try {
      await vaultApi.exportDocx(docId, { html: currentHtml() || '<p></p>', title }, `${title}.docx`);
    } catch (e) {
      setNotice({ kind: 'err', text: e.message || 'Could not export.' });
    }
  };
  const downloadOriginal = async () => {
    try { await vaultApi.downloadOriginal(docId, title); } catch (e) { setNotice({ kind: 'err', text: e.message || 'Could not download.' }); }
  };

  const quick = useMemo(() => (mode === 'edit' && selection ? [...SELECTION_QUICK, ...QUICK.slice(0, 3)] : QUICK), [mode, selection]);
  const openCase = () => {
    if (!doc?.case) return;
    if (dirty) { setConfirmClose(true); return; }
    onClose(); navigate(`/practice/cases/${doc.case.id}`);
  };

  const info = doc?.info || {};
  const chips = [info.doc_class, info.doc_date && `Dated ${info.doc_date}`, info.next_hearing && `Next hearing ${info.next_hearing}`, info.court].filter(Boolean);
  const isPdfOrImage = isFile && doc?.ext !== 'txt';

  return createPortal(
    <div className="vdv-root" role="dialog" aria-modal="true" aria-label={`Document: ${title}`}>
      <style>{styles}</style>
      <header className="vdv-head">
        <button type="button" className="vdv-btn" onClick={requestClose} aria-label="Close viewer">← Back to vault</button>
        <h2 className="vdv-title" title={title}>{title}</h2>
        <div className="vdv-chips">
          {chips.map((c) => <span key={c} className="vdv-chip">{c}</span>)}
          {doc?.case && <span className="vdv-chip link" role="link" tabIndex={0} onClick={openCase} onKeyDown={(e) => e.key === 'Enter' && openCase()} title="Open this matter in Practice">{doc.case.case_no} · {doc.case.title}</span>}
        </div>
        <div className="vdv-spacer" />
        {doc && (
          <div className="vdv-seg" role="tablist" aria-label="View mode">
            <button type="button" role="tab" aria-selected={mode === 'preview'} className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>Preview</button>
            <button type="button" role="tab" aria-selected={mode === 'edit'} className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')} disabled={!canEdit} title={canEdit ? 'Edit in the document editor' : 'You have view-only access'}>Edit</button>
          </div>
        )}
        {doc && mode === 'edit' && (
          <button type="button" className="vdv-btn primary" onClick={save} disabled={saving || (!dirty && !!savedId)}>
            {saving ? 'Saving…' : dirty || !savedId ? 'Save as DOCX' : 'Saved'}
          </button>
        )}
        {doc && <button type="button" className="vdv-btn" onClick={exportDocx} title="Download the text shown here as a Word file">Export .docx</button>}
        {doc && <button type="button" className="vdv-btn" onClick={downloadOriginal} title="Download the original file">Download original</button>}
        <button type="button" className="vdv-btn" onClick={() => setAiOpen((v) => !v)} aria-pressed={aiOpen}>{aiOpen ? 'Hide assistant' : 'AI assistant'}</button>
      </header>

      <div className={`vdv-main${aiOpen ? '' : ' noai'}`}>
        <section className="vdv-stage">
          {confirmClose && (
            <div className="vdv-banner err" role="alert">
              You have unsaved edits.
              <button type="button" onClick={async () => { await save(); setConfirmClose(false); onClose(); }}>Save and close</button>
              <button type="button" onClick={() => { setConfirmClose(false); onClose(); }}>Discard</button>
              <button type="button" onClick={() => setConfirmClose(false)}>Keep editing</button>
            </div>
          )}
          {notice && <div className={`vdv-banner ${notice.kind}`} role="status">{notice.text}<button type="button" onClick={() => setNotice(null)}>Dismiss</button></div>}
          {mode === 'edit' && doc && isPdfOrImage && (
            <div className="vdv-banner">You are editing the text read from this {isImage ? 'image' : 'PDF'}. Saving creates a new editable DOCX copy; the original file stays exactly as it is.</div>
          )}
          {mode === 'edit' && doc && !isPdfOrImage && !doc.edited_copy && (
            <div className="vdv-banner">Saving creates an “(edited)” DOCX copy next to this document; the original is never overwritten.</div>
          )}
          {doc?.note && <div className="vdv-banner">{doc.note}</div>}
          <div className="vdv-toolbar-slot" ref={setToolbarEl} style={mode === 'edit' ? undefined : { display: 'none' }} />

          {load.loading && <div className="vdv-state">Opening document…</div>}
          {load.error && <div className="vdv-state" role="alert">{load.error}<br /><br /><button type="button" className="vdv-btn" onClick={onClose}>Back to vault</button></div>}

          {doc && mode === 'preview' && (
            fileUrl && isFile && doc.ext !== 'txt' ? (
              isImage
                ? <div className="vdv-scroll"><div className="vdv-img-wrap"><img src={fileUrl} alt={title} /></div></div>
                : <iframe className="vdv-frame" title={title} src={fileUrl} />
            ) : html.trim() ? (
              <div className="vdv-scroll"><div className="vdv-page" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} /></div>
            ) : (
              <div className="vdv-state">There is no readable text to show for this file yet. Use <b>Download original</b> to open it, or <b>Edit</b> to start a typed copy.</div>
            )
          )}

          {doc && mode === 'edit' && (
            <div className="vdv-scroll vdv-edit-wrap">
              <ContractTiptapEditor
                documentKey={`vault-${docId}`}
                initialHtml={html || '<p></p>'}
                onHtmlChange={(h) => { setHtml(h); setDirty(true); }}
                onTextChange={setLiveText}
                onEditorReady={onEditorReady}
                clauses={[]}
                toolbarPortalTarget={toolbarEl}
              />
            </div>
          )}
        </section>

        {aiOpen && (
          <aside className="vdv-ai" aria-label="Document assistant">
            <div className="vdv-ai-head">
              <h3 className="vdv-ai-title">Document assistant</h3>
              <div className="vdv-ai-sub">Reads only this document{mode === 'edit' ? ' (including your unsaved edits)' : ''}. Check anything it tells you against the source before relying on it.</div>
            </div>
            <div className="vdv-quick">
              {quick.map((q) => <button key={q.label} type="button" onClick={() => ask(q.prompt)} disabled={busy || !doc}>{q.label}</button>)}
            </div>
            <div className="vdv-chat" ref={chatRef} aria-live="polite">
              {msgs.length === 0 && !busy && (
                <div className="vdv-empty">Ask about this document, or pick an action above.{mode === 'edit' ? ' Select text in the editor to rewrite or explain just that part.' : ' Switch to Edit to rewrite parts of it with the assistant.'}</div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={`vdv-msg ${m.role}`}>
                  {m.role === 'assistant' ? <div dangerouslySetInnerHTML={{ __html: mdToHtml(m.content) }} /> : m.content}
                  {m.role === 'assistant' && !m.failed && (
                    <>
                      <div className="vdv-msg-actions">
                        {mode === 'edit' && <button type="button" onClick={() => insertIntoEditor(m.content)}>{selection ? 'Replace selection' : 'Insert at cursor'}</button>}
                        <button type="button" onClick={() => copy(m.content)}>Copy</button>
                      </div>
                      {m.ai === false && <div className="vdv-warn">Plain read-out of the document — the AI service did not answer.</div>}
                    </>
                  )}
                </div>
              ))}
              {busy && <div className="vdv-typing">Reading the document…</div>}
            </div>
            <form className="vdv-compose" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
              {mode === 'edit' && selection && <div className="vdv-sel">Using your selection ({selection.length} characters)</div>}
              <textarea
                rows={2}
                value={draft}
                placeholder="Ask about this document…"
                aria-label="Ask the document assistant"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft); } }}
                disabled={!doc}
              />
              <button type="submit" className="vdv-btn primary" disabled={busy || !draft.trim() || !doc}>{busy ? 'Thinking…' : 'Ask'}</button>
            </form>
          </aside>
        )}
      </div>
    </div>,
    document.body
  );
}
