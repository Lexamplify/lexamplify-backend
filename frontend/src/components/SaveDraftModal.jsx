import { useEffect, useMemo, useRef, useState } from 'react';
import { saveCustomTemplate } from '../data/legalTemplates.js';
import { toFileName } from '../utils/draftNaming.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const PREF_KEY = 'lexai_save_destinations_v1';

const DESTS = [
  { id: 'pc', label: 'This computer', hint: 'Downloads a file you can keep anywhere.' },
  { id: 'drafts', label: 'Saved Drafts', hint: 'Your personal draft list (Saved Drafts button, top right).' },
  { id: 'vault', label: 'Case Vault', hint: 'Files it in a matter folder, with a Word copy.' },
  { id: 'library', label: 'Firm Library', hint: 'Adds it to the firm-wide library with formatting kept.' },
  { id: 'forms', label: 'Legal Forms (reusable form)', hint: 'Turns the [blue placeholders] into fillable fields. Stored in this browser only.' },
];

const readPrefs = () => {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
    if (p && typeof p === 'object') return p;
  } catch { /* storage unavailable */ }
  return null;
};

const Tick = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
);
const Cross = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
);

export default function SaveDraftModal({ open, onClose, initialName, category, defaultMatter, getText, getHtml, onDownload }) {
  const [name, setName] = useState('');
  const [dests, setDests] = useState({ pc: false, drafts: true, vault: false, library: false, forms: false });
  const [fmt, setFmt] = useState('docx');
  const [matter, setMatter] = useState('');
  const [folderId, setFolderId] = useState('');
  const [folders, setFolders] = useState([]);
  const [foldersState, setFoldersState] = useState('idle');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!open) return;
    setResults(null);
    setBusy(false);
    setName(initialName || 'Legal draft');
    setMatter(defaultMatter || 'General');
    const p = readPrefs();
    if (p && p.dests) setDests((d) => ({ ...d, ...p.dests }));
    if (p && p.fmt) setFmt(p.fmt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !dests.vault || foldersState !== 'idle') return;
    setFoldersState('loading');
    fetch(`${API_BASE}/api/vault/folders`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('folders'))))
      .then((d) => { if (mounted.current) { setFolders(Array.isArray(d.flat) ? d.flat : []); setFoldersState('ready'); } })
      .catch(() => { if (mounted.current) setFoldersState('error'); });
  }, [open, dests.vault, foldersState]);

  const folderOptions = useMemo(() => {
    const byParent = new Map();
    folders.forEach((f) => {
      const k = f.parent_id == null || f.parent_id === 0 ? 'root' : String(f.parent_id);
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(f);
    });
    const out = [];
    const walk = (key, depth, seen) => {
      (byParent.get(key) || []).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach((f) => {
        if (seen.has(f.id)) return;
        out.push({ id: f.id, label: `${'  '.repeat(depth)}${depth ? '↳ ' : ''}${f.name}` });
        walk(String(f.id), depth + 1, new Set([...seen, f.id]));
      });
    };
    walk('root', 0, new Set());
    return out;
  }, [folders]);

  if (!open) return null;

  const anyChosen = Object.values(dests).some(Boolean);
  const cleanName = name.trim();

  const run = {
    pc: async () => {
      const ok = await onDownload(fmt, cleanName);
      if (!ok) throw new Error('The download could not be created - see the message under the editor.');
      return fmt === 'pdf' ? 'Print dialog opened - choose "Save as PDF".' : `Downloaded ${toFileName(cleanName, fmt === 'docx' ? 'docx' : 'txt')}`;
    },
    drafts: async () => {
      const res = await fetch(`${API_BASE}/api/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          title: cleanName,
          timestamp: new Date().toISOString(),
          rawText: getText(),
          clauses: [],
          summary: 'Auto-Draft Studio draft.',
        }),
      });
      if (!res.ok) throw new Error(`Saved Drafts refused the save (HTTP ${res.status}).`);
      window.dispatchEvent(new CustomEvent('lexamplify-drafts-updated'));
      return 'Added to Saved Drafts.';
    },
    vault: async () => {
      const res = await fetch(`${API_BASE}/api/vault/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: cleanName,
          smart_title: cleanName,
          content: getText(),
          case_id: matter.trim() || 'General',
          folder_id: folderId ? Number(folderId) : null,
          doc_type: category ? `Draft - ${category}` : 'Draft',
          format: 'docx',
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.message || `Case Vault refused the save (HTTP ${res.status}).`);
      return `Filed in Case Vault${d.location ? `: ${d.location}` : '.'}`;
    },
    library: async () => {
      const res = await fetch(`${API_BASE}/api/firm-library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: cleanName, html: getHtml() || `<p>${getText()}</p>`, category: category || 'Draft' }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.message || `Firm Library refused the save (HTTP ${res.status}).`);
      return 'Added to Firm Library.';
    },
    forms: async () => {
      const r = saveCustomTemplate({ title: cleanName, text: getText() });
      if (!r.ok) throw new Error('This browser blocked local storage, so the form could not be kept.');
      return `Saved under Legal Forms > My Saved Forms (${r.fields} fillable field${r.fields === 1 ? '' : 's'})${r.replaced ? ' - replaced the earlier version with this name' : ''}.`;
    },
  };

  const handleSave = async () => {
    if (!cleanName || !anyChosen || busy) return;
    setBusy(true);
    const chosen = DESTS.filter((d) => dests[d.id]);
    const res = {};
    for (const d of chosen) {
      try {
        res[d.id] = { ok: true, msg: await run[d.id]() };
      } catch (e) {
        res[d.id] = { ok: false, msg: (e && e.message) || 'Failed.' };
      }
      if (!mounted.current) return;
      setResults((prev) => ({ ...(prev || {}), ...res }));
    }
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ dests, fmt })); } catch { /* storage unavailable */ }
    setBusy(false);
    // Only keep the failed ones selected so "Save" retries just those.
    setDests((cur) => Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, v && res[k] ? !res[k].ok : v])));
  };

  const allOk = results && Object.values(results).every((r) => r.ok);

  return (
    <div className="sdm-backdrop" onClick={() => !busy && onClose()} role="presentation">
      <style>{`
        .sdm-backdrop { position: fixed; inset: 0; z-index: 260; background: var(--overlay, rgba(10,10,10,.6)); display: flex; align-items: flex-start; justify-content: center; padding: 20px 16px; box-sizing: border-box; }
        .sdm { width: 560px; max-width: 100%; max-height: calc(100vh - 96px); display: flex; flex-direction: column; background: var(--paper); color: var(--ink); border: 1px solid var(--rule); border-radius: 14px; box-shadow: var(--shadow, 0 20px 50px rgba(0,0,0,.4)); overflow: hidden; }
        .sdm-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--rule); }
        .sdm-title { margin: 0; font-size: 15px; font-weight: 600; }
        .sdm-body { padding: 16px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
        .sdm-label { font-size: 11.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; display: block; }
        .sdm input[type=text], .sdm select { width: 100%; box-sizing: border-box; background: var(--bg); border: 1px solid var(--rule); border-radius: 8px; padding: 9px 11px; font-size: 13px; color: var(--ink); font-family: inherit; }
        .sdm input[type=text]:focus, .sdm select:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
        .sdm-dest { display: flex; gap: 11px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--rule); border-radius: 10px; background: var(--paper); cursor: pointer; }
        .sdm-dest.on { border-color: var(--accent); background: var(--accent-soft); }
        .sdm-dest input { margin-top: 3px; accent-color: var(--accent); }
        .sdm-dest b { font-size: 13px; font-weight: 600; display: block; }
        .sdm-dest span { font-size: 12px; color: var(--ink-soft); line-height: 1.45; display: block; margin-top: 2px; }
        .sdm-sub { margin: 8px 0 2px 26px; display: flex; flex-direction: column; gap: 8px; }
        .sdm-seg { display: inline-flex; border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; align-self: flex-start; }
        .sdm-seg button { border: 0; background: var(--bg); color: var(--ink-soft); padding: 6px 12px; font-size: 12.5px; cursor: pointer; }
        .sdm-seg button + button { border-left: 1px solid var(--rule); }
        .sdm-seg button.on { background: var(--accent); color: var(--on-accent, #fff); }
        .sdm-note { font-size: 11.5px; color: var(--muted); line-height: 1.45; }
        .sdm-res { display: flex; gap: 9px; align-items: flex-start; font-size: 12.5px; line-height: 1.45; padding: 8px 10px; border-radius: 8px; }
        .sdm-res.ok { background: rgba(111,169,122,.14); color: var(--ink); }
        .sdm-res.ok svg { color: #4E9A5F; }
        .sdm-res.bad { background: var(--accent-soft); color: var(--ink); }
        .sdm-res.bad svg { color: var(--accent); }
        .sdm-res svg { flex-shrink: 0; margin-top: 2px; }
        .sdm-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--rule); }
        @media (max-width: 560px) { .sdm-backdrop { padding: 10px; } }
      `}</style>
      <div className="sdm" role="dialog" aria-modal="true" aria-label="Save draft" onClick={(e) => e.stopPropagation()}>
        <div className="sdm-head">
          <h3 className="sdm-title">Save draft</h3>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="sdm-body">
          <div>
            <label className="sdm-label" htmlFor="sdm-name">Name</label>
            <input id="sdm-name" type="text" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Name this draft" />
            <div className="sdm-note" style={{ marginTop: 6 }}>Suggested from the matter and today's date - edit it if you like. The same name is used for every place you save to.</div>
          </div>

          <div>
            <span className="sdm-label">Save to</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {DESTS.map((d) => (
                <div key={d.id}>
                  <label className={`sdm-dest ${dests[d.id] ? 'on' : ''}`}>
                    <input type="checkbox" checked={!!dests[d.id]} disabled={busy} onChange={(e) => setDests((c) => ({ ...c, [d.id]: e.target.checked }))} />
                    <div><b>{d.label}</b><span>{d.hint}</span></div>
                  </label>
                  {d.id === 'pc' && dests.pc && (
                    <div className="sdm-sub">
                      <div className="sdm-seg" role="group" aria-label="File format">
                        {[['docx', 'Word (.docx)'], ['pdf', 'PDF'], ['txt', 'Text']].map(([v, l]) => (
                          <button key={v} type="button" className={fmt === v ? 'on' : ''} onClick={() => setFmt(v)}>{l}</button>
                        ))}
                      </div>
                      <div className="sdm-note">Uses the letterhead selected in the top row. PDF opens your browser's print dialog - pick "Save as PDF".</div>
                    </div>
                  )}
                  {d.id === 'vault' && dests.vault && (
                    <div className="sdm-sub">
                      <div>
                        <label className="sdm-label" htmlFor="sdm-matter">Matter / case reference</label>
                        <input id="sdm-matter" type="text" value={matter} maxLength={80} onChange={(e) => setMatter(e.target.value)} placeholder="e.g. Ravi Kumar v State" />
                      </div>
                      <div>
                        <label className="sdm-label" htmlFor="sdm-folder">Folder</label>
                        <select id="sdm-folder" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                          <option value="">Vault root (no folder)</option>
                          {folderOptions.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                        </select>
                        {foldersState === 'loading' && <div className="sdm-note" style={{ marginTop: 4 }}>Loading your folders…</div>}
                        {foldersState === 'error' && <div className="sdm-note" style={{ marginTop: 4 }}>Could not load folders - it will be saved at the vault root.</div>}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {results && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} aria-live="polite">
              {DESTS.filter((d) => results[d.id]).map((d) => (
                <div key={d.id} className={`sdm-res ${results[d.id].ok ? 'ok' : 'bad'}`}>
                  {results[d.id].ok ? <Tick /> : <Cross />}
                  <div><b>{d.label}:</b> {results[d.id].msg}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="sdm-foot">
          <button className="btn" onClick={onClose} disabled={busy}>{allOk ? 'Done' : 'Cancel'}</button>
          {!allOk && (
            <button className="btn btn-primary" onClick={handleSave} disabled={busy || !cleanName || !anyChosen}>
              {busy ? 'Saving…' : results ? 'Retry failed' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
