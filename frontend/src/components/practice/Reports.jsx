import { useMemo, useState } from 'react';
import { PIcon } from './icons.jsx';
import { doneWith, pr } from './api.js';
import { usePractice } from './ctx.js';
import { Card, ErrorBox, Loading, PageHead, Stat, useAsync } from './widgets.jsx';
import { addDays, human, istToday } from './util.js';

const INFO = {
  monthly_summary: { sub: 'New and closed cases, hearings held and documents added in a month.', ctl: ['month'] },
  advocate_performance: { sub: 'Cases, hearings and proceedings recorded by each advocate.', ctl: ['range'] },
  case_status: { sub: 'Every case with its status, next hearing and advocate.', ctl: ['case'] },
  upcoming_hearings: { sub: 'Hearings coming up, by date and court.', ctl: ['range', 'advocate'] },
  closed_cases: { sub: 'Cases that were disposed, withdrawn or settled.', ctl: ['range'] },
  client_activity: { sub: 'Hearings, documents and contacts per client.', ctl: ['range'] },
  cause_list: { sub: 'One day\'s cause list, ready to print.', ctl: ['date', 'court', 'advocate'] },
};
const ROW_CAP = 200;

export default function Reports() {
  const { meta, members, toast } = usePractice();
  const list = useAsync((signal) => pr.get('/reports', null, signal).then((d) => d.reports), []);
  const today = istToday();
  const [key, setKey] = useState(null);
  const [p, setP] = useState({
    month: today.slice(0, 7), from: `${today.slice(0, 7)}-01`, to: today, date: today, court: '', advocate_id: '', state: '', status: '', case_type: '', priority: '', mine: false,
  });
  const [busy, setBusy] = useState('');
  const kinds = list.data || [];
  const active = key && kinds.some((k) => k.key === key) ? key : kinds[0]?.key;
  const info = INFO[active] || { ctl: [], sub: '' };
  const set = (k) => (e) => setP((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const params = useMemo(() => {
    const o = {};
    if (info.ctl.includes('month')) o.month = p.month;
    if (info.ctl.includes('range')) { o.from = p.from; o.to = p.to; }
    if (info.ctl.includes('date')) o.date = p.date;
    if (info.ctl.includes('court')) o.court = p.court.trim();
    if (info.ctl.includes('advocate')) o.advocate_id = p.advocate_id;
    if (info.ctl.includes('case')) { o.state = p.state; o.status = p.status; o.case_type = p.case_type; o.priority = p.priority; o.advocate_id = p.advocate_id; o.mine = p.mine; }
    return o;
  }, [active, p]); // eslint-disable-line react-hooks/exhaustive-deps
  const sig = JSON.stringify(params);
  const rep = useAsync((signal) => (active ? pr.get(`/reports/${active}`, params, signal) : Promise.resolve(null)), [active, sig]);
  const d = rep.data;
  const advocates = (members || []).filter((m) => m.role !== 'staff');

  const dl = async (fmt) => {
    setBusy(fmt);
    try { await pr.download(`/reports/${active}${pr.qs({ ...params, format: fmt })}`, `${active}.${fmt}`); } catch (e) { toast(doneWith(e), { tone: 'bad' }); } finally { setBusy(''); }
  };
  const quickRange = (days) => setP((s) => ({ ...s, from: days < 0 ? addDays(today, days) : today, to: days < 0 ? today : addDays(today, days) }));

  if (!list.data) return list.error ? <ErrorBox error={list.error} retry={list.reload} /> : <Loading />;

  return (
    <>
      <PageHead title="Reports" sub="Pick a report, set the period, check the preview, then download it as a PDF or an Excel file." />
      <div className="pr-reports">
        <nav className="pr-reportnav" aria-label="Reports">
          {kinds.map((k) => (
            <button key={k.key} type="button" className={active === k.key ? 'on' : ''} onClick={() => setKey(k.key)} aria-current={active === k.key ? 'page' : undefined}>
              {k.title}<small>{INFO[k.key]?.sub}</small>
            </button>
          ))}
        </nav>
        <div style={{ minWidth: 0 }}>
          <div className="pr-card" style={{ padding: 14 }}>
            <div className="pr-toolbar" style={{ margin: 0 }}>
              {info.ctl.includes('month') ? <label className="pr-actions"><span className="pr-muted">Month</span><input type="month" className="dh-input" style={{ width: 'auto' }} value={p.month} onChange={set('month')} /></label> : null}
              {info.ctl.includes('range') ? (
                <>
                  <label className="pr-actions"><span className="pr-muted">From</span><input type="date" className="dh-input" style={{ width: 'auto' }} value={p.from} onChange={set('from')} /></label>
                  <label className="pr-actions"><span className="pr-muted">To</span><input type="date" className="dh-input" style={{ width: 'auto' }} value={p.to} min={p.from} onChange={set('to')} /></label>
                  <span className="pr-shortcuts" style={{ margin: 0 }}>
                    {active === 'upcoming_hearings' ? (<><button type="button" onClick={() => quickRange(7)}>Next 7 days</button><button type="button" onClick={() => quickRange(30)}>Next 30 days</button><button type="button" onClick={() => quickRange(90)}>Next 90 days</button></>) : (<><button type="button" onClick={() => setP((s) => ({ ...s, from: `${today.slice(0, 7)}-01`, to: today }))}>This month</button><button type="button" onClick={() => quickRange(-30)}>Last 30 days</button><button type="button" onClick={() => quickRange(-90)}>Last 90 days</button></>)}
                  </span>
                </>
              ) : null}
              {info.ctl.includes('date') ? <label className="pr-actions"><span className="pr-muted">Date</span><input type="date" className="dh-input" style={{ width: 'auto' }} value={p.date} onChange={set('date')} /></label> : null}
              {info.ctl.includes('court') ? <input className="dh-input" style={{ width: 200 }} placeholder="Court (exact name, optional)" value={p.court} onChange={set('court')} aria-label="Court" /> : null}
              {info.ctl.includes('advocate') || info.ctl.includes('case') ? <select className="dh-select" value={p.advocate_id} onChange={set('advocate_id')} aria-label="Advocate"><option value="">All advocates</option>{info.ctl.includes('case') ? <option value="0">Unassigned</option> : null}{advocates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select> : null}
              {info.ctl.includes('case') ? (
                <>
                  <select className="dh-select" value={p.state} onChange={set('state')} aria-label="Open or closed"><option value="">Open and closed</option><option value="open">Open</option><option value="closed">Closed</option></select>
                  <select className="dh-select" value={p.status} onChange={set('status')} aria-label="Status"><option value="">Any status</option>{meta.statuses.map((s) => <option key={s}>{s}</option>)}</select>
                  <select className="dh-select" value={p.case_type} onChange={set('case_type')} aria-label="Type"><option value="">Any type</option>{meta.case_types.map((s) => <option key={s}>{s}</option>)}</select>
                  <select className="dh-select" value={p.priority} onChange={set('priority')} aria-label="Priority"><option value="">Any priority</option>{meta.priorities.map((s) => <option key={s} value={s}>{human(s)}</option>)}</select>
                  <label className="dh-check"><input type="checkbox" checked={p.mine} onChange={set('mine')} />Only mine</label>
                </>
              ) : null}
              <span className="grow" />
              <button type="button" className="dh-btn ghost" onClick={() => dl('xlsx')} disabled={!!busy || !d}><PIcon name="zip" />{busy === 'xlsx' ? 'Preparing…' : 'Excel'}</button>
              <button type="button" className="dh-btn primary" onClick={() => dl('pdf')} disabled={!!busy || !d}><PIcon name="doc" />{busy === 'pdf' ? 'Preparing…' : 'PDF'}</button>
            </div>
          </div>

          {!d ? (rep.error ? <ErrorBox error={rep.error} retry={rep.reload} /> : <Loading label="Building the report…" />) : (
            <div style={{ opacity: rep.loading ? 0.6 : 1, transition: 'opacity .15s' }}>
              {rep.error ? <ErrorBox error={rep.error} retry={rep.reload} compact /> : null}
              <Card title={d.title} sub={d.period}>
                <div className="pr-summary">{d.summary.map((s) => <Stat key={s.label} n={s.value} label={s.label} />)}</div>
                {d.tables.map((t) => (
                  <div key={t.title}>
                    <h4 className="pr-tabletitle">{t.title} <span className="pr-muted pr-mono" style={{ fontSize: 11, fontWeight: 400 }}>{t.rows.length}</span></h4>
                    {!t.rows.length ? <p className="pr-note" style={{ marginBottom: 16 }}>Nothing to list for this period.</p> : (
                      <div className="pr-tablewrap">
                        <table className="pr-table">
                          <thead><tr>{t.columns.map((c) => <th key={c.key} className={c.align === 'r' ? 'r' : ''}>{c.label}</th>)}</tr></thead>
                          <tbody>{t.rows.slice(0, ROW_CAP).map((row, i) => <tr key={i}>{t.columns.map((c) => <td key={c.key} className={c.align === 'r' ? 'r' : ''}>{row[c.key] ?? ''}</td>)}</tr>)}</tbody>
                        </table>
                      </div>
                    )}
                    {t.rows.length > ROW_CAP ? <p className="pr-note" style={{ marginTop: -8, marginBottom: 14 }}>Showing the first {ROW_CAP} of {t.rows.length}. The PDF and Excel downloads include every row.</p> : null}
                  </div>
                ))}
                <p className="pr-note">{d.firm} · generated {d.generated}</p>
              </Card>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
