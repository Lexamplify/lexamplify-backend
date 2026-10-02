import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import './dochub.css';
import { ApiError, dh } from './api.js';
import './files.css';
import { AddToBundleModal, Bundles } from './Bundles.jsx';
import { BulkBar } from './BulkBar.jsx';
import { DocRow, Pager, Skeleton } from './DocList.jsx';
import { FacetRail } from './FacetRail.jsx';
import { fx } from './filesApi.js';
import { FilingQueue } from './FilingQueue.jsx';
import { Icon } from './icons.jsx';
import { ImportPanel, UploadDock, useFileIntake, useUploader } from './ImportPanel.jsx';
import { PaperFiles } from './PaperFiles.jsx';
import { PreviewDrawer } from './PreviewDrawer.jsx';
import { ReviewMode } from './ReviewMode.jsx';
import { ScanStudio } from './ScanStudio.jsx';
import { DuplicatesView, TrashView } from './SideViews.jsx';
import { Chip, Confirm, EmptyState, Modal, Portal, Toasts, buildFolderIndex, rollUpFolderCounts, useDebounced, useHotkeys, useMedia, useToasts } from './ui.jsx';
import { FILE_VIEWS, PER_PAGE, activeFilterCount, apiParams, applyPatch, filterSignature, readFilters, readView } from './hubState.js';
import { SORTS, fmtBytes, fmtNum, plural } from './format.js';
import { uploader } from './uploader.js';

const TABS = [
  { id: 'library', label: 'Library' },
  { id: 'tofile', label: 'To file', group: 'files' },
  { id: 'scan', label: 'Scan & file', group: 'files' },
  { id: 'paper', label: 'Paper files', group: 'files' },
  { id: 'bundles', label: 'Bundles', group: 'files' },
  { id: 'review', label: 'Review', group: 'care' },
  { id: 'problems', label: 'Problems', group: 'care' },
  { id: 'duplicates', label: 'Duplicates', group: 'care' },
  { id: 'trash', label: 'Trash', group: 'care' },
];
const BULK_LABEL = { move: 'Moved', classify: 'Set the type of', tag_add: 'Tagged', tag_remove: 'Removed the tag from', link_matter: 'Updated the matter of', accept: 'Confirmed', hold: 'Updated the legal hold on', reprocess: 'Queued for reading:', trash: 'Moved to the trash:' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dismissed = (k) => { try { return localStorage.getItem(`dh_dismiss_${k}`) === '1'; } catch { return false; } };
const dismiss = (k) => { try { localStorage.setItem(`dh_dismiss_${k}`, '1'); } catch { /* private mode: fine */ } };

function NewFolderModal({ folderIndex, initialParent, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState(initialParent ? String(initialParent) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e?.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setErr('');
    try { await dh.createFolder(name.trim(), parent ? Number(parent) : null); onCreated(name.trim()); }
    catch (ex) { setErr(ex.message || 'Could not create the folder.'); setBusy(false); }
  };
  return (
    <Modal small title="New folder" onClose={onClose}
      footer={<><button type="button" className="dh-btn ghost" onClick={onClose}>Cancel</button><button type="button" className="dh-btn primary" disabled={!name.trim() || busy} onClick={submit}>{busy ? 'Creating…' : 'Create folder'}</button></>}>
      <form onSubmit={submit}>
        <label className="dh-field"><span className="lab">Name</span><input className="dh-input" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sharma v. Union of India" /></label>
        <label className="dh-field"><span className="lab">Inside</span>
          <select className="dh-select" value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">Top level</option>
            {folderIndex.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select></label>
        {err ? <p role="alert" style={{ color: 'var(--accent)', margin: 0 }}>{err}</p> : null}
      </form>
    </Modal>
  );
}

function Shortcuts({ onClose }) {
  const rows = [['/', 'Search'], ['j  k', 'Move down / up the list'], ['Enter', 'Open the highlighted document'], ['x', 'Select the highlighted document'],
    ['u', 'Import documents'], ['Esc', 'Clear selection / close'], ['← →', 'Turn pages in the preview'], ['j  k', 'Next / previous document in the preview'], ['?', 'This help']];
  return (
    <Modal small title="Keyboard shortcuts" onClose={onClose}>
      <div className="dh-keys">
        {rows.map(([k, d], i) => <span key={i} style={{ display: 'contents' }}><span className="k">{k.split('  ').map((x) => <span key={x} className="dh-kbd">{x}</span>)}</span><span>{d}</span></span>)}
      </div>
    </Modal>
  );
}

function Spark({ days }) {
  const max = Math.max(1, ...days.map((d) => d.n));
  return <span className="dh-spark" aria-hidden="true">{days.map((d, i) => <i key={d.date} className={i >= days.length - 7 ? 'hi' : ''} style={{ height: `${Math.max(8, (d.n / max) * 100)}%` }} />)}</span>;
}

export default function DocumentHub() {
  const [sp, setSp] = useSearchParams();
  const view = readView(sp);
  const isFiles = FILE_VIEWS.includes(view);
  const scanSid = sp.get('scan') || null;
  const bundleId = Number(sp.get('bundle')) || null;
  const pfToken = sp.get('pf') || null;
  const caseRef = sp.get('case') || null;
  const filters = useMemo(() => readFilters(sp), [sp]);
  const openId = Number(sp.get('doc')) || null;
  const toasts = useToasts();
  const toast = toasts.push;
  const snap = useUploader();

  const [config, setConfig] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [folders, setFolders] = useState([]);
  const [matters, setMatters] = useState([]);
  const [stats, setStats] = useState(null);
  const [tick, setTick] = useState(0);
  const [list, setList] = useState({ docs: [], total: 0, terms: [], facets: null, key: null });
  const [listState, setListState] = useState('loading');
  const [listErr, setListErr] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [allInfo, setAllInfo] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const narrowScreen = useMedia('(max-width: 980px)');
  const [newFolder, setNewFolder] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [adopt, setAdopt] = useState(null);
  const [fsum, setFsum] = useState(null);                 // numbers for the paper-to-digital tabs
  const [caseLabel, setCaseLabel] = useState('');
  const [addBundle, setAddBundle] = useState(null);       // document ids waiting to be put in a bundle
  const [hideOcr, setHideOcr] = useState(() => dismissed('ocr'));
  const [qInput, setQInput] = useState(filters.q);
  const searchRef = useRef(null);
  const pushedQ = useRef(filters.q);
  const lastClick = useRef(null);
  const dragDepth = useRef(0);

  const folderIndex = useMemo(() => buildFolderIndex(folders), [folders]);
  const folderLabel = useCallback((id) => folderIndex.byId.get(id)?.name || '', [folderIndex]);
  const folderCounts = useMemo(() => rollUpFolderCounts(folderIndex, list.facets?.folders), [folderIndex, list.facets]);

  // ── URL helpers ──────────────────────────────────────────────────────────────────────
  const setFilters = useCallback((patch, opts = {}) => setSp((prev) => applyPatch(prev, patch), { replace: opts.push ? false : true }), [setSp]);
  const setView = useCallback((v, extra = {}) => setSp((prev) => {
    const n = new URLSearchParams(prev);
    n.delete('page'); n.delete('doc');
    ['scan', 'bundle', 'pf', 'case'].forEach((k) => n.delete(k));
    if (v === 'library') n.delete('view'); else n.set('view', v);
    Object.entries(extra).forEach(([k, val]) => { if (val) n.set(k, String(val)); });
    return n;
  }), [setSp]);
  // one parameter of a files tab (the scan being worked on, the bundle being built, the case being looked at)
  const setParam = useCallback((k, val, replace = false) => setSp((prev) => {
    const n = new URLSearchParams(prev);
    if (val) n.set(k, String(val)); else n.delete(k);
    // a tab opened by a link (?pf=, ?scan=, ?bundle=) must stay on that tab once the link's parameter is used up
    if (!val && !n.get('view') && FILE_VIEWS.includes(view)) n.set('view', view);
    return n;
  }, { replace }), [setSp, view]);
  const goCaseDocs = useCallback((ref) => {
    if (!ref) { setParam('case', null, true); return; }
    const [kind, id] = String(ref).split(':');
    setSp(() => { const n = new URLSearchParams(); if (kind === 'lpms') n.set('lpms_case', id); else if (kind === 'matter') n.set('matter', id); return n; });
  }, [setSp, setParam]);
  const openDoc = useCallback((id, opts = {}) => setSp((prev) => { const n = new URLSearchParams(prev); n.set('doc', String(id)); return n; }, { replace: !!opts.replace }), [setSp]);
  const closeDoc = useCallback(() => setSp((prev) => { const n = new URLSearchParams(prev); n.delete('doc'); return n; }, { replace: true }), [setSp]);
  const clearAll = useCallback(() => setSp((prev) => {
    const n = new URLSearchParams();
    ['view', 'doc'].forEach((k) => { if (prev.get(k)) n.set(k, prev.get(k)); });
    return n;
  }, { replace: true }), [setSp]);

  // ── search box <-> URL ───────────────────────────────────────────────────────────────
  const debouncedQ = useDebounced(qInput, 320);
  useEffect(() => {
    if (debouncedQ === filters.q) return;
    pushedQ.current = debouncedQ;
    setFilters({ q: debouncedQ.trim() });
  }, [debouncedQ]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (filters.q !== pushedQ.current) { pushedQ.current = filters.q; setQInput(filters.q); } }, [filters.q]);

  // ── loading: config, folders, matters, stats ─────────────────────────────────────────
  const loadFolders = useCallback(() => dh.folders().then((f) => setFolders(f.flat)).catch(() => {}), []);
  const refreshStats = useCallback(async () => {
    try { const s = await dh.stats(); setStats(s); return s; } catch (e) { if (e instanceof ApiError && e.status === 404) setFatal(e); return null; }
  }, []);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const refreshFiles = useCallback(() => fx.summary().then(setFsum).catch(() => {}), []);
  const afterChange = useCallback(() => { refreshStats(); refreshFiles(); bump(); }, [refreshStats, refreshFiles, bump]);
  const onFilingSummary = useCallback((x) => { if (x) setFsum((f) => (f ? { ...f, filing: x } : f)); }, []);
  const onPaperStats = useCallback((x) => { if (x) setFsum((f) => (f ? { ...f, paper: x } : f)); }, []);

  useEffect(() => {
    dh.config().then((c) => { setConfig(c); uploader.configure(c); }).catch((e) => setFatal(e));
    loadFolders();
    dh.matters().then(setMatters).catch(() => {});
    refreshStats();
    refreshFiles();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sp.get('import')) return;
    setImportOpen(true);
    setSp((prev) => { const n = new URLSearchParams(prev); n.delete('import'); return n; }, { replace: true });
  }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (isFiles) refreshFiles(); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!caseRef) { setCaseLabel(''); return undefined; }
    let dead = false;
    fx.cases('', { ref: caseRef }).then((r) => { if (!dead) setCaseLabel(r[0]?.title || ''); }).catch(() => {});
    return () => { dead = true; };
  }, [caseRef]);

  // while anything is being read or uploaded, keep the numbers moving
  const working = (stats?.processing || 0) > 0 || snap.busy || snap.reading;
  const lastCounts = useRef({ p: -1, d: -1 });
  useEffect(() => {
    if (!working) return undefined;
    const t = setInterval(async () => {
      if (document.hidden) return;
      const s = await refreshStats();
      if (s && (s.processing !== lastCounts.current.p || s.documents !== lastCounts.current.d)) {
        lastCounts.current = { p: s.processing, d: s.documents };
        bump();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [working, refreshStats, bump]);

  // an upload finishing anywhere should show up here without a manual refresh
  useEffect(() => {
    let t = null;
    const off = uploader.onActivity(() => { if (t) return; t = setTimeout(() => { t = null; afterChange(); }, 1600); });
    return () => { off(); if (t) clearTimeout(t); };
  }, [afterChange]);

  // Case Vault files that predate the hub are read in the background, a few at a time
  const adopting = useRef(false);
  const hasUnadopted = !!stats?.unadopted;
  useEffect(() => {
    if (!hasUnadopted || adopting.current) return undefined;
    adopting.current = true;
    let dead = false;
    (async () => {
      let failed = 0;
      for (let i = 0; i < 400 && !dead; i += 1) {
        try {
          const r = await dh.adopt(60);
          failed += r.failed || 0;
          if (!dead) setAdopt({ remaining: r.remaining, failed });
          if (!r.adopted || !r.remaining) break;
        } catch { break; }
        await sleep(350);
      }
      adopting.current = false;
      if (!dead) { setAdopt((a) => (a ? { ...a, remaining: 0 } : a)); afterChange(); }
    })();
    return () => { dead = true; adopting.current = false; };
  }, [hasUnadopted]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the list ─────────────────────────────────────────────────────────────────────────
  const listParams = useMemo(() => apiParams(filters, view), [filters, view]);
  const sig = filterSignature(filters, view);
  // The rows on screen belong to `list.key`. The moment the filters/page/tab change they no longer match, in THAT render —
  // so nothing can be selected or opened from rows that are about to be replaced (there is no gap before an effect runs).
  const wantKey = useMemo(() => JSON.stringify([listParams, filters.page]), [listParams, filters.page]);
  const rowsStale = list.key !== null && list.key !== wantKey;
  const reqId = useRef(0);
  const facetSig = useRef('');
  const lastKey = useRef('');
  const hasFacets = useRef(false);
  useEffect(() => {
    if (view === 'duplicates' || view === 'trash' || isFiles) return undefined;
    const id = (reqId.current += 1);
    const ctrl = new AbortController();
    const key = JSON.stringify([listParams, filters.page]);
    const silent = lastKey.current === key;              // only the background tick changed: no dimming, no skeleton
    lastKey.current = key;
    const fsig = JSON.stringify([{ ...listParams, sort: 0, per_page: 0 }, tick]);
    const needFacets = fsig !== facetSig.current || !hasFacets.current;
    if (!silent) setListState((s) => (s === 'ready' || s === 'refreshing' ? 'refreshing' : 'loading'));
    dh.list({ ...listParams, page: filters.page, facets: needFacets ? '1' : '0' }, ctrl.signal).then((r) => {
      if (id !== reqId.current) return;
      if (!r.docs.length && r.total > 0 && filters.page > 1) { setFilters({ page: Math.ceil(r.total / PER_PAGE) }); return; }
      if (needFacets) { facetSig.current = fsig; hasFacets.current = true; }
      setList((prev) => ({ docs: r.docs, total: r.total, terms: r.terms || [], facets: needFacets ? r.facets : prev.facets, key }));
      setListState('ready');
      setListErr('');
    }).catch((e) => {
      if (e?.name === 'AbortError' || id !== reqId.current) return;
      if (e instanceof ApiError && e.status === 404) { setFatal(e); return; }
      setListErr(e.message || 'Could not load your documents.');
      setListState('error');
    });
    return () => ctrl.abort();
  }, [listParams, filters.page, view, tick, isFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSel(new Set()); setAllInfo(null); lastClick.current = null; setCursor(null); }, [sig]);
  useEffect(() => { if (cursor) document.querySelector(`[data-doc-id="${cursor}"]`)?.scrollIntoView({ block: 'nearest' }); }, [cursor]);

  // ── selection + bulk ─────────────────────────────────────────────────────────────────
  const toggle = useCallback((id, { shift } = {}) => {
    if (rowsStale) return;
    setAllInfo(null);
    setCursor(id);
    // The anchor is read NOW: the updater below runs later (during render), by which time lastClick already points here.
    const anchor = lastClick.current;
    setSel((prev) => {
      const next = new Set(prev);
      const ids = list.docs.map((d) => d.id);
      if (shift && anchor && ids.includes(anchor)) {
        const a = ids.indexOf(anchor); const b = ids.indexOf(id);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const on = !prev.has(id);
        ids.slice(lo, hi + 1).forEach((x) => (on ? next.add(x) : next.delete(x)));
      } else if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    lastClick.current = id;
  }, [list.docs, rowsStale]);

  const pageAllSelected = list.docs.length > 0 && list.docs.every((d) => sel.has(d.id));
  const togglePage = () => {
    if (rowsStale) return;
    setAllInfo(null);
    setSel((prev) => { const n = new Set(prev); if (pageAllSelected) list.docs.forEach((d) => n.delete(d.id)); else list.docs.forEach((d) => n.add(d.id)); return n; });
  };
  const selectAllMatching = async () => {
    try {
      const r = await dh.ids(listParams);
      setSel(new Set(r.ids));
      setAllInfo({ total: r.total, capped: r.capped, n: r.ids.length });
    } catch (e) { toast(e.message, { tone: 'bad' }); }
  };

  const runBulk = async (action, extra = {}) => {
    const ids = [...sel];
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      const r = await dh.bulk(ids, action, extra);
      const parts = [`${BULK_LABEL[action] || 'Updated'} ${plural(r.done, 'document')}`];
      if (r.skipped?.length) parts.push(`${r.skipped.length} skipped — ${r.skipped[0].reason}`);
      const opts = r.done === 0 ? { tone: 'bad' } : {};
      if (action === 'trash' && r.done) opts.action = { label: 'Undo', run: () => dh.bulk(ids, 'restore').then(() => { toast('Restored'); afterChange(); }).catch((e) => toast(e.message, { tone: 'bad' })) };
      toast(parts.join(' · '), opts);
      if (action === 'trash') { setSel(new Set()); setAllInfo(null); }
      afterChange();
    } catch (e) { toast(e.message || 'That did not work.', { tone: 'bad' }); }
    finally { setBulkBusy(false); setConfirmTrash(false); }
  };
  const zip = async () => {
    if (sel.size > 200) { toast('A .zip can hold up to 200 documents at a time — select fewer.', { tone: 'bad' }); return; }
    setBulkBusy(true);
    try { await dh.zip([...sel]); } catch (e) { toast(e.message || 'Could not build the .zip.', { tone: 'bad' }); }
    finally { setBulkBusy(false); }
  };
  const retryAllProblems = async () => {
    setBulkBusy(true);
    try {
      const r = await dh.ids({ problems: true });
      if (!r.ids.length) { toast('Nothing to retry.'); return; }
      const b = await dh.bulk(r.ids, 'reprocess');
      toast(`Reading ${plural(b.done, 'document')} again${r.capped ? ' (the first 500)' : ''}`);
      afterChange();
    } catch (e) { toast(e.message, { tone: 'bad' }); }
    finally { setBulkBusy(false); }
  };

  // ── drag & drop anywhere on the page ─────────────────────────────────────────────────
  const destination = useMemo(() => ({ folderId: Number(filters.folder) || null, matterId: Number(filters.matter) || null }), [filters.folder, filters.matter]);
  const intake = useFileIntake(destination);
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const dragProps = importOpen || isFiles ? {} : {
    onDragEnter: (e) => { if (hasFiles(e)) { dragDepth.current += 1; setDragging(true); } },
    onDragOver: (e) => { if (hasFiles(e)) e.preventDefault(); },
    onDragLeave: (e) => { if (hasFiles(e)) { dragDepth.current -= 1; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } } },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      setImportOpen(true);
      intake.fromDrop(e.dataTransfer);
    },
  };
  useEffect(() => {
    const reset = () => { dragDepth.current = 0; setDragging(false); };
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    return () => { window.removeEventListener('dragend', reset); window.removeEventListener('drop', reset); };
  }, []);

  // ── keyboard ─────────────────────────────────────────────────────────────────────────
  const rowsList = view === 'duplicates' || view === 'trash' || isFiles ? [] : list.docs;
  const move = (d) => {
    if (!rowsList.length) return;
    const i = rowsList.findIndex((x) => x.id === cursor);
    setCursor(rowsList[Math.min(rowsList.length - 1, Math.max(0, i < 0 ? (d > 0 ? 0 : rowsList.length - 1) : i + d))].id);
  };
  const noOverlay = !openId && !importOpen && !reviewOpen && !newFolder && !shortcuts && !confirmTrash;
  useHotkeys({
    '/': (e) => { e.preventDefault(); searchRef.current?.focus(); },
    j: () => move(1), k: () => move(-1),
    Enter: () => { if (cursor && rowsList.some((d) => d.id === cursor)) openDoc(cursor); },
    o: () => { if (cursor) openDoc(cursor); },
    x: () => { if (cursor) toggle(cursor); },
    u: () => setImportOpen(true),
    '?': () => setShortcuts(true),
    Escape: () => { if (sel.size) { setSel(new Set()); setAllInfo(null); } },
  }, noOverlay && !isFiles);

  // ── drawer neighbours ────────────────────────────────────────────────────────────────
  const neighbors = useMemo(() => {
    if (isFiles) return { prev: null, next: null };
    const i = list.docs.findIndex((d) => d.id === openId);
    if (i < 0) return { prev: null, next: null };
    return { prev: list.docs[i - 1]?.id || null, next: list.docs[i + 1]?.id || null };
  }, [list.docs, openId, isFiles]);
  const viewBatch = (id) => { setImportOpen(false); setSp((prev) => { const n = applyPatch(prev, { batch: id }); n.delete('view'); return n; }); };
  const startReview = () => { setImportOpen(false); setReviewOpen(true); };

  // ── render ───────────────────────────────────────────────────────────────────────────
  if (fatal) {
    return (
      <div className="dh-root"><div className="dh-page">
        <header className="dh-head"><div><h1 className="dh-title">Document Hub</h1></div></header>
        <div className="dh-errbox" role="alert">
          <Icon name="alert" />
          <div className="body"><b style={{ color: 'var(--ink)' }}>{fatal.status === 404 ? 'The Document Hub is not running on the server yet.' : 'The Document Hub could not start.'}</b><br />
            {fatal.status === 404 ? 'The backend needs the new code and a restart. Once it is running, reload this page.' : fatal.message}</div>
          <button type="button" className="dh-btn ghost sm" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div></div>
    );
  }

  const activeCount = activeFilterCount(filters, view);
  const isEmptyLibrary = stats && stats.documents === 0 && stats.trash === 0 && !activeCount && !filters.q && view === 'library' && listState === 'ready' && list.total === 0;
  const st = stats || {};
  const fsm = fsum || {};
  const perView = { review: st.review, problems: st.problems, trash: st.trash, tofile: fsm.filing?.pending, scan: fsm.scans, paper: fsm.paper?.overdue };
  const alertTabs = { review: true, tofile: !!fsm.filing?.pending, paper: !!fsm.paper?.overdue };
  const q = filters.q;
  const sortValue = filters.sort && (filters.sort !== 'relevance' || q) ? filters.sort : (q ? 'relevance' : 'newest');
  const chips = [];
  if (filters.folder) chips.push({ k: 'folder', label: filters.folder === 'none' ? 'Not filed' : folderIndex.pathOf(Number(filters.folder)).join(' › ') || 'Folder', icon: 'folder' });
  if (filters.cls) chips.push({ k: 'cls', label: filters.cls, icon: 'tag' });
  if (filters.status) chips.push({ k: 'status', label: `Status: ${filters.status.replace('_', ' ')}` });
  if (filters.kind) chips.push({ k: 'kind', label: `File type: ${filters.kind}` });
  if (filters.matter) chips.push({ k: 'matter', label: filters.matter === 'none' ? 'No matter' : (matters.find((m) => String(m.id) === filters.matter)?.title || 'Matter'), icon: 'briefcase' });
  if (filters.from || filters.to) chips.push({ k: ['from', 'to'], label: `Dated ${filters.from || '…'} → ${filters.to || '…'}`, icon: 'calendar' });
  if (filters.addedFrom || filters.addedTo) chips.push({ k: ['addedFrom', 'addedTo'], label: `Added ${filters.addedFrom || '…'} → ${filters.addedTo || '…'}` });
  if (filters.hold) chips.push({ k: 'hold', label: 'Legal hold', icon: 'lock' });
  if (filters.batch) chips.push({ k: 'batch', label: 'One import', icon: 'upload' });
  if (filters.lpmsCase) chips.push({ k: 'lpmsCase', label: 'One Practice case', icon: 'briefcase' });
  if (view === 'library' && filters.review) chips.push({ k: 'review', label: 'Type needs a check', icon: 'alert' });
  if (view === 'library' && filters.problems) chips.push({ k: 'problems', label: 'Could not be read fully', icon: 'alert' });
  const removeChip = (k) => setFilters(Object.fromEntries([].concat(k).map((x) => [x, ''])));

  return (
    <div className="dh-root" {...dragProps}>
      <div className="dh-page">
        <header className="dh-head">
          <div>
            <h1 className="dh-title">Document Hub</h1>
            <p className="dh-sub">Every document your firm holds, read and searchable inside the pages, sorted by type, and filed with its case. Nothing changes without you being able to undo it.</p>
          </div>
          <div className="dh-actions">
            <button type="button" className="dh-btn ghost" onClick={() => dh.exportCsv({ ...listParams, page: undefined }).catch((e) => toast(e.message, { tone: 'bad' }))} disabled={!st.documents} title="A spreadsheet of what is listed now"><Icon name="download" />Export list</button>
            <button type="button" className="dh-btn ghost" onClick={() => setShortcuts(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"><Icon name="keyboard" /></button>
            <button type="button" className="dh-btn primary" onClick={() => setImportOpen(true)}><Icon name="upload" />Import documents</button>
          </div>
        </header>

        <div className="dh-banners">
          {config?.storage?.at_risk ? (
            <div className="dh-banner rust" role="alert"><Icon name="alert" /><div className="body"><b>Uploaded files are being kept on temporary storage.</b> On this server they can disappear when it restarts or is redeployed. Ask your administrator to attach a persistent disk before you import real client documents.</div></div>
          ) : null}
          {config?.encryption?.error ? <div className="dh-banner rust" role="alert"><Icon name="lock" /><div className="body"><b>Encryption is misconfigured.</b> {config.encryption.error}</div></div> : null}
          {config && !config.ocr?.available && !hideOcr ? (
            <div className="dh-banner"><Icon name="scan" /><div className="body"><b>Scanned pages can’t be read yet.</b> The OCR engine isn’t installed on the server, so scans and photos are kept safely and marked “Needs OCR”. Typed PDFs, Word, Excel and e-mail files are fully searchable now, and scans are read as soon as OCR is switched on.</div>
              <button type="button" className="dh-btn quiet sm" onClick={() => { dismiss('ocr'); setHideOcr(true); }}>Got it</button></div>
          ) : null}
          {adopt && adopt.remaining > 0 ? (
            <div className="dh-banner plain"><Icon name="refresh" className="dh-spin" /><div className="body"><b>Bringing in your existing Case Vault files…</b> {fmtNum(adopt.remaining)} left. They stay in Case Vault too — this only teaches the hub to read them.</div></div>
          ) : null}
          {adopt && adopt.remaining === 0 && adopt.failed > 0 ? (
            <div className="dh-banner plain"><Icon name="info" /><div className="body">{plural(adopt.failed, 'older Case Vault file')} couldn’t be brought in (damaged, or stored without content). They are still in Case Vault.</div>
              <button type="button" className="dh-btn quiet sm" onClick={() => setAdopt(null)}>Dismiss</button></div>
          ) : null}
        </div>

        {!isFiles ? (
        <section className="dh-stats" aria-label="Library summary">
          <div className="dh-stat"><span className="n">{stats ? fmtNum(st.documents) : '—'}</span><span className="l">Documents</span><span className="sub">{stats ? `${fmtNum(st.pages)} pages · ${fmtBytes(st.bytes)}` : ' '}</span></div>
          <div className="dh-stat">{stats?.activity ? <Spark days={st.activity} /> : null}<span className="n">{stats ? fmtNum(st.added_7d) : '—'}</span><span className="l">Added this week</span><span className="sub">last 14 days</span></div>
          <button type="button" className={`dh-stat${st.review ? ' bad' : ''}${view === 'review' ? ' on' : ''}`} onClick={() => setView('review')}><span className="n">{stats ? fmtNum(st.review) : '—'}</span><span className="l">Need a quick look</span><span className="sub">type is a guess</span></button>
          <button type="button" className={`dh-stat${st.problems ? ' warn' : ''}${view === 'problems' ? ' on' : ''}`} onClick={() => setView('problems')}><span className="n">{stats ? fmtNum(st.problems) : '—'}</span><span className="l">Not fully read</span><span className="sub">scans, damaged files</span></button>
          <button type="button" className={`dh-stat${filters.hold ? ' on' : ''}`} onClick={() => { setView('library'); setFilters({ hold: filters.hold ? '' : '1' }); }}><span className="n">{stats ? fmtNum(st.legal_hold) : '—'}</span><span className="l">Legal hold</span><span className="sub">cannot be deleted</span></button>
          <button type="button" className={`dh-stat${view === 'trash' ? ' on' : ''}`} onClick={() => setView('trash')}><span className="n">{stats ? fmtNum(st.trash) : '—'}</span><span className="l">In the trash</span><span className="sub">{config ? `kept ${config.trash_days} days` : ' '}</span></button>
        </section>
        ) : null}

        {st.processing > 0 && !isFiles ? (
          <div className="dh-reading" role="status"><Icon name="refresh" className="dh-spin" /><span>Reading <b style={{ color: 'var(--ink)' }}>{fmtNum(st.processing)}</b> document{st.processing === 1 ? '' : 's'} in the background. You can keep searching — finished ones appear as they are done.</span></div>
        ) : null}

        <nav className="dh-tabs" aria-label="Document Hub sections">
          {TABS.map((t, i) => (
            <span key={t.id} style={{ display: 'contents' }}>
              {i > 0 && t.group !== TABS[i - 1].group ? <span className="dh-tabsep" aria-hidden="true" /> : null}
              <button type="button" className={`dh-tab${view === t.id ? ' on' : ''}${t.group === 'files' ? ' files' : ''}`} onClick={() => setView(t.id)} aria-current={view === t.id ? 'page' : undefined}>
                {t.label}
                {perView[t.id] ? <span className={`ct${alertTabs[t.id] ? ' alert' : ''}`}>{fmtNum(perView[t.id])}</span> : null}
              </button>
            </span>
          ))}
        </nav>

        {view === 'tofile' ? <FilingQueue summary={fsm.filing} onSummary={onFilingSummary} toast={toast} onOpenDoc={openDoc} onChanged={() => { refreshStats(); bump(); }} onGo={(v, extra) => setView(v, extra)} /> : null}
        {view === 'scan' ? <ScanStudio sid={scanSid} onSid={(id) => { setParam('scan', id); if (!id) refreshFiles(); }} config={config} toast={toast} onOpenDoc={openDoc} onGo={(v) => { setView(v); if (v === 'library' || v === 'tofile') afterChange(); }} caseRef={caseRef} caseLabel={caseLabel} /> : null}
        {view === 'paper' ? <PaperFiles toast={toast} onOpenDoc={openDoc} onGoCase={(r) => (r ? goCaseDocs(r) : setParam('case', null, true))} caseRef={caseRef} caseLabel={caseLabel} openToken={pfToken} onTokenHandled={() => setParam('pf', null, true)} onStats={onPaperStats} /> : null}
        {view === 'bundles' ? <Bundles bundleId={bundleId} onBundleId={(id) => setParam('bundle', id)} caseRef={caseRef} caseLabel={caseLabel} onGoCase={(r) => (r ? goCaseDocs(r) : setParam('case', null, true))} toast={toast} onOpenDoc={openDoc} folderIndex={folderIndex} /> : null}

        {view === 'duplicates' ? <DuplicatesView onOpen={openDoc} onChanged={afterChange} toast={toast} folderLabel={folderLabel} /> : null}
        {view === 'trash' ? <TrashView onOpen={openDoc} onChanged={afterChange} toast={toast} folderLabel={folderLabel} /> : null}

        {view !== 'duplicates' && view !== 'trash' && !isFiles ? (
          isEmptyLibrary ? (
            <EmptyState icon="inbox" title="Your library is empty"
              actions={<><button type="button" className="dh-btn primary" onClick={() => setImportOpen(true)}><Icon name="upload" />Import documents</button>
                <button type="button" className="dh-btn ghost" onClick={async () => { try { await dh.initBlueprint(); await loadFolders(); toast('Standard folders created'); } catch (e) { toast(e.message, { tone: 'bad' }); } }}><Icon name="folder" />Create the standard folders</button></>}>
              Drop in thousands of files at once — PDFs, Word, Excel, e-mails, scans. Every page is read so you can search inside them, case numbers are found in any spelling, and each document is sorted by type. Anything the hub is unsure about waits for your quick check.
            </EmptyState>
          ) : (
            <div className="dh-lib">
              {(() => {
                const rail = (
                  <>
                    {railOpen ? <div className="dh-scrim dh-rail-scrim" onMouseDown={() => setRailOpen(false)} /> : null}
                    <FacetRail filters={filters} facets={list.facets} total={list.total} folderIndex={folderIndex} folderCounts={folderCounts} set={setFilters}
                      clearAll={clearAll} view={view} matters={matters} open={railOpen} onClose={() => setRailOpen(false)} onNewFolder={() => setNewFolder(true)} activeCount={activeCount} />
                  </>
                );
                // On phones/tablets the filters are a slide-in sheet: it must sit above the whole app (top bar included), so it lives on <body>.
                return narrowScreen ? <Portal>{rail}</Portal> : rail;
              })()}
              <main>
                {view === 'review' ? (
                  <div className="dh-banner rust" style={{ marginBottom: 14 }}><Icon name="alert" /><div className="body"><b>The hub was unsure about these {fmtNum(st.review || list.total)} documents.</b> Its guess is only a suggestion until you confirm it. Review mode shows them one at a time — Enter to confirm, 1–3 to pick another type.</div>
                    <button type="button" className="dh-btn primary sm" disabled={!list.total} onClick={() => setReviewOpen(true)}>Start reviewing</button></div>
                ) : null}
                {view === 'problems' ? (
                  <div className="dh-banner" style={{ marginBottom: 14 }}><Icon name="info" /><div className="body"><b>These documents could not be read completely.</b> Nothing is lost — the originals are safe and you can download them. <b>Needs OCR</b> files are scans waiting for the OCR engine; <b>Partly read</b> files have some unreadable pages; <b>Failed</b> files may be damaged or password-protected.</div>
                    <button type="button" className="dh-btn ghost sm" disabled={bulkBusy || !list.total} onClick={retryAllProblems}><Icon name="refresh" />Try all again</button></div>
                ) : null}
                {view === 'library' && st.review > 0 && !filters.review && !q && !activeCount && filters.page === 1 ? (
                  <div className="dh-banner plain" style={{ marginBottom: 14 }}><Icon name="alert" /><div className="body"><b>{plural(st.review, 'document')}</b> {st.review === 1 ? 'needs' : 'need'} a quick look before you can rely on {st.review === 1 ? 'its' : 'their'} type.</div>
                    <button type="button" className="dh-btn ghost sm" onClick={() => setReviewOpen(true)}>Review now</button></div>
                ) : null}

                <div className="dh-searchrow">
                  <Icon name="search" />
                  <input ref={searchRef} className="dh-search" type="search" value={qInput} placeholder="Search inside every document — words, a phrase, a case number, a name…" aria-label="Search documents"
                    onChange={(e) => setQInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { pushedQ.current = qInput.trim(); setFilters({ q: qInput.trim() }); }
                      else if (e.key === 'Escape') { if (qInput) { setQInput(''); } else e.currentTarget.blur(); }
                      else if (e.key === 'ArrowDown' && rowsList.length) { e.preventDefault(); e.currentTarget.blur(); setCursor(rowsList[0].id); }
                    }} />
                  <span className="kbd">
                    {qInput ? <button type="button" className="clear" onClick={() => { setQInput(''); searchRef.current?.focus(); }} aria-label="Clear search"><Icon name="close" /></button> : <span className="dh-kbd">/</span>}
                  </span>
                </div>
                <p className="dh-hint">Try <code>"exact phrase"</code> · <code>-word</code> to leave one out · <code>a OR b</code> · a case number in any spelling: <code>W.P.(C) 1234/2024</code> finds <code>WPC No. 1234 of 2024</code></p>

                {chips.length ? (
                  <div className="dh-active" aria-label="Active filters">
                    {chips.map((c) => <span key={[].concat(c.k).join()} className="dh-chip removable" style={{ color: 'var(--accent)', background: 'var(--accent-soft)', borderColor: 'transparent' }}>{c.icon ? <Icon name={c.icon} /> : null}{c.label}<button type="button" onClick={() => removeChip(c.k)} aria-label={`Remove filter ${c.label}`}><Icon name="close" size={10} /></button></span>)}
                    <button type="button" className="dh-more" onClick={clearAll}>Clear all</button>
                  </div>
                ) : null}

                {sel.size > 0 ? (
                  <>
                    <BulkBar count={sel.size} folderIndex={folderIndex} matters={matters} classes={(config?.classes || [])} busy={bulkBusy}
                      onAction={runBulk} onClear={() => { setSel(new Set()); setAllInfo(null); }} onZip={zip} onTrash={() => setConfirmTrash(true)} onAddToBundle={() => setAddBundle([...sel])} />
                    {pageAllSelected && !allInfo && list.total > list.docs.length ? (
                      <div className="dh-allmatch">All {list.docs.length} on this page are selected. <button type="button" onClick={selectAllMatching}>Select all {fmtNum(list.total)} matching</button></div>
                    ) : null}
                    {allInfo ? <div className="dh-allmatch">{allInfo.capped ? <>The first <b>{fmtNum(allInfo.n)}</b> of {fmtNum(allInfo.total)} matching documents are selected (500 at a time).</> : <>All <b>{fmtNum(allInfo.total)}</b> matching documents are selected.</>}{' '}
                      <button type="button" onClick={() => { setSel(new Set()); setAllInfo(null); }}>Clear selection</button></div> : null}
                  </>
                ) : (
                  <div className="dh-toolbar">
                    <label className="dh-check"><input type="checkbox" checked={pageAllSelected} onChange={togglePage} disabled={!list.docs.length} aria-label="Select everything on this page" /></label>
                    <span className="count" aria-live="polite">
                      {listState === 'loading' ? 'Loading…' : <><b>{fmtNum(list.total)}</b> {q ? `match${list.total === 1 ? 'es' : ''} for “${q.length > 40 ? `${q.slice(0, 38)}…` : q}”` : list.total === 1 ? 'document' : 'documents'}</>}
                    </span>
                    <span className="sp" />
                    <button type="button" className="dh-btn ghost sm dh-filter-btn" onClick={() => setRailOpen(true)}><Icon name="filter" />Filters{activeCount ? ` · ${activeCount}` : ''}</button>
                    <label className="sortwrap"><Icon name="sort" />
                      <select className="dh-select" value={sortValue} onChange={(e) => setFilters({ sort: e.target.value })} aria-label="Sort by">
                        {SORTS.filter((s) => !s.needsQuery || q).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select></label>
                  </div>
                )}

                {listState === 'error' ? (
                  <div className="dh-errbox" role="alert"><Icon name="alert" /><div className="body">{listErr}</div><button type="button" className="dh-btn ghost sm" onClick={bump}>Try again</button></div>
                ) : null}
                {listState === 'loading' ? <Skeleton /> : null}
                {(listState === 'ready' || listState === 'refreshing') && list.docs.length === 0 ? (
                  <EmptyState icon="search" title={q || activeCount ? 'Nothing matches' : view === 'review' ? 'Nothing needs a look' : view === 'problems' ? 'Everything was read' : 'No documents here'}
                    actions={(q || activeCount) ? <button type="button" className="dh-btn ghost" onClick={() => { setQInput(''); clearAll(); }}>Clear search and filters</button> : <button type="button" className="dh-btn primary" onClick={() => setImportOpen(true)}><Icon name="upload" />Import documents</button>}>
                    {q ? 'Try fewer or shorter words, drop a filter, or search a case number such as WPC 1234/2024. Searching looks inside every page, not only titles.'
                      : activeCount ? 'No document fits all of these filters at once.'
                        : view === 'review' ? 'Every document has a type you have confirmed, or one the hub was sure about.'
                          : view === 'problems' ? 'No document is waiting for OCR or failed to read.' : 'Import some documents, or pick another folder.'}
                  </EmptyState>
                ) : null}
                {list.docs.length > 0 && listState !== 'loading' ? (
                  <div className={`dh-list${listState === 'refreshing' || rowsStale ? ' stale' : ''}`} role="table" aria-label="Documents" aria-busy={listState === 'refreshing' || rowsStale}>
                    {list.docs.map((d) => (
                      <DocRow key={d.id} doc={d} selected={sel.has(d.id)} cursor={cursor === d.id} open={openId === d.id} folderLabel={folderLabel}
                        onSelect={toggle} onOpen={(id) => { setCursor(id); openDoc(id); }}
                        actions={<button type="button" className="dh-ibtn" aria-label={`Download ${d.title}`} title="Download the original"
                          onClick={(e) => { e.stopPropagation(); dh.download(d.id, d.original_name).catch((er) => toast(er.message, { tone: 'bad' })); }}><Icon name="download" /></button>} />
                    ))}
                  </div>
                ) : null}
                <Pager page={filters.page} perPage={PER_PAGE} total={list.total} onPage={(p) => { setFilters({ page: p }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
              </main>
            </div>
          )
        ) : null}

        {config ? (
          <footer className="dh-foot">
            {config.storage?.free_bytes != null ? `${fmtBytes(config.storage.free_bytes)} free · ` : ''}files on {config.storage?.location || 'disk'}
            {' · '}encryption {config.encryption?.enabled ? 'on' : 'off'}{' · '}OCR {config.ocr?.available ? (config.ocr.langs || 'on') : 'off'}
            {' · '}up to {config.max_file_mb} MB per file
          </footer>
        ) : null}
      </div>

      {openId ? (
        <PreviewDrawer key="drawer" docId={openId} q={q} terms={list.terms} neighbors={neighbors} folderIndex={folderIndex} matters={matters} config={config}
          onClose={closeDoc} onNavigate={(id, o) => openDoc(id, { replace: true, ...o })} toast={toast}
          onChanged={(d) => {
            if (d && d.id) setList((l) => ({ ...l, docs: l.docs.map((x) => (x.id === d.id ? { ...x, ...d } : x)) }));
            afterChange();
          }}
          onRemoved={() => { closeDoc(); afterChange(); }}
          onAddToBundle={(id) => setAddBundle([id])}
          onFilterCase={(n) => { setSp((prev) => { const nx = applyPatch(prev, { q: n }); nx.delete('doc'); nx.delete('view'); return nx; }, { replace: true }); }} />
      ) : null}
      {importOpen ? (
        <ImportPanel config={config} folderIndex={folderIndex} matters={matters} defaultFolderId={Number(filters.folder) || null} defaultMatterId={Number(filters.matter) || null}
          onClose={() => setImportOpen(false)} onViewBatch={viewBatch} onReview={startReview} onCreateFolder={() => setNewFolder(true)} />
      ) : null}
      {reviewOpen ? <ReviewMode config={config} toast={toast} onChanged={afterChange} onClose={() => { setReviewOpen(false); afterChange(); }} /> : null}
      {newFolder ? <NewFolderModal folderIndex={folderIndex} initialParent={Number(filters.folder) || null} onClose={() => setNewFolder(false)} onCreated={(n) => { setNewFolder(false); loadFolders(); toast(`Folder “${n}” created`); }} /> : null}
      {shortcuts ? <Shortcuts onClose={() => setShortcuts(false)} /> : null}
      {addBundle ? <AddToBundleModal docIds={addBundle} toast={toast} onClose={() => setAddBundle(null)}
        onDone={(id, msg) => { setAddBundle(null); toast(msg, { action: { label: 'Open the bundle', run: () => setView('bundles', { bundle: id }) } }); }} /> : null}
      {confirmTrash ? (
        <Confirm danger title="Move to trash?" confirmLabel="Move to trash" busy={bulkBusy} onConfirm={() => runBulk('trash')} onCancel={() => setConfirmTrash(false)}>
          {plural(sel.size, 'document')} (with all versions) will wait in the trash for {config?.trash_days ?? 30} days, then be removed for good. Documents under legal hold are skipped. You can undo this.
        </Confirm>
      ) : null}
      {dragging ? (
        <Portal>
          <div className="dh-dropveil" aria-hidden="true"><div className="card"><Icon name="upload" size={28} /><h3>Drop to import</h3><p>{destination.folderId ? 'Files go into the folder you are viewing.' : 'The hub will read and file them for you.'} Whole folders are fine.</p></div></div>
        </Portal>
      ) : null}
      {!importOpen ? <Portal><UploadDock onOpen={() => setImportOpen(true)} onView={viewBatch} /></Portal> : null}
      <Toasts items={toasts.items} dismiss={toasts.dismiss} />
    </div>
  );
}
