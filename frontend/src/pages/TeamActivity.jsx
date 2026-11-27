import { useState, useEffect, useCallback } from 'react';
import * as Ic from '../icons.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function fmtAt(iso) {
  if (!iso) return '';
  try {
    const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}
function pretty(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function fieldLabel(k) {
  const MAP = {
    case_no: 'Case number', next_hearing: 'Next hearing', court: 'Court', title: 'Title',
    status: 'Status', stage: 'Stage', client_id: 'Client', advocate_id: 'Advocate',
    next_action: 'Next action', remarks: 'Remarks', case_type: 'Type', hall: 'Hall', judge: 'Judge',
  };
  return MAP[k] || pretty(k);
}
function val(v) {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

const VERB = {
  update: 'edited', archive: 'archived', revert: 'reverted', unarchive: 'restored',
  create: 'created', delete: 'deleted',
};
const initials = (n) => (n || 'S').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function TeamActivity() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState('all'); // all | mine | revertable

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/practice/activity?limit=150`, { credentials: 'include' });
      if (res.status === 401) throw new Error('Your session has expired. Please sign in again.');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Could not load the activity feed.');
      setItems(Array.isArray(data.activity) ? data.activity : []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const revert = async (id) => {
    if (!window.confirm('Undo this change? The item will be restored to its previous state, and this revert is itself logged.')) return;
    setBusyId(id); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/practice/activity/${id}/revert`, { method: 'POST', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Could not undo this change.');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const shown = items.filter((it) => {
    if (filter === 'revertable') return it.can_revert;
    if (filter === 'mine') return it.action !== 'revert' && it._mine;
    return true;
  });

  const TABS = [
    { k: 'all', label: 'Everything' },
    { k: 'revertable', label: 'Can undo' },
  ];

  return (
    <div className="lx-page lx-rise">
      <div className="ph">
        <span className="ph__eyebrow">Collaboration</span>
        <h1 className="ph__title">Team activity</h1>
        <p className="ph__sub">Every change your chamber makes, in order — with one-click undo, like version control for your practice.</p>
      </div>

      <div className="lx-section-head" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {TABS.map((t) => (
            <button key={t.k} type="button" onClick={() => setFilter(t.k)}
              className={`lx-chip ${filter === t.k ? 'is-on' : ''}`}
              style={{
                padding: '7px 14px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
                border: `1px solid ${filter === t.k ? 'var(--accent)' : 'var(--rule)'}`,
                background: filter === t.k ? 'var(--accent-soft)' : 'var(--paper)',
                color: filter === t.k ? 'var(--accent-ink)' : 'var(--ink-soft)', fontWeight: 600,
              }}>
              {t.label}
            </button>
          ))}
        </div>
        <a onClick={load} style={{ cursor: 'pointer' }}>Refresh →</a>
      </div>

      {err && (
        <div className="lx-card lx-card--pad" style={{ borderColor: 'var(--risk)', color: 'var(--risk)', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>{err}</span>
          <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm" onClick={load}>Try again</button>
        </div>
      )}

      {!(err && shown.length === 0) && (
      <div className="lx-card lx-card--pad">
        {loading ? (
          <div className="lx-empty"><p>Loading the feed…</p></div>
        ) : shown.length === 0 ? (
          <div className="lx-empty"><p>No activity yet. Changes your team makes to cases and clients will appear here.</p></div>
        ) : (
          <div className="lx-stack" style={{ gap: 0 }}>
            {shown.map((it) => {
              const changed = it.changes && typeof it.changes === 'object' ? Object.entries(it.changes) : [];
              return (
                <div key={it.id} style={{
                  display: 'flex', gap: 14, padding: '16px 2px',
                  borderBottom: '1px solid var(--rule-soft)', opacity: it.reverted ? 0.6 : 1,
                }}>
                  <div style={{
                    width: 38, height: 38, flexShrink: 0, borderRadius: '50%',
                    background: 'var(--accent-soft)', color: 'var(--accent-ink)',
                    display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)',
                  }}>{initials(it.actor)}</div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: 'var(--ink)' }}>
                      <strong>{it.actor}</strong> {VERB[it.action] || pretty(it.action)}{' '}
                      <span style={{ color: 'var(--ink-soft)' }}>{it.entity}</span>{' '}
                      <strong style={{ color: 'var(--ink)' }}>{it.label || `#${it.entity_id}`}</strong>
                      {it.reverted && <span className="lx-badge lx-badge--muted" style={{ marginLeft: 8 }}>reverted</span>}
                    </div>

                    {changed.length > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {changed.map(([field, pair]) => (
                          <div key={field} style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontFamily: 'var(--font-sans)' }}>
                            <span style={{ color: 'var(--muted)' }}>{fieldLabel(field)}:</span>{' '}
                            <span style={{ textDecoration: 'line-through', color: 'var(--muted-2)' }}>{val(Array.isArray(pair) ? pair[0] : '')}</span>
                            {' → '}
                            <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{val(Array.isArray(pair) ? pair[1] : '')}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--muted)' }}>
                      {fmtAt(it.at)}
                      {it.reverted && it.reverted_actor && <> · undone by {it.reverted_actor}</>}
                    </div>
                  </div>

                  {it.can_revert && (
                    <button type="button" onClick={() => revert(it.id)} disabled={busyId === it.id}
                      className="lx-btn lx-btn--ghost lx-btn--sm" style={{ flexShrink: 0, alignSelf: 'flex-start' }}>
                      <Ic.Undo size={14} /> {busyId === it.id ? 'Undoing…' : 'Undo'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
