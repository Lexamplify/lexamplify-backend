import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';

const DATA = [
  { title: 'Mehta Industries v. Union of India', parties: 'Writ · Taxation', court: 'Delhi HC', num: 'W.P. 8842/2025', next: '22 Oct', status: 'Active', tone: 'ok' },
  { title: 'Verma Estate — Succession', parties: 'Probate', court: 'Saket DC', num: 'Prob. 231/2024', next: '24 Oct', status: 'Hearing soon', tone: 'warn' },
  { title: 'Khanna Bail Application', parties: 'Criminal · 439 CrPC', court: 'Delhi HC', num: 'Bail 5521/2025', next: '29 Oct', status: 'Filed', tone: 'ok' },
  { title: 'Horizon Tech — Master Services', parties: 'Advisory · Corporate', court: 'Advisory', num: '—', next: '—', status: 'Drafting', tone: 'muted' },
  { title: 'Rao v. Sunrise Developers', parties: 'Civil · RERA', court: 'NCDRC', num: 'C.C. 112/2025', next: '06 Nov', status: 'Active', tone: 'ok' },
  { title: 'Patel Family Trust', parties: 'Advisory · Trusts', court: 'Advisory', num: '—', next: '—', status: 'Disposed', tone: 'muted' },
];

const TABS = ['All', 'Active', 'Hearing soon', 'Drafting', 'Disposed'];

export default function Matters() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('All');
  const [q, setQ] = useState('');

  const rows = DATA.filter((m) =>
    (tab === 'All' || m.status === tab) &&
    (m.title.toLowerCase().includes(q.toLowerCase()) || m.num.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <div className="lx-page lx-rise">
      <div className="lx-between ph" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 18 }}>
        <div>
          <span className="ph__eyebrow">Workspace</span>
          <h1 className="ph__title">Matters</h1>
          <p className="ph__sub">Every case, brief and advisory in your chambers — one place.</p>
        </div>
        <button className="lx-btn lx-btn--gold" onClick={() => navigate('/draft')}><Ic.Plus size={15} /> New matter</button>
      </div>

      <div className="lx-between" style={{ marginBottom: 18, gap: 14, flexWrap: 'wrap' }}>
        <div className="lx-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="lx-btn lx-btn--sm"
              style={tab === t
                ? { background: 'var(--ink)', color: 'var(--paper)' }
                : { background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--rule)' }}
            >{t}</button>
          ))}
        </div>
        <div className="lx-field" style={{ height: 40, maxWidth: 260 }}>
          <Ic.Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search matters…" style={{ fontSize: 14 }} />
        </div>
      </div>

      <div className="lx-card lx-card--pad">
        <div className="lx-list">
          {rows.map((m, i) => (
            <div className="lx-item" key={i} onClick={() => navigate('/matters')} style={{ padding: '16px 4px' }}>
              <div className="lx-item__ico"><Ic.Scale size={18} /></div>
              <div className="lx-item__body" style={{ flex: 2 }}>
                <div className="lx-item__title">{m.title}</div>
                <div className="lx-item__meta">{m.parties}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }} className="hide-sm">
                <div style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>{m.court}</div>
                <div className="lx-item__meta">{m.num}</div>
              </div>
              <div style={{ width: 70, textAlign: 'right' }} className="hide-sm">
                <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10 }}>Next</div>
                <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{m.next}</div>
              </div>
              <span className={`lx-badge lx-badge--${m.tone}`} style={{ minWidth: 92, justifyContent: 'center' }}>{m.status}</span>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="lx-empty"><div className="lx-empty__ico"><Ic.Matters size={22} /></div><h4>No matters here</h4><p>Nothing matches this filter yet.</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
