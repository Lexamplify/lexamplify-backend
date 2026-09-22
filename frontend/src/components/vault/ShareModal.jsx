import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Link2, Check } from 'lucide-react';

const styles = `
  .vlt-share-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(10,10,10,.55); backdrop-filter: blur(2px); }
  .vlt-share-modal { background: var(--paper); border: 1px solid var(--rule); border-radius: 13px; box-shadow: 0 20px 50px rgba(0,0,0,.35); width: 100%; max-width: 420px; display: flex; flex-direction: column; max-height: 82vh; }
  .vlt-share-head { padding: 16px; border-bottom: 1px solid var(--rule); display: flex; justify-content: space-between; align-items: center; }
  .vlt-share-title { font-family: 'Fraunces', serif; font-style: italic; font-size: 16px; font-weight: 600; color: var(--ink); }
  .vlt-share-close { background: transparent; border: 0; color: var(--muted); cursor: pointer; padding: 4px; display: flex; }
  .vlt-share-close:hover { color: var(--ink); }
  .vlt-share-body { padding: 16px; overflow-y: auto; flex-grow: 1; display: flex; flex-direction: column; gap: 14px; }
  .vlt-share-search { width: 100%; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 8px; padding: 8px 10px; font-size: 13px; color: var(--ink); outline: none; }
  .vlt-share-search:focus { border-color: var(--accent); }
  .vlt-share-section-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
  .vlt-share-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 6px; border-radius: 8px; }
  .vlt-share-row:hover { background: var(--paper-2); }
  .vlt-share-person { display: flex; align-items: center; gap: 10px; min-width: 0; cursor: pointer; flex: 1; }
  .vlt-share-checkbox { width: 16px; height: 16px; flex-shrink: 0; accent-color: var(--accent); cursor: pointer; }
  .vlt-share-name-block { min-width: 0; }
  .vlt-share-name { font-size: 13px; font-weight: 500; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .vlt-share-email { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .vlt-share-unmatched { font-size: 10px; color: var(--accent); margin-top: 1px; }
  .vlt-share-perm { background: var(--paper-2); border: 1px solid var(--rule); color: var(--ink-soft); font-size: 11.5px; border-radius: 6px; padding: 4px 6px; outline: none; flex-shrink: 0; }
  .vlt-share-perm:focus { border-color: var(--accent); }
  .vlt-share-empty { font-size: 12.5px; color: var(--muted); padding: 12px 4px; text-align: center; }
  .vlt-share-link-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 9px; }
  .vlt-share-link-label { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink); }
  .vlt-share-toggle { position: relative; width: 34px; height: 19px; border-radius: 10px; background: var(--rule); border: 0; cursor: pointer; flex-shrink: 0; transition: background 0.15s ease; }
  .vlt-share-toggle.on { background: var(--accent); }
  .vlt-share-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%; background: #fff; transition: transform 0.15s ease; }
  .vlt-share-toggle.on::after { transform: translateX(15px); }
  .vlt-share-error { font-size: 12px; color: var(--accent); padding: 8px 4px; }
  .vlt-share-readonly-notice { font-size: 12.5px; color: var(--muted); padding: 16px 4px; text-align: center; }
  .vlt-share-foot { padding: 12px 16px; border-top: 1px solid var(--rule); display: flex; justify-content: flex-end; }
  .vlt-share-done-btn { padding: 7px 16px; font-size: 12.5px; font-weight: 500; border-radius: 8px; cursor: pointer; border: 1px solid var(--rule); background: transparent; color: var(--ink); }
  .vlt-share-done-btn:hover { background: var(--paper-2); }
  .vlt-share-saving { font-size: 10.5px; color: var(--muted); }
`;

// Real sharing, wired to app.py's Phase 2 /api/vault/shares* routes — no
// batch "Save Permissions" button. Every checkbox/dropdown/toggle here
// persists immediately, matching how the rest of the vault (rename, move,
// delete) already behaves. window.fetch is globally patched
// (utils/authFetch.js) to attach cookies + CSRF automatically, so these
// calls need nothing extra for auth.
export default function ShareModal({ isOpen, item, onClose }) {
  const [search, setSearch] = useState('');
  const [roster, setRoster] = useState([]);
  const [shares, setShares] = useState([]); // [{id, team_member_id, permission, member_name, member_email, member_matched}]
  const [linkShared, setLinkShared] = useState(false);
  const [readOnly, setReadOnly] = useState(false); // true if the viewer isn't the owner (403 from the API)
  const [error, setError] = useState(null);
  const [savingIds, setSavingIds] = useState(() => new Set());

  const nodeType = item?.type === 'folder' ? 'folder' : 'document';
  const nodeId = item?.id;

  const load = useCallback(async () => {
    if (!nodeId) return;
    setError(null);
    setReadOnly(false);
    try {
      const [rosterRes, sharesRes] = await Promise.all([
        fetch('/api/team/members'),
        fetch(`/api/vault/shares?node_type=${nodeType}&node_id=${nodeId}`),
      ]);
      if (sharesRes.status === 403) {
        setReadOnly(true);
        setShares([]);
        setRoster([]);
        return;
      }
      const rosterData = rosterRes.ok ? await rosterRes.json() : [];
      const sharesData = sharesRes.ok ? await sharesRes.json() : { shares: [], link_shared: false };
      setRoster(Array.isArray(rosterData) ? rosterData : []);
      setShares(sharesData.shares || []);
      setLinkShared(!!sharesData.link_shared);
    } catch (e) {
      setError(e.message || 'Failed to load sharing.');
    }
  }, [nodeType, nodeId]);

  useEffect(() => {
    if (isOpen && item) load();
  }, [isOpen, item, load]);

  if (!isOpen || !item) return null;

  const shareByMember = new Map(shares.map((s) => [s.team_member_id, s]));

  const withSaving = async (memberId, fn) => {
    setSavingIds((prev) => new Set(prev).add(memberId));
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message || 'Failed to update sharing.');
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(memberId);
        return next;
      });
    }
  };

  const grant = (member, permission) => withSaving(member.id, async () => {
    const res = await fetch('/api/vault/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_type: nodeType, node_id: nodeId, team_member_id: member.id, permission }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.message || 'Could not share with this person.');
    }
  });

  const revoke = (member) => withSaving(member.id, async () => {
    const existing = shareByMember.get(member.id);
    if (!existing) return;
    const res = await fetch(`/api/vault/shares/${existing.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.message || 'Could not remove access.');
    }
  });

  const toggleLink = async () => {
    setError(null);
    const next = !linkShared;
    setLinkShared(next); // optimistic — this toggle has no per-row state to desync
    try {
      const res = await fetch('/api/vault/shares/link', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_type: nodeType, node_id: nodeId, link_shared: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || 'Could not update link sharing.');
      }
    } catch (e) {
      setLinkShared(!next);
      setError(e.message || 'Could not update link sharing.');
    }
  };

  const filteredRoster = roster.filter((m) =>
    (m.name || '').toLowerCase().includes(search.toLowerCase())
    || (m.email || '').toLowerCase().includes(search.toLowerCase())
  );

  return createPortal(
    <div className="vlt-share-overlay" onClick={onClose}>
      <style>{styles}</style>
      <div className="vlt-share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vlt-share-head">
          <div className="vlt-share-title">Share "{item.name}"</div>
          <button className="vlt-share-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="vlt-share-body">
          {readOnly ? (
            <div className="vlt-share-readonly-notice">
              Only the owner of this {nodeType} can manage sharing.
            </div>
          ) : (
            <>
              <div className="vlt-share-link-row">
                <div className="vlt-share-link-label">
                  <Link2 size={14} />
                  Anyone with the link can view
                </div>
                <button
                  className={`vlt-share-toggle${linkShared ? ' on' : ''}`}
                  onClick={toggleLink}
                  aria-label="Toggle link sharing"
                />
              </div>

              <input
                type="text"
                placeholder="Search your firm's team..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="vlt-share-search"
              />

              <div>
                <div className="vlt-share-section-label">Team</div>
                {filteredRoster.length === 0 ? (
                  <div className="vlt-share-empty">
                    {roster.length === 0 ? 'No team members yet — add them from the Team screen first.' : 'No matches.'}
                  </div>
                ) : (
                  filteredRoster.map((member) => {
                    const existing = shareByMember.get(member.id);
                    const isShared = !!existing;
                    const isSaving = savingIds.has(member.id);
                    return (
                      <div className="vlt-share-row" key={member.id}>
                        <label className="vlt-share-person">
                          <input
                            type="checkbox"
                            className="vlt-share-checkbox"
                            checked={isShared}
                            disabled={isSaving}
                            onChange={() => (isShared ? revoke(member) : grant(member, 'view'))}
                          />
                          <div className="vlt-share-name-block">
                            <div className="vlt-share-name">{member.name || member.email || 'Unnamed'}</div>
                            {member.email && <div className="vlt-share-email">{member.email}</div>}
                            {!member.matched && (
                              <div className="vlt-share-unmatched">No linked account yet — access applies once they sign up</div>
                            )}
                          </div>
                        </label>
                        {isSaving ? (
                          <span className="vlt-share-saving">Saving…</span>
                        ) : isShared ? (
                          <select
                            className="vlt-share-perm"
                            value={existing.permission}
                            onChange={(e) => grant(member, e.target.value)}
                          >
                            <option value="view">Can view</option>
                            <option value="edit">Can edit</option>
                          </select>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>

              {error && <div className="vlt-share-error">{error}</div>}
            </>
          )}
        </div>

        <div className="vlt-share-foot">
          <button className="vlt-share-done-btn" onClick={onClose}>
            <Check size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
