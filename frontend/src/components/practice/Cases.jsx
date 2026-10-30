import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../dochub/ui.jsx';
import { PIcon } from './icons.jsx';
import { doneWith, pr } from './api.js';
import { usePractice } from './ctx.js';
import { CaseForm } from './forms.jsx';
import { DayChip, ErrorBox, Loading, PageHead, Pager, Prio, StatusPill, useAsync, useDebouncedValue } from './widgets.jsx';
import { human } from './util.js';

const PER = 25;
const KEYS = ['q', 'state', 'status', 'case_type', 'priority', 'court', 'category', 'advocate_id', 'client_id', 'hearing_from', 'hearing_to', 'filed_from', 'filed_to', 'party', 'archived', 'mine', 'sort', 'page'];

export default function Cases() {
  const { perms, meta, members, toast } = usePractice();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const f = useMemo(() => Object.fromEntries(KEYS.map((k) => [k, sp.get(k) || ''])), [sp]);
  const [qText, setQText] = useState(f.q);
  const dq = useDebouncedValue(qText, 300);
  const [more, setMore] = useState(() => ['priority', 'court', 'category', 'hearing_from', 'hearing_to', 'filed_from', 'filed_to', 'party', 'archived'].some((k) => sp.get(k)));
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const lastQ = useRef(f.q);

  const patch = (p, keepPage) => setSp((prev) => {
    const n = new URLSearchParams(prev);
    Object.entries(p).forEach(([k, v]) => { if (v === '' || v == null) n.delete(k); else n.set(k, v); });
    if (!keepPage) n.delete('page');
    return n;
  }, { replace: true });

  useEffect(() => { if (dq !== lastQ.current) { lastQ.current = dq; patch({ q: dq.trim() }); } }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (f.q !== lastQ.current) { lastQ.current = f.q; setQText(f.q); } }, [f.q]);

  const page = Math.max(1, Number(f.page) || 1);
  const params = useMemo(() => ({ ...f, page, per_page: PER, sort: f.sort || 'updated' }), [f, page]);
  const q = useAsync((signal) => pr.get('/cases', params, signal), [JSON.stringify(params)]);
  const d = q.data;
  const advocates = (members || []).filter((m) => m.role !== 'staff');
  const active = KEYS.filter((k) => !['page', 'sort'].includes(k) && f[k]);
  const filtered = active.length > 0;

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const { page: _p, per_page: _pp, ...rest } = params;
      await pr.download(`/reports/case_status${pr.qs({ ...rest, format: 'xlsx' })}`, 'cases.xlsx');
    } catch (e) { toast(doneWith(e), { tone: 'bad' }); } finally { setExporting(false); }
  };

  return (
    <>
      <PageHead title="Cases" sub="Every matter in the practice. Search by case number, title, client or party, and narrow it down with the filters.">
        <button type="button" className="dh-btn ghost" onClick={exportXlsx} disabled={exporting || !d?.total}><PIcon name="download" />{exporting ? 'Preparing…' : 'Export to Excel'}</button>
        {perms.create_case ? <button type="button" className="dh-btn primary" onClick={() => setCreating(true)}><PIcon name="plus" />New case</button> : null}
      </PageHead>

      <div className="pr-toolbar">
        <div className="pr-searchbox grow" style={{ maxWidth: 420 }}>
          <PIcon name="search" />
          <input value={qText} onChange={(e) => setQText(e.target.value)} placeholder="Search cases…" aria-label="Search cases" />
        </div>
        <select className="dh-select" value={f.state} onChange={(e) => patch({ state: e.target.value })} aria-label="Open or closed">
          <option value="">Open and closed</option><option value="open">Open cases</option><option value="closed">Closed cases</option>
        </select>
        <select className="dh-select" value={f.status} onChange={(e) => patch({ status: e.target.value })} aria-label="Status">
          <option value="">Any status</option>{meta.statuses.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="dh-select" value={f.case_type} onChange={(e) => patch({ case_type: e.target.value })} aria-label="Case type">
          <option value="">Any type</option>{meta.case_types.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="dh-select" value={f.advocate_id} onChange={(e) => patch({ advocate_id: e.target.value, mine: '' })} aria-label="Advocate">
          <option value="">Any advocate</option><option value="0">Unassigned</option>{advocates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="dh-select" value={f.sort || 'updated'} onChange={(e) => patch({ sort: e.target.value === 'updated' ? '' : e.target.value })} aria-label="Sort">
          <option value="updated">Recently updated</option><option value="next_hearing">Next hearing date</option><option value="priority">Priority</option>
          <option value="case_no">Case number</option><option value="title">Title A–Z</option><option value="filing">Newest filing</option><option value="created">Newest added</option>
        </select>
        <button type="button" className="dh-btn ghost sm" onClick={() => setMore((m) => !m)} aria-expanded={more}><PIcon name="filter" />{more ? 'Fewer filters' : 'More filters'}</button>
        {filtered ? <button type="button" className="dh-btn quiet sm" onClick={() => { setSp(new URLSearchParams(), { replace: true }); setQText(''); }}>Clear all</button> : null}
      </div>

      {more ? (
        <div className="pr-card" style={{ padding: 14 }}>
          <div className="pr-form"><div className="row3">
            <label className="dh-field"><span className="lab">Priority</span><select className="dh-select" value={f.priority} onChange={(e) => patch({ priority: e.target.value })}><option value="">Any</option>{meta.priorities.map((p) => <option key={p} value={p}>{human(p)}</option>)}</select></label>
            <label className="dh-field"><span className="lab">Court</span><select className="dh-select" value={f.court} onChange={(e) => patch({ court: e.target.value })}><option value="">Any court</option>{(d?.facets?.courts || []).map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="dh-field"><span className="lab">Category</span><select className="dh-select" value={f.category} onChange={(e) => patch({ category: e.target.value })}><option value="">Any category</option>{(d?.facets?.categories || []).map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="dh-field"><span className="lab">Next hearing from</span><input type="date" className="dh-input" value={f.hearing_from} onChange={(e) => patch({ hearing_from: e.target.value })} /></label>
            <label className="dh-field"><span className="lab">Next hearing to</span><input type="date" className="dh-input" value={f.hearing_to} onChange={(e) => patch({ hearing_to: e.target.value })} /></label>
            <label className="dh-field"><span className="lab">Party name</span><input className="dh-input" defaultValue={f.party} onBlur={(e) => e.target.value !== f.party && patch({ party: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && patch({ party: e.currentTarget.value.trim() })} placeholder="Petitioner, respondent…" /></label>
            <label className="dh-field"><span className="lab">Filed from</span><input type="date" className="dh-input" value={f.filed_from} onChange={(e) => patch({ filed_from: e.target.value })} /></label>
            <label className="dh-field"><span className="lab">Filed to</span><input type="date" className="dh-input" value={f.filed_to} onChange={(e) => patch({ filed_to: e.target.value })} /></label>
            <label className="dh-field"><span className="lab">Archive</span><select className="dh-select" value={f.archived} onChange={(e) => patch({ archived: e.target.value })}><option value="">Hide archived</option><option value="all">Include archived</option><option value="1">Only archived</option></select></label>
          </div></div>
        </div>
      ) : null}

      {f.client_id || f.mine ? (
        <div className="pr-toolbar" style={{ marginTop: -4 }}>
          {f.client_id ? <span className="dh-chip removable">One client only <button type="button" onClick={() => patch({ client_id: '' })} aria-label="Remove client filter"><PIcon name="close" /></button></span> : null}
          {f.mine ? <span className="dh-chip removable">My cases <button type="button" onClick={() => patch({ mine: '' })} aria-label="Remove my cases filter"><PIcon name="close" /></button></span> : null}
        </div>
      ) : null}

      {!d ? (q.error ? <ErrorBox error={q.error} retry={q.reload} /> : <Loading label="Loading cases…" />) : (
        <>
          {q.error ? <ErrorBox error={q.error} retry={q.reload} compact /> : null}
          <div className="dh-toolbar"><span className="count"><b>{d.total}</b> {d.total === 1 ? 'case' : 'cases'}{filtered ? ' match' : ''}</span>{q.loading ? <span className="count">Updating…</span> : null}</div>
          {!d.cases.length ? (
            filtered ? (
              <EmptyState icon="search" title="No cases match" actions={<button type="button" className="dh-btn ghost" onClick={() => { setSp(new URLSearchParams(), { replace: true }); setQText(''); }}>Clear filters</button>}>Try a shorter search or remove a filter.</EmptyState>
            ) : (
              <EmptyState icon="briefcase" title="No cases yet" actions={perms.create_case ? <button type="button" className="dh-btn primary" onClick={() => setCreating(true)}><PIcon name="plus" />Add the first case</button> : null}>
                {perms.create_case ? 'Add a case to start tracking hearings, proceedings and documents.' : 'Cases appear here once a Senior Advocate adds them or assigns them to you.'}
              </EmptyState>
            )
          ) : (
            <div className="pr-card" style={{ opacity: q.loading ? 0.7 : 1, transition: 'opacity .15s' }}>
              <div className="pr-list">
                {d.cases.map((c) => (
                  <Link key={c.id} className="pr-item" to={`/practice/cases/${c.id}`}>
                    <span style={{ minWidth: 0 }}>
                      <span className="ttl">{c.restricted ? <PIcon name="lock" size={13} /> : null} {c.title}</span>
                      <span className="meta"><b>{c.case_no}</b><span>{c.court}</span><span>{c.case_type}{c.category ? ` · ${c.category}` : ''}</span>{c.client_name ? <span>{c.client_name}</span> : null}{c.advocate_name ? <span>{c.advocate_name}</span> : <span>Unassigned</span>}</span>
                    </span>
                    <span className="side">
                      <span className="pr-actions" style={{ justifyContent: 'flex-end' }}>
                        {c.archived ? <span className="pr-pill dim"><PIcon name="archive" />Archived</span> : null}
                        {c.overdue_update ? <span className="pr-pill bad">Update needed</span> : null}
                        <StatusPill status={c.status} />
                      </span>
                      {c.closed ? <span>Closed</span> : c.next_hearing ? <span>Next: <DayChip date={c.next_hearing} /></span> : <span>No next date</span>}
                      <Prio priority={c.priority} />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          <Pager page={d.page} per={d.per_page} total={d.total} onPage={(p) => { patch({ page: String(p) }, true); window.scrollTo?.(0, 0); }} />
        </>
      )}
      {creating ? <CaseForm onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); nav(`/practice/cases/${c.id}`); }} /> : null}
    </>
  );
}
