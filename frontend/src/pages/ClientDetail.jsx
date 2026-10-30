import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
function shortDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso + (/\d\dZ$|T/.test(iso) ? '' : 'T00:00:00')).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return iso; }
}

export default function ClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [client, setClient] = useState(null);
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({});
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/practice/clients/${id}`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Could not load this client.');
      const c = data.client || data;
      setClient(c);
      setCases(Array.isArray(c.case_list) ? c.case_list : []);
      setForm({
        name: c.name || '', phone: c.phone || '', email: c.email || '',
        occupation: c.occupation || '', address: c.address || '', notes: c.notes || '',
      });
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaveBusy(true); setSaveMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/practice/clients/${id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Could not save.');
      setClient(data.client || client);
      setEdit(false);
      setSaveMsg('Saved.');
      setTimeout(() => setSaveMsg(''), 2500);
    } catch (e) { setSaveMsg(e.message); }
    finally { setSaveBusy(false); }
  }

  async function archive() {
    if (!window.confirm(`Archive "${client?.name || 'this client'}"? Their matters stay but they are hidden from active lists.`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/practice/clients/${id}/archive`, {
        method: 'POST', credentials: 'include', headers: { 'X-CSRF-TOKEN': csrf() },
      });
      if (!res.ok) throw new Error('Could not archive.');
      nav('/clients');
    } catch (e) { alert(e.message); }
  }

  if (loading) return <div className="lx-page lx-rise"><div className="lx-card lx-card--pad"><div className="lx-empty"><p>Loading…</p></div></div></div>;
  if (err) return <div className="lx-page lx-rise"><div className="lx-card lx-card--pad"><div className="lx-empty"><div className="lx-empty__ico"><Ic.Users size={22} /></div><h4>Couldn't load this client</h4><p>{err}</p><button className="lx-btn lx-btn--sm" onClick={() => nav('/clients')}>← Back to clients</button></div></div></div>;
  if (!client) return null;

  return (
    <div className="lx-page lx-rise">
      <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => nav('/clients')} style={{ marginBottom: 18 }}>
        <Ic.Arrow size={14} style={{ transform: 'rotate(180deg)' }} /> All clients
      </button>

      <div className="lx-between ph" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 18 }}>
        <div>
          <span className="ph__eyebrow">Client</span>
          <h1 className="ph__title">{client.name}</h1>
          <p className="ph__sub">{[client.phone, client.email, client.occupation].filter(Boolean).join(' · ') || 'No contact details on file yet.'}</p>
        </div>
        <div className="lx-row" style={{ gap: 10 }}>
          {!edit && <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => setEdit(true)}><Ic.Draft size={14} /> Edit</button>}
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={archive}>Archive</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 24, alignItems: 'start' }}>
        {/* Contact card */}
        <section className="lx-card lx-card--pad">
          <div className="lx-section-head" style={{ marginBottom: 14 }}>
            <h3>Contact</h3>
            {saveMsg && <span className={`lx-badge ${saveMsg === 'Saved.' ? 'lx-badge--ok' : 'lx-badge--risk'}`}>{saveMsg}</span>}
          </div>
          {edit ? (
            <div className="lx-stack" style={{ gap: 12 }}>
              {[
                ['name', 'Full name'], ['phone', 'Phone'], ['email', 'Email'],
                ['occupation', 'Occupation'], ['address', 'Address'],
              ].map(([k, label]) => (
                <div key={k}>
                  <label className="lbl">{label}</label>
                  <input className="inp" value={form[k] || ''} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
                </div>
              ))}
              <div>
                <label className="lbl">Notes</label>
                <textarea className="inp" rows={3} value={form.notes || ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="lx-row" style={{ gap: 10, justifyContent: 'flex-end' }}>
                <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => { setEdit(false); setForm({ name: client.name, phone: client.phone || '', email: client.email || '', occupation: client.occupation || '', address: client.address || '', notes: client.notes || '' }); }} disabled={saveBusy}>Cancel</button>
                <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={save} disabled={saveBusy}>{saveBusy ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          ) : (
            <dl className="lx-stack" style={{ gap: 10, fontSize: 14 }}>
              {[
                ['Phone', client.phone], ['Email', client.email],
                ['Occupation', client.occupation], ['Address', client.address],
                ['Notes', client.notes],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="lx-muted" style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div>
                  <div style={{ color: 'var(--ink)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{value || '—'}</div>
                </div>
              ))}
            </dl>
          )}
        </section>

        {/* Matters linked to this client */}
        <section className="lx-card" style={{ overflow: 'hidden' }}>
          <div className="lx-between" style={{ padding: '14px 20px', borderBottom: '1px solid var(--rule)', background: 'var(--paper-2)' }}>
            <span className="lx-badge"><Ic.Matters size={13} /> Linked matters</span>
            <span className="lx-muted" style={{ fontSize: 12 }}>{cases.length} total</span>
          </div>
          <div style={{ padding: '8px 16px' }}>
            {cases.length === 0 ? (
              <div className="lx-empty"><div className="lx-empty__ico"><Ic.Matters size={22} /></div><h4>No matters yet</h4><p>Create a case from the Matters page and set the client to {client.name}.</p></div>
            ) : (
              <div className="lx-list">
                {cases.map((c) => (
                  <div className="lx-item" key={c.id} onClick={() => nav(`/matters/${c.id}`)} style={{ padding: '14px 4px' }}>
                    <div className="lx-item__ico"><Ic.Matters size={16} /></div>
                    <div className="lx-item__body" style={{ flex: 2 }}>
                      <div className="lx-item__title">{c.title || 'Matter'}</div>
                      <div className="lx-item__meta">{[c.case_no, c.court, c.case_type].filter(Boolean).join(' · ') || '—'}</div>
                    </div>
                    {c.next_hearing && <span className="lx-badge lx-badge--warn">Next {shortDate(c.next_hearing)}</span>}
                    <span className={`lx-badge lx-badge--${c.closed_at ? 'muted' : c.archived_at ? 'muted' : 'ok'}`}>
                      {c.closed_at ? 'Closed' : c.archived_at ? 'Archived' : (c.status || 'Open')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
