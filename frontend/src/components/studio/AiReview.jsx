import { useState } from 'react';

const SEVERITY_STYLE = {
  error: { bg: '#FEE2E2', color: '#991B1B', border: '#FECACA', icon: '!' },
  warning: { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A', icon: '⚠' },
  info: { bg: '#DBEAFE', color: '#1E40AF', border: '#BFDBFE', icon: 'i' },
};

function AiReview({ bridge, docType }) {
  const [findings, setFindings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function runReview() {
    if (!bridge) return;
    const text = (bridge.text() || '').trim();
    if (!text) { setError('Document is empty.'); return; }

    setLoading(true);
    setError('');
    setFindings(null);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
      const csrf = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
      const token = csrf ? decodeURIComponent(csrf[1]) : '';
      const res = await fetch(`${API_BASE}/api/drafts/review`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': token },
        body: JSON.stringify({ text, doc_type: docType || '' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Review failed (${res.status})`);
      }
      const data = await res.json();
      setFindings(data.findings || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ads-review">
      <button
        className="ads-review__btn"
        onClick={runReview}
        disabled={loading}
      >
        {loading ? (
          <>
            <span className="ads-review__spinner" />
            Reviewing...
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            Review Document
          </>
        )}
      </button>

      {error && <div className="ads-review__error">{error}</div>}

      {findings && findings.length === 0 && (
        <div className="ads-review__ok">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          No issues found. Document looks good.
        </div>
      )}

      {findings && findings.length > 0 && (
        <div className="ads-review__findings">
          {findings.map((f, i) => {
            const s = SEVERITY_STYLE[f.severity] || SEVERITY_STYLE.info;
            return (
              <div key={i} className="ads-review__finding" style={{ background: s.bg, borderColor: s.border }}>
                <div className="ads-review__finding-head">
                  <span className="ads-review__finding-icon" style={{ color: s.color }}>{s.icon}</span>
                  <span className="ads-review__finding-type" style={{ color: s.color }}>{f.type || f.severity}</span>
                </div>
                <div className="ads-review__finding-msg">{f.message}</div>
                {f.location && <div className="ads-review__finding-loc">{f.location}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AiReview;
