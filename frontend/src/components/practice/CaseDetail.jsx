import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Confirm, EmptyState, Menu } from '../dochub/ui.jsx';
import { fmtAgo } from '../dochub/format.js';
import { PIcon } from './icons.jsx';
import { doneWith, pr } from './api.js';
import { usePractice } from './ctx.js';
import { CaseForm, PartyModal } from './forms.jsx';
import { HearingModal, RecordProceedingModal, ReminderModal } from './actions.jsx';
import { DocumentsTab, NotesTab, ProceedingsTab, TimelineTab } from './CaseTabs.jsx';
import { Card, DayChip, ErrorBox, Loading, Prio, StatusPill, useAsync } from './widgets.jsx';
import { fmtDayLong, fmtShort, fmtTime, human, istToday, relDay } from './util.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'proceedings', label: 'Proceedings', count: 'proceedings' },
  { id: 'hearings', label: 'Hearings' },
  { id: 'documents', label: 'Documents', count: 'documents' },
  { id: 'people', label: 'People' },
  { id: 'notes', label: 'Notes & contact', count: 'notes' },
];

function NextBox({ c, onSchedule, onRecord, canWrite }) {
  const today = istToday();
  const late = (c.hearings || []).filter((h) => h.status === 'scheduled' && h.hearing_date < today).sort((a, b) => a.hearing_date.localeCompare(b.hearing_date))[0];
  if (c.closed) return <div className="pr-next"><div className="lab">Case closed</div><div className="big" style={{ fontSize: 18 }}>{c.status}</div><div className="rel">{c.closed_at ? fmtShort(c.closed_at.slice(0, 10)) : ''}</div></div>;
  if (late) {
    return (
      <div className="pr-next bad">
        <div className="lab">Needs a record</div>
        <div className="big">{fmtShort(late.hearing_date)}</div>
        <div className="rel">hearing is {relDay(late.hearing_date).text.toLowerCase()}</div>
        {canWrite ? <button type="button" className="dh-btn primary sm" style={{ marginTop: 8 }} onClick={() => onRecord(late.id)}>Record proceeding</button> : null}
      </div>
    );
  }
  const next = (c.hearings || []).filter((h) => h.status === 'scheduled').sort((a, b) => a.hearing_date.localeCompare(b.hearing_date))[0];
  if (!next) {
    return (
      <div className="pr-next warn">
        <div className="lab">Next hearing</div>
        <div className="big" style={{ fontSize: 17 }}>No date set</div>
        {canWrite ? <button type="button" className="dh-btn ghost sm" style={{ marginTop: 8 }} onClick={onSchedule}><PIcon name="plus" />Schedule one</button> : null}
      </div>
    );
  }
  const r = relDay(next.hearing_date);
  return (
    <div className={`pr-next ${r.tone === 'warn' ? 'warn' : ''}`}>
      <div className="lab">Next hearing</div>
      <div className="big">{fmtShort(next.hearing_date)}</div>
      <div className="rel">{r.text}{next.hearing_time ? ` · ${fmtTime(next.hearing_time)}` : ''}</div>
      {next.purpose ? <div className="rel" style={{ color: 'var(--muted)' }}>{next.purpose}</div> : null}
    </div>
  );
}

function Overview({ c, onTab }) {
  const rows = [
    ['Case type', c.case_type + (c.category ? ` · ${c.category}` : '')],
    ['Court', [c.court, c.hall_no ? `Hall ${c.hall_no}` : null].filter(Boolean).join(' · ')],
    ['Judge', c.judge],
    ['Registration no.', c.reg_no],
    ['Filing date', c.filing_date ? fmtDayLong(c.filing_date) : null],
    ['Opposite party', c.opposite_party],
    ['Client', c.client_id ? <Link className="pr-link" to={`/practice/clients/${c.client_id}`}>{c.client_name}</Link> : null],
    ['Advocate', c.advocate_name],
    ['Next action', c.next_action ? <>{c.next_action} {c.next_action_due ? <DayChip date={c.next_action_due} /> : null}</> : null],
    ['Outcome', c.outcome],
    ['Remarks', c.remarks ? <span className="pr-pre">{c.remarks}</span> : null],
  ].filter(([, v]) => v);
  return (
    <div className="pr-grid detail">
      <Card title="Case details">
        <dl className="pr-kv">
          {rows.map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>))}
          <dt>Added</dt><dd className="soft">{fmtAgo(c.created_at)}</dd>
          <dt>Last update</dt><dd className="soft">{fmtAgo(c.updated_at)}</dd>
        </dl>
      </Card>
      <div className="pr-stack">
        <Card title="At a glance" flush>
          <div className="pr-list">
            <button type="button" className="pr-item" onClick={() => onTab('proceedings')}><span className="ttl" style={{ fontSize: 13.5 }}>Proceedings recorded</span><span className="pr-mono">{c.counts.proceedings}</span></button>
            <button type="button" className="pr-item" onClick={() => onTab('documents')}><span className="ttl" style={{ fontSize: 13.5 }}>Documents</span><span className="pr-mono">{c.counts.documents}</span></button>
            <button type="button" className="pr-item" onClick={() => onTab('notes')}><span className="ttl" style={{ fontSize: 13.5 }}>Team notes</span><span className="pr-mono">{c.counts.notes}</span></button>
            <button type="button" className="pr-item last" onClick={() => onTab('notes')}><span className="ttl" style={{ fontSize: 13.5 }}>Client contacts logged</span><span className="pr-mono">{c.counts.comms}</span></button>
          </div>
        </Card>
        {c.last_hearing ? <Card title="Last heard" tight><p style={{ margin: 0 }}>{fmtDayLong(c.last_hearing)}</p><button type="button" className="pr-link" style={{ marginTop: 6 }} onClick={() => onTab('proceedings')}>Read the proceedings</button></Card> : null}
      </div>
    </div>
  );
}

function HearingsTab({ c, onRecord, onEdit, onAdd, onRemind, reload }) {
  const { toast } = usePractice();
  const [del, setDel] = useState(null);
  const today = istToday();
  const setStatus = async (h, status) => { try { await pr.patch(`/hearings/${h.id}`, { status }); toast(status === 'cancelled' ? 'Hearing cancelled' : 'Hearing updated'); reload(); } catch (e) { toast(doneWith(e), { tone: 'bad' }); } };
  const remove = async () => { try { await pr.del(`/hearings/${del.id}`); toast('Hearing removed'); reload(); } catch (e) { toast(doneWith(e), { tone: 'bad' }); } setDel(null); };
  return (
    <>
      <Card title="Hearings" sub="newest first" flush actions={c.can.update ? <button type="button" className="dh-btn primary sm" onClick={onAdd}><PIcon name="plus" />Schedule hearing</button> : null}>
        {!c.hearings.length ? <div style={{ padding: 16 }}><EmptyState icon="scale" title="No hearings yet" actions={c.can.update ? <button type="button" className="dh-btn primary" onClick={onAdd}>Schedule the first hearing</button> : null}>Add a hearing date so it shows up in the cause list, the calendar and the reminders.</EmptyState></div> : (
          <div className="pr-list">
            {c.hearings.map((h) => {
              const sched = h.status === 'scheduled';
              const past = h.hearing_date < today;
              return (
                <div key={h.id} className={`pr-item ${sched && past ? 'bad' : ''}`} style={{ cursor: 'default' }}>
                  <span style={{ minWidth: 0 }}>
                    <span className="ttl">{fmtDayLong(h.hearing_date)}{h.hearing_time ? ` · ${fmtTime(h.hearing_time)}` : ''}</span>
                    <span className="meta">{h.court ? <span>{h.court}</span> : null}{h.hall_no ? <span>Hall {h.hall_no}</span> : null}{h.judge ? <span>{h.judge}</span> : null}{h.purpose ? <span>{h.purpose}</span> : null}{h.serial_no ? <span>Item {h.serial_no}</span> : null}{h.advocate_name ? <span>{h.advocate_name}</span> : null}</span>
                    {h.note ? <span className="meta"><span>{h.note}</span></span> : null}
                  </span>
                  <span className="side">
                    <span className="pr-actions" style={{ justifyContent: 'flex-end' }}>
                      {sched ? <DayChip date={h.hearing_date} past="overdue" /> : <span className={`pr-pill ${h.status === 'cancelled' ? 'dim' : 'good'}`}>{human(h.status)}</span>}
                    </span>
                    {c.can.update && h.writable ? (
                      <span className="acts">
                        {sched && h.hearing_date <= today ? <button type="button" className="dh-btn primary sm" onClick={() => onRecord(h.id)}>Record</button> : null}
                        {sched && c.client_id ? <button type="button" className="dh-ibtn" onClick={() => onRemind(h.id)} aria-label="Remind the client" title="Remind the client"><PIcon name="chat" /></button> : null}
                        <Menu icon="more" label="" chevron={false} right className="dh-ibtn" title="More">
                          {(close) => (
                            <>
                              <button type="button" className="item" onClick={() => { close(); onEdit(h); }}><PIcon name="edit" />Edit or reschedule</button>
                              {sched ? <button type="button" className="item" onClick={() => { close(); setStatus(h, 'cancelled'); }}><PIcon name="close" />Mark as cancelled</button> : null}
                              {h.status === 'cancelled' ? <button type="button" className="item" onClick={() => { close(); setStatus(h, 'scheduled'); }}><PIcon name="restore" />Put back on the list</button> : null}
                              {(sched || h.status === 'cancelled') ? <button type="button" className="item danger" onClick={() => { close(); setDel(h); }}><PIcon name="trash" />Delete</button> : null}
                            </>
                          )}
                        </Menu>
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {del ? <Confirm title="Delete this hearing?" danger confirmLabel="Delete" onConfirm={remove} onCancel={() => setDel(null)}>The hearing on {fmtDayLong(del.hearing_date)} will be removed. If it already has a proceeding recorded it cannot be deleted, so mark it cancelled instead.</Confirm> : null}
    </>
  );
}

function PeopleTab({ c, reload, onRemind }) {
  const { toast } = usePractice();
  const [party, setParty] = useState(null);
  const [del, setDel] = useState(null);
  const remove = async () => { try { await pr.del(`/parties/${del.id}`); toast('Party removed'); reload(); } catch (e) { toast(doneWith(e), { tone: 'bad' }); } setDel(null); };
  return (
    <div className="pr-grid even">
      <Card title="Parties" flush actions={c.can.update ? <button type="button" className="dh-btn ghost sm" onClick={() => setParty({})}><PIcon name="plus" />Add</button> : null}>
        {!c.parties.length ? <p className="pr-note" style={{ textAlign: 'center', padding: 22 }}>No parties recorded. Add the petitioner, respondent, opposing counsel or witnesses.</p> : c.parties.map((p) => (
          <div className="pr-item last" key={p.id} style={{ cursor: 'default' }}>
            <span style={{ minWidth: 0 }}><span className="ttl" style={{ fontSize: 14 }}>{p.name}</span><span className="meta"><span>{human(p.role)}</span>{p.contact ? <span>{p.contact}</span> : null}{p.notes ? <span>{p.notes}</span> : null}</span></span>
            {c.can.update ? <span className="acts"><button type="button" className="dh-ibtn" aria-label={`Edit ${p.name}`} onClick={() => setParty(p)}><PIcon name="edit" /></button><button type="button" className="dh-ibtn" aria-label={`Remove ${p.name}`} onClick={() => setDel(p)}><PIcon name="trash" /></button></span> : null}
          </div>
        ))}
      </Card>
      <div className="pr-stack">
        <Card title="Client">
          {c.client_id ? (
            <>
              <p style={{ margin: '0 0 8px' }}><Link className="pr-link" to={`/practice/clients/${c.client_id}`} style={{ fontSize: 15 }}>{c.client_name}</Link></p>
              <dl className="pr-kv" style={{ gridTemplateColumns: '80px minmax(0,1fr)' }}>
                <dt>Phone</dt><dd>{c.client_phone ? <a className="pr-link" href={`tel:${c.client_phone}`}>{c.client_phone}</a> : <span className="pr-muted">Not on file</span>}</dd>
                <dt>Email</dt><dd>{c.client_email ? <a className="pr-link" href={`mailto:${c.client_email}`}>{c.client_email}</a> : <span className="pr-muted">Not on file</span>}</dd>
              </dl>
              <div className="pr-actions" style={{ marginTop: 12 }}>
                <button type="button" className="dh-btn primary sm" onClick={() => onRemind()}><PIcon name="chat" />Remind about the next hearing</button>
                <Link className="dh-btn ghost sm" to={`/practice/clients/${c.client_id}`}>Open client</Link>
              </div>
            </>
          ) : <p className="pr-note" style={{ margin: 0 }}>No client linked to this case yet.{c.level === 'full' ? ' Use “Edit” to add one.' : ''}</p>}
        </Card>
        <Card title="Advocate in charge">
          <p style={{ margin: 0, color: 'var(--ink)' }}>{c.advocate_name || 'Unassigned'}</p>
          {c.opposite_party ? <p className="pr-note">Opposite party: {c.opposite_party}</p> : null}
        </Card>
      </div>
      {party ? <PartyModal caseId={c.id} existing={party.id ? party : null} onClose={() => setParty(null)} onSaved={() => { setParty(null); reload(); }} /> : null}
      {del ? <Confirm title={`Remove ${del.name}?`} danger confirmLabel="Remove" onConfirm={remove} onCancel={() => setDel(null)}>They will no longer be listed on this case.</Confirm> : null}
    </div>
  );
}

export default function CaseDetail() {
  const { id } = useParams();
  const { toast } = usePractice();
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some((t) => t.id === sp.get('tab')) ? sp.get('tab') : 'overview';
  const q = useAsync((signal) => pr.get(`/cases/${id}`, null, signal).then((d) => d.case), [id], id);
  const [v, setV] = useState(0);
  const [edit, setEdit] = useState(false);
  const [rec, setRec] = useState(null);
  const [hear, setHear] = useState(null);
  const [rem, setRem] = useState(null);
  const [arch, setArch] = useState(false);
  const c = q.data;
  const bump = useCallback(() => { setV((x) => x + 1); q.reload(); }, [q.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const setTab = (t) => setSp((prev) => { const n = new URLSearchParams(prev); if (t === 'overview') n.delete('tab'); else n.set('tab', t); n.delete('hearing'); return n; }, { replace: true });

  // a link from the dashboard ("record what happened") opens the composer straight away
  const hearingParam = sp.get('hearing');
  useEffect(() => {
    if (c && hearingParam && c.can.update) {
      setRec({ hearingId: Number(hearingParam) });
      setSp((prev) => { const n = new URLSearchParams(prev); n.delete('hearing'); return n; }, { replace: true });
    }
  }, [c, hearingParam]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) {
    return (
      <>
        <Link className="pr-back" to="/practice/cases"><PIcon name="back" />All cases</Link>
        {q.error ? (
          q.error.status === 404 ? <EmptyState icon="briefcase" title="Case not found" actions={<Link className="dh-btn primary" to="/practice/cases">Back to cases</Link>}>It may have been removed, or you may not have access to it.</EmptyState> : <ErrorBox error={q.error} retry={q.reload} />
        ) : <Loading label="Opening the case…" />}
      </>
    );
  }

  const toggleArchive = async () => {
    try { await pr.post(`/cases/${c.id}/archive`, { archive: !c.archived }); toast(c.archived ? 'Case restored' : 'Case archived'); setArch(false); bump(); } catch (e) { toast(doneWith(e), { tone: 'bad' }); setArch(false); }
  };

  return (
    <>
      <Link className="pr-back" to="/practice/cases"><PIcon name="back" />All cases</Link>
      {c.archived ? <div className="dh-banners"><div className="dh-banner plain"><PIcon name="archive" /><div className="body"><b>This case is archived.</b> It is hidden from the active lists and cannot be changed until it is restored.</div>{c.can.archive ? <button type="button" className="dh-btn ghost sm" onClick={toggleArchive}>Restore</button> : null}</div></div> : null}
      <div className="pr-hero">
        <div style={{ minWidth: 0 }}>
          <div className="tags">
            <StatusPill status={c.status} /><Prio priority={c.priority} />
            <span className="dh-chip">{c.case_type}</span>
            {c.restricted ? <span className="dh-chip warn"><PIcon name="lock" />Confidential</span> : null}
          </div>
          <h1>{c.title}</h1>
          <div className="line">
            <span className="pr-mono">{c.case_no}</span><span>{c.court}{c.hall_no ? ` · Hall ${c.hall_no}` : ''}</span>
            {c.judge ? <span>{c.judge}</span> : null}
            {c.client_name ? <span><PIcon name="user" size={13} /> {c.client_name}</span> : null}
            {c.advocate_name ? <span><PIcon name="scale" size={13} /> {c.advocate_name}</span> : null}
          </div>
          <div className="pr-actions" style={{ marginTop: 14 }}>
            {c.can.update ? <button type="button" className="dh-btn primary" onClick={() => setRec({})}><PIcon name="edit" />Record proceeding</button> : null}
            {c.can.update ? <button type="button" className="dh-btn ghost" onClick={() => setHear({})}><PIcon name="calendar" />Schedule hearing</button> : null}
            {c.client_id ? <button type="button" className="dh-btn ghost" onClick={() => setRem({})}><PIcon name="chat" />Remind client</button> : null}
            {c.can.upload ? <button type="button" className="dh-btn ghost" onClick={() => setTab('documents')}><PIcon name="upload" />Documents</button> : null}
            {c.level ? <button type="button" className="dh-btn ghost" onClick={() => setEdit(true)} disabled={c.archived}><PIcon name="gear" />{c.level === 'full' ? 'Edit' : 'Update'}</button> : null}
            {c.can.archive && !c.archived ? (
              <Menu icon="more" label="" chevron={false} className="dh-ibtn boxed" title="More actions" right>
                {(close) => <button type="button" className="item" onClick={() => { close(); setArch(true); }}><PIcon name="archive" />Archive this case</button>}
              </Menu>
            ) : null}
          </div>
        </div>
        <NextBox c={c} canWrite={c.can.update} onSchedule={() => setHear({})} onRecord={(hid) => setRec({ hearingId: hid })} />
      </div>

      <div className="pr-subtabs" role="tablist" aria-label="Case sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`dh-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}{t.count && c.counts[t.count] ? <span className="ct">{c.counts[t.count]}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'overview' ? <Overview c={c} onTab={setTab} /> : null}
      {tab === 'timeline' ? <TimelineTab caseId={c.id} version={v} /> : null}
      {tab === 'proceedings' ? <ProceedingsTab caseObj={c} version={v} onRecord={() => setRec({})} onChanged={bump} /> : null}
      {tab === 'hearings' ? <HearingsTab c={c} reload={bump} onAdd={() => setHear({})} onEdit={(h) => setHear({ hearing: h })} onRecord={(hid) => setRec({ hearingId: hid })} onRemind={(hid) => setRem({ hearingId: hid })} /> : null}
      {tab === 'documents' ? <DocumentsTab caseObj={c} onChanged={bump} onAddHearing={(initial) => setHear({ initial })} /> : null}
      {tab === 'people' ? <PeopleTab c={c} reload={bump} onRemind={() => setRem({})} /> : null}
      {tab === 'notes' ? <NotesTab caseObj={c} version={v} onChanged={() => { setV((x) => x + 1); }} /> : null}

      {edit ? <CaseForm existing={c} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); bump(); }} /> : null}
      {rec ? <RecordProceedingModal caseId={c.id} hearingId={rec.hearingId} onClose={() => setRec(null)} onSaved={() => { setRec(null); bump(); setTab('proceedings'); }} /> : null}
      {hear ? <HearingModal caseObj={c} hearing={hear.hearing} initial={hear.initial} onClose={() => setHear(null)} onSaved={() => { setHear(null); bump(); }} /> : null}
      {rem ? <ReminderModal caseId={c.id} hearingId={rem.hearingId} onClose={() => setRem(null)} onSent={() => setV((x) => x + 1)} /> : null}
      {arch ? <Confirm title="Archive this case?" confirmLabel="Archive" onConfirm={toggleArchive} onCancel={() => setArch(false)}>“{c.title}” will be hidden from the active lists and its hearings leave the cause list. Nothing is deleted, and you can restore it any time.</Confirm> : null}
    </>
  );
}
