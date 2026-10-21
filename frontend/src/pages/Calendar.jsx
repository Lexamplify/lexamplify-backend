import * as Ic from '../icons.jsx';

const DAYS = [
  {
    day: 'Today', date: 'Wed 22 Oct', items: [
      { time: '10:30', title: 'Mehta Industries v. Union of India', meta: 'Delhi HC · Court 12 · Arguments', tone: 'warn' },
      { time: '14:15', title: 'State v. R. Khanna', meta: 'Saket DC · Court 4 · Evidence', tone: 'muted' },
    ],
  },
  {
    day: 'Tomorrow', date: 'Thu 23 Oct', items: [
      { time: '11:00', title: 'Rao v. Sunrise Developers', meta: 'NCDRC · Final hearing', tone: 'ok' },
    ],
  },
  {
    day: 'Friday', date: 'Fri 24 Oct', items: [
      { time: '—', title: 'Written statement due — Verma Estate', meta: 'Filing deadline · limitation', tone: 'risk' },
      { time: '12:30', title: 'Verma Estate — Succession', meta: 'Saket DC · Probate hearing', tone: 'warn' },
    ],
  },
];

export default function Calendar() {
  return (
    <div className="lx-page lx-rise">
      <div className="lx-between ph" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 18 }}>
        <div>
          <span className="ph__eyebrow">This week</span>
          <h1 className="ph__title">Calendar</h1>
          <p className="ph__sub">Hearings, filings and limitation — synced live from eCourts.</p>
        </div>
        <div className="lx-row" style={{ gap: 10 }}>
          <span className="lx-badge lx-badge--ok"><span className="dot" /> Live sync</span>
          <button className="lx-btn lx-btn--ghost lx-btn--sm"><Ic.Plus size={14} /> Add event</button>
        </div>
      </div>

      <div className="lx-stack" style={{ gap: 18 }}>
        {DAYS.map((d) => (
          <div className="lx-card lx-card--pad" key={d.day}>
            <div className="lx-between" style={{ marginBottom: 12 }}>
              <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 18 }}>{d.day}</h3>
              <span className="lx-muted" style={{ letterSpacing: '.04em' }}>{d.date}</span>
            </div>
            <div className="lx-list">
              {d.items.map((it, i) => (
                <div className="lx-item" key={i}>
                  <div style={{ width: 52, textAlign: 'center', flexShrink: 0, fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 15, color: it.time === '—' ? 'var(--risk)' : 'var(--ink)' }}>{it.time}</div>
                  <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--rule)', margin: '2px 4px' }} />
                  <div className="lx-item__body">
                    <div className="lx-item__title">{it.title}</div>
                    <div className="lx-item__meta">{it.meta}</div>
                  </div>
                  <span className={`lx-badge lx-badge--${it.tone}`}>{it.tone === 'risk' ? 'Deadline' : it.tone === 'warn' ? 'Hearing' : 'Listed'}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
