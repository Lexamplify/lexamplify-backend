// "Scan & file": a pile of paper — phone photos or a scanner's PDF — becomes clean, separate, named documents on the right cases.
// Add pages → the hub straightens, cleans and reads them and proposes where each document starts and ends → you check → file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AsideTray, DocCard, Lightbox, MovePageModal, thumbLoader, useDragReset, usePageIndex } from './ScanBoard.jsx';
import { AuthImg, CasePicker, Spinner } from './FilesCommon.jsx';
import { fx, saveBlob } from './filesApi.js';
import { fmtAgo, plural } from './format.js';
import { Icon } from './icons.jsx';
import { Confirm, EmptyState, Menu, Portal, useDebounced } from './ui.jsx';
import * as L from './scanLayout.js';

const PENDING = new Map();              // session id -> files chosen on the first screen, uploaded as soon as the board opens
const BATCH = 4;
const HEIC = /heic|heif/i;
const natural = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

// ── a paper file box (search the register) ───────────────────────────────────────────────
function PfilePicker({ value, label, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 220);
  const [rows, setRows] = useState(null);
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    let dead = false;
    fx.paperList({ status: 'active', q: dq || undefined, per_page: 20, sort: 'recent' }).then((r) => { if (!dead) setRows(r.files.filter((f) => f.status !== 'lost')); }).catch(() => { if (!dead) setRows([]); });
    return () => { dead = true; };
  }, [open, dq]);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);
  useEffect(() => { if (!open) { setQ(''); setRows(null); } }, [open]);
  return (
    <div className="fx-pick compact" ref={wrap}>
      <button type="button" className={`fx-pickbtn${value ? ' has' : ''}`} disabled={disabled} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <Icon name="cabinet" /><span className="t">{value ? (label || `File #${value}`) : 'Link to a paper file (optional)'}</span><Icon name="chevD" size={12} />
      </button>
      {open ? (
        <div className="fx-pickpanel" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
          <div className="fx-picksearch"><Icon name="search" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="File number, name or client" aria-label="Search paper files" /></div>
          <div className="fx-picklist" role="listbox">
            <button type="button" className="fx-pickopt none" onClick={() => { onChange(null, null); setOpen(false); }}><span className="nm">Not linked to a paper file</span></button>
            {rows === null ? <div className="fx-pickmsg">Loading…</div> : null}
            {rows && !rows.length ? <div className="fx-pickmsg">{dq ? 'No paper file matches that.' : 'No paper files yet. Add them in the “Paper files” tab.'}</div> : null}
            {(rows || []).map((f) => (
              <button key={f.id} type="button" role="option" aria-selected={value === f.id} className={`fx-pickopt${value === f.id ? ' on' : ''}`} onClick={() => { onChange(f.id, f); setOpen(false); }}>
                <span className="nm"><span className="mono">{f.file_no}</span> {f.title}</span>
                <span className="mt">{[f.case_label, f.location].filter(Boolean).join(' · ') || 'No case or shelf yet'}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── turn a big phone photo into something quicker to upload (never changes how the page looks) ───────
async function prepare(file) {
  const name = file.name || 'photo.jpg';
  const type = (file.type || '').toLowerCase();
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (HEIC.test(type) || HEIC.test(ext)) {
    throw new Error('HEIC photos are not supported yet. On iPhone use Settings › Camera › Formats › Most Compatible, or share the photos as JPEG or as one PDF.');
  }
  if (type.startsWith('image/') && file.size > 2.5 * 1024 * 1024 && typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const k = Math.min(1, 3200 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      bmp.close?.();
      const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.9));
      if (blob && blob.size < file.size) return new File([blob], name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch { /* send the original */ }
  }
  return file;
}

// ── first screen ─────────────────────────────────────────────────────────────────────────
function Landing({ onSid, toast, caseRef, caseLabel, config }) {
  const [c, setC] = useState({ ref: caseRef || '', label: caseLabel || '' });
  const [pf, setPf] = useState({ id: null, label: '' });
  const [scans, setScans] = useState(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [del, setDel] = useState(null);
  const pick = useRef(null);
  const cam = useRef(null);
  const depth = useRef(0);

  const load = useCallback(() => fx.scans().then((r) => setScans(r.scans)).catch(() => setScans([])), []);
  useEffect(() => { load(); }, [load]);

  const start = async (list) => {
    const files = [...list];
    if (!files.length || busy) return;
    files.sort(files.length > 1 ? natural : () => 0);
    setBusy(true);
    try {
      const r = await fx.scanCreate({ case_ref: c.ref || null, pfile_id: pf.id || null });
      PENDING.set(r.scan.id, files);
      onSid(r.scan.id);
    } catch (e) { toast(e.message || 'Could not start a scan.', { tone: 'bad' }); setBusy(false); }
  };
  const sheets = async () => { try { saveBlob(await fx.separatorPdf(5), 'separator-sheets.pdf'); } catch (e) { toast(e.message, { tone: 'bad' }); } };
  const discard = async () => { try { await fx.scanDelete(del.id); toast('Scan discarded'); setDel(null); load(); } catch (e) { toast(e.message, { tone: 'bad' }); setDel(null); } };

  return (
    <section className="fx-section" aria-label="Scan and file"
      onDragEnter={(e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { depth.current += 1; setOver(true); } }}
      onDragOver={(e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); }}
      onDragLeave={() => { depth.current -= 1; if (depth.current <= 0) { depth.current = 0; setOver(false); } }}
      onDrop={(e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); depth.current = 0; setOver(false); start(e.dataTransfer.files); }}>
      <div className="fx-intro">
        <div>
          <h2 className="fx-h">From a pile of paper to filed documents</h2>
          <p className="fx-lead">Photograph the pages with your phone, or scan a whole stack into one PDF. The hub straightens and cleans every page, finds where each document starts and ends, names it, and suggests its case. You check — then it is filed.</p>
        </div>
      </div>

      {config && !config.ocr?.available ? (
        <div className="dh-banner"><Icon name="info" /><div className="body"><b>Text recognition is not switched on for this server.</b> Pages are still straightened, cleaned and filed as PDFs, but names and cases cannot be suggested — you will choose them yourself.</div></div>
      ) : null}

      <div className={`fx-drop${over ? ' over' : ''}`}>
        <div className="ic"><Icon name="camera" size={26} /></div>
        <h3>{over ? 'Drop to start' : 'Add the pages'}</h3>
        <p>Photos (JPEG, PNG) or a scanned PDF. Hundreds of pages are fine — a 50-page PDF is split into pages for you.</p>
        <div className="row">
          <button type="button" className="dh-btn primary" disabled={busy} onClick={() => cam.current?.click()}><Icon name="camera" />Take photos</button>
          <button type="button" className="dh-btn ghost" disabled={busy} onClick={() => pick.current?.click()}><Icon name="upload" />Choose files</button>
        </div>
        <span className="hint">or drag them anywhere onto this page</span>
        <input ref={pick} type="file" hidden multiple accept="image/*,application/pdf,.pdf" onChange={(e) => { start(e.target.files); e.target.value = ''; }} />
        <input ref={cam} type="file" hidden accept="image/*" capture="environment" onChange={(e) => { start(e.target.files); e.target.value = ''; }} />
      </div>

      <div className="fx-defaults">
        <div className="fx-defcol"><span className="lab">File them on this case <i>(optional)</i></span>
          <CasePicker value={c.ref} label={c.label} allowNone noneLabel="Let the hub suggest" placeholder="Let the hub suggest a case" onChange={(ref, x) => setC({ ref, label: x?.title || '' })} /></div>
        <div className="fx-defcol"><span className="lab">Link to a paper file <i>(optional)</i></span>
          <PfilePicker value={pf.id} label={pf.label} onChange={(id, f) => setPf({ id, label: f ? `${f.file_no} · ${f.title}` : '' })} /></div>
      </div>

      <div className="fx-steps">
        <div><b>1 · Add</b><span>Take photos or choose a scanned PDF. Order does not matter much — the pages are read in the order you add them.</span></div>
        <div><b>2 · Check</b><span>See each document the hub found, with its name, type and case. Drag pages, split or join documents if it guessed wrong.</span></div>
        <div><b>3 · File</b><span>One click. Every document becomes a searchable PDF on its case, linked to the paper file it came from.</span></div>
      </div>
      <p className="fx-tip">Scanning a thick stack at once? Print a few <button type="button" className="fx-link" onClick={sheets}>separator sheets</button> and put one between documents — the hub starts a new document at every sheet and never files the sheet itself.</p>

      {scans && scans.length ? (
        <>
          <h3 className="fx-h3">Unfinished scans <span className="ct">{scans.length}</span></h3>
          <ul className="fx-scanlist">
            {scans.map((s) => (
              <li key={s.id}>
                <button type="button" className="main" onClick={() => onSid(s.id)}>
                  <Icon name="stack" />
                  <span className="t">{plural(s.pages, 'page')}{s.documents ? ` · ${plural(s.documents, 'document')}` : ''}{s.working ? ' · still working…' : ''}</span>
                  <span className="mut">{s.case_label ? `${s.case_label} · ` : ''}started {fmtAgo(s.created_at)}</span>
                </button>
                <button type="button" className="dh-btn ghost sm" onClick={() => onSid(s.id)}>Continue</button>
                <button type="button" className="dh-ibtn" aria-label="Discard this scan" title="Discard" onClick={() => setDel(s)}><Icon name="trash" /></button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {busy ? <Portal><div className="fx-busyveil"><Spinner label="Starting…" /></div></Portal> : null}
      {del ? <Confirm danger title="Discard this scan?" confirmLabel="Discard" onConfirm={discard} onCancel={() => setDel(null)}>Its pages are deleted and nothing is filed. Documents already filed from it stay in your library.</Confirm> : null}
    </section>
  );
}

// ── the board ────────────────────────────────────────────────────────────────────────────
function Studio({ sid, onSid, config, toast, onOpenDoc, onGo }) {
  const [s, setS] = useState(null);                       // the server's view: pages and counts
  const [layout, setLayout] = useState(null);
  const [hist, setHist] = useState([]);
  const [defaults, setDefaults] = useState({});
  const [labels, setLabels] = useState({});
  const [pfLabel, setPfLabel] = useState('');
  const [filedMap, setFiledMap] = useState({});
  const [errors, setErrors] = useState({});
  const [busyKeys, setBusyKeys] = useState(() => new Set());
  const [ups, setUps] = useState([]);
  const [lb, setLb] = useState(null);
  const [moving, setMoving] = useState(null);
  const [filing, setFiling] = useState(null);
  const [done, setDone] = useState(null);
  const [saveState, setSaveState] = useState('idle');
  const [confirm, setConfirm] = useState(null);
  const [fatal, setFatal] = useState('');
  const [over, setOver] = useState(false);
  const [drag, setDrag] = useDragReset();
  const [suggesting, setSuggesting] = useState(false);

  const layoutRef = useRef(null);
  const defaultsRef = useRef({});
  const dirty = useRef(false);
  const ver = useRef(0);
  const alive = useRef(true);
  const tried = useRef(new Set());
  const itemsRef = useRef([]);
  const pumping = useRef(false);
  const fileInput = useRef(null);
  const camInput = useRef(null);
  const depth = useRef(0);
  const classes = useMemo(() => (config?.classes || []).filter((c) => c !== 'Unclassified'), [config]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => { defaultsRef.current = defaults; }, [defaults]);

  const addLabel = useCallback((ref, label) => { if (ref && label) setLabels((m) => (m[ref] === label ? m : { ...m, [ref]: label })); }, []);
  const edit = useCallback((fn, { history = true } = {}) => {
    const prev = layoutRef.current;
    if (!prev) return;
    const next = fn(prev);
    if (!next || next === prev) return;
    layoutRef.current = next;
    setLayout(next);
    if (history) setHist((h) => [...h.slice(-29), prev]);
    dirty.current = true; ver.current += 1;
  }, []);

  // ── load the session ───────────────────────────────────────────────────────────────
  const adopt = useCallback((p, first) => {
    setS((cur) => ({ ...(cur || {}), ...p }));
    if (first) {
      const lay = p.layout ? { docs: p.layout.docs.map((d) => ({ ...d, pages: d.pages.slice() })), removed: (p.layout.removed || []).slice() } : null;
      layoutRef.current = lay;
      setLayout(lay);
      setDefaults(p.defaults || {});
      setLabels(p.case_labels || {});
      setPfLabel(p.pfile_label || '');
      setFiledMap(p.filed_docs || {});
    }
  }, []);
  useEffect(() => {
    let dead = false;
    fx.scan(sid).then((r) => { if (!dead) adopt(r.scan, true); }).catch((e) => { if (!dead) setFatal(e.message || 'This scan could not be opened.'); });
    return () => { dead = true; };
  }, [sid, adopt]);

  const refresh = useCallback(async () => {
    try { const r = await fx.scan(sid); if (alive.current) setS((cur) => ({ ...(cur || {}), pages: r.scan.pages, counts: r.scan.counts })); } catch (e) { if (e.status === 404 && alive.current) setFatal('This scan was filed or discarded.'); }
  }, [sid]);

  // ── uploads: one at a time, so pages keep the order you added them ───────────────────
  const syncUps = () => setUps(itemsRef.current.map((x) => ({ ...x })));
  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        const it = itemsRef.current.find((x) => x.status === 'wait');
        if (!it || !alive.current) break;
        it.status = 'up'; syncUps();
        try {
          const f = await prepare(it.file);
          const r = await fx.scanUpload(sid, f);
          it.status = 'done'; it.n = (r.pages || []).length;
          if (alive.current) setS((cur) => {
            const have = new Map(((cur && cur.pages) || []).map((p) => [p.id, p]));
            (r.pages || []).forEach((p) => have.set(p.id, p));
            const pages = [...have.values()].sort((a, b) => a.seq - b.seq || a.id - b.id);
            return { ...(cur || {}), pages, counts: { ...(cur?.counts || {}), total: pages.length, working: pages.filter((p) => p.status === 'queued' || p.status === 'processing').length } };
          });
        } catch (e) { it.status = 'err'; it.error = e.message || 'Could not add this file.'; }
        syncUps();
      }
    } finally { pumping.current = false; }
  }, [sid]);
  const enqueue = useCallback((files) => {
    const list = [...files];
    if (list.length > 1) list.sort(natural);
    list.forEach((file) => itemsRef.current.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, file, name: file.name || 'photo', size: file.size, status: 'wait' }));
    syncUps();
    pump();
  }, [pump]);
  useEffect(() => {
    const first = PENDING.get(sid);
    if (first) { PENDING.delete(sid); enqueue(first); }
  }, [sid, enqueue]);
  const upActive = ups.some((u) => u.status === 'wait' || u.status === 'up');

  // ── watch the pages being cleaned and read ───────────────────────────────────────────
  const working = (s?.counts?.working || 0) > 0;
  useEffect(() => {
    if (!working && !upActive) return undefined;
    const t = setInterval(() => { if (!document.hidden) refresh(); }, 1500);
    return () => clearInterval(t);
  }, [working, upActive, refresh]);

  // ── once everything is read, let the hub propose the documents (also for pages added later) ──────────
  const pagesById = useMemo(() => Object.fromEntries((s?.pages || []).map((p) => [p.id, p])), [s?.pages]);
  const pageList = useMemo(() => s?.pages || [], [s?.pages]);
  const { order, where } = usePageIndex(pageList, layout);
  useEffect(() => {
    if (!s) return;                                         // still loading
    if (working || upActive || suggesting || filing || done) return;
    const lay = layoutRef.current || { docs: [], removed: [] };
    const placed = L.placedIds(lay);
    const todo = pageList.filter((p) => p.status === 'ready' && !placed.has(p.id) && !tried.current.has(p.id)).map((p) => p.id);
    if (!todo.length) return;
    todo.forEach((id) => tried.current.add(id));
    setSuggesting(true);
    fx.scanSuggest(sid, todo).then((res) => {
      if (!alive.current) return;
      const proposed = res.docs.map((d) => ({ key: d.key, pages: d.pages, title: d.title || null, doc_class: d.doc_class || null, case_ref: d.case_ref || null, pfile_id: null, folder_id: null, reasons: d.reasons || [], hint: d.hint || null }));
      res.docs.forEach((d) => { addLabel(d.case_ref, d.case_label); if (d.hint) addLabel(d.hint.ref, d.hint.label); });
      const covered = new Set([...res.docs.flatMap((d) => d.pages), ...res.removed.map((r) => r.id)]);
      todo.filter((id) => !covered.has(id)).forEach((id) => proposed.push(L.emptyDoc([id])));      // a page the reader skipped still gets a document of its own
      if (!layoutRef.current) { layoutRef.current = { docs: [], removed: [] }; setLayout({ docs: [], removed: [] }); }
      edit((l) => L.appendProposed(l, proposed, res.removed), { history: false });
    }).catch((e) => { if (alive.current) toast(e.message || 'Could not work out the documents. You can still arrange the pages by hand.', { tone: 'bad' }); })
      .finally(() => { if (alive.current) setSuggesting(false); });
  }, [s, layout, working, upActive, suggesting, filing, done, pageList, sid, edit, addLabel, toast]);

  // ── keep the layout saved ────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    const lay = layoutRef.current;
    if (!lay || !dirty.current) return;
    const v = ver.current;
    setSaveState('saving');
    try {
      await fx.scanLayout(sid, L.forServer(lay), defaultsRef.current);
      if (v === ver.current) dirty.current = false;
      if (alive.current) setSaveState('saved');
    } catch (e) { if (alive.current) { setSaveState('error'); toast(e.message || 'Could not save your changes.', { tone: 'bad' }); } }
  }, [sid, toast]);
  const dl = useDebounced(`${ver.current}`, 800);
  useEffect(() => { if (dirty.current) save(); }, [dl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (dirty.current && layoutRef.current) fx.scanLayout(sid, L.forServer(layoutRef.current), defaultsRef.current).catch(() => {}); }, [sid]);

  // ── page and document actions ────────────────────────────────────────────────────────
  const markBusy = (k, on) => setBusyKeys((b) => { const n = new Set(b); if (on) n.add(k); else n.delete(k); return n; });
  const lockedKey = (k) => { const f = filedMap[k]; return !!(f && !f.error); };
  const analyse = useCallback(async (key, { overwrite }) => {
    const doc = (layoutRef.current?.docs || []).find((d) => d.key === key);
    if (!doc) return;
    markBusy(key, true);
    try {
      const res = await fx.scanSuggest(sid, doc.pages);
      const d = res.docs[0];
      if (!d || !alive.current) return;
      addLabel(d.case_ref, d.case_label); if (d.hint) addLabel(d.hint.ref, d.hint.label);
      edit((l) => L.patchDoc(l, key, {
        ...(overwrite || !(l.docs.find((x) => x.key === key)?.title) ? { title: d.title || null } : {}),
        ...(overwrite || !(l.docs.find((x) => x.key === key)?.doc_class) ? { doc_class: d.doc_class || null } : {}),
        hint: d.hint || null,
        ...(!(l.docs.find((x) => x.key === key)?.case_ref) && d.case_ref ? { case_ref: d.case_ref } : {}),
      }), { history: false });
    } catch (e) { if (overwrite) toast(e.message || 'Could not read that document again.', { tone: 'bad' }); }
    finally { markBusy(key, false); }
  }, [sid, edit, addLabel, toast]);

  const handlers = useMemo(() => ({
    patch: (key, p) => edit((l) => L.patchDoc(l, key, p), { history: false }),
    setCase: (key, ref, c) => { if (c?.title) addLabel(ref, c.title); edit((l) => L.patchDoc(l, key, { case_ref: ref || null })); },
    split: (key, at) => {
      const res = L.splitDoc(layoutRef.current, key, at);
      if (!res.key) return;
      edit(() => res.layout);
      analyse(res.key, { overwrite: false });
    },
    merge: (key, dir) => {
      const docs = layoutRef.current.docs;
      const i = docs.findIndex((d) => d.key === key);
      const other = docs[i + dir];
      if (!other || lockedKey(other.key)) return;
      edit((l) => (dir < 0 ? L.mergeDocs(l, other.key, key) : L.mergeDocs(l, key, other.key)));
    },
    moveDoc: (key, d) => edit((l) => L.moveDoc(l, key, d)),
    asideDoc: (key) => { edit((l) => L.setAsideDoc(l, key)); toast('Left out of this filing. Open “pages left out” below to bring it back.'); },
    reread: (key) => analyse(key, { overwrite: true }),
    aside: (pid) => edit((l) => L.setAside(l, pid)),
    move: (pid) => setMoving(pid),
    drop: (pid, to, before) => { if (to && lockedKey(to)) return; edit((l) => L.movePage(l, pid, to, before)); },
    open: (pid) => setLb(pid),
    openDoc: (id) => onOpenDoc(id),
    rotate: async (pid, deg) => {
      try { const r = await fx.scanRotate(sid, pid, deg); setS((cur) => ({ ...cur, pages: cur.pages.map((p) => (p.id === pid ? { ...p, ...r.page } : p)), counts: { ...cur.counts, working: cur.counts.working + 1, ready: Math.max(0, cur.counts.ready - 1) } })); }
      catch (e) { toast(e.message || 'Could not turn the page.', { tone: 'bad' }); }
    },
  }), [edit, addLabel, analyse, sid, toast, onOpenDoc, filedMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const restore = (pid) => { let r = { into: null }; edit((l) => { r = L.restorePageWhere(l, pid); return r.layout; }); toast(r.into ? 'Page put back where it was scanned.' : 'Page brought back as its own document.'); };
  const retry = async (pid) => {
    try { const r = await fx.scanRetry(sid, pid); setS((cur) => ({ ...cur, pages: cur.pages.map((p) => (p.id === pid ? { ...p, ...r.page } : p)), counts: { ...cur.counts, working: cur.counts.working + 1, failed: Math.max(0, cur.counts.failed - 1) } })); }
    catch (e) { toast(e.message || 'Could not try again.', { tone: 'bad' }); }
  };
  const removePage = async (pid) => {
    try {
      await fx.scanDeletePage(sid, pid);
      edit((l) => L.dropPage(l, pid), { history: false });
      setS((cur) => { const pages = cur.pages.filter((p) => p.id !== pid); return { ...cur, pages, counts: { ...cur.counts, total: pages.length, ready: pages.filter((p) => p.status === 'ready').length, failed: pages.filter((p) => p.status === 'failed').length } }; });
      setLb(null); setConfirm(null);
    } catch (e) { toast(e.message || 'Could not delete the page.', { tone: 'bad' }); setConfirm(null); }
  };
  const undo = () => {
    const prev = hist[hist.length - 1];
    if (!prev) return;
    setHist((h) => h.slice(0, -1));
    layoutRef.current = prev; setLayout(prev); dirty.current = true; ver.current += 1;
  };
  const changeCase = (ref, c) => { if (c?.title) addLabel(ref, c.title); setDefaults((d) => ({ ...d, case_ref: ref || undefined })); dirty.current = true; ver.current += 1; };
  const changePfile = (id, f) => { setPfLabel(f ? `${f.file_no} · ${f.title}` : ''); setDefaults((d) => ({ ...d, pfile_id: id || undefined })); dirty.current = true; ver.current += 1; };
  const discard = async () => { try { await fx.scanDelete(sid); toast('Scan discarded'); dirty.current = false; onSid(null); } catch (e) { toast(e.message, { tone: 'bad' }); setConfirm(null); } };

  // ── filing ───────────────────────────────────────────────────────────────────────────
  const docs = layout?.docs || [];
  const todo = docs.filter((d) => !lockedKey(d.key));
  const effCase = (d) => d.case_ref || defaults.case_ref || null;
  const noCase = todo.filter((d) => !effCase(d) && !defaults.pfile_id).length;
  const pending = suggesting || working || upActive;
  const fileAll = async () => {
    if (!todo.length || filing) return;
    setFiling({ done: 0, total: todo.length });
    let closed = false;
    const fails = {};
    const okMap = { ...filedMap };
    try {
      for (let i = 0; i < todo.length; i += BATCH) {
        const keys = todo.slice(i, i + BATCH).map((d) => d.key);
        try {
          const r = await fx.scanFinalize(sid, { layout: L.forServer(layoutRef.current), defaults: defaultsRef.current, only: keys });
          dirty.current = false;
          r.results.forEach((x) => { if (x.ok) { okMap[x.key] = x; delete fails[x.key]; } else fails[x.key] = { error: x.error }; });
          closed = !!r.closed;
        } catch (e) {
          keys.forEach((k) => { fails[k] = { error: e.message || 'Could not file this document.' }; });
          if (!e.status || e.status >= 500 || e.status === 401) { toast(e.message || 'Filing stopped. Your work is saved — press the button again.', { tone: 'bad' }); break; }
        }
        setFiling({ done: Math.min(todo.length, i + keys.length), total: todo.length });
        setFiledMap({ ...okMap }); setErrors({ ...fails });
      }
    } finally { setFiling(null); }
    setFiledMap({ ...okMap }); setErrors({ ...fails });
    const nFail = Object.keys(fails).length;
    if (closed && !nFail) setDone({ results: docs.map((d) => ({ ...okMap[d.key], key: d.key })).filter((x) => x.doc_id) });
    else if (nFail) toast(`${plural(nFail, 'document')} could not be filed — see the red notes. The others are done.`, { tone: 'bad' });
  };

  // drag files from the desktop onto the board
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

  if (fatal) {
    return <section className="fx-section"><EmptyState icon="alert" title={fatal} actions={<button type="button" className="dh-btn primary" onClick={() => onSid(null)}>Back to Scan &amp; file</button>}>Documents already filed from it are safe in your library.</EmptyState></section>;
  }
  if (done) {
    const by = done.results;
    const none = by.filter((r) => !r.case_ref).length;
    return (
      <section className="fx-section" aria-label="Scan filed">
        <div className="fx-success">
          <div className="ic"><Icon name="checkCircle" size={30} /></div>
          <h2 className="fx-h">{plural(by.length, 'document')} filed</h2>
          <p className="fx-lead">Every document is now a searchable PDF in your library.{none ? ` ${plural(none, 'document')} ${none === 1 ? 'has' : 'have'} no case yet — find ${none === 1 ? 'it' : 'them'} under “To file” and attach with one click.` : ''}</p>
          <ul className="fx-results">
            {by.map((r) => <li key={r.key}><Icon name="doc" /><button type="button" className="nm" onClick={() => onOpenDoc(r.doc_id)}>{r.title}</button><span className="mut">{plural(r.pages, 'page')} · {r.case_label || 'no case yet'}{r.paper_file ? ` · ${r.paper_file}` : ''}</span></li>)}
          </ul>
          <div className="row">
            <button type="button" className="dh-btn primary" onClick={() => onSid(null)}><Icon name="camera" />Scan more</button>
            {none ? <button type="button" className="dh-btn ghost" onClick={() => onGo('tofile')}>Go to “To file”</button> : null}
            <button type="button" className="dh-btn ghost" onClick={() => onGo('library')}>Open the library</button>
          </div>
        </div>
      </section>
    );
  }
  if (!s) return <section className="fx-section"><Spinner label="Opening the scan…" /></section>;

  const counts = s.counts || { total: 0, ready: 0, working: 0, failed: 0 };
  const failedPages = pageList.filter((p) => p.status === 'failed');
  const removed = (layout?.removed || []).filter((id) => pagesById[id]);
  const nDocs = docs.length;
  const docsInfo = docs.map((d, i) => ({ key: d.key, n: i + 1, locked: lockedKey(d.key), title: d.title, pages: d.pages.length }));
  const movingFrom = moving ? docs.find((d) => d.pages.includes(moving))?.key : null;
  const upTotal = ups.length;
  const upDone = ups.filter((u) => u.status === 'done' || u.status === 'err').length;
  const upErr = ups.filter((u) => u.status === 'err');
  const readPct = counts.total ? Math.round((counts.ready + counts.failed) / counts.total * 100) : 0;
  const empty = !counts.total && !upActive;

  return (
    <section className="fx-section fx-studio" aria-label="Scan and file board"
      onDragEnter={(e) => { if (hasFiles(e)) { depth.current += 1; setOver(true); } }} onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
      onDragLeave={() => { depth.current -= 1; if (depth.current <= 0) { depth.current = 0; setOver(false); } }}
      onDrop={(e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); depth.current = 0; setOver(false); enqueue(e.dataTransfer.files); }}>
      <div className="fx-studiohead">
        <button type="button" className="dh-btn quiet sm" onClick={() => { save(); onSid(null); }}><Icon name="back" />All scans</button>
        <div className="defs">
          <CasePicker compact value={defaults.case_ref || ''} label={defaults.case_ref ? (labels[defaults.case_ref] || defaults.case_ref) : ''} allowNone noneLabel="Let the hub suggest" placeholder="File on a case…" onChange={changeCase} disabled={!!filing} />
          <PfilePicker value={defaults.pfile_id} label={pfLabel} onChange={changePfile} disabled={!!filing} />
        </div>
        <div className="acts">
          <span className={`fx-savestate ${saveState}`} aria-live="polite">{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Not saved' : ''}</span>
          <button type="button" className="dh-btn ghost sm" onClick={undo} disabled={!hist.length || !!filing} title="Undo the last change"><Icon name="undo" />Undo</button>
          <Menu icon="plus" label="Add pages" className="dh-btn primary sm" disabled={!!filing}>
            {(close) => (
              <>
                <button type="button" role="menuitem" onClick={() => { close(); camInput.current?.click(); }}><Icon name="camera" />Take a photo</button>
                <button type="button" role="menuitem" onClick={() => { close(); fileInput.current?.click(); }}><Icon name="upload" />Choose photos or a PDF</button>
              </>
            )}
          </Menu>
          <Menu icon="more" label="" chevron={false} right className="dh-ibtn boxed" title="More">
            {(close) => <button type="button" role="menuitem" onClick={() => { close(); setConfirm('discard'); }}><Icon name="trash" />Discard this scan</button>}
          </Menu>
        </div>
        <input ref={fileInput} type="file" hidden multiple accept="image/*,application/pdf,.pdf" onChange={(e) => { enqueue(e.target.files); e.target.value = ''; }} />
        <input ref={camInput} type="file" hidden accept="image/*" capture="environment" onChange={(e) => { enqueue(e.target.files); e.target.value = ''; }} />
      </div>

      {config && !config.ocr?.available ? <div className="dh-banner"><Icon name="info" /><div className="body"><b>Text recognition is off on this server.</b> Pages are cleaned and filed as PDFs, but names and cases are not suggested — choose them yourself.</div></div> : null}

      {upActive ? (
        <div className="fx-progress" role="status"><div className="dh-bar thick"><i style={{ width: `${Math.max(4, Math.round(upDone / Math.max(1, upTotal) * 100))}%` }} /></div><span>Adding pages… <b>{upDone}</b> of {upTotal} files</span></div>
      ) : working ? (
        <div className="fx-progress" role="status"><div className="dh-bar thick"><i style={{ width: `${Math.max(4, readPct)}%` }} /></div><span>Straightening, cleaning and reading the pages… <b>{counts.ready + counts.failed}</b> of {counts.total}</span></div>
      ) : suggesting ? (
        <div className="fx-progress" role="status"><Icon name="spark" /><span>Working out where each document starts and ends…</span></div>
      ) : null}
      {upErr.length ? (
        <div className="dh-banner rust" role="alert"><Icon name="alert" /><div className="body"><b>{plural(upErr.length, 'file')} could not be added.</b>
          <ul className="fx-uperrs">{upErr.slice(0, 5).map((u) => <li key={u.id}><b>{u.name}</b> — {u.error}</li>)}</ul></div>
          <button type="button" className="dh-btn quiet sm" onClick={() => { itemsRef.current = itemsRef.current.filter((x) => x.status !== 'err'); syncUps(); }}>Dismiss</button></div>
      ) : null}
      {failedPages.length ? (
        <div className="dh-banner rust" role="alert"><Icon name="alert" /><div className="body"><b>{plural(failedPages.length, 'page')} could not be cleaned.</b> {failedPages[0].error || 'Try again, or delete it and photograph it once more.'}</div>
          <button type="button" className="dh-btn ghost sm" onClick={() => failedPages.forEach((p) => retry(p.id))}>Try again</button>
          <button type="button" className="dh-btn ghost sm" onClick={() => setLb(failedPages[0].id)}>Look</button></div>
      ) : null}

      {empty ? (
        <div className={`fx-drop${over ? ' over' : ''}`}>
          <div className="ic"><Icon name="camera" size={26} /></div><h3>No pages yet</h3><p>Take photos or choose files to begin.</p>
          <div className="row"><button type="button" className="dh-btn primary" onClick={() => camInput.current?.click()}><Icon name="camera" />Take photos</button><button type="button" className="dh-btn ghost" onClick={() => fileInput.current?.click()}><Icon name="upload" />Choose files</button></div>
        </div>
      ) : null}

      {!layout && counts.total ? (
        <div className="fx-sofar" aria-label="Pages so far">
          {pageList.slice(0, 60).map((p) => (
            <span key={p.id} className="fx-thumb static small"><span className="pic">{p.status === 'ready' ? <AuthImg cacheKey={`thumb-${sid}-${p.id}-${p.v || 0}-${p.rot || 0}`} load={thumbLoader(sid, p)} alt="" /> : <span className="fx-pending"><Icon name={p.status === 'failed' ? 'alert' : 'refresh'} className={p.status === 'failed' ? '' : 'dh-spin'} /></span>}</span></span>
          ))}
          {counts.total > 60 ? <span className="mut">+{counts.total - 60} more</span> : null}
        </div>
      ) : null}

      {layout && !docs.length && !pending && counts.total && !upActive ? (
        <EmptyState icon="image" title="Nothing left to file">{removed.length ? 'Every page was left out. Open “pages left out” below to bring pages back.' : 'Add some pages first.'}</EmptyState>
      ) : null}

      {docs.length ? (
        <div className="fx-board">
          <div className="fx-boardhead"><b>{plural(nDocs, 'document')} found</b><span className="mut">in {plural(counts.ready, 'page')}. Check each one, fix anything the hub got wrong, then file.</span></div>
          {docs.map((d, i) => (
            <DocCard key={d.key} sid={sid} doc={d} n={i + 1} count={nDocs} pages={pagesById} classes={classes} defaults={defaults} labels={labels}
              filed={filedMap[d.key] ? { ...filedMap[d.key] } : errors[d.key] ? { error: errors[d.key].error } : null} busy={busyKeys.has(d.key)}
              drag={drag} setDrag={setDrag} handlers={handlers} />
          ))}
          {drag !== null ? <Portal><div className="fx-newdoc" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const d = drag; setDrag(null); handlers.drop(d, null); }}><Icon name="plus" />Drop here to make it a separate document</div></Portal> : null}
        </div>
      ) : null}

      <AsideTray sid={sid} ids={removed} pages={pagesById} onRestore={restore} onOpen={setLb} onDelete={(pid) => setConfirm({ del: pid })} />

      {docs.length ? (
        <div className="fx-filebar" role="region" aria-label="File these documents">
          <div className="txt">
            {filing ? <><b>Filing…</b> {filing.done} of {filing.total}</> : todo.length ? <><b>{plural(todo.length, 'document')}</b> ready to file{noCase ? <span className="mut"> · {plural(noCase, 'document')} without a case will wait in “To file”</span> : null}</>
              : <><Icon name="checkCircle" />Everything here is filed</>}
          </div>
          {filing ? <div className="dh-bar thick" style={{ flex: 1, maxWidth: 260 }}><i style={{ width: `${Math.max(5, Math.round(filing.done / filing.total * 100))}%` }} /></div> : null}
          <button type="button" className="dh-btn primary" disabled={!todo.length || pending || !!filing} onClick={fileAll}>
            <Icon name="check" />{filing ? 'Filing…' : pending ? 'Still reading…' : `File ${plural(todo.length, 'document')}`}
          </button>
        </div>
      ) : null}

      {over ? <Portal><div className="dh-dropveil" aria-hidden="true"><div className="card"><Icon name="camera" size={28} /><h3>Drop to add pages</h3><p>Photos and PDFs are added to this scan.</p></div></div></Portal> : null}
      {moving ? <MovePageModal docs={docsInfo} ownKey={movingFrom} onClose={() => setMoving(null)} onPick={(to) => { edit((l) => L.movePage(l, moving, to)); setMoving(null); }} /> : null}
      {lb ? <Lightbox sid={sid} order={order} pages={pagesById} startId={lb} where={where} onClose={() => setLb(null)} onRotate={handlers.rotate} onRetry={retry}
        onAside={(pid) => { handlers.aside(pid); }} onRestore={(pid) => restore(pid)} onDelete={(pid) => setConfirm({ del: pid })} /> : null}
      {confirm === 'discard' ? <Confirm danger title="Discard this scan?" confirmLabel="Discard" onConfirm={discard} onCancel={() => setConfirm(null)}>All its pages are deleted and nothing is filed. Documents already filed from it stay in your library.</Confirm> : null}
      {confirm?.del ? <Confirm danger title="Delete this page for good?" confirmLabel="Delete page" onConfirm={() => removePage(confirm.del)} onCancel={() => setConfirm(null)}>The page is removed from this scan. Use “leave out” instead if you only want to keep it out of the filing.</Confirm> : null}
    </section>
  );
}

export function ScanStudio({ sid, onSid, config, toast, onOpenDoc, onGo, caseRef, caseLabel }) {
  if (sid) return <Studio key={sid} sid={sid} onSid={onSid} config={config} toast={toast} onOpenDoc={onOpenDoc} onGo={onGo} />;
  return <Landing onSid={onSid} toast={toast} caseRef={caseRef} caseLabel={caseLabel} config={config} />;
}

