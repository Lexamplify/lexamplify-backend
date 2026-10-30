import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import LexLogoMark from './LexLogoMark';
import { Icon } from './marketing/MarketingLayout';
import { waitUntilAwake, isServerAwake } from '../utils/warmServer';
import { sendWidgetOtp, verifyWidgetOtp } from '../utils/msg91Widget';
import './marketing/marketing.css';
import './marketing/auth.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// Render (backend) and Neon (Postgres) both cold-start from idle, so the first
// request after a quiet spell can take a while. We wake the server when this page
// opens and retry quietly instead of showing an error for something that is not
// the person's fault.
const FIRST_TRY_TIMEOUT_MS = 45000;
const RETRY_TIMEOUT_MS = 25000;
const SLOW_AFTER_MS = 4000;
const WAKING_MESSAGE = 'Our secure server is waking up. Please try again in a few seconds.';
const WAKING_STATUSES = [502, 503, 504, 520, 521, 522, 523, 524];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Reduce whatever was typed or pasted ("+91 98765-43210", "09876543210") to the 10 digits. */
const tenDigits = (raw) => {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  if (d.length > 10 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
};
const phoneOk = (d) => /^[6-9]\d{9}$/.test(d);

/** 0-4 strength score. Length matters most; mixing character types adds a little. */
function passwordLevel(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s += 1;
  if (pw.length >= 12) s += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s += 1;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s += 1;
  return Math.max(pw.length >= 8 ? 1 : 0, Math.min(4, s));
}
const LEVEL_LABEL = ['', 'Fine to start', 'Good', 'Strong', 'Very strong'];

/** POST JSON with quiet wake-up retries. Resolves { res, data }; throws Error with a person-readable message. */
async function postJSON(path, body, { onSlow, attempts = 8 } = {}) {
  const slowTimer = onSlow ? setTimeout(onSlow, SLOW_AFTER_MS) : null;
  try {
    if (!isServerAwake()) { onSlow?.(); await waitUntilAwake(); }
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), attempt === 1 ? FIRST_TRY_TIMEOUT_MS : RETRY_TIMEOUT_MS);
      let res = null; let data = {}; let failed = false;
      try {
        res = await fetch(`${API_BASE_URL}${path}`, {
          method: 'POST', credentials: 'include', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        data = await res.json().catch(() => ({}));   // a 5xx page is HTML - treat as empty
      } catch { failed = true; } finally { clearTimeout(timer); }

      const waking = failed || WAKING_STATUSES.includes(res.status);
      if (!waking) return { res, data };
      if (attempt === attempts) throw new Error(WAKING_MESSAGE);
      onSlow?.();
      await waitUntilAwake({ force: true, deadlineMs: 60000 });
      await new Promise((r) => setTimeout(r, 700 * attempt));
    }
    throw new Error(WAKING_MESSAGE);
  } finally {
    if (slowTimer) clearTimeout(slowTimer);
  }
}

const tooMany = (res) => res.status === 429;
const TOO_MANY_MESSAGE = 'Too many attempts. Please wait a minute and try again.';

/* ── Small presentational pieces ─────────────────────────────────────────── */
function Notice({ kind = 'error', children }) {
  if (!children) return null;
  return (
    <div className={`notice notice--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon name={kind === 'error' ? 'shield' : 'spark'} size={18} />
      <div>{children}</div>
    </div>
  );
}

function PhoneField({ id, value, onChange, disabled, label = 'Mobile number', hint, invalid, action }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`control control--prefix${action ? ' control--btn' : ''}`}>
        <span className="prefix" aria-hidden="true">+91</span>
        <input
          id={id} className="input lx-input" type="tel" inputMode="numeric" autoComplete="tel-national"
          placeholder="98765 43210" value={value} disabled={disabled} aria-invalid={invalid || undefined}
          onChange={(e) => onChange(tenDigits(e.target.value))}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        {action}
      </div>
      {hint && <div className="hint" id={`${id}-hint`}>{hint}</div>}
    </div>
  );
}

function CodeField({ id, value, onChange, disabled, onComplete, label = '6-digit code' }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id} className="input lx-input code-input" type="text" inputMode="numeric" autoComplete="one-time-code"
        placeholder="······" maxLength={6} value={value} disabled={disabled} autoFocus
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 6);
          onChange(v);
          if (v.length === 6) onComplete?.(v);
        }}
      />
    </div>
  );
}

function PasswordField({ id, label = 'Password', value, onChange, disabled, autoComplete, placeholder, aside, showMeter }) {
  const [show, setShow] = useState(false);
  const level = passwordLevel(value);
  return (
    <div className="field">
      <label htmlFor={id}><span>{label}</span>{aside}</label>
      <div className="control">
        <input
          id={id} className="input lx-input" type={show ? 'text' : 'password'} value={value} disabled={disabled}
          autoComplete={autoComplete} placeholder={placeholder} style={{ paddingRight: 52 }} maxLength={128}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          style={{ position: 'absolute', right: 4, top: 4, bottom: 4, width: 42, border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--muted)', borderRadius: 9 }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {show
              ? <><path d="M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-10.5-8-10.5-8a18 18 0 0 1 5-5.9M9.9 4.2A9 9 0 0 1 12 4c7 0 10.5 8 10.5 8a18 18 0 0 1-2.2 3.2" /><path d="m2 2 20 20" /></>
              : <><path d="M1.5 12S5 4 12 4s10.5 8 10.5 8-3.5 8-10.5 8S1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3" /></>}
          </svg>
        </button>
      </div>
      {showMeter && (
        <>
          <div className="meter" data-level={level} aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="hint" aria-live="polite">{value ? LEVEL_LABEL[level] || 'Use at least 8 characters' : 'Use at least 8 characters. A longer phrase is stronger.'}</div>
        </>
      )}
    </div>
  );
}

function Spinner({ label }) { return <><span className="spinner" aria-hidden="true" />{label}</>; }

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function LoginPage() {
  const { isAuthenticated, isInitializing, refreshSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  // Where to go after signing in: the page the visitor asked for, else the Start page.
  const nextPath = (() => {
    const f = location.state && location.state.from;
    return typeof f === 'string' && f.startsWith('/') && !f.startsWith('//') && !f.startsWith('/login') ? f : '/start';
  })();
  const resetToken = params.get('resetToken');

  const [mode, setMode] = useState(params.get('mode') === 'register' ? 'register' : 'signin');
  const [method, setMethod] = useState('password');           // sign-in: 'password' | 'otp'
  const [config, setConfig] = useState({ phone_otp_required: false, sms_enabled: false, otp_mode: 'api' });
  const widgetMode = config.otp_mode === 'widget';
  const [serverReady, setServerReady] = useState(() => isServerAwake());

  // shared form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [phoneToken, setPhoneToken] = useState('');           // proves the number on a new account was verified
  const [resendIn, setResendIn] = useState(0);
  const [mfa, setMfa] = useState(false);                      // authenticator-app step after a correct password
  const [mfaCode, setMfaCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [otpToken, setOtpToken] = useState('');                   // phone code accepted, authenticator code still owed

  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [toast, setToast] = useState('');

  const [resetOpen, setResetOpen] = useState(Boolean(resetToken));
  const resetOpener = useRef(null);
  const wasResetOpen = useRef(false);
  useEffect(() => {          // hand focus back to the "Forgot password?" link when the dialog closes
    if (wasResetOpen.current && !resetOpen) resetOpener.current?.focus?.();
    wasResetOpen.current = resetOpen;
  }, [resetOpen]);
  const [resetMode, setResetMode] = useState(resetToken ? 'confirm' : 'request');
  const [resetEmail, setResetEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  const isSignIn = mode === 'signin';
  const phoneVerified = Boolean(phoneToken);
  const needPhoneOtp = config.phone_otp_required;

  // Already signed in? Skip the form (but let a reset link through).
  useEffect(() => {
    if (isAuthenticated && !isInitializing && !resetToken) navigate(nextPath, { replace: true });
  }, [isAuthenticated, isInitializing, resetToken, navigate, nextPath]);

  // Wake the backend as soon as the page opens, and learn whether SMS codes are live.
  useEffect(() => {
    let live = true;
    (async () => {
      if (!isServerAwake()) { const ok = await waitUntilAwake(); if (live) setServerReady(ok); } else setServerReady(true);
      try {
        const r = await fetch(`${API_BASE_URL}/api/auth/config`, { credentials: 'include' });
        if (r.ok && live) setConfig(await r.json());
      } catch { /* keep safe defaults: no OTP step */ }
    })();
    return () => { live = false; };
  }, []);

  // Google sign-in returns here with ?sso_error=...
  useEffect(() => {
    const sso = params.get('sso_error');
    if (!sso) return;
    const provider = params.get('provider') || 'That sign-in method';
    setError(
      sso === 'unavailable' ? `${provider} sign-in is temporarily unavailable. Please use your email or mobile number.`
        : sso === 'no_email' ? `${provider} did not share an email address, so we could not create the account.`
          : `${provider} sign-in did not complete. Please try again or use another method.`,
    );
    setParams((prev) => { const n = new URLSearchParams(prev); ['sso_error', 'provider', 'detail'].forEach((k) => n.delete(k)); return n; }, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Resend countdown
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(''), 5000); return () => clearTimeout(t); }, [toast]);

  const clearFlow = useCallback(() => {
    setError(''); setInfo(''); setCode(''); setCodeSent(false); setMfa(false); setMfaCode(''); setUseRecovery(false); setResendIn(0); setOtpToken('');
  }, []);

  const switchMode = (next) => {
    if (next === mode) return;
    setMode(next); setMethod('password'); setPhoneToken(''); setPassword(''); clearFlow();
    setParams((prev) => { const n = new URLSearchParams(prev); if (next === 'register') n.set('mode', 'register'); else n.delete('mode'); return n; }, { replace: true });
  };

  const finishSignIn = async (emailForCache) => {
    await refreshSession();
    try { if (emailForCache) localStorage.setItem('active_lex_user', emailForCache); } catch { /* private mode */ }
    window.location.href = nextPath;
  };

  /* ── Mobile code: send ── */
  const sendCode = async (purpose) => {
    setError(''); setInfo('');
    if (!phoneOk(phone)) { setError('Enter a valid 10-digit mobile number.'); return; }
    setBusy(true);
    try {
      let resend = 30;
      if (widgetMode) {
        await sendWidgetOtp(config.msg91_widget, phone);
      } else {
        const { res, data } = await postJSON('/api/auth/otp/send', { phone, purpose }, { onSlow: () => setSlow(true) });
        if (tooMany(res)) throw new Error(TOO_MANY_MESSAGE);
        if (!res.ok) throw new Error(data.error || 'We could not send the code. Please try again.');
        resend = data.resend_in || 30;
      }
      setCodeSent(true); setCode(''); setResendIn(resend);
      setInfo(`We sent a code to +91 ${phone.slice(0, 5)} ${phone.slice(5)}.${widgetMode ? '' : ' It expires in 5 minutes.'}`);
    } catch (e) { setError(e.message); } finally { setBusy(false); setSlow(false); }
  };

  /* ── Mobile code: verify during sign-up ── */
  const verifySignupCode = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setError(''); setBusy(true);
    try {
      const proof = widgetMode ? { access_token: await verifyWidgetOtp(value) } : { code: value };
      const { res, data } = await postJSON('/api/auth/otp/verify', { phone, ...proof }, { onSlow: () => setSlow(true) });
      if (tooMany(res)) throw new Error(TOO_MANY_MESSAGE);
      if (!res.ok) { setCode(''); throw new Error(data.error || 'That code is incorrect or has expired.'); }
      setPhoneToken(data.phone_token); setCodeSent(false); setInfo('');
    } catch (e) { setError(e.message); } finally { setBusy(false); setSlow(false); }
  };

  /* ── Sign in with a mobile code ── */
  const signInWithCode = async (value = code) => {
    const step = Boolean(otpToken);
    if (busy) return;
    if (!step && value.length !== 6) return;
    if (step && !mfaCode.trim()) return setError(useRecovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.');
    setError(''); setBusy(true);
    try {
      const proof = step ? null : (widgetMode ? { access_token: await verifyWidgetOtp(value) } : { code: value });
      const body = step ? { phone, login_token: otpToken, totp: mfaCode.trim() } : { phone, ...proof };
      const { res, data } = await postJSON('/api/auth/otp/login', body, { onSlow: () => setSlow(true) });
      if (tooMany(res)) throw new Error(TOO_MANY_MESSAGE);
      if (!res.ok) {
        if (data.code === 'MFA_REQUIRED' && data.login_token) {
          setOtpToken(data.login_token); setMfaCode(''); setInfo(''); setBusy(false); setSlow(false); return;
        }
        if (data.code === 'MFA_INVALID') setMfaCode('');
        else { setCode(''); setOtpToken(''); setMfaCode(''); }   // expired or wrong: start the code step again
        throw new Error(data.error || 'That code is incorrect or has expired.');
      }
      await finishSignIn(data.user?.email);
    } catch (e) { setError(e.message); setBusy(false); setSlow(false); }
  };

  /* ── Sign in with email + password (+ authenticator step) ── */
  const signInWithPassword = async (e) => {
    e?.preventDefault();
    setError('');
    if (!EMAIL_RE.test(email.trim())) return setError('Enter the email address you signed up with.');
    if (!password) return setError('Enter your password.');
    if (mfa && !mfaCode.trim()) return setError(useRecovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.');
    setBusy(true);
    try {
      const body = { email: email.trim(), password, ...(mfa ? { otp: mfaCode.trim() } : {}) };
      const { res, data } = await postJSON('/api/auth/login', body, { onSlow: () => setSlow(true) });
      if (tooMany(res)) throw new Error(TOO_MANY_MESSAGE);
      if (!res.ok) {
        if (data.code === 'MFA_REQUIRED' && !mfa) { setMfa(true); setMfaCode(''); setBusy(false); setSlow(false); return; }
        if (data.code === 'MFA_INVALID') setMfaCode('');
        throw new Error(data.error || data.message || (res.status >= 500 ? 'Something went wrong on our side. Please try again.' : 'Incorrect email or password.'));
      }
      await finishSignIn(email.trim());
    } catch (err) { setError(err.message); setBusy(false); setSlow(false); }
  };

  /* ── Create account ── */
  const register = async (e) => {
    e?.preventDefault();
    setError('');
    if (!name.trim()) return setError('Enter your full name.');
    if (!EMAIL_RE.test(email.trim())) return setError('Enter a valid email address.');
    if (!phoneOk(phone)) return setError('Enter a valid 10-digit mobile number.');
    if (needPhoneOtp && !phoneVerified) return setError('Verify your mobile number first. Tap “Send code”.');
    if (password.length < 8) return setError('Your password needs at least 8 characters.');
    setBusy(true);
    try {
      const { res, data } = await postJSON('/api/auth/register', {
        name: name.trim(), email: email.trim(), phone, password, ...(phoneToken ? { phone_token: phoneToken } : {}),
      }, { onSlow: () => setSlow(true) });
      if (tooMany(res)) throw new Error('Too many sign-up attempts from this network. Please try again later.');
      if (!res.ok) {
        if (data.code === 'PHONE_NOT_VERIFIED') setPhoneToken('');
        throw new Error(data.error || 'We could not create your account. Please try again.');
      }
      await finishSignIn(email.trim());
    } catch (err) { setError(err.message); setBusy(false); setSlow(false); }
  };

  /* ── Password reset ── */
  const closeReset = () => {
    setResetOpen(false);
    if (resetToken) setParams((prev) => { const n = new URLSearchParams(prev); n.delete('resetToken'); return n; }, { replace: true });
  };
  const requestReset = async (e) => {
    e.preventDefault();
    if (!EMAIL_RE.test(resetEmail.trim())) { setToast('Enter a valid email address.'); return; }
    setResetBusy(true);
    try {
      await postJSON('/api/auth/forgot-password', { email: resetEmail.trim(), frontend_origin: window.location.origin }, { attempts: 3 });
    } catch { /* identical message either way: never reveal whether an account exists */ }
    setResetBusy(false); setResetOpen(false);
    setToast('If an account exists for that email, a reset link is on its way.');
  };
  const confirmReset = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) { setToast('Your new password needs at least 8 characters.'); return; }
    setResetBusy(true);
    try {
      const { res, data } = await postJSON('/api/auth/reset-password', { token: resetToken, password: newPassword }, { attempts: 3 });
      if (!res.ok) throw new Error(data.error || 'This reset link is invalid or has expired.');
      closeReset(); setNewPassword(''); switchMode('signin'); setToast('Password updated. You can sign in now.');
    } catch (err) { setToast(err.message); } finally { setResetBusy(false); }
  };

  const busyLabel = slow ? 'Starting your secure workspace…' : null;

  /* ── Render helpers ── */
  const sendBtn = (purpose) => (
    <button type="button" className="inline-btn" disabled={busy || resendIn > 0 || !phoneOk(phone)} onClick={() => sendCode(purpose)}>
      {resendIn > 0 ? `${resendIn}s` : codeSent ? 'Resend' : 'Send code'}
    </button>
  );

  const googleHref = `${API_BASE_URL}/api/auth/sso/google/login`;

  return (
    <div className="mk auth">
      {/* ── Side panel ── */}
      <aside className="auth__side">
        <Link to="/" className="brand" aria-label="LexAmplify home">
          <LexLogoMark size={32} /><span className="brand__word">LexAmplify</span>
        </Link>
        <div>
          <h2>Legal work that starts from <em>your file</em>.</h2>
          <p className="lede" style={{ marginTop: 18 }}>Draft, review and organise matters in one calm workspace built for Indian advocates.</p>
          <ul className="auth__points">
            <li><Icon name="file" size={20} /><div>Drafts that ask first<span>It asks for the matter and details instead of guessing.</span></div></li>
            <li><Icon name="scan" size={20} /><div>Contract review in minutes<span>Risks, gaps and suggested rewrites, clause by clause.</span></div></li>
            <li><Icon name="shield" size={20} /><div>Careful with your account<span>Optional two-step sign-in with an authenticator app.</span></div></li>
          </ul>
        </div>
        <p className="auth__fine">LexAmplify assists legal professionals and does not provide legal advice.</p>
      </aside>

      {/* ── Form ── */}
      <main className="auth__main" id="main">
        <div className="auth__top">
          <Link to="/" className="auth__back"><Icon name="arrow" size={16} style={{ transform: 'rotate(180deg)' }} />Back to website</Link>
          <Link to="/" className="brand auth__brand-m" aria-label="LexAmplify home"><LexLogoMark size={28} /><span className="brand__word" style={{ fontSize: 19 }}>LexAmplify</span></Link>
        </div>

        <div className="auth__center">
          <div className="auth__card">
            <h1>{isSignIn ? 'Welcome back.' : 'Create your account.'}</h1>
            <p className="auth__sub">{isSignIn ? 'Sign in to your workspace.' : 'It takes about a minute.'}</p>

            <div className="seg" role="tablist" aria-label="Sign in or create account">
              <button type="button" role="tab" aria-selected={isSignIn} onClick={() => switchMode('signin')}>Sign in</button>
              <button type="button" role="tab" aria-selected={!isSignIn} onClick={() => switchMode('register')}>Create account</button>
            </div>

            {/* ───────── SIGN IN ───────── */}
            {isSignIn && (
              <>
                {config.sms_enabled && (
                <div className="seg seg--sm" role="tablist" aria-label="Sign-in method">
                  <button type="button" role="tab" aria-selected={method === 'password'} onClick={() => { setMethod('password'); clearFlow(); }}>Email &amp; password</button>
                  <button type="button" role="tab" aria-selected={method === 'otp'} onClick={() => { setMethod('otp'); clearFlow(); }}>Mobile code</button>
                </div>
                )}

                {method === 'password' && (
                  <form className="form" onSubmit={signInWithPassword} noValidate>
                    <Notice>{error}</Notice>
                    {!mfa ? (
                      <>
                        <div className="field">
                          <label htmlFor="si-email">Email address</label>
                          <input id="si-email" className="input lx-input" type="email" autoComplete="username" inputMode="email" placeholder="you@example.com"
                            value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} autoFocus />
                        </div>
                        <PasswordField id="si-pw" value={password} onChange={setPassword} disabled={busy} autoComplete="current-password"
                          placeholder="Your password"
                          aside={<button type="button" className="link-btn" onClick={(e) => { resetOpener.current = e.currentTarget; setResetMode('request'); setResetEmail(email); setResetOpen(true); }}>Forgot password?</button>} />
                      </>
                    ) : (
                      <div className="field">
                        <Notice kind="info">{useRecovery
                          ? <>Enter one of your recovery codes for <b>{email}</b>. Each code works once.</>
                          : <>Two-step sign-in is on for <b>{email}</b>. Enter the 6-digit code from your authenticator app.</>}</Notice>
                        <label htmlFor="si-mfa" style={{ marginTop: 16 }}>{useRecovery ? 'Recovery code' : '6-digit code'}</label>
                        <input id="si-mfa" className={`input lx-input${useRecovery ? '' : ' code-input'}`} type="text" autoComplete="one-time-code"
                          inputMode={useRecovery ? 'text' : 'numeric'} maxLength={20} placeholder={useRecovery ? 'abcd-efgh' : '······'}
                          value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} disabled={busy} autoFocus />
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                          <button type="button" className="link-btn" onClick={() => { setUseRecovery((v) => !v); setMfaCode(''); setError(''); }}>{useRecovery ? 'Use my authenticator app' : 'Use a recovery code'}</button>
                          <button type="button" className="link-btn" onClick={() => { setMfa(false); setMfaCode(''); setUseRecovery(false); setError(''); }}>Back</button>
                        </div>
                      </div>
                    )}
                    <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
                      {busy ? <Spinner label={busyLabel || 'Signing in…'} /> : <>{mfa ? 'Verify and sign in' : 'Sign in'}<Icon name="arrow" size={18} /></>}
                    </button>
                  </form>
                )}

                {method === 'otp' && config.sms_enabled && (
                  <form className="form" onSubmit={(e) => { e.preventDefault(); if (codeSent) signInWithCode(); else sendCode('login'); }} noValidate>
                    <Notice>{error}</Notice>
                    <Notice kind="info">{info}</Notice>
                    <PhoneField id="li-phone" value={phone} onChange={(v) => { setPhone(v); if (codeSent) { setCodeSent(false); setCode(''); setInfo(''); setOtpToken(''); setMfaCode(''); } }} disabled={busy}
                      action={sendBtn('login')} hint={!codeSent ? 'We will text you a 6-digit code. Use the number on your account.' : undefined} />
                    {codeSent && !otpToken && <CodeField id="li-code" value={code} onChange={setCode} disabled={busy} onComplete={signInWithCode} />}
                    {otpToken && (
                      <div className="field">
                        <label htmlFor="li-mfa">{useRecovery ? 'Recovery code' : 'Authenticator code'}</label>
                        <input id="li-mfa" className={`input lx-input${useRecovery ? '' : ' code-input'}`} type="text" autoComplete="one-time-code"
                          inputMode={useRecovery ? 'text' : 'numeric'} maxLength={useRecovery ? 20 : 6}
                          placeholder={useRecovery ? 'xxxx-xxxx' : '······'} value={mfaCode}
                          onChange={(e) => setMfaCode(e.target.value)} disabled={busy} autoFocus />
                        <p className="hint">Your account also uses two-step sign-in. <button type="button" className="link-btn" onClick={() => { setUseRecovery((v) => !v); setMfaCode(''); }}>{useRecovery ? 'Use authenticator app' : 'Use a recovery code'}</button></p>
                      </div>
                    )}
                    {codeSent && (
                      <button type="submit" className="btn btn--primary btn--block" disabled={busy || (otpToken ? !mfaCode.trim() : code.length !== 6)}>
                        {busy ? <Spinner label={busyLabel || 'Signing in…'} /> : <>Verify and sign in<Icon name="arrow" size={18} /></>}
                      </button>
                    )}
                    {!codeSent && (
                      <button type="submit" className="btn btn--primary btn--block" disabled={busy || !phoneOk(phone)}>
                        {busy ? <Spinner label={busyLabel || 'Sending…'} /> : <>Send code<Icon name="arrow" size={18} /></>}
                      </button>
                    )}
                  </form>
                )}
              </>
            )}

            {/* ───────── CREATE ACCOUNT ───────── */}
            {!isSignIn && (
              <form className="form" onSubmit={register} noValidate>
                <Notice>{error}</Notice>
                <div className="field">
                  <label htmlFor="rg-name">Full name</label>
                  <input id="rg-name" className="input lx-input" type="text" autoComplete="name" placeholder="Adv. Rajesh Sharma"
                    value={name} onChange={(e) => setName(e.target.value)} disabled={busy} maxLength={120} autoFocus />
                </div>
                <div className="field">
                  <label htmlFor="rg-email">Email address</label>
                  <input id="rg-email" className="input lx-input" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com"
                    value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} maxLength={120} />
                </div>

                {/* Mobile number + one-time code */}
                {phoneVerified ? (
                  <div className="field">
                    <div className="label">Mobile number</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <span className="verified"><Icon name="check" size={16} />+91 {phone.slice(0, 5)} {phone.slice(5)} verified</span>
                      <button type="button" className="link-btn" onClick={() => { setPhoneToken(''); setCodeSent(false); setCode(''); }}>Change</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <PhoneField id="rg-phone" value={phone} disabled={busy}
                      onChange={(v) => { setPhone(v); if (codeSent) { setCodeSent(false); setCode(''); setInfo(''); } }}
                      action={needPhoneOtp ? sendBtn('signup') : null}
                      hint={needPhoneOtp ? 'We will text you a code to confirm this number.' : 'Used for sign-in and important account alerts.'} />
                    {needPhoneOtp && codeSent && (
                      <>
                        <Notice kind="info">{info}</Notice>
                        <CodeField id="rg-code" value={code} onChange={setCode} disabled={busy} onComplete={verifySignupCode} />
                        <button type="button" className="btn btn--ghost btn--block" disabled={busy || code.length !== 6} onClick={() => verifySignupCode()}>
                          {busy ? 'Checking…' : 'Verify number'}
                        </button>
                      </>
                    )}
                  </>
                )}

                <PasswordField id="rg-pw" value={password} onChange={setPassword} disabled={busy} autoComplete="new-password" placeholder="Create a password" showMeter />
                <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
                  {busy ? <Spinner label={busyLabel || 'Creating your account…'} /> : <>Create account<Icon name="arrow" size={18} /></>}
                </button>
                <p className="terms">By creating an account you agree to use LexAmplify responsibly and to keep your sign-in details private.</p>
              </form>
            )}

            <div className="divider">or</div>
            <a className="sso" href={googleHref}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.89c2.28-2.1 3.56-5.19 3.56-8.82z" />
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.89-3c-1.08.73-2.46 1.16-4.04 1.16-3.1 0-5.73-2.1-6.67-4.92H1.3v3.09A12 12 0 0 0 12 24z" />
                <path fill="#FBBC05" d="M5.33 14.33A7.2 7.2 0 0 1 4.95 12c0-.81.14-1.6.38-2.33V6.58H1.3A12 12 0 0 0 0 12c0 1.94.46 3.77 1.3 5.42z" />
                <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.6 4.59 1.8l3.44-3.44C17.94 1.19 15.24 0 12 0A12 12 0 0 0 1.3 6.58l4.03 3.09C6.27 6.86 8.9 4.77 12 4.77z" />
              </svg>
              Continue with Google
            </a>

            <div className={`conn${serverReady ? ' ready' : ''}`} role="status" aria-live="polite">
              <i />{serverReady ? 'Secure connection ready' : 'Waking our secure server. You can start now and we will connect as soon as it is up.'}
            </div>

            <p className="swap">
              {isSignIn
                ? <>New to LexAmplify? <button type="button" className="link-btn" onClick={() => switchMode('register')}>Create an account</button></>
                : <>Already have an account? <button type="button" className="link-btn" onClick={() => switchMode('signin')}>Sign in</button></>}
            </p>
          </div>
        </div>
      </main>

      {/* ── Reset modal ── */}
      {resetOpen && (
        <div className="modal-back" onClick={closeReset} role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rs-title" onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { closeReset(); return; }
              if (e.key !== 'Tab') return;      // keep keyboard focus inside the dialog
              const f = [...e.currentTarget.querySelectorAll('button, input, [href], select, textarea')].filter((x) => !x.disabled && x.offsetParent !== null);
              if (!f.length) return;
              const first = f[0]; const last = f[f.length - 1];
              if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
              else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }}>
            <button type="button" className="x" onClick={closeReset} aria-label="Close"><Icon name="close" size={20} /></button>
            {resetMode === 'request' ? (
              <form onSubmit={requestReset} noValidate>
                <h2 id="rs-title">Reset your password</h2>
                <p className="auth__sub">Enter your email and we will send a secure link. It works once and expires in an hour.</p>
                <div className="form">
                  <div className="field">
                    <label htmlFor="rs-email">Email address</label>
                    <input id="rs-email" className="input lx-input" type="email" autoComplete="email" placeholder="you@example.com" autoFocus
                      value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} disabled={resetBusy} />
                  </div>
                  <button type="submit" className="btn btn--primary btn--block" disabled={resetBusy}>{resetBusy ? <Spinner label="Sending…" /> : 'Send reset link'}</button>
                  <p className="terms" style={{ marginTop: 0 }}>We show the same message whether or not an account exists, to protect everyone’s privacy.</p>
                </div>
              </form>
            ) : (
              <form onSubmit={confirmReset} noValidate>
                <h2 id="rs-title">Choose a new password</h2>
                <p className="auth__sub">Pick something you do not use anywhere else.</p>
                <div className="form">
                  <PasswordField id="rs-pw" label="New password" value={newPassword} onChange={setNewPassword} disabled={resetBusy} autoComplete="new-password" placeholder="At least 8 characters" showMeter />
                  <button type="submit" className="btn btn--primary btn--block" disabled={resetBusy}>{resetBusy ? <Spinner label="Updating…" /> : 'Update password'}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
