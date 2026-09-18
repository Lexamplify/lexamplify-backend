import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useOrgStore } from '../../store/useOrgStore';
import './organization.css';

export default function ContextCapsule() {
  const navigate = useNavigate();
  const location = useLocation();

  const matters = useOrgStore((state) => state.matters);
  const teams = useOrgStore((state) => state.teams);
  const activeMatterId = useOrgStore((state) => state.activeMatterId);
  const activeTeamId = useOrgStore((state) => state.activeTeamId);
  const setActiveMatter = useOrgStore((state) => state.setActiveMatter);
  const setActiveTeam = useOrgStore((state) => state.setActiveTeam);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const activeMatter = matters.find((m) => m.id === activeMatterId) || matters[0];
  const activeTeam = teams.find((t) => t.id === activeTeamId) || teams[0];

  // Close dropdown on outside click or escape
  useEffect(() => {
    if (!dropdownOpen) return;

    const handleOutsideClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dropdownOpen]);

  const handleSelectMatter = (matter) => {
    setActiveMatter(matter.id);
    setDropdownOpen(false);
  };

  const isMatterPage = location.pathname === '/matters';

  return (
    <div className="context-capsule-wrapper" ref={dropdownRef}>
      <nav className="context-capsule" aria-label="Context Switcher">
        {/* Matter Segment */}
        <button
          type="button"
          className={`context-seg ${activeMatter ? 'active' : ''}`}
          onClick={() => setDropdownOpen((prev) => !prev)}
          title="Click to switch active matter"
          aria-expanded={dropdownOpen}
          aria-haspopup="true"
        >
          <span className="seg-dot" />
          <span className="seg-label-matter">
            {activeMatter ? activeMatter.title : 'Select Matter'}
          </span>
          <span style={{ fontSize: '10px', opacity: 0.7, marginLeft: '2px' }}>▾</span>
        </button>

        {/* Team Segment */}
        <button
          type="button"
          className="context-seg"
          onClick={() => {
            if (activeTeam) {
              setActiveTeam(activeTeam.id);
            }
            navigate('/matters');
          }}
          title={activeTeam ? `Practice Group: ${activeTeam.name}` : 'Practice Group'}
        >
          <span className="seg-dot" />
          <span className="seg-label-team">
            {activeTeam ? activeTeam.name : 'Practice Group'}
          </span>
        </button>

        {/* Org Hub Segment */}
        <button
          type="button"
          className={`context-seg ${isMatterPage ? 'active' : ''}`}
          onClick={() => navigate('/matters')}
          title="Open Organization & Matter Gateway"
        >
          <span className="seg-dot" />
          <span>Org Hub</span>
        </button>
      </nav>

      {/* Quick Switch Dropdown */}
      {dropdownOpen && (
        <div className="capsule-dropdown" role="menu">
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
                      {matter.teamName} · {matter.leadCounsel}
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
                setDropdownOpen(false);
                navigate('/matters');
              }}
            >
              <span>+ Browse All Matters in Gateway</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
