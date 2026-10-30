import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Confirm, Modal } from '../dochub/ui.jsx';
import { PIcon } from './icons.jsx';
import { doneWith, pr } from './api.js';
import { usePractice } from './ctx.js';
import { ErrText, ErrorBox, Field, Loading, PageHead, Segment, useAsync } from './widgets.jsx';
import { MONTHS_LONG, addDays, daysInMonth, dowOf, emptyToNull, fmtDayLong, fmtTime, human, isoOf, istToday, plural } from './util.js';

const KIND_NAME = { hearing: 'Hearing', meeting: 'Meeting', appointment: 'Appointment', deadline: 'Deadline', holiday: 'Court holiday', rti: 'RTI', followup: 'Follow-up' };

function EventModal({ existing, date, onClose, onSaved }) {
  const { perms, members, toast } = usePractice();
  const editing = !!existing;
  const kinds = ['meeting', 'appointment', 'deadline', ...(perms.add_holidays ? ['holiday'] : [])];
  const [f, setF] = useState({
    title: existing?.title || '', kind: existing?.kind || 'meeting', start_date: existing?.start_date || date || istToday(), end_date: existing?.end_date || '',
    start_time: existing?.start_time || '', end_time: existing?.end_time || '', location: existing?.location || '', notes: existing?.notes || '', member_id: existing?.member_id ? String(existing.member_id) : '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [del, setDel] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const hol = f.kind === 'holiday';
  const submit = async (e) => {
    e.preventDefault();
    if (!f.title.trim()) { setErr('Give it a title.'); return; }
    if (!f.start_date) { setErr('Pick a date.'); return; }
    setBusy(true); setErr('');
    try {
      const body = emptyToNull({ ...f, member_id: f.member_id ? Number(f.member_id) : null });
      if (editing) await pr.patch(`/events/${existing.id}`, body); else await pr.post('/events', body);
      toast(editing ? 'Updated' : `${KIND_NAME[f.kind]} added`);
      onSaved();
    } catch (e2) { setErr(doneWith(e2)); } finally { setBusy(false); }
  };
  const remove = async () => { setBusy(true); try { await pr.del(`/events/${existing.id}`); toast('Removed'); onSaved(); } catch (e2) { setErr(doneWith(e2)); setDel(false); setBusy(false); } };
  return (
    <>
      <Modal small title={editing ? 'Edit entry' : 'Add to the calendar'} onClose={busy ? () => {} : onClose}
        footer={(
          <>
            {editing && existing.can_edit ? <button type="button" className="dh-btn danger" onClick={() => setDel(true)} disabled={busy}>Delete</button> : null}
            <span className="sp" />
            <button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" form="pr-event-form" className="dh-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </>
        )}>
        <form id="pr-event-form" onSubmit={submit} noValidate>
          <ErrText>{err}</ErrText>
          <Field label="Title" required><input className="dh-input" value={f.title} onChange={set('title')} autoFocus maxLength={200} placeholder={hol ? 'e.g. Diwali' : 'e.g. Client meeting — Mr. Kumar'} /></Field>
          <Field label="Type"><select className="dh-select" value={f.kind} onChange={set('kind')}>{kinds.map((k) => <option key={k} value={k}>{KIND_NAME[k]}</option>)}</select></Field>
          <div className="dh-row2">
            <Field label={hol ? 'From' : 'Date'} required><input type="date" className="dh-input" value={f.start_date} onChange={set('start_date')} /></Field>
            <Field label={hol ? 'To (optional)' : 'End date (optional)'}><input type="date" className="dh-input" value={f.end_date || ''} min={f.start_date} onChange={set('end_date')} /></Field>
          </div>
          {!hol ? (
            <div className="dh-row2">
              <Field label="Starts"><input type="time" className="dh-input" value={f.start_time || ''} onChange={set('start_time')} /></Field>
              <Field label="Ends"><input type="time" className="dh-input" value={f.end_time || ''} onChange={set('end_time')} /></Field>
            </div>
          ) : null}
          {!hol ? <Field label="Location"><input className="dh-input" value={f.location} onChange={set('location')} maxLength={200} /></Field> : null}
          {!hol ? (
            <Field label="Who attends" hint="They get a notification.">
              <select className="dh-select" value={f.member_id} onChange={set('member_id')}><option value="">Nobody in particular</option>{(members || []).filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            </Field>
          ) : null}
          <Field label="Notes"><textarea className="dh-textarea" rows={2} value={f.notes} onChange={set('notes')} maxLength={2000} /></Field>
        </form>
      </Modal>
      {del ? <Confirm title="Delete this entry?" danger confirmLabel="Delete" busy={busy} onConfirm={remove} onCancel={() => setDel(false)}>“{existing.title}” will be removed from the calendar.</Confirm> : null}
    </>
  );
}

function AgendaRow({ it, onEdit }) {
  const nav = useNavigate();
  const editable = it.event && it.event.can_edit && it.type !== 'hearing';
  const body = (
    <>
      <span className={`pr-kind ${it.type}`} />
      <span style={{ minWidth: 0 }}>
        <span className="ttl" style={{ fontSize: 14 }}>{it.title}</span>
        <span className="meta"><span>{KIND_NAME[it.type] || human(it.type)}</span>{it.time ? <span>{fmtTime(it.time)}{it.end_time ? ` – ${fmtTime(it.end_time)}` : ''}</span> : null}{it.sub ? <span>{it.sub}</span> : null}</span>
      </span>
    </>
  );
  const style = { gridTemplateColumns: '14px minmax(0,1fr)', alignItems: 'start' };
  if (it.link) return <Link className="pr-item last" style={style} to={it.link}>{body}</Link>;
  return <button type="button" className="pr-item last" style={style} onClick={() => (editable ? onEdit(it.event) : nav('/practice/calendar'))}>{body}</button>;
}

export default function CalendarPage() {
  const { perms, toast } = usePractice();
  const today = istToday();
  const [cursor, setCursor] = useState(today.slice(0, 7));
  const [sel, setSel] = useState(today);
  const [view, setView] = useState('month');
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const y = +cursor.slice(0, 4);
  const m = +cursor.slice(5, 7);
  const first = isoOf(y, m, 1);
  const gridStart = addDays(first, -((dowOf(first) + 6) % 7));
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);
  const from = view === 'month' ? cells[0] : first;
  const to = view === 'month' ? cells[41] : isoOf(y, m, daysInMonth(y, m));
  const q = useAsync((signal) => pr.get('/calendar', { from, to }, signal), [from, to]);
  const qItems = q.data?.items;
  const byDay = useMemo(() => { const o = {}; (qItems || []).forEach((it) => { (o[it.date] = o[it.date] || []).push(it); }); return o; }, [qItems]);

  const go = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setCursor(d.toISOString().slice(0, 7)); };
  const jumpToday = () => { setCursor(today.slice(0, 7)); setSel(today); };
  const selItems = byDay[sel] || [];
  const addHolidays = async () => {
    setBusy(true);
    try { const r = await pr.post('/events/holidays/fixed', { year: y }); toast(r.added ? `${plural(r.added, 'national holiday')} added for ${y}` : `The fixed national holidays for ${y} are already there`); q.reload(); } catch (e) { toast(doneWith(e), { tone: 'bad' }); } finally { setBusy(false); }
  };

  const days = view === 'agenda' ? Object.keys(byDay).sort() : [];

  return (
    <>
      <PageHead title="Calendar" sub="Hearings, meetings, deadlines, RTI dates and court holidays in one place.">
        {perms.add_holidays ? <button type="button" className="dh-btn ghost" onClick={addHolidays} disabled={busy} title="Republic Day, Independence Day, Gandhi Jayanti and other fixed-date holidays"><PIcon name="flag" />Add national holidays for {y}</button> : null}
        <button type="button" className="dh-btn primary" onClick={() => setModal({ date: sel })}><PIcon name="plus" />Add entry</button>
      </PageHead>

      <div className="pr-toolbar">
        <div className="pr-actions">
          <button type="button" className="dh-ibtn boxed" onClick={() => go(-1)} aria-label="Previous month"><PIcon name="chevL" /></button>
          <h3 className="pr-title" style={{ margin: 0, minWidth: 150, textAlign: 'center', fontSize: 18 }}>{MONTHS_LONG[m - 1]} {y}</h3>
          <button type="button" className="dh-ibtn boxed" onClick={() => go(1)} aria-label="Next month"><PIcon name="chevR" /></button>
          <button type="button" className="dh-btn ghost sm" onClick={jumpToday}>Today</button>
        </div>
        <span className="grow" />
        <Segment label="View" value={view} onChange={setView} options={[{ value: 'month', label: 'Month' }, { value: 'agenda', label: 'Agenda' }]} />
      </div>

      {q.error ? <ErrorBox error={q.error} retry={q.reload} /> : null}

      {view === 'month' ? (
        <div className="pr-grid cal">
          <div className="pr-card" style={{ padding: 0, overflow: 'hidden', opacity: q.loading && !q.data ? 0.6 : 1 }}>
            <div className="pr-cal" role="grid" aria-label={`${MONTHS_LONG[m - 1]} ${y}`}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div className="dow" key={d} role="columnheader">{d}</div>)}
              {cells.map((d) => {
                const list = byDay[d] || [];
                const hol = list.find((x) => x.type === 'holiday');
                const wk = dowOf(d) === 0 || dowOf(d) === 6;
                const rest = list.filter((x) => x.type !== 'holiday');
                return (
                  <button type="button" key={d} role="gridcell" className={`day ${d.slice(0, 7) !== cursor ? 'out' : ''} ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''} ${hol ? 'hol' : ''} ${wk ? 'wk' : ''}`}
                    onClick={() => setSel(d)} aria-label={`${fmtDayLong(d)}${list.length ? `, ${plural(list.length, 'entry', 'entries')}` : ''}`} aria-pressed={d === sel}>
                    <span className="num"><b>{+d.slice(8)}</b></span>
                    {hol ? <span className="ev holiday">{hol.title}</span> : null}
                    {rest.slice(0, hol ? 2 : 3).map((it) => <span key={`${it.type}${it.id}`} className={`ev ${it.type}`}>{it.time ? `${fmtTime(it.time).replace(':00', '')} ` : ''}{it.title}</span>)}
                    {rest.length > (hol ? 2 : 3) ? <span className="more">+{rest.length - (hol ? 2 : 3)} more</span> : null}
                    {list.length ? <span className="dots">{list.slice(0, 6).map((it) => <i key={`${it.type}${it.id}`} className={it.type} />)}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="pr-stack">
            <section className="pr-card">
              <div className="hd"><h3>{fmtDayLong(sel)}</h3><button type="button" className="dh-btn ghost sm" onClick={() => setModal({ date: sel })}><PIcon name="plus" />Add</button></div>
              <div className="bd flush">
                {q.loading && !q.data ? <Loading /> : !selItems.length ? <p className="pr-note" style={{ textAlign: 'center', padding: 22 }}>Nothing on this day.</p> : <div className="pr-list">{selItems.map((it) => <AgendaRow key={`${it.type}${it.id}`} it={it} onEdit={(ev) => setModal({ existing: ev })} />)}</div>}
              </div>
            </section>
            <div className="pr-legend" aria-label="Legend">
              <span><i className="pr-kind hearing" />Hearing</span><span><i className="pr-kind" />Meeting / appointment</span><span><i className="pr-kind deadline" />Deadline, RTI, follow-up, holiday</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="pr-card">
          {!q.data ? <Loading /> : !days.length ? <p className="pr-note" style={{ textAlign: 'center', padding: 30 }}>Nothing is scheduled in {MONTHS_LONG[m - 1]}.</p> : days.map((d) => (
            <div key={d}>
              <div className="pr-court">{fmtDayLong(d)}<span className="n">{plural(byDay[d].length, 'entry', 'entries')}</span></div>
              {byDay[d].map((it) => <AgendaRow key={`${it.type}${it.id}`} it={it} onEdit={(ev) => setModal({ existing: ev })} />)}
            </div>
          ))}
        </div>
      )}
      {modal ? <EventModal existing={modal.existing} date={modal.date} onClose={() => setModal(null)} onSaved={() => { setModal(null); q.reload(); }} /> : null}
    </>
  );
}
