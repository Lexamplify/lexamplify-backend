import React from 'react';
import LexLogoMark from '../LexLogoMark';
import { Icon } from './MarketingLayout';

/* Product windows for the public site.
   Built from real markup instead of raster screenshots so they stay sharp on
   every screen and never date. Every name, amount and file is invented sample
   data, and each window says so. */

const NAV = [
  { k: 'matters', icon: 'folder', label: 'Matters' },
  { k: 'draft', icon: 'file', label: 'Drafting' },
  { k: 'review', icon: 'scan', label: 'Contract review' },
  { k: 'conflicts', icon: 'scale', label: 'Conflict check' },
  { k: 'calendar', icon: 'calendar', label: 'Calendar' },
];

export function AppWindow({ active, crumb, children, label }) {
  return (
    <div className="aw" role="img" aria-label={label}>
      <div className="aw__chrome" aria-hidden="true">
        <span className="aw__dots"><i /><i /><i /></span>
        <span className="aw__url"><Icon name="lock" size={11} />lexamplify.com / workspace</span>
        <span className="aw__tag">Sample data</span>
      </div>
      <div className="aw__frame" aria-hidden="true">
        <aside className="aw__side">
          <div className="aw__brand"><LexLogoMark size={22} /><span>LexAmplify</span></div>
          <nav>
            {NAV.map((n) => (
              <span key={n.k} className={`aw__nav${n.k === active ? ' is-on' : ''}`}>
                <Icon name={n.icon} size={16} />{n.label}
              </span>
            ))}
          </nav>
          <div className="aw__me"><i>AS</i><span>Adv. Sharma<small>Sharma &amp; Associates</small></span></div>
        </aside>
        <div className="aw__main">
          <div className="aw__top">{crumb}</div>
          <div className="aw__body">{children}</div>
        </div>
      </div>
    </div>
  );
}

const Fill = ({ children, src }) => (
  <span className="fill">{children}{src && <sup className="fill__src">{src}</sup>}</span>
);

export function DraftApp() {
  return (
    <AppWindow
      active="draft"
      label="Illustration of the drafting screen: the assistant asks which matter, shows what it found in the file, and asks for one missing date before writing the legal notice. Sample data."
      crumb={<><b>Sharma v. Tech Corp India</b><span>·</span>New legal notice</>}
    >
      <div className="aw__split">
        <div className="aw__chat">
          <div className="msg msg--ai">
            <p>Which matter is this notice for?</p>
          </div>
          <div className="msg msg--me">Sharma v. Tech Corp India</div>

          <div className="msg msg--ai">
            <p>I read the matter file. Please confirm what I found.</p>
            <ul className="found">
              <li><Icon name="check" size={14} /><span>Client</span><b>Rajesh Sharma</b></li>
              <li><Icon name="check" size={14} /><span>Opposite party</span><b>Tech Corp India Pvt. Ltd.</b></li>
              <li><Icon name="check" size={14} /><span>Amount due</span><b>₹4,80,000</b><em>Invoice INV-2291.pdf</em></li>
              <li className="is-missing"><i />Last written reminder<b>Not in the file</b></li>
            </ul>
          </div>

          <div className="msg msg--ai">
            <p>One thing is missing. Add the date of your last reminder, or leave it blank in the draft.</p>
          </div>
          <div className="aw__input">
            <span>12 September 2026</span>
            <b>Draft notice <Icon name="arrow" size={14} /></b>
          </div>
        </div>

        <div className="aw__page">
          <div className="page__meta"><span className="chip chip--rust">Draft · not yet reviewed</span><span>Page 1 of 3</span></div>
          <div className="page">
            <h4>LEGAL NOTICE</h4>
            <p className="page__to">To, <Fill src="Matter file">Tech Corp India Pvt. Ltd.</Fill></p>
            <p>
              Under instructions from and on behalf of my client <Fill src="Matter file">Mr. Rajesh Sharma</Fill>, I hereby
              give you notice that a sum of <Fill src="INV-2291.pdf">₹4,80,000</Fill> remains due and payable for services
              rendered, despite the written reminder dated <Fill src="You entered">12 September 2026</Fill>.
            </p>
            <p>
              You are called upon to pay the said amount within fifteen days of receipt of this notice, failing which
              my client shall be constrained to initiate appropriate proceedings at your risk as to costs and consequences.
            </p>
            <div className="ghost" style={{ width: '88%' }} />
            <div className="ghost" style={{ width: '70%' }} />
          </div>
        </div>
      </div>
    </AppWindow>
  );
}

export function ReviewApp() {
  const rows = [
    { c: 'Clause 2.4', t: 'Unilateral suspension of payment', l: 'Critical', k: 'rust', on: true },
    { c: 'Clause 8.1', t: 'Liability capped at 12 months of fees', l: 'Review', k: 'amber' },
    { c: 'Clause 11.2', t: 'Termination for convenience', l: 'Review', k: 'amber' },
    { c: 'Clause 14.1', t: 'Sole arbitrator seated in Mumbai', l: 'Review', k: 'amber' },
    { c: 'Clause 9', t: 'Confidentiality', l: 'Standard', k: '' },
  ];
  return (
    <AppWindow
      active="review"
      label="Illustration of contract review: a list of flagged clauses on the left, and on the right the selected clause with the risky words marked and a suggested rewrite. Sample data."
      crumb={<><b>Vendor Service Agreement</b><span>·</span>28 pages · 1 critical, 3 to review</>}
    >
      <div className="aw__split aw__split--review">
        <div className="aw__list">
          <div className="list__h">Flagged clauses</div>
          {rows.map((r) => (
            <div key={r.c} className={`li${r.on ? ' is-on' : ''}`}>
              <div><small>{r.c}</small><span>{r.t}</span></div>
              <span className={`chip${r.k ? ` chip--${r.k}` : ''}`}>{r.l}</span>
            </div>
          ))}
        </div>
        <div className="aw__page aw__page--clause">
          <div className="page__meta"><span className="chip chip--rust">Critical</span><span>Clause 2.4 · page 6</span></div>
          <div className="page">
            <p className="clause">
              “The Client may, <mark>at its sole discretion and without notice</mark>, suspend payment of any invoice
              pending its own internal review, and such suspension shall not constitute a breach.”
            </p>
            <div className="why">
              <b>Why it matters</b>
              <p>Payment can be withheld indefinitely with no notice period or objective trigger, which weakens the vendor’s remedy under the agreement.</p>
            </div>
            <div className="rewrite">
              <b>Suggested rewrite</b>
              <p>
                “The Client may suspend payment of a disputed invoice only after giving <ins>fifteen days’ written notice stating
                the reason</ins>, and shall pay all undisputed amounts when due.”
              </p>
              <div className="rewrite__btns"><span>Accept</span><span>Edit</span><span>Dismiss</span></div>
            </div>
          </div>
        </div>
      </div>
    </AppWindow>
  );
}

export function ConflictApp() {
  const rows = [
    { p: 'Tech Corp India Pvt. Ltd.', r: 'Opposite party', m: 'Sharma v. Tech Corp · 2 matters', l: 'Conflict', k: 'rust' },
    { p: 'Rajesh Sharma', r: 'Prospective client', m: 'Related party in Arora Holdings', l: 'Check', k: 'amber' },
    { p: 'Meera Nair', r: 'Director of opposite party', m: 'No overlap found', l: 'Clear', k: '' },
    { p: 'Arora & Sons Ltd.', r: 'Related party', m: 'No overlap found', l: 'Clear', k: '' },
  ];
  return (
    <AppWindow
      active="conflicts"
      label="Illustration of a conflict check: parties for a new matter listed with whether they appear in other matters, and a saved clearance memo. Sample data."
      crumb={<><b>New matter intake</b><span>·</span>4 parties checked against 126 matters</>}
    >
      <div className="aw__split aw__split--conflict">
        <div className="aw__table">
          <div className="t__h"><span>Party</span><span>Role</span><span>Found in</span><span /></div>
          {rows.map((r) => (
            <div className="t__r" key={r.p}>
              <b>{r.p}</b><span>{r.r}</span><span>{r.m}</span>
              <span className={`chip${r.k ? ` chip--${r.k}` : ''}`}>{r.l}</span>
            </div>
          ))}
        </div>
        <div className="aw__page aw__page--memo">
          <div className="page__meta"><span className="chip">Clearance memo</span><span>Saved with the matter</span></div>
          <div className="page">
            <h4>Conflict clearance</h4>
            <p>One party appears as an opposing party in two existing matters. Partner review is required before the engagement letter is issued.</p>
            <div className="memo__row"><span>Checked</span><b>16 Oct 2026, 11:42</b></div>
            <div className="memo__row"><span>Decision</span><b className="is-pending">Awaiting partner</b></div>
            <div className="ghost" style={{ width: '82%' }} />
          </div>
        </div>
      </div>
    </AppWindow>
  );
}

export function CalendarApp() {
  const days = [
    { d: 'Today', e: [['11:00', 'Hearing · Sharma v. Tech Corp', 'rust'], ['16:30', 'Reply due · Arora Holdings', 'amber']] },
    { d: 'Fri', e: [['10:00', 'Client meeting · Nair Estates', '']] },
    { d: 'Mon', e: [['—', 'Limitation date · Singh v. Rao', 'rust']] },
  ];
  return (
    <AppWindow
      active="calendar"
      label="Illustration of the calendar showing hearings, due replies and a limitation date over the next few days. Sample data."
      crumb={<><b>Calendar</b><span>·</span>This week</>}
    >
      <div className="aw__agenda">
        {days.map((d) => (
          <div key={d.d} className="ag">
            <div className="ag__d">{d.d}</div>
            <div>
              {d.e.map((e) => (
                <div className="ag__e" key={e[1]}>
                  <small>{e[0]}</small><span>{e[1]}</span>
                  {e[2] && <i className={`dot dot--${e[2]}`} />}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AppWindow>
  );
}
