import { useState } from 'react';
import * as Ic from '../icons.jsx';

const RESULTS = [
  { name: 'Kesavananda Bharati v. State of Kerala', meta: 'Supreme Court · (1973) 4 SCC 225', match: 98, hold: 'Established the basic structure doctrine — Parliament cannot amend the Constitution so as to alter its essential framework.' },
  { name: 'Minerva Mills Ltd. v. Union of India', meta: 'Supreme Court · (1980) 3 SCC 625', match: 95, hold: 'Struck down clauses of the 42nd Amendment; reaffirmed limited amending power and judicial review as basic features.' },
  { name: 'I.R. Coelho v. State of Tamil Nadu', meta: 'Supreme Court · (2007) 2 SCC 1', match: 92, hold: 'Laws placed in the Ninth Schedule after 1973 are open to basic-structure review.' },
];

export default function Research() {
  const [q, setQ] = useState('Precedents on the basic structure doctrine');
  const [done, setDone] = useState(true);

  return (
    <div className="lx-page lx-rise">
      <div className="ph">
        <span className="ph__eyebrow">Legal research</span>
        <h1 className="ph__title">Research</h1>
        <p className="ph__sub">Ask in plain language. Every answer is grounded in verifiable authority — search 50M+ judgments, statutes and rules.</p>
      </div>

      <form className="lx-field" style={{ height: 60 }} onSubmit={(e) => { e.preventDefault(); setDone(true); }}>
        <Ic.Search size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question of law…" />
        <button type="submit" className="lx-btn lx-btn--primary lx-btn--sm"><Ic.Sparkle size={15} /> Research</button>
      </form>

      {done && (
        <div className="lx-mt-l lx-stack" style={{ gap: 22 }}>
          {/* Synthesised answer */}
          <div className="lx-card lx-card--pad" style={{ borderColor: 'var(--accent)', background: 'linear-gradient(180deg, var(--accent-soft), var(--paper))' }}>
            <div className="lx-row" style={{ gap: 8, marginBottom: 12 }}>
              <span className="lx-badge"><Ic.Sparkle size={13} /> Synthesis</span>
              <span className="lx-muted">Grounded in 3 authorities</span>
            </div>
            <p style={{ fontFamily: 'var(--font-serif)', fontSize: 18, lineHeight: 1.6, color: 'var(--ink)' }}>
              The basic structure doctrine holds that Parliament&apos;s amending power under Article 368 does not extend to
              altering the essential framework of the Constitution. First laid down in <i>Kesavananda Bharati</i> (1973) and
              reaffirmed in <i>Minerva Mills</i> (1980), it remains the bedrock of judicial review.
            </p>
          </div>

          <div className="lx-section-head"><h3>Authorities</h3><a>Export list →</a></div>
          <div className="lx-card lx-card--pad">
            <div className="lx-list">
              {RESULTS.map((r, i) => (
                <div className="lx-item" key={i} style={{ alignItems: 'flex-start', padding: '18px 4px' }}>
                  <div className="lx-item__ico" style={{ marginTop: 2 }}><Ic.Scale size={18} /></div>
                  <div className="lx-item__body">
                    <div className="lx-between" style={{ gap: 12, alignItems: 'baseline' }}>
                      <div className="lx-item__title" style={{ whiteSpace: 'normal' }}>{r.name}</div>
                      <span className="lx-badge" style={{ flexShrink: 0 }}>{r.match}% match</span>
                    </div>
                    <div className="lx-item__meta" style={{ marginBottom: 6 }}>{r.meta}</div>
                    <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.6 }}>{r.hold}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
