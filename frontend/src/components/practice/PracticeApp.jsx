import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import '../dochub/dochub.css';
import './practice.css';
import { Toasts, useToasts } from '../dochub/ui.jsx';
import { PIcon } from './icons.jsx';
import { PracticeContext, usePractice } from './ctx.js';
import { doneWith, pr } from './api.js';
import { CaseForm } from './forms.jsx';
import { ErrorBox, ErrText, Field, Loading, useAsync, useDebouncedValue } from './widgets.jsx';
import { fmtShort } from './util.js';
import { fmtAgo } from '../dochub/format.js';

const Dashboard = lazy(() => import('./Dashboard.jsx'));
const Cases = lazy(() => import('./Cases.jsx'));
const CaseDetail = lazy(() => import('./CaseDetail.jsx'));
const Hearings = lazy(() => import('./Hearings.jsx'));
const CalendarPage = lazy(() => import('./CalendarPage.jsx'));
const Clients = lazy(() => import('./Clients.jsx'));
const Rti = lazy(() => import('./Rti.jsx'));
const Reports = lazy(() => import('./Reports.jsx'));
const Team = lazy(() => import('./Team.jsx'));
const Settings = lazy(() => import('./Settings.jsx'));
const AuditPage = lazy(() => import('./Audit.jsx'));
const NotificationsPage = lazy(() => import('./Notifications.jsx'));
const MfaSetup = lazy(() => import('./MfaSetup.jsx'));

// ── global search ──────────────────────────────────────────────────────────────────────
function SearchBox() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const dq = useDebouncedValue(q, 250);
  const [res, setRes] = useState(null);
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(0);
  const wrap = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    if (dq.trim().length < 2) { setRes(null); return undefined; }
    let dead = false;
    pr.get('/search', { q: dq.trim() }).then((d) => { if (!dead) { setRes(d); setCur(0); } }).catch(() => { if (!dead) setRes({ cases: [], clients: [], parties: [], rti: [], members: [], failed: true }); });
    return () => { dead = true; };
  }, [dq]);

  useEffect(() => {
    const down = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const key = (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !document.activeElement?.isContentEditable) {
        e.preventDefault(); input.current?.focus(); setOpen(true);
      }
    };
    document.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, []);

  const flat = useMemo(() => {
    if (!res) return [];
    return [
      ...res.cases.map((c) => ({ key: `c${c.id}`, grp: 'Cases', to: `/practice/cases/${c.id}`, t: c.title, s: [c.case_no, c.court, c.client_name, c.next_hearing ? `next ${fmtShort(c.next_hearing)}` : null].filter(Boolean).join(' · ') })),
      ...res.clients.map((c) => ({ key: `l${c.id}`, grp: 'Clients', to: `/practice/clients/${c.id}`, t: c.name, s: [c.phone, c.email].filter(Boolean).join(' · ') })),
      ...res.parties.map((p) => ({ key: `p${p.id}`, grp: 'Parties', to: `/practice/cases/${p.case_id}`, t: p.name, s: `${p.role.replace('_', ' ')} in ${p.title} · ${p.case_no}` })),
      ...res.rti.map((r) => ({ key: `r${r.id}`, grp: 'RTI', to: '/practice/rti', t: r.subject, s: r.department })),
      ...res.members.map((m) => ({ key: `m${m.id}`, grp: 'Team', to: '/practice/team', t: m.name, s: m.role })),
    ];
  }, [res]);

  const go = (it) => { setOpen(false); setQ(''); setRes(null); nav(it.to); };
  const onKey = (e) => {
    if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCur((c) => Math.min(flat.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCur((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter' && flat[cur]) { e.preventDefault(); go(flat[cur]); }
  };

  let lastGrp = null;
  return (
    <div className="pr-searchbox" ref={wrap} role="search">
      <PIcon name="search" />
      <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
        placeholder="Search cases, clients, parties…  ( / )" aria-label="Search the practice" autoComplete="off" />
      {open && q.trim().length >= 2 ? (
        <div className="pr-sresults" role="listbox">
          {!res ? <div className="none">Searching…</div> : null}
          {res?.failed ? <div className="none">Search is not available right now.</div> : null}
          {res && !res.failed && !flat.length ? <div className="none">Nothing matches “{q.trim()}”.</div> : null}
          {flat.map((it, i) => {
            const head = it.grp !== lastGrp ? <div className="grp" key={`g${it.grp}`}>{it.grp}</div> : null;
            lastGrp = it.grp;
            return [head, (
              <Link key={it.key} to={it.to} className={i === cur ? 'cur' : ''} onClick={() => go(it)} onMouseEnter={() => setCur(i)} role="option" aria-selected={i === cur}>
                <span className="t">{it.t}</span>{it.s ? <span className="s">{it.s}</span> : null}
              </Link>
            )];
          })}
        </div>
      ) : null}
    </div>
  );
}

// ── notification bell ──────────────────────────────────────────────────────────────────
function Bell() {
  const { unread, setUnread } = usePractice();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const wrap = useRef(null);

  const load = useCallback(() => pr.get('/notifications', { limit: 8 }).then((d) => { setItems(d.items); setUnread(d.unread); }).catch(() => setItems((x) => x || [])), [setUnread]);
  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') pr.get('/notifications', { limit: 1 }).then((d) => setUnread(d.unread)).catch(() => {}); }, 90000);
    return () => clearInterval(t);
  }, [setUnread]);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [open]);

  const readAll = async () => { try { await pr.post('/notifications/read-all'); setUnread(0); setItems((l) => (l || []).map((n) => ({ ...n, read_at: n.read_at || 'now' }))); } catch { /* ignore */ } };
  const openItem = async (n) => {
    setOpen(false);
    if (!n.read_at) { pr.post(`/notifications/${n.id}/read`).catch(() => {}); setUnread((u) => Math.max(0, u - 1)); }
    if (n.link) nav(n.link);
  };

  return (
    <div className="dh-menuwrap pr-bell" ref={wrap}>
      <button type="button" className="dh-ibtn boxed" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}>
        <PIcon name="bell" />{unread > 0 ? <span className="dot">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="dh-menu right pr-notif" role="dialog" aria-label="Notifications">
          <div className="hd"><span>Notifications</span>{unread > 0 ? <button type="button" className="dh-btn quiet sm" onClick={readAll}>Mark all read</button> : null}</div>
          <div className="bd">
            {items === null ? <Loading /> : null}
            {items && !items.length ? <div className="pr-loading">You are all caught up.</div> : null}
            {items && items.map((n) => (
              <button type="button" key={n.id} className={`pr-item ${n.read_at ? '' : 'unread'}`} onClick={() => openItem(n)}>
                <span><span className="ttl" style={{ fontSize: 13.5 }}>{n.title}</span>{n.body ? <span className="meta" style={{ display: 'block' }}>{n.body}</span> : null}</span>
                <span className="side">{fmtAgo(n.created_at)}</span>
              </button>
            ))}
          </div>
          <div className="ft"><Link to="/practice/notifications" className="pr-link" onClick={() => setOpen(false)}>See all notifications</Link></div>
        </div>
      ) : null}
    </div>
  );
}

// ── first-run: create the practice ─────────────────────────────────────────────────────
function Onboarding({ me, onDone }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) { setErr('Give your practice a name, for example “Rao & Associates”.'); return; }
    setBusy(true); setErr('');
    try { await pr.post('/firm', { name: name.trim(), phone: phone.trim() || null }); onDone(); } catch (e2) { setErr(doneWith(e2)); setBusy(false); }
  };
  return (
    <div className="pr-onboard">
      <p className="pr-brand"><span className="kick">Practice management</span></p>
      <h2>Set up your practice</h2>
      <p className="dh-sub" style={{ maxWidth: 'none' }}>One place for your cases, hearings, clients and team. You become the Senior Advocate, and you can add juniors and office staff afterwards. If your Senior Advocate has already added you, ask them to check the email you signed up with ({me.user.email}).</p>
      <div className="pr-roles">
        <div><b>Senior Advocate</b><span>Creates cases and accounts, sees everything, runs reports and settings.</span></div>
        <div><b>Junior Advocate</b><span>Records daily proceedings and notes on assigned cases, uploads documents.</span></div>
        <div><b>Office Staff</b><span>Appointments, client details, filing and reports.</span></div>
      </div>
      <form onSubmit={submit} className="pr-card" style={{ padding: 18 }} noValidate>
        <ErrText>{err}</ErrText>
        <Field label="Practice name" required><input className="dh-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} placeholder="e.g. Rao & Associates" /></Field>
        <Field label="Your phone (optional)"><input className="dh-input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={30} /></Field>
        <button type="submit" className="dh-btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create my practice'}</button>
      </form>
    </div>
  );
}

function Blocked({ me, retry, senior }) {
  return (
    <div className="pr-center">
      <div className="dh-empty">
        <div className="ic"><PIcon name="shield" /></div>
        <h3>This network is not allowed</h3>
        <p>Your practice only allows access from approved addresses, and this one ({me.ip || 'unknown'}) is not on the list. Try from the office network, or ask your Senior Advocate to add this address.</p>
        <div className="row">
          <button type="button" className="dh-btn ghost" onClick={retry}>Check again</button>
          {senior ? <Link className="dh-btn primary" to="/practice/settings">Open settings</Link> : null}
        </div>
      </div>
    </div>
  );
}

const NAV = [
  { to: '/practice', end: true, label: 'Dashboard', icon: 'home' },
  { to: '/practice/cases', label: 'Cases', icon: 'briefcase' },
  { to: '/practice/hearings', label: 'Hearings', icon: 'scale' },
  { to: '/practice/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/practice/clients', label: 'Clients', icon: 'users' },
  { to: '/practice/rti', label: 'RTI', icon: 'clipboard' },
  { to: '/practice/reports', label: 'Reports', icon: 'chart' },
  { to: '/practice/team', label: 'Team', icon: 'user' },
  { to: '/practice/audit', label: 'Audit log', icon: 'history', senior: true },
  { to: '/practice/settings', label: 'Settings', icon: 'gear' },
];

function Shell({ me, blocked }) {
  const { perms } = usePractice();
  const nav = useNavigate();
  const loc = useLocation();
  const [newCase, setNewCase] = useState(false);
  const navRef = useRef(null);
  useEffect(() => {
    window.scrollTo?.(0, 0);
    // On a narrow screen the tab row scrolls sideways: keep the current section in view.
    const on = navRef.current?.querySelector('a.on');
    if (on && navRef.current) navRef.current.scrollLeft = Math.max(0, on.offsetLeft - 24);
  }, [loc.pathname]);
  const items = NAV.filter((n) => !n.senior || me.member.role === 'senior').filter((n) => !blocked || n.to === '/practice/settings');

  return (
    <div className="dh-page pr-page">
      <div className="pr-top">
        <div className="pr-brand"><span className="kick">Practice · {me.member.role_label}</span><h1>{me.firm.name}</h1></div>
        {!blocked ? <SearchBox /> : null}
        {!blocked ? <Bell /> : null}
        {!blocked && perms.create_case ? <button type="button" className="dh-btn primary" onClick={() => setNewCase(true)}><PIcon name="plus" />New case</button> : null}
      </div>
      <nav className="pr-nav" aria-label="Practice sections" ref={navRef}>
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'on' : '')}>
            <PIcon name={n.icon} />{n.label}
          </NavLink>
        ))}
      </nav>
      <Suspense fallback={<Loading />}>
        {blocked ? (
          <Routes>
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Blocked me={me} retry={() => window.location.reload()} senior={me.member.role === 'senior'} />} />
          </Routes>
        ) : (
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="cases" element={<Cases />} />
            <Route path="cases/:id" element={<CaseDetail />} />
            <Route path="hearings" element={<Hearings />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="clients" element={<Clients />} />
            <Route path="clients/:id" element={<Clients />} />
            <Route path="rti" element={<Rti />} />
            <Route path="reports" element={<Reports />} />
            <Route path="team" element={<Team />} />
            <Route path="audit" element={me.member.role === 'senior' ? <AuditPage /> : <Navigate to="/practice" replace />} />
            <Route path="settings" element={<Settings />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="*" element={<Navigate to="/practice" replace />} />
          </Routes>
        )}
      </Suspense>
      {newCase ? <CaseForm onClose={() => setNewCase(false)} onSaved={(c) => { setNewCase(false); nav(`/practice/cases/${c.id}`); }} /> : null}
    </div>
  );
}

export default function PracticeApp() {
  const toasts = useToasts();
  const meQ = useAsync((signal) => pr.get('/me', null, signal), []);
  const me = meQ.data;
  const [unread, setUnread] = useState(0);
  const membersQ = useAsync(async (signal) => (me?.member && !me.blocked ? (await pr.get('/members', null, signal)).members : []), [me?.member?.id, me?.blocked]);
  useEffect(() => { if (me && typeof me.unread === 'number') setUnread(me.unread); }, [me]);

  const ctx = useMemo(() => me && {
    me, perms: me.perms || {}, meta: me.meta, members: membersQ.data || [], reloadMembers: membersQ.reload, reloadMe: meQ.reload,
    toast: toasts.push, unread, setUnread,
  }, [me, membersQ.data, membersQ.reload, meQ.reload, toasts.push, unread]);

  if (!me) {
    return (
      <div className="dh-root pr-root"><div className="dh-page pr-page">
        {meQ.error ? <ErrorBox error={meQ.error} retry={meQ.reload} /> : <Loading label="Opening your practice…" />}
      </div></div>
    );
  }

  let body;
  if (!me.member) {
    body = <div className="dh-page pr-page"><Onboarding me={me} onDone={meQ.reload} /></div>;
  } else if (me.mfa?.pending) {
    body = (
      <div className="dh-page pr-page">
        <Suspense fallback={<Loading />}><MfaSetup forced onDone={meQ.reload} /></Suspense>
      </div>
    );
  } else {
    body = <Shell me={me} blocked={me.blocked === 'ip'} />;
  }
  return (
    <div className="dh-root pr-root">
      <PracticeContext.Provider value={ctx}>{body}</PracticeContext.Provider>
      <Toasts items={toasts.items} dismiss={toasts.dismiss} />
    </div>
  );
}

