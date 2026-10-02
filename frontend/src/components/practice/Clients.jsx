import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Confirm, EmptyState } from '../dochub/ui.jsx';
import { fmtAgo } from '../dochub/format.js';
import { PIcon } from './icons.jsx';
import { doneWith, pr } from './api.js';
import { usePractice } from './ctx.js';
import { ClientForm, FollowupModal } from './forms.jsx';
import { Avatar, Card, DayChip, ErrorBox, Loading, PageHead, Pager, StatusPill, useAsync, useDebouncedValue } from './widgets.jsx';
import { fmtShort, human } from './util.js';

const PER = 40;
const COMM_STATUS = { opened: 'Opened in WhatsApp', sent: 'Sent', not_sent: 'Not sent', failed: 'Failed', logged: 'Logged' };

function ClientList() {
  const { perms } = usePractice();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [text, setText] = useState(sp.get('q') || '');
  const dq = useDebouncedValue(text, 300);
  const archived = sp.get('archived') === '1';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (dq.trim() === (sp.get('q') || '')) return;
    setSp((prev) => { const n = new URLSearchParams(prev); if (dq.trim()) n.set('q', dq.trim()); else n.delete('q'); n.delete('page'); return n; }, { replace: true });
  }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useAsync((signal) => pr.get('/clients', { q: sp.get('q') || '', archived, page, per_page: PER }, signal), [sp.get('q'), archived, page]);
  const d = q.data;

  return (
    <>
      <PageHead title="Clients" sub="Everyone you act for, with their contact details, cases, follow-ups and conversation history.">
        {perms.manage_clients ? <button type="button" className="dh-btn primary" onClick={() => setCreating(true)}><PIcon name="plus" />New client</button> : null}
      </PageHead>
      <div className="pr-toolbar">
        <div className="pr-searchbox grow" style={{ maxWidth: 420 }}><PIcon name="search" /><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by name, phone or email" aria-label="Search clients" /></div>
        <label className="dh-check"><input type="checkbox" checked={archived} onChange={(e) => setSp((prev) => { const n = new URLSearchParams(prev); if (e.target.checked) n.set('archived', '1'); else n.delete('archived'); n.delete('page'); return n; }, { replace: true })} />Show archived</label>
      </div>
      {!d ? (q.error ? <ErrorBox error={q.error} retry={q.reload} /> : <Loading label="Loading clients…" />) : !d.clients.length ? (
        <EmptyState icon="users" title={sp.get('q') ? 'No client matches' : archived ? 'No archived clients' : 'No clients yet'} actions={!sp.get('q') && !archived && perms.manage_clients ? <button type="button" className="dh-btn primary" onClick={() => setCreating(true)}>Add a client</button> : null}>
          {sp.get('q') ? 'Try a different spelling, or a part of the phone number.' : 'Add clients here, or while creating a case.'}
        </EmptyState>
      ) : (
        <div className="pr-card" style={{ opacity: q.loading ? 0.7 : 1 }}>
          <div className="pr-list">
            {d.clients.map((c) => (
              <Link key={c.id} to={`/practice/clients/${c.id}`} className="pr-item" style={{ gridTemplateColumns: '36px minmax(0,1fr) auto' }}>
                <Avatar name={c.name} />
                <span style={{ minWidth: 0 }}>
                  <span className="ttl">{c.name}</span>
                  <span className="meta">{c.phone ? <span>{c.phone}</span> : <span>No phone</span>}{c.email ? <span>{c.email}</span> : null}{c.occupation ? <span>{c.occupation}</span> : null}</span>
                </span>
                <span className="side">
                  <span>{c.active_cases} active · {c.cases} total</span>
                  {c.open_followups ? <span className="pr-pill warn">{c.open_followups} follow-up{c.open_followups === 1 ? '' : 's'}</span> : null}
                  {c.archived ? <span className="pr-pill dim">Archived</span> : null}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
      {d ? <Pager page={d.page} per={d.per_page} total={d.total} onPage={(p) => setSp((prev) => { const n = new URLSearchParams(prev); n.set('page', p); return n; }, { replace: true })} /> : null}
      {creating ? <ClientForm onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); nav(`/practice/clients/${c.id}`); }} /> : null}
    </>
  );
}

function ClientDetail({ id }) {
  const { perms, toast } = usePractice();
  const q = useAsync((signal) => pr.get(`/clients/${id}`, null, signal).then((d) => d.client), [id]);
  const comms = useAsync((signal) => pr.get('/comms', { client_id: id }, signal), [id]);
  const fus = useAsync((signal) => pr.get('/followups', { client_id: id, status: 'open' }, signal), [id]);
  const [edit, setEdit] = useState(false);
  const [fu, setFu] = useState(false);
  const [arch, setArch] = useState(false);
  const c = q.data;

  if (!c) {
    return (
      <>
        <Link className="pr-back" to="/practice/clients"><PIcon name="back" />All clients</Link>
        {q.error ? (q.error.status === 404 ? <EmptyState icon="users" title="Client not found" actions={<Link className="dh-btn primary" to="/practice/clients">Back to clients</Link>}>This client may have been removed.</EmptyState> : <ErrorBox error={q.error} retry={q.reload} />) : <Loading />}
      </>
    );
  }
  const toggleArchive = async () => {
    try { await pr.post(`/clients/${c.id}/archive`, { archive: !c.archived }); toast(c.archived ? 'Client restored' : 'Client archived'); setArch(false); q.reload(); } catch (e) { toast(doneWith(e), { tone: 'bad' }); setArch(false); }
  };
  const doneFu = async (f) => { try { await pr.patch(`/followups/${f.id}`, { status: 'done' }); fus.reload(); } catch (e) { toast(doneWith(e), { tone: 'bad' }); } };

  return (
    <>
      <Link className="pr-back" to="/practice/clients"><PIcon name="back" />All clients</Link>
      <div className="pr-hero" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 0 }}>
          <Avatar name={c.name} large />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0 }}>{c.name}</h1>
            <div className="line">
              {c.archived ? <span className="pr-pill dim"><PIcon name="archive" />Archived</span> : null}
              {c.phone ? <a className="pr-link" href={`tel:${c.phone}`}><PIcon name="phone" size={13} /> {c.phone}</a> : <span className="pr-muted">No phone</span>}
              {c.email ? <a className="pr-link" href={`mailto:${c.email}`}><PIcon name="mail" size={13} /> {c.email}</a> : <span className="pr-muted">No email</span>}
            </div>
          </div>
        </div>
        {perms.manage_clients ? (
          <div className="pr-actions">
            <button type="button" className="dh-btn ghost" onClick={() => setFu(true)}><PIcon name="clock" />Follow-up</button>
            <button type="button" className="dh-btn ghost" onClick={() => setEdit(true)}><PIcon name="edit" />Edit</button>
            <button type="button" className="dh-btn quiet" onClick={() => (c.archived ? toggleArchive() : setArch(true))}><PIcon name={c.archived ? 'restore' : 'archive'} />{c.archived ? 'Restore' : 'Archive'}</button>
          </div>
        ) : null}
      </div>

      <div className="pr-grid detail">
        <div className="pr-stack">
          <Card title="Cases" sub={`${c.case_list.length}`} flush actions={<Link className="dh-btn ghost sm" to={`/practice/cases?client_id=${c.id}`}>View as list</Link>}>
            {!c.case_list.length ? <p className="pr-note" style={{ textAlign: 'center', padding: 22 }}>No cases for this client yet.</p> : c.case_list.map((k) => (
              <Link key={k.id} to={`/practice/cases/${k.id}`} className="pr-item">
                <span style={{ minWidth: 0 }}><span className="ttl">{k.title}</span><span className="meta"><b>{k.case_no}</b><span>{k.court}</span>{k.advocate_name ? <span>{k.advocate_name}</span> : null}</span></span>
                <span className="side"><StatusPill status={k.status} />{k.closed_at ? <span>Closed</span> : k.next_hearing ? <DayChip date={k.next_hearing} /> : <span>No next date</span>}</span>
              </Link>
            ))}
          </Card>
          <Card title="Conversation history" flush>
            {!comms.data ? (comms.error ? <ErrorBox error={comms.error} retry={comms.reload} compact /> : <Loading />) : !comms.data.comms.length ? <p className="pr-note" style={{ textAlign: 'center', padding: 22 }}>No messages or calls logged yet. WhatsApp reminders, e-mails and calls you log on a case appear here.</p> : comms.data.comms.map((m) => (
              <div key={m.id} className="pr-item last" style={{ alignItems: 'start' }}>
                <span style={{ minWidth: 0 }}><span className="ttl" style={{ fontSize: 13.5 }}>{m.subject || human(m.channel)}{m.direction === 'in' ? ' (incoming)' : ''}</span><span className="pr-pre" style={{ fontSize: 12.5, display: 'block', marginTop: 2 }}>{(m.body || '').slice(0, 260)}{(m.body || '').length > 260 ? '…' : ''}</span><span className="meta"><span>{human(m.channel)}</span><span>{COMM_STATUS[m.status] || m.status}</span>{m.by ? <span>{m.by}</span> : null}</span></span>
                <span className="side">{fmtAgo(m.created_at)}</span>
              </div>
            ))}
          </Card>
        </div>
        <div className="pr-stack">
          <Card title="Follow-ups" flush actions={perms.manage_clients ? <button type="button" className="dh-btn ghost sm" onClick={() => setFu(true)}><PIcon name="plus" />Add</button> : null}>
            {!fus.data ? <Loading /> : !fus.data.followups.length ? <p className="pr-note" style={{ textAlign: 'center', padding: 18 }}>Nothing pending.</p> : fus.data.followups.map((f) => (
              <div key={f.id} className={`pr-item last ${f.overdue ? 'bad' : ''}`}>
                <span style={{ minWidth: 0 }}><span className="ttl" style={{ fontSize: 13.5 }}>{f.note}</span><span className="meta"><span>{f.assignee || 'Unassigned'}</span>{f.case_title ? <span>{f.case_title}</span> : null}</span></span>
                <span className="side"><DayChip date={f.due_date} /><button type="button" className="dh-btn ghost sm" onClick={() => doneFu(f)}><PIcon name="check" />Done</button></span>
              </div>
            ))}
          </Card>
          <Card title="Details">
            <dl className="pr-kv" style={{ gridTemplateColumns: '96px minmax(0,1fr)' }}>
              <dt>Prefers</dt><dd>{human(c.comm_pref || 'whatsapp')}</dd>
              {c.occupation ? (<><dt>Occupation</dt><dd>{c.occupation}</dd></>) : null}
              {c.address ? (<><dt>Address</dt><dd className="soft pr-pre">{c.address}</dd></>) : null}
              {c.id_type ? (<><dt>{c.id_type}</dt><dd className="pr-mono">{c.id_number || '—'}</dd></>) : null}
              {c.notes ? (<><dt>Notes</dt><dd className="soft pr-pre">{c.notes}</dd></>) : null}
              <dt>Added</dt><dd className="soft">{fmtShort((c.created_at || '').slice(0, 10))}</dd>
            </dl>
          </Card>
        </div>
      </div>
      {edit ? <ClientForm existing={c} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); q.reload(); }} /> : null}
      {fu ? <FollowupModal clientId={c.id} onClose={() => setFu(false)} onSaved={() => { setFu(false); fus.reload(); }} /> : null}
      {arch ? <Confirm title={`Archive ${c.name}?`} confirmLabel="Archive" onConfirm={toggleArchive} onCancel={() => setArch(false)}>They will be hidden from the client list and pickers. Their cases are not affected, and you can restore them later.</Confirm> : null}
    </>
  );
}

export default function Clients() {
  const { id } = useParams();
  return id ? <ClientDetail id={id} /> : <ClientList />;
}
