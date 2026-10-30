import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useInRouterContext } from 'react-router-dom';
import './organization.css';

// UNASSIGNED (empty string in the <select>, null once submitted) is a
// real, first-class option now — Home Gateway v4: matter creation no
// longer forces a team. A lawyer working solo can create a matter with no
// team at all and assign one later from the matter's own page.
const UNASSIGNED_VALUE = '';

export default function NewMatterModal({ isOpen, teams = [], onClose, onOpenNewTeam, onCreate, onMatterCreated }) {
  const inRouter = useInRouterContext();
  const navigate = inRouter ? useNavigate() : () => {};

  const [title, setTitle] = useState('');
  const [teamId, setTeamId] = useState(UNASSIGNED_VALUE);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const inputRef = useRef(null);
  const modalBoxRef = useRef(null);

  // Focus on mount and handle Escape key
  useEffect(() => {
    if (!isOpen) {
      setTitle('');
      setError('');
      return;
    }

    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Please provide a matter title.');
      inputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const resolvedTeamId = teamId === UNASSIGNED_VALUE ? null : Number(teamId);
      const newMatter = await onCreate(trimmedTitle, resolvedTeamId);

      if (onMatterCreated) {
        onMatterCreated(newMatter);
      }

      onClose();

      if (newMatter && newMatter.id) {
        navigate(`/workspace/matter/${newMatter.id}`);
      }
    } catch (err) {
      setError(err.message || 'Failed to create the matter.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackdropClick = (e) => {
    if (modalBoxRef.current && !modalBoxRef.current.contains(e.target)) {
      onClose();
    }
  };

  const modalContent = (
    <div
      className="modal-overlay active"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-matter-title"
    >
      <div className="modal-box" ref={modalBoxRef} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="modal-matter-title" className="modal-title">Create a new matter</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div
                style={{
                  padding: '8px 12px',
                  background: 'var(--accent-soft)',
                  border: '1px solid var(--accent)',
                  borderRadius: '6px',
                  color: 'var(--accent)',
                  fontSize: '12px',
                  fontWeight: '500',
                }}
              >
                {error}
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="matterTitleInput">
                Matter Title <span style={{ color: 'var(--accent)' }}>*</span>
              </label>
              <input
                id="matterTitleInput"
                ref={inputRef}
                type="text"
                className="form-input"
                placeholder="e.g. Acme Corp v. Verma or A v. B"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (error) setError('');
                }}
                required
              />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label" htmlFor="matterTeamSelect">
                  Assigned Team
                </label>
                {onOpenNewTeam && (
                  <button
                    type="button"
                    onClick={onOpenNewTeam}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent)',
                      fontSize: '11px',
                      cursor: 'pointer',
                      padding: 0,
                      fontWeight: 600,
                    }}
                  >
                    + New Team
                  </button>
                )}
              </div>
              <select
                id="matterTeamSelect"
                className="form-select"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                <option value={UNASSIGNED_VALUE}>Not assigned yet</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              <span className="form-hint">
                {teamId === UNASSIGNED_VALUE
                  ? 'A matter can exist on its own — add a team any time from the matter\'s own page.'
                  : 'Files the matter into this team and selects it for you. Add client and fees any time from the matter.'}
              </span>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn-org btn-org-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-org btn-org-primary"
              disabled={submitting}
              style={{ background: 'var(--accent)', color: '#ffffff' }}
            >
              {submitting ? 'Creating…' : 'Create matter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
