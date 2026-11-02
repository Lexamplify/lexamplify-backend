import { useState } from 'react';

/*
 * The ONE modal used to create a new client workspace. Previously the
 * same form lived twice (as an inner function in WorkspacesPage.jsx AND
 * as a bare inline name-only input in WorkspaceSwitcher.jsx), which the
 * user correctly flagged as inconsistent — the switcher's "+ Add client"
 * only asked for a name, the /workspaces page asked for the full
 * contact + facts form. Centralising here fixes that: both call sites
 * mount this component and get the identical experience.
 *
 * Props:
 *   onClose(): closes the modal.
 *   onCreated(created): called after a successful create, with the
 *     resolved workspace. Used by the switcher to auto-select the new
 *     client, and by the page to refresh its grid.
 *   create(payload): a mutation function (from useWorkspaceStore) —
 *     passed by the caller so this component stays unaware of the
 *     network layer.
 */
export default function NewWorkspaceModal({ onClose, onCreated, create }) {
  const [form, setForm] = useState({
    name: '', client_type: 'Individual',
    client_email: '', client_phone: '', client_address: '',
    client_notes: '', facts: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setErr('Client name is required.'); return; }
    setBusy(true); setErr('');
    try {
      const created = await create({
        name: form.name.trim(),
        client_type: form.client_type || null,
        client_email: form.client_email.trim() || null,
        client_phone: form.client_phone.trim() || null,
        client_address: form.client_address.trim() || null,
        client_notes: form.client_notes.trim() || null,
        facts: form.facts.trim() || null,
      });
      onCreated?.(created);
    } catch (e2) {
      setErr(e2?.message || 'Could not create client workspace.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ws-modal" onClick={onClose}>
      <div className="ws-modal__card" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Add a client</h2>
          <button type="button" className="ws-modal__close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <form onSubmit={submit}>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 4px' }}>
            A workspace = one client. All their matters, contracts,
            drafts and calendar entries live inside this workspace. Add
            individual cases from the Matters tab after you create it.
          </p>
          <label>
            <span>Client name <em>(required)</em></span>
            <input type="text" value={form.name} onChange={update('name')} placeholder="Rohit Sharma  /  Acme Industries Pvt. Ltd." autoFocus disabled={busy} />
          </label>
          <div className="ws-modal__row">
            <label>
              <span>Client type</span>
              <select value={form.client_type} onChange={update('client_type')} disabled={busy}>
                <option>Individual</option>
                <option>Corporate</option>
                <option>Government</option>
                <option>Trust</option>
                <option>Other</option>
              </select>
            </label>
            <label>
              <span>Email</span>
              <input type="email" value={form.client_email} onChange={update('client_email')} placeholder="client@example.com" disabled={busy} />
            </label>
          </div>
          <label>
            <span>Phone</span>
            <input type="tel" value={form.client_phone} onChange={update('client_phone')} placeholder="+91…" disabled={busy} />
          </label>
          <label>
            {/* Full postal address — building / plot / street / area /
                city / state / pincode. Multi-line because a corporate
                client's registered address or an individual's full
                postal address rarely fits in one line, and squeezing it
                into a single input was the user's complaint. */}
            <span>Address <em>(full postal address)</em></span>
            <textarea
              rows={3}
              value={form.client_address}
              onChange={update('client_address')}
              placeholder={'Plot 14, MIDC Industrial Area,\nBhiwandi, Thane 421302,\nMaharashtra, India'}
              disabled={busy}
              style={{ resize: 'vertical' }}
            />
          </label>
          <label>
            <span>Client / matter facts <em>(AI uses this)</em></span>
            <textarea rows={5} value={form.facts} onChange={update('facts')}
              placeholder="Background about this client and the general nature of their matters — the AI uses this to think from their perspective on every reply."
              disabled={busy} />
          </label>
          <label>
            <span>Internal notes</span>
            <textarea rows={2} value={form.client_notes} onChange={update('client_notes')}
              placeholder="Billing, retainer, points of contact, caveats…" disabled={busy} />
          </label>
          {err && <div className="ws-modal__err" role="alert">{err}</div>}
          <footer>
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" disabled={busy || !form.name.trim()}>{busy ? 'Creating…' : 'Create client workspace'}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
