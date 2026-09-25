import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useOrganizationStore } from '../../stores/useOrganizationStore';
import { useOrganization } from '../../hooks/useOrganization';
import './organization.css';

export default function ContextCapsule() {
  const navigate = useNavigate();
  const location = useLocation();

  const { teams, matters } = useOrganization();
  const activeMatterId = useOrganizationStore((state) => state.activeMatterId);
  const activeTeamId = useOrganizationStore((state) => state.activeTeamId);
  const setActiveMatter = useOrganizationStore((state) => state.setActiveMatter);
  const setActiveTeam = useOrganizationStore((state) => state.setActiveTeam);

  const [matterDropdownOpen, setMatterDropdownOpen] = useState(false);
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);

  const capsuleRef = useRef(null);

  const activeMatter = matters.find((m) => m.id === activeMatterId) || matters[0];
  const activeTeam = teams.find((t) => t.id === activeTeamId) || teams[0];

  // Close dropdowns on outside click or Escape
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (capsuleRef.current && !capsuleRef.current.contains(e.target)) {
        setMatterDropdownOpen(false);
        setTeamDropdownOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setMatterDropdownOpen(false);
        setTeamDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSelectMatter = (matter) => {
    setActiveMatter(matter.id);
    setMatterDropdownOpen(false);
    navigate(`/workspace/matter/${matter.id}`);
  };

  const handleSelectTeam = (team) => {
    setActiveTeam(team.id);
    setTeamDropdownOpen(false);
    navigate(`/workspace/team/${team.id}`);
  };

  const p = location.pathname;
  const isOrgActive = p === '/workspace/org';
  const isTeamActive = p.startsWith('/workspace/team/');
  const isMatterActive = !isOrgActive && !isTeamActive;

  return (
    <div className="context-capsule-wrapper" ref={capsuleRef}>
      <nav className="trail" aria-label="Context Trail">
        {/* Segment 1: Matter */}
        <button
          type="button"
          className={`trail-seg ${isMatterActive ? 'current' : ''}`}
          onClick={() => {
            setTeamDropdownOpen(false);
            setMatterDropdownOpen((prev) => !prev);
          }}
          title={activeMatter ? `Matter: ${activeMatter.title}` : 'Untitled Matter'}
          aria-label="Switch active matter dropdown"
          aria-expanded={matterDropdownOpen}
        >
          <span className="dot" />
          <span className="txt serif">{activeMatter ? activeMatter.title : 'Untitled Matter'}</span>
          <svg className="chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <span className="trail-sep">›</span>

        {/* Segment 2: Team */}
        <button
          type="button"
          className={`trail-seg ${isTeamActive ? 'current' : ''}`}
          onClick={() => {
            setMatterDropdownOpen(false);
            setTeamDropdownOpen((prev) => !prev);
          }}
          title={activeTeam ? `Team: ${activeTeam.name}` : 'My Chambers'}
          aria-label="Switch active team dropdown"
          aria-expanded={teamDropdownOpen}
        >
          <span className="dot" />
          <span className="txt">{activeTeam ? activeTeam.name : 'My Chambers'}</span>
          <svg className="chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <span className="trail-sep">›</span>

        {/* Segment 3: Firm Console */}
        <button
          type="button"
          className={`trail-seg ${isOrgActive ? 'current' : ''}`}
          onClick={() => {
            setMatterDropdownOpen(false);
            setTeamDropdownOpen(false);
            navigate('/workspace/org');
          }}
          title="Organization / Firm Console"
          aria-label="Firm Console"
        >
          <span className="dot" />
          <span className="txt">Firm Console</span>
          <svg className="chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </nav>

      {/* Popover: Switch Matters */}
      {matterDropdownOpen && (
        <div className="capsule-dropdown" role="menu" style={{ left: 0 }}>
          <div className="capsule-dropdown-header">Switch Active Matter</div>
          <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
            {matters.map((matter) => {
              const isSelected = matter.id === activeMatterId;
              return (
                <button
                  key={matter.id}
                  type="button"
                  role="menuitem"
                  className={`capsule-dropdown-item ${isSelected ? 'active' : ''}`}
                  onClick={() => handleSelectMatter(matter)}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: '13px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {matter.title}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                      {matter.lead_counsel} · {matter.opened_date}
                    </span>
                  </div>
                  {isSelected && (
                    <span style={{ color: 'var(--accent)', marginLeft: '8px', fontSize: '14px' }}>✓</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="capsule-dropdown-footer">
            <button
              type="button"
              className="capsule-dropdown-link"
              onClick={() => {
                setMatterDropdownOpen(false);
                navigate('/workspace/matters');
              }}
            >
              <span>+ Browse All Matters</span>
            </button>
          </div>
        </div>
      )}

      {/* Popover: Switch Teams */}
      {teamDropdownOpen && (
        <div className="capsule-dropdown" role="menu" style={{ left: '100px' }}>
          <div className="capsule-dropdown-header">Switch Practice Team</div>
          <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
            {teams.map((team) => {
              const isSelected = team.id === activeTeamId;
              return (
                <button
                  key={team.id}
                  type="button"
                  role="menuitem"
                  className={`capsule-dropdown-item ${isSelected ? 'active' : ''}`}
                  onClick={() => handleSelectTeam(team)}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: '13px', fontWeight: isSelected ? 600 : 500 }}>
                      {team.name}
                    </span>
                    {team.description && (
                      <span style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                        {team.description}
                      </span>
                    )}
                  </div>
                  {isSelected && (
                    <span style={{ color: 'var(--accent)', marginLeft: '8px', fontSize: '14px' }}>✓</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
