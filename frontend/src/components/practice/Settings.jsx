import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Confirm } from '../dochub/ui.jsx';
import { fmtAgo } from '../dochub/format.js';
import { PIcon } from './icons.jsx';
import { ApiError, doneWith, pr } from './api.js';
import { usePractice } from './ctx.js';
import MfaSetup from './MfaSetup.jsx';
import { Card, ErrText, ErrorBox, Field, Loading, PageHead, Switch, useAsync } from './widgets.jsx';
import { human, plural } from './util.js';

function SaveBar({ dirty, busy, onSave, onReset, err, saved }) {
  return (
    <div>
      <ErrText>{err}</ErrText>
      <div className="pr-actions" style={{ marginTop: 6 }}>
        <button type="button" className="dh-btn primary" onClick={onSave} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        {dirty ? <button type="button" className="dh-btn ghost" onClick={onReset} disabled={busy}>Discard</button> : null}
        {!dirty && saved ? <span className="pr-muted"><PIcon name="check" size={14} /> Saved</span> : null}
      </div>
    </div>
  );
}

// one small hook for every "edit a few fields, press Save" section
function useDraft(initial, save) {
  const [d, setD] = useState(initial);
  const [base, setBase] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setD(initial); setBase(initial); }, [JSON.stringify(initial)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  const run = async () => {
    setBusy(true); setErr(''); setSaved(false);
    try { await save(d, base); setBase(d); setSaved(true); } catch (e) { setErr(doneWith(e)); } finally { setBusy(false); }
  };
  return { d, set: (p) => { setSaved(false); setD((s) => ({ ...s, ...p })); }, dirty, busy, err, saved, run, reset: () => { setD(base); setErr(''); } };
}

function Profile() {
  const { me, reloadMe, toast } = usePractice();
  const m = me.member;
  const f = useDraft({ name: m.name || '', phone: m.phone || '', email_notify: !!m.email_notify }, async (d) => {
    await pr.patch('/me', { name: d.name, phone: d.phone || null, email_notify: d.email_notify });
    toast('Profile saved'); reloadMe();
  });
  return (
    <Card title="Your profile">
      <div className="pr-form">
        <div className="row2">
          <Field label="Name"><input className="dh-input" value={f.d.name} onChange={(e) => f.set({ name: e.target.value })} maxLength={120} /></Field>
          <Field label="Phone"><input className="dh-input" value={f.d.phone} onChange={(e) => f.set({ phone: e.target.value })} inputMode="tel" maxLength={30} /></Field>
        </div>
        <div className="row2">
          <Field label="Email (sign-in)"><input className="dh-input" value={m.email || me.user.email || ''} disabled readOnly /></Field>
          <Field label="Role"><input className="dh-input" value={m.role_label} disabled readOnly /></Field>
        </div>
        <Switch title="Email me my notifications" help="Hearing reminders, assignments and updates also come to your email when the practice has email switched on." checked={f.d.email_notify} onChange={(v) => f.set({ email_notify: v })} />
        <SaveBar {...f} onSave={f.run} onReset={f.reset} />
      </div>
    </Card>
  );
}

function PracticeSection({ s, refresh }) {
  const { toast, reloadMe } = usePractice();
  const f = useDraft({ firm_name: s.firm_name, default_court: s.default_court || '', junior_create_cases: !!s.junior_create_cases, junior_scope: s.junior_scope }, async (d) => {
    await pr.put('/settings', d); toast('Settings saved'); reloadMe(); refresh();
  });
  return (
    <Card title="Practice">
      <div className="pr-form">
        <Field label="Practice name"><input className="dh-input" value={f.d.firm_name} onChange={(e) => f.set({ firm_name: e.target.value })} maxLength={120} /></Field>
        <Field label="Usual court" hint="Used when a new case is saved without a court."><input className="dh-input" value={f.d.default_court} onChange={(e) => f.set({ default_court: e.target.value })} maxLength={120} placeholder="e.g. City Civil Court, Hyderabad" /></Field>
        <Field label="Junior advocates can update"><select className="dh-select" value={f.d.junior_scope} onChange={(e) => f.set({ junior_scope: e.target.value })}><option value="assigned">Only the cases assigned to them (and hearings they cover)</option><option value="all">Every case they can see</option></select></Field>
        <Switch title="Juniors can create cases" help="They can add cases for themselves. Only you can assign a case to someone else." checked={f.d.junior_create_cases} onChange={(v) => f.set({ junior_create_cases: v })} />
        <SaveBar {...f} onSave={f.run} onReset={f.reset} />
      </div>
    </Card>
  );
}

const TRIG = [
  ['hearing', 'Hearing reminders', 'Before each hearing, on the days chosen below.'],
  ['case_update', 'Case updates', 'When a proceeding is recorded, a hearing moves or the status changes.'],
  ['document', 'New documents', 'When someone uploads a document to a case.'],
  ['assignment', 'Assignments', 'When a case or hearing is assigned to someone.'],
  ['deadline', 'Deadlines', 'Case next-action dates and RTI reply or appeal dates.'],
  ['pending', 'Pending actions', 'Hearings that happened but were never recorded, and overdue follow-ups.'],
];

function Notifications({ s, refresh }) {
  const { meta, toast } = usePractice();
  const [running, setRunning] = useState(false);
  const init = { channels: s.channels, triggers: s.triggers, reminder_days: s.reminder_days, recipients: s.recipients, client_email_reminders: !!s.client_email_reminders };
  const f = useDraft(init, async (d) => { await pr.put('/settings', d); toast('Notification settings saved'); refresh(); });
  const toggleDay = (n) => f.set({ reminder_days: f.d.reminder_days.includes(n) ? f.d.reminder_days.filter((x) => x !== n) : [...f.d.reminder_days, n].sort((a, b) => b - a) });
  const run = async () => {
    setRunning(true);
    try { const r = await pr.post('/reminders/run'); const n = Object.values(r.counts || {}).reduce((a, b) => a + (Number(b) || 0), 0); toast(n ? `Reminder check done — ${plural(n, 'notification')} created` : 'Reminder check done — nothing new was due'); refresh(); } catch (e) { toast(doneWith(e), { tone: 'bad' }); } finally { setRunning(false); }
  };
  const ob = s.outbox || {};
  return (
    <>
      <Card title="How people are notified">
        <div className="pr-form">
          {!s.email_configured ? <div className="dh-banner" style={{ marginBottom: 12 }}><PIcon name="mail" /><div className="body"><b>E-mail is not set up on this server.</b> In-app notifications work. E-mails are recorded but not sent until the server has SMTP settings. WhatsApp always works as a one-tap link that opens WhatsApp with the message ready, because sending automatically needs a paid WhatsApp Business account.</div></div> : null}
          <Switch title="In the app" help="The bell at the top of Practice." checked={f.d.channels.inapp} onChange={(v) => f.set({ channels: { ...f.d.channels, inapp: v } })} />
          <Switch title="E-mail" help="Sent to your team when they have e-mail notifications on." checked={f.d.channels.email} onChange={(v) => f.set({ channels: { ...f.d.channels, email: v } })} />
          <Switch title="WhatsApp links" help="Shows the “remind client” WhatsApp button on cases and hearings." checked={f.d.channels.whatsapp} onChange={(v) => f.set({ channels: { ...f.d.channels, whatsapp: v } })} />
          <Switch title="E-mail clients their hearing reminders automatically" help="Needs the client's e-mail address and working e-mail on the server. Off by default." checked={f.d.client_email_reminders} onChange={(v) => f.set({ client_email_reminders: v })} />
          <Field label="Who gets internal reminders"><select className="dh-select" value={f.d.recipients} onChange={(e) => f.set({ recipients: e.target.value })}><option value="advocate_and_seniors">The advocate in charge and the Senior Advocates</option><option value="advocate">Only the advocate in charge</option></select></Field>
        </div>
      </Card>
      <Card title="What to notify about">
        {TRIG.map(([k, t, h]) => <Switch key={k} title={t} help={h} checked={!!f.d.triggers[k]} onChange={(v) => f.set({ triggers: { ...f.d.triggers, [k]: v } })} />)}
      </Card>
      <Card title="Hearing reminder days" sub="before each hearing">
        <div className="pr-days" role="group" aria-label="Reminder days">
          {meta.reminder_days.map((n) => (
            <label key={n} className={f.d.reminder_days.includes(n) ? 'on' : ''}>
              <input type="checkbox" checked={f.d.reminder_days.includes(n)} onChange={() => toggleDay(n)} />{n === 0 ? 'On the day' : n === 1 ? '1 day before' : `${n} days before`}
            </label>
          ))}
        </div>
        <p className="pr-note">Each reminder is sent once per hearing date. If a hearing is moved, the reminders start again for the new date.</p>
        <SaveBar {...f} onSave={f.run} onReset={f.reset} />
      </Card>
      <Card title="Reminder engine" actions={<button type="button" className="dh-btn ghost sm" onClick={run} disabled={running}><PIcon name="refresh" />{running ? 'Checking…' : 'Run check now'}</button>}>
        <p className="pr-note" style={{ marginTop: 0 }}>The check runs by itself every few minutes while the server is awake, and again whenever someone opens the dashboard.</p>
        <dl className="pr-kv" style={{ gridTemplateColumns: '130px minmax(0,1fr)' }}>
          <dt>Last check</dt><dd>{s.last_run ? fmtAgo(s.last_run.at && new Date(s.last_run.at * 1000).toISOString().slice(0, 19).replace('T', ' ')) : 'Not yet'}</dd>
          <dt>E-mails</dt><dd>{Object.keys(ob).length ? Object.entries(ob).map(([k, v]) => `${v} ${human(k).toLowerCase()}`).join(' · ') : 'None queued'}</dd>
        </dl>
      </Card>
    </>
  );
}

function Access({ s, refresh }) {
  const { toast, me } = usePractice();
  const f = useDraft({ mfa_required: !!s.mfa_required, ip_enabled: !!s.ip_enabled, ip_allow: (s.ip_allow || []).join('\n') }, async (d) => {
    await pr.put('/settings', { mfa_required: d.mfa_required, ip_enabled: d.ip_enabled, ip_allow: d.ip_allow.split(/[\s,]+/).filter(Boolean) });
    toast('Access settings saved'); refresh();
  });
  const addMine = () => { const list = f.d.ip_allow.split(/[\s,]+/).filter(Boolean); if (!list.includes(s.your_ip)) list.push(s.your_ip); f.set({ ip_allow: list.join('\n') }); };
  return (
    <Card title="Access control">
      <div className="pr-form">
        <Switch title="Require two-step sign-in for everyone" help={me.mfa.enabled ? 'People who have not set it up are asked to do so the next time they open Practice.' : 'Turn on two-step sign-in for your own account first (see “Security”), then you can require it for everyone.'} checked={f.d.mfa_required} onChange={(v) => f.set({ mfa_required: v })} disabled={!me.mfa.enabled && !f.d.mfa_required} />
        <Switch title="Only allow certain networks" help="Practice opens only from the addresses listed below, for example your office. You can always reach these settings." checked={f.d.ip_enabled} onChange={(v) => f.set({ ip_enabled: v })} />
        <Field label="Allowed addresses" hint="One per line. Single addresses like 203.0.113.7, or ranges like 203.0.113.0/24.">
          <textarea className="dh-textarea pr-mono" rows={4} value={f.d.ip_allow} onChange={(e) => f.set({ ip_allow: e.target.value })} placeholder="203.0.113.7" spellCheck={false} />
        </Field>
        <p className="pr-note" style={{ margin: '0 0 12px' }}>Your address right now: <span className="pr-mono" style={{ color: 'var(--ink)' }}>{s.your_ip || 'unknown'}</span>{s.your_ip ? <> · <button type="button" className="pr-link" onClick={addMine}>Add it to the list</button></> : null}. Addresses can change if you work from home or on mobile data, so test with one device before relying on this.</p>
        <SaveBar {...f} onSave={f.run} onReset={f.reset} />
      </div>
    </Card>
  );
}

function Backup() {
  const { toast } = usePractice();
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await pr.download('/backup/export', 'practice-backup.zip'); toast('Backup downloaded'); } catch (e) { toast(doneWith(e), { tone: 'bad' }); } finally { setBusy(false); } };
  return (
    <Card title="Backup your data">
      <p style={{ marginTop: 0 }}>Download everything in Practice — cases, hearings, proceedings, clients, notes, RTI, the calendar and the audit log — as one ZIP file with a spreadsheet of your cases. Passwords and sign-in secrets are never included.</p>
      <p className="pr-note">Documents stay in the Document Hub. Use its “Download as ZIP” to back those up.</p>
      <button type="button" className="dh-btn primary" onClick={go} disabled={busy}><PIcon name="download" />{busy ? 'Preparing…' : 'Download backup'}</button>
    </Card>
  );
}

function Logins() {
  const q = useAsync((signal) => pr.get('/me/logins', null, signal), []);
  return (
    <Card title="Recent sign-in activity" flush>
      {!q.data ? (q.error ? <ErrorBox error={q.error} retry={q.reload} compact /> : <Loading />) : !q.data.items.length ? <p className="pr-note" style={{ textAlign: 'center', padding: 20 }}>No sign-ins recorded yet.</p> : q.data.items.map((it, i) => (
        <div key={i} className="pr-audit" style={{ gridTemplateColumns: '150px minmax(0,1fr) auto' }}>
          <span className="when">{fmtAgo(it.at)}</span>
          <span className="what">{it.summary || human(it.action)}</span>
          <span className="ip">{it.ip}</span>
        </div>
      ))}
    </Card>
  );
}

function Leave() {
  const { toast, reloadMe } = usePractice();
  const [ask, setAsk] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => { try { await pr.post('/members/leave'); toast('You have left the practice'); reloadMe(); } catch (e) { setErr(e instanceof ApiError ? e.message : doneWith(e)); } };
  return (
    <Card title="Leave this practice">
      <p style={{ marginTop: 0 }}>You will lose access to its cases and clients. Your own LexAmplify account stays. A practice needs at least one Senior Advocate, so a sole Senior Advocate must hand over first.</p>
      <ErrText>{err}</ErrText>
      <button type="button" className="dh-btn danger" onClick={() => { setErr(''); setAsk(true); }}>Leave practice</button>
      {ask ? <Confirm title="Leave this practice?" danger confirmLabel="Leave" onConfirm={() => { setAsk(false); go(); }} onCancel={() => setAsk(false)}>You will no longer see this practice's cases. A Senior Advocate can add you back.</Confirm> : null}
    </Card>
  );
}

export default function Settings() {
  const { perms } = usePractice();
  const [sp, setSp] = useSearchParams();
  const senior = perms.manage_settings;
  const sections = [
    { id: 'profile', label: 'Profile' },
    { id: 'security', label: 'Security' },
    ...(senior ? [{ id: 'practice', label: 'Practice' }, { id: 'notify', label: 'Notifications' }, { id: 'access', label: 'Access control' }, { id: 'backup', label: 'Backup' }] : []),
  ];
  const id = sections.some((x) => x.id === sp.get('s')) ? sp.get('s') : 'profile';
  const q = useAsync((signal) => pr.get('/settings', null, signal), []);
  const s = q.data;

  return (
    <>
      <PageHead title="Settings" sub={senior ? 'Your profile, security, and how the whole practice works.' : 'Your profile and sign-in security.'} />
      <div className="pr-set">
        <nav className="pr-setnav" aria-label="Settings sections">
          {sections.map((x) => <button key={x.id} type="button" className={id === x.id ? 'on' : ''} onClick={() => setSp({ s: x.id }, { replace: true })} aria-current={id === x.id ? 'page' : undefined}>{x.label}</button>)}
        </nav>
        <div style={{ minWidth: 0 }}>
          {id === 'profile' ? <Profile /> : null}
          {id === 'security' ? (<><MfaSetup /><Logins /><Leave /></>) : null}
          {['practice', 'notify', 'access'].includes(id) ? (
            !s ? (q.error ? <ErrorBox error={q.error} retry={q.reload} /> : <Loading />) : (
              <>
                {id === 'practice' ? <PracticeSection s={s} refresh={q.reload} /> : null}
                {id === 'notify' ? <Notifications s={s} refresh={q.reload} /> : null}
                {id === 'access' ? <Access s={s} refresh={q.reload} /> : null}
              </>
            )
          ) : null}
          {id === 'backup' ? <Backup /> : null}
        </div>
      </div>
    </>
  );
}
