import { useEffect, useRef } from 'react';
import useOnboardingStore from '../../stores/useOnboardingStore.js';
import TOUR_SECTIONS from './tourSteps.js';

export default function HelpButton() {
  const { onboarding, helpOpen, toggleHelp, closeHelp, startTour, restartWizard } = useOnboardingStore();
  const ref = useRef(null);

  useEffect(() => {
    if (!helpOpen) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) closeHelp(); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [helpOpen, closeHelp]);

  const sections = Object.entries(TOUR_SECTIONS).filter(([k]) => k !== 'full');

  if (!onboarding.wizard_completed && !onboarding.tour_completed) return null;

  return (
    <div ref={ref} style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999 }}>
      {helpOpen && (
        <div style={menu}>
          <button style={menuItem} onClick={restartWizard}>
            <span style={menuIcon}>🔄</span> Guided Setup Wizard
          </button>
          <div style={divider} />
          <button style={menuItem} onClick={() => startTour('full')}>
            <span style={menuIcon}>▶</span> Feature Overview
          </button>
          <div style={divider} />
          {sections.map(([key, { label }]) => (
            <button key={key} style={menuItem} onClick={() => startTour(key)}>
              <span style={menuIcon}>›</span> {label}
            </button>
          ))}
        </div>
      )}
      <button onClick={toggleHelp} style={fab} title="Help & tutorials" aria-label="Help and tutorials">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>
    </div>
  );
}

const fab = {
  width: 48, height: 48, borderRadius: '50%',
  background: 'var(--accent, #2563C9)', color: '#fff',
  border: 'none', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 4px 16px rgba(37,99,201,.35)',
  transition: 'transform .15s, box-shadow .15s',
};
const menu = {
  position: 'absolute', bottom: 58, right: 0,
  width: 220, background: 'var(--paper, #fff)',
  border: '1px solid var(--rule, #e2e8f0)', borderRadius: 12,
  boxShadow: '0 12px 36px rgba(0,0,0,.14)', padding: '6px 0',
  maxHeight: 400, overflowY: 'auto',
};
const menuItem = {
  display: 'flex', alignItems: 'center', gap: 8,
  width: '100%', padding: '9px 14px', border: 'none',
  background: 'none', cursor: 'pointer', fontSize: 13.5,
  color: 'var(--ink)', textAlign: 'left',
};
const menuIcon = { fontSize: 14, color: 'var(--accent, #2563C9)', fontWeight: 700, width: 16, textAlign: 'center' };
const divider = { height: 1, background: 'var(--rule, #e2e8f0)', margin: '4px 10px' };
