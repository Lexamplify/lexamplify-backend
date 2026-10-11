import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, FileType2, FileCode2, HardDrive, Folder, Inbox, Briefcase, Library, X, Check, Search, Loader2, FolderOpen } from 'lucide-react';
import { vaultApi } from '../vaultApi.js';

const FORMATS = [
  { id: 'docx', label: 'Word', ext: '.docx', hint: 'Fully editable in Microsoft Word', Icon: FileText },
  { id: 'pdf', label: 'PDF', ext: '.pdf', hint: 'Fixed layout for filing and sharing', Icon: FileType2 },
  { id: 'txt', label: 'Text', ext: '.txt', hint: 'Plain text, no formatting', Icon: FileCode2 },
];

const nativePicker = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

export default function SaveAsDialog({ open, defaultName, defaultFormat = 'docx', defaultDestination = 'local', busy, error, onCancel, onSave }) {
  const [name, setName] = useState(defaultName);
  const [format, setFormat] = useState(defaultFormat);
  const [dest, setDest] = useState(defaultDestination);
  const [folderId, setFolderId] = useState(null);
  const [caseId, setCaseId] = useState(null);
  const [category, setCategory] = useState('Draft');
  const [alsoDownload, setAlsoDownload] = useState(false);
  const [q, setQ] = useState('');
  const [meta, setMeta] = useState({ loading: true, error: null, data: null });
  const nameRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setName(defaultName); setFormat(defaultFormat); setDest(defaultDestination); setQ(''); setAlsoDownload(false);
    const ac = new AbortController();
    setMeta({ loading: true, error: null, data: null });
    vaultApi.destinations(ac.signal)
      .then((data) => { if (!ac.signal.aborted) setMeta({ loading: false, error: null, data }); })
      .catch((e) => { if (e?.name !== 'AbortError') setMeta({ loading: false, error: e.message || 'Could not load your folders and matters.', data: null }); });
    setTimeout(() => nameRef.current?.select(), 30);
    return () => ac.abort();
  }, [open, defaultName, defaultFormat, defaultDestination]);

  useEffect(() => { setQ(''); }, [dest]);

  const data = meta.data;
  const practice = data?.practice || { enabled: false, cases: [] };
  const folders = useMemo(() => (data?.folders || []).filter((f) => !q || f.path.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const cases = useMemo(() => practice.cases.filter((c) => !q || `${c.case_no} ${c.title} ${c.court || ''}`.toLowerCase().includes(q.toLowerCase())), [practice, q]);

  if (!open) return null;
  const fmt = FORMATS.find((f) => f.id === format);
  const cleanName = name.trim();
  const needsCase = dest === 'practice' && !caseId;
  const can = !!cleanName && !busy && !needsCase && !(dest !== 'local' && meta.loading);
  const DESTS = [
    { id: 'local', label: 'This computer', hint: nativePicker ? 'Choose any folder on your disk' : 'Saved to your Downloads folder', Icon: HardDrive },
    { id: 'vault', label: 'Case Vault', hint: 'A folder in your vault', Icon: Folder },
    { id: 'hub', label: 'Document Hub', hint: 'Filed and auto-classified by AI', Icon: Inbox },
    { id: 'practice', label: 'Practice matter', hint: practice.enabled ? 'Attach to one of your cases' : 'Set up your firm in Practice first', Icon: Briefcase, disabled: !practice.enabled && !meta.loading },
    { id: 'library', label: 'Firm Library', hint: 'Reusable drafts and precedents', Icon: Library },
  ];
  const label = { local: 'Save to computer', vault: 'Save to Case Vault', hub: 'Save to Document Hub', practice: 'Save to Practice', library: 'Save to Firm Library' }[dest];
  const submit = (e) => {
    e?.preventDefault();
    if (!can) return;
    onSave({ name: cleanName, format, destination: dest, folder_id: folderId, practice_case_id: caseId, category, alsoDownload });
  };

  return createPortal(
    <div className="vw-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <form className="vw-modal" role="dialog" aria-modal="true" aria-label="Save a copy" onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); if (!busy) onCancel(); } }}>
        <div className="vw-modal-head">
          <div><h3>Save a copy</h3><p>Your original file is never changed. Pick a format and where it should go.</p></div>
          <button type="button" className="vw-mini icon" onClick={onCancel} aria-label="Close" disabled={busy}><X size={16} /></button>
        </div>
        <div className="vw-modal-body">
          <label className="vw-field">
            <span>File name</span>
            <div className="vw-name"><input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="File name" /><em>{fmt.ext}</em></div>
          </label>
          <div className="vw-field">
            <span id="vw-fmt-l">Format</span>
            <div className="vw-tiles" role="radiogroup" aria-labelledby="vw-fmt-l">
              {FORMATS.map(({ id, label: l, ext, hint, Icon }) => (
                <button type="button" key={id} role="radio" aria-checked={format === id} className={`vw-tile${format === id ? ' on' : ''}`} onClick={() => setFormat(id)}>
                  <Icon size={20} strokeWidth={1.7} /><b>{l} <small>{ext}</small></b><i>{hint}</i>
                  {format === id && <Check className="vw-tick" size={14} strokeWidth={2.6} />}
                </button>
              ))}
            </div>
          </div>
          <div className="vw-field">
            <span id="vw-dest-l">Save to</span>
            <div className="vw-dests" role="radiogroup" aria-labelledby="vw-dest-l">
              {DESTS.map(({ id, label: l, hint, Icon, disabled }) => (
                <button type="button" key={id} role="radio" aria-checked={dest === id} disabled={disabled} className={`vw-dest${dest === id ? ' on' : ''}`} onClick={() => setDest(id)}>
                  <Icon size={18} strokeWidth={1.7} /><span><b>{l}</b><i>{hint}</i></span>
                </button>
              ))}
            </div>
          </div>

          {meta.error && dest !== 'local' && <div className="vw-inline err" role="alert">{meta.error}</div>}

          {(dest === 'vault' || dest === 'hub') && (
            <div className="vw-pick" aria-label="Choose a folder">
              <div className="vw-pick-search"><Search size={14} /><input placeholder="Search folders" aria-label="Search folders" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <div className="vw-pick-list" role="listbox" aria-label="Folders">
                <button type="button" role="option" aria-selected={folderId == null} className={`vw-row-pick${folderId == null ? ' on' : ''}`} onClick={() => setFolderId(null)}><FolderOpen size={15} />Top level (no folder)</button>
                {meta.loading && <div className="vw-pick-empty"><Loader2 size={14} className="vw-spin" /> Loading folders…</div>}
                {folders.map((f) => (
                  <button type="button" role="option" aria-selected={folderId === f.id} key={f.id} className={`vw-row-pick${folderId === f.id ? ' on' : ''}`} onClick={() => setFolderId(f.id)}><Folder size={15} />{f.path}</button>
                ))}
                {!meta.loading && !folders.length && data?.folders?.length > 0 && <div className="vw-pick-empty">No folder matches “{q}”.</div>}
                {!meta.loading && data && !data.folders.length && <div className="vw-pick-empty">You have no folders yet — it will go to the top level.</div>}
              </div>
            </div>
          )}

          {dest === 'practice' && practice.enabled && (
            <div className="vw-pick" aria-label="Choose a matter">
              <div className="vw-pick-search"><Search size={14} /><input placeholder="Search by case number, title or court" aria-label="Search matters" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <div className="vw-pick-list" role="listbox" aria-label="Matters">
                {cases.map((c) => (
                  <button type="button" role="option" aria-selected={caseId === c.id} key={c.id} className={`vw-row-pick two${caseId === c.id ? ' on' : ''}`} onClick={() => setCaseId(c.id)}>
                    <Briefcase size={15} /><span><b>{c.title || c.case_no}</b><i>{[c.case_no, c.court].filter(Boolean).join(' · ')}{c.closed ? ' · Closed' : ''}</i></span>
                  </button>
                ))}
                {!cases.length && <div className="vw-pick-empty">{practice.cases.length ? `No matter matches “${q}”.` : 'You have no matters yet. Add one in Practice first.'}</div>}
              </div>
            </div>
          )}

          {dest === 'library' && (
            <label className="vw-field">
              <span>Library category</span>
              <select className="vw-select block" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Library category">
                {(data?.library?.categories || ['Draft']).map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          )}

          {dest === 'local' && (
            <div className="vw-inline">{nativePicker ? 'Your browser will open its Save dialog so you can pick the folder and confirm the file name.' : 'Your browser will save the file to its Downloads folder.'}</div>
          )}
          {dest !== 'local' && (
            <label className="vw-check block"><input type="checkbox" checked={alsoDownload} onChange={(e) => setAlsoDownload(e.target.checked)} /> Also download a copy to this computer</label>
          )}
          {error && <div className="vw-inline err" role="alert">{error}</div>}
        </div>
        <div className="vw-modal-foot">
          <button type="button" className="vw-action" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="vw-action primary" disabled={!can}>{busy ? <><Loader2 size={14} className="vw-spin" /> Saving…</> : label}</button>
        </div>
      </form>
    </div>,
    document.body
  );
}
