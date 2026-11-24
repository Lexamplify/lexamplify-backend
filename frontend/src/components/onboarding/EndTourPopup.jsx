import useOnboardingStore from '../../stores/useOnboardingStore.js';

export default function EndTourPopup({ visible, onClose }) {
  if (!visible) return null;
  const { toggleHelp } = useOnboardingStore();

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 8 }}>👋</div>
        <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', textAlign: 'center', color: 'var(--ink)' }}>You're all set!</h3>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '0 0 18px', textAlign: 'center', lineHeight: 1.55 }}>
          Explore on your own. Anytime you need help, click the
          <span style={{ display: 'inline-flex', verticalAlign: 'middle', margin: '0 4px', width: 22, height: 22, borderRadius: '50%', background: 'var(--accent, #2563C9)', color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>?</span>
          button for a full tutorial or any specific feature guide.
        </p>
        <button
          style={{ width: '100%', padding: '10px 20px', borderRadius: 8, border: 'none', background: 'var(--accent, #2563C9)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          onClick={onClose}
        >
          Got it
        </button>
      </div>
    </div>
  );
}

const overlay = { position: 'fixed', inset: 0, zIndex: 10003, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
const card = { background: 'var(--paper, #fff)', borderRadius: 16, width: '100%', maxWidth: 360, padding: '28px 24px 20px', boxShadow: '0 16px 48px rgba(0,0,0,.18)' };
