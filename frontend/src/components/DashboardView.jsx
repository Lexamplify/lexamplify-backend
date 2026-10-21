import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchTrackedCases } from '../services/api';
import TEMPLATES from '../data/legalTemplates.js';

/* ── icons ─────────────────────────────────────────────── */
const I = {
  search: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>,
  clock: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  gavel: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m14.5 12.5-8 8a2.1 2.1 0 0 1-3-3l8-8" /><path d="m16 16 6-6M8 8l6-6M9 7l8 8" /></svg>,
  pen: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>,
  folder: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>,
  scale: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18" /><path d="M5 7l-3 6a3.5 3.5 0 0 0 7 0l-3-6M19 7l-3 6a3.5 3.5 0 0 0 7 0l-3-6M5 7h14M9 21h6" /></svg>,
  arrow: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  plus: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
  doc: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5" /></svg>,
  sparkle: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></svg>,
};

const QUICK_DRAFTS = [
  'mutual-nda', 'legal-notice-recovery-of-dues', 'eviction-petition',
  'bail-application-439', 'employment-offer-letter',
];

function templateName(id) {
  const t = Array.isArray(TEMPLATES) ? TEMPLATES.find((x) => x?.id === id) : TEMPLATES?.[id];
  return t?.title || t?.name || id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardView() {
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ask, setAsk] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await fetchTrackedCases();
        const list = Array.isArray(data) ? data : data?.cases || data?.items || [];
        if (alive) setCases(list);
      } catch {
        if (alive) setCases([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const today = useMemo(
    () => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    []
  );

  const stats = useMemo(() => {
    const n = cases.length;
    const upcoming = cases.filter((c) => c?.nextHearing || c?.nextHearingDate || c?.nextDate).length;
    return [
      { ico: I.clock, num: 0, label: 'Limitation expiries', sub: '7-day watch' },
      { ico: I.gavel, num: upcoming, label: 'Hearings this week', sub: 'Cause list' },
      { ico: I.pen, num: 0, label: 'Drafts in review', sub: 'Awaiting sign-off' },
      { ico: I.folder, num: n, label: 'Tracked matters', sub: 'On record' },
    ];
  }, [cases]);

  const submitAsk = (e) => {
    e.preventDefault();
    const q = ask.trim();
    navigate(q ? `/auto-draft?prompt=${encodeURIComponent(q)}` : '/auto-draft');
  };

  const openCase = (c) => {
    const id = c?.id || c?.caseId || c?.cnr;
    navigate(id ? `/case/${id}` : '/workspace/matters');
  };

  return (
    <div className="lx-page lx-rise">
      {/* Header */}
      <header className="lx-between" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 20 }}>
        <div>
          <span className="lx-eyebrow">Workspace</span>
          <h1 className="lx-h1" style={{ marginTop: 14 }}>{greeting()}, Counsel</h1>
          <p className="lx-lead" style={{ marginTop: 10 }}>{today} — your chambers at a glance.</p>
        </div>
        <div className="lx-row" style={{ gap: 12 }}>
          <button className="lx-btn lx-btn--ghost" onClick={() => navigate('/calendar')}>{I.clock} This week</button>
          <button className="lx-btn lx-btn--gold" onClick={() => navigate('/auto-draft')}>{I.plus} New draft</button>
        </div>
      </header>

      {/* Command bar */}
      <form className="lx-field lx-mt-l" onSubmit={submitAsk} style={{ height: 60 }}>
        {I.search}
        <input
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          placeholder="Ask Lexamplify, or begin a draft — e.g. “Draft a legal notice for recovery of dues”"
        />
        <button type="submit" className="lx-btn lx-btn--primary lx-btn--sm">{I.sparkle} Begin</button>
      </form>

      {/* Stats */}
      <section className="lx-stats lx-mt-l">
        {stats.map((s, i) => (
          <div className="lx-stat" key={i}>
            <div className="lx-stat__ico">{s.ico}</div>
            <div className="lx-stat__num">{s.num}</div>
            <div className="lx-stat__label">{s.label}</div>
            <div className="lx-stat__sub">{s.sub}</div>
          </div>
        ))}
      </section>

      {/* Body */}
      <div className="lx-dash-grid lx-mt-xl">
        {/* Left — matters */}
        <div className="lx-stack" style={{ gap: 32 }}>
          <section>
            <div className="lx-section-head">
              <h3>Your matters</h3>
              <a onClick={() => navigate('/workspace/matters')} style={{ cursor: 'pointer' }}>All matters {I.arrow}</a>
            </div>
            <div className="lx-card lx-card--pad">
              {loading ? (
                <div className="lx-muted" style={{ padding: '28px 4px' }}>Loading your matters…</div>
              ) : cases.length === 0 ? (
                <div className="lx-empty">
                  <div className="lx-empty__ico">{I.scale}</div>
                  <h4>No matters on record yet</h4>
                  <p>Sync a case from eCourts with its CNR number, or add a matter to begin tracking hearings, limitation and filings.</p>
                  <button className="lx-btn lx-btn--primary" onClick={() => navigate('/workspace/matters')}>{I.plus} Add a matter</button>
                </div>
              ) : (
                <div className="lx-list">
                  {cases.slice(0, 6).map((c, i) => (
                    <div className="lx-item" key={c?.id || c?.cnr || i} onClick={() => openCase(c)}>
                      <div className="lx-item__ico">{I.scale}</div>
                      <div className="lx-item__body">
                        <div className="lx-item__title">{c?.title || c?.caseTitle || c?.name || 'Untitled matter'}</div>
                        <div className="lx-item__meta">
                          {(c?.court || c?.courtName || 'Court not set')}{c?.caseNumber || c?.cnr ? ` · ${c.caseNumber || c.cnr}` : ''}
                        </div>
                      </div>
                      {c?.status && <span className="lx-badge lx-badge--muted">{c.status}</span>}
                      <span style={{ color: 'var(--muted)' }}>{I.arrow}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="lx-section-head">
              <h3>Pick up where you left off</h3>
              <a onClick={() => navigate('/auto-draft')} style={{ cursor: 'pointer' }}>Open studio {I.arrow}</a>
            </div>
            <div className="lx-card lx-card--pad lx-card--hover" onClick={() => navigate('/auto-draft')} style={{ display: 'flex', alignItems: 'center', gap: 18, cursor: 'pointer' }}>
              <div className="lx-stat__ico" style={{ margin: 0, width: 46, height: 46 }}>{I.pen}</div>
              <div style={{ flex: 1 }}>
                <div className="lx-title">Auto-Draft Studio</div>
                <div className="lx-muted" style={{ marginTop: 3 }}>Draft notices, petitions and agreements from your case file — grounded in Indian law.</div>
              </div>
              <span className="lx-badge">{I.sparkle} AI</span>
            </div>
          </section>
        </div>

        {/* Right — rail */}
        <aside className="lx-stack" style={{ gap: 24 }}>
          <section className="lx-card lx-card--pad">
            <div className="lx-section-head" style={{ marginBottom: 14 }}><h3>Quick draft</h3></div>
            <div className="lx-list">
              {QUICK_DRAFTS.map((id) => (
                <div className="lx-item" key={id} style={{ padding: '12px 2px' }} onClick={() => navigate('/auto-draft')}>
                  <div className="lx-item__ico" style={{ width: 32, height: 32 }}>{I.doc}</div>
                  <div className="lx-item__title" style={{ flex: 1, fontSize: 14 }}>{templateName(id)}</div>
                  <span style={{ color: 'var(--muted)' }}>{I.arrow}</span>
                </div>
              ))}
            </div>
            <button className="lx-btn lx-btn--ghost lx-mt-m" style={{ width: '100%' }} onClick={() => navigate('/legal-forms')}>Browse all forms</button>
          </section>

          <section className="lx-card lx-card--pad">
            <div className="lx-section-head" style={{ marginBottom: 14 }}>
              <h3>This week</h3>
              <span className="lx-badge lx-badge--ok"><span className="dot" /> Live</span>
            </div>
            <div className="lx-empty" style={{ padding: '24px 8px' }}>
              <div className="lx-empty__ico" style={{ width: 44, height: 44 }}>{I.clock}</div>
              <p style={{ marginBottom: 14 }}>No hearings or deadlines in the next seven days.</p>
              <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => navigate('/calendar')}>Open calendar</button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
