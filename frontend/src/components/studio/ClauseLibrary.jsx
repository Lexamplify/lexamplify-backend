import { useState, useEffect, useCallback, useMemo } from 'react';
import { listClauses, createClause, updateClause, deleteClause } from '../../services/clauseApi.js';

const CATEGORIES = ['All', 'arbitration', 'confidentiality', 'termination', 'jurisdiction', 'indemnity', 'general'];

const DEFAULT_CLAUSES = [
  { title: 'Arbitration', category: 'arbitration', content: 'Any dispute arising out of or in connection with this agreement shall be referred to and finally resolved by arbitration under the Arbitration and Conciliation Act, 1996. The seat of arbitration shall be [City]. The language of arbitration shall be English.' },
  { title: 'Confidentiality', category: 'confidentiality', content: 'Each party agrees to keep confidential all information received from the other party that is marked as confidential or that reasonably should be understood to be confidential. This obligation shall survive termination of this agreement for a period of [Number] years.' },
  { title: 'Termination', category: 'termination', content: 'Either party may terminate this agreement by giving [Number] days written notice to the other party. Upon termination, all rights and obligations shall cease except those which by their nature are intended to survive.' },
  { title: 'Jurisdiction', category: 'jurisdiction', content: 'This agreement shall be governed by and construed in accordance with the laws of India. The courts at [City] shall have exclusive jurisdiction over any disputes arising under this agreement.' },
  { title: 'Indemnity', category: 'indemnity', content: 'Each party shall indemnify and hold harmless the other party from and against any claims, damages, losses and expenses arising out of or resulting from any breach of this agreement by the indemnifying party.' },
];

function ClauseLibrary({ bridge }) {
  const [clauses, setClauses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState('All');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ title: '', category: 'general', content: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listClauses();
      let list = data.clauses || [];
      if (list.length === 0) {
        const created = [];
        for (const dc of DEFAULT_CLAUSES) {
          try {
            const res = await createClause(dc);
            if (res.clause) created.push(res.clause);
          } catch { /* ignore */ }
        }
        list = created;
      }
      setClauses(list);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = clauses;
    if (activeCat !== 'All') list = list.filter((c) => c.category === activeCat);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        (c.title || '').toLowerCase().includes(q) ||
        (c.content || '').toLowerCase().includes(q) ||
        (c.category || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [clauses, activeCat, search]);

  function insertClause(clause) {
    if (!bridge) return;
    try {
      bridge.insertText(clause.content);
    } catch { alert('Could not insert — place your cursor in the document first.'); }
  }

  function openEdit(clause) {
    setEditingId(clause.id);
    setForm({ title: clause.title, category: clause.category || 'general', content: clause.content });
    setShowForm(true);
  }

  function openNew() {
    setEditingId(null);
    setForm({ title: '', category: 'general', content: '' });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        const res = await updateClause(editingId, form);
        setClauses((prev) => prev.map((c) => c.id === editingId ? (res.clause || c) : c));
      } else {
        const res = await createClause(form);
        if (res.clause) setClauses((prev) => [res.clause, ...prev]);
      }
      setShowForm(false);
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this clause?')) return;
    try {
      await deleteClause(id);
      setClauses((prev) => prev.filter((c) => c.id !== id));
    } catch { /* ignore */ }
  }

  if (loading) {
    return <div className="ads-cl__empty">Loading clauses...</div>;
  }

  return (
    <div className="ads-cl">
      <div className="ads-cl__head">
        <input
          className="ads-cl__search"
          type="text"
          placeholder="Search clauses..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="ads-cl__add" onClick={openNew} title="Add clause">+</button>
      </div>

      <div className="ads-cl__cats">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`ads-cl__cat${activeCat === cat ? ' active' : ''}`}
            onClick={() => setActiveCat(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="ads-cl__form">
          <input
            className="ads-cl__form-input"
            placeholder="Clause title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <select
            className="ads-cl__form-select"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {CATEGORIES.filter((c) => c !== 'All').map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <textarea
            className="ads-cl__form-textarea"
            placeholder="Clause text..."
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            rows={4}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
            <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={handleSave} disabled={saving || !form.title.trim() || !form.content.trim()}>
              {saving ? 'Saving...' : (editingId ? 'Update' : 'Save')}
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="ads-cl__empty">
          <div>No clauses found</div>
          <div className="ads-cl__empty-sub">Click + to add a reusable clause.</div>
        </div>
      ) : (
        <div className="ads-cl__list">
          {filtered.map((c) => (
            <div key={c.id} className="ads-cl__item">
              <div className="ads-cl__item-head">
                <span className="ads-cl__item-title">{c.title}</span>
                <span className="ads-cl__item-cat">{c.category}</span>
              </div>
              <div className="ads-cl__item-preview">{(c.content || '').substring(0, 120)}...</div>
              <div className="ads-cl__item-actions">
                <button className="ads-cl__item-btn" onClick={() => insertClause(c)} title="Insert at cursor">Insert</button>
                <button className="ads-cl__item-btn" onClick={() => openEdit(c)} title="Edit clause">Edit</button>
                <button className="ads-cl__item-btn ads-cl__item-btn--del" onClick={() => handleDelete(c.id)} title="Delete">Del</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ClauseLibrary;
