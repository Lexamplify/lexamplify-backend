import { useState, useEffect, useCallback } from 'react';
import * as Ic from '../icons.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function fmtAt(iso) {
  if (!iso) return '';
  try {
    const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function prettyAction(a) {
  return String(a || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Audit() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [per] = useState(40);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async (p = 1) => {
    setLoading(true); setErr('');
    try {
      const url = `${API_BASE}/api/practice/audit?page=${p}&per_page=${per}`;
      const res = await fetch(url, { credentials: 'include' });
      if (res.status === 401) throw new Error('Your session has expired. Please sign in again.');
      if (res.status === 403) throw new Error('Audit log is restricted to Senior Advocates.');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Could not load the audit log.');
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total || 0));
      setPage(Number(data.page || p));
    } catch (e) {
      setErr(e.message);
    } finally { setLoading(false); }
  }, [per]);

  useEffect(() => { load(1); }, [load]);

  const pages = Math.max(1, Math.ceil(total / per));
  const filtered = q.trim()
    ? items.filter((it) => JSON.stringify(it).toLowerCase().includes(q.toLowerCase()))
    : items;

  return (
    <div className="lx-page lx-rise">
      <div className="lx-between ph" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 18 }}>
        <div>
          <span className="ph__eyebrow">Compliance</span>
          <h1 className="ph__title">Audit log</h1>
          <p className="ph__sub">Every action in your practice — who did it, when, and from where. Visible to Senior Advocates only.</p>
        </div>
        <div className="lx-row" style={{ gap: 10 }}>
          <div className="lx-field" style={{ height: 40, maxWidth: 280 }}>
            <Ic.Search size={15} />
            <input placeholder="Filter this page…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <a className="lx-btn lx-btn--ghost lx-btn--sm" href={`${API_BASE}/api/practice/audit/export.csv`} target="_blank" rel="noopener noreferrer">
            <Ic.Upload size={14} /> Export CSV
          </a>
        </div>
      </div>

      {loading ? (
        <div className="lx-card lx-card--pad"><div className="lx-empty"><p>Loading audit log…</p></div></div>
      ) : err ? (
        <div className="lx-card lx-card--pad"><div className="lx-empty"><div className="lx-empty__ico"><Ic.Shield size={22} /></div><h4>Couldn't load the audit log</h4><p>{err}</p><button className="lx-btn lx-btn--sm" onClick={() => load(1)}>Try again</button></div></div>
      ) : filtered.length === 0 ? (
        <div className="lx-card lx-card--pad"><div className="lx-empty"><div className="lx-empty__ico"><Ic.Shield size={22} /></div><h4>Nothing to show</h4><p>{q ? 'No entries match that filter.' : 'No audit events have been recorded yet.'}</p></div></div>
      ) : (
        <>
          <div className="lx-card" style={{ overflow: 'hidden' }}>
            <div className="lx-list">
              {filtered.map((it) => (
                <div className="lx-item" key={it.id} style={{ padding: '14px 16px', alignItems: 'flex-start' }}>
                  <div className="lx-item__ico" style={{ marginTop: 2 }}><Ic.Shield size={17} /></div>
                  <div className="lx-item__body" style={{ flex: 2 }}>
                    <div className="lx-item__title">{prettyAction(it.action)}{it.summary ? ' — ' + it.summary : ''}</div>
                    <div className="lx-item__meta">
                      {it.actor || '—'} · {it.entity || '—'}{it.entity_id ? ` #${it.entity_id}` : ''}
                      {it.ip ? ` · IP ${it.ip}` : ''}
                    </div>
                  </div>
                  <div className="lx-muted" style={{ fontSize: 12.5, textAlign: 'right', minWidth: 140 }}>{fmtAt(it.at)}</div>
                </div>
              ))}
            </div>
          </div>

          {pages > 1 && (
            <div className="lx-row" style={{ gap: 10, justifyContent: 'center', marginTop: 20 }}>
              <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => load(page - 1)} disabled={page <= 1}>← Previous</button>
              <span className="lx-muted" style={{ alignSelf: 'center', fontSize: 13 }}>Page {page} of {pages} · {total.toLocaleString('en-IN')} events</span>
              <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => load(page + 1)} disabled={page >= pages}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
