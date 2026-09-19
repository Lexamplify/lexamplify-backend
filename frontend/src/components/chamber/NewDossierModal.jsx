import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useChamberStore } from '../../stores/useChamberStore';
import './chamberRoster.css';

export default function NewDossierModal({ isOpen, onClose, onDossierCreated }) {
  const activeBench = useChamberStore((state) => state.activeBench);
  const addMatter = useChamberStore((state) => state.addMatter);

  const [currentStep, setCurrentStep] = useState(1);
  const [error, setError] = useState('');

  // Step 1: Classification
  const [archetype, setArchetype] = useState('litigation');
  const [teamName, setTeamName] = useState(activeBench || 'Commercial Appellate Bench');

  // Step 2: Dynamic fields
  const [title, setTitle] = useState('');
  // Litigation fields
  const [courtName, setCourtName] = useState('');
  const [stageAndItem, setStageAndItem] = useState('');
  const [cnrNumber, setCnrNumber] = useState('');
  // Arbitration fields
  const [arbitralInstitution, setArbitralInstitution] = useState('');
  const [seatAndArbitrator, setSeatAndArbitrator] = useState('');
  // Advisory fields
  const [counterparties, setCounterparties] = useState('');
  const [targetClosingDate, setTargetClosingDate] = useState('');
  const [playbook, setPlaybook] = useState('');

  // Step 3: Governance & Walls
  const [leadPartner, setLeadPartner] = useState('Dr. A. M. Singhvi, Sr. Adv.');
  const [aor, setAor] = useState('K. Parameshwar, AoR');
  const [leadAssociate, setLeadAssociate] = useState('Narendar V');
  const [wallEnforced, setWallEnforced] = useState(false);

  const modalBoxRef = useRef(null);
  const titleInputRef = useRef(null);

  // Reset state on open/close
  useEffect(() => {
    if (!isOpen) {
      setCurrentStep(1);
      setError('');
      setTitle('');
      setCourtName('');
      setStageAndItem('');
      setCnrNumber('');
      setArbitralInstitution('');
      setSeatAndArbitrator('');
      setCounterparties('');
      setTargetClosingDate('');
      setPlaybook('');
      setWallEnforced(false);
      return;
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Focus title input when moving to Step 2
  useEffect(() => {
    if (isOpen && currentStep === 2) {
      const timer = setTimeout(() => {
        titleInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, currentStep]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (modalBoxRef.current && !modalBoxRef.current.contains(e.target)) {
      onClose();
    }
  };

  const goToNextStep = (e) => {
    if (e) e.preventDefault();
    if (currentStep === 1) {
      setCurrentStep(2);
      setError('');
    } else if (currentStep === 2) {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        setError('Please provide a matter title or case caption.');
        titleInputRef.current?.focus();
        return;
      }
      setError('');
      setCurrentStep(3);
    } else if (currentStep === 3) {
      handleFinalSubmit();
    }
  };

  const goToPrevStep = () => {
    if (currentStep > 1) {
      setError('');
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleFinalSubmit = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setCurrentStep(2);
      setError('Please provide a matter title or case caption.');
      return;
    }

    const idSuffix = Date.now().toString().slice(-4);
    const newId = `mat_in_2026_${idSuffix}`;

    let forumData = {};
    let ecourtsData = undefined;

    if (archetype === 'litigation') {
      forumData = {
        name: courtName.trim() || 'Supreme Court of India',
        benchOrVenue: stageAndItem.trim() || 'Court 3, Item 14',
        stage: stageAndItem.trim() || 'Admission Hearing',
        nextDate: '28 Sep 2026',
        urgency: 'critical',
      };
      if (cnrNumber.trim()) {
        ecourtsData = {
          cnrNumber: cnrNumber.trim(),
          isListedToday: true,
          syncedAt: new Date().toISOString(),
        };
      }
    } else if (archetype === 'arbitration') {
      forumData = {
        name: arbitralInstitution.trim() || 'Arbitral Tribunal (MCIA)',
        benchOrVenue: seatAndArbitrator.trim() || 'New Delhi Seat · Sole Arbitrator',
        stage: 'Statement of Claim',
        nextDate: '10 Oct 2026',
        urgency: 'normal',
      };
    } else {
      // advisory
      forumData = {
        name: 'Corporate Advisory',
        benchOrVenue: counterparties.trim() || 'Closing Target',
        stage: playbook.trim() || 'Due Diligence & Playbook Audit',
        nextDate: targetClosingDate.trim() || '20 Oct 2026',
        urgency: 'caution',
      };
    }

    const newDossier = {
      id: newId,
      title: trimmedTitle,
      matterType: archetype,
      status: 'open',
      teamId: `team_${archetype}`,
      teamName: teamName || activeBench,
      isPrivateChamber: teamName?.includes('Private'),
      isRestricted: wallEnforced,
      counsel: {
        leadPartner: leadPartner.trim() || 'Dr. A. M. Singhvi, Sr. Adv.',
        advocateOnRecord: archetype === 'litigation' && aor.trim() ? aor.trim() : undefined,
        leadAssociate: leadAssociate.trim() || 'Narendar V',
      },
      forum: forumData,
      ecourtsSync: ecourtsData,
      integrity: {
        conflictStatus: 'clear',
        conflictDetail: wallEnforced ? 'Ethical wall shielding enabled' : 'Chamber conflict check clear',
        wallEnforced: wallEnforced,
      },
      telemetry: {
        vaultDocuments: 1,
        flaggedRisks: 0,
        simulationsRun: 0,
      },
      lastAccessedAt: new Date().toISOString(),
    };

    addMatter(newDossier);

    if (onDossierCreated) {
      onDossierCreated(newDossier);
    }

    onClose();
  };

  const modalContent = (
    <div
      className="cr-modal-overlay active"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cr-modal-title"
    >
      <div className="cr-modal-box" ref={modalBoxRef} onClick={(e) => e.stopPropagation()}>
        <div className="cr-modal-header">
          <h2 id="cr-modal-title" style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontSize: '20px', color: 'var(--ink)' }}>
            Open New Case Dossier
          </h2>
          <button
            type="button"
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '18px' }}
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Stepper Header */}
        <div className="cr-stepper">
          <span className={`cr-step-pill ${currentStep === 1 ? 'active' : ''}`}>
            1. Classification
          </span>
          <span className={`cr-step-pill ${currentStep === 2 ? 'active' : ''}`}>
            2. Identity & Sync
          </span>
          <span className={`cr-step-pill ${currentStep === 3 ? 'active' : ''}`}>
            3. Governance & Walls
          </span>
        </div>

        <form onSubmit={goToNextStep}>
          <div className="cr-modal-body">
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

            {/* ── STEP 1: CLASSIFICATION ───────────────────────────────── */}
            {currentStep === 1 && (
              <div>
                <div className="cr-form-group">
                  <label className="cr-form-label" htmlFor="crIntakeArchetype">
                    Matter Archetype
                  </label>
                  <select
                    id="crIntakeArchetype"
                    className="cr-form-select"
                    value={archetype}
                    onChange={(e) => setArchetype(e.target.value)}
                  >
                    <option value="litigation">Litigation (Supreme Court / High Court / Tribunals)</option>
                    <option value="arbitration">Commercial Arbitration (Institutional / Ad-Hoc)</option>
                    <option value="advisory">Corporate Advisory & M&A Diligence</option>
                  </select>
                </div>

                <div className="cr-form-group" style={{ marginTop: '14px' }}>
                  <label className="cr-form-label" htmlFor="crIntakeBench">
                    Assigned Practice Group
                  </label>
                  <select
                    id="crIntakeBench"
                    className="cr-form-select"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                  >
                    <option value="Commercial Appellate Bench">Commercial Appellate Bench</option>
                    <option value="Arbitration & Infrastructure">Arbitration & Infrastructure</option>
                    <option value="Corporate M&A Advisory">Corporate M&A Advisory</option>
                    <option value="Private Chamber (Solo)">🔒 Private Chamber (Solo)</option>
                  </select>
                  <span className="cr-form-hint">
                    Sets default practice group benchmarks, precedent libraries, and ethical wall zones.
                  </span>
                </div>
              </div>
            )}

            {/* ── STEP 2: DYNAMIC IDENTITY & SYNC ──────────────────────── */}
            {currentStep === 2 && (
              <div>
                {/* Dynamic Title */}
                <div className="cr-form-group">
                  <label className="cr-form-label" htmlFor="crIntakeTitle">
                    {archetype === 'litigation'
                      ? 'Case Caption (Petitioner v. Respondent) *'
                      : archetype === 'arbitration'
                      ? 'Arbitration Matter Title *'
                      : 'Transaction / Advisory Title *'}
                  </label>
                  <input
                    id="crIntakeTitle"
                    ref={titleInputRef}
                    type="text"
                    className="cr-form-input"
                    placeholder={
                      archetype === 'litigation'
                        ? 'e.g. Tata Sons Pvt. Ltd. v. Cyrus Investments LLC'
                        : archetype === 'arbitration'
                        ? 'e.g. Metro Rail Corp v. EPC Consortium'
                        : 'e.g. Acme Pharma Acquisition & IP Restructuring'
                    }
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      if (error) setError('');
                    }}
                    required
                  />
                </div>

                {/* Conditional Fields: Litigation */}
                {archetype === 'litigation' && (
                  <>
                    <div className="cr-form-group" style={{ marginTop: '12px' }}>
                      <label className="cr-form-label" htmlFor="crCourtName">
                        Court & Bench
                      </label>
                      <input
                        id="crCourtName"
                        type="text"
                        className="cr-form-input"
                        placeholder="e.g. Supreme Court of India · Court 3"
                        value={courtName}
                        onChange={(e) => setCourtName(e.target.value)}
                      />
                    </div>

                    <div className="cr-form-group" style={{ marginTop: '12px' }}>
                      <label className="cr-form-label" htmlFor="crStageAndItem">
                        Cause List Stage & Item
                      </label>
                      <input
                        id="crStageAndItem"
                        type="text"
                        className="cr-form-input"
                        placeholder="e.g. Admission Hearing · Item 14"
                        value={stageAndItem}
                        onChange={(e) => setStageAndItem(e.target.value)}
                      />
                    </div>

                    <div className="cr-form-group" style={{ marginTop: '12px' }}>
                      <label className="cr-form-label" htmlFor="crCnrNumber">
                        CNR Number (eCourts Sync)
                      </label>
                      <input
                        id="crCnrNumber"
                        type="text"
                        className="cr-form-input"
                        placeholder="e.g. DLHC01-004821-2026"
                        value={cnrNumber}
                        onChange={(e) => setCnrNumber(e.target.value)}
                      />
                      <span className="cr-form-hint">
                        Enables live cause list scraping and push updates for hearing listings.
                      </span>
                    </div>
                  </>
                )}

                {/* Conditional Fields: Arbitration */}
                {archetype === 'arbitration' && (
                  <>
                    <div className="cr-form-group" style={{ marginTop: '12px' }}>
                      <label className="cr-form-label" htmlFor="crArbitralInst">
                        Arbitral Institution / Rules
                      </label>
                      <input
                        id="crArbitralInst"
                        type="text"
                        className="cr-form-input"
                        placeholder="e.g. MCIA / SIAC / LCIA / Ad-Hoc"
                        value={arbitralInstitution}
                        onChange={(e) => setArbitralInstitution(e.target.value)}
                      />
                    </div>

                    <div className="cr-form-group" style={{ marginTop: '12px' }}>
                      <label className="cr-form-label" htmlFor="crSeatArbitrator">
                        Seat & Presiding Arbitrator
                      </label>
                      <input
                        id="crSeatArbitrator"
                        type="text"
                        className="cr-form-input"
                        placeholder="e.g. Mumbai Seat · Justice (Retd.) R. V. Raveendran"
                        value={seatAndArbitrator}
                        onChange={(e) => setSeatAndArbitrator(e.target.value)}
                      />
                    </div>
                  </>
                )}

                {/* Conditional Fields: Advisory */}
                {archetype === 'advisory' && (
                  <>
                    <div className="cr-form-group" style={{ marginTop: '12px' }}>
                      <label className="cr-form-label" htmlFor="crCounterparties">
                        Corporate Counterparties & Scope
                      </label>
                      <input
                        id="crCounterparties"
                        type="text"
                        className="cr-form-input"
                        placeholder="e.g. Acme Pharma Ltd. & Apex Biotech Inc."
                        value={counterparties}
                        onChange={(e) => setCounterparties(e.target.value)}
                      />
                    </div>

                    <div className="cr-form-group" style={{ marginTop: '12px' }}>
                      <label className="cr-form-label" htmlFor="crTargetClosing">
                        Target Closing Date
                      </label>
                      <input
                        id="crTargetClosing"
                        type="text"
                        className="cr-form-input"
                        placeholder="e.g. 15 Oct 2026"
                        value={targetClosingDate}
                        onChange={(e) => setTargetClosingDate(e.target.value)}
                      />
                    </div>

                    <div className="cr-form-group" style={{ marginTop: '12px' }}>
                      <label className="cr-form-label" htmlFor="crPlaybook">
                        Governing Playbook / M&A Model
                      </label>
                      <input
                        id="crPlaybook"
                        type="text"
                        className="cr-form-input"
                        placeholder="e.g. Share Purchase Due Diligence Playbook"
                        value={playbook}
                        onChange={(e) => setPlaybook(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── STEP 3: GOVERNANCE & WALLS ──────────────────────────── */}
            {currentStep === 3 && (
              <div>
                <div className="cr-form-group">
                  <label className="cr-form-label" htmlFor="crLeadPartner">
                    Lead Partner
                  </label>
                  <input
                    id="crLeadPartner"
                    type="text"
                    className="cr-form-input"
                    value={leadPartner}
                    onChange={(e) => setLeadPartner(e.target.value)}
                  />
                </div>

                {archetype === 'litigation' && (
                  <div className="cr-form-group" style={{ marginTop: '12px' }}>
                    <label className="cr-form-label" htmlFor="crAor">
                      Advocate on Record (AoR)
                    </label>
                    <input
                      id="crAor"
                      type="text"
                      className="cr-form-input"
                      placeholder="e.g. K. Parameshwar, AoR"
                      value={aor}
                      onChange={(e) => setAor(e.target.value)}
                    />
                  </div>
                )}

                <div className="cr-form-group" style={{ marginTop: '12px' }}>
                  <label className="cr-form-label" htmlFor="crLeadAssoc">
                    Drafting Associate
                  </label>
                  <input
                    id="crLeadAssoc"
                    type="text"
                    className="cr-form-input"
                    value={leadAssociate}
                    onChange={(e) => setLeadAssociate(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '18px' }}>
                  <input
                    id="crIntakeWall"
                    type="checkbox"
                    checked={wallEnforced}
                    onChange={(e) => setWallEnforced(e.target.checked)}
                    style={{ accentColor: 'var(--accent)', cursor: 'pointer', width: '16px', height: '16px' }}
                  />
                  <label
                    htmlFor="crIntakeWall"
                    style={{ fontSize: '12px', color: 'var(--ink)', fontWeight: 500, cursor: 'pointer', userSelect: 'none' }}
                  >
                    Enforce Ethical Wall (Strictly isolate from conflicting firm teams)
                  </label>
                </div>
              </div>
            )}
          </div>

          <div className="cr-modal-footer">
            {currentStep > 1 ? (
              <button
                type="button"
                className="cr-btn-dock"
                onClick={goToPrevStep}
              >
                ← Back
              </button>
            ) : (
              <button
                type="button"
                className="cr-btn-dock"
                onClick={onClose}
              >
                Cancel
              </button>
            )}

            <button
              type="submit"
              className="cr-btn-primary"
            >
              {currentStep === 1
                ? 'Next: Identity →'
                : currentStep === 2
                ? 'Next: Governance →'
                : 'Register Dossier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
