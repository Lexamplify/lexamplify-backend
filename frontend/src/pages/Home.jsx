import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import MicButton from '../components/MicButton.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// ── Product modules shown in the launcher grid. Each maps 1:1 to a real route
// already registered in App.jsx — no dead cards. Grouped the way Lexlegis
// groups its home: AI tools first, then the practice surface.
const GROUPS = [
  {
    label: 'AI tools',
    apps: [
      { Icon: Ic.Sparkle, title: 'Assistant', to: '/assistant', ai: true, desc: 'Ask anything, draft and research in one chat.' },
      { Icon: Ic.Draft, title: 'Auto-Draft Studio', to: '/auto-draft', ai: true, desc: 'Generate notices, petitions and agreements.' },
      { Icon: Ic.Contracts, title: 'Contract Analyzer', to: '/contract-analyzer', ai: true, desc: 'Spot risky clauses and get redlines.' },
      { Icon: Ic.Research, title: 'Legal Research', to: '/research', ai: true, desc: 'Statutes, judgments and citations, fast.' },
      { Icon: Ic.Gavel, title: 'Virtual Courtroom', to: '/war-room', ai: true, desc: 'Rehearse arguments against an AI bench.' },
    ],
  },
  {
    label: 'Practice & litigation',
    apps: [
      { Icon: Ic.Matters, title: 'Matters', to: '/matters', desc: 'Every case, client and hearing on record.' },
      { Icon: Ic.Scale, title: 'Court Resources', to: '/court-resources', desc: 'Cause lists, judges and bar associations.' },
      { Icon: Ic.Calendar, title: 'Legal Calendar', to: '/calendar', desc: 'Hearings and deadlines at a glance.' },
      { Icon: Ic.Shield, title: 'Case Vault', to: '/vault', desc: 'Secure document storage, per matter.' },
      { Icon: Ic.Doc, title: 'Document Hub', to: '/document-hub', desc: 'Upload, organize and search filings.' },
      { Icon: Ic.Search, title: 'Conflict Engine', to: '/conflict-engine', desc: 'Check conflicts before you take a brief.' },
      { Icon: Ic.Library, title: 'Firm Library', to: '/firm-library', desc: "Your firm's precedents and templates." },
      { Icon: Ic.Edit, title: 'Legal Forms', to: '/legal-forms', desc: 'Ready-to-fill statutory forms.' },
      { Icon: Ic.Users, title: 'Practice', to: '/practice', desc: 'Team, clients and the firm console.' },
    ],
  },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [ask, setAsk] = useState('');
  const [cases, setCases] = useState([]);
  const [draftCount, setDraftCount] = useState(null);
  const [loading, setLoading] = useState(true);

  const date = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const firstName = (user?.name || user?.full_name || '').trim().split(' ')[0] || 'Counsel';

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cRes, dRes] = await Promise.all([
          fetch(`${API_BASE}/api/practice/cases?per_page=100&sort=next_hearing`, { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : { cases: [] })).catch(() => ({ cases: [] })),
          fetch(`${API_BASE}/api/drafts/sessions`, { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        if (!alive) return;
        setCases(Array.isArray(cRes.cases) ? cRes.cases : []);
        const sessions = dRes?.sessions || dRes?.items || (Array.isArray(dRes) ? dRes : []);
        setDraftCount(Array.isArray(sessions) ? sessions.length : 0);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const open = cases.filter((c) => !c.closed);
  const withHearing = open.filter((c) => c.next_hearing && daysUntil(c.next_hearing) != null && daysUntil(c.next_hearing) >= 0);
  const hearingsToday = withHearing.filter((c) => daysUntil(c.next_hearing) === 0);
  const thisWeek = withHearing.filter((c) => daysUntil(c.next_hearing) <= 7);

  const DAY = [
    { Icon: Ic.Gavel, num: loading ? '—' : hearingsToday.length, label: 'Hearings today', sub: "Today's cause list", to: '/calendar' },
    { Icon: Ic.Clock, num: loading ? '—' : thisWeek.length, label: 'Due this week', sub: '7-day watch', to: '/calendar' },
    { Icon: Ic.Matters, num: loading ? '—' : open.length, label: 'Open matters', sub: 'On record', to: '/matters' },
    { Icon: Ic.Draft, num: draftCount == null ? '—' : draftCount, label: 'Drafts in progress', sub: 'Your sessions', to: '/auto-draft' },
  ];

  const submitAsk = (e) => {
    e.preventDefault();
    navigate('/draft', { state: ask.trim() ? { prompt: ask.trim() } : undefined });
  };

  return (
    <div className="lx-page lx-rise">
      {/* Hero */}
      <div className="ph hub-hero">
        <span className="ph__eyebrow">{date}</span>
        <h1 className="ph__title">{greeting()}, {firstName}</h1>
        <p className="ph__sub">Everything your practice runs on, in one place. Ask, draft, or open a tool below.</p>
      </div>

      {/* Central ask — the command center */}
      <form className="hub-ask" onSubmit={submitAsk}>
        <Ic.Sparkle size={19} />
        <input
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          placeholder="Ask Lexamplify or start a draft — “Draft a legal notice for recovery of dues”"
          aria-label="Ask Lexamplify or start a draft"
        />
        <MicButton scope="form" spokenCommands={false} />
        <button type="submit" className="lx-btn lx-btn--primary lx-btn--sm"><Ic.Arrow size={15} /> Begin</button>
      </form>

      {/* Your day */}
      <section className="hub-day lx-mt-l">
        {DAY.map((d) => (
          <button type="button" className="hub-daycard" key={d.label} onClick={() => navigate(d.to)}
            style={{ cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--accent-ink)', display: 'grid', placeItems: 'center' }}><d.Icon size={17} /></span>
            </div>
            <div className="hub-daycard__num" style={{ marginTop: 10 }}>{d.num}</div>
            <div className="hub-daycard__label">{d.label}</div>
            <div className="hub-daycard__sub">{d.sub}</div>
          </button>
        ))}
      </section>

      {/* App launcher */}
      {GROUPS.map((g) => (
        <section key={g.label} className="lx-mt-xl">
          <div className="hub-group-label">{g.label}</div>
          <div className="hub-grid">
            {g.apps.map((a) => (
              <button type="button" key={a.to} className="hub-card" onClick={() => navigate(a.to)}>
                <span className="hub-card__ico"><a.Icon size={20} /></span>
                <span className="hub-card__body">
                  <span className="hub-card__title">
                    {a.title}
                    {a.ai && <span className="hub-card__ai">AI</span>}
                  </span>
                  <span className="hub-card__desc">{a.desc}</span>
                </span>
                <span className="hub-card__go"><Ic.Arrow size={15} /></span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
