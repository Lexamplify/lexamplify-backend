import * as Ic from '../icons.jsx';

const CLAUSES = [
  { clause: 'Limitation of liability', note: 'Cap set at 1× fees — below market for this value. Consider 2×.', level: 'Review', tone: 'warn' },
  { clause: 'Indemnification', note: 'Mutual and appropriately scoped to third-party IP claims.', level: 'Standard', tone: 'ok' },
  { clause: 'Termination for convenience', note: 'Counterparty may exit on 30 days — no exit fee. High exposure.', level: 'High risk', tone: 'risk' },
  { clause: 'Governing law & venue', note: 'Courts at New Delhi — consistent with client preference.', level: 'Standard', tone: 'ok' },
  { clause: 'Confidentiality survival', note: 'Survives 3 years post-termination — market standard.', level: 'Standard', tone: 'ok' },
];

export default function Contracts() {
  return (
    <div className="lx-page lx-rise">
      <div className="lx-between ph" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 18 }}>
        <div>
          <span className="ph__eyebrow">Contract review</span>
          <h1 className="ph__title">Contracts</h1>
          <p className="ph__sub">Clauses read, risks surfaced and terms benchmarked against the market — in minutes.</p>
        </div>
        <button className="lx-btn lx-btn--gold"><Ic.Upload size={15} /> Upload contract</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 0.9fr)', gap: 24, alignItems: 'start' }} className="draft-grid">
        <div className="lx-card lx-card--pad">
          <div className="lx-between" style={{ marginBottom: 18 }}>
            <div>
              <div className="lx-title" style={{ fontSize: 17 }}>Master Services Agreement</div>
              <div className="lx-muted">Horizon Tech Pvt. Ltd. · 24 pages · reviewed just now</div>
            </div>
            <span className="lx-badge lx-badge--warn">1 high risk</span>
          </div>
          <div className="lx-list">
            {CLAUSES.map((c, i) => (
              <div className="lx-item" key={i} style={{ alignItems: 'flex-start', padding: '16px 4px' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: c.tone === 'risk' ? 'var(--risk)' : c.tone === 'warn' ? 'var(--warn)' : 'var(--ok)' }} />
                <div className="lx-item__body">
                  <div className="lx-between" style={{ alignItems: 'baseline', gap: 10 }}>
                    <div className="lx-item__title" style={{ fontSize: 15 }}>{c.clause}</div>
                    <span className={`lx-badge lx-badge--${c.tone}`} style={{ flexShrink: 0 }}>{c.level}</span>
                  </div>
                  <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.6, marginTop: 4 }}>{c.note}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="lx-stack" style={{ gap: 24 }}>
          <div className="lx-card lx-card--pad" style={{ textAlign: 'center' }}>
            <div className="lx-stat__num" style={{ fontSize: 52 }}>72<span style={{ fontSize: 24, color: 'var(--muted)' }}>/100</span></div>
            <div className="lx-stat__label lx-mt-m">Overall risk posture</div>
            <div className="lx-stat__sub">Moderate — 1 clause needs attention</div>
            <hr className="lx-rule" style={{ margin: '20px 0' }} />
            <button className="lx-btn lx-btn--primary" style={{ width: '100%' }}><Ic.Sparkle size={15} /> Suggest redlines</button>
          </div>
          <div className="lx-card lx-card--pad">
            <div className="lx-section-head" style={{ marginBottom: 12 }}><h3>Benchmark</h3></div>
            <p className="lx-muted" style={{ lineHeight: 1.6 }}>Terms compared against 4,200 commercial agreements in the firm library. 3 of 5 key clauses sit at or above market.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
