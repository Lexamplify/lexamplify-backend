import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useOnboardingStore from '../../stores/useOnboardingStore.js';
import '../../styles/onboarding-wizard.css';

const API = import.meta.env.VITE_API_BASE_URL || '';

const PRACTICE_TYPES = [
  { key: 'solo', t: 'Solo practice', s: 'Just me' },
  { key: 'small', t: 'Chamber, 2–10', s: 'Small firm or chambers' },
  { key: 'mid', t: 'Firm, 11–50', s: 'Mid-size firm' },
  { key: 'large', t: 'Firm, 50+', s: 'Large / full-service' },
  { key: 'inhouse', t: 'In-house', s: 'Company legal team' },
  { key: 'other', t: 'Other', s: 'Govt, academic, etc.' },
];
const ROLES = [
  { v: 'senior', label: 'Senior Advocate' },
  { v: 'junior', label: 'Junior Advocate' },
  { v: 'staff', label: 'Office Staff' },
];
const TOTAL = 2;

export default function OnboardingWizard() {
  const showWizard = useOnboardingStore((s) => s.showWizard);
  const storeFirm = useOnboardingStore((s) => s.firmName);
  const updateFirmName = useOnboardingStore((s) => s.updateFirmName);
  const completeWizard = useOnboardingStore((s) => s.completeWizard);
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [firm, setFirm] = useState(storeFirm || '');
  const [ptype, setPtype] = useState('solo');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('junior');
  const [invites, setInvites] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!showWizard) return null;

  const addInvite = () => {
    const e = email.trim().toLowerCase();
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setErr('Enter a valid email address.'); return; }
    if (invites.some((i) => i.email === e)) { setErr('That email is already in the list.'); return; }
    setInvites([...invites, { email: e, role }]);
    setEmail(''); setErr('');
  };

  const sendInvites = async () => {
    for (const inv of invites) {
      try {
        await fetch(`${API}/api/practice/members/invite`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: inv.email, role: inv.role }),
        });
      } catch { /* best-effort; a failed invite shouldn't block onboarding */ }
    }
  };

  const finishStep1 = async () => {
    const name = firm.trim();
    if (!name) { setErr('Give your practice a name.'); return; }
    setBusy(true); setErr('');
    try { await updateFirmName(name); } catch { /* silent */ }
    setBusy(false); setStep(1);
  };

  const finish = async () => {
    setBusy(true); setErr('');
    if (invites.length) await sendInvites();
    await completeWizard();
    setBusy(false);
    navigate('/dashboard');
  };

  return (
    <div className="obw-overlay">
      <div className="obw-top">
        <div className="obw-brand"><span className="obw-brand-mark">L</span> LexAmplify</div>
        <div className="obw-progress">
          {Array.from({ length: TOTAL }).map((_, i) => (
            <span key={i} className={`obw-seg ${i <= step ? 'on' : ''}`} />
          ))}
        </div>
        <span className="obw-step-label">Step {Math.min(step + 1, TOTAL)} of {TOTAL}</span>
      </div>

      <div className="obw-body">
        {step === 0 && (
          <div className="obw-card">
            <div className="obw-eyebrow">Your practice</div>
            <h1 className="obw-h1">Set up your chamber.</h1>
            <p className="obw-sub">This is the practice your matters, clients and teammates live under. You can change it later in Settings.</p>

            <div className="obw-field">
              <label className="obw-label">Practice / chamber name</label>
              <input className="obw-input" value={firm} onChange={(e) => setFirm(e.target.value)}
                     placeholder="e.g. Sharma & Associates" autoFocus maxLength={120} />
            </div>

            <div className="obw-field">
              <label className="obw-label">What best describes it?</label>
              <div className="obw-grid">
                {PRACTICE_TYPES.map((p) => (
                  <button type="button" key={p.key}
                          className={`obw-tile ${ptype === p.key ? 'sel' : ''}`}
                          onClick={() => setPtype(p.key)}>
                    <div className="obw-tile-t">{p.t}</div>
                    <div className="obw-tile-s">{p.s}</div>
                  </button>
                ))}
              </div>
            </div>

            {err && <div className="obw-err">{err}</div>}
            <div className="obw-actions">
              <button className="obw-btn" onClick={finishStep1} disabled={busy}>Continue →</button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="obw-card">
            <button className="obw-back" onClick={() => setStep(0)}>← Back</button>
            <div className="obw-eyebrow">Optional</div>
            <h1 className="obw-h1">Invite your team.</h1>
            <p className="obw-sub">They’ll join <strong>{firm || 'your practice'}</strong> the moment they sign in with their email — with the role you pick. You can invite more anytime from the Team page.</p>

            <div className="obw-invite-row">
              <div className="obw-field" style={{ margin: 0 }}>
                <label className="obw-label">Email address</label>
                <input className="obw-input" value={email} onChange={(e) => setEmail(e.target.value)}
                       placeholder="name@firm.com" onKeyDown={(e) => e.key === 'Enter' && addInvite()} />
              </div>
              <div className="obw-field" style={{ margin: 0 }}>
                <label className="obw-label">Role</label>
                <select className="obw-select" value={role} onChange={(e) => setRole(e.target.value)}>
                  {ROLES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
                </select>
              </div>
              <button className="obw-btn obw-btn--ghost" style={{ height: 48 }} onClick={addInvite}>Add</button>
            </div>

            {invites.map((inv) => (
              <div className="obw-chip" key={inv.email}>
                <span>{inv.email}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="obw-chip-role">{ROLES.find((r) => r.v === inv.role)?.label}</span>
                  <button className="obw-chip-x" onClick={() => setInvites(invites.filter((i) => i.email !== inv.email))}>×</button>
                </span>
              </div>
            ))}

            {err && <div className="obw-err">{err}</div>}
            <div className="obw-actions">
              <button className="obw-btn" onClick={finish} disabled={busy}>
                {invites.length ? `Send ${invites.length} invite${invites.length > 1 ? 's' : ''} & finish →` : 'Finish →'}
              </button>
              {!invites.length && <button className="obw-link" onClick={finish} disabled={busy}>Skip for now</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
