import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import Modal from '../components/Modal.jsx';
import disputeCatalog from '../data/disputeCatalog.json';
import { searchDisputes } from '../utils/disputeDraft.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const FORM_TYPE_LABEL = {
  petition: 'Petition', application: 'Application', suit: 'Plaint',
  reply: 'Reply', notice: 'Notice', appeal: 'Appeal', complaint: 'Complaint',
};

// Saved firm-library documents live on the server (filed from the editor's
// "Save a copy", Legal Forms and Auto-Draft Studio). GET /api/firm-library/saved
// returns a plain JSON array of { id, title, category, timestamp, text, html }.
function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(String(ts).replace(' ', 'T'));
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function Library() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('internal'); // 'internal' | 'disputes' | 'external'
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState(null);

  // ── Dispute Library (bundled 112 Indian dispute types) ─────────────────
  const [disputeQuery, setDisputeQuery] = useState('');
  const [disputeCat, setDisputeCat] = useState('all');
  const disputes = disputeCatalog.disputes || [];
  const categories = disputeCatalog.categories || [];
  const disputeRows = useMemo(() => searchDisputes(disputes, disputeQuery, disputeCat), [disputes, disputeQuery, disputeCat]);
  const [openDispute, setOpenDispute] = useState(null);

  // ── External Case Law search (Pinecone-backed) ─────────────────────────
  const [extQuery, setExtQuery] = useState('');
  const [extBusy, setExtBusy] = useState(false);
  const [extErr, setExtErr] = useState('');
  const [extResults, setExtResults] = useState([]);

  async function runExternalSearch(e) {
    e?.preventDefault();
    if (extQuery.trim().length < 3 || extBusy) return;
    setExtBusy(true); setExtErr(''); setExtResults([]);
    try {
      const r = await fetch(`${API_BASE}/api/firm-library/external-search?query=${encodeURIComponent(extQuery.trim())}`, { credentials: 'include' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || (typeof d.error === 'string' ? d.error : 'External search failed.'));
      setExtResults(Array.isArray(d.results) ? d.results : []);
    } catch (e) { setExtErr(e.message); }
    finally { setExtBusy(false); }
  }

  function draftFromDispute(d) {
    navigate('/auto-draft', { state: { disputeId: d.id, dispute: d } });
  }

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/api/firm-library/saved`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status === 401 ? 'Your session has expired. Please sign in again.' : 'load');
      const data = await res.json();
      setDocs(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message === 'load' ? 'Could not load your library. Please try again.' : e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const term = q.trim().toLowerCase();
  const filtered = docs.filter((d) =>
    !term ||
    `${d.title || ''} ${d.category || ''} ${d.text || ''}`.toLowerCase().includes(term)
  );

  return (
    <div className="lx-page lx-rise">
      <div className="lx-between ph" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 18 }}>
        <div>
          <span className="ph__eyebrow">Firm knowledge</span>
          <h1 className="ph__title">Library</h1>
          <p className="ph__sub">Your chambers&apos; own saved documents and precedents — ready to draft from.</p>
        </div>
        {tab === 'internal' && (
          <div className="lx-field" style={{ height: 42, maxWidth: 260 }}>
            <Ic.Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search library…" style={{ fontSize: 14 }} />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 18 }}>
        <button className={tab === 'internal' ? 'is-on' : ''} onClick={() => setTab('internal')}>Your library</button>
        <button className={tab === 'disputes' ? 'is-on' : ''} onClick={() => setTab('disputes')}>Dispute types <span className="lx-muted" style={{ fontSize: 11.5 }}>· {disputes.length}</span></button>
        <button className={tab === 'external' ? 'is-on' : ''} onClick={() => setTab('external')}>External case law</button>
      </div>

      {tab === 'internal' && (
      <div className="lx-card lx-card--pad">
        {loading ? (
          <div className="lx-empty"><p>Loading your library…</p></div>
        ) : error ? (
          <div className="lx-empty">
            <div className="lx-empty__ico"><Ic.Library size={22} /></div>
            <h4>Couldn&apos;t load your library</h4><p>{error}</p>
            <button className="lx-btn lx-btn--sm" style={{ marginTop: 10 }} onClick={load}>Try again</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="lx-empty">
            <div className="lx-empty__ico"><Ic.Library size={22} /></div>
            <h4>{docs.length === 0 ? 'Your library is empty' : 'Nothing matches'}</h4>
            <p>{docs.length === 0
              ? 'Save a document from the drafting editor to keep it here as a precedent.'
              : 'No saved documents match your search.'}</p>
          </div>
        ) : (
          <div className="lx-list">
            {filtered.map((d) => (
              <div className="lx-item" key={d.id}>
                <div className="lx-item__ico" style={{ width: 34, height: 34 }}><Ic.Doc size={15} /></div>
                <div className="lx-item__body" style={{ flex: 1, minWidth: 0 }}>
                  <div className="lx-item__title" style={{ fontSize: 15 }}>{d.title || 'Untitled document'}</div>
                  <div className="lx-item__meta">{[d.category || 'Draft', fmtDate(d.timestamp)].filter(Boolean).join(' · ')}</div>
                </div>
                <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => setPreview(d)}>Preview</button>
                <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={() => navigate('/draft')}>Use</button>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* DISPUTE LIBRARY tab */}
      {tab === 'disputes' && (
        <>
          <div className="lx-row" style={{ gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <div className="lx-field" style={{ height: 42, flex: '1 1 260px', maxWidth: 420 }}>
              <Ic.Search size={15} />
              <input value={disputeQuery} onChange={(e) => setDisputeQuery(e.target.value)} placeholder="Search 112 dispute types — e.g. bail, cheque bounce, injunction…" style={{ fontSize: 14 }} />
            </div>
            <select value={disputeCat} onChange={(e) => setDisputeCat(e.target.value)}
              style={{ height: 42, padding: '0 12px', border: '1px solid var(--rule)', borderRadius: 10, background: 'var(--bg-card)', color: 'var(--ink)', fontSize: 13.5 }}>
              <option value="all">All categories ({disputes.length})</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>

          <div className="lx-card lx-card--pad">
            {disputeRows.length === 0 ? (
              <div className="lx-empty"><div className="lx-empty__ico"><Ic.Scale size={22} /></div><h4>No matching dispute</h4><p>Try a shorter search or pick another category.</p></div>
            ) : (
              <div className="lx-list">
                {disputeRows.slice(0, 60).map((d) => (
                  <div className="lx-item" key={d.id} onClick={() => setOpenDispute(d)} style={{ cursor: 'pointer' }}>
                    <div className="lx-item__ico" style={{ width: 34, height: 34 }}><Ic.Scale size={15} /></div>
                    <div className="lx-item__body" style={{ flex: 2, minWidth: 0 }}>
                      <div className="lx-item__title" style={{ fontSize: 15 }}>{d.title}</div>
                      <div className="lx-item__meta">{d.forum || '—'} · {FORM_TYPE_LABEL[d.kind] || d.kind} · limitation {d.limitation || '—'}</div>
                    </div>
                    <span className="lx-badge lx-badge--muted hide-sm">{(categories.find((c) => c.id === d.cat) || {}).label || d.cat}</span>
                    <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={(e) => { e.stopPropagation(); draftFromDispute(d); }}>
                      <Ic.Sparkle size={13} /> Draft this
                    </button>
                  </div>
                ))}
                {disputeRows.length > 60 && (
                  <div className="lx-item" style={{ cursor: 'default' }}>
                    <div className="lx-item__meta" style={{ margin: '0 auto' }}>Showing 60 of {disputeRows.length}. Refine your search to narrow down.</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* EXTERNAL case-law search */}
      {tab === 'external' && (
        <>
          <form className="lx-row" onSubmit={runExternalSearch} style={{ gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <div className="lx-field" style={{ height: 42, flex: '1 1 320px', maxWidth: 520 }}>
              <Ic.Search size={15} />
              <input value={extQuery} onChange={(e) => setExtQuery(e.target.value)} placeholder="Search external case law — e.g. mens rea Section 420…" style={{ fontSize: 14 }} />
            </div>
            <button type="submit" className="lx-btn lx-btn--gold lx-btn--sm" disabled={extQuery.trim().length < 3 || extBusy}>
              {extBusy ? 'Searching…' : 'Search case law'}
            </button>
          </form>
          <p className="lx-muted" style={{ fontSize: 12.5, marginTop: -6, marginBottom: 16 }}>
            Searches a Pinecone-backed index of public Indian judgments. No AI synthesis — raw matches with snippets.
          </p>

          <div className="lx-card lx-card--pad">
            {extErr ? (
              <div className="lx-empty"><div className="lx-empty__ico"><Ic.Shield size={22} /></div><h4>Search failed</h4><p>{extErr}</p></div>
            ) : extResults.length === 0 && !extBusy ? (
              <div className="lx-empty"><div className="lx-empty__ico"><Ic.Library size={22} /></div><h4>{extQuery.trim() ? 'No results' : 'Enter a query'}</h4><p>{extQuery.trim() ? 'Nothing matched. Try different keywords.' : 'Type at least 3 characters to search public case law.'}</p></div>
            ) : extBusy ? (
              <div className="lx-empty"><p>Searching external database…</p></div>
            ) : (
              <div className="lx-list">
                {extResults.map((r) => (
                  <div className="lx-item" key={r.id || r.case_id}>
                    <div className="lx-item__ico" style={{ width: 34, height: 34 }}><Ic.Scale size={15} /></div>
                    <div className="lx-item__body" style={{ flex: 2, minWidth: 0 }}>
                      <div className="lx-item__title" style={{ fontSize: 14.5 }}>{r.title || r.case_title || 'Untitled judgment'}</div>
                      <div className="lx-item__meta">{[r.citation, r.year, r.author].filter(Boolean).join(' · ')}</div>
                      {r.snippet && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.6 }}>{r.snippet}</div>}
                    </div>
                    {r.score != null && <span className="lx-badge lx-badge--muted hide-sm" title="Relevance score">{(r.score * 100).toFixed(0)}%</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Dispute detail modal */}
      {openDispute && (
        <Modal title={openDispute.title} onClose={() => setOpenDispute(null)} wide
          footer={<>
            <button className="lx-btn lx-btn--ghost" onClick={() => setOpenDispute(null)}>Close</button>
            <button className="lx-btn lx-btn--gold" onClick={() => { draftFromDispute(openDispute); setOpenDispute(null); }}>
              <Ic.Sparkle size={14} /> Draft this document
            </button>
          </>}>
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink)', marginBottom: 14 }}>{openDispute.blurb}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
            {[
              ['Document', openDispute.doc],
              ['Forum', openDispute.forum],
              ['Type', FORM_TYPE_LABEL[openDispute.kind] || openDispute.kind],
              ['Limitation', openDispute.limitation],
              ['Parties', (openDispute.parties || []).join(' / ')],
              ['Statutes', (openDispute.statutes || []).map((s) => (typeof s === 'string' ? s : (s?.label || s?.name || s?.section || s?.title || ''))).filter(Boolean).join(', ')],
            ].filter(([, v]) => v).map(([label, v]) => (
              <div key={label}>
                <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10, marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 13, color: 'var(--ink)' }}>{v}</div>
              </div>
            ))}
          </div>
          {(openDispute.grounds || []).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10, marginBottom: 8 }}>Grounds</div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                {openDispute.grounds.map((g, i) => <li key={i} style={{ marginBottom: 4 }}>{g}</li>)}
              </ul>
            </div>
          )}
          {(openDispute.prayers || []).length > 0 && (
            <div>
              <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10, marginBottom: 8 }}>Prayers</div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
                {openDispute.prayers.map((p, i) => <li key={i} style={{ marginBottom: 4 }}>{p}</li>)}
              </ul>
            </div>
          )}
        </Modal>
      )}

      {preview && (
        <Modal title={preview.title || 'Document'} onClose={() => setPreview(null)} wide
          footer={<><button className="lx-btn lx-btn--ghost" onClick={() => setPreview(null)}>Close</button><button className="lx-btn lx-btn--gold" onClick={() => navigate('/draft')}><Ic.Sparkle size={14} /> Use as template</button></>}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--rule)', borderRadius: 12, padding: '28px 32px', fontFamily: 'var(--font-serif)', lineHeight: 1.85, fontSize: 14, color: 'var(--ink)', maxHeight: '48vh', overflowY: 'auto' }}>
            {preview.text ? (
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{preview.text}</p>
            ) : preview.html ? (
              <div dangerouslySetInnerHTML={{ __html: preview.html }} />
            ) : (
              <p className="lx-muted" style={{ margin: 0 }}>No preview is available for this document.</p>
            )}
          </div>
          <div className="lx-muted" style={{ fontSize: 12.5 }}>
            {preview.category || 'Draft'} · saved {fmtDate(preview.timestamp)}
          </div>
        </Modal>
      )}
    </div>
  );
}
