import { useEffect, useRef, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWorkspaceStore } from '../stores/useWorkspaceStore.js';
import { useAuth } from '../context/AuthContext.jsx';

/*
 * WorkspaceSwitcher — the dropdown in the topbar that picks the current
 * workspace. Replaces the firm-name crumb.
 *
 * Behaviour:
 *   * On mount, calls store.refresh() once per sign-in.
 *   * If the user has NO workspaces and the backend returned 200 (feature on),
 *     auto-create "{firm.name} — General" so the app is never in a null state.
 *   * Clicking an entry sets current + dispatches lx:workspace-changed.
 *   * "Create workspace…" opens an inline prompt (keeps the switcher simple;
 *     the full form lives on the /workspaces management page).
 *   * "Manage workspaces →" link navigates to /workspaces.
 *   * If the feature flag is off on the backend (store.enabled === false),
 *     the switcher renders as a plain, non-interactive firm crumb — exactly
 *     the pre-Phase-3 look.
 */

export default function WorkspaceSwitcher({ firmFallback }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    workspaces, currentWorkspaceId, enabled, loading, error,
    refresh, create, setCurrent,
  } = useWorkspaceStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [autoCreateTried, setAutoCreateTried] = useState(false);
  const rootRef = useRef(null);

  // Refresh on first sign-in.
  useEffect(() => {
    if (!user) return;
    refresh().catch(() => {});
  }, [user, refresh]);

  // If the backend says feature is on but we have zero workspaces, auto-create
  // one so the user never sees an empty state. Only tried once per session.
  useEffect(() => {
    if (!user || enabled !== true || autoCreateTried || workspaces.length > 0) return;
    setAutoCreateTried(true);
    const firm = user?.firm_name || user?.workspace_name || firmFallback || 'My Chambers';
    create({ name: `${firm} — General` }).catch(() => {});
  }, [user, enabled, workspaces.length, create, firmFallback, autoCreateTried]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = useMemo(
    () => workspaces.find((w) => w.id === currentWorkspaceId) || null,
    [workspaces, currentWorkspaceId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter((w) => (w.name || '').toLowerCase().includes(q));
  }, [workspaces, query]);

  // Backend has the feature flag off → render the plain crumb exactly as before.
  if (enabled === false) {
    return (
      <div className="topbar__crumb">
        <b>{firmFallback || 'Advocate Chambers'}</b>
      </div>
    );
  }

  const handleSelect = (id) => {
    setCurrent(id);
    setOpen(false);
    setQuery('');
  };

  const handleCreate = async (e) => {
    e?.preventDefault?.();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await create({ name });
      setNewName('');
      setOpen(false);
    } catch (err) {
      // Keep the prompt open so the user sees the error; store sets error state.
      // eslint-disable-next-line no-console
      console.error('workspace create failed', err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="ws-switcher" ref={rootRef}>
      <button
        type="button"
        className="ws-switcher__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="ws-switcher__label">
          <b>{current?.name || (loading ? 'Loading…' : 'Select client')}</b>
          <span className="ws-switcher__sub">
            {current?.client_type || 'Client workspace'} · {firmFallback || user?.firm_name || 'Chambers'}
          </span>
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="ws-switcher__menu" role="listbox">
          <div className="ws-switcher__search">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search clients…"
              autoFocus
            />
          </div>

          <div className="ws-switcher__list">
            {filtered.length === 0 && (
              <div className="ws-switcher__empty">
                {loading ? 'Loading…' : query ? 'No match.' : 'No clients yet.'}
              </div>
            )}
            {filtered.map((w) => (
              <button
                key={w.id}
                type="button"
                className={`ws-switcher__item ${w.id === currentWorkspaceId ? 'is-active' : ''}`}
                onClick={() => handleSelect(w.id)}
              >
                <span className="ws-switcher__name">{w.name}</span>
                {w.client_type && <span className="ws-switcher__meta">{w.client_type}</span>}
                {w.id === currentWorkspaceId && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          <div className="ws-switcher__divider" />

          {creating || newName ? (
            <form className="ws-switcher__create" onSubmit={handleCreate}>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New client name"
                disabled={creating}
                autoFocus
              />
              <button type="submit" disabled={creating || !newName.trim()}>Create</button>
              <button type="button" onClick={() => { setNewName(''); setCreating(false); }}>Cancel</button>
            </form>
          ) : (
            <button
              type="button"
              className="ws-switcher__footer-link"
              onClick={() => { setNewName(' '); setCreating(false); setTimeout(() => setNewName(''), 0); }}
            >
              + Add client
            </button>
          )}

          <Link
            to="/workspaces"
            className="ws-switcher__footer-link"
            onClick={() => setOpen(false)}
          >
            Manage clients →
          </Link>

          {error && (
            <div className="ws-switcher__error" role="alert">{error}</div>
          )}
        </div>
      )}
    </div>
  );
}
