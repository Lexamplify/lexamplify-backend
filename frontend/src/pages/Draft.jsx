import { useState } from 'react';
import * as Ic from '../icons.jsx';

const TEMPLATES = ['Legal notice', 'Bail application', 'Written statement', 'Rent agreement', 'Mutual NDA', 'Plaint'];

export default function Draft() {
  const [brief, setBrief] = useState('');
  const [tpl, setTpl] = useState('Legal notice');

  return (
    <div className="lx-page lx-rise" style={{ maxWidth: 1200 }}>
      <div className="ph">
        <span className="ph__eyebrow">Auto-Draft Studio</span>
        <h1 className="ph__title">Draft</h1>
        <p className="ph__sub">Describe the matter in plain words. Lexamplify returns a court-ready draft, grounded in Indian law and correct in form.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.1fr)', gap: 24, alignItems: 'start' }} className="draft-grid">
        {/* Prompt panel */}
        <div className="lx-card lx-card--pad lx-stack" style={{ gap: 20 }}>
          <div>
            <div className="lx-muted" style={{ fontWeight: 600, marginBottom: 10, color: 'var(--ink)' }}>Document type</div>
            <div className="lx-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {TEMPLATES.map((t) => (
                <button key={t} onClick={() => setTpl(t)} className="lx-btn lx-btn--sm"
                  style={tpl === t ? { background: 'var(--accent)', color: 'var(--on-accent)' } : { background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--rule)' }}>{t}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="lx-muted" style={{ fontWeight: 600, marginBottom: 10, color: 'var(--ink)' }}>The brief</div>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="e.g. Recovery of ₹4,20,000 against Sunrise Developers for a dishonoured cheque dated 12 Aug 2025 under Section 138 NI Act. Client: Mehta Industries. Demand payment within 15 days."
              style={{ width: '100%', minHeight: 170, resize: 'vertical', border: '1px solid var(--rule)', borderRadius: 12, padding: 16, fontFamily: 'var(--font-sans)', fontSize: 14.5, lineHeight: 1.6, color: 'var(--ink)', background: 'var(--bg-card)', outline: 'none' }}
            />
          </div>

          <div className="lx-field" style={{ height: 46, background: 'var(--bg-card)' }}>
            <Ic.Matters size={16} />
            <input placeholder="Attach to matter — Mehta Industries v. Union of India" style={{ fontSize: 13.5 }} />
          </div>

          <button className="lx-btn lx-btn--primary" style={{ width: '100%', height: 48 }}><Ic.Sparkle size={16} /> Generate draft</button>
          <div className="lx-muted" style={{ textAlign: 'center' }}>Every authority cited is verifiable · Nothing is invented</div>
        </div>

        {/* Document preview */}
        <div className="lx-card" style={{ overflow: 'hidden' }}>
          <div className="lx-between" style={{ padding: '14px 20px', borderBottom: '1px solid var(--rule)', background: 'var(--paper-2)' }}>
            <span className="lx-badge"><Ic.Doc size={13} /> Preview</span>
            <div className="lx-row" style={{ gap: 8 }}>
              <button className="lx-btn lx-btn--ghost lx-btn--sm"><Ic.Upload size={14} /> Export</button>
              <button className="lx-btn lx-btn--gold lx-btn--sm"><Ic.Check size={14} /> Finalise</button>
            </div>
          </div>
          <div style={{ padding: '38px 44px', background: 'var(--bg-card)', fontFamily: 'var(--font-serif)', color: 'var(--ink)', lineHeight: 1.85, fontSize: 14.5 }}>
            <div style={{ textAlign: 'center', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', fontSize: 13 }}>Legal Notice</div>
            <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--muted)', marginTop: 4, marginBottom: 24 }}>Under Section 138, Negotiable Instruments Act, 1881</div>
            <p style={{ marginBottom: 14 }}><b>To,</b><br />M/s Sunrise Developers Pvt. Ltd.<br />Through its Director,<br />Connaught Place, New Delhi — 110001</p>
            <p style={{ marginBottom: 14 }}>Dear Sir/Madam,</p>
            <p style={{ marginBottom: 14 }}>Under instructions from and on behalf of my client, <b>M/s Mehta Industries</b>, I address you as under:</p>
            <p style={{ marginBottom: 14 }}>1. That the cheque bearing No. 004521 dated 12.08.2025 for a sum of <b>₹4,20,000/-</b> drawn on … was presented and returned dishonoured with the remark <i>"funds insufficient"</i>.</p>
            <p style={{ color: 'var(--muted)' }}>2. That you are hereby called upon to pay the said sum within <b>fifteen (15) days</b> of receipt hereof, failing which my client shall be constrained to initiate proceedings …</p>
          </div>
        </div>
      </div>
    </div>
  );
}
