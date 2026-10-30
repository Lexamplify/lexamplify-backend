import { useState } from 'react';
import * as Ic from '../icons.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

const SUGGESTED = ['Limitation under the amended Section 149 IT Act', 'Anticipatory bail — twin conditions', 'Specific performance after 2018 amendment', 'Cheque dishonour — vicarious liability of directors'];
const RECENT = ['Basic structure doctrine precedents', 'Change of opinion in reassessment', 'Grant of probate — testamentary capacity'];
const COURTS = ['All courts', 'Supreme Court', 'High Courts', 'Tribunals'];

// Normalise a single source entry (string or object) into { title, meta, hold }.
function normSource(s) {
  if (s == null) return null;
  if (typeof s === 'string') return { title: s, meta: '', hold: '' };
  return {
    title: s.title || s.name || s.citation || s.source || 'Authority',
    meta: s.meta || s.court || s.citation || '',
    hold: s.hold || s.holding || s.summary || s.snippet || '',
  };
}

export default function Research() {
  const [q, setQ] = useState('');
  const [court, setCourt] = useState('All courts');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const runSearch = async (question) => {
    const text = (question ?? q).trim();
    if (!text || loading) return;
    setQ(text);
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/legal-research`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ question: text }),
      });
      if (res.status === 401) {
        setError('Your session has expired. Please sign in again.');
        return;
      }
      let data = {};
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok || data.error) {
        setError(data.message || data.error || 'Research failed. Please try again.');
        return;
      }
      setResult(data);
    } catch {
      setError('Could not reach the research service. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const sources = (result && Array.isArray(result.sources) ? result.sources
    : result && Array.isArray(result.results) ? result.results
    : result && Array.isArray(result.citations) ? result.citations
    : []).map(normSource).filter(Boolean);

  return (
    <div className="lx-page lx-rise">
      <div className="ph">
        <span className="ph__eyebrow">Legal research</span>
        <h1 className="ph__title">Research</h1>
        <p className="ph__sub">Ask in plain language. Every answer is grounded in verifiable authority — search 50M+ judgments, statutes and rules.</p>
      </div>

      <form className="lx-field" style={{ height: 60 }} onSubmit={(e) => { e.preventDefault(); runSearch(); }}>
        <Ic.Search size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question of law…" disabled={loading} />
        <button type="submit" className="lx-btn lx-btn--primary lx-btn--sm" disabled={loading || !q.trim()}>
          <Ic.Sparkle size={15} /> {loading ? 'Researching…' : 'Research'}
        </button>
      </form>

      <div className="lx-row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        {COURTS.map((c) => <span key={c} className={`chip ${court === c ? 'is-on' : ''}`} onClick={() => setCourt(c)}>{c}</span>)}
      </div>

      {error ? (
        <div className="lx-mt-l">
          <div className="lx-card lx-card--pad" style={{ borderColor: 'var(--risk)' }}>
            <div className="lx-row" style={{ gap: 8, marginBottom: 6 }}>
              <span className="lx-badge lx-badge--risk">Error</span>
            </div>
            <p style={{ fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.6 }}>{error}</p>
          </div>
        </div>
      ) : loading ? (
        <div className="lx-mt-l">
          <div className="lx-card lx-card--pad">
            <div className="lx-empty"><p>Searching the authorities…</p></div>
          </div>
        </div>
      ) : !result ? (
        <div className="lx-dash-grid lx-mt-xl">
          <div className="lx-card lx-card--pad">
            <div className="lx-section-head" style={{ marginBottom: 14 }}><h3>Try asking</h3></div>
            <div className="lx-list">{SUGGESTED.map((s, i) => (
              <div className="lx-item" key={i} onClick={() => runSearch(s)} style={{ padding: '12px 2px' }}>
                <div className="lx-item__ico" style={{ width: 32, height: 32 }}><Ic.Sparkle size={14} /></div>
                <div className="lx-item__title" style={{ flex: 1, fontSize: 14, whiteSpace: 'normal' }}>{s}</div><Ic.Arrow size={15} /></div>
            ))}</div>
          </div>
          <aside className="lx-card lx-card--pad">
            <div className="lx-section-head" style={{ marginBottom: 14 }}><h3>Recent</h3></div>
            <div className="lx-list">{RECENT.map((r, i) => (
              <div className="lx-item" key={i} onClick={() => runSearch(r)} style={{ padding: '11px 2px' }}>
                <Ic.Clock size={15} /><div className="lx-item__title" style={{ flex: 1, fontSize: 13.5, whiteSpace: 'normal', fontFamily: 'var(--font-sans)', fontWeight: 500 }}>{r}</div></div>
            ))}</div>
          </aside>
        </div>
      ) : (
        <div className="lx-mt-l lx-stack" style={{ gap: 22 }}>
          {result.answer && (
            <div className="lx-card lx-card--pad" style={{ borderColor: 'var(--accent)', background: 'linear-gradient(180deg, var(--accent-soft), var(--paper))' }}>
              <div className="lx-row" style={{ gap: 8, marginBottom: 12 }}>
                <span className="lx-badge"><Ic.Sparkle size={13} /> Synthesis</span>
                <span className="lx-muted">{sources.length > 0 ? `Grounded in ${sources.length} ${sources.length === 1 ? 'authority' : 'authorities'}` : 'AI analysis'}</span>
              </div>
              <p style={{ fontFamily: 'var(--font-serif)', fontSize: 18, lineHeight: 1.6, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>
                {result.answer}
              </p>
              <div className="lx-row" style={{ gap: 8, marginTop: 14 }}>
                <button className="lx-btn lx-btn--ghost lx-btn--sm"><Ic.Doc size={13} /> Save to matter</button>
                <button className="lx-btn lx-btn--ghost lx-btn--sm"><Ic.Upload size={13} /> Export</button>
              </div>
            </div>
          )}

          {sources.length > 0 ? (
            <>
              <div className="lx-section-head"><h3>Authorities</h3><span className="lx-muted">{sources.length} found</span></div>
              <div className="lx-card lx-card--pad">
                <div className="lx-list">
                  {sources.map((r, i) => (
                    <div className="lx-item" key={i} style={{ alignItems: 'flex-start', padding: '18px 4px' }}>
                      <div className="lx-item__ico" style={{ marginTop: 2 }}><Ic.Scale size={18} /></div>
                      <div className="lx-item__body">
                        <div className="lx-between" style={{ gap: 12, alignItems: 'baseline' }}>
                          <div className="lx-item__title" style={{ whiteSpace: 'normal' }}>{r.title}</div>
                        </div>
                        {r.meta && <div className="lx-item__meta" style={{ marginBottom: 6 }}>{r.meta}</div>}
                        {r.hold && <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.6 }}>{r.hold}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : !result.answer ? (
            <div className="lx-card lx-card--pad">
              <div className="lx-empty"><p>No authorities found for that query. Try rephrasing your question.</p></div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
