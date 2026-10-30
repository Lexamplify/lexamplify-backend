import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const ICON = { gavel: Ic.Gavel, clock: Ic.Clock, draft: Ic.Draft, contract: Ic.Contracts, check: Ic.Check, hearing: Ic.Gavel, deadline: Ic.Clock, assignment: Ic.Users };
const WELCOME_SHOWN_KEY = 'lx_welcome_shown';

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function fmtTime(iso) {
  if (!iso) return '';
  const t = new Date(String(iso).replace(' ', 'T')).getTime();
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  const days = Math.round(mins / 1440);
  return days < 30
    ? `${days}d ago`
    : new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export default function Notifications() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [welcome, setWelcome] = useState(null);   // {title, body, link} for the one-time toast
  const refreshedRef = useRef(false);

  // Load notifications. Dispatches `lx:notifications-count` so the Shell can
  // show a badge count on the bell without owning the fetch itself.
  const load = useCallback(async (opts = {}) => {
    if (opts.showSpinner) setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/practice/notifications?limit=20`, { credentials: 'include' });
      if (!r.ok) {
        if (opts.showSpinner) setItems([]);
        window.dispatchEvent(new CustomEvent('lx:notifications-count', { detail: 0 }));
        return;
      }
      const d = await r.json().catch(() => ({}));
      const list = Array.isArray(d?.items) ? d.items : [];
      setItems(list);
      window.dispatchEvent(new CustomEvent('lx:notifications-count', { detail: d?.unread ?? 0 }));

      // First-login welcome: show a one-time toast if there's an unread
      // "welcome / assignment" notification and we haven't shown it before.
      if (!refreshedRef.current) {
        refreshedRef.current = true;
        try {
          const shown = localStorage.getItem(WELCOME_SHOWN_KEY) === '1';
          if (!shown) {
            const w = list.find((n) => !n.read_at && (n.kind === 'assignment' || /welcome/i.test(n.title || '')));
            if (w) setWelcome({ title: w.title, body: w.body, link: w.link });
          }
        } catch { /* localStorage may be blocked */ }
      }
    } finally {
      if (opts.showSpinner) setLoading(false);
    }
  }, []);

  // Fetch on mount + refresh every 60s so the badge stays live without a WS.
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  // Bell icon dispatches this to open the drawer (also refreshes).
  useEffect(() => {
    const onOpen = () => { setOpen(true); load({ showSpinner: true }); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('lx:notifications', onOpen);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('lx:notifications', onOpen); window.removeEventListener('keydown', onKey); };
  }, [load]);

  const unread = items.filter((i) => !i.read_at).length;

  const openNotif = async (n) => {
    if (!n.read_at) {
      // Optimistic local mark + fire-and-forget POST
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      window.dispatchEvent(new CustomEvent('lx:notifications-count', { detail: Math.max(0, unread - 1) }));
      fetch(`${API_BASE}/api/practice/notifications/${n.id}/read`, {
        method: 'POST', credentials: 'include',
        headers: { 'X-CSRF-TOKEN': csrf() },
      }).catch(() => {});
    }
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  };

  const markAllRead = async () => {
    const was = items;
    setItems((xs) => xs.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
    window.dispatchEvent(new CustomEvent('lx:notifications-count', { detail: 0 }));
    try {
      const r = await fetch(`${API_BASE}/api/practice/notifications/read-all`, {
        method: 'POST', credentials: 'include',
        headers: { 'X-CSRF-TOKEN': csrf() },
      });
      if (!r.ok) throw new Error();
    } catch {
      setItems(was); // revert on failure
      load();
    }
  };

  const dismissWelcome = () => {
    try { localStorage.setItem(WELCOME_SHOWN_KEY, '1'); } catch {}
    setWelcome(null);
  };

  return (
    <>
      {/* First-login welcome toast — once per user per browser. */}
      {welcome && (
        <WelcomeToast
          title={welcome.title}
          body={welcome.body}
          onOpenLink={() => { if (welcome.link) navigate(welcome.link); dismissWelcome(); }}
          onDismiss={dismissWelcome}
        />
      )}

      {/* Notifications drawer */}
      {open && (
        <div className="studio-overlay" onClick={() => setOpen(false)}>
          <aside className="nd" onClick={(e) => e.stopPropagation()}>
            <div className="nd__head">
              <div>
                <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 20, margin: 0 }}>Notifications</h3>
                <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>
                  {unread === 0 ? 'All caught up' : `${unread} unread`}
                </p>
              </div>
              <div className="lx-row" style={{ gap: 8 }}>
                {unread > 0 && (
                  <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={markAllRead}>Mark all read</button>
                )}
                <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><Ic.X size={17} /></button>
              </div>
            </div>
            <div className="nd__list">
              {loading && items.length === 0 && (
                <div style={{ padding: '24px 18px', color: 'var(--muted)', fontSize: 13.5 }}>Loading…</div>
              )}
              {!loading && items.length === 0 && (
                <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--muted)' }}>
                  <div style={{ display: 'grid', placeItems: 'center', marginBottom: 8 }}><Ic.Bell size={22} /></div>
                  You're all caught up.
                </div>
              )}
              {items.map((n) => {
                const I = ICON[n.kind] || Ic.Bell;
                const isUnread = !n.read_at;
                return (
                  <button
                    type="button"
                    key={n.id}
                    className="nd__it"
                    onClick={() => openNotif(n)}
                    style={{ textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer', width: '100%' }}
                  >
                    {isUnread && <span className="nd__unread" />}
                    <div className="nd__ico"><I size={17} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: isUnread ? 600 : 500, color: 'var(--ink)' }}>{n.title}</div>
                      {n.body && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{n.body}</div>}
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--muted)', flexShrink: 0 }}>{fmtTime(n.created_at)}</span>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

/** One-time welcome toast — bottom-right card, auto-dismisses after 12 s. */
function WelcomeToast({ title, body, onOpenLink, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 12_000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 110,
        maxWidth: 380, padding: '16px 18px',
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        borderLeft: '3px solid var(--accent-ink, #c99a4a)',
        borderRadius: 12,
        boxShadow: '0 20px 60px -16px rgba(0,0,0,.25)',
        animation: 'm-pop .4s ease',
      }}
    >
      <div className="lx-between" style={{ alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Ic.Sparkle size={18} />
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', padding: 2, lineHeight: 0 }}
        >
          <Ic.X size={15} />
        </button>
      </div>
      {body && (
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 10 }}>{body}</div>
      )}
      <div className="lx-row" style={{ gap: 8 }}>
        <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={onOpenLink}>Open</button>
        <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}
