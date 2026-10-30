import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PIcon } from './icons.jsx';
import { pr } from './api.js';
import { usePractice } from './ctx.js';
import { RecordProceedingModal, ReminderModal } from './actions.jsx';
import { Bars, Card, DayChip, ErrorBox, Loading, PageHead, Prio, Segment, Stat, StatusPill, useAsync } from './widgets.jsx';
import { fmtDay, fmtDayLong, fmtTime, istToday, plural, relDay } from './util.js';
import { fmtAgo } from '../dochub/format.js';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

function CauseRow({ h, canRecord, onRecord, onRemind }) {
  const done = h.status !== 'scheduled';
  return (
    <div className={`pr-cause ${done ? 'done' : ''}`}>
      <div className="no">{h.serial_no ? <><b>{h.serial_no}</b>item</> : <b>{h.time ? fmtTime(h.time) : '·'}</b>}</div>
      <div style={{ minWidth: 0 }}>
        <Link className="ttl" to={`/practice/cases/${h.case_id}`}>{h.title}</Link>
        <div className="meta">
          <span>{h.case_no}</span>
          {h.hall_no ? <span>Hall {h.hall_no}</span> : null}
          {h.time ? <span>{fmtTime(h.time)}</span> : null}
          {h.purpose ? <span>{h.purpose}</span> : null}
          {h.advocate ? <span>{h.advocate}</span> : null}
          {h.client ? <span>{h.client}</span> : null}
        </div>
      </div>
      <div className="acts">
        {done ? <span className="pr-pill good"><PIcon name="check" />{h.status === 'adjourned' ? 'Adjourned' : 'Heard'}</span> : canRecord ? <button type="button" className="dh-btn primary sm" onClick={() => onRecord(h)}>Record</button> : null}
        {h.client ? <button type="button" className="dh-ibtn boxed" onClick={() => onRemind(h)} aria-label={`Remind ${h.client}`} title="Remind the client"><PIcon name="chat" /></button> : null}
      </div>
    </div>
  );
}

function groupBy(list, key) {
  const m = new Map();
  list.forEach((x) => { const k = key(x) || 'Court not set'; if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
  return [...m.entries()];
}

export default function Dashboard() {
  const { me, perms } = usePractice();
  const nav = useNavigate();
  const [scope, setScope] = useState(null);
  const q = useAsync((signal) => pr.get('/dashboard', { scope }, signal), [scope]);
  const [rec, setRec] = useState(null);
  const [rem, setRem] = useState(null);
  const [catView, setCatView] = useState('types');
  const d = q.data;

  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') q.reload(); }, 300000);
    return () => clearInterval(t);
  }, [q.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = d?.date || istToday();
  const courts = useMemo(() => (d ? groupBy(d.today, (h) => h.court) : []), [d]);
  const upcomingDays = useMemo(() => (d ? groupBy(d.upcoming, (h) => h.date) : []), [d]);
  const canRecord = perms.update_cases;
  const overdue = d ? d.pending.filter((p) => p.kind === 'hearing_update').length : 0;
  const first = (me.member.name || '').split(/\s+/).filter((w) => !/^(adv|advocate|mr|mrs|ms|miss|dr|shri|smt|sri)\.?$/i.test(w))[0] || (me.member.name || '').split(/\s+/)[0] || '';

  if (!d) return q.error ? <ErrorBox error={q.error} retry={q.reload} /> : <Loading label="Preparing your day…" />;
  const pendingToday = d.today.filter((h) => h.status === 'scheduled').length;

  return (
    <>
      <PageHead title={`${greeting()}, ${first}`} sub={`${fmtDayLong(today)} · ${d.counts.today ? `${plural(d.counts.today, 'hearing')} listed today${pendingToday ? `, ${pendingToday} still to record` : ', all recorded'}` : 'no hearings listed today'}`}>
        {me.member.role === 'senior' ? <Segment label="Scope" value={d.scope} onChange={setScope} options={[{ value: 'mine', label: 'My matters' }, { value: 'firm', label: 'Whole practice' }]} /> : null}
        {q.loading ? <span className="pr-muted pr-mono" style={{ fontSize: 11 }}>Refreshing…</span> : null}
      </PageHead>
      {q.error ? <div className="dh-banners"><ErrorBox error={q.error} retry={q.reload} /></div> : null}
      {overdue ? (
        <div className="dh-banners">
          <div className="dh-banner rust"><PIcon name="alert" /><div className="body"><b>{plural(overdue, 'past hearing')}</b> still {overdue === 1 ? 'has' : 'have'} no record of what happened. Record the proceeding so the next date and the timeline stay accurate.</div></div>
        </div>
      ) : null}

      <div className="pr-stats">
        <Stat n={d.counts.active} label="Active cases" onClick={() => nav('/practice/cases?state=open')} />
        <Stat n={d.counts.today} label="Hearings today" tone={pendingToday ? 'warn' : ''} sub={pendingToday ? `${pendingToday} to record` : null} onClick={() => document.getElementById('pr-cause')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
        <Stat n={d.counts.week} label="Next 7 days" onClick={() => nav('/practice/hearings?range=week')} />
        <Stat n={d.pending_total} label="Pending actions" tone={d.pending.some((p) => p.severity === 'overdue') ? 'bad' : ''} onClick={() => document.getElementById('pr-pending')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
        <Stat n={d.counts.rti_open} label="Open RTI" onClick={() => nav('/practice/rti')} />
        <Stat n={d.counts.closed_month} label="Closed this month" onClick={() => nav('/practice/cases?state=closed')} />
      </div>

      <div className="pr-grid">
        <div className="pr-stack">
          <Card id="pr-cause" title="Today's cause list" sub={fmtDay(today)} flush
            actions={<Link className="dh-btn ghost sm" to="/practice/hearings"><PIcon name="scale" />Full cause list</Link>}>
            {!d.today.length ? (
              <div className="pr-loading" style={{ padding: '30px 16px' }}>
                No hearings listed for today.{d.upcoming[0] ? <> Next one is on <b>{fmtDay(d.upcoming[0].date)}</b>.</> : null}
              </div>
            ) : courts.map(([court, list]) => (
              <div key={court}>
                <div className="pr-court"><PIcon name="building" />{court}<span className="n">{plural(list.length, 'matter')}</span></div>
                {list.map((h) => <CauseRow key={h.id} h={h} canRecord={canRecord} onRecord={(x) => setRec(x)} onRemind={(x) => setRem(x)} />)}
              </div>
            ))}
          </Card>

          <Card title="Coming up" sub="next 14 days" flush actions={<Link className="dh-btn ghost sm" to="/practice/calendar"><PIcon name="calendar" />Calendar</Link>}>
            {!d.upcoming.length ? <div className="pr-loading" style={{ padding: '26px 16px' }}>Nothing scheduled in the next two weeks.</div> : upcomingDays.map(([day, list]) => {
              const r = relDay(day);
              return (
                <div key={day}>
                  <div className="pr-court">{fmtDay(day)}<span className="n">{r.text}</span></div>
                  {list.map((h) => (
                    <Link key={h.id} className="pr-item" to={`/practice/cases/${h.case_id}`}>
                      <span style={{ minWidth: 0 }}>
                        <span className="ttl">{h.title}</span>
                        <span className="meta"><span>{h.case_no}</span>{h.court ? <span>{h.court}</span> : null}{h.time ? <span>{fmtTime(h.time)}</span> : null}{h.purpose ? <span>{h.purpose}</span> : null}{h.advocate ? <span>{h.advocate}</span> : null}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              );
            })}
          </Card>

          <Card title="Recently updated cases" flush actions={<Link className="dh-btn ghost sm" to="/practice/cases">All cases</Link>}>
            {!d.recent.length ? <div className="pr-loading" style={{ padding: '26px 16px' }}>No cases yet. {perms.create_case ? 'Use “New case” to add your first one.' : 'Cases will appear here once they are added.'}</div> : (
              <div className="pr-list">
                {d.recent.map((c) => (
                  <Link key={c.id} className="pr-item" to={`/practice/cases/${c.id}`}>
                    <span style={{ minWidth: 0 }}>
                      <span className="ttl">{c.title}</span>
                      <span className="meta"><b>{c.case_no}</b><span>{c.court}</span>{c.client_name ? <span>{c.client_name}</span> : null}{c.advocate_name ? <span>{c.advocate_name}</span> : null}</span>
                      {c.last_event ? <span className="meta" style={{ marginTop: 2 }}><span>{c.last_event}</span></span> : null}
                    </span>
                    <span className="side"><StatusPill status={c.status} /><Prio priority={c.priority} /><span>{fmtAgo(c.updated_at)}</span></span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="pr-stack">
          <Card id="pr-pending" title="Pending actions" sub={d.pending_total > d.pending.length ? `showing ${d.pending.length} of ${d.pending_total}` : null} flush>
            {!d.pending.length ? <div className="pr-loading" style={{ padding: '26px 16px' }}><PIcon name="checkCircle" />Nothing is waiting on you.</div> : (
              <div className="pr-list">
                {d.pending.map((p, i) => (
                  <Link key={i} className={`pr-item ${p.severity === 'overdue' ? 'bad' : p.severity === 'soon' ? 'warn' : ''}`} to={p.link}>
                    <span style={{ minWidth: 0 }}>
                      <span className="ttl" style={{ fontSize: 13.5 }}>{p.title}</span>
                      <span className="meta"><span>{p.sub}</span></span>
                    </span>
                    {p.date ? <span className="side"><DayChip date={p.date} plain /></span> : null}
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card title="Notifications" sub={d.unread ? `${d.unread} unread` : null} flush actions={<Link className="dh-btn ghost sm" to="/practice/notifications">All</Link>}>
            {!d.notifications.length ? <div className="pr-loading" style={{ padding: '22px 16px' }}>No notifications yet.</div> : (
              <div className="pr-list">
                {d.notifications.map((n) => (
                  <Link key={n.id} className={`pr-item ${n.read_at ? '' : 'unread'}`} to={n.link || '/practice/notifications'} onClick={() => { if (!n.read_at) pr.post(`/notifications/${n.id}/read`).catch(() => {}); }}>
                    <span style={{ minWidth: 0 }}><span className="ttl" style={{ fontSize: 13.5 }}>{n.title}</span>{n.body ? <span className="meta"><span>{n.body}</span></span> : null}</span>
                    <span className="side">{fmtAgo(n.created_at)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card title="New documents" flush actions={<Link className="dh-btn ghost sm" to="/document-hub">Document Hub</Link>}>
            {!d.documents.length ? <div className="pr-loading" style={{ padding: '22px 16px' }}>Documents you upload to a case appear here.</div> : (
              <div className="pr-list">
                {d.documents.map((x) => (
                  <Link key={x.id} className="pr-item" to={`/document-hub?doc=${x.id}`}>
                    <span style={{ minWidth: 0 }}><span className="ttl" style={{ fontSize: 13.5 }}>{x.title}</span><span className="meta"><span>{x.doc_class}</span><span>{x.case_title}</span>{x.by ? <span>by {x.by}</span> : null}</span></span>
                    <span className="side">{fmtAgo(x.created_at)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card title="Case mix" actions={<Segment label="Group by" value={catView} onChange={setCatView} options={[{ value: 'types', label: 'Type' }, { value: 'categories', label: 'Category' }, { value: 'statuses', label: 'Status' }]} />}>
            <Bars rows={d.summary[catView] || []} alt={catView === 'statuses'} />
          </Card>

          {me.member.role !== 'junior' || d.workload.length ? (
            <Card title="Advocate workload" flush>
              <div style={{ overflowX: 'auto' }}>
                <table className="pr-work">
                  <thead><tr><th>Advocate</th><th>Active</th><th>Today</th><th>7 days</th><th title="Past hearings with no record">Overdue</th></tr></thead>
                  <tbody>
                    {d.workload.map((w) => (
                      <tr key={w.id}><td>{w.name}</td><td>{w.active}</td><td>{w.today}</td><td>{w.week}</td><td className={w.overdue ? 'bad' : ''}>{w.overdue}</td></tr>
                    ))}
                    {!d.workload.length ? <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>No advocates yet.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      {rec ? <RecordProceedingModal caseId={rec.case_id} hearingId={rec.id} onClose={() => setRec(null)} onSaved={() => { setRec(null); q.reload(); }} /> : null}
      {rem ? <ReminderModal caseId={rem.case_id} hearingId={rem.id} onClose={() => setRem(null)} onSent={() => {}} /> : null}
    </>
  );
}
