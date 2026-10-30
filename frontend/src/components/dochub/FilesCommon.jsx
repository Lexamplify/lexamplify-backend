// Small pieces shared by the paper-to-digital tabs.
import { useCallback, useEffect, useRef, useState } from 'react';
import { dh } from './api.js';
import { fx } from './filesApi.js';
import { fmtBytes, plural } from './format.js';
import { Icon } from './icons.jsx';
import { Modal, useDebounced } from './ui.jsx';

export const caseTitle = (c) => (c ? [c.title, c.case_no].filter(Boolean).join(' · ') : '');

// ── a searchable "which case?" box ───────────────────────────────────────────────────────
export function CasePicker({ value, label, onChange, placeholder = 'Choose a case…', allowNone, noneLabel = 'No case', disabled, id, compact, up, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const dq = useDebounced(q, 220);
  const wrap = useRef(null);
  const inputRef = useRef(null);
  const [hi, setHi] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    let dead = false;
    setErr('');
    fx.cases(dq).then((r) => { if (!dead) { setRows(r); setHi(0); } }).catch((e) => { if (!dead) { setErr(e.message || 'Could not load cases.'); setRows([]); } });
    return () => { dead = true; };
  }, [open, dq]);

  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0); else { setQ(''); setRows(null); } }, [open]);

  const pick = (c) => { onChange(c ? c.ref : '', c || null); setOpen(false); };
  const list = rows || [];
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(list.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (list[hi]) pick(list[hi]); }
  };
  return (
    <div className={`fx-pick${compact ? ' compact' : ''}`} ref={wrap}>
      <button type="button" id={id} className={`fx-pickbtn${value ? ' has' : ''}`} onClick={() => setOpen((o) => !o)} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}>
        <Icon name="briefcase" />
        <span className="t">{value ? (label || value) : placeholder}</span>
        <Icon name="chevD" size={12} />
      </button>
      {open ? (
        <div className={`fx-pickpanel${up ? ' up' : ''}`} onKeyDown={onKey}>
          <div className="fx-picksearch"><Icon name="search" /><input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by case name, number, client or court" aria-label="Search cases" /></div>
          <div className="fx-picklist" role="listbox">
            {allowNone ? <button type="button" className="fx-pickopt none" onClick={() => pick(null)}><span className="nm">{noneLabel}</span></button> : null}
            {rows === null ? <div className="fx-pickmsg">Loading…</div> : null}
            {err ? <div className="fx-pickmsg bad">{err}</div> : null}
            {rows && !err && !list.length ? <div className="fx-pickmsg">{dq ? 'No case matches that.' : 'You have no open cases yet. Create one in Practice, then file documents to it.'}</div> : null}
            {list.map((c, i) => (
              <button key={c.ref} type="button" role="option" aria-selected={value === c.ref} className={`fx-pickopt${i === hi ? ' hi' : ''}${value === c.ref ? ' on' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => pick(c)}>
                <span className="nm">{c.title}</span>
                <span className="mt">{[c.case_no, c.court, c.client].filter(Boolean).join(' · ') || (c.kind === 'lpms' ? 'Practice case' : 'Matter')}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── images that need the login cookie: fetch as a blob, show when scrolled into view ─────
const CACHE = new Map();
const MAX_CACHE = 240;
let active = 0;
const waiting = [];
const LIMIT = 5;
function slot() {
  return new Promise((res) => { if (active < LIMIT) { active += 1; res(); } else waiting.push(res); });
}
function release() {
  const next = waiting.shift();
  if (next) next(); else active -= 1;
}
async function fetchUrl(key, load) {
  if (CACHE.has(key)) { const v = CACHE.get(key); CACHE.delete(key); CACHE.set(key, v); return v; }
  await slot();
  try {
    const blob = await load();
    const url = URL.createObjectURL(blob);
    CACHE.set(key, url);
    if (CACHE.size > MAX_CACHE) {
      const first = CACHE.keys().next().value;
      const old = CACHE.get(first);
      CACHE.delete(first);
      setTimeout(() => URL.revokeObjectURL(old), 4000);
    }
    return url;
  } finally { release(); }
}

export function AuthImg({ cacheKey, load, alt = '', className = '', style, onClick, eager }) {
  const [src, setSrc] = useState(() => CACHE.get(cacheKey) || null);
  const [failed, setFailed] = useState(false);
  const [seen, setSeen] = useState(!!eager || CACHE.has(cacheKey));
  const ref = useRef(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (seen) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  useEffect(() => {
    if (!seen) return undefined;
    let dead = false;
    setFailed(false);
    if (CACHE.has(cacheKey)) { setSrc(CACHE.get(cacheKey)); return undefined; }
    setSrc(null);
    fetchUrl(cacheKey, () => loadRef.current()).then((u) => { if (!dead) setSrc(u); }).catch(() => { if (!dead) setFailed(true); });
    return () => { dead = true; };
  }, [seen, cacheKey]);

  return (
    <span ref={ref} className={`fx-img ${className}`} style={style} onClick={onClick}>
      {src ? <img src={src} alt={alt} draggable={false} /> : <span className={`ph${failed ? ' bad' : ''}`}>{failed ? <Icon name="alert" /> : null}</span>}
    </span>
  );
}

// ── tiny helpers ─────────────────────────────────────────────────────────────────────────
export function useAsync() {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return useCallback(() => alive.current, []);
}

export function Spinner({ label }) {
  return <span className="fx-spin" role="status"><Icon name="refresh" className="dh-spin" />{label ? <span>{label}</span> : null}</span>;
}

export const todayIso = (plusDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + plusDays);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function fmtDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function dueText(f) {
  if (f.status !== 'out' || !f.due_at) return '';
  const n = f.days_to_due;
  if (n === null || n === undefined) return `due ${fmtDay(f.due_at)}`;
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} overdue`;
  if (n === 0) return 'due today';
  if (n === 1) return 'due tomorrow';
  return `due in ${n} days`;
}

// the browser shows a PDF the server drew; a download fallback is in filesApi.openPdf
export const KIND_NAME = { file: 'File', bundle: 'Bundle', box: 'Box', register: 'Register', original: 'Original documents' };

// ── pick documents from the library (used to link scans to a paper file and to fill a bundle) ─────
export function DocPickerModal({ title = 'Choose documents', confirmLabel = 'Add', exclude = [], caseRef, onConfirm, onClose, busy, max = 300 }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 260);
  const [scope, setScope] = useState(caseRef ? 'case' : 'all');
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(() => new Map());
  const skip = useRef(new Set(exclude));

  useEffect(() => {
    let dead = false;
    const ctrl = new AbortController();
    setRows(null); setErr('');
    const params = { q: dq, per_page: 40, sort: dq ? 'relevance' : 'newest', page: 1 };
    if (scope === 'case' && caseRef) {
      const [kind, id] = caseRef.split(':');
      if (kind === 'lpms') params.lpms_case_id = id; else if (kind === 'matter') params.matter_id = id;
    }
    dh.list(params, ctrl.signal).then((r) => { if (!dead) { setRows(r.docs.filter((d) => d.is_current !== false)); setTotal(r.total); } })
      .catch((e) => { if (!dead && e?.name !== 'AbortError') { setErr(e.message || 'Could not load documents.'); setRows([]); } });
    return () => { dead = true; ctrl.abort(); };
  }, [dq, scope, caseRef]);

  const toggle = (d) => setSel((m) => { const n = new Map(m); if (n.has(d.id)) n.delete(d.id); else if (n.size < max) n.set(d.id, d); return n; });
  return (
    <Modal title={title} onClose={onClose}
      footer={<><span className="fx-mfootnote">{sel.size ? plural(sel.size, 'document') + ' chosen' : ''}</span><button type="button" className="dh-btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="dh-btn primary" disabled={!sel.size || busy} onClick={() => onConfirm([...sel.keys()], [...sel.values()])}>{busy ? 'Working…' : `${confirmLabel}${sel.size ? ` (${sel.size})` : ''}`}</button></>}>
      <div className="fx-docpick">
        <div className="fx-docpick-bar">
          <div className="fx-picksearch wide"><Icon name="search" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search inside your documents…" aria-label="Search documents" /></div>
          {caseRef ? (
            <div className="fx-seg" role="group" aria-label="Where to look">
              <button type="button" className={scope === 'case' ? 'on' : ''} onClick={() => setScope('case')}>This case</button>
              <button type="button" className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Everything</button>
            </div>
          ) : null}
        </div>
        {err ? <div className="dh-errbox" role="alert"><Icon name="alert" /><div className="body">{err}</div></div> : null}
        {rows === null ? <div className="fx-pickmsg">Loading…</div> : null}
        {rows && !rows.length && !err ? <div className="fx-pickmsg">{dq ? 'No document matches that.' : 'No documents here yet.'}</div> : null}
        <div className="fx-doclist">
          {(rows || []).map((d) => {
            const gone = skip.current.has(d.id);
            const on = sel.has(d.id);
            return (
              <label key={d.id} className={`fx-docopt${on ? ' on' : ''}${gone ? ' gone' : ''}`}>
                <input type="checkbox" checked={on || gone} disabled={gone} onChange={() => toggle(d)} />
                <span className="nm">{d.title}</span>
                <span className="mt">{[d.doc_class !== 'Unclassified' ? d.doc_class : null, d.page_count ? plural(d.page_count, 'page') : null, fmtBytes(d.size)].filter(Boolean).join(' · ')}{gone ? ' · already added' : ''}</span>
              </label>
            );
          })}
        </div>
        {total > (rows || []).length ? <p className="fx-more">Showing the first {(rows || []).length} of {total}. Type a few words to narrow it down.</p> : null}
      </div>
    </Modal>
  );
}
