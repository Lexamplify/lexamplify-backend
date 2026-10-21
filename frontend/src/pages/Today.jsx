import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';

const STATS = [
  { Icon: Ic.Gavel, num: '2', label: 'Hearings today', sub: 'Cause list' },
  { Icon: Ic.Clock, num: '3', label: 'Limitation this week', sub: '7-day watch' },
  { Icon: Ic.Draft, num: '5', label: 'Drafts in review', sub: 'Awaiting sign-off' },
  { Icon: Ic.Matters, num: '18', label: 'Open matters', sub: 'On record' },
];

const CAUSE_LIST = [
  { time: '10:30', court: 'Delhi High Court · Court 12', matter: 'Mehta Industries v. Union of India', tag: 'Arguments', tone: 'warn' },
  { time: '02:15', court: 'Saket District Court · Court 4', matter: 'State v. R. Khanna', tag: 'Evidence', tone: 'muted' },
];

const MATTERS = [
  { title: 'Mehta Industries v. Union of India', court: 'Delhi HC · W.P. 8842/2025', status: 'Active', tone: 'ok' },
  { title: 'Verma Estate — Succession', court: 'Saket DC · Probate 231/2024', status: 'Hearing soon', tone: 'warn' },
  { title: 'Horizon Tech — NDA review', court: 'Advisory · Corporate', status: 'Drafting', tone: 'muted' },
  { title: 'Khanna Bail Application', court: 'Delhi HC · Bail 5521/2025', status: 'Filed', tone: 'ok' },
];

const DEADLINES = [
  { label: 'Written statement — Verma Estate', days: '2 days', tone: 'risk' },
  { label: 'Rejoinder — Mehta Industries', days: '5 days', tone: 'warn' },
  { label: 'Appeal limitation — Khanna', days: '11 days', tone: 'muted' },
];

const QUICK = [
  { Icon: Ic.Draft, label: 'Draft a document', to: '/draft' },
  { Icon: Ic.Research, label: 'Research the law', to: '/research' },
  { Icon: Ic.Contracts, label: 'Review a contract', to: '/contracts' },
  { Icon: Ic.Plus, label: 'Add a matter', to: '/matters' },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Today() {
  const navigate = useNavigate();
  const [ask, setAsk] = useState('');
  const date = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="lx-page lx-rise">
      <div className="ph">
        <span className="ph__eyebrow">{date}</span>
        <h1 className="ph__title">{greeting()}, Aarav</h1>
        <p className="ph__sub">Two hearings, three limitation deadlines and five drafts need you today.</p>
      </div>

      {/* Command bar */}
      <form
        className="lx-field"
        style={{ height: 62 }}
        onSubmit={(e) => { e.preventDefault(); navigate('/draft'); }}
      >
        <Ic.Sparkle size={18} />
        <input
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          placeholder="Ask Lexamplify, or begin a draft — “Draft a legal notice for recovery of dues”"
        />
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

      {/* Body */}
      <div className="lx-dash-grid lx-mt-xl">
        <div className="lx-stack" style={{ gap: 34 }}>
          {/* Cause list */}
          <section>
            <div className="lx-section-head">
              <h3>Today&apos;s cause list</h3>
              <a onClick={() => navigate('/calendar')}>Full calendar →</a>
            </div>
            <div className="lx-card lx-card--pad">
              <div className="lx-list">
                {CAUSE_LIST.map((h, i) => (
                  <div className="lx-item" key={i} onClick={() => navigate('/matters')}>
                    <div style={{ textAlign: 'center', width: 54, flexShrink: 0 }}>
                      <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 17, color: 'var(--ink)' }}>{h.time}</div>
                      <div style={{ fontSize: 10, letterSpacing: '.08em', color: 'var(--muted)' }}>PM</div>
                    </div>
                    <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--rule)', margin: '2px 4px' }} />
                    <div className="lx-item__body">
                      <div className="lx-item__title">{h.matter}</div>
                      <div className="lx-item__meta">{h.court}</div>
                    </div>
                    <span className={`lx-badge lx-badge--${h.tone}`}>{h.tag}</span>
                  </div>
                ))}
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
                {MATTERS.map((m, i) => (
                  <div className="lx-item" key={i} onClick={() => navigate('/matters')}>
                    <div className="lx-item__ico"><Ic.Scale size={18} /></div>
                    <div className="lx-item__body">
                      <div className="lx-item__title">{m.title}</div>
                      <div className="lx-item__meta">{m.court}</div>
                    </div>
                    <span className={`lx-badge lx-badge--${m.tone}`}>{m.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* Rail */}
        <aside className="lx-stack" style={{ gap: 24 }}>
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
              <span className="lx-badge lx-badge--risk">3 near</span>
            </div>
            <div className="lx-list">
              {DEADLINES.map((d, i) => (
                <div className="lx-item" key={i} style={{ padding: '13px 2px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: d.tone === 'risk' ? 'var(--risk)' : d.tone === 'warn' ? 'var(--warn)' : 'var(--muted-2)' }} />
                  <div className="lx-item__title" style={{ flex: 1, fontSize: 13.5, fontFamily: 'var(--font-sans)', fontWeight: 500 }}>{d.label}</div>
                  <span className="lx-muted" style={{ fontWeight: 600, color: d.tone === 'risk' ? 'var(--risk)' : 'var(--ink-soft)' }}>{d.days}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
