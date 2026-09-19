import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useChamberStore } from '../../stores/useChamberStore';
import './chamberRoster.css';

export default function MatterDossierCard({ matter }) {
  const navigate = useNavigate();
  const activeMatterId = useChamberStore((state) => state.activeMatterId);
  const setActiveMatter = useChamberStore((state) => state.setActiveMatter);

  const isCurrentActive = matter.id === activeMatterId;

  const handleCardClick = () => {
    const success = setActiveMatter(matter.id);
    if (success) {
      navigate('/dashboard');
    }
  };

  const handleAction = (e, targetPath, actionName) => {
    e.stopPropagation();
    setActiveMatter(matter.id, true);
    if (targetPath) {
      navigate(targetPath);
    } else {
      alert(`${actionName}: ${matter.title}`);
    }
  };

  // Determine urgency class
  const urgencyClass = matter.forum.urgency || 'normal';

  // Conflict status label & class
  const conflict = matter.integrity?.conflictStatus || 'clear';
  const conflictClass =
    conflict === 'clash_flagged' ? 'clash' : conflict === 'pending_audit' ? 'pending_audit' : 'clear';
  const conflictLabel =
    conflict === 'clash_flagged'
      ? '⚠ Conflict Clash'
      : conflict === 'pending_audit'
      ? '⏳ Audit Pending'
      : 'Shield Clear';

  return (
    <article
      className={`cr-dossier-card ${isCurrentActive ? 'active-matter' : ''}`}
      onClick={handleCardClick}
      tabIndex={0}
      role="button"
      aria-label={`Dossier: ${matter.title}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      }}
    >
      {/* ── COL 1: IDENTITY ──────────────────────────────────────────────── */}
      <div className="cr-dossier-id-col">
        <div className="cr-badge-row">
          <span className={`cr-archetype-tag ${matter.matterType}`}>
            {matter.matterType}
          </span>

          {matter.ecourtsSync?.cnrNumber && (
            <span className="cr-ecourts-indicator" title={`eCourts Synced: ${matter.ecourtsSync.cnrNumber}`}>
              <span className={`cr-pulse-dot ${matter.ecourtsSync.isListedToday ? 'synced' : ''}`} />
              {matter.ecourtsSync.cnrNumber}
            </span>
          )}

          {(matter.integrity?.wallEnforced || matter.isRestricted) && (
            <span className="cr-ecourts-indicator" title="Ethical Wall Active: Access Strictly Restricted">
              🔒 Wall
            </span>
          )}
        </div>

        <h3 className="cr-dossier-title">{matter.title}</h3>

        <div className="cr-dossier-forum" title={`${matter.forum.name} · ${matter.forum.benchOrVenue || ''}`}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <path d="m3 21 18 0" />
            <path d="M5 21V7l7-4 7 4v14" />
          </svg>
          <span>
            {matter.forum.name}
            {matter.forum.benchOrVenue ? ` · ${matter.forum.benchOrVenue}` : ''}
          </span>
        </div>
      </div>

      {/* ── COL 2: POSTURE & COUNSEL ─────────────────────────────────────── */}
      <div className="cr-dossier-posture-col">
        <div className="cr-stage-row">
          <span className="cr-stage-chip">{matter.forum.stage}</span>
          <span className={`cr-date-badge ${urgencyClass}`}>
            {matter.matterType === 'advisory' ? 'Target: ' : 'Listed: '}
            {matter.forum.nextDate}
          </span>
        </div>

        <div className="cr-counsel-line">
          <div>
            <strong>Lead:</strong> {matter.counsel.leadPartner}
          </div>
          <div>
            {matter.counsel.advocateOnRecord && (
              <>
                <strong>AoR:</strong> {matter.counsel.advocateOnRecord} ·{' '}
              </>
            )}
            <strong>Assoc:</strong> {matter.counsel.leadAssociate}
          </div>
        </div>
      </div>

      {/* ── COL 3: ACTIONS & TRUST ───────────────────────────────────────── */}
      <div className="cr-dossier-action-col">
        <span
          className={`cr-conflict-shield ${conflictClass}`}
          title={matter.integrity?.conflictDetail || conflictLabel}
        >
          {conflictLabel}
        </span>

        <div className="cr-dock-actions">
          <button
            type="button"
            className="cr-btn-dock"
            onClick={(e) => handleAction(e, '/vault', 'Case Vault')}
          >
            Vault
          </button>

          {matter.matterType === 'litigation' && (
            <button
              type="button"
              className="cr-btn-dock"
              onClick={(e) => handleAction(e, '/war-room', 'Virtual Courtroom')}
            >
              Courtroom
            </button>
          )}

          <button
            type="button"
            className="cr-btn-dock"
            onClick={(e) => handleAction(e, '/contract-analyzer', 'Contract Analyzer')}
          >
            Analyzer
          </button>
        </div>
      </div>
    </article>
  );
}
