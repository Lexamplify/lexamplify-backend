import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useOrgStore } from '../../store/useOrgStore';
import './organization.css';

export default function NewTeamModal({ isOpen, onClose, onTeamCreated }) {
  const createTeam = useOrgStore((state) => state.createTeam);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const inputRef = useRef(null);
  const modalBoxRef = useRef(null);

  // Focus on mount and handle Escape key
  useEffect(() => {
    if (!isOpen) {
      setName('');
      setDescription('');
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
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please enter a team name.');
      inputRef.current?.focus();
      return;
    }

    const newTeam = createTeam({
      name: trimmedName,
      description: description.trim(),
    });

    if (onTeamCreated) {
      onTeamCreated(newTeam);
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
      aria-labelledby="modal-team-title"
    >
      <div className="modal-box" ref={modalBoxRef} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="modal-team-title" className="modal-title">Create a new team</h2>
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
              <label className="form-label" htmlFor="teamNameInput">
                Team Name <span style={{ color: 'var(--accent)' }}>*</span>
              </label>
              <input
                id="teamNameInput"
                ref={inputRef}
                type="text"
                className="form-input"
                placeholder="e.g. Infrastructure & Project Finance"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError('');
                }}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="teamDescriptionInput">
                Description (Optional)
              </label>
              <input
                id="teamDescriptionInput"
                type="text"
                className="form-input"
                placeholder="e.g. Project financing, concession agreements, and public-private partnerships"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <span className="form-hint">
                A team is where practice groups collaborate on related matters, playbooks, and shared precedents.
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
            >
              Create team
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
