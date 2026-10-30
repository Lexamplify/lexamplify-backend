import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../dochub/ui.jsx';
import { PIcon } from './icons.jsx';
import { ApiError, doneWith, pr } from './api.js';
import { usePractice } from './ctx.js';
import { ErrText, Field, Spinner, useDebouncedValue } from './widgets.jsx';
import { CLOSED, emptyToNull, human, istToday } from './util.js';

// Members who can be the advocate on a case (office staff cannot).
export function useAdvocates() {
  const { members } = usePractice();
  return useMemo(() => (members || []).filter((m) => m.role !== 'staff' && m.active), [members]);
}

// ── client picker: search existing, or fill in a new one on the spot ────────────────────
export function ClientPicker({ value, onChange, newClient, onNewClient, disabled }) {
  const [q, setQ] = useState('');
  const dq = useDebouncedValue(q, 250);
  const [res, setRes] = useState(null);

  useEffect(() => {
    if (value || newClient) return undefined;
    let dead = false;
    pr.get('/clients', { q: dq.trim(), per_page: 6 }).then((d) => { if (!dead) setRes(d.clients); }).catch(() => { if (!dead) setRes([]); });
    return () => { dead = true; };
  }, [dq, value, newClient]);

  if (value) {
    return (
      <div className="pr-picked">
        <PIcon name="user" /><span>{value.name}</span>
        {!disabled ? <button type="button" className="dh-btn quiet sm" onClick={() => onChange(null)}>Change</button> : null}
      </div>
    );
  }
  if (newClient) {
    const set = (k) => (e) => onNewClient({ ...newClient, [k]: e.target.value });
    return (
      <div className="pr-form">
        <input className="dh-input" placeholder="Client's full name" value={newClient.name} onChange={set('name')} aria-label="New client name" maxLength={160} style={{ marginBottom: 8 }} />
        <div className="row2">
          <input className="dh-input" placeholder="Phone (for WhatsApp)" value={newClient.phone} onChange={set('phone')} aria-label="New client phone" inputMode="tel" maxLength={30} />
          <input className="dh-input" placeholder="Email (optional)" value={newClient.email} onChange={set('email')} aria-label="New client email" inputMode="email" maxLength={160} />
        </div>
        <button type="button" className="dh-btn quiet sm" style={{ justifySelf: 'start', marginTop: 6 }} onClick={() => onNewClient(null)}>Pick an existing client instead</button>
      </div>
    );
  }
  return (
    <div className="pr-picker">
      <input className="dh-input" placeholder="Search clients by name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clients" disabled={disabled} />
      <div className="list">
        {res === null ? <div style={{ padding: 10 }} className="pr-muted">Searching…</div> : null}
        {res && res.map((c) => (
          <button type="button" key={c.id} onClick={() => onChange({ id: c.id, name: c.name })}>
            {c.name}<small>{[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details'}</small>
          </button>
        ))}
        {res && !res.length ? <div style={{ padding: 10 }} className="pr-muted">{dq.trim() ? 'No client matches.' : 'No clients yet.'}</div> : null}
        <button type="button" onClick={() => onNewClient({ name: q.trim(), phone: '', email: '' })} style={{ color: 'var(--accent)', fontWeight: 600, borderTop: '1px solid var(--rule)' }}>
          + Add a new client{q.trim() ? ` “${q.trim()}”` : ''}
        </button>
      </div>
    </div>
  );
}

// ── case form (create + edit) ─────────────────────────────────────────────────────────────
const BLANK = {
  case_no: '', court: '', title: '', case_type: 'Civil', category: '', filing_date: '', reg_no: '', hall_no: '', judge: '', opposite_party: '',
  advocate_id: '', priority: 'normal', status: 'Active', next_action: '', next_action_due: '', remarks: '', restricted: false,
};
const LIMITED = ['status', 'next_action', 'next_action_due', 'remarks', 'hall_no', 'judge'];

export function CaseForm({ existing, onClose, onSaved }) {
  const { me, perms, meta, toast } = usePractice();
  const advocates = useAdvocates();
  const editing = !!existing;
  const limited = editing && existing.level === 'limited';
  const base = useMemo(() => (editing ? {
    ...BLANK, ...Object.fromEntries(Object.keys(BLANK).map((k) => [k, existing[k] ?? BLANK[k]])), advocate_id: existing.advocate_id ? String(existing.advocate_id) : '', restricted: !!existing.restricted,
  } : { ...BLANK, advocate_id: me.member.role === 'staff' ? '' : String(me.member.id) }), [editing, existing, me]);
  const [f, setF] = useState(base);
  const [client, setClient] = useState(editing && existing.client_id ? { id: existing.client_id, name: existing.client_name } : null);
  const [newClient, setNewClient] = useState(null);
  const [hearing, setHearing] = useState({ date: '', time: '', purpose: '' });
  const [facets, setFacets] = useState({ courts: [], categories: [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dup, setDup] = useState(false);

  useEffect(() => {
    pr.get('/cases', { per_page: 1, archived: 'all' }).then((d) => setFacets(d.facets || { courts: [], categories: [] })).catch(() => {});
  }, []);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const can = (k) => !limited || LIMITED.includes(k);
  const canAssign = perms.assign_case;

  const submit = async (e, force = false) => {
    e?.preventDefault();
    setErr('');
    if (!editing && !f.case_no.trim()) { setErr('Enter the case number.'); return; }
    if (!f.title.trim()) { setErr('Give the case a title, for example “Kumar vs State of Telangana”.'); return; }
    if (editing && !f.court.trim()) { setErr('Enter the court.'); return; }
    if (newClient && !newClient.name.trim()) { setErr('Enter the new client\'s name, or pick an existing client.'); return; }
    setBusy(true);
    try {
      let body;
      if (editing) {
        body = {};
        Object.keys(BLANK).forEach((k) => {
          if (!can(k)) return;
          if (k === 'advocate_id' && !canAssign) return;
          if (k === 'restricted' && !perms.archive_case) return;
          const a = f[k]; const b = base[k];
          if (a !== b) body[k] = a === '' ? null : a;
        });
        if (client?.id !== (existing.client_id || undefined) && !limited) body.client_id = client ? client.id : null;
        if (!Object.keys(body).length) { onClose(); return; }
        if (force) body.force = true;
        const r = await pr.patch(`/cases/${existing.id}`, body);
        toast('Case updated');
        onSaved(r.case);
      } else {
        body = { ...emptyToNull(f), restricted: !!f.restricted, advocate_id: f.advocate_id ? Number(f.advocate_id) : null };
        if (client) body.client_id = client.id; else if (newClient) body.client = emptyToNull(newClient);
        if (hearing.date) body.first_hearing = emptyToNull(hearing);
        if (force) body.force = true;
        const r = await pr.post('/cases', body);
        (r.warnings || []).forEach((w) => toast(w));
        toast(`Case ${r.case.case_no} created`);
        onSaved(r.case, true);
      }
    } catch (e2) {
      if (e2 instanceof ApiError && e2.extra?.code === 'DUPLICATE_CASE') { setDup(true); setErr(e2.message); } else { setErr(doneWith(e2)); setDup(false); }
    } finally { setBusy(false); }
  };

  return (
    <Modal title={editing ? 'Edit case' : 'New case'} onClose={busy ? () => {} : onClose}
      footer={(
        <>
          <button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          {dup ? <button type="button" className="dh-btn danger" onClick={(e) => submit(e, true)} disabled={busy}>Save anyway</button> : null}
          <button type="submit" form="pr-case-form" className="dh-btn primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create case'}</button>
        </>
      )}>
      <form id="pr-case-form" className="pr-form" onSubmit={submit} noValidate>
        <ErrText>{err}</ErrText>
        {limited ? <div className="dh-banner plain" style={{ marginBottom: 14 }}><PIcon name="lock" /><div className="body">You can update the status, next action, remarks, hall and judge on this case. A Senior Advocate can change the rest.</div></div> : null}
        <fieldset disabled={busy}>
          <legend>The case</legend>
          <div className="row2">
            <Field label="Case number" required><input className="dh-input" value={f.case_no} onChange={set('case_no')} placeholder="e.g. OS 123/2025" disabled={!can('case_no')} maxLength={80} autoFocus={!editing} /></Field>
            <Field label="Court" required={editing} hint={editing ? undefined : 'Leave blank to use your practice\'s default court (set in Settings).'}>
              <input className="dh-input" value={f.court} onChange={set('court')} list="pr-courts" placeholder="e.g. City Civil Court, Hyderabad" disabled={!can('court')} maxLength={160} />
              <datalist id="pr-courts">{facets.courts.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
          </div>
          <Field label="Case title" required><input className="dh-input" value={f.title} onChange={set('title')} placeholder="Parties, e.g. Kumar vs State" disabled={!can('title')} maxLength={200} /></Field>
          <div className="row3">
            <Field label="Case type"><select className="dh-select" value={f.case_type} onChange={set('case_type')} disabled={!can('case_type')}>{meta.case_types.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Category"><input className="dh-input" value={f.category} onChange={set('category')} list="pr-cats" placeholder="e.g. Property, Motor accident" disabled={!can('category')} maxLength={60} /><datalist id="pr-cats">{facets.categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
            <Field label="Filing date"><input type="date" className="dh-input" value={f.filing_date || ''} onChange={set('filing_date')} disabled={!can('filing_date')} /></Field>
          </div>
          <div className="row3">
            <Field label="Registration no."><input className="dh-input" value={f.reg_no} onChange={set('reg_no')} disabled={!can('reg_no')} maxLength={80} /></Field>
            <Field label="Court hall"><input className="dh-input" value={f.hall_no} onChange={set('hall_no')} disabled={!can('hall_no')} maxLength={30} /></Field>
            <Field label="Judge"><input className="dh-input" value={f.judge} onChange={set('judge')} disabled={!can('judge')} maxLength={120} /></Field>
          </div>
          <Field label="Opposite party"><input className="dh-input" value={f.opposite_party} onChange={set('opposite_party')} disabled={!can('opposite_party')} maxLength={200} /></Field>
        </fieldset>

        <fieldset disabled={busy}>
          <legend>People</legend>
          <Field label="Client"><ClientPicker value={client} onChange={setClient} newClient={newClient} onNewClient={setNewClient} disabled={limited} /></Field>
          <div className="row2">
            <Field label="Advocate in charge">
              <select className="dh-select" value={f.advocate_id} onChange={set('advocate_id')} disabled={!canAssign && (editing || me.member.role === 'junior')}>
                <option value="">Unassigned</option>
                {advocates.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role_label})</option>)}
              </select>
            </Field>
            <Field label="Priority"><select className="dh-select" value={f.priority} onChange={set('priority')} disabled={!can('priority')}>{meta.priorities.map((p) => <option key={p} value={p}>{human(p)}</option>)}</select></Field>
          </div>
        </fieldset>

        <fieldset disabled={busy}>
          <legend>Status & next steps</legend>
          <div className="row3">
            <Field label="Status"><select className="dh-select" value={f.status} onChange={set('status')}>{meta.statuses.map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Next action"><input className="dh-input" value={f.next_action} onChange={set('next_action')} placeholder="e.g. File written statement" maxLength={200} /></Field>
            <Field label="Action due"><input type="date" className="dh-input" value={f.next_action_due || ''} onChange={set('next_action_due')} /></Field>
          </div>
          <Field label="Remarks"><textarea className="dh-textarea" value={f.remarks} onChange={set('remarks')} rows={3} maxLength={4000} /></Field>
        </fieldset>

        {!editing ? (
          <fieldset disabled={busy}>
            <legend>First hearing (optional)</legend>
            <div className="row3">
              <Field label="Date"><input type="date" className="dh-input" value={hearing.date} onChange={(e) => setHearing({ ...hearing, date: e.target.value })} /></Field>
              <Field label="Time"><input type="time" className="dh-input" value={hearing.time} onChange={(e) => setHearing({ ...hearing, time: e.target.value })} /></Field>
              <Field label="Purpose"><input className="dh-input" value={hearing.purpose} onChange={(e) => setHearing({ ...hearing, purpose: e.target.value })} placeholder="e.g. Arguments" maxLength={200} /></Field>
            </div>
          </fieldset>
        ) : null}

        {perms.archive_case ? (
          <label className="dh-check" style={{ marginBottom: 4 }}>
            <input type="checkbox" checked={f.restricted} onChange={set('restricted')} disabled={busy} />
            <span><b style={{ color: 'var(--ink)' }}>Confidential case</b> — only Senior Advocates and the advocate in charge can see it.</span>
          </label>
        ) : null}
        {CLOSED.includes(f.status) && editing && !CLOSED.includes(existing.status) ? <p className="pr-note">Saving with this status closes the case. You can reopen it later by changing the status back.</p> : null}
      </form>
    </Modal>
  );
}

// ── client form ─────────────────────────────────────────────────────────────────────────
export function ClientForm({ existing, onClose, onSaved }) {
  const { meta, toast } = usePractice();
  const editing = !!existing;
  const [f, setF] = useState({
    name: existing?.name || '', phone: existing?.phone || '', email: existing?.email || '', address: existing?.address || '', occupation: existing?.occupation || '',
    comm_pref: existing?.comm_pref || 'whatsapp', id_type: existing?.id_type || '', id_number: existing?.id_number || '', notes: existing?.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dup, setDup] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e, force = false) => {
    e?.preventDefault();
    setErr('');
    if (!f.name.trim()) { setErr('Enter the client\'s name.'); return; }
    setBusy(true);
    try {
      const body = emptyToNull(f);
      if (force) body.force = true;
      const r = editing ? await pr.patch(`/clients/${existing.id}`, body) : await pr.post('/clients', body);
      toast(editing ? 'Client updated' : 'Client added');
      onSaved(r.client);
    } catch (e2) {
      if (e2 instanceof ApiError && e2.extra?.code === 'DUPLICATE_CLIENT') setDup(e2.extra.existing);
      setErr(doneWith(e2));
    } finally { setBusy(false); }
  };

  return (
    <Modal title={editing ? 'Edit client' : 'New client'} onClose={busy ? () => {} : onClose}
      footer={(
        <>
          <button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          {dup ? <button type="button" className="dh-btn danger" onClick={(e) => submit(e, true)} disabled={busy}>Save anyway</button> : null}
          <button type="submit" form="pr-client-form" className="dh-btn primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add client'}</button>
        </>
      )}>
      <form id="pr-client-form" className="pr-form" onSubmit={submit} noValidate>
        <ErrText>{err}</ErrText>
        <Field label="Full name" required><input className="dh-input" value={f.name} onChange={set('name')} autoFocus maxLength={160} /></Field>
        <div className="row2">
          <Field label="Phone" hint="Used for the WhatsApp reminder link."><input className="dh-input" value={f.phone} onChange={set('phone')} inputMode="tel" maxLength={30} /></Field>
          <Field label="Email"><input className="dh-input" value={f.email} onChange={set('email')} inputMode="email" maxLength={160} /></Field>
        </div>
        <Field label="Address"><textarea className="dh-textarea" value={f.address} onChange={set('address')} rows={2} maxLength={500} /></Field>
        <div className="row3">
          <Field label="Occupation"><input className="dh-input" value={f.occupation} onChange={set('occupation')} maxLength={120} /></Field>
          <Field label="Prefers"><select className="dh-select" value={f.comm_pref} onChange={set('comm_pref')}>{meta.comm_prefs.map((p) => <option key={p} value={p}>{human(p)}</option>)}</select></Field>
          <Field label="ID type"><select className="dh-select" value={f.id_type || ''} onChange={set('id_type')}><option value="">None</option>{meta.id_types.map((p) => <option key={p}>{p}</option>)}</select></Field>
        </div>
        {f.id_type ? <Field label="ID number" hint="Shown masked in lists."><input className="dh-input" value={f.id_number} onChange={set('id_number')} maxLength={60} /></Field> : null}
        <Field label="Notes"><textarea className="dh-textarea" value={f.notes} onChange={set('notes')} rows={3} maxLength={3000} /></Field>
      </form>
    </Modal>
  );
}

// ── party ───────────────────────────────────────────────────────────────────────────────
export function PartyModal({ caseId, existing, onClose, onSaved }) {
  const { meta, toast } = usePractice();
  const [f, setF] = useState({ role: existing?.role || 'petitioner', name: existing?.name || '', contact: existing?.contact || '', notes: existing?.notes || '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) { setErr('Enter a name.'); return; }
    setBusy(true); setErr('');
    try {
      if (existing) await pr.patch(`/parties/${existing.id}`, emptyToNull(f)); else await pr.post(`/cases/${caseId}/parties`, emptyToNull(f));
      toast(existing ? 'Party updated' : 'Party added');
      onSaved();
    } catch (e2) { setErr(doneWith(e2)); } finally { setBusy(false); }
  };
  return (
    <Modal small title={existing ? 'Edit party' : 'Add a party'} onClose={busy ? () => {} : onClose}
      footer={(<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="pr-party-form" className="dh-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>)}>
      <form id="pr-party-form" onSubmit={submit} noValidate>
        <ErrText>{err}</ErrText>
        <Field label="Role"><select className="dh-select" value={f.role} onChange={set('role')}>{meta.party_roles.map((r) => <option key={r} value={r}>{human(r)}</option>)}</select></Field>
        <Field label="Name" required><input className="dh-input" value={f.name} onChange={set('name')} autoFocus maxLength={160} /></Field>
        <Field label="Contact"><input className="dh-input" value={f.contact} onChange={set('contact')} maxLength={120} placeholder="Phone or email" /></Field>
        <Field label="Notes"><textarea className="dh-textarea" value={f.notes} onChange={set('notes')} rows={2} maxLength={500} /></Field>
      </form>
    </Modal>
  );
}

// ── follow-up ───────────────────────────────────────────────────────────────────────────
export function FollowupModal({ caseId, clientId, onClose, onSaved }) {
  const { members, me, meta, toast } = usePractice();
  const [f, setF] = useState({ note: '', due_date: istToday(), assignee_id: String(me.member.id), channel: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (!f.note.trim()) { setErr('Write what needs to be done.'); return; }
    setBusy(true); setErr('');
    try {
      await pr.post('/followups', { ...emptyToNull(f), assignee_id: Number(f.assignee_id), case_id: caseId || null, client_id: clientId || null });
      toast('Follow-up added');
      onSaved();
    } catch (e2) { setErr(doneWith(e2)); } finally { setBusy(false); }
  };
  return (
    <Modal small title="Set a follow-up" onClose={busy ? () => {} : onClose}
      footer={(<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="pr-fu-form" className="dh-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Add follow-up'}</button></>)}>
      <form id="pr-fu-form" onSubmit={submit} noValidate>
        <ErrText>{err}</ErrText>
        <Field label="What needs to be done" required><textarea className="dh-textarea" rows={2} value={f.note} onChange={set('note')} autoFocus maxLength={500} placeholder="e.g. Call about the affidavit" /></Field>
        <div className="row2 dh-row2">
          <Field label="Due"><input type="date" className="dh-input" value={f.due_date} onChange={set('due_date')} /></Field>
          <Field label="Channel"><select className="dh-select" value={f.channel} onChange={set('channel')}><option value="">Any</option>{meta.comm_channels.filter((c) => c !== 'note').map((c) => <option key={c} value={c}>{human(c)}</option>)}</select></Field>
        </div>
        <Field label="Who does it"><select className="dh-select" value={f.assignee_id} onChange={set('assignee_id')}>{(members || []).filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
      </form>
    </Modal>
  );
}

export { Spinner };
