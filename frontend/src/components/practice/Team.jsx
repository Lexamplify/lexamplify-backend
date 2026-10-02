import { useState } from 'react';
import { Confirm, Modal } from '../dochub/ui.jsx';
import { fmtAgo } from '../dochub/format.js';
import { PIcon } from './icons.jsx';
import { ApiError, doneWith, pr } from './api.js';
import { usePractice } from './ctx.js';
import { Avatar, Card, ErrText, ErrorBox, Field, Loading, PageHead, Toggle, useAsync } from './widgets.jsx';
import { emptyToNull, plural } from './util.js';

const ROLE_HELP = {
  senior: 'Sees every case, creates cases and accounts, runs all reports and settings.',
  junior: 'Records proceedings and notes on assigned cases, uploads documents.',
  staff: 'Appointments, client details, document filing and a few reports.',
};

function AddMember({ onClose, onSaved }) {
  const { meta, toast } = usePractice();
  const [f, setF] = useState({ name: '', email: '', phone: '', role: 'junior', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [link, setLink] = useState(null);
  const [made, setMade] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const gen = () => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const v = crypto.getRandomValues(new Uint32Array(10)); setF((s) => ({ ...s, password: [...v].map((x) => a[x % a.length]).join('') })); };
  const submit = async (e, linkExisting = false) => {
    e?.preventDefault();
    if (!f.email.trim()) { setErr('Enter their email address.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await pr.post('/members', { ...emptyToNull(f), link_existing: linkExisting });
      onSaved(); if (r.managed) setMade({ email: f.email.trim(), password: f.password, name: f.name }); else { toast('Added to your practice'); onClose(); }
    } catch (e2) {
      if (e2 instanceof ApiError && e2.extra?.code === 'EXISTS') setLink(e2.extra.existing_name || 'this person'); else setErr(doneWith(e2));
    } finally { setBusy(false); }
  };
  const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast('Could not copy. Select the text and copy it.', { tone: 'bad' }); } };

  if (made) {
    return (
      <Modal small title="Account created" onClose={onClose} footer={<button type="button" className="dh-btn primary" onClick={onClose}>Done</button>}>
        <p style={{ marginTop: 0 }}>Give {made.name || 'them'} these sign-in details. <b>Nothing has been emailed.</b> They should change the password after their first sign-in.</p>
        <dl className="pr-kv" style={{ gridTemplateColumns: '90px minmax(0,1fr)' }}>
          <dt>Email</dt><dd className="pr-mono">{made.email}</dd>
          <dt>Password</dt><dd className="pr-mono">{made.password}</dd>
        </dl>
        <div className="pr-actions" style={{ marginTop: 12 }}><button type="button" className="dh-btn ghost sm" onClick={() => copy(`Email: ${made.email}\nPassword: ${made.password}`)}><PIcon name="copy" />Copy both</button></div>
      </Modal>
    );
  }
  return (
    <Modal small title="Add a team member" onClose={busy ? () => {} : onClose}
      footer={(<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>{link ? <button type="button" className="dh-btn primary" onClick={(e) => submit(e, true)} disabled={busy}>Add {link} to my practice</button> : <button type="submit" form="pr-add-member" className="dh-btn primary" disabled={busy}>{busy ? 'Adding…' : 'Add member'}</button>}</>)}>
      <form id="pr-add-member" onSubmit={submit} noValidate>
        <ErrText>{err}</ErrText>
        {link ? <div className="dh-banner" style={{ marginBottom: 12 }}><PIcon name="info" /><div className="body"><b>{f.email}</b> already has a LexAmplify account. You can add them to your practice and they will keep their own password.</div></div> : null}
        <Field label="Email" required><input className="dh-input" type="email" value={f.email} onChange={(e) => { set('email')(e); setLink(null); }} autoFocus maxLength={160} /></Field>
        <Field label="Full name" hint="Needed for a new account."><input className="dh-input" value={f.name} onChange={set('name')} maxLength={120} /></Field>
        <Field label="Role" hint={ROLE_HELP[f.role]}><select className="dh-select" value={f.role} onChange={set('role')}>{meta.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></Field>
        <Field label="Phone (optional)"><input className="dh-input" value={f.phone} onChange={set('phone')} inputMode="tel" maxLength={30} /></Field>
        {!link ? (
          <Field label="Temporary password" hint="At least 8 characters. Only needed if they do not have an account yet.">
            <div style={{ display: 'flex', gap: 8 }}><input className="dh-input" value={f.password} onChange={set('password')} autoComplete="new-password" maxLength={100} /><button type="button" className="dh-btn ghost" onClick={gen}>Generate</button></div>
          </Field>
        ) : null}
      </form>
    </Modal>
  );
}

function EditMember({ m, self, onClose, onSaved }) {
  const { meta, toast } = usePractice();
  const [f, setF] = useState({ name: m.name, phone: m.phone || '', role: m.role, active: m.active });
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [confirmMfa, setConfirmMfa] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault(); setBusy('save'); setErr('');
    try {
      const r = await pr.patch(`/members/${m.id}`, { ...f, phone: f.phone || null });
      toast(r.orphaned_cases ? `Saved. ${plural(r.orphaned_cases, 'open case')} still assigned to ${m.name} — reassign them.` : 'Saved', { ms: r.orphaned_cases ? 8000 : undefined });
      onSaved();
    } catch (e2) { setErr(doneWith(e2)); } finally { setBusy(''); }
  };
  const resetPw = async () => {
    if (pw.length < 8) { setErr('The new password must be at least 8 characters.'); return; }
    setBusy('pw'); setErr('');
    try { await pr.post(`/members/${m.id}/password`, { password: pw }); toast('Password changed. Share it with them in person; nothing was emailed.'); setPw(''); } catch (e2) { setErr(doneWith(e2)); } finally { setBusy(''); }
  };
  const resetMfa = async () => {
    setBusy('mfa');
    try { await pr.post(`/members/${m.id}/mfa-reset`); toast('Two-step sign-in reset'); setConfirmMfa(false); onSaved(); } catch (e2) { setErr(doneWith(e2)); setConfirmMfa(false); } finally { setBusy(''); }
  };
  return (
    <>
      <Modal title={`Edit ${m.name}`} onClose={busy ? () => {} : onClose}
        footer={(<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={!!busy}>Close</button><button type="submit" form="pr-edit-member" className="dh-btn primary" disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button></>)}>
        <form id="pr-edit-member" onSubmit={save} noValidate>
          <ErrText>{err}</ErrText>
          <div className="dh-row2"><Field label="Name"><input className="dh-input" value={f.name} onChange={set('name')} maxLength={120} /></Field><Field label="Phone"><input className="dh-input" value={f.phone} onChange={set('phone')} maxLength={30} /></Field></div>
          <Field label="Role" hint={ROLE_HELP[f.role]}><select className="dh-select" value={f.role} onChange={set('role')}>{meta.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></Field>
          <div className="pr-switch"><div className="tx"><b>Active</b><span>{self ? 'You cannot deactivate yourself here.' : 'Inactive people cannot open the practice. Their history stays.'}</span></div><Toggle checked={f.active} onChange={(v) => setF((s) => ({ ...s, active: v }))} label="Active" disabled={self} /></div>
        </form>
        <hr className="pr-sep" />
        <h4 className="pr-tabletitle">Sign-in</h4>
        {m.managed ? (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input className="dh-input" type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (8+ characters)" autoComplete="new-password" aria-label="New password" />
            <button type="button" className="dh-btn ghost" onClick={resetPw} disabled={!!busy}>{busy === 'pw' ? 'Saving…' : 'Set password'}</button>
          </div>
        ) : <p className="pr-note" style={{ marginTop: 0 }}>{m.name} had their own account before joining, so only they can change its password (“Forgot password” on the sign-in page).</p>}
        <div className="pr-actions">
          <span className="pr-pill">{m.mfa ? 'Two-step sign-in is on' : 'Two-step sign-in is off'}</span>
          {m.mfa ? <button type="button" className="dh-btn danger sm" onClick={() => setConfirmMfa(true)}>Reset two-step sign-in</button> : null}
        </div>
      </Modal>
      {confirmMfa ? <Confirm title="Reset two-step sign-in?" danger confirmLabel="Reset" busy={busy === 'mfa'} onConfirm={resetMfa} onCancel={() => setConfirmMfa(false)}>{m.name} will be able to sign in with just a password until they set it up again. Do this only if they lost their phone and recovery codes.</Confirm> : null}
    </>
  );
}

export default function Team() {
  const { me, perms, reloadMembers } = usePractice();
  const senior = perms.manage_team;
  const q = useAsync((signal) => pr.get('/members', { all: senior }, signal), [senior]);
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState(null);
  const d = q.data;
  const refresh = () => { q.reload(); reloadMembers(); };
  const active = d ? d.members.filter((m) => m.active) : [];
  const inactive = d ? d.members.filter((m) => !m.active) : [];

  const row = (m) => (
    <div key={m.id} className={`pr-member ${m.active ? '' : 'off'}`}>
      <Avatar name={m.name} large />
      <div style={{ minWidth: 0 }}>
        <div className="pr-title" style={{ fontSize: 15 }}>{m.name}{m.id === me.member.id ? <span className="pr-muted" style={{ fontWeight: 400 }}> (you)</span> : null}</div>
        <div className="pr-item meta" style={{ display: 'flex', padding: 0, border: 0 }}><span>{m.role_label}</span>{m.email ? <span>{m.email}</span> : null}{m.phone ? <span>{m.phone}</span> : null}</div>
        <div className="pr-actions" style={{ marginTop: 6 }}>
          {m.role !== 'staff' ? <span className="pr-pill">{plural(m.active_cases, 'active case')}</span> : null}
          {senior && m.last_seen ? <span className="pr-pill dim">seen {fmtAgo(m.last_seen)}</span> : null}
          {senior && m.mfa ? <span className="pr-pill good"><PIcon name="shield" />Two-step on</span> : null}
          {!m.active ? <span className="pr-pill dim">Inactive</span> : null}
        </div>
      </div>
      {senior ? <div className="pr-actions"><button type="button" className="dh-btn ghost sm" onClick={() => setEdit(m)}><PIcon name="edit" />Manage</button></div> : null}
    </div>
  );

  return (
    <>
      <PageHead title="Team" sub={senior ? 'Add juniors and office staff, set their roles, and manage their sign-in.' : 'Everyone in your practice.'}>
        {senior ? <button type="button" className="dh-btn primary" onClick={() => setAdd(true)}><PIcon name="plus" />Add member</button> : null}
      </PageHead>
      {!d ? (q.error ? <ErrorBox error={q.error} retry={q.reload} /> : <Loading />) : (
        <>
          <Card flush>{active.map(row)}</Card>
          {inactive.length ? <Card title="Inactive" flush>{inactive.map(row)}</Card> : null}
        </>
      )}
      {add ? <AddMember onClose={() => setAdd(false)} onSaved={refresh} /> : null}
      {edit ? <EditMember m={edit} self={edit.id === me.member.id} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} /> : null}
    </>
  );
}
