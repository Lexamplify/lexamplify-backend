import { useEffect, useState } from 'react';

/*
 * HeroPreview — the animated device-mock that sits beside the hero headline.
 * Cycles through 4 feature micro-animations so a visitor sees the product
 * move in the first 10 seconds. Each slide reuses the same visual language
 * as the main FeatureShowcase section, so it feels unified.
 *
 * When a real product video exists, swap this component's inner content for
 * a <video> element — the device chrome stays the same.
 */

const SLIDES = [
  { k: 'contract', t: 'Contract Analyzer', hint: 'Scanning for risks' },
  { k: 'courtroom', t: 'Virtual Courtroom', hint: 'Verified citations' },
  { k: 'draft', t: 'Auto-Draft Studio', hint: 'Drafting from facts' },
  { k: 'forms', t: 'Legal Forms', hint: 'AI auto-fill' },
];

const CYCLE_MS = 3800;

export default function HeroPreview() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % SLIDES.length), CYCLE_MS);
    return () => clearInterval(t);
  }, []);
  const slide = SLIDES[idx];
  return (
    <div className="heropv">
      <div className="heropv__device">
        <div className="heropv__chrome">
          <span /><span /><span />
          <div className="heropv__chrome-t">
            lexamplify<span className="heropv__chrome-path"> / {slide.t.toLowerCase().replace(/\s+/g, '-')}</span>
          </div>
          <div className="heropv__chrome-badge">{slide.hint}</div>
        </div>
        <div className="heropv__scene">
          {SLIDES.map((s, i) => (
            <div key={s.k} className={`hpscene hpscene--${s.k} ${idx === i ? 'is-on' : ''}`} aria-hidden={idx !== i}>
              {s.k === 'contract'  && <ContractPreview key={`${idx}-c`} />}
              {s.k === 'courtroom' && <CourtroomPreview key={`${idx}-r`} />}
              {s.k === 'draft'     && <DraftPreview key={`${idx}-d`} />}
              {s.k === 'forms'     && <FormsPreview key={`${idx}-f`} />}
            </div>
          ))}
        </div>
        <div className="heropv__dots">
          {SLIDES.map((s, i) => (
            <button key={s.k} className={idx === i ? 'is-on' : ''} onClick={() => setIdx(i)} aria-label={s.t} />
          ))}
        </div>
      </div>
      {/* Decorative tags around the device */}
      <div className="heropv__tag heropv__tag--tl">14 features</div>
      <div className="heropv__tag heropv__tag--tr">Hosted in India</div>
      <div className="heropv__tag heropv__tag--bl">Audit trail on every change</div>
      <div className="heropv__tag heropv__tag--br">Citations · verified</div>
    </div>
  );
}

/* ── Contract Analyzer micro-preview ───────────────────── */
function ContractPreview() {
  const lines = [
    { risk: 0 }, { risk: 2 }, { risk: 0 }, { risk: 0 }, { risk: 1 },
    { risk: 0 }, { risk: 0 }, { risk: 2 }, { risk: 0 }, { risk: 0 }, { risk: 1 },
  ];
  return (
    <div className="hpa hpa-contract">
      <div className="hpa-doc">
        <div className="hpa-doc__title" />
        {lines.map((l, i) => (
          <div className="hpa-doc__line" key={i} style={{ animationDelay: `${i * 50}ms` }}>
            <div className="hpa-doc__text" />
            {l.risk > 0 && (
              <span className={`hpa-doc__flag ${l.risk === 2 ? 'is-high' : 'is-mid'}`} style={{ animationDelay: `${500 + i * 50}ms` }}>
                {l.risk === 2 ? 'CRITICAL' : 'REVIEW'}
              </span>
            )}
          </div>
        ))}
        <div className="hpa-doc__scan" />
      </div>
    </div>
  );
}

/* ── Virtual Courtroom micro-preview ───────────────────── */
function CourtroomPreview() {
  return (
    <div className="hpa hpa-courtroom">
      <div className="hpc-chat hpc-chat--l" style={{ animationDelay: '200ms' }}>
        <div className="hpc-chat__role">Advocate</div>
        <div className="hpc-chat__msg">Partial performance negates the dishonest intention under s.415 IPC.</div>
      </div>
      <div className="hpc-chat hpc-chat--r" style={{ animationDelay: '900ms' }}>
        <div className="hpc-chat__role">Bench</div>
        <div className="hpc-chat__msg">
          Hridaya Ranjan Prasad Verma v. State of Bihar <span className="hpc-chat__v">✓</span>
        </div>
      </div>
      <div className="hpc-cite" style={{ animationDelay: '1600ms' }}>
        India Kanoon · DuckDuckGo · verified
      </div>
    </div>
  );
}

/* ── Auto-Draft micro-preview ─────────────────────────── */
function DraftPreview() {
  return (
    <div className="hpa hpa-draft">
      <svg viewBox="0 0 460 200" className="hpd-pen">
        <text x="20" y="48" className="hpd-pen__t1">In the matter of…</text>
        <text x="20" y="88" className="hpd-pen__t2">The applicant respectfully</text>
        <text x="20" y="128" className="hpd-pen__t3">submits that the ingredients</text>
        <text x="20" y="168" className="hpd-pen__t4">of the offence are not made out.</text>
      </svg>
    </div>
  );
}

/* ── Legal Forms micro-preview ────────────────────────── */
function FormsPreview() {
  const fields = [
    { lbl: 'Party A', val: 'Alpha Pharma Pvt Ltd' },
    { lbl: 'Party B', val: 'Beta Research LLP' },
    { lbl: 'Date', val: '01 January 2026' },
    { lbl: 'Jurisdiction', val: 'Delhi' },
  ];
  return (
    <div className="hpa hpa-forms">
      {fields.map((f, i) => (
        <div className="hpf" key={f.lbl} style={{ animationDelay: `${i * 240}ms` }}>
          <div className="hpf__lbl">{f.lbl}<span>✦ AI</span></div>
          <div className="hpf__val">{f.val}<span>✓</span></div>
        </div>
      ))}
    </div>
  );
}
