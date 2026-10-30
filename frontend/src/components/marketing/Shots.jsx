import React from 'react';
import { Icon } from './MarketingLayout';

/* Product mock-ups built from real markup (not raster images) so they stay
   crisp on every screen and never look dated. All names and figures are
   invented sample data and are labelled as such. */

function Frame({ title, children }) {
  return (
    <div className="shot" role="img" aria-label={`Illustration of the ${title} screen using sample data`}>
      <div className="shot__bar" aria-hidden="true">
        <span className="shot__dots"><i /><i /><i /></span>
        <span className="shot__title">{title}</span>
        <span className="shot__tag">Sample data</span>
      </div>
      <div className="shot__body" aria-hidden="true">{children}</div>
    </div>
  );
}

export function DraftShot() {
  return (
    <Frame title="Draft · Legal notice">
      <div className="steps"><span className="on" /><span className="on" /><span /><span /></div>
      <div className="ask">
        <div className="ask__q"><span className="ask__n">1</span>Which matter is this notice for?</div>
        <div className="opt is-picked"><span className="opt__radio" />Sharma v. Tech Corp India<small>Recovery of dues</small></div>
        <div className="opt"><span className="opt__radio" />Arora Holdings<small>Lease dispute</small></div>
        <div className="opt"><span className="opt__radio" />No matter, I will enter the details</div>
      </div>
      <div className="doc">
        <div className="doc__h">LEGAL NOTICE</div>
        <p>
          Under instructions from my client <span className="fill">Mr. Rajesh Sharma</span>, I hereby call upon you,{' '}
          <span className="fill">Tech Corp India Pvt. Ltd.</span>, to pay{' '}
          <span className="fill">₹4,80,000</span> within fifteen days of receipt of this notice, failing which…
        </p>
        <div className="ghost" style={{ width: '92%' }} />
        <div className="ghost" style={{ width: '64%' }} />
      </div>
    </Frame>
  );
}

export function AnalyzerShot() {
  const rows = [
    { t: 'Clause 2.4 · Unilateral suspension', s: 'Client may suspend payment at will, with no notice period.', c: 'rust', l: 'Critical' },
    { t: 'Clause 8.1 · Liability cap', s: 'Cap equals fees paid in the last 12 months.', c: 'amber', l: 'Review' },
    { t: 'Clause 14.1 · Jurisdiction', s: 'Sole arbitration seated in Mumbai.', c: 'amber', l: 'Review' },
  ];
  return (
    <Frame title="Contract analyzer">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ fontFamily: 'var(--serif)', fontSize: 16 }}>Vendor Service Agreement</strong>
        <span className="chip">28 pages</span>
        <span className="chip chip--rust">1 critical</span>
        <span className="chip chip--amber">2 to review</span>
      </div>
      <div>
        {rows.map((r) => (
          <div className="row" key={r.t}>
            <div className="row__main">
              <div className="row__t">{r.t}</div>
              <div className="row__s">{r.s}</div>
            </div>
            <span className={`chip chip--${r.c}`}>{r.l}</span>
          </div>
        ))}
      </div>
      <div className="ask" style={{ background: 'var(--accent-soft)', borderColor: 'transparent' }}>
        <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--accent-deep)' }}>Suggested rewrite</div>
        <div style={{ color: 'var(--ink-soft)', fontSize: 13 }}>
          Either party may suspend payment only after giving 15 days’ written notice stating the reason.
        </div>
      </div>
    </Frame>
  );
}

export function ConflictShot() {
  const rows = [
    { t: 'Tech Corp India Pvt. Ltd.', s: 'Appears as opposite party in 2 matters', c: 'rust', l: 'Conflict' },
    { t: 'Rajesh Sharma', s: 'Related party in 1 matter', c: 'amber', l: 'Check' },
    { t: 'Arora & Sons Ltd.', s: 'No overlap found', c: '', l: 'Clear' },
  ];
  return (
    <Frame title="Conflict check">
      <div style={{ fontFamily: 'var(--serif)', fontSize: 16, fontWeight: 600 }}>New matter intake · 3 parties checked</div>
      <div>
        {rows.map((r) => (
          <div className="row" key={r.t}>
            <div className="row__main">
              <div className="row__t">{r.t}</div>
              <div className="row__s">{r.s}</div>
            </div>
            <span className={`chip${r.c ? ` chip--${r.c}` : ''}`}>{r.l}</span>
          </div>
        ))}
      </div>
    </Frame>
  );
}

export function WorkspaceShot() {
  const docs = [
    { t: 'Written Statement – Sharma v. Tech Corp.pdf', s: 'Case Vault · filed 12 Oct' },
    { t: 'Lease Deed – Arora Holdings.docx', s: 'Document Hub · needs review' },
    { t: 'Reply to Legal Notice.docx', s: 'Practice · draft' },
  ];
  return (
    <Frame title="Workspace">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="ask" style={{ padding: 12 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, letterSpacing: '.1em', color: 'var(--muted)' }}>NEXT 48 HOURS</div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 26, fontWeight: 600, marginTop: 4 }}>2</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>hearing · 1 limitation date</div>
        </div>
        <div className="ask" style={{ padding: 12 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, letterSpacing: '.1em', color: 'var(--muted)' }}>AWAITING REVIEW</div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 26, fontWeight: 600, marginTop: 4 }}>5</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>documents</div>
        </div>
      </div>
      <div>
        {docs.map((d) => (
          <div className="row" key={d.t}>
            <Icon name="file" size={18} style={{ color: 'var(--muted)', flex: 'none' }} />
            <div className="row__main">
              <div className="row__t">{d.t}</div>
              <div className="row__s">{d.s}</div>
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}
