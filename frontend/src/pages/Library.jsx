import * as Ic from '../icons.jsx';

const CATS = [
  { name: 'Notices & demands', count: 24, Icon: Ic.Doc },
  { name: 'Petitions & pleadings', count: 38, Icon: Ic.Gavel },
  { name: 'Agreements & contracts', count: 52, Icon: Ic.Contracts },
  { name: 'Bail & criminal', count: 19, Icon: Ic.Shield },
  { name: 'Property & conveyancing', count: 31, Icon: Ic.Matters },
  { name: 'Corporate & advisory', count: 27, Icon: Ic.Users },
];

const RECENT = ['Legal notice — recovery of dues', 'Mutual non-disclosure agreement', 'Anticipatory bail application (438 CrPC)', 'Leave & licence agreement'];

export default function Library() {
  return (
    <div className="lx-page lx-rise">
      <div className="lx-between ph" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 18 }}>
        <div>
          <span className="ph__eyebrow">Firm knowledge</span>
          <h1 className="ph__title">Library</h1>
          <p className="ph__sub">Vetted templates and your chambers&apos; own precedents — ready to draft from.</p>
        </div>
        <div className="lx-field" style={{ height: 42, maxWidth: 260 }}>
          <Ic.Search size={15} />
          <input placeholder="Search templates…" style={{ fontSize: 14 }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 18 }}>
        {CATS.map((c) => (
          <div className="lx-card lx-card--pad lx-card--hover" key={c.name} style={{ cursor: 'pointer' }}>
            <div className="lx-between" style={{ alignItems: 'flex-start' }}>
              <div className="lx-stat__ico" style={{ margin: 0 }}><c.Icon size={18} /></div>
              <Ic.Arrow size={16} />
            </div>
            <div className="lx-title lx-mt-m" style={{ fontSize: 17 }}>{c.name}</div>
            <div className="lx-muted" style={{ marginTop: 4 }}>{c.count} templates</div>
          </div>
        ))}
      </div>

      <div className="lx-section-head lx-mt-xl"><h3>Recently used</h3><a>View all →</a></div>
      <div className="lx-card lx-card--pad">
        <div className="lx-list">
          {RECENT.map((r, i) => (
            <div className="lx-item" key={i}>
              <div className="lx-item__ico" style={{ width: 34, height: 34 }}><Ic.Doc size={15} /></div>
              <div className="lx-item__title" style={{ flex: 1, fontSize: 15 }}>{r}</div>
              <button className="lx-btn lx-btn--ghost lx-btn--sm">Use</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
