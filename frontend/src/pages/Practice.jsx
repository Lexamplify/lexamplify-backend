import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import Modal from '../components/Modal.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}
function shortDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
const toneFor = (du) => (du != null && du <= 2 ? 'risk' : du != null && du <= 7 ? 'warn' : 'muted');
const sevTone = (s) => (s === 'overdue' ? 'risk' : s === 'soon' ? 'warn' : 'muted');

const getJSON = (path, fallback) =>
  fetch(`${API_BASE}/api/practice${path}`, { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : fallback))
    .catch(() => fallback);

export default function Practice() {
  const navigate = useNavigate();
  const [dash, setDash] = useState(null);
  const [cases, setCases] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [dRes, cRes, clRes] = await Promise.all([
        getJSON('/dashboard', null),
        getJSON('/cases?per_page=100&sort=next_hearing', { cases: [] }),
        getJSON('/clients?per_page=100', { clients: [] }),
      ]);
      setDash(dRes && dRes.counts ? dRes : null);
      setCases(Array.isArray(cRes?.cases) ? cRes.cases : []);
      setClients(Array.isArray(clRes?.clients) ? clRes.clients : []);
      if (!cRes?.cases && !clRes?.clients && !dRes) setError('Could not load your practice. Please try again.');
    } catch {
      setError('Could not load your practice. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = cases.filter((c) => !c.closed);
  const withHearing = open
    .filter((c) => c.next_hearing && daysUntil(c.next_hearing) != null && daysUntil(c.next_hearing) >= 0)
    .sort((a, b) => String(a.next_hearing).localeCompare(String(b.next_hearing)));
  const thisWeek = withHearing.filter((c) => daysUntil(c.next_hearing) <= 7);
  const hearingsToday = withHearing.filter((c) => daysUntil(c.next_hearing) === 0);

  const counts = dash?.counts || {};
  const pending = Array.isArray(dash?.pending) ? dash.pending : [];
  const pendingTotal = dash?.pending_total ?? pending.length;

  const STATS = [
    { Icon: Ic.Users, num: clients.length, label: 'Clients', sub: 'On your rolls' },
    { Icon: Ic.Matters, num: counts.active ?? open.length, label: 'Active matters', sub: 'In chambers' },
    { Icon: Ic.Gavel, num: counts.week ?? thisWeek.length, label: 'Hearings this week', sub: '7-day watch' },
    { Icon: Ic.Clock, num: pendingTotal || hearingsToday.length, label: pending.length ? 'Pending actions' : 'Hearings today', sub: pending.length ? 'Awaiting you' : 'Cause list' },
  ];

  const subline = loading
    ? 'Opening your practice…'
    : `${clients.length} client${clients.length === 1 ? '' : 's'}, ${counts.active ?? open.length} active matter${(counts.active ?? open.length) === 1 ? '' : 's'} and ${counts.week ?? thisWeek.length} hearing${(counts.week ?? thisWeek.length) === 1 ? '' : 's'} in the week ahead.`;

  return (
    <div className="lx-page lx-rise">
      <div className="lx-between ph" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 18 }}>
        <div>
          <span className="ph__eyebrow">Workspace</span>
          <h1 className="ph__title">Practice</h1>
          <p className="ph__sub">{subline}</p>
        </div>
        <div className="lx-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => navigate('/clients')}><Ic.Users size={14} /> Clients</button>
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => navigate('/practice/audit')}><Ic.Shield size={14} /> Audit log</button>
          <button className="lx-btn lx-btn--gold" onClick={() => setShowNew(true)}><Ic.Plus size={15} /> New client</button>
        </div>
      </div>

      {/* Stats */}
      <section className="lx-stats">
        {STATS.map((s) => (
          <div className="lx-stat" key={s.label}>
            <div className="lx-stat__ico"><s.Icon size={18} /></div>
            <div className="lx-stat__num">{loading ? '—' : s.num}</div>
            <div className="lx-stat__label">{s.label}</div>
            <div className="lx-stat__sub">{s.sub}</div>
          </div>
        ))}
      </section>

      {error && !loading ? (
        <div className="lx-card lx-card--pad lx-mt-xl">
          <div className="lx-empty">
            <div className="lx-empty__ico"><Ic.Shield size={22} /></div>
            <h4>Couldn’t open your practice</h4><p>{error}</p>
            <button className="lx-btn lx-btn--sm" style={{ marginTop: 10 }} onClick={load}>Try again</button>
          </div>
        </div>
      ) : (
        <div className="lx-dash-grid lx-mt-xl">
          <div className="lx-stack" style={{ gap: 34 }}>
            {/* Matters snapshot */}
            <section>
              <div className="lx-section-head">
                <h3>Active matters</h3>
                <a onClick={() => navigate('/matters')}>All matters →</a>
              </div>
              <div className="lx-card lx-card--pad">
                <div className="lx-list">
                  {loading ? <div className="lx-empty"><p>Loading your matters…</p></div>
                    : open.length === 0 ? (
                      <div className="lx-empty">
                        <div className="lx-empty__ico"><Ic.Matters size={22} /></div>
                        <h4>No open matters yet</h4><p>Add your first matter to start tracking hearings and clients.</p>
                        <button className="lx-btn lx-btn--sm" style={{ marginTop: 10 }} onClick={() => navigate('/matters?new=1')}>Add a matter</button>
                      </div>
                    ) : open.slice(0, 6).map((c) => {
                      const du = daysUntil(c.next_hearing);
                      const hasHearing = c.next_hearing && du != null && du >= 0;
                      return (
                        <div className="lx-item" key={c.id} onClick={() => navigate('/matters/' + c.id)} style={{ padding: '15px 4px' }}>
                          <div className="lx-item__ico"><Ic.Scale size={18} /></div>
                          <div className="lx-item__body" style={{ flex: 2 }}>
                            <div className="lx-item__title">{c.title || 'Untitled matter'}</div>
                            <div className="lx-item__meta">{[c.court, c.case_no].filter(Boolean).join(' · ') || c.case_type || '—'}</div>
                          </div>
                          <div style={{ width: 72, textAlign: 'right' }} className="hide-sm">
                            <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10 }}>Next</div>
                            <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{shortDate(c.next_hearing)}</div>
                          </div>
                          {hasHearing
                            ? <span className={`lx-badge lx-badge--${toneFor(du)}`} style={{ minWidth: 72, justifyContent: 'center' }}>{du === 0 ? 'Today' : `${du}d`}</span>
                            : <span className="lx-badge lx-badge--ok" style={{ minWidth: 72, justifyContent: 'center' }}>{c.status || 'Active'}</span>}
                        </div>
                      );
                    })}
                </div>
              </div>
            </section>

            {/* Clients */}
            <section>
              <div className="lx-section-head">
                <h3>Clients</h3>
                <a onClick={() => setShowNew(true)}>Add client →</a>
              </div>
              <div className="lx-card lx-card--pad">
                <div className="lx-list">
                  {loading ? <div className="lx-empty"><p>Loading your clients…</p></div>
                    : clients.length === 0 ? (
                      <div className="lx-empty">
                        <div className="lx-empty__ico"><Ic.Users size={22} /></div>
                        <h4>No clients yet</h4><p>Add the people you act for to keep their contact details and matters together.</p>
                        <button className="lx-btn lx-btn--sm" style={{ marginTop: 10 }} onClick={() => setShowNew(true)}>Add a client</button>
                      </div>
                    ) : clients.slice(0, 6).map((cl) => (
                      <div className="lx-item" key={cl.id} style={{ padding: '15px 4px' }}>
                        <div className="lx-item__ico"><Ic.Users size={18} /></div>
                        <div className="lx-item__body" style={{ flex: 2 }}>
                          <div className="lx-item__title">{cl.name}</div>
                          <div className="lx-item__meta">{[cl.phone, cl.email, cl.occupation].filter(Boolean).join(' · ') || 'No contact details'}</div>
                        </div>
                        <span className="lx-badge lx-badge--muted" style={{ minWidth: 92, justifyContent: 'center' }}>
                          {cl.active_cases ?? cl.cases ?? 0} active
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </section>
          </div>

          {/* Rail */}
          <aside className="lx-stack" style={{ gap: 24 }}>
            <section className="lx-card lx-card--pad">
              <div className="lx-section-head" style={{ marginBottom: 14 }}>
                <h3>Pending actions</h3>
                {pending.length > 0 && <span className="lx-badge lx-badge--warn">{pendingTotal}</span>}
              </div>
              <div className="lx-list">
                {loading ? <div className="lx-empty"><p>Loading…</p></div>
                  : pending.length === 0 ? (
                    <div className="lx-empty"><p>{dash ? 'Nothing is waiting on you.' : 'No pending actions to show.'}</p></div>
                  ) : pending.slice(0, 6).map((p, i) => {
                    const tone = sevTone(p.severity);
                    return (
                      <div className="lx-item" key={p.link || i} style={{ padding: '13px 2px', cursor: 'default' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: tone === 'risk' ? 'var(--risk)' : tone === 'warn' ? 'var(--warn)' : 'var(--muted-2)' }} />
                        <div className="lx-item__body">
                          <div className="lx-item__title" style={{ fontSize: 13.5, fontFamily: 'var(--font-sans)', fontWeight: 500 }}>{p.title}</div>
                          {p.sub ? <div className="lx-item__meta">{p.sub}</div> : null}
                        </div>
                        {p.date ? <span className="lx-muted" style={{ fontWeight: 600, color: tone === 'risk' ? 'var(--risk)' : 'var(--ink-soft)' }}>{shortDate(p.date)}</span> : null}
                      </div>
                    );
                  })}
              </div>
            </section>

            <section className="lx-card lx-card--pad">
              <div className="lx-section-head" style={{ marginBottom: 16 }}><h3>At a glance</h3></div>
              <div className="lx-stack" style={{ gap: 2 }}>
                {[
                  { label: 'Hearings today', value: counts.today ?? hearingsToday.length },
                  { label: 'Next 7 days', value: counts.week ?? thisWeek.length },
                  { label: 'Open RTI requests', value: counts.rti_open ?? '—' },
                  { label: 'Closed this month', value: counts.closed_month ?? '—' },
                ].map((row) => (
                  <div className="lx-item" key={row.label} style={{ padding: '12px 2px', cursor: 'default' }}>
                    <div className="lx-item__title" style={{ flex: 1, fontSize: 13.5, fontFamily: 'var(--font-sans)', fontWeight: 500 }}>{row.label}</div>
                    <span style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 16, color: 'var(--ink)' }}>{loading ? '—' : row.value}</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}

      {showNew && <NewClientModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

function NewClientModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', occupation: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = async () => {
    if (!form.name.trim()) { setErr('A client name is required.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/practice/clients`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ ...form, name: form.name.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Could not add the client.');
      onCreated(data.client?.id || data.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New client" onClose={onClose}
      footer={<><button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="lx-btn lx-btn--primary" onClick={create} disabled={busy}>{busy ? 'Adding…' : 'Add client'}</button></>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}
      <div><label className="lbl">Full name</label><input className="inp" value={form.name} onChange={set('name')} placeholder="e.g. Mehta Industries Pvt. Ltd." /></div>
      <div className="lx-row" style={{ gap: 14 }}>
        <div style={{ flex: 1 }}><label className="lbl">Phone</label><input className="inp" value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="For WhatsApp reminders" /></div>
        <div style={{ flex: 1 }}><label className="lbl">Email</label><input className="inp" value={form.email} onChange={set('email')} inputMode="email" placeholder="name@example.com" /></div>
      </div>
      <div><label className="lbl">Occupation</label><input className="inp" value={form.occupation} onChange={set('occupation')} placeholder="e.g. Director, Proprietor" /></div>
      <div><label className="lbl">Notes</label><textarea className="inp" value={form.notes} onChange={set('notes')} rows={3} placeholder="Anything worth remembering about this client" /></div>
    </Modal>
  );
}
