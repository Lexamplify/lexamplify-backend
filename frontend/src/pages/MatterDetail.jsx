import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import Modal from '../components/Modal.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const TABS = ['Overview', 'Documents', 'Hearings', 'Timeline', 'Parties', 'Notes'];

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
function shortDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
function fullDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}
function whenLabel(raw) {
  if (!raw) return '—';
  const s = String(raw).includes('T') ? raw : String(raw).replace(' ', 'T');
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return shortDate(raw);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}
function titleCase(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

// Real practice case -> the luxury detail view model (replaces the old sample lookup).
function caseToMatter(c) {
  const du = daysUntil(c.next_hearing);
  let tone = 'ok';
  if (c.closed) tone = 'muted';
  else if (du != null && du >= 0 && du <= 7) tone = 'warn';
  const num = c.case_no || '—';
  return {
    title: c.title || 'Untitled matter',
    court: c.court || '—',
    num,
    type: c.case_type || c.category || 'Matter',
    filed: fullDate(c.filing_date),
    lead: c.advocate_name || '—',
    status: c.closed ? 'Disposed' : (c.status || 'Active'),
    tone,
    stage: titleCase(c.next_action || c.status) || '—',
    next: shortDate(c.next_hearing),
    nextFull: fullDate(c.next_hearing),
    client: c.client_name || '—',
    judge: c.judge || '—',
    oppositeParty: c.opposite_party || '—',
    summary: (c.remarks || '').trim(),
  };
}

const PARTY_TONE = { petitioner: 'muted', respondent: 'muted', opposing_counsel: 'muted', witness: 'muted' };
const HEARING_TONE = (status) => (status === 'scheduled' ? 'warn' : status === 'adjourned' ? 'muted' : 'ok');
const TIMELINE_TONE = (kind) => (kind === 'note' ? 'accent' : (kind === 'status' || kind === 'hearing') ? 'ok' : 'muted');

export default function MatterDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState('Overview');

  const [caseData, setCaseData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  // Timeline (lazy, loaded when the tab is opened)
  const [timeline, setTimeline] = useState([]);
  const [tlState, setTlState] = useState({ loading: false, error: '', loaded: false });

  // Notes (lazy)
  const [notes, setNotes] = useState([]);
  const [notesState, setNotesState] = useState({ loading: false, error: '', loaded: false });
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState('');

  // Add-hearing + add-party + edit-case + ask-AI modals
  const [showAddHearing, setShowAddHearing] = useState(false);
  const [showAddParty, setShowAddParty] = useState(false);
  const [showEditCase, setShowEditCase] = useState(false);
  const [showAskAi, setShowAskAi] = useState(false);

  // Documents (lazy — fetched when Documents tab opens)
  const [documents, setDocuments] = useState([]);
  const [docsState, setDocsState] = useState({ loading: false, error: '', loaded: false });
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(''); setNotFound(false);
    try {
      const res = await fetch(`${API_BASE}/api/practice/cases/${id}`, { credentials: 'include' });
      if (!res.ok) {
        if (res.status === 404) { setNotFound(true); return; }
        throw new Error(res.status === 401 ? 'Your session has expired. Please sign in again.' : 'load');
      }
      const data = await res.json();
      setCaseData(data.case || null);
      if (!data.case) setNotFound(true);
    } catch (e) {
      setError(e.message === 'load' ? 'Could not load this matter. Please try again.' : e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const loadTimeline = useCallback(async () => {
    setTlState({ loading: true, error: '', loaded: false });
    try {
      const res = await fetch(`${API_BASE}/api/practice/cases/${id}/timeline`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status === 401 ? 'Your session has expired. Please sign in again.' : 'load');
      const data = await res.json();
      setTimeline(Array.isArray(data.items) ? data.items : []);
      setTlState({ loading: false, error: '', loaded: true });
    } catch (e) {
      setTlState({ loading: false, error: e.message === 'load' ? 'Could not load the timeline.' : e.message, loaded: true });
    }
  }, [id]);

  const loadNotes = useCallback(async () => {
    setNotesState({ loading: true, error: '', loaded: false });
    try {
      const res = await fetch(`${API_BASE}/api/practice/cases/${id}/notes`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status === 401 ? 'Your session has expired. Please sign in again.' : 'load');
      const data = await res.json();
      setNotes(Array.isArray(data.notes) ? data.notes : []);
      setNotesState({ loading: false, error: '', loaded: true });
    } catch (e) {
      setNotesState({ loading: false, error: e.message === 'load' ? 'Could not load notes.' : e.message, loaded: true });
    }
  }, [id]);

  const loadDocuments = useCallback(async () => {
    setDocsState({ loading: true, error: '', loaded: false });
    try {
      const res = await fetch(`${API_BASE}/api/practice/cases/${id}/documents`, { credentials: 'include' });
      if (!res.ok) throw new Error('load');
      const data = await res.json();
      setDocuments(Array.isArray(data.documents) ? data.documents : []);
      setDocsState({ loading: false, error: '', loaded: true });
    } catch (e) {
      setDocsState({ loading: false, error: e.message === 'load' ? 'Could not load documents.' : e.message, loaded: true });
    }
  }, [id]);

  const uploadDocument = async (file) => {
    if (!file) return;
    setUploading(true); setUploadErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/api/practice/cases/${id}/documents`, {
        method: 'POST', credentials: 'include',
        headers: { 'X-CSRF-TOKEN': csrf() },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Could not upload the document.');
      await loadDocuments();
      await load();
    } catch (e) {
      setUploadErr(e.message);
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (tab === 'Timeline' && !tlState.loaded && !tlState.loading) loadTimeline();
    if (tab === 'Notes' && !notesState.loaded && !notesState.loading) loadNotes();
    if (tab === 'Documents' && !docsState.loaded && !docsState.loading) loadDocuments();
  }, [tab, tlState.loaded, tlState.loading, notesState.loaded, notesState.loading, loadTimeline, loadNotes, docsState.loaded, docsState.loading, loadDocuments]);

  const saveNote = async () => {
    const body = noteDraft.trim();
    if (!body) return;
    setSavingNote(true); setNoteError('');
    try {
      const res = await fetch(`${API_BASE}/api/practice/cases/${id}/notes`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || (res.status === 401 ? 'Your session has expired. Please sign in again.' : 'Could not save the note.'));
      setNoteDraft('');
      if (data.note) setNotes((prev) => [data.note, ...prev]);
      else loadNotes();
    } catch (e) {
      setNoteError(e.message);
    } finally {
      setSavingNote(false);
    }
  };

  // ── Page-level loading / error / not-found states ──────────────────────────
  if (loading) {
    return (
      <div className="lx-page lx-rise">
        <div className="dh">
          <button className="dh__back" onClick={() => navigate('/matters')}><Ic.Arrow size={14} style={{ transform: 'rotate(180deg)' }} /> All matters</button>
        </div>
        <div className="lx-card lx-card--pad"><div className="lx-empty"><p>Loading this matter…</p></div></div>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="lx-page lx-rise">
        <div className="dh">
          <button className="dh__back" onClick={() => navigate('/matters')}><Ic.Arrow size={14} style={{ transform: 'rotate(180deg)' }} /> All matters</button>
        </div>
        <div className="lx-card lx-card--pad">
          <div className="lx-empty">
            <div className="lx-empty__ico"><Ic.Matters size={22} /></div>
            <h4>Matter not found</h4>
            <p>This matter may have been removed, or you may not have access to it.</p>
            <button className="lx-btn lx-btn--sm" style={{ marginTop: 10 }} onClick={() => navigate('/matters')}>Back to matters</button>
          </div>
        </div>
      </div>
    );
  }
  if (error || !caseData) {
    return (
      <div className="lx-page lx-rise">
        <div className="dh">
          <button className="dh__back" onClick={() => navigate('/matters')}><Ic.Arrow size={14} style={{ transform: 'rotate(180deg)' }} /> All matters</button>
        </div>
        <div className="lx-card lx-card--pad">
          <div className="lx-empty">
            <div className="lx-empty__ico"><Ic.Matters size={22} /></div>
            <h4>Couldn’t load this matter</h4>
            <p>{error || 'Something went wrong.'}</p>
            <button className="lx-btn lx-btn--sm" style={{ marginTop: 10 }} onClick={load}>Try again</button>
          </div>
        </div>
      </div>
    );
  }

  const m = caseToMatter(caseData);
  const parties = Array.isArray(caseData.parties) ? caseData.parties : [];
  const hearings = Array.isArray(caseData.hearings) ? caseData.hearings : [];
  const docCount = caseData.counts?.documents ?? 0;

  // When no formal party records exist, derive a graceful view from the case itself.
  const partyRows = parties.length
    ? parties.map((p) => ({ r: titleCase(p.role), n: p.name || '—', c: p.contact || p.notes || '—', tone: PARTY_TONE[p.role] || 'muted' }))
    : [
        m.client !== '—' && { r: 'Client', n: m.client, c: 'On record', tone: 'muted' },
        m.oppositeParty !== '—' && { r: 'Opposite party', n: m.oppositeParty, c: '—', tone: 'muted' },
      ].filter(Boolean);

  return (
    <div className="lx-page lx-rise">
      <div className="dh">
        <button className="dh__back" onClick={() => navigate('/matters')}><Ic.Arrow size={14} style={{ transform: 'rotate(180deg)' }} /> All matters</button>
        <div className="dh__row">
          <div>
            <h1 className="dh__title font-display">{m.title}</h1>
            <div className="dh__meta">
              <span><b>{m.court}</b></span>
              <span>{m.num !== '—' ? m.num : m.type}</span>
              <span>Filed <b>{m.filed}</b></span>
              <span>Lead <b>{m.lead}</b></span>
            </div>
          </div>
          <div className="lx-row" style={{ gap: 10 }}>
            <span className={`lx-badge lx-badge--${m.tone}`} style={{ height: 32 }}>{m.status}</span>
            <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => setShowEditCase(true)} title="Edit case details">
              <Ic.Edit size={14} /> Edit
            </button>
            <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => navigate('/draft')}><Ic.Draft size={14} /> Draft</button>
            <button className="lx-btn lx-btn--gold lx-btn--sm" onClick={() => setShowAskAi(true)}>
              <Ic.Sparkle size={14} /> Ask about this matter
            </button>
          </div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="lx-dash-grid">
          <div className="lx-stack" style={{ gap: 24 }}>
            <div className="lx-card lx-card--pad">
              <div className="lx-section-head" style={{ marginBottom: 14 }}><h3>Summary</h3></div>
              {m.summary
                ? <p className="lx-lead" style={{ fontSize: 15, whiteSpace: 'pre-line' }}>{m.summary}</p>
                : <p className="lx-muted" style={{ fontSize: 14 }}>No summary recorded for this matter yet. Add remarks from your practice management to see them here.</p>}
            </div>
            <div className="lx-card lx-card--pad">
              <div className="lx-section-head" style={{ marginBottom: 18 }}><h3>Case details</h3></div>
              <div className="kv">
                <div><div className="kv__k">Bench</div><div className="kv__v">{m.judge}</div></div>
                <div><div className="kv__k">Stage</div><div className="kv__v">{m.stage}</div></div>
                <div><div className="kv__k">Next listing</div><div className="kv__v">{m.nextFull}</div></div>
                <div><div className="kv__k">Client</div><div className="kv__v">{m.client}</div></div>
                <div><div className="kv__k">Opposite party</div><div className="kv__v">{m.oppositeParty}</div></div>
                <div><div className="kv__k">Type</div><div className="kv__v">{m.type}</div></div>
              </div>
            </div>
            <div className="lx-card lx-card--pad" style={{ background: 'var(--accent-soft)', borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)' }}>
              <div className="lx-row" style={{ gap: 8, marginBottom: 10 }}><span className="lx-badge"><Ic.Sparkle size={13} /> AI brief</span></div>
              <p style={{ fontFamily: 'var(--font-serif)', fontSize: 16, lineHeight: 1.6, color: 'var(--ink)' }}>
                An AI brief for this matter hasn’t been generated yet. Use <b>Ask about this matter</b> to build one from the case record, hearings and documents.
              </p>
            </div>
          </div>
          <aside className="lx-stack" style={{ gap: 24 }}>
            <div className="lx-card lx-card--pad">
              <div className="lx-section-head" style={{ marginBottom: 14 }}><h3>Next hearing</h3></div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 26, color: 'var(--ink)' }}>{m.next}</div>
              <div className="lx-muted" style={{ marginTop: 4 }}>{m.nextFull}</div>
              <button className="lx-btn lx-btn--ghost lx-btn--sm lx-mt-m" style={{ width: '100%' }} onClick={() => navigate('/calendar')}>Open calendar</button>
            </div>
            <div className="lx-card lx-card--pad">
              <div className="lx-section-head" style={{ marginBottom: 12 }}><h3>Quick actions</h3></div>
              <div className="lx-stack" style={{ gap: 8 }}>
                {[['Draft a document', Ic.Draft], ['Research a point', Ic.Research], ['Add a note', Ic.Doc], ['Upload a file', Ic.Upload]].map(([l, I]) => (
                  <button key={l} className="lx-btn lx-btn--ghost" style={{ justifyContent: 'flex-start', width: '100%' }} onClick={() => { if (l === 'Add a note') setTab('Notes'); }}><span style={{ color: 'var(--accent-ink)' }}><I size={16} /></span>{l}</button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}

      {tab === 'Documents' && (
        <div className="lx-card lx-card--pad">
          <div className="lx-between" style={{ marginBottom: 14 }}>
            <div className="lx-muted">
              {documents.length} document{documents.length === 1 ? '' : 's'} on this matter · visible to everyone who can see this case
            </div>
            <label className="lx-btn lx-btn--primary lx-btn--sm" style={{ cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
              <Ic.Upload size={14} /> {uploading ? 'Uploading…' : 'Upload document'}
              <input
                type="file"
                style={{ display: 'none' }}
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadDocument(f);
                  e.target.value = ''; // allow re-selecting the same file
                }}
              />
            </label>
          </div>
          {uploadErr && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{uploadErr}</div>}
          {docsState.loading ? (
            <div className="lx-empty"><p>Loading documents…</p></div>
          ) : docsState.error ? (
            <div className="lx-empty">
              <div className="lx-empty__ico"><Ic.Doc size={22} /></div>
              <h4>Couldn’t load documents</h4><p>{docsState.error}</p>
              <button className="lx-btn lx-btn--sm" style={{ marginTop: 10 }} onClick={loadDocuments}>Try again</button>
            </div>
          ) : documents.length === 0 ? (
            <div className="lx-empty">
              <div className="lx-empty__ico"><Ic.Doc size={22} /></div>
              <h4>No documents yet</h4>
              <p>Click <b>Upload document</b> above to add the first one. Anyone who can see this case will see it.</p>
            </div>
          ) : (
            <div className="lx-list">
              {documents.map((d) => {
                const sizeKb = Math.max(1, Math.round((d.size_bytes || 0) / 1024));
                const when = d.created_at
                  ? new Date(String(d.created_at).replace(' ', 'T')).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                  : '';
                return (
                  <a
                    key={d.id}
                    href={`${API_BASE}/api/practice/cases/${id}/documents/${d.id}/download`}
                    className="lx-item"
                    style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}
                  >
                    <div className="lx-item__ico"><Ic.Doc size={16} /></div>
                    <div className="lx-item__body">
                      <div className="lx-item__title">{d.title || d.filename || 'Untitled'}</div>
                      <div className="lx-item__meta">
                        {(d.format || '').toUpperCase() || 'FILE'} · {sizeKb} KB · uploaded by {d.uploader_name}{when ? ` · ${when}` : ''}
                      </div>
                    </div>
                    <Ic.Upload size={14} style={{ transform: 'rotate(180deg)', opacity: 0.6 }} />
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'Hearings' && (
        <div className="lx-card lx-card--pad">
          <div className="lx-between" style={{ marginBottom: 14 }}>
            <div className="lx-muted">{hearings.length} hearing{hearings.length === 1 ? '' : 's'} on record</div>
            <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={() => setShowAddHearing(true)}>
              <Ic.Plus size={14} /> Add hearing
            </button>
          </div>
          {hearings.length === 0 ? (
            <div className="lx-empty">
              <div className="lx-empty__ico"><Ic.Gavel size={22} /></div>
              <h4>No hearings on record</h4>
              <p>Hearings added to this matter will appear here, most recent first.</p>
            </div>
          ) : (
            <div className="lx-list">
              {hearings.map((h) => (
                <div className="lx-item" key={h.id}>
                  <div style={{ width: 92, flexShrink: 0 }}><div style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{shortDate(h.hearing_date)}</div></div>
                  <div className="lx-item__body">
                    <div className="lx-item__title" style={{ fontSize: 15 }}>{h.purpose || h.note || 'Hearing'}</div>
                    <div className="lx-item__meta">{[h.court || m.court, h.hall_no && `Hall ${h.hall_no}`, h.hearing_time].filter(Boolean).join(' · ') || '—'}</div>
                  </div>
                  <span className={`lx-badge lx-badge--${HEARING_TONE(h.status)}`}>{titleCase(h.status) || 'Listed'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'Timeline' && (
        <div className="lx-card lx-card--pad">
          {tlState.loading ? (
            <div className="lx-empty"><p>Loading the timeline…</p></div>
          ) : tlState.error ? (
            <div className="lx-empty">
              <div className="lx-empty__ico"><Ic.Clock size={22} /></div>
              <h4>Couldn’t load the timeline</h4><p>{tlState.error}</p>
              <button className="lx-btn lx-btn--sm" style={{ marginTop: 10 }} onClick={loadTimeline}>Try again</button>
            </div>
          ) : timeline.length === 0 ? (
            <div className="lx-empty">
              <div className="lx-empty__ico"><Ic.Clock size={22} /></div>
              <h4>Nothing on the timeline yet</h4>
              <p>Filings, hearings, notes and updates on this matter will be logged here.</p>
            </div>
          ) : (
            <div className="tl">
              {timeline.map((t) => {
                const tone = TIMELINE_TONE(t.kind);
                return (
                  <div className="tl__item" key={t.id}>
                    <span className={`tl__dot ${tone === 'accent' ? 'tl__dot--accent' : tone === 'ok' ? 'tl__dot--ok' : ''}`} />
                    <div className="tl__when">{whenLabel(t.at)}</div>
                    <div className="tl__text">{t.title}</div>
                    <div className="tl__who">{t.actor || 'System'}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'Parties' && (
        <div className="lx-card lx-card--pad">
          <div className="lx-between" style={{ marginBottom: 14 }}>
            <div className="lx-muted">{partyRows.length} part{partyRows.length === 1 ? 'y' : 'ies'} on record</div>
            <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={() => setShowAddParty(true)}>
              <Ic.Plus size={14} /> Add party
            </button>
          </div>
          {partyRows.length === 0 ? (
            <div className="lx-empty">
              <div className="lx-empty__ico"><Ic.Users size={22} /></div>
              <h4>No parties on record</h4>
              <p>Parties added to this matter will appear here.</p>
            </div>
          ) : (
            <div className="lx-list">
              {partyRows.map((p, i) => (
                <div className="lx-item" key={i}>
                  <div className="lx-item__ico"><Ic.Users size={16} /></div>
                  <div className="lx-item__body"><div className="lx-item__title">{p.n}</div><div className="lx-item__meta">{p.c}</div></div>
                  <span className={`lx-badge lx-badge--${p.tone}`}>{p.r}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'Notes' && (
        <div className="lx-card lx-card--pad">
          <textarea className="inp" placeholder="Add a private note for this matter…" style={{ minHeight: 120, marginBottom: 14 }} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
          {noteError && <div role="alert" style={{ marginBottom: 10, color: 'var(--risk)', fontSize: 13 }}>{noteError}</div>}
          <div className="lx-between"><div className="lx-muted">Notes are visible to your chambers only.</div><button className="lx-btn lx-btn--primary lx-btn--sm" onClick={saveNote} disabled={savingNote || !noteDraft.trim()}>{savingNote ? 'Saving…' : 'Save note'}</button></div>
          <hr className="lx-rule" style={{ margin: '20px 0' }} />
          {notesState.loading ? (
            <div className="lx-empty"><p>Loading notes…</p></div>
          ) : notesState.error ? (
            <div className="lx-empty">
              <div className="lx-empty__ico"><Ic.Doc size={22} /></div>
              <h4>Couldn’t load notes</h4><p>{notesState.error}</p>
              <button className="lx-btn lx-btn--sm" style={{ marginTop: 10 }} onClick={loadNotes}>Try again</button>
            </div>
          ) : notes.length === 0 ? (
            <div className="lx-empty"><p>No notes yet. Add the first note above.</p></div>
          ) : (
            <div className="lx-list">
              {notes.map((n) => (
                <div className="lx-item" key={n.id} style={{ alignItems: 'flex-start' }}>
                  <div className="lx-item__ico" style={{ width: 32, height: 32 }}><Ic.Doc size={14} /></div>
                  <div className="lx-item__body"><div className="lx-item__meta" style={{ marginBottom: 3 }}>{(n.author || (n.mine ? 'You' : 'Team member'))} · {whenLabel(n.created_at)}</div><div style={{ fontSize: 14, color: 'var(--ink)', whiteSpace: 'pre-line' }}>{n.body}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showAddHearing && (
        <AddHearingModal
          caseId={id}
          defaults={{ court: m.court, hall_no: m.hall_no, judge: m.judge }}
          onClose={() => setShowAddHearing(false)}
          onSaved={() => { setShowAddHearing(false); load(); }}
        />
      )}
      {showAddParty && (
        <AddPartyModal
          caseId={id}
          onClose={() => setShowAddParty(false)}
          onSaved={() => { setShowAddParty(false); load(); }}
        />
      )}
      {showEditCase && (
        <EditCaseModal
          caseData={caseData}
          onClose={() => setShowEditCase(false)}
          onSaved={() => { setShowEditCase(false); load(); }}
        />
      )}
      {showAskAi && (
        <AskAiModal
          caseData={caseData}
          hearings={hearings}
          parties={parties}
          onClose={() => setShowAskAi(false)}
        />
      )}
    </div>
  );
}

/** Add a hearing to this case. */
function AddHearingModal({ caseId, defaults, onClose, onSaved }) {
  const [f, setF] = useState({
    date: '', time: '', purpose: '',
    court: defaults?.court || '', hall_no: defaults?.hall_no || '', judge: defaults?.judge || '',
    note: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = async () => {
    if (!f.date) { setErr('Pick a hearing date.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/practice/cases/${caseId}/hearings`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify(f),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || d.error || 'Could not add the hearing.');
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add hearing" onClose={onClose}
      footer={<>
        <button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="lx-btn lx-btn--primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Add hearing'}</button>
      </>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}
      <div className="lx-row" style={{ gap: 14 }}>
        <div style={{ flex: 1 }}><label className="lbl">Date</label><input className="inp" type="date" value={f.date} onChange={set('date')} /></div>
        <div style={{ flex: 1 }}><label className="lbl">Time (optional)</label><input className="inp" type="time" value={f.time} onChange={set('time')} /></div>
      </div>
      <div><label className="lbl">Purpose</label><input className="inp" value={f.purpose} onChange={set('purpose')} placeholder="e.g. Arguments on Section 11(6) application" /></div>
      <div className="lx-row" style={{ gap: 14 }}>
        <div style={{ flex: 1 }}><label className="lbl">Court</label><input className="inp" value={f.court} onChange={set('court')} /></div>
        <div style={{ flex: 1 }}><label className="lbl">Hall</label><input className="inp" value={f.hall_no} onChange={set('hall_no')} /></div>
      </div>
      <div><label className="lbl">Judge (optional)</label><input className="inp" value={f.judge} onChange={set('judge')} /></div>
      <div><label className="lbl">Note (optional)</label><textarea className="inp" value={f.note} onChange={set('note')} style={{ minHeight: 70 }} /></div>
    </Modal>
  );
}

/** Add a party to this case. */
function AddPartyModal({ caseId, onClose, onSaved }) {
  const [f, setF] = useState({ role: 'petitioner', name: '', contact: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = async () => {
    if (!f.name.trim()) { setErr('Name is required.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/practice/cases/${caseId}/parties`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ ...f, name: f.name.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || d.error || 'Could not add the party.');
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add party" onClose={onClose}
      footer={<>
        <button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="lx-btn lx-btn--primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Add party'}</button>
      </>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}
      <div><label className="lbl">Role</label>
        <select className="inp" value={f.role} onChange={set('role')} style={{ background: 'var(--bg-card)' }}>
          <option value="petitioner">Petitioner</option>
          <option value="respondent">Respondent</option>
          <option value="opposing_counsel">Opposing counsel</option>
          <option value="witness">Witness</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div><label className="lbl">Name</label><input className="inp" value={f.name} onChange={set('name')} placeholder="Full name" autoFocus /></div>
      <div><label className="lbl">Contact (optional)</label><input className="inp" value={f.contact} onChange={set('contact')} placeholder="Phone or email" /></div>
      <div><label className="lbl">Notes (optional)</label><textarea className="inp" value={f.notes} onChange={set('notes')} style={{ minHeight: 60 }} /></div>
    </Modal>
  );
}

/** Edit case details — title, court, bench, client, opposite party, type, status, remarks. */
function EditCaseModal({ caseData, onClose, onSaved }) {
  const c = caseData || {};
  const [f, setF] = useState({
    title: c.title || '',
    court: c.court || '',
    case_no: c.case_no || '',
    judge: c.judge || '',
    client_name: c.client_name || '',
    opposite_party: c.opposite_party || '',
    case_type: c.case_type || 'Civil',
    status: c.status || 'Active',
    next_action: c.next_action || '',
    next_action_due: c.next_action_due ? String(c.next_action_due).slice(0, 10) : '',
    remarks: c.remarks || '',
    _clientRoll: [],
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    if (c.client_id) return;
    fetch(`${API_BASE}/api/practice/clients?per_page=200`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d && Array.isArray(d.clients)) setF((s) => ({ ...s, _clientRoll: d.clients })); })
      .catch(() => {});
  }, [c.client_id]);

  const save = async () => {
    if (!f.title.trim()) { setErr('Matter title is required.'); return; }
    if (!f.court.trim()) { setErr('Court is required.'); return; }
    setBusy(true); setErr('');
    try {
      // Build body of only non-empty values + the required three (title/court/case_no)
      const body = {
        title: f.title.trim(),
        court: f.court.trim(),
        case_no: f.case_no.trim() || c.case_no,
        case_type: f.case_type,
        status: f.status,
        judge: f.judge.trim(),
        opposite_party: f.opposite_party.trim(),
        next_action: f.next_action.trim(),
        remarks: f.remarks.trim(),
      };
      if (f.next_action_due) body.next_action_due = f.next_action_due;
      // Client — the backend's /cases PATCH expects client_id, not raw name. If a new name is typed and
      // the case has no existing client_id, create a client inline by passing a `client` object.
      if (f.client_name.trim() && !c.client_id) {
        body.client = { name: f.client_name.trim() };
      }
      const r = await fetch(`${API_BASE}/api/practice/cases/${c.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.message || data.error || 'Could not save changes.');
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit case details" wide onClose={onClose}
      footer={<>
        <button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="lx-btn lx-btn--primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}

      <div><label className="lbl">Title</label><input className="inp" value={f.title} onChange={set('title')} /></div>

      <div className="lx-row" style={{ gap: 14 }}>
        <div style={{ flex: 1 }}><label className="lbl">Court</label><input className="inp" value={f.court} onChange={set('court')} /></div>
        <div style={{ flex: 1 }}><label className="lbl">Case / CNR no.</label><input className="inp" value={f.case_no} onChange={set('case_no')} /></div>
      </div>

      <div className="lx-row" style={{ gap: 14 }}>
        <div style={{ flex: 1 }}><label className="lbl">Bench / Judge</label><input className="inp" value={f.judge} onChange={set('judge')} placeholder="e.g. Hon'ble Justice X" /></div>
        <div style={{ flex: 1 }}>
          <label className="lbl">Status</label>
          <select className="inp" value={f.status} onChange={set('status')} style={{ background: 'var(--bg-card)' }}>
            <option>Active</option>
            <option>Reserved</option>
            <option>Disposed</option>
            <option>Dismissed</option>
            <option>Settled</option>
            <option>Withdrawn</option>
            <option>Abated</option>
          </select>
        </div>
      </div>

      <div className="lx-row" style={{ gap: 14 }}>
        <div style={{ flex: 1 }}>
          <label className="lbl">Client {!c.client_id && <span className="lx-muted" style={{ fontWeight: 400, fontSize: 12 }}>— pick from your rolls, or type a new name</span>}</label>
          <input className="inp" value={f.client_name} onChange={set('client_name')}
                 placeholder={c.client_id ? '(linked client — change from Clients page)' : 'Start typing — matching clients will appear'}
                 disabled={!!c.client_id}
                 list="matter-client-roll" autoComplete="off" />
          <datalist id="matter-client-roll">
            {(f._clientRoll || []).map((cl) => <option key={cl.id} value={cl.name}>{[cl.phone, cl.email].filter(Boolean).join(' · ')}</option>)}
          </datalist>
        </div>
        <div style={{ flex: 1 }}><label className="lbl">Opposite party</label><input className="inp" value={f.opposite_party} onChange={set('opposite_party')} /></div>
      </div>

      <div>
        <label className="lbl">Case type</label>
        <div className="lx-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {['Civil', 'Criminal', 'Writ', 'Advisory', 'Consumer', 'Matrimonial', 'Arbitration'].map((t) => (
            <span key={t} className="chip" onClick={() => setF((s) => ({ ...s, case_type: t }))}
              style={f.case_type === t ? { background: 'var(--ink)', color: 'var(--paper)', cursor: 'pointer' } : { cursor: 'pointer' }}>{t}</span>
          ))}
        </div>
      </div>

      <div className="lx-row" style={{ gap: 14 }}>
        <div style={{ flex: 2 }}><label className="lbl">Next action</label><input className="inp" value={f.next_action} onChange={set('next_action')} placeholder="e.g. File rejoinder" /></div>
        <div style={{ flex: 1 }}><label className="lbl">Due date</label><input className="inp" type="date" value={f.next_action_due} onChange={set('next_action_due')} /></div>
      </div>

      <div><label className="lbl">Remarks</label><textarea className="inp" value={f.remarks} onChange={set('remarks')} style={{ minHeight: 80 }} placeholder="Private notes for the file" /></div>
    </Modal>
  );
}

/** Ask about this matter — chat with the AI using the case record as context. */
function AskAiModal({ caseData, hearings, parties, onClose }) {
  const c = caseData || {};
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `I've read the record for "${c.title || 'this matter'}" (${c.court || '—'}, ${c.case_no || '—'}). Ask me anything — I'll answer using the case details, hearings, parties and notes we have on file.`,
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Build a compact case context block the AI can read
  const buildContext = () => {
    const lines = [];
    lines.push(`CASE RECORD (do not fabricate anything beyond this):`);
    lines.push(`Title: ${c.title || '—'}`);
    lines.push(`Court: ${c.court || '—'}`);
    lines.push(`Case number: ${c.case_no || '—'}`);
    lines.push(`Type: ${c.case_type || '—'}`);
    lines.push(`Status: ${c.status || '—'}`);
    if (c.judge) lines.push(`Bench: ${c.judge}`);
    if (c.client_name) lines.push(`Client: ${c.client_name}`);
    if (c.opposite_party) lines.push(`Opposite party: ${c.opposite_party}`);
    if (c.advocate_name) lines.push(`Lead advocate: ${c.advocate_name}`);
    if (c.next_hearing) lines.push(`Next hearing: ${c.next_hearing}`);
    if (c.next_action) lines.push(`Next action: ${c.next_action}${c.next_action_due ? ' (due ' + c.next_action_due + ')' : ''}`);
    if (c.remarks) lines.push(`Remarks: ${c.remarks}`);
    if (Array.isArray(parties) && parties.length) {
      lines.push(`Parties:`);
      parties.forEach((p) => lines.push(`  - ${p.role || 'party'}: ${p.name}${p.contact ? ' (' + p.contact + ')' : ''}`));
    }
    if (Array.isArray(hearings) && hearings.length) {
      lines.push(`Hearings on record:`);
      hearings.slice(0, 10).forEach((h) => lines.push(`  - ${h.hearing_date || '—'}${h.hearing_time ? ' ' + h.hearing_time : ''}: ${h.purpose || h.note || 'hearing'} [${h.status || 'scheduled'}]`));
    }
    return lines.join('\n');
  };

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    const next = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    setBusy(true); setErr('');

    const context = buildContext();
    const prompt = `You are a careful Indian legal assistant. Answer the advocate's question using ONLY the case record below. If a fact isn't in the record, say "That isn't in the case record" — do not invent facts, hearings, parties, dates, or amounts.\n\n${context}\n\nAdvocate's question: ${q}`;

    try {
      const r = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ message: prompt }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.message || data.error || 'The AI did not respond.');
      const reply = data.reply || data.response || data.answer || data.text || 'No response.';
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Ask about "${c.title || 'this matter'}"`} wide onClose={onClose}
      footer={
        <div className="lx-row" style={{ gap: 10, width: '100%' }}>
          <input
            className="inp"
            style={{ flex: 1 }}
            placeholder="Ask a question about this matter…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            disabled={busy}
          />
          <button className="lx-btn lx-btn--primary" onClick={send} disabled={busy || !input.trim()}>
            {busy ? 'Thinking…' : 'Ask'}
          </button>
        </div>
      }>
      {err && <div role="alert" style={{ marginBottom: 10, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}

      <div className="lx-stack" style={{ gap: 12 }}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              background: msg.role === 'user' ? 'var(--accent-soft, var(--paper-2))' : 'var(--bg-card, var(--paper-2))',
              borderLeft: `3px solid ${msg.role === 'user' ? 'var(--accent-ink, #c99a4a)' : 'var(--ink-soft, #475569)'}`,
              fontSize: 14, lineHeight: 1.55, color: 'var(--ink)',
              whiteSpace: 'pre-wrap',
            }}
          >
            <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
              {msg.role === 'user' ? 'You' : 'AI'}
            </div>
            {msg.content}
          </div>
        ))}
        {busy && (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: '0 2px' }}>AI is reading the case…</div>
        )}
      </div>

      <p className="lx-muted" style={{ fontSize: 12, marginTop: 14, lineHeight: 1.5 }}>
        The AI reads only the case record above. It won't invent dates, facts or amounts. Verify everything before acting on it.
      </p>
    </Modal>
  );
}
