import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useOrgStore } from '../../store/useOrgStore';
import './organization.css';

export default function NewMatterModal({ isOpen, onClose, onOpenNewTeam, onMatterCreated }) {
  const teams = useOrgStore((state) => state.teams);
  const createMatter = useOrgStore((state) => state.createMatter);

  const [title, setTitle] = useState('');
  const [teamId, setTeamId] = useState(teams[0]?.id || 'team_dispute');
  const [isPrivate, setIsPrivate] = useState(false);
  const [leadCounsel, setLeadCounsel] = useState('Narendar V');
  const [error, setError] = useState('');

  const inputRef = useRef(null);
  const modalBoxRef = useRef(null);

  // Sync default teamId when teams list changes
  useEffect(() => {
    if (teams.length > 0 && !teams.some((t) => t.id === teamId)) {
      setTeamId(teams[0].id);
    }
  }, [teams, teamId]);

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

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Please provide a matter title.');
      inputRef.current?.focus();
      return;
    }

    const newMatter = createMatter({
      title: trimmedTitle,
      teamId,
      isPrivate: isPrivate || teamId === 'team_private',
      leadCounsel: leadCounsel.trim() || 'Narendar V',
    });

    if (onMatterCreated) {
      onMatterCreated(newMatter);
    }

    onClose();
  };

  const handleBackdropClick = (e) => {
    if (modalBoxRef.current && !modalBoxRef.current.contains(e.target)) {
      onClose();
    }
  };

  const modalContent = (
    <div
      className="modal-overlay"
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
                placeholder="e.g. Acme Corp v. Union of India"
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
                  Assigned Practice Group (Team)
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
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              <span className="form-hint">
                Files this matter into the selected team workspace and enforces ethical walls.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="matterLeadCounselInput">
                Lead Counsel
              </label>
              <input
                id="matterLeadCounselInput"
                type="text"
                className="form-input"
                placeholder="e.g. Narendar V"
                value={leadCounsel}
                onChange={(e) => setLeadCounsel(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
              <input
                id="matterPrivateCheckbox"
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
              <label
                htmlFor="matterPrivateCheckbox"
                style={{ fontSize: '12px', color: 'var(--ink-soft)', cursor: 'pointer', userSelect: 'none' }}
              >
                Mark as Restricted (Private Space only)
              </label>
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
            >
              Create matter
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
