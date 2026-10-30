import { useState, useEffect, useCallback } from 'react';
import * as Ic from '../icons.jsx';
import Modal from '../components/Modal.jsx';

// The firm's document-management store. Everything is read over the app's
// cookie-authenticated fetch; writes carry the CSRF token the server set.
//   GET  /api/dms/config            → { classes, trash_days, ocr, encryption, storage, max_file_mb }
//   GET  /api/dms/stats             → { documents, pages, bytes, added_7d, review, problems, legal_hold, trash, processing }
//   GET  /api/dms/docs?q&class&status&needs_review&problems&legal_hold&sort&per_page&page
//                                   → { docs: [...], total, terms, facets }
//   GET  /api/dms/docs/:id          → { doc: {...full document...} }
//   POST /api/dms/docs/:id/reprocess → re-reads a document that came in unreadable
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const DMS = `${API_BASE}/api/dms`;

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtNum = (n) => (n ?? 0).toLocaleString('en-IN');

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}
function fmtAgo(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return '';
  const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  if (sec < 86400 * 7) return `${Math.round(sec / 86400)} d ago`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtBytes(n) {
  if (n == null || Number.isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

// Short tag shown in each row's badge tile, derived from the file extension.
function fileTag(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'pdf') return 'PDF';
  if (['doc', 'docx', 'rtf'].includes(e)) return 'DOC';
  if (['xls', 'xlsx', 'csv'].includes(e)) return 'XLS';
  if (['ppt', 'pptx'].includes(e)) return 'PPT';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff'].includes(e)) return 'IMG';
  if (['eml', 'msg'].includes(e)) return 'MAIL';
  if (['txt', 'md', 'htm', 'html'].includes(e)) return 'TXT';
  return (e || 'FILE').slice(0, 4).toUpperCase();
}

// How the server's processing status reads to the user, and which badge tone it wears.
const STATUS = {
  queued: { label: 'Waiting', tone: 'muted' },
  processing: { label: 'Reading', tone: 'muted' },
  ready: { label: 'Ready', tone: 'ok' },
  ready_partial: { label: 'Partly read', tone: 'warn' },
  needs_ocr: { label: 'Needs OCR', tone: 'warn' },
  empty: { label: 'No text', tone: 'warn' },
  unsupported: { label: 'Unreadable', tone: 'warn' },
  failed: { label: 'Failed', tone: 'risk' },
};
const statusOf = (s) => STATUS[s] || STATUS.ready;

// The server understands these filter shapes; each chip contributes its own query params.
const STATUS_FILTERS = [
  { key: 'all', label: 'All documents', params: {} },
  { key: 'ready', label: 'Ready', params: { status: 'ready' } },
  { key: 'review', label: 'Needs a look', params: { needs_review: '1' } },
  { key: 'problems', label: 'Not fully read', params: { problems: '1' } },
  { key: 'hold', label: 'Legal hold', params: { legal_hold: '1' } },
];

function metaLine(d) {
  const cases = (d.case_numbers || []).slice(0, 2).join(' · ');
  const bits = [cases, d.parties, d.court, fmtDate(d.doc_date)].filter(Boolean);
  if (!bits.length && d.original_name && d.original_name !== d.title) bits.push(d.original_name);
  return bits.join('  ·  ') || '—';
}

export default function DocumentHub() {
  const [config, setConfig] = useState(null);
  const [stats, setStats] = useState(null);
  const [docs, setDocs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [statusKey, setStatusKey] = useState('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [openId, setOpenId] = useState(null);

  // Mode: 'library' | 'review' | 'trash'. Review is a queue UX; Trash is a
  // separate list fetched from /api/dms/trash with restore/purge actions.
  const [mode, setMode] = useState('library');
  const [selected, setSelected] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState('');

  // Trash state (separate list, loaded only when the Trash tab is open).
  const [trashDocs, setTrashDocs] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashErr, setTrashErr] = useState('');
  const [trashDays, setTrashDays] = useState(0);

  const loadTrash = useCallback(async () => {
    setTrashLoading(true); setTrashErr('');
    try {
      const r = await fetch(`${DMS}/trash?per_page=100`, { credentials: 'include' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || d.error || 'Could not load trash.');
      setTrashDocs(Array.isArray(d.docs) ? d.docs : []);
      setTrashDays(d.days || 0);
    } catch (e) { setTrashErr(e.message); }
    finally { setTrashLoading(false); }
  }, []);

  useEffect(() => { if (mode === 'trash') loadTrash(); setSelected(new Set()); setBulkMsg(''); }, [mode, loadTrash]);

  async function runBulk(action, extra = {}) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true); setBulkMsg('');
    try {
      const r = await fetch(`${DMS}/bulk`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ action, ids, ...extra }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || d.error || 'Bulk action failed.');
      const done = d.done ?? ids.length;
      const skipped = (d.skipped || []).length;
      setBulkMsg(`${done} ${done === 1 ? 'item' : 'items'} ${action}d${skipped ? ` · ${skipped} skipped` : ''}.`);
      setSelected(new Set());
      // Refresh whichever list is in view.
      if (mode === 'trash') loadTrash(); else load();
      fetch(`${DMS}/stats`, { credentials: 'include' }).then((r) => r.ok ? r.json() : null).then((s) => s && setStats(s));
    } catch (e) { setBulkMsg(e.message); }
    finally { setBulkBusy(false); }
  }

  async function singleDocAction(id, action) {
    setBulkBusy(true);
    try {
      let url, method;
      if (action === 'restore') { url = `${DMS}/docs/${id}/restore`; method = 'POST'; }
      else if (action === 'purge') { url = `${DMS}/docs/${id}/purge`; method = 'DELETE'; }
      else if (action === 'trash') { url = `${DMS}/bulk`; method = 'POST'; }
      else if (action === 'accept') { url = `${DMS}/docs/${id}`; method = 'PATCH'; }
      const opts = { method, credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() } };
      if (action === 'trash') opts.body = JSON.stringify({ action: 'trash', ids: [id] });
      if (action === 'accept') opts.body = JSON.stringify({ review: 'reviewed' });
      const r = await fetch(url, opts);
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || d.error || 'Action failed.'); }
      if (mode === 'trash') loadTrash(); else load();
      fetch(`${DMS}/stats`, { credentials: 'include' }).then((r) => r.ok ? r.json() : null).then((s) => s && setStats(s));
    } catch (e) { alert(e.message); }
    finally { setBulkBusy(false); }
  }

  async function emptyTrash() {
    if (!window.confirm('Permanently delete every item in the trash? This cannot be undone.')) return;
    try {
      const r = await fetch(`${DMS}/trash/empty`, { method: 'POST', credentials: 'include', headers: { 'X-CSRF-TOKEN': csrf() } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || 'Could not empty trash.');
      alert(`Permanently deleted ${d.purged || 0} items${d.skipped ? ` (${d.skipped} skipped — on legal hold)` : ''}.`);
      loadTrash();
    } catch (e) { alert(e.message); }
  }

  const allIds = (mode === 'trash' ? trashDocs : docs).map((d) => d.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  function toggleAll() { setSelected(allSelected ? new Set() : new Set(allIds)); }
  function toggleOne(id) { setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }

  // Config + overview numbers load once; neither blocks the document list.
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`${DMS}/config`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${DMS}/stats`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([c, s]) => { if (alive) { setConfig(c); setStats(s); } });
    return () => { alive = false; };
  }, []);

  const load = useCallback(async (signal) => {
    setLoading(true); setError('');
    try {
      const sf = STATUS_FILTERS.find((s) => s.key === statusKey) || STATUS_FILTERS[0];
      const p = new URLSearchParams();
      if (q.trim()) p.set('q', q.trim());
      if (typeFilter) p.set('class', typeFilter);
      Object.entries(sf.params).forEach(([k, v]) => p.set(k, v));
      p.set('sort', q.trim() ? 'relevance' : 'newest');
      p.set('per_page', '60');
      const res = await fetch(`${DMS}/docs?${p.toString()}`, { credentials: 'include', signal });
      if (!res.ok) throw new Error(res.status === 401 ? 'Your session has expired. Please sign in again.' : 'load');
      const data = await res.json();
      setDocs(Array.isArray(data.docs) ? data.docs : []);
      setTotal(data.total ?? (data.docs?.length || 0));
    } catch (e) {
      if (e.name === 'AbortError') return;
      setError(e.message === 'load' ? 'Could not load your documents. Please try again.' : e.message);
    } finally {
      setLoading(false);
    }
  }, [q, typeFilter, statusKey]);

  // Debounce only the typed search; chip changes feel instant.
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => load(ctrl.signal), q.trim() ? 280 : 0);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [load, q]);

  const typeOptions = (config?.classes || [])
    .map((c) => (typeof c === 'string' ? c : (c?.name || c?.label || c?.id)))
    .filter((c) => c && c !== 'Unclassified');

  const STAT_CARDS = [
    { Icon: Ic.Library, num: stats ? fmtNum(stats.documents) : '—', label: 'Documents', sub: stats ? `${fmtNum(stats.pages)} pages · ${fmtBytes(stats.bytes)}` : 'In the store' },
    { Icon: Ic.Upload, num: stats ? fmtNum(stats.added_7d) : '—', label: 'Added this week', sub: 'Last 7 days' },
    { Icon: Ic.Eye, num: stats ? fmtNum(stats.review) : '—', label: 'Need a quick look', sub: 'Type is a guess' },
    { Icon: Ic.Shield, num: stats ? fmtNum(stats.legal_hold) : '—', label: 'On legal hold', sub: 'Cannot be deleted' },
  ];

  const countLabel = loading ? 'Searching…'
    : q.trim() ? `${fmtNum(total)} ${total === 1 ? 'match' : 'matches'} for “${q.trim().slice(0, 36)}”`
    : `${fmtNum(total)} ${total === 1 ? 'document' : 'documents'}`;

  return (
    <div className="lx-page lx-rise">
      <div className="lx-between ph" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 18 }}>
        <div>
          <span className="ph__eyebrow">Document management</span>
          <h1 className="ph__title">Document Hub</h1>
          <p className="ph__sub">Every file your chambers holds — read, filed by type and searchable inside the pages.</p>
        </div>
        <div className="lx-field" style={{ height: 46, maxWidth: 320, flex: '1 1 240px' }}>
          <Ic.Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search inside every document…" style={{ fontSize: 14 }} />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear search" style={{ display: 'grid', placeItems: 'center', background: 'none', border: 0, cursor: 'pointer', color: 'var(--muted)', padding: 0 }}>
              <Ic.X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Overview */}
      <section className="lx-stats">
        {STAT_CARDS.map((s) => (
          <div className="lx-stat" key={s.label}>
            <div className="lx-stat__ico"><s.Icon size={18} /></div>
            <div className="lx-stat__num">{s.num}</div>
            <div className="lx-stat__label">{s.label}</div>
            <div className="lx-stat__sub">{s.sub}</div>
          </div>
        ))}
      </section>

      {/* Tabs */}
      <div className="tabs lx-mt-l">
        {[
          ['library', 'Library'],
          ['review', `Review${stats?.review ? ` · ${fmtNum(stats.review)}` : ''}`],
          ['trash', `Trash${stats?.trash ? ` · ${fmtNum(stats.trash)}` : ''}`],
        ].map(([k, label]) => (
          <button key={k} className={mode === k ? 'is-on' : ''} onClick={() => setMode(k)}>{label}</button>
        ))}
      </div>

      {/* REVIEW QUEUE */}
      {mode === 'review' && (
        <ReviewQueue onDone={() => { fetch(`${DMS}/stats`, { credentials: 'include' }).then((r) => r.ok ? r.json() : null).then((s) => s && setStats(s)); }} openDetail={setOpenId} />
      )}

      {/* TRASH */}
      {mode === 'trash' && (
        <div className="lx-card lx-card--pad lx-mt-l">
          <div className="lx-between" style={{ marginBottom: 14 }}>
            <span className="lx-item__meta" style={{ fontSize: 13 }}>
              {trashLoading ? 'Loading trash…' : `${fmtNum(trashDocs.length)} item${trashDocs.length === 1 ? '' : 's'} in trash${trashDays ? ` · auto-purged after ${trashDays} days` : ''}`}
            </span>
            <div className="lx-row" style={{ gap: 10 }}>
              {selected.size > 0 && (
                <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => runBulk('restore')} disabled={bulkBusy}>Restore {selected.size}</button>
              )}
              <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={emptyTrash} disabled={trashDocs.length === 0}>Empty trash</button>
            </div>
          </div>
          {trashErr ? (
            <div className="lx-empty"><p>{trashErr}</p><button className="lx-btn lx-btn--sm" onClick={loadTrash}>Try again</button></div>
          ) : trashDocs.length === 0 && !trashLoading ? (
            <div className="lx-empty"><div className="lx-empty__ico"><Ic.Doc size={22} /></div><h4>Trash is empty</h4><p>Trashed documents will show up here. You can restore within {trashDays || 30} days.</p></div>
          ) : (
            <div className="lx-list">
              {trashDocs.map((d) => (
                <div className="lx-item" key={d.id} style={{ padding: '14px 4px' }}>
                  <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleOne(d.id)} onClick={(e) => e.stopPropagation()} style={{ marginRight: 8 }} />
                  <div className="lx-item__ico" style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 10.5 }}>{fileTag(d.ext)}</div>
                  <div className="lx-item__body" style={{ flex: 2 }}>
                    <div className="lx-item__title">{d.title || d.original_name || 'Untitled document'}</div>
                    <div className="lx-item__meta">{metaLine(d)} · trashed {fmtAgo(d.deleted_at || d.updated_at)}</div>
                  </div>
                  <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => singleDocAction(d.id, 'restore')} disabled={bulkBusy}>Restore</button>
                  <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => { if (window.confirm(`Permanently delete "${d.title || 'this document'}"? Cannot be undone.`)) singleDocAction(d.id, 'purge'); }} disabled={bulkBusy || d.legal_hold} title={d.legal_hold ? 'On legal hold — cannot be purged' : ''}>Purge</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      {mode === 'library' && (
      <div className="lx-mt-l" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="lx-row" style={{ gap: 7, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map((f) => (
            <button key={f.key} className={`chip${statusKey === f.key ? ' is-on' : ''}`} onClick={() => setStatusKey(f.key)}>{f.label}</button>
          ))}
        </div>
        {typeOptions.length > 0 && (
          <div className="lx-row" style={{ gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.07em', fontSize: 10.5 }}>By type</span>
            <button className={`chip${!typeFilter ? ' is-on' : ''}`} onClick={() => setTypeFilter('')}>Any</button>
            {typeOptions.map((t) => (
              <button key={t} className={`chip${typeFilter === t ? ' is-on' : ''}`} onClick={() => setTypeFilter(typeFilter === t ? '' : t)}>{t}</button>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Bulk bar (visible across Library + Trash when something is selected) */}
      {mode !== 'review' && selected.size > 0 && (
        <div className="lx-card lx-card--pad lx-mt-l" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderColor: 'var(--accent)', background: 'var(--accent-soft)' }}>
          <span className="lx-badge"><Ic.Check size={13} /> {selected.size} selected</span>
          {mode === 'library' && <>
            <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => runBulk('accept')} disabled={bulkBusy}>Mark reviewed</button>
            <select onChange={(e) => { if (e.target.value) { runBulk('classify', { doc_class: e.target.value }); e.target.value = ''; } }} disabled={bulkBusy} style={{ height: 34, padding: '0 10px', border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--ink)' }}>
              <option value="">Classify as…</option>
              {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => { if (window.confirm(`Move ${selected.size} items to trash?`)) runBulk('trash'); }} disabled={bulkBusy}>Trash</button>
          </>}
          {mode === 'trash' && <>
            <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => runBulk('restore')} disabled={bulkBusy}>Restore</button>
            <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => { if (window.confirm(`Permanently delete ${selected.size} items?`)) runBulk('purge'); }} disabled={bulkBusy}>Purge</button>
          </>}
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => setSelected(new Set())} disabled={bulkBusy} style={{ marginLeft: 'auto' }}>Clear</button>
          {bulkMsg && <span className="lx-muted" style={{ fontSize: 12.5 }}>{bulkMsg}</span>}
        </div>
      )}

      {/* List (Library mode) */}
      {mode === 'library' && (
      <div className="lx-card lx-card--pad lx-mt-l">
        <div className="lx-between" style={{ marginBottom: 14 }}>
          <div className="lx-row" style={{ gap: 10, alignItems: 'center' }}>
            {docs.length > 0 && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, color: 'var(--muted)' }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} /> Select all
              </label>
            )}
            <span className="lx-item__meta" aria-live="polite" style={{ fontSize: 13 }}>{error ? ' ' : countLabel}</span>
          </div>
          {stats?.processing > 0 && (
            <span className="lx-badge lx-badge--muted">Reading {fmtNum(stats.processing)} in the background</span>
          )}
        </div>

        {loading ? (
          <div className="lx-empty"><p>Loading your documents…</p></div>
        ) : error ? (
          <div className="lx-empty">
            <div className="lx-empty__ico"><Ic.Library size={22} /></div>
            <h4>Couldn&apos;t load documents</h4><p>{error}</p>
            <button className="lx-btn lx-btn--sm" style={{ marginTop: 10 }} onClick={() => load()}>Try again</button>
          </div>
        ) : docs.length === 0 ? (
          <div className="lx-empty">
            <div className="lx-empty__ico"><Ic.Doc size={22} /></div>
            <h4>{q.trim() || statusKey !== 'all' || typeFilter ? 'Nothing matches' : 'No documents yet'}</h4>
            <p>{q.trim() || statusKey !== 'all' || typeFilter
              ? 'Try a shorter search, or clear a filter — searching looks inside every page, not just titles.'
              : 'Once your firm imports files, every page is read so you can search and file them here.'}</p>
            {(q.trim() || statusKey !== 'all' || typeFilter) && (
              <button className="lx-btn lx-btn--sm" onClick={() => { setQ(''); setStatusKey('all'); setTypeFilter(''); }}>Clear search &amp; filters</button>
            )}
          </div>
        ) : (
          <div className="lx-list">
            {docs.map((d) => {
              const st = statusOf(d.status);
              return (
                <div className="lx-item" key={d.id} onClick={() => setOpenId(d.id)} style={{ padding: '15px 4px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleOne(d.id)} onClick={(e) => e.stopPropagation()} style={{ marginRight: 8 }} />
                  <div className="lx-item__ico" style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 10.5, letterSpacing: '.03em' }}>{fileTag(d.ext)}</div>
                  <div className="lx-item__body" style={{ flex: 2 }}>
                    <div className="lx-item__title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      {d.title || d.original_name || 'Untitled document'}
                      {d.legal_hold ? <Ic.Shield size={13} style={{ color: 'var(--accent-ink)', flexShrink: 0 }} /> : null}
                    </div>
                    <div className="lx-item__meta">{metaLine(d)}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }} className="hide-sm">
                    <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{d.doc_class || 'Unclassified'}</div>
                    <div className="lx-item__meta">{d.page_count ? `${fmtNum(d.page_count)} ${d.page_count === 1 ? 'page' : 'pages'}` : fmtBytes(d.size)}</div>
                  </div>
                  <div style={{ width: 86, textAlign: 'right' }} className="hide-sm">
                    <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10 }}>Added</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink)' }}>{fmtAgo(d.created_at)}</div>
                  </div>
                  <span className={`lx-badge lx-badge--${st.tone}`} style={{ minWidth: 92, justifyContent: 'center' }}>{st.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {openId != null && <DocDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ── REVIEW QUEUE ─────────────────────────────────────────────────────────────
// Card-at-a-time triage of docs the system flagged as `needs_review`. Each
// card shows what we think the type is + lets the lawyer accept, trash, or
// correct the classification. Walks through them one by one.
function ReviewQueue({ onDone, openDetail }) {
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [classes, setClasses] = useState([]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [r1, r2] = await Promise.all([
        fetch(`${DMS}/docs?needs_review=1&sort=newest&per_page=50`, { credentials: 'include' }),
        fetch(`${DMS}/config`, { credentials: 'include' }),
      ]);
      const d = await r1.json().catch(() => ({}));
      const c = await r2.json().catch(() => ({}));
      if (!r1.ok) throw new Error(d.message || 'Could not load the review queue.');
      setQueue(Array.isArray(d.docs) ? d.docs : []);
      setIdx(0);
      setClasses((c?.classes || []).map((x) => (typeof x === 'string' ? x : (x?.name || x?.label || x?.id))).filter(Boolean));
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(action, extra = {}) {
    const doc = queue[idx]; if (!doc || busy) return;
    setBusy(true);
    try {
      if (action === 'accept') {
        const body = { review: 'reviewed', ...extra };
        const r = await fetch(`${DMS}/docs/${doc.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() }, body: JSON.stringify(body) });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || 'Could not save.'); }
      } else if (action === 'trash') {
        const r = await fetch(`${DMS}/bulk`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() }, body: JSON.stringify({ action: 'trash', ids: [doc.id] }) });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || 'Could not trash.'); }
      }
      setQueue((xs) => xs.filter((_, i) => i !== idx));
      setIdx((i) => Math.min(i, queue.length - 2));
      onDone?.();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="lx-card lx-card--pad lx-mt-l"><div className="lx-empty"><p>Loading review queue…</p></div></div>;
  if (err) return <div className="lx-card lx-card--pad lx-mt-l"><div className="lx-empty"><p>{err}</p><button className="lx-btn lx-btn--sm" onClick={load}>Try again</button></div></div>;
  if (queue.length === 0) return <div className="lx-card lx-card--pad lx-mt-l"><div className="lx-empty"><div className="lx-empty__ico"><Ic.Check size={22} /></div><h4>Nothing to review</h4><p>Every document has been accepted or classified. Nice.</p></div></div>;

  const doc = queue[idx];
  return (
    <div className="lx-card lx-card--pad lx-mt-l">
      <div className="lx-between" style={{ marginBottom: 14 }}>
        <span className="lx-item__meta" style={{ fontSize: 13 }}>Reviewing {idx + 1} of {queue.length}</span>
        <div className="lx-row" style={{ gap: 6 }}>
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>← Previous</button>
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => setIdx((i) => Math.min(queue.length - 1, i + 1))} disabled={idx >= queue.length - 1}>Next →</button>
        </div>
      </div>
      <div style={{ padding: '18px 20px', border: '1px solid var(--rule)', borderRadius: 14, background: 'var(--paper)' }}>
        <div className="lx-row" style={{ gap: 10, marginBottom: 10 }}>
          <span className="lx-badge" style={{ fontFamily: 'var(--font-serif)', fontWeight: 600 }}>{fileTag(doc.ext)}</span>
          <span className="lx-badge lx-badge--warn">Needs review</span>
          <span className="lx-badge lx-badge--muted">AI guess: {doc.doc_class || 'Unclassified'}</span>
        </div>
        <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--ink)', margin: '6px 0 6px' }}>{doc.title || doc.original_name || 'Untitled document'}</h3>
        <div className="lx-item__meta" style={{ marginBottom: 14 }}>{metaLine(doc)}</div>
        {(doc.summary || doc.snippet || doc.preview) && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--rule)', borderRadius: 10, padding: '14px 16px', fontFamily: 'var(--font-serif)', fontSize: 14, lineHeight: 1.7, color: 'var(--ink)', maxHeight: 220, overflowY: 'auto', marginBottom: 16, whiteSpace: 'pre-wrap' }}>
            {doc.summary || doc.snippet || doc.preview}
          </div>
        )}
        <div className="lx-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={() => act('accept')} disabled={busy}>
            <Ic.Check size={14} /> Accept classification
          </button>
          <select onChange={(e) => { if (e.target.value) { act('accept', { doc_class: e.target.value }); e.target.value = ''; } }} disabled={busy} style={{ height: 34, padding: '0 10px', border: '1px solid var(--rule)', borderRadius: 999, background: 'var(--bg-card)', color: 'var(--ink)', fontSize: 12.5 }}>
            <option value="">Correct type → …</option>
            {classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => openDetail?.(doc.id)}>Open</button>
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => { if (window.confirm(`Reject and send "${doc.title || 'this document'}" to trash?`)) act('trash'); }} disabled={busy} style={{ marginLeft: 'auto', color: 'var(--risk, #c0392b)' }}>Reject · trash</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  if (children == null || children === '' ) return null;
  return (
    <div>
      <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--ink)', marginTop: 2 }}>{children}</div>
    </div>
  );
}

function DocDetail({ id, onClose }) {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    fetch(`${DMS}/docs/${id}`, { credentials: 'include' })
      .then((r) => { if (!r.ok) throw new Error('load'); return r.json(); })
      .then((data) => { if (alive) setDoc(data.doc || data); })
      .catch(() => { if (alive) setError('Could not load this document.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const reprocess = async () => {
    setBusy(true); setNote('');
    try {
      const res = await fetch(`${DMS}/docs/${id}/reprocess`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
      });
      if (!res.ok) throw new Error('x');
      setNote('Queued to be read again — it will refresh here once done.');
    } catch {
      setNote('Could not queue it just now. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const st = doc ? statusOf(doc.status) : null;
  const unread = doc && ['failed', 'needs_ocr', 'ready_partial', 'empty', 'unsupported'].includes(doc.status);
  const title = doc?.title || doc?.original_name || 'Document';
  const ext = (doc?.ext || '').toLowerCase();
  const isPdf = ext === 'pdf';
  const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);
  const isText = ['txt', 'md', 'json', 'csv', 'log'].includes(ext);
  const inlineUrl = doc ? `${DMS}/docs/${doc.id}/file` : '';

  return (
    <Modal title={loading ? 'Loading…' : title} onClose={onClose} wide
      footer={doc ? (
        <>
          <button className="lx-btn lx-btn--ghost" onClick={onClose}>Close</button>
          {unread && <button className="lx-btn lx-btn--ghost" onClick={reprocess} disabled={busy}>{busy ? 'Queuing…' : 'Read again'}</button>}
          <a className="lx-btn lx-btn--gold" href={`${DMS}/docs/${id}/download`}><Ic.Upload size={14} style={{ transform: 'rotate(180deg)' }} /> Download original</a>
        </>
      ) : null}>
      {loading ? (
        <div className="lx-empty"><p>Opening the document…</p></div>
      ) : error ? (
        <div className="lx-empty">
          <div className="lx-empty__ico"><Ic.Doc size={22} /></div>
          <h4>Couldn&apos;t open it</h4><p>{error}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="lx-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="chip" style={{ cursor: 'default' }}>{fileTag(doc.ext)}</span>
            <span className="chip" style={{ cursor: 'default' }}>{doc.doc_class || 'Unclassified'}</span>
            <span className={`lx-badge lx-badge--${st.tone}`}>{st.label}</span>
            {doc.legal_hold ? <span className="lx-badge lx-badge--warn"><Ic.Shield size={12} /> Legal hold</span> : null}
            {doc.version > 1 ? <span className="lx-badge lx-badge--muted">v{doc.version}</span> : null}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 18 }}>
            <Field label="File type">{(doc.ext || '').toUpperCase() || '—'}</Field>
            <Field label="Size">{fmtBytes(doc.size)}</Field>
            <Field label="Pages">{doc.page_count ? fmtNum(doc.page_count) : '—'}</Field>
            <Field label="Document date">{fmtDate(doc.doc_date) || '—'}</Field>
            <Field label="Added">{fmtAgo(doc.created_at) || '—'}</Field>
            <Field label="Court">{doc.court}</Field>
            <Field label="Parties">{doc.parties}</Field>
            <Field label="Next hearing">{fmtDate(doc.next_hearing)}</Field>
          </div>

          {(doc.case_numbers || []).length > 0 && (
            <div>
              <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10, marginBottom: 8 }}>Case numbers</div>
              <div className="lx-row" style={{ gap: 7, flexWrap: 'wrap' }}>
                {doc.case_numbers.map((c) => <span key={c} className="chip" style={{ cursor: 'default' }}>{c}</span>)}
              </div>
            </div>
          )}

          {(doc.tags || []).length > 0 && (
            <div>
              <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10, marginBottom: 8 }}>Tags</div>
              <div className="lx-row" style={{ gap: 7, flexWrap: 'wrap' }}>
                {doc.tags.map((t) => <span key={t} className="chip" style={{ cursor: 'default' }}>{t}</span>)}
              </div>
            </div>
          )}

          {/* Inline reader — PDFs, images and extracted text render in-app.
              Other formats fall back to the Download button in the footer. */}
          {isPdf ? (
            <div>
              <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10, marginBottom: 8 }}>Document</div>
              <iframe title={title} src={inlineUrl} style={{ width: '100%', height: '62vh', border: '1px solid var(--rule)', borderRadius: 12, background: '#f3f4f6' }} />
            </div>
          ) : isImg ? (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--rule)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <img src={inlineUrl} alt={title} style={{ maxWidth: '100%', maxHeight: '58vh', borderRadius: 8 }} />
            </div>
          ) : (doc.body_text || doc.text || doc.content) ? (
            <div>
              <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10, marginBottom: 8 }}>Full text</div>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--rule)', borderRadius: 12, padding: '20px 24px', fontFamily: 'var(--font-serif)', lineHeight: 1.8, fontSize: 14, color: 'var(--ink)', maxHeight: '55vh', overflowY: 'auto' }}>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{doc.body_text || doc.text || doc.content}</p>
              </div>
            </div>
          ) : (doc.summary || doc.snippet || doc.preview) ? (
            <div>
              <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10, marginBottom: 8 }}>Preview</div>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--rule)', borderRadius: 12, padding: '20px 24px', fontFamily: 'var(--font-serif)', lineHeight: 1.8, fontSize: 14, color: 'var(--ink)', maxHeight: '32vh', overflowY: 'auto' }}>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{doc.summary || doc.snippet || doc.preview}</p>
                <div className="lx-muted" style={{ fontSize: 12, marginTop: 10 }}>— snippet only. Click Download to see the full file.</div>
              </div>
            </div>
          ) : isText ? (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--rule)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <p className="lx-muted" style={{ fontSize: 13 }}>Opening this file type inline isn't supported yet. Use Download to open it in your usual app.</p>
            </div>
          ) : (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--rule)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <p className="lx-muted" style={{ fontSize: 13 }}>No inline preview available for this file. Use <strong>Download original</strong> to open it in your usual app.</p>
            </div>
          )}

          {note && <div role="status" style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{note}</div>}
        </div>
      )}
    </Modal>
  );
}
