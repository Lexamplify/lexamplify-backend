import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import { useDocStore } from '../collab/useDocStore.js';
import { getIdentity } from '../collab/identity.js';
import ShareToCaseModal from '../components/collab/ShareToCaseModal.jsx';

// Pull a plain-text label out of whatever shape the dispute-catalog entry uses.
// Catalog entries can be strings OR objects with { label | text | fact | title | summary | stmt | ... }.
function strOf(x) {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (typeof x === 'object') return x.label || x.text || x.fact || x.stmt || x.title || x.summary || x.name || x.ground || x.prayer || '';
  return String(x);
}

// Build an HTML skeleton of the dispute (title, grounds, prayers, verification)
// to seed the WordCraft editor when the user starts a draft from the Firm
// Library's dispute catalog.
function buildDisputeSkeletonHtml(d) {
  if (!d) return '';
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Chunk 2 — any "[Insert …]" / "[place]" / "[date]" placeholder in the
  // skeleton becomes a visible "needs your attention" chip (same styling and
  // data-field hook that the editor's attention counter looks for).
  const ATTN = "background:#fff3cd;color:#8a5a00;border:1px dashed #c38a00;border-radius:4px;padding:1px 6px;font-weight:600;cursor:pointer;";
  const chip = (txt) => {
    const inner = esc(txt).replace(/^\[|\]$/g, '').trim();
    return `<mark class="lx-attn" data-field="${inner}" style="${ATTN}" title="Click to fill in">[${inner}]</mark>`;
  };
  const withChips = (html) => html.replace(/\[[^\[\]]{1,80}\]/g, (m) => chip(m));
  const li = (arr) => (arr || []).map((x) => `<li>${withChips(esc(strOf(x)))}</li>`).filter((s) => s !== '<li></li>').join('');
  const parts = [];
  parts.push(`<h1>${esc(d.doc || d.title || 'DRAFT')}</h1>`);
  if (d.forum) parts.push(`<p><b>Before:</b> ${esc(d.forum)}</p>`);
  if ((d.parties || []).length) parts.push(`<p><b>Parties:</b> ${(d.parties || []).map(esc).join(' / ')}</p>`);
  if (d.blurb) parts.push(`<p><i>${esc(d.blurb)}</i></p>`);
  if ((d.facts || []).length) {
    parts.push(`<h2>FACTS</h2><ol>${li(d.facts)}</ol>`);
  } else {
    parts.push(`<h2>FACTS</h2><p>${withChips('[Insert the material facts of the case here.]')}</p>`);
  }
  if ((d.grounds || []).length) parts.push(`<h2>GROUNDS</h2><ol>${li(d.grounds)}</ol>`);
  if ((d.prayers || []).length) parts.push(`<h2>PRAYERS</h2><ol>${li(d.prayers)}</ol>`);
  if (d.verification) parts.push(`<h2>VERIFICATION</h2><p>${withChips(esc(d.verification))}</p>`);
  else parts.push(`<h2>VERIFICATION</h2><p>Verified at ${chip('place')} on ${chip('date')} that the contents of paragraphs __ to __ are true to my personal knowledge and the contents of paragraphs __ to __ are based on information believed to be true.</p>`);
  if ((d.cautions || []).length) parts.push(`<h2>NOTES &amp; CAUTIONS</h2><ul>${li(d.cautions)}</ul>`);
  return parts.join('\n');
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function ago(iso) {
  if (!iso) return '';
  const t = new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}

export default function Draft() {
  const navigate = useNavigate();
  const location = useLocation();
  // When the Firm Library's Dispute catalog hands us a dispute via nav state,
  // seed the title and remember the dispute so we can forward it into the
  // new session on create.
  const seedDispute = location.state?.dispute || null;

  const [types, setTypes] = useState([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [typesError, setTypesError] = useState('');

  const [sessions, setSessions] = useState([]);
  const [sessLoading, setSessLoading] = useState(true);
  const [sessError, setSessError] = useState('');

  const [tpl, setTpl] = useState('');
  const [title, setTitle] = useState(seedDispute?.title || '');
  // Collab plan phase 5: per-row Share-to-case modal state.
  const [shareFor, setShareFor] = useState(null); // { id, title }
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');

  // Prefill once when the location state arrives.
  useEffect(() => {
    if (seedDispute?.title && !title) setTitle(seedDispute.title);
  }, [seedDispute?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTypes = useCallback(async () => {
    setTypesLoading(true); setTypesError('');
    try {
      const res = await fetch(`${API_BASE}/api/drafts/types`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status === 401 ? 'Your session has expired. Please sign in again.' : 'load');
      const data = await res.json();
      const list = Array.isArray(data.types) ? data.types : [];
      setTypes(list);
      setTpl((cur) => cur || (list[0] ? list[0].id : ''));
    } catch (e) {
      setTypesError(e.message === 'load' ? 'Could not load document types. Please try again.' : e.message);
    } finally {
      setTypesLoading(false);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setSessLoading(true); setSessError('');
    try {
      const res = await fetch(`${API_BASE}/api/drafts/sessions`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status === 401 ? 'Your session has expired. Please sign in again.' : 'load');
      const data = await res.json();
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (e) {
      setSessError(e.message === 'load' ? 'Could not load your recent drafts. Please try again.' : e.message);
    } finally {
      setSessLoading(false);
    }
  }, []);

  // Workspace prefill — fetch the active client's party-A fields once
  // on mount so every new draft starts with 'our client's' name/address/
  // email/phone pre-filled. Workspace-change triggers a re-fetch via the
  // storage event listener below. Returns {} when no workspace active.
  const [wsPrefill, setWsPrefill] = useState({});
  const [wsClientName, setWsClientName] = useState('');
  const loadWsPrefill = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/drafts/workspace-prefill`, { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      setWsPrefill(d.prefill || {});
      setWsClientName(d.client_name || '');
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadTypes(); loadSessions(); loadWsPrefill(); }, [loadTypes, loadSessions, loadWsPrefill]);

  // Chunk 3 — section include/exclude checklist. When a type is selected,
  // fetch what sections that template will contain so the lawyer can see
  // the shape of the output up front and uncheck sections they don't want.
  // Required sections (cover, prayer, verification, signature) are always
  // on and the checkbox for them is disabled. Excluded ids are passed on
  // startDraft as facts._excluded_sections — the backend render() drops
  // every block in those sections.
  const [sections, setSections] = useState([]);
  const [excludedSections, setExcludedSections] = useState({});
  useEffect(() => {
    if (!tpl) { setSections([]); return; }
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/drafts/types/${encodeURIComponent(tpl)}/sections`, { credentials: 'include' });
        if (!r.ok) { setSections([]); return; }
        const d = await r.json();
        setSections(Array.isArray(d.sections) ? d.sections : []);
        setExcludedSections({}); // reset when template changes
      } catch { setSections([]); }
    })();
  }, [tpl]);
  // Re-fetch prefill when workspace changes elsewhere in the app
  // (useWorkspaceStore writes 'active_lex_workspace' to localStorage).
  useEffect(() => {
    const onStorage = (e) => { if (e.key && /workspace/i.test(e.key)) loadWsPrefill(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [loadWsPrefill]);

  const selected = types.find((t) => t.id === tpl) || null;

  async function startDraft() {
    if (!tpl || starting) return;
    setStarting(true); setStartError('');
    try {
      const res = await fetch(`${API_BASE}/api/drafts/sessions`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        // Seed the new draft's facts with the active workspace's client
        // details (name/address/email/phone). The lawyer never re-types
        // their own client's identity. These are DEFAULTS — once the
        // draft is open, editing a field in the form overrides them.
        body: JSON.stringify({
          type: tpl,
          facts: {
            ...wsPrefill,
            // Chunk 3 — any sections the lawyer unchecked are passed so
            // render() skips every block under those headings.
            _excluded_sections: Object.keys(excludedSections).filter((k) => excludedSections[k]),
          },
          title: (title.trim() || selected?.short || undefined),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 401 ? 'Your session has expired. Please sign in again.' : (data.message || data.error || 'Could not start the draft.'));
      const id = data.id ?? data.session?.id;
      if (!id) throw new Error('Could not start the draft.');
      // If the Firm Library handed us a dispute, seed the local docStore with a
      // skeleton (title / facts / grounds / prayers / verification) so the
      // WordCraft editor opens pre-filled instead of empty.
      if (seedDispute) {
        try {
          const seedHtml = buildDisputeSkeletonHtml(seedDispute);
          const me = getIdentity();
          useDocStore.setState((s) => ({
            docs: {
              ...s.docs,
              [id]: {
                id: String(id),
                title: title.trim() || seedDispute.title || 'Draft',
                matter: seedDispute.forum || '',
                type: seedDispute.doc || 'Document',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                ownerId: me.id,
                members: [{ id: me.id, name: me.name, email: 'you@chambers.in', role: 'owner' }],
                linkRole: 'viewer',
                seedHtml,
              },
            },
          }));
        } catch { /* seed is best-effort — ignore and open the empty editor */ }
      }
      navigate('/draft/' + id);
    } catch (e) {
      setStartError(e.message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="lx-page lx-rise" style={{ maxWidth: 1200 }}>
      <div className="ph">
        <span className="ph__eyebrow">Auto-Draft Studio</span>
        <h1 className="ph__title">Draft</h1>
        <p className="ph__sub">Pick a document type and Lexamplify guides you to a court-ready draft, grounded in Indian law and correct in form. Pick up a recent draft on the right.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.1fr)', gap: 24, alignItems: 'start' }} className="draft-grid">
        {/* Start a new draft — real document types */}
        <div className="lx-card lx-card--pad lx-stack" style={{ gap: 20 }}>
          {seedDispute && (
            <div style={{ padding: '12px 14px', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 12 }}>
              <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10, marginBottom: 4, color: 'var(--accent-ink)' }}>From Firm Library</div>
              <div style={{ fontSize: 13.5, color: 'var(--ink)' }}>Starting a draft for <b>{seedDispute.title}</b>{seedDispute.forum ? ` — ${seedDispute.forum}` : ''}.</div>
              {seedDispute.doc && <div className="lx-muted" style={{ fontSize: 12, marginTop: 4 }}>{seedDispute.doc}</div>}
            </div>
          )}
          <div>
            <div className="lx-muted" style={{ fontWeight: 600, marginBottom: 10, color: 'var(--ink)' }}>Document type</div>
            {typesLoading ? (
              <div className="lx-empty" style={{ padding: '18px 0' }}><p>Loading document types…</p></div>
            ) : typesError ? (
              <div className="lx-empty" style={{ padding: '18px 0' }}>
                <p>{typesError}</p>
                <button className="lx-btn lx-btn--sm" style={{ marginTop: 10 }} onClick={loadTypes}>Try again</button>
              </div>
            ) : types.length === 0 ? (
              <div className="lx-empty" style={{ padding: '18px 0' }}><p>No document types are available yet.</p></div>
            ) : (
              <div className="lx-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {types.map((t) => (
                  <button key={t.id} onClick={() => setTpl(t.id)} className="lx-btn lx-btn--sm"
                    style={tpl === t.id ? { background: 'var(--accent)', color: 'var(--on-accent)' } : { background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--rule)' }}>{t.short || t.id}</button>
                ))}
              </div>
            )}
          </div>

          {selected && (
            <div className="lx-muted" style={{ fontSize: 13 }}>
              {typeof selected.required_count === 'number' ? `${selected.required_count} detail${selected.required_count === 1 ? '' : 's'} needed` : 'A few details needed'}
              {selected.minutes ? ` · about ${selected.minutes} min` : ''}
            </div>
          )}

          {selected && sections.filter((s) => !s.required).length > 0 && (
            <div style={{ border: '1px solid var(--rule)', borderRadius: 12, padding: '12px 14px', background: 'var(--bg-card)' }}>
              <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 8, fontSize: 13 }}>
                What this draft will contain
                <span className="lx-muted" style={{ fontWeight: 400, marginLeft: 6 }}>— untick what you don't need</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sections.map((s) => (
                  <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: 'var(--ink)', cursor: s.required ? 'default' : 'pointer', opacity: s.required ? 0.75 : 1 }}>
                    <input
                      type="checkbox"
                      checked={!excludedSections[s.id]}
                      disabled={s.required}
                      onChange={(e) => setExcludedSections((prev) => ({ ...prev, [s.id]: !e.target.checked }))}
                    />
                    <span style={{ flex: 1 }}>{s.title}</span>
                    {s.required && <span className="lx-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>required</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="lx-muted" style={{ fontWeight: 600, marginBottom: 10, color: 'var(--ink)' }}>Name this draft <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— optional</span></div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={selected ? `e.g. ${selected.short}` : 'Give this draft a name'}
              style={{ width: '100%', height: 46, border: '1px solid var(--rule)', borderRadius: 12, padding: '0 16px', fontFamily: 'var(--font-sans)', fontSize: 14.5, color: 'var(--ink)', background: 'var(--bg-card)', outline: 'none' }}
            />
          </div>

          {startError && <div role="alert" style={{ color: 'var(--risk)', fontSize: 13 }}>{startError}</div>}

          <button className="lx-btn lx-btn--primary" style={{ width: '100%', height: 48 }} onClick={startDraft} disabled={!tpl || starting}>
            <Ic.Sparkle size={16} /> {starting ? 'Starting…' : 'Start drafting'}
          </button>
          <div className="lx-muted" style={{ textAlign: 'center' }}>Every authority cited is verifiable · Nothing is invented</div>
        </div>

        {/* Continue drafting — real recent sessions */}
        <div className="lx-card" style={{ overflow: 'hidden' }}>
          <div className="lx-between" style={{ padding: '14px 20px', borderBottom: '1px solid var(--rule)', background: 'var(--paper-2)' }}>
            <span className="lx-badge"><Ic.Doc size={13} /> Continue drafting</span>
            <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={loadSessions} disabled={sessLoading}><Ic.Draft size={14} /> Refresh</button>
          </div>
          <div style={{ padding: '10px 16px', background: 'var(--bg-card)' }}>
            {sessLoading ? (
              <div className="lx-empty"><p>Loading your recent drafts…</p></div>
            ) : sessError ? (
              <div className="lx-empty">
                <div className="lx-empty__ico"><Ic.Draft size={22} /></div>
                <h4>Couldn’t load drafts</h4><p>{sessError}</p>
                <button className="lx-btn lx-btn--sm" style={{ marginTop: 10 }} onClick={loadSessions}>Try again</button>
              </div>
            ) : sessions.length === 0 ? (
              <div className="lx-empty">
                <div className="lx-empty__ico"><Ic.Draft size={22} /></div>
                <h4>No drafts yet</h4>
                <p>Choose a document type on the left to begin your first draft.</p>
              </div>
            ) : (
              <div className="lx-list">
                {sessions.map((s) => (
                  <div className="lx-item" key={s.id} onClick={() => navigate('/draft/' + s.id)} style={{ padding: '16px 4px' }}>
                    <div className="lx-item__ico"><Ic.Doc size={18} /></div>
                    <div className="lx-item__body" style={{ flex: 2 }}>
                      <div className="lx-item__title">{s.title || 'Untitled draft'}</div>
                      <div className="lx-item__meta">{s.updated_at ? `Edited ${ago(s.updated_at)}` : (s.type || '—')}</div>
                    </div>
                    <span className={`lx-badge lx-badge--${s.status === 'done' ? 'ok' : 'warn'}`} style={{ minWidth: 86, justifyContent: 'center' }}>
                      {s.status === 'done' ? 'Finalised' : 'In progress'}
                    </span>
                    {/* Collab plan phase 5: inline Share-to-case button. */}
                    <button
                      type="button"
                      className="lx-btn lx-btn--ghost lx-btn--sm"
                      onClick={(e) => { e.stopPropagation(); setShareFor({ id: s.id, title: s.title || 'Untitled draft' }); }}
                      title="Share this draft with teammates on a case"
                      style={{ marginLeft: 8 }}
                    >
                      Share
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {shareFor && (
        <ShareToCaseModal
          resource={{ type: 'draft_session', id: shareFor.id, name: shareFor.title }}
          onClose={() => setShareFor(null)}
          onShared={() => setShareFor(null)}
        />
      )}
    </div>
  );
}
