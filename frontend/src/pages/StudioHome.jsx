import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { listTypes, listSessions, deleteSession, getFlag, setFlag } from '../services/draftApi.js';
import TemplateLibrary from '../components/studio/TemplateLibrary.jsx';
import '../styles/auto-draft-studio.css';

function ago(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

const STATUS_MAP = {
  draft: { label: 'In progress', color: 'var(--accent)' },
  final: { label: 'Finalised', color: 'var(--ok)' },
  filed: { label: 'Filed', color: 'var(--muted)' },
};

function StudioHome() {
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState('recent');
  const [search, setSearch] = useState('');
  const [types, setTypes] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [starred, setStarred] = useState(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [t, s, starredRaw] = await Promise.all([
          listTypes().catch(() => []),
          listSessions().catch(() => []),
          getFlag('starred_types').catch(() => null),
        ]);
        if (cancelled) return;
        setTypes(t);
        setSessions(s);
        if (Array.isArray(starredRaw)) setStarred(new Set(starredRaw));
        else if (typeof starredRaw === 'string') {
          try { setStarred(new Set(JSON.parse(starredRaw))); } catch { /* ignore */ }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Re-fetch sessions when the user navigates back to this page.
  useEffect(() => {
    let live = true;
    listSessions().then((s) => { if (live) setSessions(s); }).catch(() => {});
    return () => { live = false; };
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleStar = useCallback((typeId) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(typeId)) next.delete(typeId);
      else next.add(typeId);
      setFlag('starred_types', JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, []);

  const handleUseTemplate = useCallback((template) => {
    navigate(`/draft?type=${encodeURIComponent(template.id)}`);
  }, [navigate]);

  const handleOpenDraft = useCallback((session) => {
    navigate(`/draft/${session.id}`);
  }, [navigate]);

  const handleDeleteDraft = useCallback(async (e, sessionId) => {
    e.stopPropagation();
    if (!confirm('Delete this draft? This cannot be undone.')) return;
    try {
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch { /* ignore */ }
  }, []);

  const starredTypes = useMemo(
    () => (types || []).filter((t) => starred.has(t.id)),
    [types, starred]
  );

  const filteredSessions = useMemo(() => {
    if (!search) return sessions;
    const q = search.toLowerCase();
    return sessions.filter((s) =>
      (s.title || '').toLowerCase().includes(q) ||
      (s.type || '').toLowerCase().includes(q)
    );
  }, [sessions, search]);

  if (loading) {
    return (
      <div className="ads-home">
        <div className="ads-home__hero">
          <div>
            <div className="ads-skeleton" style={{ width: 260, height: 32, marginBottom: 8 }} />
            <div className="ads-skeleton" style={{ width: 180, height: 16 }} />
          </div>
          <div className="ads-skeleton" style={{ width: 160, height: 44, borderRadius: 10 }} />
        </div>
        <div className="ads-recent">
          {[1,2,3].map((i) => (
            <div key={i} className="ads-skeleton" style={{ height: 100, borderRadius: 12 }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="ads-home">
      {/* Hero */}
      <div className="ads-home__hero">
        <div>
          <h1 className="ads-home__greeting">Auto-Draft Studio</h1>
          <div className="ads-home__greeting-sub">Draft legal documents with AI assistance</div>
        </div>
        <button className="ads-home__new-btn" onClick={() => navigate('/draft')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Document
        </button>
      </div>

      {/* Search */}
      <div className="ads-search">
        <svg className="ads-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          className="ads-search__input"
          type="text"
          placeholder="Search drafts and templates…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Tabs */}
      <div className="ads-tabs">
        <button className={`ads-tab${tab === 'recent' ? ' active' : ''}`} onClick={() => setTab('recent')}>
          Recent Drafts
          {sessions.length > 0 && <span className="ads-tab__count">{sessions.length}</span>}
        </button>
        <button className={`ads-tab${tab === 'templates' ? ' active' : ''}`} onClick={() => setTab('templates')}>
          Templates
          <span className="ads-tab__count">{types.length}</span>
        </button>
        <button className={`ads-tab${tab === 'starred' ? ' active' : ''}`} onClick={() => setTab('starred')}>
          Starred
          {starred.size > 0 && <span className="ads-tab__count">{starred.size}</span>}
        </button>
      </div>

      {/* Recent Drafts */}
      {tab === 'recent' && (
        filteredSessions.length === 0 ? (
          <div className="ads-empty">
            <div className="ads-empty__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
              </svg>
            </div>
            <div className="ads-empty__title">No drafts yet</div>
            <div className="ads-empty__desc">Start by picking a template below.</div>
          </div>
        ) : (
          <div className="ads-recent">
            {filteredSessions.map((s) => {
              const st = STATUS_MAP[s.status] || STATUS_MAP.draft;
              return (
                <div key={s.id} className="ads-draft-card" onClick={() => handleOpenDraft(s)}>
                  <div className="ads-draft-card__title">{s.title || 'Untitled Draft'}</div>
                  {s.type && <div className="ads-draft-card__type">{s.type.replace(/_/g, ' ')}</div>}
                  <div className="ads-draft-card__meta">
                    <span className="ads-draft-card__status">
                      <span className="ads-draft-card__status-dot" style={{ background: st.color }} />
                      {st.label}
                    </span>
                    <span>{ago(s.updated_at || s.created_at)}</span>
                    <button
                      className="ads-draft-card__delete"
                      onClick={(e) => handleDeleteDraft(e, s.id)}
                      title="Delete draft"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Templates */}
      {tab === 'templates' && (
        <TemplateLibrary
          types={types}
          starred={starred}
          onStar={toggleStar}
          onUse={handleUseTemplate}
          search={search}
        />
      )}

      {/* Starred */}
      {tab === 'starred' && (
        starredTypes.length === 0 ? (
          <div className="ads-empty">
            <div className="ads-empty__icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
            <div className="ads-empty__title">No starred templates</div>
            <div className="ads-empty__desc">Star your favourite templates for quick access.</div>
          </div>
        ) : (
          <TemplateLibrary
            types={starredTypes}
            starred={starred}
            onStar={toggleStar}
            onUse={handleUseTemplate}
            search={search}
          />
        )
      )}
    </div>
  );
}

export default StudioHome;
