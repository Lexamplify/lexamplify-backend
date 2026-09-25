import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './organization.css';

// "Add an existing (incl. unassigned) matter to a team" — Home Gateway v4
// §7.2. Lists the firm's existing teams as selectable rows (with each
// team's current matter count, so the decision isn't blind) plus a
// "+ Create a new team instead" fallback that swaps to an inline name
// field, with a "‹ Back to existing teams" link to undo that choice.
export default function AssignTeamModal({ isOpen, matterId, matterTitle, teams = [], onClose, onAssign, onCreateTeam }) {
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [creatingNew, setCreatingNew] = useState(teams.length === 0);
  const [newTeamName, setNewTeamName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const modalBoxRef = useRef(null);
  const nameInputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setSelectedTeamId(null);
      setCreatingNew(teams.length === 0);
      setNewTeamName('');
      setError('');
      return;
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (creatingNew) {
      const t = setTimeout(() => nameInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [creatingNew]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (modalBoxRef.current && !modalBoxRef.current.contains(e.target)) onClose();
  };

  const handleSave = async () => {
    setError('');
    setSubmitting(true);
    try {
      let teamId = selectedTeamId;
      if (creatingNew) {
        const name = newTeamName.trim();
        if (!name) {
          setError('Name the team first.');
          setSubmitting(false);
          return;
        }
        const newTeam = await onCreateTeam(name);
        teamId = newTeam.id;
      } else if (!teamId) {
        setError('Pick a team, or create a new one.');
        setSubmitting(false);
        return;
      }
      await onAssign(teamId);
    } catch (err) {
      setError(err.message || 'Failed to assign this matter to a team.');
    } finally {
      setSubmitting(false);
    }
  };

  const modalContent = (
    <div className="modal-overlay active" onClick={handleBackdropClick} role="dialog" aria-modal="true" aria-labelledby="assign-team-title">
      <div className="modal-box" ref={modalBoxRef} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="assign-team-title" className="modal-title">
            {matterTitle ? `Add "${matterTitle}" to a team` : 'Add to a team'}
          </h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close modal">✕</button>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{ padding: '8px 12px', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: '6px', color: 'var(--accent)', fontSize: '12px', fontWeight: 500 }}>
              {error}
            </div>
          )}

          {!creatingNew && teams.length > 0 && (
            <div>
              {teams.map((t) => (
                <div
                  key={t.id}
                  className={`team-pick-row${selectedTeamId === t.id ? ' selected' : ''}`}
                  onClick={() => setSelectedTeamId(t.id)}
                >
                  <div className="team-pick-radio" />
                  <div>
                    <div className="team-pick-name">{t.name}</div>
                    <div className="team-pick-sub">{t.matterCount ?? ''} {t.matterCount === 1 ? 'matter' : 'matters'}</div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn-org btn-org-secondary"
                style={{ marginTop: '4px' }}
                onClick={() => setCreatingNew(true)}
              >
                + Create a new team instead
              </button>
            </div>
          )}

          {creatingNew && (
            <div className="form-group">
              {teams.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCreatingNew(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '11px', cursor: 'pointer', padding: 0, marginBottom: '6px', fontWeight: 600, alignSelf: 'flex-start' }}
                >
                  ‹ Back to existing teams
                </button>
              )}
              <label className="form-label" htmlFor="assignTeamNameInput">Team name</label>
              <input
                id="assignTeamNameInput"
                ref={nameInputRef}
                type="text"
                className="form-input"
                placeholder="e.g. Dispute Resolution"
                value={newTeamName}
                onChange={(e) => { setNewTeamName(e.target.value); if (error) setError(''); }}
              />
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-org btn-org-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-org btn-org-primary"
            disabled={submitting}
            style={{ background: 'var(--accent)', color: '#ffffff' }}
            onClick={handleSave}
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
