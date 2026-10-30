import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, Menu } from '../dochub/ui.jsx';
import { PIcon } from './icons.jsx';
import { doneWith, pr } from './api.js';
import { usePractice } from './ctx.js';
import { HearingModal, RecordProceedingModal, ReminderModal } from './actions.jsx';
import { Card, ErrorBox, Loading, PageHead, Segment, useAsync } from './widgets.jsx';
import { addDays, dowOf, fmtDay, fmtDayLong, fmtTime, human, istToday, plural, relDay } from './util.js';

function range(sp) {
  const today = istToday();
  const mode = sp.get('range') || 'day';
  if (mode === 'week') { const from = sp.get('date') || today; return { mode, from, to: addDays(from, 6) }; }
  if (mode === 'custom') { const from = sp.get('from') || today; const to = sp.get('to') || addDays(from, 13); return { mode, from, to: to < from ? from : to }; }
  const d = sp.get('date') || today;
  return { mode: 'day', from: d, to: d };
}

function group(list, key) {
  const m = new Map();
  list.forEach((x) => { const k = key(x) || 'Court not set'; if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
  return [...m.entries()];
}

export default function Hearings() {
  const { me, perms, members, toast } = usePractice();
  const [sp, setSp] = useSearchParams();
  const today = istToday();
  const r = range(sp);
  const court = sp.get('court') || '';
  const adv = sp.get('advocate_id') || '';
  const show = sp.get('show') || 'active';
  const mine = sp.get('mine') === '1';
  const q = useAsync((signal) => pr.get('/hearings', { from: r.from, to: r.to, court, advocate_id: adv, mine, status: show === 'active' ? 'scheduled,heard,adjourned' : '' }, signal), [r.from, r.to, court, adv, show, mine]);
  const [rec, setRec] = useState(null);
  const [rem, setRem] = useState(null);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState('');
  const d = q.data;
  const advocates = (members || []).filter((m) => m.role !== 'staff');

  const patch = (p) => setSp((prev) => { const n = new URLSearchParams(prev); Object.entries(p).forEach(([k, v]) => { if (v === '' || v == null || v === false) n.delete(k); else n.set(k, v === true ? '1' : v); }); return n; }, { replace: true });
  const setDate = (date) => patch({ date: date === today ? '' : date, from: '', to: '' });
  const step = (n) => setDate(addDays(r.from, r.mode === 'week' ? 7 * n : n));

  const days = useMemo(() => (d ? group(d.hearings, (h) => h.hearing_date).sort((a, b) => a[0].localeCompare(b[0])) : []), [d]);
  const reportParams = r.mode === 'day' ? { date: r.from, court, advocate_id: adv } : { from: r.from, to: r.to, advocate_id: adv };
  const reportKind = r.mode === 'day' ? 'cause_list' : 'upcoming_hearings';
  const exportAs = async (fmt, close) => {
    close?.(); setBusy(fmt);
    try { await pr.download(`/reports/${reportKind}${pr.qs({ ...reportParams, format: fmt })}`, `hearings.${fmt}`); } catch (e) { toast(doneWith(e), { tone: 'bad' }); } finally { setBusy(''); }
  };

  const title = r.mode === 'day' ? (r.from === today ? "Today's cause list" : 'Cause list') : r.mode === 'week' ? 'Week ahead' : 'Hearings';
  const total = d ? d.hearings.length : 0;
  const holidayHits = d ? Object.entries(d.holidays || {}).sort() : [];

  return (
    <>
      <PageHead title={title} sub={r.mode === 'day' ? fmtDayLong(r.from) : `${fmtDay(r.from)} to ${fmtDay(r.to)}`}>
        <Menu icon="download" label={busy ? 'Preparing…' : 'Download'} right disabled={!!busy || !total}>
          {(close) => (<><button type="button" className="item" onClick={() => exportAs('pdf', close)}><PIcon name="doc" />PDF (print-ready)</button><button type="button" className="item" onClick={() => exportAs('xlsx', close)}><PIcon name="zip" />Excel spreadsheet</button></>)}
        </Menu>
      </PageHead>

      <div className="pr-toolbar">
        <div className="pr-actions">
          <button type="button" className="dh-ibtn boxed" onClick={() => step(-1)} aria-label={r.mode === 'week' ? 'Previous week' : 'Previous day'}><PIcon name="chevL" /></button>
          <input type="date" className="dh-input" style={{ width: 'auto' }} value={r.from} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
          <button type="button" className="dh-ibtn boxed" onClick={() => step(1)} aria-label={r.mode === 'week' ? 'Next week' : 'Next day'}><PIcon name="chevR" /></button>
          <button type="button" className="dh-btn ghost sm" onClick={() => setDate(today)} disabled={r.from === today && r.mode === 'day'}>Today</button>
        </div>
        <Segment label="Range" value={r.mode} onChange={(v) => patch({ range: v === 'day' ? '' : v, from: '', to: '' })} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'custom', label: 'Custom' }]} />
        {r.mode === 'custom' ? (
          <span className="pr-actions"><input type="date" className="dh-input" style={{ width: 'auto' }} value={r.from} onChange={(e) => patch({ from: e.target.value })} aria-label="From" /><span className="pr-muted">to</span><input type="date" className="dh-input" style={{ width: 'auto' }} value={r.to} min={r.from} onChange={(e) => patch({ to: e.target.value })} aria-label="To" /></span>
        ) : null}
        <select className="dh-select" value={court} onChange={(e) => patch({ court: e.target.value })} aria-label="Court"><option value="">All courts</option>{(d?.courts || []).map((c) => <option key={c}>{c}</option>)}</select>
        {perms.assign_case || me.member.role !== 'staff' ? (
          <select className="dh-select" value={adv} onChange={(e) => patch({ advocate_id: e.target.value, mine: '' })} aria-label="Advocate"><option value="">All advocates</option>{advocates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        ) : null}
        <select className="dh-select" value={show} onChange={(e) => patch({ show: e.target.value === 'active' ? '' : e.target.value })} aria-label="Which hearings"><option value="active">Without cancelled</option><option value="all">Including cancelled</option></select>
        {me.member.role !== 'staff' ? <label className="dh-check"><input type="checkbox" checked={mine} onChange={(e) => patch({ mine: e.target.checked, advocate_id: '' })} />Only mine</label> : null}
      </div>

      {holidayHits.map(([day, name]) => (
        <div className="dh-banners" key={day}><div className="dh-banner"><PIcon name="flag" /><div className="body"><b>Court holiday on {fmtDay(day)}:</b> {name}.{(d.hearings || []).some((h) => h.hearing_date === day && h.status === 'scheduled') ? ' Some hearings are still listed that day. You may want to reschedule them.' : ''}</div></div></div>
      ))}
      {r.mode === 'day' && !holidayHits.length && [0, 6].includes(dowOf(r.from)) ? <div className="dh-banners"><div className="dh-banner plain"><PIcon name="info" /><div className="body">{dowOf(r.from) === 0 ? 'Sunday' : 'Saturday'} — courts are usually closed.</div></div></div> : null}

      {!d ? (q.error ? <ErrorBox error={q.error} retry={q.reload} /> : <Loading label="Loading the cause list…" />) : !total ? (
        <EmptyState icon="scale" title={r.mode === 'day' ? 'No hearings on this day' : 'No hearings in this range'} actions={<Link className="dh-btn ghost" to="/practice/cases">Open cases</Link>}>
          {court || adv || mine ? 'Nothing matches the filters you chose. Try clearing them.' : 'Hearings you schedule on a case show up here, grouped by court.'}
        </EmptyState>
      ) : days.map(([day, list]) => (
        <Card key={day} title={r.mode === 'day' ? plural(list.length, 'matter') : fmtDayLong(day)} sub={r.mode === 'day' ? null : `${relDay(day).text} · ${plural(list.length, 'matter')}`} flush>
          {group(list, (h) => h.court).map(([ct, rows]) => (
            <div key={ct}>
              <div className="pr-court"><PIcon name="building" />{ct}<span className="n">{plural(rows.length, 'matter')}</span></div>
              {rows.map((h) => {
                const sched = h.status === 'scheduled';
                const writable = h.writable && perms.update_cases;
                return (
                  <div key={h.id} className={`pr-cause ${!sched ? 'done' : ''}`}>
                    <div className="no">{h.serial_no ? <><b>{h.serial_no}</b>item</> : <b>{h.hearing_time ? fmtTime(h.hearing_time) : '·'}</b>}</div>
                    <div style={{ minWidth: 0 }}>
                      <Link className="ttl" to={`/practice/cases/${h.case_id}`}>{h.title}</Link>
                      <div className="meta"><span>{h.case_no}</span>{h.hall_no ? <span>Hall {h.hall_no}</span> : null}{h.hearing_time ? <span>{fmtTime(h.hearing_time)}</span> : null}{h.judge ? <span>{h.judge}</span> : null}{h.purpose ? <span>{h.purpose}</span> : null}{h.advocate_name ? <span>{h.advocate_name}</span> : null}{h.client_name ? <span>{h.client_name}</span> : null}</div>
                    </div>
                    <div className="acts">
                      {!sched ? <span className={`pr-pill ${h.status === 'cancelled' ? 'dim' : 'good'}`}>{h.status === 'heard' ? <PIcon name="check" /> : null}{human(h.status)}</span> : null}
                      {sched && writable && h.hearing_date <= today ? <button type="button" className="dh-btn primary sm" onClick={() => setRec(h)}>Record</button> : null}
                      {sched && h.client_id ? <button type="button" className="dh-ibtn boxed" onClick={() => setRem(h)} aria-label={`Remind ${h.client_name}`} title="Remind the client"><PIcon name="chat" /></button> : null}
                      {writable ? <button type="button" className="dh-ibtn boxed" onClick={() => setEdit(h)} aria-label="Edit or reschedule" title="Edit or reschedule"><PIcon name="edit" /></button> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </Card>
      ))}

      {rec ? <RecordProceedingModal caseId={rec.case_id} hearingId={rec.id} onClose={() => setRec(null)} onSaved={() => { setRec(null); q.reload(); }} /> : null}
      {rem ? <ReminderModal caseId={rem.case_id} hearingId={rem.id} onClose={() => setRem(null)} /> : null}
      {edit ? (
        <HearingModal caseObj={{ id: edit.case_id, title: edit.title, case_no: edit.case_no, court: edit.court, hall_no: edit.hall_no, judge: edit.judge, advocate_id: edit.advocate_id }} hearing={edit}
          onClose={() => setEdit(null)} onSaved={() => { setEdit(null); q.reload(); }} />
      ) : null}
    </>
  );
}
