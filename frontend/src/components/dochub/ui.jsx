// Small shared UI pieces for the Document Hub: portal, dialogs, popover menus, toasts, hooks, folder helpers.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons.jsx';

// Overlays are rendered on <body> but still need the hub's colour tokens, so they get their own scoped root.
export function Portal({ children }) {
  return createPortal(<div className="dh-root">{children}</div>, document.body);
}

// True while the window matches a CSS media query (used to lift the filter sheet out of the page on phones and tablets).
export function useMedia(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const m = window.matchMedia(query);
    const h = () => setOn(m.matches);
    h();
    m.addEventListener ? m.addEventListener('change', h) : m.addListener(h);
    return () => { m.removeEventListener ? m.removeEventListener('change', h) : m.removeListener(h); };
  }, [query]);
  return on;
}

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const isTyping = (el) => {
  if (!el) return false;
  const t = el.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable;
};

// handlers: { key: fn(event) }. Ignored while typing in a field or with Ctrl/Alt/Meta held.
export function useHotkeys(handlers, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!enabled) return undefined;
    const on = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (isTyping(e.target) && e.key !== 'Escape') return;
      const fn = ref.current[e.key];
      if (fn) fn(e);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [enabled]);
}

// Only the top-most dialog reacts to Escape / Tab, so a confirm box inside the preview drawer closes alone.
const STACK = [];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useDialog(ref, onClose, { initialFocus } = {}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current;
    const prev = document.activeElement;
    const token = {};
    STACK.push(token);
    const target = (initialFocus && el?.querySelector(initialFocus)) || el;
    if (target) { if (target === el) el.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }
    const on = (e) => {
      if (STACK[STACK.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current?.();
      } else if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
        if (!items.length) { e.preventDefault(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', on, true);
    return () => {
      window.removeEventListener('keydown', on, true);
      const i = STACK.indexOf(token);
      if (i >= 0) STACK.splice(i, 1);
      if (prev && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

export function Modal({ title, onClose, children, footer, small, label }) {
  const ref = useRef(null);
  useDialog(ref, onClose);
  return (
    <Portal>
      <div className="dh-scrim" onMouseDown={onClose} />
      <div className={`dh-modal${small ? ' sm' : ''}`} role="dialog" aria-modal="true" aria-label={label || title} ref={ref}>
        <div className="dh-mhead">
          <h2>{title}</h2>
          <button type="button" className="dh-ibtn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="dh-mbody">{children}</div>
        {footer ? <div className="dh-mfoot">{footer}</div> : null}
      </div>
    </Portal>
  );
}

export function Confirm({ title, children, confirmLabel = 'Confirm', danger, busy, onConfirm, onCancel }) {
  return (
    <Modal small title={title} onClose={busy ? () => {} : onCancel}
      footer={(
        <>
          <button type="button" className="dh-btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={`dh-btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      )}>
      <div style={{ color: 'var(--ink-soft)', fontSize: 13.5, lineHeight: 1.6 }}>{children}</div>
    </Modal>
  );
}

// Popover menu. `children` is a function so items can close the menu.
export function Menu({ label, icon, children, right, up, disabled, className = 'dh-btn ghost sm', title, chevron = true }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', key, true); };
  }, [open]);
  return (
    <div className="dh-menuwrap" ref={wrap}>
      <button type="button" className={className} onClick={() => setOpen((o) => !o)} disabled={disabled} aria-haspopup="menu" aria-expanded={open} title={title}>
        {icon ? <Icon name={icon} /> : null}{label}{chevron && label ? <Icon name="chevD" size={12} /> : null}
      </button>
      {open ? <div className={`dh-menu${right ? ' right' : ''}${up ? ' up' : ''}`} role="menu">{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

let TID = 0;
export function useToasts() {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, opts = {}) => {
    const id = ++TID;
    setItems((l) => [...l.slice(-2), { id, msg, tone: opts.tone, action: opts.action }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), opts.ms || (opts.tone === 'bad' ? 7000 : 4200));
    return id;
  }, []);
  const dismiss = useCallback((id) => setItems((l) => l.filter((x) => x.id !== id)), []);
  return { items, push, dismiss };
}

export function Toasts({ items, dismiss }) {
  if (!items.length) return null;
  return (
    <Portal>
      <div className="dh-toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`dh-toast ${t.tone || ''}`}>
            <span>{t.msg}</span>
            {t.action ? <button type="button" onClick={() => { t.action.run(); dismiss(t.id); }}>{t.action.label}</button> : null}
          </div>
        ))}
      </div>
    </Portal>
  );
}

export function EmptyState({ icon = 'doc', title, children, actions }) {
  return (
    <div className="dh-empty">
      <div className="ic"><Icon name={icon} /></div>
      <h3>{title}</h3>
      <p>{children}</p>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export function Chip({ tone, icon, children, title, className = '' }) {
  return (
    <span className={`dh-chip ${tone || ''} ${className}`} title={title}>
      {icon ? <Icon name={icon} /> : null}{children}
    </span>
  );
}

export function useHubScrollLock(active) {
  useLayoutEffect(() => {
    if (!active) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [active]);
}

// ── folders ────────────────────────────────────────────────────────────────────────────
// `flat` is the Case Vault folder list ({id, name, parent_id, ...}); one tree serves the whole product.
export function buildFolderIndex(flat) {
  const byId = new Map();
  (flat || []).forEach((f) => byId.set(f.id, f));
  const kids = new Map();
  (flat || []).forEach((f) => {
    const p = f.parent_id && byId.has(f.parent_id) ? f.parent_id : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(f.id);
  });
  const cmp = (a, b) => (byId.get(a).name || '').localeCompare(byId.get(b).name || '', undefined, { numeric: true, sensitivity: 'base' });
  kids.forEach((l) => l.sort(cmp));
  const pathOf = (id) => {
    const out = [];
    let cur = byId.get(id);
    for (let i = 0; cur && i < 16; i += 1) { out.unshift(cur.name); cur = cur.parent_id ? byId.get(cur.parent_id) : null; }
    return out;
  };
  const options = [];
  const walk = (parent, depth) => (kids.get(parent) || []).forEach((id) => {
    options.push({ id, depth, label: pathOf(id).join(' › '), name: byId.get(id).name });
    walk(id, depth + 1);
  });
  walk(null, 0);
  return { byId, kids, pathOf, options, roots: kids.get(null) || [] };
}

// facets.folders is {"0": rootCount, "12": direct count} -> rolled-up totals per folder id
export function rollUpFolderCounts(index, direct) {
  const total = new Map();
  const visit = (id) => {
    let n = Number(direct?.[String(id)] || 0);
    (index.kids.get(id) || []).forEach((c) => { n += visit(c); });
    total.set(id, n);
    return n;
  };
  index.roots.forEach(visit);
  return total;
}
