import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import { ArrowLeft, FileText, Save, ChevronDown, Download, Sparkles, FileType2, FileCode2, ExternalLink, Check, X, Loader2, ImageIcon } from 'lucide-react';
import { vaultApi, saveBlob } from './vaultApi.js';
import { wordExtensions } from './word/wordExtensions.js';
import Ribbon from './word/Ribbon.jsx';
import FindBar from './word/FindBar.jsx';
import SaveAsDialog from './word/SaveAsDialog.jsx';
import AssistantPanel from './word/AssistantPanel.jsx';
import { wordStyles } from './word/wordStyles.js';

// The Case Vault's document workspace: ONE mode. The document opens as an editable page that keeps its layout (centred
// headings, signatures, tables, lists, fonts), with a Word-style ribbon, find & replace, and a separate assistant that reads
// only this document. Saving always makes a copy - Word, PDF or text - on this computer, in the vault, the Document Hub,
// a Practice matter or the Firm Library. The original file is never overwritten.

const EXT = { docx: '.docx', pdf: '.pdf', txt: '.txt' };
const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf', txt: 'text/plain' };
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const PAGE_W = 794;
const PAGE_H = 1123;

function baseName(title) {
  return String(title || 'Document').replace(/\.(pdf|docx?|txt|rtf|png|jpe?g|gif|webp)$/i, '').trim() || 'Document';
}

export default function VaultDocViewer({ docId, fallbackName, onClose, onChanged }) {
  const navigate = useNavigate();
  const [load, setLoad] = useState({ loading: true, error: null, doc: null });
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [pendingClose, setPendingClose] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [banner, setBanner] = useState(null);
  const [selection, setSelection] = useState('');
  const [zoom, setZoom] = useState(1);
  const [fitting, setFitting] = useState(true);
  const [guides, setGuides] = useState(true);
  const [spell, setSpell] = useState(true);
  const [counts, setCounts] = useState({ words: 0, chars: 0, pages: 1, page: 1 });
  const deskRef = useRef(null);
  const sheetRef = useRef(null);
  const menuRef = useRef(null);
  const loadedRef = useRef(false);
  const toastTimer = useRef(null);

  const notify = useCallback((kind, text, ms = 6500) => {
    setToast({ kind, text });
    clearTimeout(toastTimer.current);
    if (ms) toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const measure = useCallback((ed) => {
    if (!ed || ed.isDestroyed) return;
    const text = ed.getText();
    const dom = ed.view.dom;
    const ratio = dom.offsetWidth ? dom.offsetHeight / (dom.offsetWidth * (PAGE_H / PAGE_W)) : 1;
    setCounts((c) => ({ ...c, words: text.trim() ? text.trim().split(/\s+/).length : 0, chars: text.length, pages: Math.max(1, Math.ceil(ratio - 0.001)) }));
  }, []);

  const editor = useEditor({
    extensions: wordExtensions(),
    content: '<p></p>',
    editorProps: { attributes: { spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Document text' } },
    onUpdate: ({ editor: ed }) => { if (loadedRef.current) setDirty(true); measure(ed); },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      setSelection(from === to ? '' : ed.state.doc.textBetween(from, to, '\n').slice(0, 4000));
    },
  });

  // ── open the document ──
  useEffect(() => {
    const ac = new AbortController();
    loadedRef.current = false;
    setLoad({ loading: true, error: null, doc: null });
    setDirty(false); setLastSaved(null); setBanner(null); setSelection('');
    (async () => {
      try {
        const doc = await vaultApi.content(docId, ac.signal);
        if (!ac.signal.aborted) setLoad({ loading: false, error: null, doc });
      } catch (e) {
        if (e?.name === 'AbortError') return;
        setLoad({ loading: false, error: e.message || 'Could not open this document.', doc: null });
      }
    })();
    return () => ac.abort();
  }, [docId]);

  useEffect(() => { if (!banner) return undefined; const t = setTimeout(() => setBanner(null), 9000); return () => clearTimeout(t); }, [banner]);
  const doc = load.doc;
  const title = doc?.title || fallbackName || 'Document';
  const isImage = IMAGE_EXT.includes(doc?.ext);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !doc) return;
    loadedRef.current = false;
    editor.commands.setContent(doc.html && doc.html.trim() ? doc.html : '<p></p>', { emitUpdate: false });
    editor.commands.setTextSelection(0);
    requestAnimationFrame(() => { measure(editor); loadedRef.current = true; });
    setBanner(doc.note ? { text: doc.note } : (!doc.html || !doc.html.trim()) ? { text: 'No readable text was found in this file, so the page starts empty. You can type here or ask the assistant for help.' } : null);
  }, [editor, doc, measure]);

  useEffect(() => { if (editor && !editor.isDestroyed) editor.view.dom.setAttribute('spellcheck', String(spell)); }, [editor, spell]);

  // ── zoom to fit + page indicator ──
  useEffect(() => {
    const el = deskRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      if (fitting) setZoom(Math.max(0.4, Math.min(1.45, (el.clientWidth - 36) / PAGE_W)));
    });
    ro.observe(el);
    if (fitting) setZoom(Math.max(0.4, Math.min(1.45, (el.clientWidth - 36) / PAGE_W)) || 1);
    return () => ro.disconnect();
  }, [fitting, aiOpen, load.loading]);
  const onDeskScroll = () => {
    const d = deskRef.current;
    const s = sheetRef.current;
    if (!d || !s) return;
    const top = d.scrollTop + d.clientHeight / 2 - (s.offsetTop || 0) * zoom;
    setCounts((c) => ({ ...c, page: Math.max(1, Math.min(c.pages, Math.floor(top / (PAGE_H * zoom)) + 1)) }));
  };

  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const off = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [menuOpen]);

  // ── saving ──
  const currentHtml = () => (editor && !editor.isDestroyed ? editor.getHTML() : '<p></p>');
  const defaultName = useMemo(() => (lastSaved?.name || (doc?.edited_copy ? baseName(title) : `${baseName(title)} (edited)`)), [lastSaved, doc, title]);

  const saveLocal = useCallback(async (name, format) => {
    const filename = `${name}${EXT[format]}`;
    let handle = null;
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: { docx: 'Word document', pdf: 'PDF document', txt: 'Text file' }[format], accept: { [MIME[format]]: [EXT[format]] } }] });
      } catch (e) {
        if (e?.name === 'AbortError') return false;       // the lawyer closed the browser's Save dialog
        handle = null;                                       // not allowed here: fall back to a normal download
      }
    }
    const { blob } = await vaultApi.exportBlob(docId, { html: currentHtml(), format, title: name }, filename);
    if (handle) {
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
    } else {
      saveBlob(blob, filename);
    }
    return true;
  }, [docId, editor]);                                       // eslint-disable-line react-hooks/exhaustive-deps

  const doSave = useCallback(async (opts) => {
    if (!doc || saveBusy) return;
    const { name, format, destination } = opts;
    setSaveBusy(true); setSaveError(null);
    try {
      if (destination === 'local') {
        const ok = await saveLocal(name, format);
        if (!ok) { setSaveBusy(false); return; }
        setDirty(false);
        setLastSaved((p) => ({ ...(p || {}), name, format, destination: 'local', location: 'your computer', id: p?.id }));
        notify('ok', `Saved ${name}${EXT[format]} to your computer.`);
      } else {
        const key = `${destination}:${opts.folder_id ?? ''}:${opts.practice_case_id ?? ''}`;
        const sameSpot = lastSaved && lastSaved.key === key && lastSaved.id;
        const target = sameSpot ? lastSaved.id : (doc.edited_copy && (destination === 'vault' || destination === 'hub') ? docId : undefined);
        const r = await vaultApi.saveAs(docId, {
          html: currentHtml(), format, destination, title: name, folder_id: opts.folder_id ?? undefined,
          practice_case_id: opts.practice_case_id ?? undefined, category: opts.category, target_id: target,
        });
        setLastSaved({ id: r.id, name, format, destination, key, location: r.location, folder_id: opts.folder_id, practice_case_id: opts.practice_case_id, category: opts.category });
        setDirty(false);
        notify('ok', `${r.created ? 'Saved' : 'Updated'} ${r.filename} in ${r.location}. The original is unchanged.`);
        onChanged?.();
        if (opts.alsoDownload) { try { await saveLocal(name, format); } catch { /* the save itself already succeeded */ } }
      }
      setSaveOpen(false);
      if (pendingClose) { setPendingClose(false); onClose(); }
    } catch (e) {
      setSaveError(e.message || 'Could not save.');
    } finally {
      setSaveBusy(false);
    }
  }, [doc, saveBusy, saveLocal, lastSaved, docId, notify, onChanged, pendingClose, onClose]);       // eslint-disable-line react-hooks/exhaustive-deps

  const openSave = useCallback(() => { setSaveError(null); setSaveOpen(true); setMenuOpen(false); }, []);
  const quickSave = useCallback(() => {
    if (!lastSaved || !lastSaved.name) { openSave(); return; }
    doSave({ name: lastSaved.name, format: lastSaved.format, destination: lastSaved.destination, folder_id: lastSaved.folder_id, practice_case_id: lastSaved.practice_case_id, category: lastSaved.category });
  }, [lastSaved, doSave, openSave]);

  const quickDownload = async (format) => {
    setMenuOpen(false);
    try {
      const ok = await saveLocal(defaultName, format);
      if (ok) { setDirty(false); notify('ok', `Saved ${defaultName}${EXT[format]} to your computer.`); }
    } catch (e) { notify('err', e.message || 'Could not create the file.'); }
  };

  const openOriginal = async () => {
    setMenuOpen(false);
    try {
      if (doc?.previewable && doc.ext !== 'txt') {
        const blob = await vaultApi.viewBlob(docId);
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 120000);
      } else {
        await vaultApi.downloadOriginal(docId, title);
      }
    } catch (e) { notify('err', e.message || 'Could not open the original.'); }
  };

  const insertOriginalImage = async () => {
    try {
      const blob = await vaultApi.viewBlob(docId);
      const src = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
      editor.chain().focus('start').setImage({ src }).run();
    } catch (e) { notify('err', e.message || 'Could not insert the image.'); }
  };

  // ── closing ──
  const requestClose = useCallback(() => { if (dirty) setConfirmClose(true); else onClose(); }, [dirty, onClose]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); if (!saveOpen) quickSave(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'f') { e.preventDefault(); setFindOpen(true); return; }
      if (e.key === 'Escape') {
        if (saveOpen || confirmClose) return;
        e.stopPropagation();
        if (menuOpen) { setMenuOpen(false); return; }
        if (findOpen) { setFindOpen(false); return; }
        requestClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveOpen, confirmClose, menuOpen, findOpen, quickSave, requestClose]);

  const openCase = () => {
    if (!doc?.case) return;
    if (dirty) { setConfirmClose(true); return; }
    onClose(); navigate(`/practice/cases/${doc.case.id}`);
  };

  const info = doc?.info || {};
  const savedLabel = dirty ? 'Unsaved changes' : lastSaved ? `Saved to ${lastSaved.location}` : 'Original untouched · saving makes a copy';
  const saveBtnLabel = !lastSaved ? 'Save' : dirty ? 'Save' : 'Saved';
  const getText = useCallback(() => (editor && !editor.isDestroyed ? editor.getText({ blockSeparator: '\n\n' }) : ''), [editor]);

  return createPortal(
    <div className="vw-root" role="dialog" aria-modal="true" aria-label={`Document: ${title}`}>
      <style>{wordStyles}</style>
      <header className="vw-top">
        <button type="button" className="vw-back" onClick={requestClose} aria-label="Close document"><ArrowLeft size={17} /> Vault</button>
        <div className="vw-doc">
          <div className="vw-doc-ico"><FileText size={18} strokeWidth={1.8} /></div>
          <div className="vw-doc-text">
            <h2 className="vw-doc-title" title={title}>{title}</h2>
            <div className="vw-doc-sub">
              <span className="vw-state"><i className={`vw-dot${dirty ? ' dirty' : lastSaved ? ' saved' : ''}`} />{savedLabel}</span>
              {info.doc_class && <span>· {info.doc_class}</span>}
              {info.next_hearing && <span>· Next hearing {info.next_hearing}</span>}
              {doc?.case && <button type="button" className="vw-linkchip" onClick={openCase} title="Open this matter in Practice">· {doc.case.case_no} · {doc.case.title}</button>}
            </div>
          </div>
        </div>
        <div className="vw-spacer" />
        <button type="button" className={`vw-action${aiOpen ? ' on' : ''}`} onClick={() => setAiOpen((v) => !v)} aria-pressed={aiOpen}><Sparkles size={15} /> Assistant</button>
        <div className="vw-split" ref={menuRef}>
          <button type="button" className="vw-action primary" onClick={quickSave} disabled={!doc || saveBusy || (!!lastSaved && !dirty && lastSaved.destination !== 'local')} title="Save (Ctrl+S)">
            {saveBusy ? <Loader2 size={15} className="vw-spin" /> : lastSaved && !dirty ? <Check size={15} /> : <Save size={15} />} {saveBtnLabel}
          </button>
          <button type="button" className="vw-action primary caret" onClick={() => setMenuOpen((v) => !v)} disabled={!doc} aria-label="More save options" aria-haspopup="true" aria-expanded={menuOpen}><ChevronDown size={15} /></button>
          {menuOpen && (
            <div className="vw-menu" role="menu">
              <button type="button" role="menuitem" className="vw-menu-item" onClick={openSave}><Save size={15} /> Save as…<small>Choose where</small></button>
              <div className="vw-menu-sep" />
              <div className="vw-menu-title">Download to this computer</div>
              <button type="button" role="menuitem" className="vw-menu-item" onClick={() => quickDownload('docx')}><FileText size={15} /> Word document<small>.docx</small></button>
              <button type="button" role="menuitem" className="vw-menu-item" onClick={() => quickDownload('pdf')}><FileType2 size={15} /> PDF<small>.pdf</small></button>
              <button type="button" role="menuitem" className="vw-menu-item" onClick={() => quickDownload('txt')}><FileCode2 size={15} /> Plain text<small>.txt</small></button>
              <div className="vw-menu-sep" />
              <button type="button" role="menuitem" className="vw-menu-item" onClick={openOriginal}><ExternalLink size={15} /> View original file</button>
            </div>
          )}
        </div>
        <button type="button" className="vw-action" onClick={requestClose} aria-label="Close" style={{ padding: '0 10px' }}><X size={16} /></button>
      </header>

      <Ribbon editor={editor} onFind={() => setFindOpen(true)} zoom={zoom} fitting={fitting}
        onZoom={(z) => { setFitting(false); setZoom(z); }} onFit={() => setFitting(true)}
        guides={guides} onGuides={setGuides} spell={spell} onSpell={setSpell} onError={(m) => notify('err', m)} />
      {findOpen && editor && <FindBar editor={editor} onClose={() => { setFindOpen(false); editor.commands.focus(); }} initial={selection && !selection.includes('\n') ? selection.slice(0, 80) : ''} />}

      <div className={`vw-main${aiOpen ? '' : ' noai'}`}>
        <section className="vw-stage">
          {banner && (
            <div className="vw-banner" role="status">
              <span>{banner.text}</span>
              {isImage && <button type="button" onClick={insertOriginalImage}><ImageIcon size={13} style={{ verticalAlign: '-2px' }} /> Insert the image into the page</button>}
              {doc && <button type="button" onClick={openOriginal}>View original</button>}
              <button type="button" className="x" onClick={() => setBanner(null)} aria-label="Dismiss"><X size={14} /></button>
            </div>
          )}
          <div className="vw-desk" ref={deskRef} onScroll={onDeskScroll}>
            {load.loading && (
              <div className="vw-skeleton" aria-busy="true" aria-label="Opening document">
                {[90, 72, 100, 84, 60, 96, 78, 88, 52].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}
              </div>
            )}
            {load.error && <div className="vw-loading" role="alert">{load.error}<br /><br /><button type="button" className="vw-action" onClick={onClose}>Back to vault</button></div>}
            <div className="vw-sheet" ref={sheetRef} style={{ zoom, display: load.loading || load.error ? 'none' : 'block' }}>
              <EditorContent editor={editor} className={`vw-paper${guides ? ' guides' : ''}`} />
            </div>
          </div>
          <div className="vw-statusbar" aria-label="Document status">
            <span>Page {counts.page} of {counts.pages}</span>
            <span>{counts.words.toLocaleString('en-IN')} words</span>
            <span>{counts.chars.toLocaleString('en-IN')} characters</span>
            <span className="vw-spacer" />
            <span>{Math.round(zoom * 100)}%</span>
            <input type="range" min="50" max="200" step="5" value={Math.round(zoom * 100)} aria-label="Zoom" onChange={(e) => { setFitting(false); setZoom(Number(e.target.value) / 100); }} />
          </div>
        </section>
        {aiOpen && <AssistantPanel docId={docId} ready={!!doc && !!editor} editor={editor} selection={selection} getText={getText} onClose={() => setAiOpen(false)} onNotify={notify} />}
      </div>

      <SaveAsDialog open={saveOpen} defaultName={defaultName} defaultFormat={lastSaved?.format || 'docx'} defaultDestination={lastSaved?.destination || 'local'}
        busy={saveBusy} error={saveError} onCancel={() => { setSaveOpen(false); setPendingClose(false); }} onSave={doSave} />

      {confirmClose && createPortal(
        <div className="vw-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmClose(false); }}>
          <div className="vw-modal small" role="alertdialog" aria-modal="true" aria-label="Unsaved changes" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setConfirmClose(false); } }}>
            <div className="vw-modal-head"><div><h3>Save your changes?</h3></div></div>
            <div className="vw-confirm-body">You have edits that are not saved anywhere yet. Saving makes a copy; the original file stays exactly as it is.</div>
            <div className="vw-modal-foot">
              <button type="button" className="vw-action" onClick={() => { setConfirmClose(false); onClose(); }}>Discard</button>
              <button type="button" className="vw-action" onClick={() => setConfirmClose(false)}>Keep editing</button>
              <button type="button" className="vw-action primary" autoFocus onClick={() => { setConfirmClose(false); setPendingClose(true); openSave(); }}>Save…</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {toast && (
        <div className={`vw-toast${toast.kind === 'err' ? ' err' : ''}`} role="status">
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss">Dismiss</button>
        </div>
      )}
    </div>,
    document.body
  );
}
