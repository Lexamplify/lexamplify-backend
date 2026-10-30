import { useState, useEffect, useCallback, useRef } from 'react';
import * as Ic from '../icons.jsx';
import Modal from '../components/Modal.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// The firm's document vault, organised in folders and backed entirely by the
// server. Everything on this screen comes from live endpoints — nothing is
// hard-coded:
//   GET /api/vault/overview                  → { documents, documents_this_week, drafts, categories, category_names:[], ... }
//   GET /api/vault/folders                   → { folders:[tree], flat:[{ id, name, parent_id, share_count, ... }], doc_counts:{ "<id>":n, root:n } }
//   GET /api/vault/documents?folder_id&q     → { documents:[{ id, title, smart_title, doc_type, file_format, folder_id, folder_name, size_bytes, created_at }], total }
//   GET /api/vault/documents/<id>/content    → { title, ext, html, text, source, note, previewable, has_original, info, case }
//   GET /api/vault/documents/<id>/view       → the file itself (inline blob; pdf/image/txt only)

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

const SESSION_MSG = 'Your session has expired. Please sign in again.';

async function getJSON(path) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(res.status === 401 ? SESSION_MSG : 'load');
  return res.json();
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(String(ts).replace(' ', 'T'));
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtSize(bytes) {
  const n = Number(bytes);
  if (!n || Number.isNaN(n)) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function docLabel(d) {
  const raw = (d.file_format || d.doc_type || '').toString().trim();
  return raw ? raw.toUpperCase() : 'DOCUMENT';
}

const ALL = '__all__';
const ROOT = 'root';

export default function CaseVault() {
  const [overview, setOverview] = useState(null);
  const [folders, setFolders] = useState([]);
  const [docCounts, setDocCounts] = useState({});
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState('');

  const [scope, setScope] = useState(ALL); // ALL | ROOT | folder id (number)
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  const [docs, setDocs] = useState([]);
  const [total, setTotal] = useState(0);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState('');

  const [preview, setPreview] = useState(null); // { id, title }
  const uploadRef = useRef(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadNote, setUploadNote] = useState('');

  // Row actions
  const [rowMenu, setRowMenu] = useState(null); // { id, title }
  const [renameFor, setRenameFor] = useState(null); // { id, title }
  const [moveFor, setMoveFor] = useState(null); // { id, title, folder_id }
  const [shareFor, setShareFor] = useState(null); // { id, title }
  const [newFolder, setNewFolder] = useState(false);

  async function deleteDoc(d) {
    if (!window.confirm(`Permanently delete "${d.smart_title || d.title || 'this document'}"? This also removes its AI search index. This cannot be undone.`)) return;
    try {
      const r = await fetch(`${API_BASE}/api/documents/${d.id}`, {
        method: 'DELETE', credentials: 'include', headers: { 'X-CSRF-TOKEN': csrf() },
      });
      if (!r.ok) { const dj = await r.json().catch(() => ({})); throw new Error(dj.error || dj.message || 'Delete failed.'); }
      setDocs((xs) => xs.filter((x) => x.id !== d.id));
      loadMeta();
    } catch (e) { alert(e.message); }
  }

  // ── Overview numbers + folder tree ──────────────────────────────────────
  const loadMeta = useCallback(async () => {
    setMetaLoading(true); setMetaError('');
    try {
      const [ov, fld] = await Promise.all([
        getJSON('/api/vault/overview'),
        getJSON('/api/vault/folders'),
      ]);
      setOverview(ov || null);
      setFolders(Array.isArray(fld?.flat) ? fld.flat : []);
      setDocCounts(fld?.doc_counts || {});
    } catch (e) {
      setMetaError(e.message === 'load' ? 'Could not load the vault. Please try again.' : e.message);
    } finally {
      setMetaLoading(false);
    }
  }, []);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  // ── Document list (re-fetched when the search term or folder changes) ────
  const loadDocs = useCallback(async () => {
    setDocsLoading(true); setDocsError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      const term = debounced.trim();
      if (term) {
        // A search spans the whole vault, so the server ignores folder scope.
        params.set('q', term);
      } else if (scope === ROOT) {
        params.set('folder_id', 'root');
      } else if (scope !== ALL) {
        params.set('folder_id', String(scope));
      }
      const data = await getJSON(`/api/vault/documents?${params.toString()}`);
      setDocs(Array.isArray(data?.documents) ? data.documents : []);
      setTotal(Number(data?.total) || 0);
    } catch (e) {
      setDocsError(e.message === 'load' ? 'Could not load these documents. Please try again.' : e.message);
      setDocs([]); setTotal(0);
    } finally {
      setDocsLoading(false);
    }
  }, [debounced, scope]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  // Debounce the search box so every keystroke doesn't hit the server.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  // ── Upload (real multipart write; refreshes the list on success) ─────────
  const onUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (uploadRef.current) uploadRef.current.value = '';
    if (!files.length) return;
    setUploadBusy(true); setUploadNote('');
    const folderId = scope !== ALL && scope !== ROOT ? scope : null;
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        if (folderId != null) fd.append('folder_id', folderId);
        fd.append('case_id', 'General');
        const res = await fetch(`${API_BASE}/api/vault/documents/upload`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-CSRF-TOKEN': csrf() }, // multipart: let the browser set Content-Type + boundary
          body: fd,
        });
        if (!res.ok) throw new Error(res.status === 401 ? SESSION_MSG : 'The upload did not finish.');
      }
      setUploadNote(`${files.length} file${files.length === 1 ? '' : 's'} added to the vault.`);
      await Promise.all([loadMeta(), loadDocs()]);
    } catch (err) {
      setUploadNote(err.message || 'The upload did not finish.');
    } finally {
      setUploadBusy(false);
    }
  };

  const searching = debounced.trim().length > 0;
  const activeFolder = scope !== ALL && scope !== ROOT
    ? folders.find((f) => Number(f.id) === Number(scope))
    : null;
  const scopeLabel = searching ? 'Across the whole vault'
    : scope === ALL ? 'Everything in your vault'
    : scope === ROOT ? 'Unfiled documents'
    : activeFolder ? activeFolder.name : 'Folder';

  const STATS = [
    { Icon: Ic.Doc, num: overview?.documents ?? '—', label: 'Documents', sub: 'In the vault' },
    { Icon: Ic.Matters, num: folders.length, label: 'Folders', sub: 'Organised' },
    { Icon: Ic.Sparkle, num: overview?.documents_this_week ?? '—', label: 'Added this week', sub: 'Last 7 days' },
    { Icon: Ic.Draft, num: overview?.drafts ?? '—', label: 'Drafts', sub: 'Work in progress' },
  ];

  return (
    <div className="lx-page lx-rise">
      <div className="lx-between ph" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 18 }}>
        <div>
          <span className="ph__eyebrow">Practice &amp; Vault</span>
          <h1 className="ph__title">Case Vault</h1>
          <p className="ph__sub">Every document your chambers keeps, filed in folders and ready to open — in one tamper-evident vault.</p>
        </div>
        <button className="lx-btn lx-btn--gold" disabled={uploadBusy} onClick={() => uploadRef.current?.click()}>
          <Ic.Upload size={15} /> {uploadBusy ? 'Uploading…' : 'Upload document'}
        </button>
        <input ref={uploadRef} type="file" multiple hidden onChange={onUpload} />
      </div>

      {/* Overview stats */}
      <section className="lx-stats">
        {STATS.map((s) => (
          <div className="lx-stat" key={s.label}>
            <div className="lx-stat__ico"><s.Icon size={18} /></div>
            <div className="lx-stat__num">{metaLoading ? '—' : s.num}</div>
            <div className="lx-stat__label">{s.label}</div>
            <div className="lx-stat__sub">{s.sub}</div>
          </div>
        ))}
      </section>

      {uploadNote && (
        <div className="lx-card lx-card--pad lx-mt-m" role="status" style={{ padding: '14px 18px', fontSize: 13.5, color: 'var(--ink-soft)' }}>
          {uploadNote}
        </div>
      )}

      {/* Browser: documents (main) + folder filter (rail) */}
      <div className="lx-dash-grid lx-mt-xl">
        {/* Documents */}
        <section>
          <div className="lx-between" style={{ marginBottom: 18, gap: 14, flexWrap: 'wrap' }}>
            <div className="lx-section-head" style={{ margin: 0 }}>
              <h3>{scopeLabel}</h3>
            </div>
            <div className="lx-row" style={{ gap: 10 }}>
              <div className="lx-field" style={{ height: 42, maxWidth: 300 }}>
                <Ic.Search size={15} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the vault…" style={{ fontSize: 14 }} />
              </div>
              <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => setNewFolder(true)}>
                <Ic.Plus size={14} /> New folder
              </button>
            </div>
          </div>

          <div className="lx-card lx-card--pad">
            {docsLoading ? (
              <div className="lx-empty"><p>Loading documents…</p></div>
            ) : docsError ? (
              <div className="lx-empty">
                <div className="lx-empty__ico"><Ic.Doc size={22} /></div>
                <h4>Couldn&apos;t load documents</h4><p>{docsError}</p>
                <button className="lx-btn lx-btn--sm" style={{ marginTop: 10 }} onClick={loadDocs}>Try again</button>
              </div>
            ) : docs.length === 0 ? (
              <div className="lx-empty">
                <div className="lx-empty__ico"><Ic.Doc size={22} /></div>
                <h4>{searching ? 'No documents match' : 'No documents here'}</h4>
                <p>{searching
                  ? 'Nothing in the vault matches your search.'
                  : scope === ALL
                    ? 'Upload a document to start building your vault.'
                    : 'This folder is empty. Upload a document or pick another folder.'}</p>
              </div>
            ) : (
              <div className="lx-list">
                {docs.map((d) => {
                  const size = fmtSize(d.size_bytes);
                  const meta = [docLabel(d), fmtDate(d.created_at), size].filter(Boolean).join(' · ');
                  const title = d.smart_title || d.title || 'Untitled document';
                  const open = () => setPreview({ id: d.id, title });
                  return (
                    <div className="lx-item" key={d.id} onClick={open} style={{ cursor: 'pointer', position: 'relative' }}>
                      <div className="lx-item__ico"><Ic.Doc size={17} /></div>
                      <div className="lx-item__body">
                        <div className="lx-item__title">{title}</div>
                        <div className="lx-item__meta">{meta}</div>
                      </div>
                      {d.folder_name && !searching && scope === ALL && (
                        <span className="chip hide-sm">{d.folder_name}</span>
                      )}
                      <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={(e) => { e.stopPropagation(); open(); }}>
                        <Ic.Eye size={14} /> Open
                      </button>
                      <button className="lx-btn lx-btn--ghost lx-btn--sm" aria-label="Actions"
                        onClick={(e) => { e.stopPropagation(); setRowMenu(rowMenu?.id === d.id ? null : { id: d.id, title, folder_id: d.folder_id || null }); }}
                        style={{ minWidth: 36, padding: '0 10px' }}>⋯</button>
                      {rowMenu?.id === d.id && (
                        <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: '100%', right: 10, zIndex: 30, marginTop: 4, background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.12)', padding: 6, minWidth: 180 }}>
                          {[
                            ['Rename', () => { setRenameFor({ id: d.id, title }); setRowMenu(null); }],
                            ['Move to folder', () => { setMoveFor({ id: d.id, title, folder_id: d.folder_id || null }); setRowMenu(null); }],
                            ['Share with team', () => { setShareFor({ id: d.id, title }); setRowMenu(null); }],
                            ['Delete', () => { setRowMenu(null); deleteDoc(d); }, true],
                          ].map(([label, fn, danger]) => (
                            <button key={label} onClick={fn} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 0, background: 'transparent', color: danger ? 'var(--risk, #c0392b)' : 'var(--ink)', fontSize: 13, cursor: 'pointer', borderRadius: 6 }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--paper-2)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {total > docs.length && (
                  <div className="lx-item" style={{ cursor: 'default' }}>
                    <div className="lx-item__meta" style={{ margin: '0 auto' }}>
                      Showing {docs.length} of {total} documents. Refine your search or open a folder to see more.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Folder filter */}
        <aside className="lx-stack" style={{ gap: 24 }}>
          <section className="lx-card lx-card--pad">
            <div className="lx-section-head"><h3>Folders</h3></div>
            {metaLoading ? (
              <div className="lx-empty"><p>Loading folders…</p></div>
            ) : metaError ? (
              <div className="lx-empty">
                <div className="lx-empty__ico"><Ic.Matters size={22} /></div>
                <h4>Couldn&apos;t load folders</h4><p>{metaError}</p>
                <button className="lx-btn lx-btn--sm" style={{ marginTop: 10 }} onClick={loadMeta}>Try again</button>
              </div>
            ) : (
              <div className="lx-list">
                <FolderRow
                  Icon={Ic.Library} name="All documents"
                  count={overview?.documents}
                  active={scope === ALL} onPick={() => { setQuery(''); setDebounced(''); setScope(ALL); }}
                />
                <FolderRow
                  Icon={Ic.Doc} name="Unfiled"
                  count={docCounts[ROOT]}
                  active={scope === ROOT} onPick={() => { setQuery(''); setDebounced(''); setScope(ROOT); }}
                />
                {folders.map((f) => (
                  <FolderRow
                    key={f.id} Icon={Ic.Matters} name={f.name}
                    count={docCounts[String(f.id)]}
                    protectedFolder={f.protected}
                    active={Number(scope) === Number(f.id)}
                    onPick={() => { setQuery(''); setDebounced(''); setScope(f.id); }}
                  />
                ))}
                {folders.length === 0 && (
                  <div className="lx-empty" style={{ padding: '28px 10px' }}>
                    <p>No folders yet. Uploaded documents stay under <b>Unfiled</b>.</p>
                  </div>
                )}
              </div>
            )}
          </section>
        </aside>
      </div>

      {preview && (
        <PreviewModal id={preview.id} fallbackTitle={preview.title} onClose={() => setPreview(null)} />
      )}
      {newFolder && (
        <NewFolderModal
          folders={folders}
          defaultParent={scope !== ALL && scope !== ROOT ? Number(scope) : null}
          onClose={() => setNewFolder(false)}
          onCreated={() => { setNewFolder(false); loadMeta(); }}
        />
      )}
      {renameFor && (
        <RenameDocModal doc={renameFor} onClose={() => setRenameFor(null)} onSaved={(newTitle) => {
          setDocs((xs) => xs.map((x) => x.id === renameFor.id ? { ...x, smart_title: newTitle, title: newTitle } : x));
          setRenameFor(null);
        }} />
      )}
      {moveFor && (
        <MoveDocModal doc={moveFor} folders={folders} onClose={() => setMoveFor(null)} onMoved={() => { setMoveFor(null); loadDocs(); loadMeta(); }} />
      )}
      {shareFor && (
        <ShareDocModal doc={shareFor} onClose={() => setShareFor(null)} />
      )}
    </div>
  );
}

function FolderRow({ Icon, name, count, active, onPick, protectedFolder }) {
  return (
    <div
      className="lx-item"
      onClick={onPick}
      style={{ cursor: 'pointer', padding: '12px 4px', background: active ? 'color-mix(in srgb, var(--accent) 7%, transparent)' : undefined, borderRadius: 10 }}
    >
      <div className="lx-item__ico" style={{ width: 34, height: 34, color: active ? 'var(--accent-ink)' : undefined }}>
        <Icon size={15} />
      </div>
      <div className="lx-item__body">
        <div className="lx-item__title" style={{ fontSize: 14, fontFamily: 'var(--font-sans)', fontWeight: active ? 600 : 500 }}>
          {name}
        </div>
        {protectedFolder && <div className="lx-item__meta">Blueprint folder</div>}
      </div>
      {count != null && <span className="lx-badge lx-badge--muted">{count}</span>}
    </div>
  );
}

function PreviewModal({ id, fallbackTitle, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const d = await getJSON(`/api/vault/documents/${id}/content`);
        if (alive) setData(d);
      } catch (e) {
        if (alive) setError(e.message === 'load' ? 'Could not open this document. Please try again.' : e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // Fetch the original file as a blob (authenticated) and show it in a new tab.
  const openOriginal = async () => {
    setOpening(true);
    try {
      const res = await fetch(`${API_BASE}/api/vault/documents/${id}/view`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status === 401 ? SESSION_MSG : 'Could not open the original file.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError(e.message || 'Could not open the original file.');
    } finally {
      setOpening(false);
    }
  };

  const title = data?.title || fallbackTitle || 'Document';
  const canOpen = data?.previewable;
  const ext = (data?.ext || '').toLowerCase();
  const isPdf = ext === 'pdf';
  const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);
  const inlineUrl = `${API_BASE}/api/vault/documents/${id}/view`;

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="lx-btn lx-btn--ghost" onClick={onClose}>Close</button>
          {canOpen && (
            <button className="lx-btn lx-btn--primary" onClick={openOriginal} disabled={opening}>
              <Ic.Eye size={14} /> {opening ? 'Opening…' : 'Open original'}
            </button>
          )}
        </>
      }
    >
      {loading ? (
        <div className="lx-empty"><p>Opening document…</p></div>
      ) : error ? (
        <div className="lx-empty">
          <div className="lx-empty__ico"><Ic.Doc size={22} /></div>
          <h4>Couldn&apos;t open this document</h4><p>{error}</p>
        </div>
      ) : (
        <>
          {data?.note && (
            <div className="lx-muted" style={{ fontSize: 12.5, marginBottom: 14, lineHeight: 1.5 }}>{data.note}</div>
          )}
          {isPdf ? (
            <iframe title={title} src={inlineUrl} style={{ width: '100%', height: '62vh', border: '1px solid var(--rule)', borderRadius: 12, background: '#f3f4f6' }} />
          ) : isImg ? (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--rule)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <img src={inlineUrl} alt={title} style={{ maxWidth: '100%', maxHeight: '58vh', borderRadius: 8 }} />
            </div>
          ) : (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--rule)', borderRadius: 12, padding: '28px 32px', fontFamily: 'var(--font-serif)', lineHeight: 1.85, fontSize: 14, color: 'var(--ink)', maxHeight: '48vh', overflowY: 'auto' }}>
              {data?.html ? (
                <div dangerouslySetInnerHTML={{ __html: data.html }} />
              ) : data?.text ? (
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{data.text}</p>
              ) : (
                <p className="lx-muted" style={{ margin: 0 }}>No readable text is available for this document yet.</p>
              )}
            </div>
          )}
          <div className="lx-muted" style={{ fontSize: 12.5, marginTop: 12 }}>
            {[data?.ext ? data.ext.toUpperCase() : null, data?.case?.title, data?.case?.case_no].filter(Boolean).join(' · ') || 'Stored in your vault'}
          </div>
        </>
      )}
    </Modal>
  );
}

// ── NEW FOLDER ───────────────────────────────────────────────────────────────
function NewFolderModal({ folders, defaultParent, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState(defaultParent ? String(defaultParent) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function create() {
    if (!name.trim()) { setErr('Give the folder a name.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/vault/folders`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ name: name.trim(), parent_id: parent ? Number(parent) : null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || d.error || 'Could not create folder.');
      onCreated(d);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="New folder" onClose={onClose}
      footer={<><button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="lx-btn lx-btn--primary" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create folder'}</button></>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}
      <div><label className="lbl">Folder name</label><input className="inp" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mehta Industries — Contracts" maxLength={80} /></div>
      <div><label className="lbl">Inside (optional)</label>
        <select className="inp" value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">— Root (top level) —</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
    </Modal>
  );
}

// ── RENAME DOCUMENT ──────────────────────────────────────────────────────────
function RenameDocModal({ doc, onClose, onSaved }) {
  const [title, setTitle] = useState(doc.title || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    const next = title.trim();
    if (!next) { setErr('Title cannot be empty.'); return; }
    if (next.length > 200) { setErr('Title must be under 200 characters.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/vault/documents/${doc.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ title: next }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || d.error || 'Could not rename.');
      onSaved(next);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Rename document" onClose={onClose}
      footer={<><button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="lx-btn lx-btn--primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}
      <div><label className="lbl">Title</label><input className="inp" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></div>
    </Modal>
  );
}

// ── MOVE DOCUMENT ────────────────────────────────────────────────────────────
function MoveDocModal({ doc, folders, onClose, onMoved }) {
  const [folder, setFolder] = useState(doc.folder_id ? String(doc.folder_id) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setBusy(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/vault/documents/${doc.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ folder_id: folder ? Number(folder) : null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || d.error || 'Could not move.');
      onMoved();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Move "${doc.title}"`} onClose={onClose}
      footer={<><button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="lx-btn lx-btn--primary" onClick={save} disabled={busy}>{busy ? 'Moving…' : 'Move here'}</button></>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}
      <div><label className="lbl">Destination folder</label>
        <select className="inp" value={folder} onChange={(e) => setFolder(e.target.value)}>
          <option value="">— Root (unfiled) —</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
    </Modal>
  );
}

// ── SHARE WITH TEAM ──────────────────────────────────────────────────────────
function ShareDocModal({ doc, onClose }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [memberId, setMemberId] = useState('');
  const [permission, setPermission] = useState('view');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        // Prefer the LPMS roster (Settings → Team). Fall back to the old /api/team/members for any
        // deployments still using that table only.
        let list = [];
        try {
          const r = await fetch(`${API_BASE}/api/practice/members`, { credentials: 'include' });
          if (r.ok) {
            const d = await r.json().catch(() => ({}));
            list = Array.isArray(d?.members) ? d.members.filter((m) => m.active !== false) : [];
          }
        } catch { /* ignore and fall back */ }
        if (list.length === 0) {
          const r2 = await fetch(`${API_BASE}/api/team/members`, { credentials: 'include' });
          const d2 = await r2.json().catch(() => ({}));
          if (!r2.ok) throw new Error(d2.message || d2.error || 'Could not load team.');
          list = Array.isArray(d2) ? d2 : (d2.members || []);
        }
        setMembers(list);
        if (list[0]) setMemberId(String(list[0].id));
      } catch (e) { setErr(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  async function share() {
    if (!memberId) { setErr('Pick a team member.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await fetch(`${API_BASE}/api/vault/shares`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ node_type: 'document', node_id: doc.id, team_member_id: Number(memberId), permission }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || d.error || 'Could not share.');
      const chosen = members.find((m) => String(m.id) === String(memberId));
      setMsg(`Shared with ${chosen?.name || 'team member'} (${permission === 'edit' ? 'can edit' : 'view only'}).`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Share "${doc.title}"`} onClose={onClose}
      footer={<><button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Close</button><button className="lx-btn lx-btn--primary" onClick={share} disabled={busy || loading || !memberId}>{busy ? 'Sharing…' : 'Share'}</button></>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}
      {msg && <div style={{ marginBottom: 12, color: 'var(--ok, #2d7a3e)', fontSize: 13 }}>{msg}</div>}
      {loading ? <p className="lx-muted">Loading your team…</p>
       : members.length === 0 ? <p className="lx-muted">No team members yet. Add team members in Settings → Team.</p>
       : (
         <>
           <div><label className="lbl">Team member</label>
             <select className="inp" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
               {members.map((m) => <option key={m.id} value={m.id}>{m.name || m.email} {m.email ? `· ${m.email}` : ''}</option>)}
             </select>
           </div>
           <div><label className="lbl">Permission</label>
             <select className="inp" value={permission} onChange={(e) => setPermission(e.target.value)}>
               <option value="view">View only</option>
               <option value="edit">Can edit</option>
             </select>
           </div>
         </>
       )}
    </Modal>
  );
}
