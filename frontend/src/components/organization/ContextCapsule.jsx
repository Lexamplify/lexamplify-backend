import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useOrganizationStore } from '../../stores/useOrganizationStore';
import './organization.css';

export default function ContextCapsule() {
  const navigate = useNavigate();
  const location = useLocation();

  const matters = useOrganizationStore((state) => state.matters);
  const teams = useOrganizationStore((state) => state.teams);
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
  const isMatterActive = p.startsWith('/workspace/matter/');
  const isTeamActive = p.startsWith('/workspace/team/');
  const isOrgActive = p === '/workspace/org';

  return (
    <div className="context-capsule-wrapper" ref={capsuleRef}>
      <nav className="context-capsule" aria-label="Context Switcher">
        {/* Segment 1: [ • {matter.title} ] */}
        <div style={{ display: 'inline-flex', alignItems: 'center', position: 'relative' }}>
          <button
            type="button"
            className={`context-seg ${isMatterActive ? 'active' : ''}`}
            onClick={() => {
              if (activeMatter) {
                navigate(`/workspace/matter/${activeMatter.id}`);
              }
            }}
            title={activeMatter ? `Matter: ${activeMatter.title}` : 'Active Matter'}
          >
            <span className="seg-dot" style={{ background: 'var(--accent)' }} />
            <span
              className="seg-label-matter"
              style={{
                maxWidth: '140px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {activeMatter ? activeMatter.title : 'Select Matter'}
            </span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setTeamDropdownOpen(false);
              setMatterDropdownOpen((prev) => !prev)}
            }
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--ink-soft)',
              padding: '4px 6px 4px 0',
              cursor: 'pointer',
              fontSize: '10px',
              opacity: 0.8,
            }}
            aria-label="Switch active matter dropdown"
            aria-expanded={matterDropdownOpen}
          >
            ▾
          </button>
        </div>

        {/* Segment 2: [ • {team.name} ] */}
        <div style={{ display: 'inline-flex', alignItems: 'center', position: 'relative' }}>
          <button
            type="button"
            className={`context-seg ${isTeamActive ? 'active' : ''}`}
            onClick={() => {
              if (activeTeam) {
                navigate(`/workspace/team/${activeTeam.id}`);
              }
            }}
            title={activeTeam ? `Team: ${activeTeam.name}` : 'Active Team'}
          >
            <span className="seg-dot" />
            <span
              className="seg-label-team"
              style={{
                maxWidth: '120px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {activeTeam ? activeTeam.name : 'Select Team'}
            </span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMatterDropdownOpen(false);
              setTeamDropdownOpen((prev) => !prev)}
            }
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--ink-soft)',
              padding: '4px 6px 4px 0',
              cursor: 'pointer',
              fontSize: '10px',
              opacity: 0.8,
            }}
            aria-label="Switch active team dropdown"
            aria-expanded={teamDropdownOpen}
          >
            ▾
          </button>
        </div>

        {/* Segment 3: [ • Firm Console ] */}
        <button
          type="button"
          className={`context-seg ${isOrgActive ? 'active' : ''}`}
          onClick={() => navigate('/workspace/org')}
          title="Organization / Firm Console"
        >
          <span className="seg-dot" />
          <span>Firm Console</span>
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
                        fontFamily: "'Fraunces', serif",
                        fontStyle: 'italic',
                        fontSize: '13px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {matter.title}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                      {matter.leadCounsel} · {matter.openedAt}
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
                    <span style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                      {team.membersCount} member{team.membersCount !== 1 ? 's' : ''}
                    </span>
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
