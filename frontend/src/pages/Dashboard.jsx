import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const SESSION_EXPIRED = 'Your session has expired. Please sign in again.';

/* ── date helpers ─────────────────────────────────────────── */
function toDate(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function daysUntil(iso) {
  const d = toDate(iso);
  if (!d) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}
function shortDate(iso) {
  const d = toDate(iso);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—';
}
function ago(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days < 30 ? `${days}d ago` : shortDate(iso);
}
const toneFor = (du) => (du != null && du <= 2 ? 'risk' : du != null && du <= 7 ? 'warn' : 'muted');

/* Normalise the eCourts-synced tracked-case shape (/api/causelist/list)
   into one predictable row, since that payload is loosely typed. */
function normTracked(c) {
  const next = c.next_hearing || c.nextHearing || c.nextHearingDate || c.nextDate || c.next_date || null;
  return {
    id: c.id || c.caseId || c.cnr || c.cnr_number || c.case_no,
    title: c.title || c.caseTitle || c.case_title || c.name || 'Tracked matter',
    sub: c.court || c.courtName || c.cnr || c.cnr_number || '—',
    next,
  };
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [cases, setCases] = useState([]);
  const [tracked, setTracked] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // IP renewal alerts — dismissable once per day via localStorage
  const [expiringIp, setExpiringIp] = useState([]);
  const [ipAlertDismissed, setIpAlertDismissed] = useState(() => {
    try { return localStorage.getItem('ip_alert_dismissed_date') === new Date().toDateString(); }
    catch { return false; }
  });
  const dismissIpAlert = () => {
    try { localStorage.setItem('ip_alert_dismissed_date', new Date().toDateString()); } catch {}
    setIpAlertDismissed(true);
  };

  const firstName = (user?.name || user?.full_name || '').trim().split(' ')[0] || 'Counsel';
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const get = async (path) => {
          const r = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
          if (r.status === 401) { const e = new Error(SESSION_EXPIRED); e.auth = true; throw e; }
          if (!r.ok) return null;
          return r.json().catch(() => null);
        };
        const [cRes, tRes, dRes, ipRes] = await Promise.all([
          get('/api/practice/cases?per_page=100&sort=next_hearing'),
          get('/api/causelist/list').catch((e) => { if (e.auth) throw e; return null; }),
          get('/api/drafts/sessions').catch((e) => { if (e.auth) throw e; return null; }),
          get('/api/ip/expiring').catch((e) => { if (e.auth) throw e; return null; }),
        ]);
        if (!alive) return;
        setCases(Array.isArray(cRes?.cases) ? cRes.cases : []);
        const tList = Array.isArray(tRes) ? tRes : tRes?.cases || tRes?.items || [];
        setTracked(tList.map(normTracked));
        const sList = dRes?.sessions || dRes?.items || (Array.isArray(dRes) ? dRes : []);
        setSessions(Array.isArray(sList) ? sList : []);
        setExpiringIp(Array.isArray(ipRes) ? ipRes : []);
      } catch (e) {
        if (alive) setError(e.auth ? SESSION_EXPIRED : 'We could not load your chambers just now. Please try again.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  /* ── derived analytics ─────────────────────────────────── */
  const open = useMemo(() => cases.filter((c) => !c.closed), [cases]);

  const hearings = useMemo(() =>
    open
      .filter((c) => c.next_hearing && daysUntil(c.next_hearing) != null && daysUntil(c.next_hearing) >= 0)
      .sort((a, b) => String(a.next_hearing).localeCompare(String(b.next_hearing))),
    [open]);
  const thisWeek = useMemo(() => hearings.filter((c) => daysUntil(c.next_hearing) <= 7), [hearings]);

  const draftsInProgress = useMemo(
    () => sessions.filter((s) => s.status !== 'done').length,
    [sessions]);

  const trackedDeadlines = useMemo(
    () => tracked
      .filter((t) => t.next && daysUntil(t.next) != null && daysUntil(t.next) >= 0)
      .sort((a, b) => String(a.next).localeCompare(String(b.next))),
    [tracked]);

  /* Caseload mix by matter type — an original at-a-glance breakdown. */
  const caseload = useMemo(() => {
    const by = new Map();
    open.forEach((c) => {
      const k = (c.case_type || 'Other').trim() || 'Other';
      by.set(k, (by.get(k) || 0) + 1);
    });
    const rows = [...by.entries()].map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
    const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
    return { rows: rows.slice(0, 6), max };
  }, [open]);

  const recentDrafts = useMemo(() =>
    [...sessions]
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
      .slice(0, 5),
    [sessions]);

  // Timeline strip buckets — hearings bucketed by date window
  const timelineBuckets = useMemo(() => {
    const today = hearings.filter((c) => daysUntil(c.next_hearing) === 0);
    const tomorrow = hearings.filter((c) => daysUntil(c.next_hearing) === 1);
    const week = hearings.filter((c) => {
      const d = daysUntil(c.next_hearing);
      return d >= 2 && d <= 7;
    });
    const nextWeek = hearings.filter((c) => {
      const d = daysUntil(c.next_hearing);
      return d >= 8 && d <= 14;
    });
    return [
      { key: 'today',     label: 'Today',     cases: today,    tone: today.length > 0 ? 'risk' : 'muted' },
      { key: 'tomorrow',  label: 'Tomorrow',  cases: tomorrow, tone: tomorrow.length > 0 ? 'warn' : 'muted' },
      { key: 'thisweek',  label: 'This week', cases: week,     tone: 'ok' },
      { key: 'nextweek',  label: 'Next week', cases: nextWeek, tone: 'muted' },
    ];
  }, [hearings]);

  // Clickable stat cards — Icon + num + label + sub + a destination
  const STATS = [
    { Icon: Ic.Scale, num: open.length,                               label: 'Open matters',       sub: 'On record',             to: '/matters' },
    { Icon: Ic.Gavel, num: thisWeek.length,                           label: 'Hearings this week', sub: 'Next 7 days',           to: '/calendar' },
    { Icon: Ic.Draft, num: loading ? '—' : draftsInProgress,          label: 'Drafts in progress', sub: 'Awaiting finalisation', to: '/draft' },
    { Icon: Ic.Bell,  num: trackedDeadlines.length,                   label: 'Tracked deadlines',  sub: 'eCourts watch',         to: '/calendar' },
  ];

  // "As of" timestamp — refreshed each render; snapshotted on first load
  const asOf = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  const subline = loading
    ? 'Gathering your chambers…'
    : error
      ? 'A quiet moment — your chambers will be back shortly.'
      : `${open.length} open matter${open.length === 1 ? '' : 's'}, ${thisWeek.length} hearing${thisWeek.length === 1 ? '' : 's'} this week, and ${draftsInProgress} draft${draftsInProgress === 1 ? '' : 's'} in hand.`;

  return (
    <div className="lx-page lx-rise">
      <div className="lx-between ph" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 18 }}>
        <div>
          <span className="ph__eyebrow">
            {today}
            {!loading && !error && (
              <span style={{ marginLeft: 10, color: 'var(--muted)', textTransform: 'none', letterSpacing: 'normal', fontSize: 11 }}>
                · As of {asOf}
              </span>
            )}
          </span>
          <h1 className="ph__title">{greeting()}, {firstName}</h1>
          <p className="ph__sub">{subline}</p>
        </div>
        <div className="lx-row" style={{ gap: 12 }}>
          <button className="lx-btn lx-btn--ghost" onClick={() => navigate('/calendar')}><Ic.Clock size={16} /> This week</button>
          <button className="lx-btn lx-btn--gold" onClick={() => navigate('/draft')}><Ic.Plus size={15} /> New draft</button>
        </div>
      </div>

      {error && (
        <div className="lx-card lx-card--pad lx-mt-l" role="alert">
          <div className="lx-empty">
            <div className="lx-empty__ico"><Ic.Shield size={22} /></div>
            <h4>{error === SESSION_EXPIRED ? 'Session expired' : 'Couldn’t load your dashboard'}</h4>
            <p>{error}</p>
            {error === SESSION_EXPIRED
              ? <button className="lx-btn lx-btn--primary" style={{ marginTop: 10 }} onClick={() => navigate('/login')}>Sign in</button>
              : <button className="lx-btn lx-btn--sm" style={{ marginTop: 10 }} onClick={() => window.location.reload()}>Try again</button>}
          </div>
        </div>
      )}

      {!error && (
        <>
          {/* IP Renewal Alert — amber warning card, dismissable once per day */}
          {!ipAlertDismissed && expiringIp.length > 0 && (
            <section className="lx-card lx-card--pad lx-mt-l" style={{ borderLeft: '3px solid var(--warn, #f59e0b)', background: 'var(--paper-2)' }}>
              <div className="lx-between" style={{ alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div className="lx-row" style={{ gap: 10, marginBottom: 8, alignItems: 'center' }}>
                    <Ic.Bell size={18} />
                    <h3 style={{ margin: 0, fontSize: 15, fontFamily: 'var(--font-serif)' }}>
                      {expiringIp.length} IP asset{expiringIp.length === 1 ? '' : 's'} expiring soon
                    </h3>
                  </div>
                  <div className="lx-stack" style={{ gap: 8, marginTop: 10 }}>
                    {expiringIp.slice(0, 5).map((a) => {
                      const d = a.days_left;
                      const color = d <= 2 ? '#ef4444' : d <= 5 ? '#f97316' : d <= 10 ? '#f59e0b' : d <= 15 ? '#eab308' : '#84cc16';
                      return (
                        <div className="lx-row" key={a.id} style={{ gap: 10, fontSize: 13 }}>
                          <span style={{ color, fontWeight: 700, minWidth: 68 }}>
                            {d < 0 ? 'EXPIRED' : d === 0 ? 'TODAY' : `${d} day${d === 1 ? '' : 's'}`}
                          </span>
                          <span style={{ color: 'var(--ink-soft)', flex: 1 }}>
                            {a.title || 'Untitled'} <span style={{ color: 'var(--muted)' }}>· {a.ip_type || 'IP'}</span>
                          </span>
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>due {a.renewal_due}</span>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    className="lx-btn lx-btn--ghost lx-btn--sm"
                    style={{ marginTop: 12 }}
                    onClick={() => navigate('/court-resources')}
                  >
                    Manage in IP Tracker →
                  </button>
                </div>
                <button
                  type="button"
                  onClick={dismissIpAlert}
                  aria-label="Dismiss for today"
                  title="Dismiss for today"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, borderRadius: 4, lineHeight: 0 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </section>
          )}

          {/* ── Timeline strip — Today / Tomorrow / This week / Next week ─────── */}
          <section className="lx-card lx-card--pad lx-mt-l">
            <div className="lx-between" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontFamily: 'var(--font-serif)' }}>What's coming up</h3>
              <a onClick={() => navigate('/calendar')} style={{ cursor: 'pointer', fontSize: 13 }}>Full calendar →</a>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
              {timelineBuckets.map((b) => {
                const n = b.cases.length;
                const colorMap = {
                  risk:  { bg: 'rgba(239, 68, 68, 0.08)',   fg: '#ef4444', border: 'rgba(239,68,68,.3)' },
                  warn:  { bg: 'rgba(245, 158, 11, 0.08)',  fg: '#f59e0b', border: 'rgba(245,158,11,.3)' },
                  ok:    { bg: 'rgba(16, 185, 129, 0.06)',  fg: 'var(--accent-ink, #0b7a60)', border: 'rgba(16,185,129,.25)' },
                  muted: { bg: 'var(--paper-2, var(--bg-card))', fg: 'var(--muted)', border: 'var(--rule)' },
                };
                const c = colorMap[b.tone] || colorMap.muted;
                return (
                  <div
                    key={b.key}
                    onClick={() => navigate('/calendar')}
                    style={{
                      padding: '14px 16px',
                      borderRadius: 10,
                      background: c.bg,
                      border: `1px solid ${c.border}`,
                      cursor: 'pointer',
                      transition: 'transform .15s ease, box-shadow .15s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
                  >
                    <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
                      {b.label}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 600, color: c.fg, lineHeight: 1 }}>{n}</span>
                      <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{n === 1 ? 'hearing' : 'hearings'}</span>
                    </div>
                    {n > 0 && b.cases.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.cases[0].title}{n > 1 ? ` + ${n - 1} more` : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Stats (clickable) ──────────────────────────────────────────────── */}
          <section className="lx-stats lx-mt-l">
            {STATS.map((s) => (
              <div
                className="lx-stat"
                key={s.label}
                onClick={() => s.to && navigate(s.to)}
                style={{ cursor: s.to ? 'pointer' : 'default', transition: 'transform .15s ease' }}
                onMouseEnter={(e) => { if (s.to) e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
              >
                <div className="lx-stat__ico"><s.Icon size={18} /></div>
                <div className="lx-stat__num">{s.num}</div>
                <div className="lx-stat__label">{s.label}</div>
                <div className="lx-stat__sub">{s.sub}</div>
              </div>
            ))}
          </section>

          <div className="lx-dash-grid lx-mt-xl">
            {/* Main column */}
            <div className="lx-stack" style={{ gap: 34 }}>
              {/* ── Needs attention now — curated urgent items across the chambers ── */}
              <section>
                <div className="lx-section-head">
                  <h3>Needs attention now</h3>
                  <a onClick={() => navigate('/matters')} style={{ cursor: 'pointer' }}>All matters →</a>
                </div>
                <div className="lx-card lx-card--pad">
                  {loading ? (
                    <div className="lx-empty"><p>Reviewing your chambers…</p></div>
                  ) : (() => {
                      // Build a prioritised list: hearings today/tomorrow, deadlines within 3 days, expiring IP
                      const urgent = [];
                      hearings.filter((c) => daysUntil(c.next_hearing) <= 2).forEach((c) => {
                        const du = daysUntil(c.next_hearing);
                        urgent.push({
                          id: `h-${c.id}`, kind: 'hearing', priority: du,
                          when: du === 0 ? 'Today' : du === 1 ? 'Tomorrow' : `In ${du} days`,
                          title: c.title || 'Hearing',
                          meta: [c.court, c.case_no].filter(Boolean).join(' · ') || '—',
                          tone: du === 0 ? 'risk' : 'warn',
                          onClick: () => navigate('/matters/' + c.id),
                          Icon: Ic.Gavel,
                        });
                      });
                      expiringIp.slice(0, 3).forEach((a) => {
                        if (a.days_left > 7) return;  // only truly urgent ones here
                        urgent.push({
                          id: `ip-${a.id}`, kind: 'ip', priority: 10 + a.days_left,
                          when: a.days_left <= 0 ? 'EXPIRED' : `${a.days_left}d left`,
                          title: `${a.title || 'IP asset'} renewal`,
                          meta: `${a.ip_type || 'IP'} · due ${a.renewal_due}`,
                          tone: a.days_left <= 2 ? 'risk' : 'warn',
                          onClick: () => navigate('/court-resources'),
                          Icon: Ic.Shield,
                        });
                      });
                      urgent.sort((a, b) => a.priority - b.priority);

                      if (urgent.length === 0) {
                        return (
                          <div className="lx-empty">
                            <div className="lx-empty__ico"><Ic.Check size={22} /></div>
                            <h4>Nothing urgent — chambers are calm</h4>
                            <p>No hearings in the next 48 hours. No deadlines expiring this week.</p>
                          </div>
                        );
                      }

                      return (
                        <div className="lx-list">
                          {urgent.slice(0, 6).map((u) => {
                            const toneColor = u.tone === 'risk' ? 'var(--risk, #ef4444)' : u.tone === 'warn' ? '#f59e0b' : 'var(--muted)';
                            return (
                              <div className="lx-item" key={u.id} onClick={u.onClick} style={{ cursor: 'pointer' }}>
                                <div style={{ width: 70, textAlign: 'center', flexShrink: 0 }}>
                                  <div style={{ fontSize: 10, letterSpacing: '.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
                                    {u.kind}
                                  </div>
                                  <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: 13, color: toneColor, marginTop: 2 }}>
                                    {u.when}
                                  </div>
                                </div>
                                <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--rule)', margin: '2px 2px' }} />
                                <div className="lx-item__ico"><u.Icon size={16} /></div>
                                <div className="lx-item__body">
                                  <div className="lx-item__title">{u.title}</div>
                                  <div className="lx-item__meta">{u.meta}</div>
                                </div>
                                <span className={`lx-badge lx-badge--${u.tone}`}>{u.when}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                </div>
              </section>

              {/* Caseload at a glance — only shown when there's actually a mix to compare (>= 2 case types) */}
              {!loading && open.length > 0 && caseload.rows.length >= 2 && (
                <section>
                  <div className="lx-section-head">
                    <h3>Caseload at a glance</h3>
                    <a onClick={() => navigate('/matters')} style={{ cursor: 'pointer' }}>Open matters →</a>
                  </div>
                  <div className="lx-card lx-card--pad">
                    <div className="lx-stack" style={{ gap: 16 }}>
                      {caseload.rows.map((r) => {
                        const pct = Math.round((r.count / caseload.max) * 100);
                        return (
                          <div key={r.label}>
                            <div className="lx-between" style={{ marginBottom: 7 }}>
                              <span style={{ fontSize: 13.5, color: 'var(--ink-soft)', fontWeight: 500 }}>{r.label}</span>
                              <span style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{r.count}</span>
                            </div>
                            <div style={{ height: 7, borderRadius: 99, background: 'var(--rule)', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: 'var(--accent-ink)', transition: 'width .5s ease' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>
              )}

              {/* Empty-state helper when there are no open matters yet */}
              {!loading && open.length === 0 && (
                <section>
                  <div className="lx-card lx-card--pad">
                    <div className="lx-empty">
                      <div className="lx-empty__ico"><Ic.Scale size={22} /></div>
                      <h4>No open matters yet</h4>
                      <p>Add a matter and your practice mix will chart itself here.</p>
                      <button className="lx-btn lx-btn--primary" style={{ marginTop: 12 }} onClick={() => navigate('/matters?new=1')}>
                        <Ic.Plus size={15} /> Add a matter
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {/* ── Firm pulse — moved from the rail to the main column so both columns balance ── */}
              <section>
                <div className="lx-section-head">
                  <h3>Firm pulse</h3>
                </div>
                <div className="lx-card lx-card--pad" style={{ background: 'linear-gradient(135deg, var(--paper-2, var(--bg-card)) 0%, var(--paper) 100%)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '18px 32px' }}>
                    <div>
                      <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>Active cases</div>
                      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 600, color: 'var(--ink)', lineHeight: 1 }}>{open.length}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>Open drafts</div>
                      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 600, color: 'var(--ink)', lineHeight: 1 }}>{loading ? '—' : draftsInProgress}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>Hearings next 7 days</div>
                      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 600, color: thisWeek.length > 0 ? 'var(--accent-ink, #0b7a60)' : 'var(--muted)', lineHeight: 1 }}>{thisWeek.length}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>Expiring IP (30d)</div>
                      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 600, color: expiringIp.length > 0 ? '#f59e0b' : 'var(--muted)', lineHeight: 1 }}>{expiringIp.length}</div>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {/* Rail — now just Recent drafts (shorter, balanced with left column) */}
            <aside className="lx-stack" style={{ gap: 24 }}>
              <section className="lx-card lx-card--pad">
                <div className="lx-section-head" style={{ marginBottom: 14 }}>
                  <h3>Recent drafts</h3>
                  <a onClick={() => navigate('/draft')} style={{ cursor: 'pointer' }}>Studio →</a>
                </div>
                <div className="lx-list">
                  {loading ? (
                    <div className="lx-empty"><p>Loading…</p></div>
                  ) : recentDrafts.length === 0 ? (
                    <div className="lx-empty" style={{ padding: '22px 8px' }}>
                      <div className="lx-empty__ico" style={{ width: 44, height: 44 }}><Ic.Draft size={20} /></div>
                      <p style={{ marginBottom: 12 }}>No drafts yet. Begin one in the studio.</p>
                      <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => navigate('/draft')}>Start a draft</button>
                    </div>
                  ) : recentDrafts.map((s) => (
                    <div className="lx-item" key={s.id} style={{ padding: '13px 2px', cursor: 'pointer' }} onClick={() => navigate('/draft/' + s.id)}>
                      <div className="lx-item__ico" style={{ width: 34, height: 34 }}><Ic.Doc size={16} /></div>
                      <div className="lx-item__body">
                        <div className="lx-item__title" style={{ fontSize: 14 }}>{s.title || 'Untitled draft'}</div>
                        <div className="lx-item__meta">{s.updated_at ? `Edited ${ago(s.updated_at)}` : (s.type || 'Draft')}</div>
                      </div>
                      <span className={`lx-badge lx-badge--${s.status === 'done' ? 'ok' : 'warn'}`}>
                        {s.status === 'done' ? 'Final' : 'Draft'}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
