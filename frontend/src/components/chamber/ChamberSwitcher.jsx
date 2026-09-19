import React, { useState, useRef, useEffect } from 'react';
import { useChamberStore } from '../../stores/useChamberStore';
import './chamberRoster.css';

const BENCHES = [
  'Commercial Appellate Bench',
  'Arbitration & Infrastructure',
  'Corporate M&A Advisory',
  'Private Chamber (Solo)',
];

export default function ChamberSwitcher({ variant = 'topbar', isCollapsed = false }) {
  const activeBench = useChamberStore((state) => state.activeBench);
  const setActiveBench = useChamberStore((state) => state.setActiveBench);

  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelectBench = (bench) => {
    setActiveBench(bench);
    setIsOpen(false);
  };

  // If sidebar is collapsed into capsule mode, render compact icon dock to prevent layout breakage
  if (isCollapsed && variant === 'sidebar') {
    return (
      <div className="cr-bench-select-wrapper" ref={wrapperRef} title={`Bench: ${activeBench}`}>
        <button
          type="button"
          className="cr-bench-badge compact"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label="Switch Practice Bench"
          aria-expanded={isOpen}
        >
          <span>⚖</span>
        </button>
        {isOpen && (
          <div className="cr-bench-dropdown" role="menu" style={{ left: '100%', top: 0, marginLeft: '8px' }}>
            <div style={{ padding: '6px 12px 4px', fontSize: '10px', color: 'var(--muted)', fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase' }}>
              Practice Benches
            </div>
            {BENCHES.map((bench) => (
              <button
                key={bench}
                type="button"
                role="menuitem"
                className={`cr-bench-item ${activeBench === bench ? 'active' : ''}`}
                onClick={() => handleSelectBench(bench)}
              >
                <span>{bench}</span>
                {activeBench === bench && <span style={{ color: 'var(--accent)' }}>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Sidebar header variant
  if (variant === 'sidebar') {
    return (
      <div className="cr-sidebar-switcher" ref={wrapperRef}>
        <div className="cr-sidebar-firm">Shardul Amarchand Mangaldas</div>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="cr-sidebar-bench-btn"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-expanded={isOpen}
            aria-label="Select Practice Bench"
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeBench}
            </span>
            <span style={{ marginLeft: '4px' }}>▾</span>
          </button>

          {isOpen && (
            <div className="cr-bench-dropdown" role="menu" style={{ width: '100%', minWidth: '220px' }}>
              <div style={{ padding: '4px 10px', fontSize: '10px', color: 'var(--muted)', fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase' }}>
                Practice Benches
              </div>
              {BENCHES.map((bench) => (
                <button
                  key={bench}
                  type="button"
                  role="menuitem"
                  className={`cr-bench-item ${activeBench === bench ? 'active' : ''}`}
                  onClick={() => handleSelectBench(bench)}
                >
                  <span>{bench}</span>
                  {activeBench === bench && <span style={{ color: 'var(--accent)' }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Topbar context trail variant (default)
  return (
    <div className="cr-bench-select-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className="cr-bench-badge"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-label="Practice Bench Switcher"
      >
        <span>{activeBench}</span>
        <span style={{ fontSize: '9px', marginLeft: '2px' }}>▾</span>
      </button>

      {isOpen && (
        <div className="cr-bench-dropdown" role="menu">
          <div style={{ padding: '6px 12px 4px', fontSize: '10px', color: 'var(--muted)', fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase' }}>
            Practice Benches
          </div>
          {BENCHES.map((bench) => (
            <button
              key={bench}
              type="button"
              role="menuitem"
              className={`cr-bench-item ${activeBench === bench ? 'active' : ''}`}
              onClick={() => handleSelectBench(bench)}
            >
              <span>{bench}</span>
              {activeBench === bench && <span style={{ color: 'var(--accent)' }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
