import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Confirm, EmptyState, Modal } from '../dochub/ui.jsx';
import { fmtAgo } from '../dochub/format.js';
import { PIcon } from './icons.jsx';
import { doneWith, pr } from './api.js';
import { usePractice } from './ctx.js';
import { ClientPicker } from './forms.jsx';
import { Card, ErrText, ErrorBox, Field, Loading, PageHead, useAsync, useDebouncedValue } from './widgets.jsx';
import { emptyToNull, fmtShort, istToday } from './util.js';

const STATUS_LABEL = { draft: 'Draft', filed: 'Filed — waiting for reply', replied: 'Replied', partial: 'Partly answered', rejected: 'Rejected / refused', appeal1: 'First appeal filed', appeal2: 'Second appeal filed', closed: 'Closed' };
const FILTERS = [{ v: 'open', l: 'Active' }, { v: '', l: 'All' }, { v: 'draft', l: 'Drafts' }, { v: 'closed', l: 'Closed' }];

function Deadline({ r }) {
  const n = r.next_deadline;
  if (!n) return null;
  const tone = n.days < 0 ? 'bad' : n.days <= 7 ? 'warn' : 'good';
  const when = n.days === 0 ? 'today' : n.days < 0 ? `${-n.days} day${n.days === -1 ? '' : 's'} overdue` : `in ${n.days} day${n.days === 1 ? '' : 's'}`;
  return <span className={`pr-pill ${tone}`} title={n.date}>{n.label} {when} · {fmtShort(n.date)}</span>;
}

function CasePicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const dq = useDebouncedValue(q, 250);
  const [res, setRes] = useState(null);
  useEffect(() => {
    if (value) return undefined;
    let dead = false;
    pr.get('/cases', { q: dq.trim(), per_page: 6 }).then((d) => { if (!dead) setRes(d.cases); }).catch(() => { if (!dead) setRes([]); });
    return () => { dead = true; };
  }, [dq, value]);
  if (value) return <div className="pr-picked"><PIcon name="briefcase" /><span>{value.title} · {value.case_no}</span><button type="button" className="dh-btn quiet sm" onClick={() => onChange(null)}>Change</button></div>;
  return (
    <div className="pr-picker">
      <input className="dh-input" placeholder="Link to a case (optional) — search by number or title" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cases" />
      <div className="list" style={{ maxHeight: 150 }}>
        {res === null ? <div style={{ padding: 10 }} className="pr-muted">Searching…</div> : null}
        {res && res.map((c) => <button type="button" key={c.id} onClick={() => onChange({ id: c.id, title: c.title, case_no: c.case_no })}>{c.title}<small>{c.case_no} · {c.court}</small></button>)}
        {res && !res.length ? <div style={{ padding: 10 }} className="pr-muted">No case matches.</div> : null}
      </div>
    </div>
  );
}

function RtiForm({ existing, onClose, onSaved }) {
  const { meta, members, me, toast } = usePractice();
  const editing = !!existing;
  const [f, setF] = useState({
    subject: existing?.subject || '', department: existing?.department || '', pio: existing?.pio || '', reference_no: existing?.reference_no || '', mode: existing?.mode || '', fee: existing?.fee || '',
    status: existing?.status || 'filed', filing_date: existing?.filing_date || (editing ? '' : istToday()), response_due: existing?.response_due || '', response_date: existing?.response_date || '',
    appeal_due: existing?.appeal_due || '', appeal1_date: existing?.appeal1_date || '', appeal2_due: existing?.appeal2_due || '', appeal2_date: existing?.appeal2_date || '',
    outcome: existing?.outcome || '', notes: existing?.notes || '', assignee_id: String(existing?.assignee_id || me.member.id),
  });
  const [kase, setKase] = useState(existing?.case_id ? { id: existing.case_id, title: existing.case_title, case_no: '' } : null);
  const [client, setClient] = useState(existing?.client_id ? { id: existing.client_id, name: existing.client_name } : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const st = f.status;
  const showReply = ['replied', 'partial', 'rejected', 'appeal1', 'appeal2', 'closed'].includes(st);
  const showAppeal = ['replied', 'partial', 'rejected', 'appeal1', 'appeal2', 'closed'].includes(st);
  const showAppeal2 = ['appeal1', 'appeal2', 'closed'].includes(st);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.subject.trim()) { setErr('Write what the application asks for.'); return; }
    if (!f.department.trim()) { setErr('Enter the department or public authority.'); return; }
    if (st !== 'draft' && !f.filing_date) { setErr('Enter the filing date for an application that has been filed.'); return; }
    setBusy(true); setErr('');
    try {
      const body = emptyToNull({ ...f, assignee_id: f.assignee_id ? Number(f.assignee_id) : null });
      body.case_id = kase ? kase.id : null;
      body.client_id = client ? client.id : null;
      if (editing) {
        // only what changed goes up, so blank dates the server fills in (30-day defaults) are not wiped
        const changed = Object.fromEntries(Object.entries(body).filter(([k, v]) => (v ?? null) !== (existing[k] ?? null)));
        if (Object.keys(changed).length) await pr.patch(`/rti/${existing.id}`, changed);
      } else await pr.post('/rti', body);
      toast(editing ? 'RTI updated' : 'RTI application added');
      onSaved();
    } catch (e2) { setErr(doneWith(e2)); } finally { setBusy(false); }
  };

  return (
    <Modal title={editing ? 'Edit RTI application' : 'New RTI application'} onClose={busy ? () => {} : onClose}
      footer={(<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="pr-rti-form" className="dh-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>)}>
      <form id="pr-rti-form" className="pr-form" onSubmit={submit} noValidate>
        <ErrText>{err}</ErrText>
        <Field label="What the application asks for" required><textarea className="dh-textarea" rows={2} value={f.subject} onChange={set('subject')} maxLength={300} autoFocus placeholder="e.g. Copy of the sanctioned building plan for Plot 14" /></Field>
        <div className="row2">
          <Field label="Department / public authority" required><input className="dh-input" value={f.department} onChange={set('department')} maxLength={200} /></Field>
          <Field label="PIO (Public Information Officer)"><input className="dh-input" value={f.pio} onChange={set('pio')} maxLength={200} /></Field>
        </div>
        <fieldset>
          <legend>Progress</legend>
          <div className="row3">
            <Field label="Status"><select className="dh-select" value={f.status} onChange={set('status')}>{meta.rti_statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}</select></Field>
            <Field label="Filed on"><input type="date" className="dh-input" value={f.filing_date || ''} onChange={set('filing_date')} /></Field>
            <Field label="Reference no."><input className="dh-input" value={f.reference_no} onChange={set('reference_no')} maxLength={80} /></Field>
          </div>
          <div className="row3">
            <Field label="Reply due" hint="Left blank, it becomes 30 days after filing."><input type="date" className="dh-input" value={f.response_due || ''} onChange={set('response_due')} /></Field>
            {showReply ? <Field label="Reply received on"><input type="date" className="dh-input" value={f.response_date || ''} onChange={set('response_date')} /></Field> : <span />}
            {showAppeal ? <Field label="First appeal deadline" hint="Left blank, it becomes 30 days after the reply."><input type="date" className="dh-input" value={f.appeal_due || ''} onChange={set('appeal_due')} /></Field> : <span />}
          </div>
          {showAppeal2 ? (
            <div className="row3">
              <Field label="First appeal filed on"><input type="date" className="dh-input" value={f.appeal1_date || ''} onChange={set('appeal1_date')} /></Field>
              <Field label="Second appeal deadline"><input type="date" className="dh-input" value={f.appeal2_due || ''} onChange={set('appeal2_due')} /></Field>
              <Field label="Second appeal filed on"><input type="date" className="dh-input" value={f.appeal2_date || ''} onChange={set('appeal2_date')} /></Field>
            </div>
          ) : null}
          <p className="pr-note" style={{ margin: '0 0 10px' }}>The 30-day dates are helpful defaults based on the RTI Act. Check them against your own advice and type a different date if needed.</p>
        </fieldset>
        <div className="row3">
          <Field label="Mode"><select className="dh-select" value={f.mode || ''} onChange={set('mode')}><option value="">Not set</option><option>Online</option><option>Post</option><option>In person</option></select></Field>
          <Field label="Fee paid"><input className="dh-input" value={f.fee} onChange={set('fee')} maxLength={40} placeholder="e.g. ₹10" /></Field>
          <Field label="Handled by"><select className="dh-select" value={f.assignee_id} onChange={set('assignee_id')}><option value="">Nobody</option>{(members || []).filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        </div>
        <Field label="Case"><CasePicker value={kase} onChange={setKase} /></Field>
        <Field label="Client"><ClientPicker value={client} onChange={setClient} newClient={null} onNewClient={() => {}} /></Field>
        <Field label="What came of it"><textarea className="dh-textarea" rows={2} value={f.outcome} onChange={set('outcome')} maxLength={1000} /></Field>
        <Field label="Notes"><textarea className="dh-textarea" rows={2} value={f.notes} onChange={set('notes')} maxLength={3000} /></Field>
      </form>
    </Modal>
  );
}

function RtiDetail({ id, onClose, onEdit, onChanged }) {
  const { perms, toast } = usePractice();
  const q = useAsync((signal) => pr.get(`/rti/${id}`, null, signal), [id]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const d = q.data;
  const addNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try { await pr.post(`/rti/${id}/events`, { note }); setNote(''); q.reload(); onChanged(); } catch (e2) { toast(doneWith(e2), { tone: 'bad' }); } finally { setBusy(false); }
  };
  const quick = async (patch, msg) => { setBusy(true); try { await pr.patch(`/rti/${id}`, patch); toast(msg); q.reload(); onChanged(); } catch (e2) { toast(doneWith(e2), { tone: 'bad' }); } finally { setBusy(false); } };
  const remove = async () => { try { await pr.del(`/rti/${id}`); toast('RTI application deleted'); onChanged(); onClose(); } catch (e2) { toast(doneWith(e2), { tone: 'bad' }); setDel(false); } };
  const r = d?.rti;
  const today = istToday();
  return (
    <>
      <Modal title={r ? 'RTI application' : 'Loading…'} onClose={onClose}
        footer={r ? (<>{perms.manage_settings ? <button type="button" className="dh-btn danger" onClick={() => setDel(true)}>Delete</button> : null}<span className="sp" /><button type="button" className="dh-btn ghost" onClick={onClose}>Close</button>{perms.manage_rti ? <button type="button" className="dh-btn primary" onClick={() => onEdit(r)}><PIcon name="edit" />Edit details</button> : null}</>) : null}>
        {!r ? (q.error ? <ErrorBox error={q.error} retry={q.reload} /> : <Loading />) : (
          <>
            <p className="pr-title" style={{ fontSize: 17, margin: '0 0 6px' }}>{r.subject}</p>
            <div className="pr-actions" style={{ marginBottom: 12 }}><span className="pr-pill">{r.status_label}</span><Deadline r={r} /></div>
            <dl className="pr-kv" style={{ marginBottom: 14 }}>
              <dt>Department</dt><dd>{r.department}</dd>
              {r.pio ? (<><dt>PIO</dt><dd>{r.pio}</dd></>) : null}
              {r.reference_no ? (<><dt>Reference</dt><dd className="pr-mono">{r.reference_no}</dd></>) : null}
              {r.filing_date ? (<><dt>Filed</dt><dd>{fmtShort(r.filing_date)}{r.mode ? ` · ${r.mode}` : ''}{r.fee ? ` · ${r.fee}` : ''}</dd></>) : null}
              {r.response_due ? (<><dt>Reply due</dt><dd>{fmtShort(r.response_due)}{r.response_date ? ` · received ${fmtShort(r.response_date)}` : ''}</dd></>) : null}
              {r.appeal_due ? (<><dt>First appeal</dt><dd>deadline {fmtShort(r.appeal_due)}{r.appeal1_date ? ` · filed ${fmtShort(r.appeal1_date)}` : ''}</dd></>) : null}
              {r.appeal2_due ? (<><dt>Second appeal</dt><dd>deadline {fmtShort(r.appeal2_due)}{r.appeal2_date ? ` · filed ${fmtShort(r.appeal2_date)}` : ''}</dd></>) : null}
              {r.case_id ? (<><dt>Case</dt><dd><Link className="pr-link" to={`/practice/cases/${r.case_id}`}>{r.case_title || 'Open case'}</Link></dd></>) : null}
              {r.client_name ? (<><dt>Client</dt><dd><Link className="pr-link" to={`/practice/clients/${r.client_id}`}>{r.client_name}</Link></dd></>) : null}
              {r.assignee ? (<><dt>Handled by</dt><dd>{r.assignee}</dd></>) : null}
              {r.outcome ? (<><dt>Outcome</dt><dd className="pr-pre">{r.outcome}</dd></>) : null}
              {r.notes ? (<><dt>Notes</dt><dd className="pr-pre soft">{r.notes}</dd></>) : null}
            </dl>
            {perms.manage_rti && r.status !== 'closed' ? (
              <div className="pr-actions" style={{ marginBottom: 14 }}>
                {r.status === 'draft' ? <button type="button" className="dh-btn ghost sm" disabled={busy} onClick={() => quick({ status: 'filed', filing_date: r.filing_date || today }, 'Marked as filed')}>Mark as filed today</button> : null}
                {r.status === 'filed' ? <button type="button" className="dh-btn ghost sm" disabled={busy} onClick={() => quick({ status: 'replied', response_date: today }, 'Reply recorded')}>Reply received</button> : null}
                {r.status === 'filed' ? <button type="button" className="dh-btn ghost sm" disabled={busy} onClick={() => quick({ status: 'appeal1', appeal1_date: today }, 'First appeal recorded')}>No reply — first appeal filed</button> : null}
                {['replied', 'partial', 'rejected'].includes(r.status) ? <button type="button" className="dh-btn ghost sm" disabled={busy} onClick={() => quick({ status: 'appeal1', appeal1_date: today }, 'First appeal recorded')}>First appeal filed today</button> : null}
                {r.status === 'appeal1' ? <button type="button" className="dh-btn ghost sm" disabled={busy} onClick={() => quick({ status: 'appeal2', appeal2_date: today }, 'Second appeal recorded')}>Second appeal filed today</button> : null}
                <button type="button" className="dh-btn ghost sm" disabled={busy} onClick={() => quick({ status: 'closed' }, 'Marked as closed')}>Close it</button>
              </div>
            ) : null}
            <h4 className="pr-tabletitle">History</h4>
            {perms.manage_rti ? (
              <form onSubmit={addNote} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input className="dh-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note, e.g. called the PIO" aria-label="New note" maxLength={1500} />
                <button type="submit" className="dh-btn ghost" disabled={busy || !note.trim()}>Add</button>
              </form>
            ) : null}
            <ul className="pr-tl">
              {d.events.map((ev) => (
                <li key={ev.id}><span className="pt" /><div className="t">{ev.note}</div><div className="w">{ev.actor ? `${ev.actor} · ` : ''}{fmtAgo(ev.at)}</div></li>
              ))}
            </ul>
          </>
        )}
      </Modal>
      {del ? <Confirm title="Delete this RTI application?" danger confirmLabel="Delete" onConfirm={remove} onCancel={() => setDel(false)}>The application and its history will be removed for everyone. Use “Close it” instead if you only want it out of the active list.</Confirm> : null}
    </>
  );
}

export default function Rti() {
  const { perms } = usePractice();
  const [filter, setFilter] = useState('open');
  const [text, setText] = useState('');
  const dq = useDebouncedValue(text, 300);
  const q = useAsync((signal) => pr.get('/rti', { status: filter, q: dq.trim() }, signal), [filter, dq]);
  const [form, setForm] = useState(null);
  const [view, setView] = useState(null);
  const d = q.data;

  return (
    <>
      <PageHead title="RTI tracker" sub="Right to Information applications and their 30-day deadlines, so no reply or appeal window slips by.">
        {perms.manage_rti ? <button type="button" className="dh-btn primary" onClick={() => setForm({})}><PIcon name="plus" />New application</button> : null}
      </PageHead>
      <div className="pr-toolbar">
        <div className="pr-segment" role="group" aria-label="Show">{FILTERS.map((x) => <button key={x.v} type="button" className={filter === x.v ? 'on' : ''} aria-pressed={filter === x.v} onClick={() => setFilter(x.v)}>{x.l}</button>)}</div>
        <div className="pr-searchbox grow" style={{ maxWidth: 360 }}><PIcon name="search" /><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search subject, department, reference" aria-label="Search RTI applications" /></div>
      </div>
      {!d ? (q.error ? <ErrorBox error={q.error} retry={q.reload} /> : <Loading label="Loading RTI applications…" />) : !d.rti.length ? (
        <EmptyState icon="clipboard" title={dq.trim() ? 'Nothing matches' : filter === 'open' ? 'No active RTI applications' : 'No RTI applications'} actions={perms.manage_rti && !dq.trim() ? <button type="button" className="dh-btn primary" onClick={() => setForm({})}>Add an application</button> : null}>
          Record each application with its filing date. The tracker works out when the reply and any appeals are due, and reminds you before they pass.
        </EmptyState>
      ) : (
        <Card flush>
          <div className="pr-list">
            {d.rti.map((r) => {
              const n = r.next_deadline;
              return (
                <button key={r.id} type="button" className={`pr-item ${n && n.days < 0 ? 'bad' : n && n.days <= 7 ? 'warn' : ''}`} onClick={() => setView(r.id)}>
                  <span style={{ minWidth: 0 }}>
                    <span className="ttl">{r.subject}</span>
                    <span className="meta"><span>{r.department}</span>{r.reference_no ? <span>Ref {r.reference_no}</span> : null}{r.filing_date ? <span>filed {fmtShort(r.filing_date)}</span> : null}{r.case_title ? <span>{r.case_title}</span> : null}{r.assignee ? <span>{r.assignee}</span> : null}</span>
                  </span>
                  <span className="side"><span className="pr-pill">{r.status_label}</span><Deadline r={r} /></span>
                </button>
              );
            })}
          </div>
        </Card>
      )}
      {form ? <RtiForm existing={form.existing} onClose={() => setForm(null)} onSaved={() => { setForm(null); q.reload(); }} /> : null}
      {view ? <RtiDetail id={view} onClose={() => setView(null)} onChanged={q.reload} onEdit={(r) => { setView(null); setForm({ existing: r }); }} /> : null}
    </>
  );
}
