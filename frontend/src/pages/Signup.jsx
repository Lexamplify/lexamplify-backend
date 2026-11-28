import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

/* Decorative motion for the dark left panel of /signup.
   Metaphor: opening a new chambers — a quill writing a signature,
   with the quill tip following the pen stroke in real time. */
function AuthMotion() {
  return (
    <div className="auth__motion" aria-hidden="true">
      <span className="auth__orb auth__orb--signup-0" />
      <span className="auth__orb auth__orb--signup-1" />
      <span className="auth__orb auth__orb--signup-2" />
      <span className="auth__scribe" />
      {/* Opening doors motif — two tall panels that swing open on load */}
      <div className="auth__doors">
        <span className="auth__door auth__door--l" />
        <span className="auth__door auth__door--r" />
      </div>
      {/* A quill signing — SVG offset-path puts the quill tip on the pen stroke */}
      <svg className="auth__quill" viewBox="0 0 600 180">
        <path id="quillPath" d="M 20 110 Q 140 50, 260 100 T 500 76 Q 560 60, 580 94" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" opacity=".95" />
        {/* Quill glyph that travels along the pen stroke */}
        <g className="auth__quill-tip" stroke="currentColor" fill="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="0" y1="0" x2="16" y2="-28" />
          <path d="M 14 -32 L 22 -40 L 20 -24 Z" strokeLinejoin="round" />
        </g>
      </svg>
    </div>
  );
}

/*
 * Signup page — matches Login's auth shell exactly, uses the same luxury palette.
 * Posts to /api/auth/register, which issues an HttpOnly session cookie on 201,
 * so a successful signup auto-signs-in and lands on /.
 */
export default function Signup() {
  const navigate = useNavigate();
  const { refreshSession } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [phone, setPhone] = useState('');
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Enter your full name.'); return; }
    if (!email.trim()) { setError('Enter your work email.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    if (!accept) { setError('Please accept the terms to create an account.'); return; }

    setBusy(true);
    try {
      const body = { name: name.trim(), email: email.trim(), password };
      if (phone.trim()) body.phone = phone.trim();
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error || data.message ||
          (res.status === 409 ? 'An account with this email already exists. Sign in instead.' :
           res.status >= 500 ? 'Something went wrong on our side. Please try again.' :
           'Could not create your account. Please check the details.')
        );
      }
      await refreshSession();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Could not create your account. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth__brand">
        <div className="auth__glow" />
        <AuthMotion seed="signup" />
        <Link to="/" className="auth__back">
          <span aria-hidden="true">←</span> Back to home
        </Link>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="rail__mono" style={{ borderColor: 'rgba(176,141,87,.55)' }}>L</div>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600 }}>Lexamplify</span>
        </div>
        <div style={{ position: 'relative' }}>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 'clamp(28px, 3.2vw, 42px)', lineHeight: 1.12, marginBottom: 18, color: '#F2F5FB', textShadow: '0 2px 24px rgba(0,0,0,.45)' }}>
            Open your chambers<br />in under five minutes.
          </h1>
          <p style={{ color: 'var(--rail-muted)', fontSize: 15, lineHeight: 1.7, maxWidth: 420 }}>
            Free to start. Add team members and matters when you&apos;re ready.
            Nothing to install. Your data stays in India.
          </p>
        </div>
        <div style={{ position: 'relative', display: 'flex', gap: 22, color: 'var(--rail-muted)', fontSize: 12.5 }}>
          <span>SOC 2 Type II</span><span>DPDP compliant</span><span>Data stays in India</span>
        </div>
      </div>

      <div className="auth__panel">
        <div className="auth__card">
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 28 }}>Create your account</h2>
          <p className="lx-muted" style={{ marginTop: 6, marginBottom: 28 }}>Start your chambers on Lexamplify.</p>

          {/* Native Google SSO button removed: Google is not configured on this
              environment (auth runs through Clerk). Showing it only dead-ended
              users with "Google SSO is not configured". Re-enable by wiring a
              Clerk Google social connection, not this native /sso route. */}

          {error && (
            <div role="alert" style={{ marginBottom: 14, padding: '10px 13px', borderRadius: 10, fontSize: 13.5, lineHeight: 1.45,
              background: 'color-mix(in srgb, var(--risk) 10%, transparent)', color: 'var(--risk)', border: '1px solid color-mix(in srgb, var(--risk) 30%, transparent)' }}>
              {error}
            </div>
          )}

          <form onSubmit={onSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label className="lbl">Full name</label>
              <input className="inp" type="text" autoComplete="name" placeholder="e.g. Priya Mehta"
                value={name} onChange={(e) => setName(e.target.value)} disabled={busy} maxLength={120} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label className="lbl">Work email</label>
              <input className="inp" type="email" autoComplete="email" placeholder="you@chambers.in"
                value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} maxLength={120} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label className="lbl">Mobile <span className="lx-muted" style={{ fontWeight: 400, fontSize: 12 }}>— optional</span></label>
              <input className="inp" type="tel" inputMode="numeric" autoComplete="tel" placeholder="10-digit Indian mobile"
                value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} maxLength={15} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label className="lbl">Password <span className="lx-muted" style={{ fontWeight: 400, fontSize: 12 }}>— at least 8 characters</span></label>
              <input className="inp" type="password" autoComplete="new-password" placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label className="lbl">Confirm password</label>
              <input className="inp" type="password" autoComplete="new-password" placeholder="••••••••"
                value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} />
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--ink-soft)', marginBottom: 22, lineHeight: 1.55 }}>
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} style={{ marginTop: 3 }} disabled={busy} />
              <span>I agree to Lexamplify&apos;s terms of service and privacy policy. I understand my data is stored in India.</span>
            </label>
            <button type="submit" disabled={busy} className="lx-btn lx-btn--primary" style={{ width: '100%', height: 48, opacity: busy ? 0.7 : 1 }}>
              {busy ? 'Creating your account…' : <>Create account <Ic.Arrow size={15} /></>}
            </button>
          </form>
          <p className="lx-muted" style={{ textAlign: 'center', marginTop: 22, fontSize: 13 }}>
            Already have an account? <Link to="/login" className="link-underline" style={{ color: 'var(--accent-ink)' }}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
