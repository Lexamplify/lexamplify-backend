import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import Modal from '../components/Modal.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export default function Clients() {
  const nav = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/practice/clients?per_page=200`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Could not load clients.');
      setClients(Array.isArray(data.clients) ? data.clients : []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = clients.filter((c) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return [c.name, c.phone, c.email].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle));
  });

  return (
    <div className="lx-page lx-rise">
      <div className="lx-between ph" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 18 }}>
        <div>
          <span className="ph__eyebrow">Rolls</span>
          <h1 className="ph__title">Clients</h1>
          <p className="ph__sub">Everyone your chambers represents. Click a client to see their matters, contact details and follow-ups.</p>
        </div>
        <div className="lx-row" style={{ gap: 10 }}>
          <div className="lx-field" style={{ height: 40, maxWidth: 280 }}>
            <Ic.Search size={15} />
            <input placeholder="Search by name, phone, email…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className="lx-btn lx-btn--gold lx-btn--sm" onClick={() => setShowNew(true)}><Ic.Plus size={14} /> New client</button>
        </div>
      </div>

      {loading ? (
        <div className="lx-card lx-card--pad"><div className="lx-empty"><p>Loading clients…</p></div></div>
      ) : err ? (
        <div className="lx-card lx-card--pad"><div className="lx-empty"><div className="lx-empty__ico"><Ic.Users size={22} /></div><h4>Couldn't load clients</h4><p>{err}</p><button className="lx-btn lx-btn--sm" onClick={load}>Try again</button></div></div>
      ) : filtered.length === 0 ? (
        <div className="lx-card lx-card--pad"><div className="lx-empty"><div className="lx-empty__ico"><Ic.Users size={22} /></div><h4>{q ? 'No matches' : 'No clients yet'}</h4><p>{q ? 'Try a different search term.' : 'Add your first client to get started.'}</p></div></div>
      ) : (
        <div className="lx-card" style={{ overflow: 'hidden' }}>
          <div className="lx-list">
            {filtered.map((c) => (
              <div className="lx-item" key={c.id} onClick={() => nav(`/clients/${c.id}`)} style={{ padding: '14px 16px' }}>
                <div className="lx-item__ico"><Ic.Users size={17} /></div>
                <div className="lx-item__body" style={{ flex: 2 }}>
                  <div className="lx-item__title">{c.name}</div>
                  <div className="lx-item__meta">{[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact on file'}</div>
                </div>
                <span className="lx-badge">{c.active_cases ?? c.cases ?? 0} active</span>
                {Number(c.open_followups) > 0 && <span className="lx-badge lx-badge--warn">{c.open_followups} follow-up{c.open_followups === 1 ? '' : 's'}</span>}
                <Ic.Arrow size={14} style={{ opacity: 0.45 }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {showNew && <NewClientModal onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); if (id) nav(`/clients/${id}`); else load(); }} />}
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
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="New client" onClose={onClose}
      footer={<><button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="lx-btn lx-btn--primary" onClick={create} disabled={busy}>{busy ? 'Adding…' : 'Add client'}</button></>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}
      <div><label className="lbl">Full name</label><input className="inp" value={form.name} onChange={set('name')} placeholder="e.g. Mehta Industries Pvt. Ltd." /></div>
      <div className="lx-row" style={{ gap: 14 }}>
        <div style={{ flex: 1 }}><label className="lbl">Phone</label><input className="inp" value={form.phone} onChange={set('phone')} inputMode="tel" /></div>
        <div style={{ flex: 1 }}><label className="lbl">Email</label><input className="inp" value={form.email} onChange={set('email')} inputMode="email" /></div>
      </div>
      <div><label className="lbl">Occupation</label><input className="inp" value={form.occupation} onChange={set('occupation')} /></div>
      <div><label className="lbl">Notes</label><textarea className="inp" value={form.notes} onChange={set('notes')} rows={3} /></div>
    </Modal>
  );
}
