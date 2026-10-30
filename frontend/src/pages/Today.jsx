import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const QUICK = [
  { Icon: Ic.Draft, label: 'Draft a document', to: '/draft' },
  { Icon: Ic.Research, label: 'Research the law', to: '/research' },
  { Icon: Ic.Contracts, label: 'Review a contract', to: '/contracts' },
  { Icon: Ic.Plus, label: 'Add a matter', to: '/matters?new=1' },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}
function shortDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
const toneFor = (du) => (du != null && du <= 2 ? 'risk' : du != null && du <= 7 ? 'warn' : 'muted');

const GUIDE_KEY = 'lex_first_run_done';

function ago(iso) {
  if (!iso) return '';
  const t = new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}

export default function Today() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [ask, setAsk] = useState('');
  const [cases, setCases] = useState([]);
  const [draftSessions, setDraftSessions] = useState([]);
  const [draftCount, setDraftCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [guideDone, setGuideDone] = useState(() => {
    try { return localStorage.getItem(GUIDE_KEY) === '1'; } catch { return false; }
  });
  const dismissGuide = () => {
    setGuideDone(true);
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch {}
  };
  const date = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const firstName = (user?.name || user?.full_name || '').trim().split(' ')[0] || 'Counsel';

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cRes, dRes] = await Promise.all([
          fetch(`${API_BASE}/api/practice/cases?per_page=100&sort=next_hearing`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { cases: [] })).catch(() => ({ cases: [] })),
          fetch(`${API_BASE}/api/drafts/sessions`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        if (!alive) return;
        setCases(Array.isArray(cRes.cases) ? cRes.cases : []);
        const sessions = dRes?.sessions || dRes?.items || (Array.isArray(dRes) ? dRes : []);
        const list = Array.isArray(sessions) ? sessions : [];
        setDraftCount(list.length);
        // Keep the 3 most recently updated drafts not yet marked done
        const resumable = list
          .filter((s) => s.status !== 'done')
          .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
          .slice(0, 3);
        setDraftSessions(resumable);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const open = cases.filter((c) => !c.closed);
  const withHearing = open.filter((c) => c.next_hearing && daysUntil(c.next_hearing) != null && daysUntil(c.next_hearing) >= 0)
    .sort((a, b) => String(a.next_hearing).localeCompare(String(b.next_hearing)));
  const hearingsToday = withHearing.filter((c) => daysUntil(c.next_hearing) === 0);
  const thisWeek = withHearing.filter((c) => daysUntil(c.next_hearing) <= 7);
  const upcoming = withHearing.slice(0, 4);

  const STATS = [
    { Icon: Ic.Gavel, num: hearingsToday.length, label: 'Hearings today', sub: 'Cause list' },
    { Icon: Ic.Clock, num: thisWeek.length, label: 'Hearings this week', sub: '7-day watch' },
    { Icon: Ic.Draft, num: draftCount == null ? '—' : draftCount, label: 'Drafts in progress', sub: 'Your sessions' },
    { Icon: Ic.Matters, num: open.length, label: 'Open matters', sub: 'On record' },
  ];

  const subline = loading ? 'Pulling your day together…'
    : `${hearingsToday.length} hearing${hearingsToday.length === 1 ? '' : 's'} today, ${thisWeek.length} this week and ${open.length} open matter${open.length === 1 ? '' : 's'}.`;

  return (
    <div className="lx-page lx-rise">
      <div className="ph">
        <span className="ph__eyebrow">{date}</span>
        <h1 className="ph__title">{greeting()}, {firstName}</h1>
        <p className="ph__sub">{subline}</p>
      </div>

      {/* Command bar */}
      <form className="lx-field" style={{ height: 62 }}
        onSubmit={(e) => { e.preventDefault(); navigate('/draft', { state: ask ? { prompt: ask } : undefined }); }}>
        <Ic.Sparkle size={18} />
        <input value={ask} onChange={(e) => setAsk(e.target.value)}
          placeholder="Ask Lexamplify, or begin a draft — “Draft a legal notice for recovery of dues”" />
        <button type="submit" className="lx-btn lx-btn--primary lx-btn--sm"><Ic.Arrow size={15} /> Begin</button>
      </form>

      {/* Stats */}
      <section className="lx-stats lx-mt-l">
        {STATS.map((s) => (
          <div className="lx-stat" key={s.label}>
            <div className="lx-stat__ico"><s.Icon size={18} /></div>
            <div className="lx-stat__num">{s.num}</div>
            <div className="lx-stat__label">{s.label}</div>
            <div className="lx-stat__sub">{s.sub}</div>
          </div>
        ))}
      </section>

      {/* First-run "How it works" guide — dismissable, remembered via localStorage */}
      {!guideDone && (
        <section className="lx-card lx-card--pad lx-mt-l" style={{ position: 'relative' }}>
          <div className="lx-section-head" style={{ marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 13, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>How it works</h3>
            <button
              type="button"
              onClick={dismissGuide}
              style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline', padding: 4 }}
            >
              Got it, hide this
            </button>
          </div>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 24, counterReset: 's' }}>
            {[
              { b: 'Pick a task', t: 'Draft, analyze, or check conflicts.' },
              { b: 'Add your case or file', t: 'Or type the details. Unknown facts stay blank, never guessed.' },
              { b: 'Review and download', t: 'Check the draft, then download Word or PDF.' },
            ].map((step, i) => (
              <li key={i} style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-soft)' }}>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 26, color: 'var(--accent-ink)', marginBottom: 4, lineHeight: 1 }}>
                  {String(i + 1).padStart(2, '0')}
                </div>
                <div style={{ color: 'var(--ink)', fontWeight: 600, marginBottom: 2 }}>{step.b}</div>
                <div>{step.t}</div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Body */}
      <div className="lx-dash-grid lx-mt-xl">
        <div className="lx-stack" style={{ gap: 34 }}>
          {/* Upcoming hearings */}
          <section>
            <div className="lx-section-head">
              <h3>Upcoming hearings</h3>
              <a onClick={() => navigate('/calendar')}>Full calendar →</a>
            </div>
            <div className="lx-card lx-card--pad">
              <div className="lx-list">
                {loading ? <div className="lx-empty"><p>Loading…</p></div>
                  : upcoming.length === 0 ? <div className="lx-empty"><p>No upcoming hearings on record.</p></div>
                  : upcoming.map((c) => {
                    const du = daysUntil(c.next_hearing);
                    return (
                      <div className="lx-item" key={c.id} onClick={() => navigate('/matters/' + c.id)}>
                        <div style={{ textAlign: 'center', width: 56, flexShrink: 0 }}>
                          <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{shortDate(c.next_hearing)}</div>
                          <div style={{ fontSize: 10, letterSpacing: '.06em', color: 'var(--muted)' }}>{du === 0 ? 'TODAY' : du === 1 ? 'TOMORROW' : `IN ${du}D`}</div>
                        </div>
                        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--rule)', margin: '2px 4px' }} />
                        <div className="lx-item__body">
                          <div className="lx-item__title">{c.title || 'Matter'}</div>
                          <div className="lx-item__meta">{[c.court, c.case_no].filter(Boolean).join(' · ') || '—'}</div>
                        </div>
                        <span className={`lx-badge lx-badge--${toneFor(du)}`}>{du === 0 ? 'Today' : `${du}d`}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </section>

          {/* Active matters */}
          <section>
            <div className="lx-section-head">
              <h3>Active matters</h3>
              <a onClick={() => navigate('/matters')}>All matters →</a>
            </div>
            <div className="lx-card lx-card--pad">
              <div className="lx-list">
                {loading ? <div className="lx-empty"><p>Loading…</p></div>
                  : open.length === 0 ? <div className="lx-empty"><p>No open matters yet. Add one from Matters.</p></div>
                  : open.slice(0, 5).map((c) => (
                    <div className="lx-item" key={c.id} onClick={() => navigate('/matters/' + c.id)}>
                      <div className="lx-item__ico"><Ic.Scale size={18} /></div>
                      <div className="lx-item__body">
                        <div className="lx-item__title">{c.title || 'Matter'}</div>
                        <div className="lx-item__meta">{[c.court, c.case_no].filter(Boolean).join(' · ') || '—'}</div>
                      </div>
                      <span className="lx-badge lx-badge--ok">{c.status || 'Active'}</span>
                    </div>
                  ))}
              </div>
            </div>
          </section>
        </div>

        {/* Rail */}
        <aside className="lx-stack" style={{ gap: 24 }}>
          {/* Continue where you left off — recent draft sessions, click to resume */}
          {draftSessions.length > 0 && (
            <section className="lx-card lx-card--pad">
              <div className="lx-section-head" style={{ marginBottom: 14 }}>
                <h3>Continue where you left off</h3>
                <a onClick={() => navigate('/draft')} style={{ cursor: 'pointer' }}>Studio →</a>
              </div>
              <div className="lx-list">
                {draftSessions.map((d) => (
                  <div
                    key={d.id}
                    className="lx-item"
                    style={{ padding: '12px 2px', cursor: 'pointer' }}
                    onClick={() => navigate('/draft/' + d.id)}
                  >
                    <div className="lx-item__ico" style={{ width: 34, height: 34 }}>
                      <Ic.Doc size={16} />
                    </div>
                    <div className="lx-item__body">
                      <div className="lx-item__title" style={{ fontSize: 14 }}>
                        {d.title || 'Untitled draft'}
                      </div>
                      <div className="lx-item__meta">{d.updated_at ? ago(d.updated_at) : 'Draft'}</div>
                    </div>
                    <Ic.Arrow size={14} />
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="lx-card lx-card--pad">
            <div className="lx-section-head" style={{ marginBottom: 16 }}><h3>Quick actions</h3></div>
            <div className="lx-stack" style={{ gap: 10 }}>
              {QUICK.map((q) => (
                <button key={q.label} className="lx-btn lx-btn--ghost" style={{ justifyContent: 'flex-start', width: '100%', height: 46 }} onClick={() => navigate(q.to)}>
                  <span style={{ color: 'var(--accent-ink)', display: 'grid', placeItems: 'center' }}><q.Icon size={17} /></span>
                  {q.label}
                </button>
              ))}
            </div>
          </section>

          <section className="lx-card lx-card--pad">
            <div className="lx-section-head" style={{ marginBottom: 14 }}>
              <h3>Deadlines</h3>
              {thisWeek.length > 0 && <span className="lx-badge lx-badge--risk">{thisWeek.length} near</span>}
            </div>
            <div className="lx-list">
              {loading ? <div className="lx-empty"><p>Loading…</p></div>
                : thisWeek.length === 0 ? <div className="lx-empty"><p>Nothing due in the next 7 days.</p></div>
                : thisWeek.slice(0, 6).map((c) => {
                  const du = daysUntil(c.next_hearing);
                  const tone = toneFor(du);
                  return (
                    <div className="lx-item" key={c.id} style={{ padding: '13px 2px' }} onClick={() => navigate('/matters/' + c.id)}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: tone === 'risk' ? 'var(--risk)' : tone === 'warn' ? 'var(--warn)' : 'var(--muted-2)' }} />
                      <div className="lx-item__title" style={{ flex: 1, fontSize: 13.5, fontFamily: 'var(--font-sans)', fontWeight: 500 }}>{c.title || 'Matter'}</div>
                      <span className="lx-muted" style={{ fontWeight: 600, color: tone === 'risk' ? 'var(--risk)' : 'var(--ink-soft)' }}>{du === 0 ? 'today' : `${du} day${du === 1 ? '' : 's'}`}</span>
                    </div>
                  );
                })}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
