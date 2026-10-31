import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspaceStore } from '../stores/useWorkspaceStore.js';

/*
 * /workspaces — the dedicated management page. Phase 3 scaffold:
 *   * grid of active + archived workspaces
 *   * inline rename
 *   * archive / unarchive
 *   * "New workspace" modal with case metadata (name, case_no, court, type, facts)
 *   * "Open" → setCurrent + navigate /start
 *
 * Phase 8 adds member management and the facts/parties editor used by the
 * AI context builder.
 */

export default function WorkspacesPage() {
  const navigate = useNavigate();
  const { workspaces, currentWorkspaceId, loading, error, refresh, create, patch, archive, unarchive, setCurrent } = useWorkspaceStore();
  const [showArchived, setShowArchived] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [factsEditFor, setFactsEditFor] = useState(null);

  useEffect(() => {
    document.title = 'Workspaces — Lexamplify';
    refresh({ includeArchived: showArchived }).catch(() => {});
  }, [refresh, showArchived]);

  const open = (id) => {
    setCurrent(id);
    navigate('/start');
  };

  const startRename = (ws) => { setEditingId(ws.id); setEditName(ws.name); };
  const saveRename = async () => {
    if (!editingId) return;
    const next = editName.trim();
    if (next) await patch(editingId, { name: next });
    setEditingId(null); setEditName('');
  };

  return (
    <div className="workspaces-page">
      <header className="workspaces-page__head">
        <div>
          <h1>Workspaces</h1>
          <p className="workspaces-page__sub">
            One workspace per case. Everything you do inside it — drafts,
            contracts, calendar, vault — is scoped there and shared only with
            the people you invite.
          </p>
        </div>
        <div className="workspaces-page__actions">
          <label className="workspaces-page__toggle">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          <button type="button" className="workspaces-page__new-btn" onClick={() => setShowNew(true)}>
            New workspace
          </button>
        </div>
      </header>

      {error && <div className="workspaces-page__error" role="alert">{error}</div>}

      <div className="workspaces-page__grid">
        {loading && workspaces.length === 0 && (
          <div className="workspaces-page__empty">Loading…</div>
        )}
        {!loading && workspaces.length === 0 && (
          <div className="workspaces-page__empty">
            No workspaces yet. Click <b>New workspace</b> to create your first case.
          </div>
        )}
        {workspaces.map((ws) => (
          <article key={ws.id} className={`ws-card ${ws.status === 'archived' ? 'is-archived' : ''} ${ws.id === currentWorkspaceId ? 'is-current' : ''}`}>
            <header className="ws-card__head">
              {editingId === ws.id ? (
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={saveRename}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') { setEditingId(null); setEditName(''); } }}
                  autoFocus
                />
              ) : (
                <h3 onDoubleClick={() => startRename(ws)}>{ws.name}</h3>
              )}
              {ws.id === currentWorkspaceId && <span className="ws-card__badge">Current</span>}
              {ws.status === 'archived' && <span className="ws-card__badge ws-card__badge--archived">Archived</span>}
            </header>

            <dl className="ws-card__meta">
              {ws.case_no && (<><dt>Case no.</dt><dd>{ws.case_no}</dd></>)}
              {ws.court && (<><dt>Court</dt><dd>{ws.court}</dd></>)}
              {ws.case_type && (<><dt>Type</dt><dd>{ws.case_type}</dd></>)}
            </dl>

            <footer className="ws-card__footer">
              {ws.status === 'active' ? (
                <>
                  <button type="button" onClick={() => open(ws.id)}>Open</button>
                  <button type="button" onClick={() => startRename(ws)}>Rename</button>
                  <button type="button" onClick={() => setFactsEditFor(ws)}>Edit brief</button>
                  <button type="button" onClick={() => archive(ws.id).then(() => refresh({ includeArchived: showArchived }))}>Archive</button>
                </>
              ) : (
                <button type="button" onClick={() => unarchive(ws.id)}>Unarchive</button>
              )}
            </footer>
          </article>
        ))}
      </div>

      {showNew && (
        <NewWorkspaceModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refresh({ includeArchived: showArchived }); }}
          create={create}
        />
      )}

      {factsEditFor && (
        <FactsEditorModal
          ws={factsEditFor}
          onClose={() => setFactsEditFor(null)}
          onSaved={() => { setFactsEditFor(null); refresh({ includeArchived: showArchived }); }}
          patch={patch}
        />
      )}
    </div>
  );
}

function FactsEditorModal({ ws, onClose, onSaved, patch }) {
  const [facts, setFacts] = useState(ws.facts || '');
  const [parties, setParties] = useState(ws.parties || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await patch(ws.id, { facts: facts.trim() || null, parties: parties.trim() || null });
      onSaved?.();
    } catch (e2) {
      setErr(e2?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ws-modal" onClick={onClose}>
      <div className="ws-modal__card" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Workspace brief — {ws.name}</h2>
          <button type="button" className="ws-modal__close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <form onSubmit={submit}>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 4px' }}>
            The AI reads this on every prompt — parties, facts, charges,
            relevant sections. The more specific, the less you need to
            re-type each time.
          </p>
          <label>
            <span>Case facts</span>
            <textarea rows={7} value={facts} onChange={(e) => setFacts(e.target.value)}
                      placeholder="e.g. Petitioner Rohit Sharma; FIR 1234/2024 at Andheri PS; Section 420 IPC; …"
                      disabled={busy} />
          </label>
          <label>
            <span>Parties <em>(one per line)</em></span>
            <textarea rows={4} value={parties} onChange={(e) => setParties(e.target.value)}
                      placeholder="Petitioner: Rohit Sharma\nRespondent: State of Maharashtra\nOpposing counsel: Adv. Patel"
                      disabled={busy} />
          </label>
          {err && <div className="ws-modal__err" role="alert">{err}</div>}
          <footer>
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save brief'}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function NewWorkspaceModal({ onClose, onCreated, create }) {
  // Pipeline item 1 — workspace is per-CLIENT. The modal now collects
  // CLIENT info (contact, type, notes). Case metadata lives on each
  // matter inside the workspace instead.
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
      await create({
        name: form.name.trim(),
        client_type: form.client_type || null,
        client_email: form.client_email.trim() || null,
        client_phone: form.client_phone.trim() || null,
        client_address: form.client_address.trim() || null,
        client_notes: form.client_notes.trim() || null,
        facts: form.facts.trim() || null,
      });
      onCreated?.();
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
          <div className="ws-modal__row">
            <label>
              <span>Phone</span>
              <input type="tel" value={form.client_phone} onChange={update('client_phone')} placeholder="+91…" disabled={busy} />
            </label>
            <label>
              <span>Address</span>
              <input type="text" value={form.client_address} onChange={update('client_address')} placeholder="City, state" disabled={busy} />
            </label>
          </div>
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
