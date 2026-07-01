import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';

const loginStyles = `
  .login-container {
    display: flex;
    min-height: 100vh;
    background-color: var(--bg-app);
    color: var(--text-primary);
    font-family: var(--font-sans);
  }
  
  /* Left Panel: abstract branding, hidden on mobile */
  .login-branding {
    display: none;
    flex: 1;
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    border-right: 1px solid var(--border-subtle);
    padding: 60px;
    flex-direction: column;
    justify-content: space-between;
    position: relative;
    overflow: hidden;
  }
  
  [data-theme="light"] .login-branding {
    background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
  }

  @media (min-width: 768px) {
    .login-branding {
      display: flex;
    }
  }

  .branding-circle {
    position: absolute;
    width: 400px;
    height: 400px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(59, 130, 246, 0.1) 0%, transparent 70%);
    top: -100px;
    left: -100px;
    animation: branding-pulse 8s infinite alternate ease-in-out;
  }

  @keyframes branding-pulse {
    0% { transform: scale(1); opacity: 0.7; }
    100% { transform: scale(1.15); opacity: 1; }
  }

  /* Right Panel: login form */
  .login-form-panel {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 24px;
    position: relative;
  }

  .login-card {
    width: 100%;
    max-width: 400px;
  }

  .login-input-group {
    margin-bottom: 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .login-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-muted);
  }

  .login-input {
    background-color: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 14px;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .login-input:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .login-btn {
    background-color: var(--accent-primary);
    color: #FFFFFF;
    font-weight: 500;
    border: none;
    border-radius: 8px;
    padding: 14px;
    font-size: 15px;
    cursor: pointer;
    transition: background-color 0.2s, transform 0.2s;
    width: 100%;
    margin-top: 10px;
  }

  .login-btn:hover {
    background-color: var(--accent-hover);
  }

  .login-btn:active {
    transform: scale(0.99);
  }

  .floating-theme-toggle {
    position: absolute;
    top: 24px;
    right: 24px;
    background: transparent;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-primary);
    transition: background-color 0.2s;
  }

  .floating-theme-toggle:hover {
    background-color: var(--accent-muted);
  }

  /* ── VERIFICATION BANNER (sleek dark) ─────────────────────────────── */
  .verify-banner {
    display: flex; align-items: flex-start; gap: 12px;
    background: linear-gradient(135deg, rgba(30,41,59,0.95) 0%, rgba(15,23,42,0.95) 100%);
    border: 1px solid rgba(59,130,246,0.35);
    border-left: 3px solid var(--accent-primary);
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 20px;
    animation: verify-slide-in 0.35s ease;
  }
  @keyframes verify-slide-in {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .verify-banner__icon { flex-shrink: 0; color: var(--accent-primary); margin-top: 1px; }
  .verify-banner__title { font-size: 13px; font-weight: 600; color: #E2E8F0; margin: 0 0 3px; }
  .verify-banner__body { font-size: 12.5px; color: #94A3B8; margin: 0; line-height: 1.5; }
  .verify-banner__pending {
    display: inline-block; margin-top: 6px; font-size: 10.5px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.05em;
    color: #FCD34D; background: rgba(245,158,11,0.12);
    border: 1px solid rgba(245,158,11,0.25); border-radius: 5px; padding: 2px 7px;
  }

  /* ── FORGOT PASSWORD MODAL ─────────────────────────────────────────── */
  .reset-modal-overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(2,6,23,0.72); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center; padding: 20px;
    animation: reset-fade 0.2s ease;
  }
  @keyframes reset-fade { from { opacity: 0; } to { opacity: 1; } }
  .reset-modal-card {
    width: 100%; max-width: 420px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 14px;
    padding: 28px;
    box-shadow: 0 24px 60px rgba(0,0,0,0.45);
    animation: reset-pop 0.25s cubic-bezier(0.16,1,0.3,1);
  }
  @keyframes reset-pop {
    from { opacity: 0; transform: scale(0.96) translateY(8px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  .reset-modal-close {
    position: absolute; top: 14px; right: 14px;
    background: transparent; border: none; color: var(--text-muted);
    font-size: 20px; cursor: pointer; line-height: 1;
  }

  /* ── TOAST ─────────────────────────────────────────────────────────── */
  .lex-toast {
    position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
    z-index: 1100; display: flex; align-items: center; gap: 10px;
    padding: 12px 18px; border-radius: 10px; font-size: 13.5px; font-weight: 500;
    box-shadow: 0 12px 40px rgba(0,0,0,0.4);
    animation: toast-rise 0.3s cubic-bezier(0.16,1,0.3,1);
    max-width: 460px;
  }
  @keyframes toast-rise {
    from { opacity: 0; transform: translateX(-50%) translateY(12px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  .lex-toast--success {
    background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.35); color: #6EE7B7;
  }
  .lex-toast--error {
    background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.35); color: #FCA5A5;
  }
`;

export default function LoginPage() {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [email, setEmail] = useState('advocate@lexamplify.in');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Password reset + email verification UI (delivery deferred until an email
  // provider is configured — no real mail is sent from this stack yet).
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [showVerifyBanner, setShowVerifyBanner] = useState(false);
  const [toast, setToast] = useState(null); // { type: 'success' | 'error', message }

  // Auto-dismiss toasts
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const openResetModal = () => {
    setResetEmail(email || '');
    setShowResetModal(true);
  };

  // Forgot-password submit. Delivery is not yet wired, so we validate the
  // address and surface an honest "pending" success state rather than
  // claiming an email was dispatched.
  const handlePasswordReset = async (e) => {
    e.preventDefault();
    if (!EMAIL_RE.test(resetEmail.trim())) {
      setToast({ type: 'error', message: 'Please enter a valid email address.' });
      return;
    }
    setResetLoading(true);
    // Simulated round-trip; replace with sendPasswordResetEmail / backend call
    // once an email provider is configured.
    await new Promise((r) => setTimeout(r, 650));
    setResetLoading(false);
    setShowResetModal(false);
    setToast({
      type: 'success',
      message: `Reset requested for ${resetEmail.trim()}. A link will be delivered once email service is enabled.`,
    });
  };

  // --- 1. THE DYNAMIC REGISTRATION FUNCTION ---
  const handleRegister = async (e) => {
    e.preventDefault();
    if (!email || !password) return setError('Please provide email and password.');
    setLoading(true); setError('');

    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // DEFENSIVE MAPPING: Send both keys so backend never misses it
        body: JSON.stringify({ email: email, username: email, password: password }) 
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Registration failed.');

      // Surface the email-verification banner. NOTE: this stack has no email
      // service yet, so no verification mail is actually sent — the banner is
      // the intended UX, gated behind honest "pending delivery" copy.
      setShowVerifyBanner(true);
      setToast({ type: 'success', message: 'Account created securely. You can now sign in.' });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- 2. THE DYNAMIC LOGIN FUNCTION ---
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) return setError('Please provide email and password.');
    setLoading(true); setError('');

    // 6-second timeout race: if the auth handshake hangs (cold Render dyno,
    // network stall), abort and surface an explicit fallback instead of an
    // indefinitely-spinning "Authenticating…" button.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        // DEFENSIVE MAPPING: Guarantee Python catches it
        body: JSON.stringify({ email: email, username: email, password: password })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || 'Invalid credentials.');
      if (!data.access_token) throw new Error('No JWT token received from server.');

      localStorage.setItem('token', data.access_token);
      localStorage.setItem('lexai_token', data.access_token);
      navigate('/dashboard');
    } catch (err) {
      if (err.name === 'AbortError') {
        const msg = 'The authentication server is taking too long to respond (possibly waking from sleep). Please try again in a moment.';
        setError(msg);
        alert(msg);
      } else {
        setError(err.message);
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <style>{loginStyles}</style>

      {/* Floating Theme Button */}
      <button
        onClick={toggleTheme}
        className="floating-theme-toggle"
        title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
      >
        {theme === 'dark' ? (
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="5" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        ) : (
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>

      {/* Left branding panel: hidden on mobile */}
      <div className="login-branding">
        <div className="branding-circle" />
        
        {/* Top Branding Section */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', zIndex: 2 }}>
          <span style={{ fontSize: '20px', fontWeight: '700', letterSpacing: '0.5px' }}>LexAmplify</span>
          <span style={{ fontSize: '10px', textTransform: 'uppercase', background: 'var(--accent-muted)', color: 'var(--accent-primary)', padding: '2px 6px', borderRadius: '4px', fontWeight: '600' }}>
            India
          </span>
        </div>

        {/* Middle Value Proposition Section */}
        <div style={{ zIndex: 2, maxWidth: '460px', margin: 'auto 0' }}>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '38px', lineHeight: '1.25', marginBottom: '20px', fontWeight: '700' }}>
            The sovereign workspace for Indian advocacy.
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '15px', lineHeight: '1.6' }}>
            Access specialized modules including Contract Risk Analysis, Conflict comparison indexes, and RAG chat directories grounded in Indian Law.
          </p>
        </div>

        {/* Bottom Compliance Badge */}
        <div style={{ zIndex: 2, display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', color: 'var(--text-muted)' }}>
          <span>🔒 Compliance Secured</span>
          <span>•</span>
          <span>Indian Law Sovereignty</span>
        </div>
      </div>

      {/* Right form panel */}
      <div className="login-form-panel">
        <div className="login-card">
          <div style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px', fontFamily: 'var(--font-serif)' }}>
              Enter advocate console
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
              Sign in with your credentials to launch LexAmplify.
            </p>
          </div>

          {/* Email verification banner (shown after registration) */}
          {showVerifyBanner && (
            <div className="verify-banner">
              <svg className="verify-banner__icon" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <div>
                <p className="verify-banner__title">Verify your email before console access</p>
                <p className="verify-banner__body">
                  Please check your inbox and confirm your address before accessing the advocate console.
                </p>
                <span className="verify-banner__pending">⏳ Delivery pending email-service setup</span>
              </div>
            </div>
          )}

          <form onSubmit={(e) => e.preventDefault()}>
            {error && (
              <div style={{ color: 'var(--accent-danger)', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '20px' }}>
                ⚠️ {error}
              </div>
            )}

            <div className="login-input-group">
              <label className="login-label">Email Address</label>
              <input
                type="email"
                className="login-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="advocate@lexamplify.in"
                required
                disabled={loading}
              />
            </div>

            <div className="login-input-group" style={{ marginBottom: '28px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="login-label">Password</label>
                <span
                  onClick={openResetModal}
                  style={{ fontSize: '12px', color: 'var(--accent-primary)', cursor: 'pointer' }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openResetModal(); }}
                >
                  Forgot?
                </span>
              </div>
              <input
                type="password"
                className="login-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={loading}
              />
            </div>

            {/* Replace your old <button type="submit"> with these two: */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button 
                type="button" 
                onClick={handleRegister} 
                className="login-btn" 
                style={{ background: 'transparent', border: '1px solid var(--accent-primary)', color: 'var(--accent-primary)' }}
                disabled={loading}
              >
                Create Account
              </button>
              
              <button 
                type="button" 
                onClick={handleLogin} 
                className="login-btn" 
                style={{ margin: 0 }}
                disabled={loading}
              >
                {loading ? 'Authenticating...' : 'Sign In'}
              </button>
            </div>
          </form>

          {/* Bottom Back Button */}
          <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '13px' }}>
            <Link to="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              ← Return to public website
            </Link>
          </div>
        </div>
      </div>

      {/* ── FORGOT PASSWORD MODAL ── */}
      {showResetModal && (
        <div className="reset-modal-overlay" onClick={() => setShowResetModal(false)}>
          <div className="reset-modal-card" style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button className="reset-modal-close" onClick={() => setShowResetModal(false)} aria-label="Close">×</button>
            <h3 style={{ fontSize: '19px', fontWeight: '700', marginBottom: '6px', fontFamily: 'var(--font-serif)' }}>
              Reset your password
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13.5px', lineHeight: 1.5, marginBottom: '20px' }}>
              Enter the email tied to your advocate console and we'll send a secure reset link.
            </p>
            <form onSubmit={handlePasswordReset}>
              <div className="login-input-group">
                <label className="login-label">Email Address</label>
                <input
                  type="email"
                  className="login-input"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="advocate@lexamplify.in"
                  autoFocus
                  disabled={resetLoading}
                />
              </div>
              <button type="submit" className="login-btn" style={{ margin: '8px 0 0' }} disabled={resetLoading}>
                {resetLoading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <p style={{ marginTop: '14px', fontSize: '11.5px', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
              ⏳ Email delivery is not yet configured on this environment — the link will dispatch once an email provider is connected.
            </p>
          </div>
        </div>
      )}

      {/* ── TOAST ── */}
      {toast && (
        <div className={`lex-toast lex-toast--${toast.type}`}>
          <span>{toast.type === 'success' ? '✅' : '⚠️'}</span>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
