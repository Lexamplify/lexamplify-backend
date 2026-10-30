import { useCallback, useEffect, useRef, useState } from 'react';
import { PIcon } from './icons.jsx';
import { STATUS_TONE, fmtShort, initials, relDay } from './util.js';
import { doneWith } from './api.js';

// ── data loading ───────────────────────────────────────────────────────────────────────
// Keeps the last good data on screen while a reload runs, so lists never flash empty.
// `resetKey` (optional): the identity of what is shown (a case id, a client id ...). When it changes the previous data is dropped
// at once and `loading` is true, so opening case B never shows case A's content under B's address.
export function useAsync(fn, deps, resetKey) {
  const [st, setSt] = useState({ data: null, error: null, loading: true, rk: resetKey });
  const [n, setN] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let dead = false;
    const ac = new AbortController();
    setSt((s) => (Object.is(s.rk, resetKey) ? { ...s, loading: true, error: null } : { data: null, error: null, loading: true, rk: resetKey }));
    Promise.resolve(fnRef.current(ac.signal)).then((data) => {
      if (!dead) setSt({ data, error: null, loading: false, rk: resetKey });
    }).catch((e) => {
      if (dead || e?.name === 'AbortError') return;
      setSt((s) => ({ data: s.data, error: e, loading: false, rk: resetKey }));
    });
    return () => { dead = true; ac.abort(); };
  }, [...deps, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => setN((x) => x + 1), []);
  if (!Object.is(st.rk, resetKey)) return { data: null, error: null, loading: true, reload };   // the very render in which the key changed
  return { data: st.data, error: st.error, loading: st.loading, reload };
}

export function Spinner() { return <PIcon name="refresh" className="dh-spin" />; }

export function Loading({ label = 'Loading…' }) {
  return <div className="pr-loading" role="status"><Spinner />{label}</div>;
}

export function ErrorBox({ error, retry, compact }) {
  return (
    <div className="dh-banner rust" role="alert" style={compact ? { margin: 12 } : undefined}>
      <PIcon name="alert" />
      <div className="body"><b>This did not load.</b> {doneWith(error)}</div>
      {retry ? <button type="button" className="dh-btn ghost sm" onClick={retry}>Try again</button> : null}
    </div>
  );
}

// ── layout ─────────────────────────────────────────────────────────────────────────────
export function PageHead({ title, sub, children }) {
  return (
    <div className="dh-head">
      <div style={{ minWidth: 0 }}>
        <h2 className="dh-title">{title}</h2>
        {sub ? <p className="dh-sub">{sub}</p> : null}
      </div>
      {children ? <div className="dh-actions">{children}</div> : null}
    </div>
  );
}

export function Card({ title, sub, actions, children, flush, className = '', tight, id }) {
  return (
    <section className={`pr-card ${tight ? 'tight' : ''} ${className}`} id={id}>
      {title || actions ? (
        <div className="hd">
          <h3>{title}</h3>
          {sub ? <span className="sub">{sub}</span> : null}
          {actions}
        </div>
      ) : null}
      <div className={`bd ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, children, className = '', required }) {
  return (
    <label className={`dh-field ${className}`}>
      <span className="lab">{label}{required ? ' *' : ''}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} aria-label={label} className="pr-toggle" disabled={disabled} onClick={() => onChange(!checked)} />
  );
}

export function Switch({ title, help, checked, onChange, disabled }) {
  return (
    <div className="pr-switch">
      <div className="tx"><b>{title}</b>{help ? <span>{help}</span> : null}</div>
      <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

export function Segment({ value, onChange, options, label }) {
  return (
    <div className="pr-segment" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Avatar({ name, large }) {
  return <span className={`pr-avatar ${large ? 'lg' : ''}`} aria-hidden="true">{initials(name)}</span>;
}

// ── small data displays ────────────────────────────────────────────────────────────────
export function StatusPill({ status }) {
  if (!status) return null;
  return <span className={`pr-pill ${STATUS_TONE[status] || ''}`}><span className="dot" />{status}</span>;
}

export function Prio({ priority }) {
  if (!priority || priority === 'normal') return null;
  return <span className={`pr-prio ${priority}`}>{priority}</span>;
}

// "Tomorrow" / "3 days ago" next to a date, coloured when it matters.
export function DayChip({ date, past, plain }) {
  if (!date) return <span className="pr-muted">—</span>;
  const r = relDay(date, { past });
  return (
    <span className={`pr-pill ${r.tone === 'bad' ? 'bad' : r.tone === 'warn' ? 'warn' : 'good'}`} title={date}>
      {fmtShort(date)}{plain || !r.text ? '' : ` · ${r.text}`}
    </span>
  );
}

export function Bars({ rows, alt }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <p className="pr-note">Nothing to show yet.</p>;
  return (
    <div className="pr-bars">
      {rows.map((r) => (
        <div className="pr-bar" key={r.label}>
          <span className="l" title={r.label}>{r.label}</span>
          <span className="track"><i className={alt ? 'alt' : ''} style={{ width: `${Math.max(4, (r.n / max) * 100)}%` }} /></span>
          <span className="v">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

export function Pager({ page, per, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / per));
  if (total <= per) return null;
  const from = (page - 1) * per + 1;
  const to = Math.min(total, page * per);
  return (
    <div className="dh-pager">
      <span className="info">{from}–{to} of {total}</span>
      <div className="btns">
        <button type="button" className="dh-btn ghost sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><PIcon name="chevL" />Previous</button>
        <span className="pg">{page} / {pages}</span>
        <button type="button" className="dh-btn ghost sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next<PIcon name="chevR" /></button>
      </div>
    </div>
  );
}

export function Stat({ n, label, sub, tone, onClick, active }) {
  const cls = `dh-stat ${tone || ''} ${active ? 'on' : ''}`;
  const body = (<><span className="n">{n}</span><span className="l">{label}</span>{sub ? <span className="sub">{sub}</span> : null}</>);
  return onClick ? <button type="button" className={cls} onClick={onClick}>{body}</button> : <div className={cls}>{body}</div>;
}

// debounce a callback-driven value (search boxes)
export function useDebouncedValue(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function ErrText({ children }) { return children ? <p className="pr-err" role="alert">{children}</p> : null; }
