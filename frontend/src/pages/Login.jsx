import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

/* Decorative motion for the dark left panel of /login.
   Metaphor: returning to the chambers — a slowly rotating legal seal.
   Pure CSS/SVG, no deps. */
function AuthMotion() {
  return (
    <div className="auth__motion" aria-hidden="true">
      <span className="auth__orb auth__orb--login-0" />
      <span className="auth__orb auth__orb--login-1" />
      <span className="auth__orb auth__orb--login-2" />
      <span className="auth__scribe" />
      {/* A verification seal — big, slowly rotating outer ring + static legend */}
      <div className="auth__seal">
        <svg viewBox="0 0 240 240" className="auth__seal-ring">
          <circle cx="120" cy="120" r="110" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 6" />
          <circle cx="120" cy="120" r="98"  fill="none" stroke="currentColor" strokeWidth="0.6" opacity=".7" />
        </svg>
        <svg viewBox="0 0 240 240" className="auth__seal-face">
          <circle cx="120" cy="120" r="86" fill="none" stroke="currentColor" strokeWidth="0.5" opacity=".4" />
          {/* Scales-of-justice glyph in the center */}
          <g transform="translate(120 120)" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity=".95">
            {/* vertical stand */}
            <line x1="0" y1="-38" x2="0" y2="36" />
            {/* base */}
            <line x1="-20" y1="38" x2="20" y2="38" strokeWidth="3" />
            {/* top crossbar */}
            <line x1="-34" y1="-30" x2="34" y2="-30" />
            {/* left pan ropes + pan */}
            <line x1="-30" y1="-26" x2="-30" y2="-6" />
            <path d="M -42 -6 L -18 -6 L -24 6 L -36 6 Z" />
            {/* right pan ropes + pan */}
            <line x1="30" y1="-26" x2="30" y2="-6" />
            <path d="M 18 -6 L 42 -6 L 36 6 L 24 6 Z" />
          </g>
          <text x="120" y="46" textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="10" letterSpacing="3" fill="currentColor" opacity=".75">· LEXAMPLIFY ·</text>
          <text x="120" y="204" textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize="10" letterSpacing="3" fill="currentColor" opacity=".75">VERIFIED CHAMBERS</text>
        </svg>
        <span className="auth__seal-pulse" />
      </div>
    </div>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const { refreshSession } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Show "Continue with Clerk" only when the backend reports Clerk fully
  // configured (keys present), so the button never leads to a half-set-up flow.
  const [clerkEnabled, setClerkEnabled] = useState(false);
  useEffect(() => {
    if (!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY) return;
    let alive = true;
    fetch(`${API_BASE}/api/auth/clerk/status`, { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (alive) setClerkEnabled(!!j?.enabled); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error || data.message ||
          (res.status >= 500 ? 'Something went wrong on our side. Please try again.' : 'Incorrect email or password.')
        );
      }
      await refreshSession();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth__brand">
        <div className="auth__glow" />
        <AuthMotion seed="login" />
        <Link to="/" className="auth__back">
          <span aria-hidden="true">←</span> Back to home
        </Link>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="rail__mono" style={{ borderColor: 'rgba(176,141,87,.55)' }}>L</div>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600 }}>Lexamplify</span>
        </div>
        <div style={{ position: 'relative' }}>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 'clamp(28px, 3.2vw, 42px)', lineHeight: 1.12, marginBottom: 18, color: '#F2F5FB', textShadow: '0 2px 24px rgba(0,0,0,.45)' }}>
            The art of law,<br />the precision of AI.
          </h1>
          <p style={{ color: 'var(--rail-muted)', fontSize: 15, lineHeight: 1.7, maxWidth: 420 }}>
            Measured, citation-grounded intelligence for the chambers that set the standard. Research, draft, review and advise — in one calm workspace.
          </p>
        </div>
        <div style={{ position: 'relative', display: 'flex', gap: 22, color: 'var(--rail-muted)', fontSize: 12.5 }}>
          <span>SOC 2 Type II</span><span>DPDP compliant</span><span>Data stays in India</span>
        </div>
      </div>

      <div className="auth__panel">
        <div className="auth__card">
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 28 }}>Welcome back</h2>
          <p className="lx-muted" style={{ marginTop: 6, marginBottom: 28 }}>Sign in to your chambers.</p>

          {clerkEnabled && (
            <Link to="/clerk-login" className="lx-btn" style={{ width: '100%', height: 48, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none' }}>
              Continue with Clerk
            </Link>
          )}
          <div className="lx-row" style={{ gap: 12, margin: '18px 0' }}><hr className="lx-rule" style={{ flex: 1 }} /><span className="lx-muted" style={{ fontSize: 12 }}>or</span><hr className="lx-rule" style={{ flex: 1 }} /></div>

          {error && (
            <div role="alert" style={{ marginBottom: 14, padding: '10px 13px', borderRadius: 10, fontSize: 13.5, lineHeight: 1.45,
              background: 'color-mix(in srgb, var(--risk) 10%, transparent)', color: 'var(--risk)', border: '1px solid color-mix(in srgb, var(--risk) 30%, transparent)' }}>
              {error}
            </div>
          )}

          <form onSubmit={onSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label className="lbl">Email</label>
              <input className="inp" type="email" autoComplete="email" placeholder="you@chambers.in"
                value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label className="lbl">Password</label>
              <input className="inp" type="password" autoComplete="current-password" placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
            </div>
            <div className="lx-between" style={{ marginBottom: 22 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink-soft)' }}><input type="checkbox" defaultChecked /> Remember me</label>
              <a className="link-underline" style={{ fontSize: 13, color: 'var(--accent-ink)' }}>Forgot password?</a>
            </div>
            <button type="submit" disabled={busy} className="lx-btn lx-btn--primary" style={{ width: '100%', height: 48, opacity: busy ? 0.7 : 1 }}>
              {busy ? 'Signing in…' : <>Sign in <Ic.Arrow size={15} /></>}
            </button>
          </form>
          <p className="lx-muted" style={{ textAlign: 'center', marginTop: 22, fontSize: 13 }}>New to Lexamplify? <Link to="/signup" className="link-underline" style={{ color: 'var(--accent-ink)' }}>Create an account</Link></p>
        </div>
      </div>
    </div>
  );
}
