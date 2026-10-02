import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Confirm, EmptyState, Modal } from '../dochub/ui.jsx';
import { dh } from '../dochub/api.js';
import { fx } from '../dochub/filesApi.js';
import { STATUS, fileBadge, fmtAgo, fmtBytes, fmtDate } from '../dochub/format.js';
import { PIcon } from './icons.jsx';
import { ApiError, doneWith, pr } from './api.js';
import { usePractice } from './ctx.js';
import { FollowupModal } from './forms.jsx';
import { Card, DayChip, ErrText, ErrorBox, Field, Loading, Spinner, useAsync } from './widgets.jsx';
import { fmtDayLong, fmtShort, fmtStamp, human, istToday } from './util.js';

const OUTCOME_LABEL = { heard: 'Heard', adjourned: 'Adjourned', reserved: 'Orders reserved', disposed: 'Disposed', other: 'Recorded' };

// ── timeline ───────────────────────────────────────────────────────────────────────────
const KIND_FILTERS = [
  { v: '', l: 'Everything' }, { v: 'proceeding,hearing', l: 'Hearings & proceedings' }, { v: 'document', l: 'Documents' },
  { v: 'status,updated,assigned,created,archived,restored,party', l: 'Case changes' }, { v: 'comm', l: 'Client contact' }, { v: 'note,rti', l: 'Notes & RTI' },
];
const KIND_LABEL = { proceeding: 'Proceeding', hearing: 'Hearing', document: 'Document', status: 'Status', updated: 'Edit', assigned: 'Assignment', created: 'Created', archived: 'Archive', restored: 'Archive', party: 'Party', comm: 'Contact', note: 'Note', rti: 'RTI' };

export function TimelineTab({ caseId, version }) {
  const [kind, setKind] = useState('');
  const q = useAsync((signal) => pr.get(`/cases/${caseId}/timeline`, { kind, limit: 200 }, signal), [caseId, kind, version]);
  return (
    <Card title="Case timeline" sub="newest first" actions={(
      <select className="dh-select" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter timeline">
        {KIND_FILTERS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
      </select>
    )}>
      {!q.data ? (q.error ? <ErrorBox error={q.error} retry={q.reload} compact /> : <Loading />) : !q.data.items.length ? (
        <p className="pr-note" style={{ textAlign: 'center', padding: 20 }}>Nothing here yet. Hearings, proceedings, documents and changes will appear as they happen.</p>
      ) : (
        <ul className="pr-tl">
          {q.data.items.map((it) => (
            <li key={it.id}>
              <span className={`pt ${it.kind}`} />
              <div className="t"><span className="k">{KIND_LABEL[it.kind] || it.kind}</span>{it.title}</div>
              {it.detail ? <div className="d">{it.detail}</div> : null}
              <div className="w">{it.actor ? `${it.actor} · ` : ''}{fmtAgo(it.at)} · {fmtStamp(it.at)}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── proceedings ────────────────────────────────────────────────────────────────────────
function EditProceeding({ p, onClose, onSaved }) {
  const { toast } = usePractice();
  const [f, setF] = useState({ outcome: p.outcome || '', notes: p.notes || '', observations: p.observations || '', orders: p.orders || '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await pr.patch(`/proceedings/${p.id}`, { ...f, outcome: f.outcome || null }); toast('Entry updated'); onSaved(); } catch (e2) { setErr(doneWith(e2)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Edit entry — ${fmtShort(p.proc_date)}`} onClose={busy ? () => {} : onClose}
      footer={(<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="pr-editproc" className="dh-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>)}>
      <form id="pr-editproc" onSubmit={submit} noValidate>
        <ErrText>{err}</ErrText>
        <Field label="Outcome"><select className="dh-select" value={f.outcome} onChange={set('outcome')}><option value="">Not set</option>{Object.entries(OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Hearing notes"><textarea className="dh-textarea" rows={3} value={f.notes} onChange={set('notes')} maxLength={8000} /></Field>
        <Field label="Court observations"><textarea className="dh-textarea" rows={3} value={f.observations} onChange={set('observations')} maxLength={8000} /></Field>
        <Field label="Orders passed"><textarea className="dh-textarea" rows={3} value={f.orders} onChange={set('orders')} maxLength={8000} /></Field>
        <p className="pr-note">The hearing date and next date cannot be edited here. The original wording stays in the audit log.</p>
      </form>
    </Modal>
  );
}

export function ProceedingsTab({ caseObj, version, onRecord, onChanged }) {
  const { me } = usePractice();
  const q = useAsync((signal) => pr.get(`/cases/${caseObj.id}/proceedings`, null, signal), [caseObj.id, version]);
  const [edit, setEdit] = useState(null);
  const canWrite = caseObj.can.update;
  return (
    <>
      <Card title="Daily proceedings" sub="what happened at each hearing" flush
        actions={canWrite ? <button type="button" className="dh-btn primary sm" onClick={() => onRecord()}><PIcon name="plus" />Record proceeding</button> : null}>
        {!q.data ? (q.error ? <ErrorBox error={q.error} retry={q.reload} compact /> : <Loading />) : !q.data.proceedings.length ? (
          <div style={{ padding: 16 }}><EmptyState icon="scale" title="No proceedings recorded" actions={canWrite ? <button type="button" className="dh-btn primary" onClick={() => onRecord()}>Record the first one</button> : null}>
            After each hearing, note what happened, what the court observed, the orders passed and the next date. It all feeds the case timeline.
          </EmptyState></div>
        ) : q.data.proceedings.map((p) => (
          <article className="pr-proc" key={p.id}>
            <div className="top">
              <span className="d">{fmtDayLong(p.proc_date)}</span>
              {p.outcome ? <span className="pr-pill">{OUTCOME_LABEL[p.outcome] || p.outcome}</span> : null}
              <span className="pr-muted pr-mono" style={{ fontSize: 11 }}>{p.author || 'Someone'} · {fmtAgo(p.created_at)}{p.edited_at ? ' · edited' : ''}</span>
              {canWrite && (p.author_id === me.member.id || me.member.role === 'senior') ? <button type="button" className="dh-btn quiet sm" style={{ marginLeft: 'auto' }} onClick={() => setEdit(p)}><PIcon name="edit" />Edit</button> : null}
            </div>
            {p.notes ? <div className="sec"><div className="lab">Hearing notes</div><p>{p.notes}</p></div> : null}
            {p.observations ? <div className="sec"><div className="lab">Court observations</div><p>{p.observations}</p></div> : null}
            {p.orders ? <div className="sec"><div className="lab">Orders passed</div><p>{p.orders}</p></div> : null}
            {p.next_date ? <div className="nxt"><PIcon name="calendar" />Next hearing {fmtDayLong(p.next_date)}{p.next_purpose ? ` — ${p.next_purpose}` : ''}</div> : null}
          </article>
        ))}
      </Card>
      {edit ? <EditProceeding p={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); q.reload(); onChanged(); }} /> : null}
    </>
  );
}

// the paper side of a case: scan paper onto it, see its physical files, make a court bundle (all of it lives in the Document Hub)
function PaperStrip({ caseObj, version }) {
  const ref = `lpms:${caseObj.id}`;
  const q = useAsync((signal) => fx.caseSummary(ref, signal), [ref, version]);
  const s = q.data || {};
  const to = (view) => `/document-hub?view=${view}&case=${encodeURIComponent(ref)}`;
  const n = (v) => (v ? <b className="n">{v}</b> : null);
  return (
    <div className="pr-paperstrip" role="group" aria-label="Paper files and bundles for this case">
      {s.to_file ? <Link className="pr-pstile hot" to="/document-hub?view=tofile"><PIcon name="inbox" /><span>{s.to_file} to put on this case</span></Link> : null}
      {caseObj.can.upload ? <Link className="pr-pstile" to={to('scan')}><PIcon name="camera" /><span>Scan paper</span></Link> : null}
      <Link className="pr-pstile" to={to('paper')}><PIcon name="cabinet" /><span>Paper files</span>{n(s.paper_files)}{s.paper_out ? <em>{s.paper_out} out</em> : null}</Link>
      <Link className="pr-pstile" to={to('bundles')}><PIcon name="bundle" /><span>Court bundles</span>{n(s.bundles)}</Link>
    </div>
  );
}

// ── documents (they live in the Document Hub; this is the case's window onto them) ──────────
export function DocumentsTab({ caseObj, onChanged, onAddHearing }) {
  const { toast } = usePractice();
  const [up, setUp] = useState([]);
  const [over, setOver] = useState(false);
  const [dismissed, setDismissed] = useState([]);
  const fileRef = useRef(null);
  const q = useAsync((signal) => dh.list({ lpms_case_id: caseObj.id, per_page: 100, sort: 'newest', facets: false }, signal), [caseObj.id]);
  const docs = q.data?.docs || [];

  // keep an eye on files the Hub is still reading
  const busy = docs.some((d) => d.status === 'queued' || d.status === 'processing');
  useEffect(() => {
    if (!busy) return undefined;
    const t = setTimeout(() => q.reload(), 4000);
    return () => clearTimeout(t);
  }, [busy, docs.length, q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendOne = useCallback(async (file, idx, force) => {
    const patch = (p) => setUp((l) => l.map((x, i) => (i === idx ? { ...x, ...p } : x)));
    patch({ status: 'sending', msg: '' });
    try {
      const r = await dh.upload(file, { lpmsCaseId: caseObj.id, force });
      if (r.duplicate) patch({ status: 'dup', msg: `Already in the Document Hub${r.existing?.title ? ` as “${r.existing.title}”` : ''}.`, file });
      else patch({ status: 'done', msg: '' });
    } catch (e) { patch({ status: 'failed', msg: e instanceof ApiError ? e.message : 'Upload failed.', file }); }
  }, [caseObj.id]);

  const upload = async (fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    const start = up.length;
    setUp((l) => [...l, ...files.map((f) => ({ name: f.name, status: 'sending', msg: '' }))]);
    for (let i = 0; i < files.length; i += 1) { await sendOne(files[i], start + i, false); }
    q.reload(); onChanged();
    toast(files.length === 1 ? 'Document uploaded' : `${files.length} documents processed`);
  };

  const suggestion = (() => {
    const today = istToday();
    const have = new Set((caseObj.hearings || []).filter((h) => h.status === 'scheduled').map((h) => h.hearing_date));
    return docs.find((d) => d.next_hearing && d.next_hearing >= today && !have.has(d.next_hearing) && !dismissed.includes(d.id));
  })();

  const onDrop = (e) => { e.preventDefault(); setOver(false); if (caseObj.can.upload) upload(e.dataTransfer.files); };

  return (
    <>
      {suggestion ? (
        <div className="dh-banners">
          <div className="dh-banner">
            <PIcon name="calendar" />
            <div className="body"><b>{suggestion.title}</b> mentions the next hearing on <b>{fmtDayLong(suggestion.next_hearing)}</b>, which is not in this case's hearings yet.</div>
            <button type="button" className="dh-btn primary sm" onClick={() => onAddHearing({ date: suggestion.next_hearing, purpose: '' })}>Add to hearings</button>
            <button type="button" className="dh-btn quiet sm" onClick={() => setDismissed((l) => [...l, suggestion.id])}>Not now</button>
          </div>
        </div>
      ) : null}
      {caseObj.can.upload ? (
        <div className={`pr-drop ${over ? 'over' : ''}`} style={{ marginBottom: 16 }} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
          <PIcon name="upload" size={22} />
          <p style={{ margin: '6px 0 10px' }}><b>Drop files here</b> to add them to this case, or</p>
          <button type="button" className="dh-btn primary" onClick={() => fileRef.current?.click()}>Choose files</button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} aria-label="Choose files to upload" />
          <p className="pr-note">Files go to the Document Hub, which reads them, finds dates and orders, and makes them searchable.</p>
        </div>
      ) : <div className="dh-banner plain" style={{ marginBottom: 16 }}><PIcon name="lock" /><div className="body">{caseObj.archived ? 'This case is archived. Restore it to upload documents.' : 'You cannot upload documents to this case.'}</div></div>}

      {up.length ? (
        <Card title="This session's uploads" tight flush actions={<button type="button" className="dh-btn quiet sm" onClick={() => setUp((l) => l.filter((x) => x.status === 'sending'))}>Clear</button>}>
          {up.map((u, i) => (
            <div key={i} className="pr-item last" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
              <span style={{ minWidth: 0 }}><span className="ttl" style={{ fontSize: 13.5 }}>{u.name}</span>{u.msg ? <span className="meta"><span>{u.msg}</span></span> : null}</span>
              <span className="acts">
                {u.status === 'sending' ? <span className="pr-pill"><Spinner />Uploading</span> : null}
                {u.status === 'done' ? <span className="pr-pill good"><PIcon name="check" />Added</span> : null}
                {u.status === 'dup' ? <button type="button" className="dh-btn ghost sm" onClick={() => sendOne(u.file, i, true).then(() => { q.reload(); onChanged(); })}>Add anyway</button> : null}
                {u.status === 'failed' ? <span className="pr-pill bad">Failed</span> : null}
                {u.status === 'failed' && u.file ? <button type="button" className="dh-btn ghost sm" onClick={() => sendOne(u.file, i, false).then(() => { q.reload(); onChanged(); })}>Retry</button> : null}
              </span>
            </div>
          ))}
        </Card>
      ) : null}

      <PaperStrip caseObj={caseObj} version={q.data} />

      <Card title="Case documents" sub={q.data ? `${q.data.total} ${q.data.total === 1 ? 'file' : 'files'}` : null} flush
        actions={<Link className="dh-btn ghost sm" to={`/document-hub?lpms_case=${caseObj.id}`}><PIcon name="external" />Open in Document Hub</Link>}>
        {!q.data ? (q.error ? <ErrorBox error={q.error} retry={q.reload} compact /> : <Loading />) : !docs.length ? (
          <p className="pr-note" style={{ textAlign: 'center', padding: 22 }}>No documents on this case yet.</p>
        ) : docs.map((d) => {
          const st = STATUS[d.status] || STATUS.ready;
          return (
            <div className="pr-doc" key={d.id}>
              <span className="ic">{fileBadge(d)}</span>
              <div style={{ minWidth: 0 }}>
                <Link className="ttl" to={`/document-hub?doc=${d.id}`} style={{ textDecoration: 'none' }}>{d.title}</Link>
                <div className="meta pr-mono" style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: '3px 12px', flexWrap: 'wrap', marginTop: 2 }}>
                  <span>{d.doc_class}</span>{d.doc_date ? <span>dated {fmtDate(d.doc_date)}</span> : null}<span>{fmtBytes(d.size)}</span>{d.page_count ? <span>{d.page_count} pp</span> : null}<span>{fmtAgo(d.created_at)}</span>
                  {d.next_hearing ? <span style={{ color: 'var(--accent)' }}>next hearing {fmtShort(d.next_hearing)}</span> : null}
                  {st.tone !== 'ok' ? <span className={`dh-chip ${st.tone === 'bad' ? 'bad' : st.tone === 'warn' ? 'warn' : 'busy'}`} title={st.hint}>{st.label}</span> : null}
                </div>
              </div>
              <div className="acts" style={{ display: 'flex', gap: 2 }}>
                <Link className="dh-ibtn" to={`/document-hub?doc=${d.id}`} aria-label={`Preview ${d.title}`} title="Preview"><PIcon name="eye" /></Link>
                <button type="button" className="dh-ibtn" aria-label={`Download ${d.title}`} title="Download" onClick={() => dh.download(d.id, d.original_name).catch((e) => toast(doneWith(e), { tone: 'bad' }))}><PIcon name="download" /></button>
              </div>
            </div>
          );
        })}
      </Card>
    </>
  );
}

// ── notes, client contact and follow-ups ────────────────────────────────────────────────
const COMM_STATUS = { opened: 'Opened in WhatsApp', sent: 'Sent', not_sent: 'Not sent (e-mail not set up)', failed: 'Failed', logged: 'Logged' };
const COMM_ICON = { email: 'mail', whatsapp: 'chat', call: 'phone', meeting: 'users', note: 'doc' };

export function NotesTab({ caseObj, version, onChanged }) {
  const { toast, meta } = usePractice();
  const notes = useAsync((signal) => pr.get(`/cases/${caseObj.id}/notes`, null, signal), [caseObj.id, version]);
  const comms = useAsync((signal) => pr.get('/comms', { case_id: caseObj.id }, signal), [caseObj.id, version]);
  const fus = useAsync((signal) => pr.get('/followups', { case_id: caseObj.id, status: 'open' }, signal), [caseObj.id, version]);
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState('');
  const [delNote, setDelNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [log, setLog] = useState({ channel: 'call', direction: 'in', subject: '', body: '' });
  const [logErr, setLogErr] = useState('');
  const [showFu, setShowFu] = useState(false);
  const canNote = !caseObj.archived;

  const addNote = async (e) => {
    e.preventDefault();
    if (!body.trim()) { setErr('Write the note first.'); return; }
    setBusy(true); setErr('');
    try { await pr.post(`/cases/${caseObj.id}/notes`, { body }); setBody(''); notes.reload(); onChanged(); } catch (e2) { setErr(doneWith(e2)); } finally { setBusy(false); }
  };
  const saveEdit = async () => {
    if (!editText.trim()) return;
    try { await pr.patch(`/notes/${editing}`, { body: editText }); setEditing(null); notes.reload(); } catch (e2) { toast(doneWith(e2), { tone: 'bad' }); }
  };
  const pin = async (n) => { try { await pr.patch(`/notes/${n.id}`, { pinned: !n.pinned }); notes.reload(); } catch (e2) { toast(doneWith(e2), { tone: 'bad' }); } };
  const removeNote = async () => {
    try { await pr.del(`/notes/${delNote.id}`); setDelNote(null); notes.reload(); } catch (e2) { toast(doneWith(e2), { tone: 'bad' }); setDelNote(null); }
  };
  const addLog = async (e) => {
    e.preventDefault();
    if (!log.body.trim()) { setLogErr('Say what was discussed.'); return; }
    setBusy(true); setLogErr('');
    try { await pr.post('/comms', { ...log, case_id: caseObj.id, subject: log.subject || null }); setLog({ ...log, subject: '', body: '' }); comms.reload(); onChanged(); toast('Contact logged'); } catch (e2) { setLogErr(doneWith(e2)); } finally { setBusy(false); }
  };
  const doneFu = async (f) => { try { await pr.patch(`/followups/${f.id}`, { status: 'done' }); fus.reload(); } catch (e2) { toast(doneWith(e2), { tone: 'bad' }); } };
  const delFu = async (f) => { try { await pr.del(`/followups/${f.id}`); fus.reload(); } catch (e2) { toast(doneWith(e2), { tone: 'bad' }); } };

  return (
    <div className="pr-grid even">
      <div className="pr-stack">
        <Card title="Internal notes" sub="visible to your team only" flush>
          {canNote ? (
            <form className="pr-compose" onSubmit={addNote} noValidate>
              <ErrText>{err}</ErrText>
              <textarea className="dh-textarea" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a note for the team…" aria-label="New note" maxLength={4000} />
              <div><button type="submit" className="dh-btn primary sm" disabled={busy}>Add note</button></div>
            </form>
          ) : null}
          {!notes.data ? (notes.error ? <ErrorBox error={notes.error} retry={notes.reload} compact /> : <Loading />) : !notes.data.notes.length ? <p className="pr-note" style={{ textAlign: 'center', padding: 20 }}>No notes yet.</p> : notes.data.notes.map((n) => (
            <div key={n.id} className={`pr-notebox ${n.pinned ? 'pinned' : ''}`}>
              <div className="by"><b>{n.author || 'Someone'}</b><span>{fmtAgo(n.created_at)}{n.edited_at ? ' · edited' : ''}</span>{n.pinned ? <span className="pr-pill warn">Pinned</span> : null}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                  {n.can_edit ? <button type="button" className="dh-ibtn" onClick={() => pin(n)} aria-label={n.pinned ? 'Unpin note' : 'Pin note'} title={n.pinned ? 'Unpin' : 'Pin to top'}><PIcon name="pin" /></button> : null}
                  {n.can_edit ? <button type="button" className="dh-ibtn" onClick={() => { setEditing(n.id); setEditText(n.body); }} aria-label="Edit note" title="Edit"><PIcon name="edit" /></button> : null}
                  {n.can_edit ? <button type="button" className="dh-ibtn" onClick={() => setDelNote(n)} aria-label="Delete note" title="Delete"><PIcon name="trash" /></button> : null}
                </span>
              </div>
              {editing === n.id ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <textarea className="dh-textarea" rows={3} value={editText} onChange={(e) => setEditText(e.target.value)} maxLength={4000} aria-label="Edit note text" autoFocus />
                  <div className="pr-actions"><button type="button" className="dh-btn primary sm" onClick={saveEdit}>Save</button><button type="button" className="dh-btn ghost sm" onClick={() => setEditing(null)}>Cancel</button></div>
                </div>
              ) : <p className="pr-pre">{n.body}</p>}
            </div>
          ))}
        </Card>
      </div>

      <div className="pr-stack">
        <Card title="Follow-ups" flush actions={canNote ? <button type="button" className="dh-btn ghost sm" onClick={() => setShowFu(true)}><PIcon name="plus" />Add</button> : null}>
          {!fus.data ? (fus.error ? <ErrorBox error={fus.error} retry={fus.reload} compact /> : <Loading />) : !fus.data.followups.length ? <p className="pr-note" style={{ textAlign: 'center', padding: 18 }}>No open follow-ups.</p> : fus.data.followups.map((f) => (
            <div key={f.id} className={`pr-item last ${f.overdue ? 'bad' : ''}`}>
              <span style={{ minWidth: 0 }}><span className="ttl" style={{ fontSize: 13.5 }}>{f.note}</span><span className="meta"><span>{f.assignee || 'Unassigned'}</span>{f.channel ? <span>{human(f.channel)}</span> : null}</span></span>
              <span className="side"><DayChip date={f.due_date} /><span className="acts"><button type="button" className="dh-btn ghost sm" onClick={() => doneFu(f)}><PIcon name="check" />Done</button><button type="button" className="dh-ibtn" aria-label="Delete follow-up" onClick={() => delFu(f)}><PIcon name="trash" /></button></span></span>
            </div>
          ))}
        </Card>

        <Card title="Client contact" sub="WhatsApp, e-mail and calls" flush>
          {canNote ? (
            <form className="pr-compose" onSubmit={addLog} noValidate>
              <ErrText>{logErr}</ErrText>
              <div className="dh-row2">
                <select className="dh-select" value={log.channel} onChange={(e) => setLog({ ...log, channel: e.target.value })} aria-label="Type of contact">{meta.comm_channels.map((c) => <option key={c} value={c}>{human(c)}</option>)}</select>
                <select className="dh-select" value={log.direction} onChange={(e) => setLog({ ...log, direction: e.target.value })} aria-label="Direction"><option value="in">They contacted us</option><option value="out">We contacted them</option></select>
              </div>
              <input className="dh-input" placeholder="Subject (optional)" value={log.subject} onChange={(e) => setLog({ ...log, subject: e.target.value })} aria-label="Subject" maxLength={200} />
              <textarea className="dh-textarea" rows={2} placeholder="What was discussed" value={log.body} onChange={(e) => setLog({ ...log, body: e.target.value })} aria-label="What was discussed" maxLength={4000} />
              <div><button type="submit" className="dh-btn primary sm" disabled={busy}>Log contact</button></div>
            </form>
          ) : null}
          {!comms.data ? (comms.error ? <ErrorBox error={comms.error} retry={comms.reload} compact /> : <Loading />) : !comms.data.comms.length ? <p className="pr-note" style={{ textAlign: 'center', padding: 18 }}>No contact recorded yet. Reminders you send from here are saved too.</p> : comms.data.comms.map((c) => (
            <div key={c.id} className="pr-item last" style={{ gridTemplateColumns: '22px minmax(0,1fr) auto', alignItems: 'start' }}>
              <PIcon name={COMM_ICON[c.channel] || 'doc'} />
              <span style={{ minWidth: 0 }}>
                <span className="ttl" style={{ fontSize: 13.5 }}>{c.subject || human(c.channel)}{c.direction === 'in' ? ' (incoming)' : ''}</span>
                <span className="pr-pre" style={{ fontSize: 12.5, display: 'block', marginTop: 2 }}>{(c.body || '').length > 220 ? `${c.body.slice(0, 220)}…` : c.body}</span>
                <span className="meta"><span>{c.by || ''}</span><span>{COMM_STATUS[c.status] || c.status}</span></span>
              </span>
              <span className="side">{fmtAgo(c.created_at)}</span>
            </div>
          ))}
        </Card>
      </div>

      {showFu ? <FollowupModal caseId={caseObj.id} onClose={() => setShowFu(false)} onSaved={() => { setShowFu(false); fus.reload(); }} /> : null}
      {delNote ? <Confirm title="Delete this note?" danger confirmLabel="Delete" onConfirm={removeNote} onCancel={() => setDelNote(null)}>This removes the note for everyone on the team.</Confirm> : null}
    </div>
  );
}
