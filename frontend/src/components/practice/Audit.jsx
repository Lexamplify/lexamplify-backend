import { useEffect, useState } from 'react';
import { PIcon } from './icons.jsx';
import { doneWith, pr } from './api.js';
import { usePractice } from './ctx.js';
import { Card, ErrorBox, Loading, PageHead, Pager, useAsync, useDebouncedValue } from './widgets.jsx';
import { fmtAgo } from '../dochub/format.js';
import { fmtStamp, human } from './util.js';

const PER = 40;
const GROUP_LABEL = { 'sign-in': 'Sign-ins & security', cases: 'Cases', hearings: 'Hearings & proceedings', documents: 'Documents', clients: 'Clients & contact', rti: 'RTI', calendar: 'Calendar', team: 'Team & settings', notifications: 'Notifications', reports: 'Reports & backups' };

export default function AuditPage() {
  const { meta, toast } = usePractice();
  const [group, setGroup] = useState('');
  const [text, setText] = useState('');
  const dq = useDebouncedValue(text, 300);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [verify, setVerify] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => setPage(1), [group, dq, from, to]);
  const params = { group, q: dq.trim(), from, to };
  const q = useAsync((signal) => pr.get('/audit', { ...params, page, per_page: PER }, signal), [group, dq, from, to, page]);
  const d = q.data;

  const check = async () => {
    setBusy('verify');
    try { setVerify(await pr.get('/audit/verify')); } catch (e) { toast(doneWith(e), { tone: 'bad' }); } finally { setBusy(''); }
  };
  const exportCsv = async () => {
    setBusy('csv');
    try { await pr.download(`/audit/export.csv${pr.qs(params)}`, 'audit-log.csv'); } catch (e) { toast(doneWith(e), { tone: 'bad' }); } finally { setBusy(''); }
  };

  return (
    <>
      <PageHead title="Audit log" sub="A permanent record of who did what, and when. Entries are chained together, so a missing or altered entry can be detected.">
        <button type="button" className="dh-btn ghost" onClick={check} disabled={!!busy}><PIcon name="shield" />{busy === 'verify' ? 'Checking…' : 'Verify integrity'}</button>
        <button type="button" className="dh-btn ghost" onClick={exportCsv} disabled={!!busy}><PIcon name="download" />{busy === 'csv' ? 'Preparing…' : 'Export CSV'}</button>
      </PageHead>
      {verify ? (
        <div className="dh-banners"><div className={`dh-banner ${verify.ok ? 'plain' : 'rust'}`} role="status"><PIcon name={verify.ok ? 'checkCircle' : 'alert'} /><div className="body">{verify.ok ? <><b>The log is intact.</b> All {verify.checked} entries are in order and none has been changed or removed.</> : <><b>The log has been tampered with.</b> The chain breaks at entry #{verify.broken_at} after {verify.checked} good entries. Investigate this before relying on the log.</>}</div><button type="button" className="dh-btn quiet sm" onClick={() => setVerify(null)}>Dismiss</button></div></div>
      ) : null}
      <div className="pr-toolbar">
        <select className="dh-select" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Kind of activity"><option value="">All activity</option>{meta.audit_groups.map((g) => <option key={g} value={g}>{GROUP_LABEL[g] || human(g)}</option>)}</select>
        <div className="pr-searchbox grow" style={{ maxWidth: 340 }}><PIcon name="search" /><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search who, what or address" aria-label="Search the audit log" /></div>
        <label className="pr-actions"><span className="pr-muted">From</span><input type="date" className="dh-input" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="pr-actions"><span className="pr-muted">To</span><input type="date" className="dh-input" style={{ width: 'auto' }} value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        {group || text || from || to ? <button type="button" className="dh-btn quiet sm" onClick={() => { setGroup(''); setText(''); setFrom(''); setTo(''); }}>Clear</button> : null}
      </div>
      {!d ? (q.error ? <ErrorBox error={q.error} retry={q.reload} /> : <Loading />) : (
        <>
          <div className="dh-toolbar"><span className="count"><b>{d.total}</b> {d.total === 1 ? 'entry' : 'entries'}</span></div>
          <Card flush>
            {!d.items.length ? <p className="pr-note" style={{ textAlign: 'center', padding: 28 }}>Nothing matches.</p> : d.items.map((it) => (
              <div className="pr-audit" key={it.id}>
                <span className="when" title={it.at}>{fmtAgo(it.at)}<br />{fmtStamp(it.at)}</span>
                <span className="what">{it.summary || human(it.action)}<span className="who">{it.actor || 'System'} · {human(it.action).replace(/^Mfa\b/, 'Two-step')}</span></span>
                <span className="ip">{it.ip || ''}</span>
              </div>
            ))}
          </Card>
          <Pager page={d.page} per={d.per_page} total={d.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
