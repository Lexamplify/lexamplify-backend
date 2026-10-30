import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../dochub/ui.jsx';
import { PIcon } from './icons.jsx';
import { ApiError, doneWith, openWhatsApp, pr } from './api.js';
import { usePractice } from './ctx.js';
import { useAdvocates } from './forms.jsx';
import { ErrText, Field, Loading, ErrorBox } from './widgets.jsx';
import { emptyToNull, fmtDayLong, human, istToday, nextDateOptions, relDay } from './util.js';

// ── add / edit / reschedule a hearing ────────────────────────────────────────────────────
export function HearingModal({ caseObj, hearing, initial, onClose, onSaved }) {
  const { perms, toast } = usePractice();
  const advocates = useAdvocates();
  const editing = !!hearing;
  const [f, setF] = useState({
    hearing_date: hearing?.hearing_date || initial?.date || '', hearing_time: hearing?.hearing_time || '', court: hearing?.court || caseObj.court || '', hall_no: hearing?.hall_no || caseObj.hall_no || '',
    judge: hearing?.judge || caseObj.judge || '', purpose: hearing?.purpose || initial?.purpose || '', serial_no: hearing?.serial_no || '', advocate_id: String(hearing?.advocate_id || caseObj.advocate_id || ''),
    note: hearing?.note || '', status: hearing?.status || 'scheduled',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const shortcuts = useMemo(() => nextDateOptions(), []);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.hearing_date) { setErr('Pick the hearing date.'); return; }
    setBusy(true); setErr('');
    try {
      const body = emptyToNull({ ...f, advocate_id: f.advocate_id || null });
      if (!editing) delete body.status;
      if (!perms.assign_case) delete body.advocate_id;
      const r = editing ? await pr.patch(`/hearings/${hearing.id}`, body) : await pr.post(`/cases/${caseObj.id}/hearings`, body);
      (r.warnings || []).forEach((w) => toast(w, { tone: 'warn', ms: 6500 }));
      toast(editing ? 'Hearing updated' : 'Hearing scheduled');
      onSaved(r.hearing);
    } catch (e2) { setErr(doneWith(e2)); } finally { setBusy(false); }
  };

  return (
    <Modal title={editing ? 'Edit hearing' : 'Schedule a hearing'} onClose={busy ? () => {} : onClose}
      footer={(<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="pr-hearing-form" className="dh-btn primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Schedule hearing'}</button></>)}>
      <form id="pr-hearing-form" className="pr-form" onSubmit={submit} noValidate>
        <ErrText>{err}</ErrText>
        <p className="pr-note" style={{ margin: '0 0 12px' }}>{caseObj.title} · <span className="pr-mono">{caseObj.case_no}</span></p>
        <div className="row3">
          <Field label="Date" required><input type="date" className="dh-input" value={f.hearing_date} onChange={set('hearing_date')} autoFocus /></Field>
          <Field label="Time"><input type="time" className="dh-input" value={f.hearing_time || ''} onChange={set('hearing_time')} /></Field>
          <Field label="Item no."><input className="dh-input" value={f.serial_no} onChange={set('serial_no')} placeholder="Cause-list no." maxLength={20} /></Field>
        </div>
        {!editing ? (
          <div className="pr-shortcuts" style={{ margin: '-4px 0 12px' }}>
            {shortcuts.map((o) => <button type="button" key={o.label} onClick={() => setF((s) => ({ ...s, hearing_date: o.date }))}>{o.label}</button>)}
          </div>
        ) : null}
        <div className="row2">
          <Field label="Court"><input className="dh-input" value={f.court} onChange={set('court')} maxLength={160} /></Field>
          <Field label="Hall"><input className="dh-input" value={f.hall_no} onChange={set('hall_no')} maxLength={30} /></Field>
        </div>
        <div className="row2">
          <Field label="Judge"><input className="dh-input" value={f.judge} onChange={set('judge')} maxLength={120} /></Field>
          <Field label="Purpose"><input className="dh-input" value={f.purpose} onChange={set('purpose')} placeholder="e.g. Arguments, Evidence" maxLength={200} /></Field>
        </div>
        <div className="row2">
          <Field label="Advocate attending">
            <select className="dh-select" value={f.advocate_id} onChange={set('advocate_id')} disabled={!perms.assign_case}>
              <option value="">Same as the case</option>
              {advocates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          {editing ? (
            <Field label="Status"><select className="dh-select" value={f.status} onChange={set('status')}>{['scheduled', 'heard', 'adjourned', 'cancelled'].map((s) => <option key={s} value={s}>{human(s)}</option>)}</select></Field>
          ) : <span />}
        </div>
        <Field label="Note"><textarea className="dh-textarea" rows={2} value={f.note} onChange={set('note')} maxLength={1000} /></Field>
      </form>
    </Modal>
  );
}

// ── record what happened at a hearing ────────────────────────────────────────────────────
const OUTCOMES = [
  { v: 'heard', l: 'Heard' }, { v: 'adjourned', l: 'Adjourned' }, { v: 'reserved', l: 'Orders reserved' }, { v: 'disposed', l: 'Disposed' }, { v: 'other', l: 'Other' },
];
const SUGGEST_STATUS = { disposed: 'Disposed', reserved: 'Awaiting Orders' };

export function RecordProceedingModal({ caseId, hearingId, onClose, onSaved }) {
  const { meta, toast } = usePractice();
  const [loaded, setLoaded] = useState({ loading: true });
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let dead = false;
    pr.get(`/cases/${caseId}`).then(({ case: c }) => {
      if (dead) return;
      const open = (c.hearings || []).filter((h) => h.status === 'scheduled');
      const today = istToday();
      const chosen = (hearingId && open.find((h) => h.id === Number(hearingId))) || open.filter((h) => h.hearing_date <= today).sort((a, b) => b.hearing_date.localeCompare(a.hearing_date))[0] || null;
      setLoaded({ c, open });
      setF({
        hearing_id: chosen ? String(chosen.id) : 'none', proc_date: chosen ? (chosen.hearing_date > today ? today : chosen.hearing_date) : today, outcome: '', notes: '', observations: '', orders: '',
        next_date: '', next_purpose: '', set_status: '',
      });
    }).catch((e) => { if (!dead) setLoaded({ error: e }); });
    return () => { dead = true; };
  }, [caseId, hearingId]);

  if (loaded.loading || loaded.error || !f) {
    return (
      <Modal title="Record proceeding" onClose={onClose}>
        {loaded.error ? <ErrorBox error={loaded.error} /> : <Loading />}
      </Modal>
    );
  }
  const { c, open } = loaded;
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const pickHearing = (e) => {
    const id = e.target.value;
    const h = open.find((x) => String(x.id) === id);
    setF((s) => ({ ...s, hearing_id: id, proc_date: h ? (h.hearing_date > istToday() ? istToday() : h.hearing_date) : s.proc_date }));
  };
  const suggest = SUGGEST_STATUS[f.outcome];
  const showSuggest = suggest && c.status !== suggest && !f.set_status;
  const opts = nextDateOptions(f.proc_date);
  const relNext = f.next_date ? relDay(f.next_date, { past: '' }).text : '';

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!(f.notes.trim() || f.observations.trim() || f.orders.trim() || f.outcome)) { setErr('Write something about the hearing, or pick an outcome.'); return; }
    if (f.next_date && f.next_date < f.proc_date) { setErr('The next hearing date cannot be before this hearing.'); return; }
    setBusy(true);
    try {
      const body = emptyToNull({ ...f });
      body.hearing_id = f.hearing_id === 'none' ? 'none' : Number(f.hearing_id);
      const r = await pr.post(`/cases/${caseId}/proceedings`, body);
      (r.warnings || []).forEach((w) => toast(w, { tone: 'warn', ms: 6500 }));
      toast(r.next_hearing_id ? 'Proceeding saved and the next hearing is listed' : 'Proceeding saved');
      onSaved(r);
    } catch (e2) { setErr(doneWith(e2)); } finally { setBusy(false); }
  };

  return (
    <Modal title="Record proceeding" onClose={busy ? () => {} : onClose}
      footer={(<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="pr-proc-form" className="dh-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save proceeding'}</button></>)}>
      <form id="pr-proc-form" className="pr-form" onSubmit={submit} noValidate>
        <ErrText>{err}</ErrText>
        <p style={{ margin: '0 0 12px', color: 'var(--ink)', fontFamily: 'Fraunces, serif', fontWeight: 600, fontSize: 15 }}>{c.title} <span className="pr-mono pr-muted" style={{ fontSize: 11, fontWeight: 400 }}>· {c.case_no}</span></p>
        <div className="row2">
          <Field label="Hearing">
            <select className="dh-select" value={f.hearing_id} onChange={pickHearing}>
              {open.map((h) => <option key={h.id} value={h.id}>{fmtDayLong(h.hearing_date)}{h.purpose ? ` — ${h.purpose}` : ''}</option>)}
              <option value="none">Not linked to a listed hearing</option>
            </select>
          </Field>
          <Field label="Date of proceeding"><input type="date" className="dh-input" value={f.proc_date} max={istToday()} onChange={set('proc_date')} /></Field>
        </div>
        <Field label="Outcome">
          <div className="pr-segment" role="group" aria-label="Outcome" style={{ flexWrap: 'wrap' }}>
            {OUTCOMES.map((o) => <button type="button" key={o.v} className={f.outcome === o.v ? 'on' : ''} aria-pressed={f.outcome === o.v} onClick={() => setF((s) => ({ ...s, outcome: s.outcome === o.v ? '' : o.v }))}>{o.l}</button>)}
          </div>
        </Field>
        <Field label="Hearing notes"><textarea className="dh-textarea" rows={3} value={f.notes} onChange={set('notes')} maxLength={8000} placeholder="What happened in court today" autoFocus /></Field>
        <div className="row2">
          <Field label="Court observations"><textarea className="dh-textarea" rows={3} value={f.observations} onChange={set('observations')} maxLength={8000} /></Field>
          <Field label="Orders passed"><textarea className="dh-textarea" rows={3} value={f.orders} onChange={set('orders')} maxLength={8000} /></Field>
        </div>
        <fieldset>
          <legend>Next hearing</legend>
          <div className="row2">
            <Field label="Next date" hint={relNext ? `${fmtDayLong(f.next_date)} — ${relNext.toLowerCase()}` : 'Adds it to the cause list and calendar automatically.'}>
              <input type="date" className="dh-input" value={f.next_date} min={f.proc_date} onChange={set('next_date')} />
            </Field>
            <Field label="Purpose"><input className="dh-input" value={f.next_purpose} onChange={set('next_purpose')} maxLength={200} placeholder="e.g. Evidence" /></Field>
          </div>
          <div className="pr-shortcuts" style={{ margin: '-4px 0 12px' }}>
            {opts.map((o) => <button type="button" key={o.label} onClick={() => setF((s) => ({ ...s, next_date: o.date }))}>{o.label}</button>)}
            {f.next_date ? <button type="button" onClick={() => setF((s) => ({ ...s, next_date: '' }))}>Clear</button> : null}
          </div>
        </fieldset>
        <Field label="Case status">
          <select className="dh-select" value={f.set_status} onChange={set('set_status')}>
            <option value="">Keep as “{c.status}”</option>
            {meta.statuses.filter((s) => s !== c.status).map((s) => <option key={s}>{s}</option>)}
          </select>
          {showSuggest ? <span className="hint">Looks like it may now be <button type="button" className="pr-link" onClick={() => setF((s) => ({ ...s, set_status: suggest }))}>{suggest}</button>.</span> : null}
        </Field>
      </form>
    </Modal>
  );
}

// ── remind the client: WhatsApp link or e-mail, with the text visible and editable first ──────
export function ReminderModal({ caseId, hearingId, onClose, onSent }) {
  const { toast } = usePractice();
  const [st, setSt] = useState({ loading: true });
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [{ case: c }, draft] = await Promise.all([
          pr.get(`/cases/${caseId}`),
          pr.get(`/cases/${caseId}/message-draft`, { hearing_id: hearingId }).catch((e) => (e instanceof ApiError && e.extra?.code === 'NO_HEARING' ? { noHearing: e.message } : Promise.reject(e))),
        ]);
        if (dead) return;
        setSt({ c, draft });
        setBody(draft.body || '');
        setSubject(draft.subject || `Regarding ${c.title}`);
      } catch (e) { if (!dead) setSt({ error: e }); }
    })();
    return () => { dead = true; };
  }, [caseId, hearingId]);

  if (st.loading || st.error) {
    return <Modal title="Remind the client" onClose={onClose}>{st.error ? <ErrorBox error={st.error} /> : <Loading />}</Modal>;
  }
  const { c, draft } = st;
  const hasPhone = !!c.client_phone;
  const hasEmail = !!c.client_email;
  const waOn = c.whatsapp;

  const wa = async () => {
    setBusy('wa'); setErr(''); setResult(null);
    try {
      const r = await openWhatsApp(caseId, { text: body, hearing_id: draft.hearing_id || hearingId || null });
      setResult({ tone: 'ok', text: r.popupBlocked ? 'Your browser blocked the new tab.' : 'WhatsApp opened with the message ready. It is sent only when you press Send there.', url: r.popupBlocked ? r.url : null });
      onSent?.();
    } catch (e) { setErr(doneWith(e)); } finally { setBusy(''); }
  };
  const mail = async () => {
    setBusy('mail'); setErr(''); setResult(null);
    try {
      const r = await pr.post(`/cases/${caseId}/email`, { subject, body, hearing_id: draft.hearing_id || hearingId || null });
      setResult({ tone: r.delivered ? 'ok' : 'warn', text: r.message });
      if (r.delivered) toast('E-mail sent');
      onSent?.();
    } catch (e) { setErr(doneWith(e)); } finally { setBusy(''); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(body); toast('Message copied'); } catch { toast('Could not copy. Select the text and copy it.', { tone: 'bad' }); }
  };

  return (
    <Modal title="Remind the client" onClose={busy ? () => {} : onClose}
      footer={(
        <>
          <button type="button" className="dh-btn ghost" onClick={copy}><PIcon name="copy" />Copy</button>
          <span className="sp" />
          <button type="button" className="dh-btn ghost" onClick={mail} disabled={!!busy || !hasEmail || !body.trim()} title={hasEmail ? undefined : 'No email address on file'}><PIcon name="mail" />{busy === 'mail' ? 'Sending…' : 'Send e-mail'}</button>
          <button type="button" className="dh-btn primary" onClick={wa} disabled={!!busy || !hasPhone || !waOn || !body.trim()} title={!hasPhone ? 'No phone number on file' : !waOn ? 'WhatsApp is switched off in Settings' : undefined}><PIcon name="chat" />{busy === 'wa' ? 'Opening…' : 'Open WhatsApp'}</button>
        </>
      )}>
      <ErrText>{err}</ErrText>
      <p style={{ margin: '0 0 12px', color: 'var(--ink)', fontFamily: 'Fraunces, serif', fontWeight: 600, fontSize: 15 }}>{c.client_name || 'No client on this case'} <span className="pr-mono pr-muted" style={{ fontSize: 11, fontWeight: 400 }}>· {c.case_no}</span></p>
      {!c.client_id ? <div className="dh-banner rust" style={{ marginBottom: 12 }}><PIcon name="alert" /><div className="body">This case has no client yet. Edit the case and add one to send reminders.</div></div> : null}
      {c.client_id && !hasPhone && !hasEmail ? <div className="dh-banner rust" style={{ marginBottom: 12 }}><PIcon name="alert" /><div className="body"><b>{c.client_name}</b> has no phone number or email on file. Add one on the client's page.</div></div> : null}
      {draft.noHearing ? <div className="dh-banner" style={{ marginBottom: 12 }}><PIcon name="info" /><div className="body">There is no upcoming hearing to remind about, so write your own message below.</div></div> : null}
      <Field label="E-mail subject"><input className="dh-input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} /></Field>
      <Field label="Message" hint="You can change the wording. Nothing is sent until you press a button.">
        <textarea className="dh-textarea" rows={8} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1500} />
      </Field>
      <p className="pr-note">
        {hasPhone ? `WhatsApp opens a chat with ${c.client_phone}.` : 'WhatsApp needs a phone number.'} {hasEmail ? `E-mail goes to ${c.client_email}.` : 'E-mail needs an address.'}
      </p>
      {result ? (
        <div className={`dh-banner ${result.tone === 'ok' ? 'plain' : ''}`} style={{ marginTop: 12 }} role="status">
          <PIcon name={result.tone === 'ok' ? 'checkCircle' : 'alert'} />
          <div className="body">{result.text}{result.url ? <> <a className="pr-link" href={result.url} target="_blank" rel="noopener noreferrer">Open WhatsApp</a></> : null}</div>
        </div>
      ) : null}
    </Modal>
  );
}
