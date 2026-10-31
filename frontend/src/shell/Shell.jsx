import { useState, useEffect } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import ThemeStudio from '../components/ThemeStudio.jsx';
import CommandBar from '../components/CommandBar.jsx';
import Notifications from '../components/Notifications.jsx';
import WorkspaceSwitcher from './WorkspaceSwitcher.jsx';
import { useSettings } from '../store/useSettings.js';
import { useAuth } from '../context/AuthContext.jsx';

const fire = (name) => window.dispatchEvent(new Event(name));

const GROUPS = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Start', Icon: Ic.Today, end: true },
      { to: '/matters', label: 'Matters', Icon: Ic.Matters },
      { to: '/dashboard', label: 'Dashboard', Icon: Ic.Sparkle },
      { to: '/contract-analyzer', label: 'Contract Analyzer', Icon: Ic.Contracts, badge: true },
      { to: '/auto-draft', label: 'Auto-Draft Studio', Icon: Ic.Draft, badge: true },
    ],
  },
  {
    label: 'Litigation & disputes',
    items: [
      { to: '/court-resources', label: 'Court Resources', Icon: Ic.Scale },
      { to: '/calendar', label: 'Legal Calendar', Icon: Ic.Calendar },
      { to: '/war-room', label: 'Virtual Courtroom', Icon: Ic.Gavel, badge: true },
    ],
  },
  {
    label: 'Practice & vault',
    items: [
      { to: '/practice', label: 'Practice', Icon: Ic.Users },
      { to: '/vault', label: 'Case Vault', Icon: Ic.Shield },
      { to: '/document-hub', label: 'Document Hub', Icon: Ic.Doc },
      { to: '/conflict-engine', label: 'Conflict Engine', Icon: Ic.Search },
      { to: '/firm-library', label: 'Firm Library', Icon: Ic.Library },
      { to: '/legal-forms', label: 'Legal Forms', Icon: Ic.Edit },
    ],
  },
];

const FLAT = GROUPS.flatMap((g) => g.items);

// On every workspace switch, reload the current route so EVERY component
// re-fetches its data with the new X-Workspace-Id header. This is
// deliberately a hard reload: tracking down and manually re-querying
// every list on every page would mean editing 20+ pages, each with its
// own useEffect-on-mount pattern. A reload is one line and always right.
if (typeof window !== 'undefined' && !window.__lxWorkspaceReloadBound) {
  window.__lxWorkspaceReloadBound = true;
  window.addEventListener('lx:workspace-changed', () => {
    // Preserve any auth refresh events during the reload cycle.
    setTimeout(() => window.location.reload(), 50);
  });
}

export default function Shell() {
  const [open, setOpen] = useState(false);
  const layout = useSettings((st) => st.layout);
  // User-controlled collapse — persisted in localStorage so it survives reloads.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('lx:rail-collapsed') === '1'; } catch { return false; }
  });
  const toggleCollapsed = () => setCollapsed((v) => {
    const next = !v;
    try { localStorage.setItem('lx:rail-collapsed', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });
  const mini = layout === 'focus' || collapsed;
  const { user, logout } = useAuth();

  // Floating tooltip for collapsed-rail hover — positioned viewport-fixed so
  // it isn't clipped by the rail's own overflow:auto scroll container.
  const [tip, setTip] = useState(null); // { text, top }
  useEffect(() => {
    if (!mini) { setTip(null); return undefined; }
    const rail = document.querySelector('.rail');
    if (!rail) return undefined;
    const over = (e) => {
      const el = e.target.closest('[data-tip]');
      if (!el || !rail.contains(el)) return;
      const r = el.getBoundingClientRect();
      setTip({ text: el.getAttribute('data-tip'), top: r.top + r.height / 2, left: r.right + 10 });
    };
    const out = (e) => {
      if (!e.relatedTarget || !rail.contains(e.relatedTarget)) setTip(null);
    };
    rail.addEventListener('mouseover', over);
    rail.addEventListener('mouseleave', out);
    return () => { rail.removeEventListener('mouseover', over); rail.removeEventListener('mouseleave', out); };
  }, [mini]);

  // IP renewal alert count — surfaced as an amber pill on the Court Resources nav
  const [ipAlertCount, setIpAlertCount] = useState(0);
  useEffect(() => {
    if (!user) return;
    const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
    fetch(`${API_BASE}/api/ip/expiring`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (Array.isArray(data)) setIpAlertCount(data.length); })
      .catch(() => {});
  }, [user]);

  // Unread notifications count — the Notifications component fetches & dispatches this
  const [notifUnread, setNotifUnread] = useState(0);
  useEffect(() => {
    const onCount = (e) => setNotifUnread(Number(e.detail) || 0);
    window.addEventListener('lx:notifications-count', onCount);
    return () => window.removeEventListener('lx:notifications-count', onCount);
  }, []);

  const displayName = user?.name || user?.full_name || user?.email || 'Advocate';
  const role = user?.role || user?.designation || 'Advocate';
  const firm = user?.firm_name || user?.workspace_name || 'Advocate Chambers';
  const initial = (displayName || 'A').trim().charAt(0).toUpperCase();

  return (
    <div className="app">
      <aside className={`rail ${mini ? 'rail--mini' : ''} ${open ? 'is-open' : ''}`}>
        <div className="rail__brand">
          <div className="rail__mono">L</div>
          <div className="rail__word"><b>Lexamplify</b><span>Advocate Chambers</span></div>
          <button
            type="button"
            className="rail__collapse"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            data-tip={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform .25s ease' }}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>

        <nav className="rail__nav">
          {GROUPS.map((g) => (
            <div className="rail__group" key={g.label}>
              <div className="rail__group-label">{g.label}</div>
              {g.items.map(({ to, label, Icon, end, badge }) => {
                const alertCount = to === '/court-resources' ? ipAlertCount : 0;
                return (
                  <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)} data-tip={label} className={({ isActive }) => `rail__link ${isActive ? 'is-active' : ''}`}>
                    <Icon /><span>{label}</span>
                    {alertCount > 0 && (
                      <span
                        className="rail__alert-pill"
                        title={`${alertCount} IP asset${alertCount === 1 ? '' : 's'} expiring soon`}
                        style={{
                          marginLeft: 'auto', padding: '2px 7px', borderRadius: 10,
                          background: '#f59e0b', color: '#1a1a1a',
                          fontSize: 10, fontWeight: 700, lineHeight: 1.3,
                        }}
                      >
                        {alertCount}
                      </span>
                    )}
                    {badge && alertCount === 0 && <span className="rail__badge" />}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="rail__foot">
          <div className="rail__user">
            <Link to="/settings" onClick={() => setOpen(false)} title="Account & settings" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', minWidth: 0, flex: 1 }}>
              <div className="rail__avatar">{initial}</div>
              <div className="rail__user-meta" style={{ minWidth: 0 }}>
                <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</b>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{role}</span>
              </div>
            </Link>
            <button
              type="button"
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--rail-muted)', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'flex' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__left">
            <button className="icon-btn rail-toggle" onClick={() => setOpen((v) => !v)} aria-label="Menu"><Ic.Menu size={18} /></button>
            <div className="rail__mono topbar__mono" style={{ width: 32, height: 32, fontSize: 16 }}>L</div>
            <WorkspaceSwitcher firmFallback={firm} />
          </div>

          <nav className="topnav">
            {FLAT.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'is-active' : '')}>{label}</NavLink>
            ))}
          </nav>

          <div className="topbar__right">
            <button className="cmdk" onClick={() => fire('lx:cmdk')}><Ic.Search size={16} /><span>Search or ask anything</span><kbd>⌘K</kbd></button>
            <button
              className="icon-btn"
              aria-label={notifUnread > 0 ? `${notifUnread} unread notifications` : 'Notifications'}
              title={notifUnread > 0 ? `${notifUnread} unread notification${notifUnread === 1 ? '' : 's'}` : 'Notifications'}
              style={{ position: 'relative' }}
              onClick={() => fire('lx:notifications')}
            >
              <Ic.Bell size={18} />
              {notifUnread > 0 && (
                <span
                  style={{
                    position: 'absolute', top: 2, right: 2,
                    minWidth: 16, height: 16, padding: '0 4px',
                    borderRadius: 999, background: 'var(--accent, #c99a4a)', color: 'var(--on-accent, #fff)',
                    border: '2px solid var(--paper)',
                    fontSize: 10, fontWeight: 700, lineHeight: '12px',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {notifUnread > 99 ? '99+' : notifUnread}
                </span>
              )}
            </button>
          </div>
        </header>

        <div className="main__scroll"><Outlet /></div>
      </div>

      {/* Floating tooltip for the collapsed sidebar — portaled by virtue of being top-level fixed. */}
      {tip && (
        <div className="rail-tip" style={{ top: tip.top, left: tip.left }}>
          <span className="rail-tip__arrow" />
          {tip.text}
        </div>
      )}

      {/* Theme Studio hidden for now — Slate Pro is the finalized default. Re-enable by rendering <ThemeStudio />. */}
      <CommandBar />
      <Notifications />
    </div>
  );
}
