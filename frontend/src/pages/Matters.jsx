import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import Modal from '../components/Modal.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const STATUS_TABS = ['All', 'Active', 'Hearing soon', 'Disposed'];

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
function shortDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}
function caseToRow(c) {
  const du = daysUntil(c.next_hearing);
  let status = 'Active', tone = 'ok';
  if (c.closed) { status = 'Disposed'; tone = 'muted'; }
  else if (du != null && du >= 0 && du <= 7) { status = 'Hearing soon'; tone = 'warn'; }
  return {
    id: c.id,
    title: c.title || 'Untitled matter',
    type: c.case_type || 'Matter',
    court: c.court || '—',
    num: c.case_no || '—',
    next: shortDate(c.next_hearing),
    team_id: c.team_id ?? null,
    advocate_id: c.advocate_id ?? null,
    advocate_name: c.advocate_name || '',
    restricted: !!c.restricted,
    status, tone,
  };
}

export default function Matters() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  // Firm setup / rename state
  const [firmNeeded, setFirmNeeded] = useState(false);
  const [firmName, setFirmName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameMsg, setRenameMsg] = useState('');

  // Matter list + filters
  const [statusTab, setStatusTab] = useState('All');
  const [teamTab, setTeamTab] = useState('all');        // 'all' | <team_id> | 'unassigned'
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Firm members (for Advocate dropdown) and current member (to know who can reassign)
  const [members, setMembers] = useState([]);
  const [currentMemberId, setCurrentMemberId] = useState(null);
  const [isSenior, setIsSenior] = useState(false);

  // Modal state
  const showNew = params.get('new') === '1';
  const closeNew = () => setParams({}, { replace: true });
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [assignTeamFor, setAssignTeamFor] = useState(null); // matter row to assign
  const [visibilityFor, setVisibilityFor] = useState(null); // matter row for visibility edit

  const load = useCallback(async () => {
    setLoading(true); setError(''); setFirmNeeded(false);
    try {
      const [casesRes, teamsRes, meRes, membersRes] = await Promise.all([
        fetch(`${API_BASE}/api/practice/cases?per_page=100&sort=next_hearing`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/teams`, { credentials: 'include' }).catch(() => null),
        fetch(`${API_BASE}/api/practice/me`, { credentials: 'include' }).catch(() => null),
        fetch(`${API_BASE}/api/practice/members`, { credentials: 'include' }).catch(() => null),
      ]);
      if (meRes && meRes.ok) {
        const d = await meRes.json().catch(() => ({}));
        setFirmName(d.firm?.name || '');
        setCurrentMemberId(d.member?.id || null);
        setIsSenior(d.member?.role === 'senior');
      }
      if (membersRes && membersRes.ok) {
        const d = await membersRes.json().catch(() => ({}));
        setMembers(Array.isArray(d.members) ? d.members : []);
      }
      if (casesRes.status === 401) throw new Error('Your session has expired. Please sign in again.');
      if (casesRes.status === 403) {
        const data = await casesRes.json().catch(() => ({}));
        if (data.code === 'NO_FIRM') { setFirmNeeded(true); setRows([]); setTeams([]); return; }
        throw new Error(data.message || 'This action is not allowed.');
      }
      if (!casesRes.ok) throw new Error('load');
      const data = await casesRes.json();
      setRows((data.cases || []).map(caseToRow));

      if (teamsRes && teamsRes.ok) {
        const t = await teamsRes.json().catch(() => ({}));
        setTeams(Array.isArray(t.teams) ? t.teams : Array.isArray(t) ? t : []);
      }
    } catch (e) {
      setError(e.message === 'load' ? 'Could not load your matters. Please try again.' : e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Save a new practice name — Senior Advocate only (backend enforces).
  const saveRename = async () => {
    const n = renameInput.trim();
    if (n.length < 2) { setRenameMsg('Name must be at least two letters.'); return; }
    if (n === firmName) { setRenaming(false); return; }
    setRenameBusy(true); setRenameMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/practice/settings`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ firm_name: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Could not rename.');
      setFirmName(n);
      setRenaming(false);
      setRenameMsg('');
    } catch (e) {
      setRenameMsg(e.message);
    } finally {
      setRenameBusy(false);
    }
  };

  // Filtering
  const filtered = rows.filter((m) => {
    if (statusTab !== 'All' && m.status !== statusTab) return false;
    if (teamTab === 'unassigned' && m.team_id != null) return false;
    if (teamTab !== 'all' && teamTab !== 'unassigned' && m.team_id !== Number(teamTab)) return false;
    const needle = q.toLowerCase();
    if (needle && !m.title.toLowerCase().includes(needle) && !m.num.toLowerCase().includes(needle)) return false;
    return true;
  });

  const teamName = (id) => teams.find((t) => t.id === id)?.name || null;
  const unassignedCount = rows.filter((m) => m.team_id == null).length;
  const countByTeam = (id) => rows.filter((m) => m.team_id === id).length;

  return (
    <div className="lx-page lx-rise">
      <div className="lx-between ph" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 18 }}>
        <div>
          <span className="ph__eyebrow" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            Workspace
            {firmName && !renaming && (
              <>
                <span style={{ color: 'var(--muted)' }}>·</span>
                <span style={{ color: 'var(--ink-soft)' }}>{firmName}</span>
                <button
                  type="button"
                  onClick={() => { setRenameInput(firmName); setRenaming(true); setRenameMsg(''); }}
                  title="Rename practice"
                  style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', padding: 2, lineHeight: 0 }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </>
            )}
            {firmName && renaming && (
              <>
                <input
                  autoFocus
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename();
                    if (e.key === 'Escape') { setRenaming(false); setRenameMsg(''); }
                  }}
                  style={{
                    height: 26, border: '1px solid var(--rule)', borderRadius: 6,
                    padding: '0 8px', fontSize: 12, color: 'var(--ink)', background: 'var(--bg-card)',
                    outline: 'none', minWidth: 180,
                  }}
                />
                <button
                  className="lx-btn lx-btn--sm lx-btn--primary"
                  onClick={saveRename}
                  disabled={renameBusy}
                  style={{ padding: '2px 10px', fontSize: 11 }}
                >
                  {renameBusy ? 'Saving…' : 'Save'}
                </button>
                <button
                  className="lx-btn lx-btn--sm lx-btn--ghost"
                  onClick={() => { setRenaming(false); setRenameMsg(''); }}
                  disabled={renameBusy}
                  style={{ padding: '2px 10px', fontSize: 11 }}
                >
                  Cancel
                </button>
                {renameMsg && (
                  <span style={{ color: 'var(--risk, #ef4444)', fontSize: 11, textTransform: 'none', letterSpacing: 'normal' }}>
                    {renameMsg}
                  </span>
                )}
              </>
            )}
          </span>
          <h1 className="ph__title">Matters</h1>
          <p className="ph__sub">Every case, brief and advisory in your chambers — in one place.</p>
        </div>
        {!firmNeeded && (
          <div className="lx-row" style={{ gap: 10 }}>
            <button className="lx-btn lx-btn--ghost" onClick={() => setShowNewTeam(true)}>
              <Ic.Users size={15} /> New team
            </button>
            <button className="lx-btn lx-btn--gold" onClick={() => setParams({ new: '1' })}>
              <Ic.Plus size={15} /> New matter
            </button>
          </div>
        )}
      </div>

      {/* Firm setup card — shows only when API returned NO_FIRM */}
      {firmNeeded && <FirmSetupCard onCreated={load} />}

      {!firmNeeded && (
        <>
          {/* Status filter tabs + search */}
          <div className="lx-between" style={{ marginBottom: 14, gap: 14, flexWrap: 'wrap' }}>
            <div className="lx-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {STATUS_TABS.map((t) => (
                <button key={t} onClick={() => setStatusTab(t)} className="lx-btn lx-btn--sm"
                  style={statusTab === t
                    ? { background: 'var(--ink)', color: 'var(--paper)' }
                    : { background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--rule)' }}>
                  {t}
                </button>
              ))}
            </div>
            <div className="lx-field" style={{ height: 40, maxWidth: 260 }}>
              <Ic.Search size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search matters…" style={{ fontSize: 14 }} />
            </div>
          </div>

          {/* Team filter tabs */}
          <div className="lx-row" style={{ gap: 6, marginBottom: 18, flexWrap: 'wrap', overflowX: 'auto', paddingBottom: 2 }} role="tablist" aria-label="Filter matters by team">
            <button onClick={() => setTeamTab('all')} className="lx-btn lx-btn--sm"
              style={teamTab === 'all'
                ? { background: 'var(--accent-ink)', color: 'var(--on-accent, var(--paper))', borderRadius: 20, padding: '6px 14px', fontSize: 12 }
                : { background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--rule)', borderRadius: 20, padding: '6px 14px', fontSize: 12 }}>
              All Teams ({rows.length})
            </button>
            {teams.map((team) => (
              <button key={team.id} onClick={() => setTeamTab(String(team.id))} className="lx-btn lx-btn--sm"
                style={teamTab === String(team.id)
                  ? { background: 'var(--accent-ink)', color: 'var(--on-accent, var(--paper))', borderRadius: 20, padding: '6px 14px', fontSize: 12, whiteSpace: 'nowrap' }
                  : { background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--rule)', borderRadius: 20, padding: '6px 14px', fontSize: 12, whiteSpace: 'nowrap' }}>
                {team.name} ({countByTeam(team.id)})
              </button>
            ))}
            <button onClick={() => setTeamTab('unassigned')} className="lx-btn lx-btn--sm"
              style={teamTab === 'unassigned'
                ? { background: 'var(--accent-ink)', color: 'var(--on-accent, var(--paper))', borderRadius: 20, padding: '6px 14px', fontSize: 12, whiteSpace: 'nowrap' }
                : { background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--rule)', borderRadius: 20, padding: '6px 14px', fontSize: 12, whiteSpace: 'nowrap' }}>
              Unassigned ({unassignedCount})
            </button>
          </div>

          <div className="lx-card lx-card--pad">
            {loading ? (
              <div className="lx-empty"><p>Loading your matters…</p></div>
            ) : error ? (
              <div className="lx-empty">
                <div className="lx-empty__ico"><Ic.Matters size={22} /></div>
                <h4>Couldn’t load matters</h4><p>{error}</p>
                <button className="lx-btn lx-btn--sm" style={{ marginTop: 10 }} onClick={load}>Try again</button>
              </div>
            ) : (
              <div className="lx-list">
                {filtered.map((m) => {
                  const tName = teamName(m.team_id);
                  return (
                    <div className="lx-item" key={m.id} onClick={() => navigate('/matters/' + m.id)} style={{ padding: '16px 4px', cursor: 'pointer' }}>
                      <div className="lx-item__ico"><Ic.Scale size={18} /></div>
                      <div className="lx-item__body" style={{ flex: 2 }}>
                        <div className="lx-item__title">{m.title}</div>
                        <div className="lx-item__meta">{m.type}</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }} className="hide-sm">
                        <div style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>{m.court}</div>
                        <div className="lx-item__meta">{m.num}</div>
                      </div>
                      <div style={{ width: 70, textAlign: 'right' }} className="hide-sm">
                        <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10 }}>Next</div>
                        <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{m.next}</div>
                      </div>
                      {/* Team pill or "+ Add to team" */}
                      {tName ? (
                        <span
                          className="lx-badge lx-badge--muted"
                          style={{ minWidth: 92, justifyContent: 'center', background: 'var(--accent-soft, var(--paper-2))', color: 'var(--accent-ink, var(--ink))' }}
                          title={tName}
                        >
                          ● {tName}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="lx-btn lx-btn--ghost lx-btn--sm"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={(e) => { e.stopPropagation(); setAssignTeamFor(m); }}
                        >
                          + Add to team
                        </button>
                      )}
                      <span className={`lx-badge lx-badge--${m.tone}`} style={{ minWidth: 92, justifyContent: 'center' }}>{m.status}</span>
                      {m.restricted && (
                        <span
                          className="lx-badge lx-badge--risk"
                          title="Confidential — only Senior Advocate and the lead advocate see this"
                          style={{ minWidth: 92, justifyContent: 'center' }}
                        >
                          🔒 Confidential
                        </span>
                      )}
                      {isSenior && (
                        <button
                          type="button"
                          className="lx-btn lx-btn--ghost lx-btn--sm"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          title="Change advocate, team or confidentiality"
                          onClick={(e) => { e.stopPropagation(); setVisibilityFor(m); }}
                        >
                          ⚙ Visibility
                        </button>
                      )}
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="lx-empty">
                    <div className="lx-empty__ico"><Ic.Matters size={22} /></div>
                    <h4>{rows.length === 0 ? 'No matters yet' : 'No matters here'}</h4>
                    <p>{rows.length === 0 ? 'Add your first matter to start tracking it.' : 'Nothing matches this filter yet.'}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {showNew && (
        <NewMatterModal
          teams={teams}
          members={members}
          isSenior={isSenior}
          currentMemberId={currentMemberId}
          onClose={closeNew}
          onCreated={(id) => { closeNew(); load(); if (id) navigate('/matters/' + id); }}
        />
      )}
      {showNewTeam && (
        <NewTeamModal
          onClose={() => setShowNewTeam(false)}
          onCreated={() => { setShowNewTeam(false); load(); }}
        />
      )}
      {assignTeamFor && (
        <AssignToTeamModal
          matter={assignTeamFor}
          teams={teams}
          onClose={() => setAssignTeamFor(null)}
          onAssigned={() => { setAssignTeamFor(null); load(); }}
        />
      )}
      {visibilityFor && (
        <VisibilityModal
          matter={visibilityFor}
          teams={teams}
          members={members}
          onClose={() => setVisibilityFor(null)}
          onSaved={() => { setVisibilityFor(null); load(); }}
        />
      )}
    </div>
  );
}

/** Firm (practice) setup card — appears when backend returns 403 NO_FIRM. */
function FirmSetupCard({ onCreated }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const create = async () => {
    const n = name.trim();
    if (n.length < 2) { setErr('Give your practice a name of at least two letters.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/practice/firm`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ name: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Could not create the practice.');
      onCreated();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lx-card lx-card--pad lx-mt-l" style={{ borderLeft: '3px solid var(--accent-ink, #c99a4a)' }}>
      <div className="lx-row" style={{ gap: 10, marginBottom: 10, alignItems: 'center' }}>
        <Ic.Scale size={20} />
        <h3 style={{ margin: 0, fontSize: 16, fontFamily: 'var(--font-serif)' }}>Set up your practice first</h3>
      </div>
      <p style={{ color: 'var(--ink-soft)', marginTop: 0, fontSize: 14, lineHeight: 1.55 }}>
        Matters, hearings, clients and conflicts all live inside a <b>practice</b>. Give yours a name to get started — you can rename it later. You will be its Senior Advocate.
      </p>
      {err && <div role="alert" style={{ marginBottom: 10, color: 'var(--risk, #ef4444)', fontSize: 13 }}>{err}</div>}
      <div className="lx-row" style={{ gap: 10, maxWidth: 520, flexWrap: 'wrap' }}>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Khare & Associates"
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
          style={{
            flex: 1, minWidth: 240, height: 44, border: '1px solid var(--rule)',
            borderRadius: 10, padding: '0 14px', fontSize: 14, color: 'var(--ink)',
            background: 'var(--bg-card)', outline: 'none',
          }}
        />
        <button className="lx-btn lx-btn--primary" onClick={create} disabled={busy}>
          {busy ? 'Creating…' : 'Create practice'}
        </button>
      </div>
    </div>
  );
}

/** New matter modal — now with optional team assignment. */
function NewMatterModal({ teams, members, isSenior, currentMemberId, onClose, onCreated }) {
  // Default: assign to self (the creator)
  const [form, setForm] = useState({
    title: '', court: '', case_no: '', client_name: '', case_type: '',
    team_id: '', advocate_id: currentMemberId ? String(currentMemberId) : '',
    restricted: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Only advocates (senior + junior) can be assigned as the lead
  const advocateChoices = (members || []).filter((m) => m.active !== false && (m.role === 'senior' || m.role === 'junior'));

  const create = async () => {
    if (!form.title.trim()) { setErr('A matter title is required.'); return; }
    setBusy(true); setErr('');
    try {
      const body = { ...form, title: form.title.trim() };
      if (!body.team_id) delete body.team_id;
      else body.team_id = Number(body.team_id);
      if (!body.advocate_id) delete body.advocate_id;
      else body.advocate_id = Number(body.advocate_id);
      body.restricted = form.restricted ? 1 : 0;
      const res = await fetch(`${API_BASE}/api/practice/cases`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Could not create the matter.');
      onCreated(data.case?.id || data.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New matter" onClose={onClose}
      footer={<>
        <button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="lx-btn lx-btn--primary" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create matter'}</button>
      </>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}
      <div><label className="lbl">Matter title</label><input className="inp" value={form.title} onChange={set('title')} placeholder="e.g. Mehta Industries v. Union of India" /></div>
      <div className="lx-row" style={{ gap: 14 }}>
        <div style={{ flex: 1 }}><label className="lbl">Court</label><input className="inp" value={form.court} onChange={set('court')} placeholder="Delhi High Court" /></div>
        <div style={{ flex: 1 }}><label className="lbl">Case / CNR no.</label><input className="inp" value={form.case_no} onChange={set('case_no')} placeholder="W.P.(C) …" /></div>
      </div>
      <div><label className="lbl">Client</label><input className="inp" value={form.client_name} onChange={set('client_name')} placeholder="Client name" /></div>
      <div className="lx-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {['Writ', 'Civil', 'Criminal', 'Advisory', 'Consumer'].map((t) => (
          <span key={t} className="chip" onClick={() => setForm((f) => ({ ...f, case_type: t }))}
            style={form.case_type === t ? { background: 'var(--ink)', color: 'var(--paper)', cursor: 'pointer' } : { cursor: 'pointer' }}>{t}</span>
        ))}
      </div>

      {/* ── Visibility controls ─────────────────────────────────────────── */}
      <div style={{ marginTop: 8, paddingTop: 14, borderTop: '1px solid var(--rule)' }}>
        <div className="lbl" style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>
          Visibility — who sees this case
        </div>

        {/* Advocate — only Seniors can assign to someone else */}
        {advocateChoices.length > 0 && (
          <div>
            <label className="lbl">Assigned advocate</label>
            <select
              className="inp"
              value={form.advocate_id}
              onChange={set('advocate_id')}
              disabled={!isSenior}
              style={{ background: 'var(--bg-card)' }}
              title={!isSenior ? 'Only Senior Advocates can reassign' : undefined}
            >
              {advocateChoices.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.email}{m.id === currentMemberId ? ' (you)' : ''} — {m.role === 'senior' ? 'Senior' : 'Junior'}
                </option>
              ))}
            </select>
            <div className="lx-muted" style={{ fontSize: 12, marginTop: 4 }}>
              The lead advocate always sees this case.
            </div>
          </div>
        )}

        {/* Team — any member in the team gets access */}
        {teams.length > 0 && (
          <div>
            <label className="lbl">Team (shared with all team members)</label>
            <select
              className="inp"
              value={form.team_id}
              onChange={set('team_id')}
              style={{ background: 'var(--bg-card)' }}
            >
              <option value="">No team — only the advocate sees this</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}

        {/* Confidential toggle */}
        {isSenior && (
          <div className="lx-between" style={{ padding: '12px 0 2px', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Confidential</div>
              <div className="lx-muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                Hides this case from team members — only the Senior Advocate and the lead advocate see it.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, restricted: !f.restricted }))}
              style={{
                width: 44, height: 26, borderRadius: 999, border: 0, flexShrink: 0,
                background: form.restricted ? 'var(--risk, #ef4444)' : 'var(--rule)',
                position: 'relative', cursor: 'pointer', transition: 'background .2s',
              }}
            >
              <span style={{
                position: 'absolute', top: 3, left: form.restricted ? 21 : 3,
                width: 20, height: 20, borderRadius: '50%', background: '#fff',
                transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
              }} />
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Change the visibility of an existing matter — advocate / team / confidential. */
function VisibilityModal({ matter, teams, members, onClose, onSaved }) {
  const [advocateId, setAdvocateId] = useState(matter.advocate_id ? String(matter.advocate_id) : '');
  const [teamId, setTeamId] = useState(matter.team_id ? String(matter.team_id) : '');
  const [restricted, setRestricted] = useState(!!matter.restricted);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const advocateChoices = (members || []).filter((m) => m.active !== false && (m.role === 'senior' || m.role === 'junior'));

  const save = async () => {
    setBusy(true); setErr('');
    try {
      // 1) Update advocate + restricted via PATCH /cases/<id>
      const body = {};
      const newAdv = advocateId ? Number(advocateId) : null;
      if ((matter.advocate_id || null) !== newAdv) body.advocate_id = newAdv;
      if (!!matter.restricted !== restricted) body.restricted = restricted ? 1 : 0;
      if (Object.keys(body).length > 0) {
        const r = await fetch(`${API_BASE}/api/practice/cases/${matter.id}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
          body: JSON.stringify(body),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.message || d.error || 'Could not update the case.');
      }
      // 2) Update team via dedicated endpoint (reuses our Model-B team patch)
      const newTeam = teamId ? Number(teamId) : null;
      if ((matter.team_id || null) !== newTeam) {
        const r2 = await fetch(`${API_BASE}/api/practice/cases/${matter.id}/team`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
          body: JSON.stringify({ team_id: newTeam }),
        });
        const d2 = await r2.json().catch(() => ({}));
        if (!r2.ok) throw new Error(d2.message || d2.error || 'Could not change the team.');
      }
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Visibility — "${matter.title}"`} onClose={onClose}
      footer={<>
        <button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="lx-btn lx-btn--primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}

      <div>
        <label className="lbl">Assigned advocate</label>
        <select className="inp" value={advocateId} onChange={(e) => setAdvocateId(e.target.value)} style={{ background: 'var(--bg-card)' }}>
          <option value="">— None —</option>
          {advocateChoices.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name || m.email} — {m.role === 'senior' ? 'Senior' : 'Junior'}
            </option>
          ))}
        </select>
        <div className="lx-muted" style={{ fontSize: 12, marginTop: 4 }}>Always sees this case.</div>
      </div>

      <div>
        <label className="lbl">Team</label>
        <select className="inp" value={teamId} onChange={(e) => setTeamId(e.target.value)} style={{ background: 'var(--bg-card)' }}>
          <option value="">— No team —</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="lx-muted" style={{ fontSize: 12, marginTop: 4 }}>
          Everyone in this team sees the case (unless Confidential is on).
        </div>
      </div>

      <div className="lx-between" style={{ padding: '14px 0 0', alignItems: 'flex-start', gap: 14, borderTop: '1px solid var(--rule)', marginTop: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Confidential</div>
          <div className="lx-muted" style={{ fontSize: 12.5, marginTop: 2 }}>
            Hides from team members — only Senior Advocate + lead advocate see it.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setRestricted((v) => !v)}
          style={{
            width: 44, height: 26, borderRadius: 999, border: 0, flexShrink: 0,
            background: restricted ? 'var(--risk, #ef4444)' : 'var(--rule)',
            position: 'relative', cursor: 'pointer', transition: 'background .2s',
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: restricted ? 21 : 3,
            width: 20, height: 20, borderRadius: '50%', background: '#fff',
            transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
          }} />
        </button>
      </div>
    </Modal>
  );
}

/** Create a new team. */
function NewTeamModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const create = async () => {
    const n = name.trim();
    if (n.length < 2) { setErr('Give the team a name of at least two letters.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/teams`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ name: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Could not create the team.');
      onCreated();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New team" onClose={onClose}
      footer={<>
        <button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="lx-btn lx-btn--primary" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create team'}</button>
      </>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}
      <p style={{ color: 'var(--ink-soft)', fontSize: 13.5, marginTop: 0 }}>
        A team is a group inside your practice — e.g. “Litigation”, “Corporate”, “Family Law”. Matters can belong to one team.
      </p>
      <div>
        <label className="lbl">Team name</label>
        <input
          autoFocus
          className="inp"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Litigation"
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
        />
      </div>
    </Modal>
  );
}

/** Assign an existing matter to a team. */
function AssignToTeamModal({ matter, teams, onClose, onAssigned }) {
  const [teamId, setTeamId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const assign = async () => {
    if (!teamId) { setErr('Pick a team to assign this matter to.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/practice/cases/${matter.id}/team`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ team_id: Number(teamId) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Could not assign to team.');
      onAssigned();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Add “${matter.title}” to a team`} onClose={onClose}
      footer={<>
        <button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="lx-btn lx-btn--primary" onClick={assign} disabled={busy || !teamId}>{busy ? 'Assigning…' : 'Assign'}</button>
      </>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}
      {teams.length === 0 ? (
        <div className="lx-empty" style={{ padding: '14px 0' }}>
          <p>You have no teams yet. Close this and click <b>New team</b> on the Matters page to create one.</p>
        </div>
      ) : (
        <div className="lx-stack" style={{ gap: 8 }}>
          {teams.map((t) => (
            <button
              key={t.id}
              type="button"
              className="lx-btn lx-btn--ghost"
              onClick={() => setTeamId(String(t.id))}
              style={{
                justifyContent: 'flex-start', width: '100%', height: 48,
                background: String(t.id) === teamId ? 'var(--accent-soft, var(--paper-2))' : 'transparent',
                borderColor: String(t.id) === teamId ? 'var(--accent-ink)' : 'var(--rule)',
              }}
            >
              <span style={{ marginRight: 10 }}>●</span>
              {t.name}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
