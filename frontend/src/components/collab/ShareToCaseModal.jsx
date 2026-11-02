import { useState, useEffect, useCallback } from 'react';
import Modal from '../Modal.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/*
 * Universal Share dialog — plan phase 4 (plans/compiled-scribbling-scott.md).
 *
 * Mounted by every tool that produces a shareable resource (Contract
 * Analyzer first; Vault / Drafts / Document Hub next). Consumer of the
 * shared components/Modal.jsx — same shell every other dialog uses.
 *
 * Props:
 *   resource      = { type, id, name }   REQUIRED
 *                   `type`  = resource_type sent to the API
 *                   `id`    = the backend row id / stringified key
 *                   `name`  = user-facing label, "Lease Agreement v3"
 *   defaultCaseId = number | null         pre-selects a case when the
 *                                         resource already lives in one
 *                                         (spec §7.3.2).
 *   onClose       = () => void
 *   onShared      = (serverResponse) => void   fired after a successful share
 *
 * Server contract (POST /api/collab/share):
 *   { case_id, resource_type, resource_id, recipient_user_ids:[], body }
 * On 403 with code=RECIPIENT_INELIGIBLE, the body carries blocked_user_ids —
 * we surface those by name so the user can remove them before retrying.
 */
export default function ShareToCaseModal({ resource, defaultCaseId, onClose, onShared }) {
  const [cases, setCases] = useState([]);
  const [caseId, setCaseId] = useState(defaultCaseId || null);
  const [recipients, setRecipients] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // Fetch the user's cases once. We lean on the Practice /api/practice/
  // cases endpoint because it already returns cases the user can see
  // (workspace-scoped, authorization-checked) — the same list the
  // Matters tab pulls.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/practice/cases?per_page=100&sort=next_hearing`, {
          credentials: 'include',
        });
        const j = await r.json().catch(() => ({ cases: [] }));
        if (!cancelled) setCases(Array.isArray(j.cases) ? j.cases : (j.items || []));
      } catch { /* leave list empty */ } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch the eligible-recipients list whenever the chosen case changes.
  const loadRecipients = useCallback(async (cid) => {
    if (!cid) { setRecipients([]); setSelectedIds([]); return; }
    try {
      const r = await fetch(`${API_BASE}/api/collab/cases/${cid}/eligible-recipients`, {
        credentials: 'include',
      });
      const j = await r.json().catch(() => ({ recipients: [] }));
      setRecipients(Array.isArray(j.recipients) ? j.recipients : []);
      // Clear previously-selected recipients that aren't eligible on the
      // new case — otherwise the share will 403.
      setSelectedIds((prev) => prev.filter((id) => (j.recipients || []).some((r) => r.user_id === id)));
    } catch { setRecipients([]); }
  }, []);

  useEffect(() => { loadRecipients(caseId); }, [caseId, loadRecipients]);

  const toggleRecipient = (uid) =>
    setSelectedIds((prev) => (prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]));

  const selectAll = () => setSelectedIds(recipients.map((r) => r.user_id));
  const selectNone = () => setSelectedIds([]);

  const submit = async (e) => {
    e?.preventDefault?.();
    setErr('');
    if (!caseId) { setErr('Pick a case to share into.'); return; }
    if (selectedIds.length === 0) { setErr('Pick at least one recipient.'); return; }
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/collab/share`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({
          case_id: caseId,
          resource_type: resource.type,
          resource_id: String(resource.id),
          recipient_user_ids: selectedIds,
          body: body.trim(),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j.code === 'RECIPIENT_INELIGIBLE' && Array.isArray(j.blocked_user_ids)) {
          const names = j.blocked_user_ids
            .map((uid) => recipients.find((rec) => rec.user_id === uid)?.name || `User ${uid}`)
            .join(', ');
          throw new Error(`These recipients don't have access to this case: ${names}. Remove them or add them to the case first.`);
        }
        throw new Error(j.message || `Share failed (HTTP ${r.status}).`);
      }
      onShared?.(j);
      onClose?.();
    } catch (e2) {
      setErr(e2.message || 'Could not share.');
    } finally {
      setBusy(false);
    }
  };

  const selectedCase = cases.find((c) => c.id === caseId);

  return (
    <Modal
      title="Share with a case"
      onClose={busy ? () => {} : onClose}
      footer={<>
        <button type="button" className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="lx-btn lx-btn--primary" onClick={submit} disabled={busy || !caseId || selectedIds.length === 0}>
          {busy ? 'Sharing…' : 'Share'}
        </button>
      </>}
    >
      {err && <div role="alert" style={{ marginBottom: 10, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}

      {/* 1. What is being shared */}
      <div style={{ padding: '10px 12px', background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {resource.type.replace('_', ' ')}
        </div>
        <div style={{ fontSize: 14, color: 'var(--ink)', marginTop: 2 }}>{resource.name || `${resource.type}:${resource.id}`}</div>
      </div>

      {/* 2. Case picker */}
      <div style={{ marginBottom: 14 }}>
        <label className="lbl">Share into case</label>
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading your cases…</div>
        ) : (
          <select
            className="inp"
            value={caseId || ''}
            onChange={(e) => setCaseId(e.target.value ? Number(e.target.value) : null)}
            disabled={busy}
          >
            <option value="">Pick a case…</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title || 'Untitled matter'}{c.case_no ? ` · ${c.case_no}` : ''}
              </option>
            ))}
          </select>
        )}
        {defaultCaseId && selectedCase && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            This resource is already linked to this case.
          </div>
        )}
      </div>

      {/* 3. Recipients */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <label className="lbl">Share with</label>
          {recipients.length > 0 && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={selectAll} style={{ fontSize: 11, border: 'none', background: 'transparent', color: 'var(--accent)', cursor: 'pointer' }}>Select all</button>
              <button type="button" onClick={selectNone} style={{ fontSize: 11, border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>Clear</button>
            </div>
          )}
        </div>
        {!caseId ? (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: 10 }}>Pick a case to see who can be shared with.</div>
        ) : recipients.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: 10 }}>No one else is on this case yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
            {recipients.map((r) => (
              <label key={r.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: selectedIds.includes(r.user_id) ? 'rgba(178, 74, 46, 0.06)' : 'transparent' }}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(r.user_id)}
                  onChange={() => toggleRecipient(r.user_id)}
                  disabled={busy}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink)' }}>{r.name || `User ${r.user_id}`}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.email || r.role || ''}</div>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* 4. Optional message */}
      <div style={{ marginBottom: 10 }}>
        <label className="lbl">Message (optional)</label>
        <textarea
          className="inp"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Please review the liability clauses before tomorrow's hearing."
          rows={3}
          disabled={busy}
          style={{ resize: 'vertical' }}
        />
      </div>
    </Modal>
  );
}
