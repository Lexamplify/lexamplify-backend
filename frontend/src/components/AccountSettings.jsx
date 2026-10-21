import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// ── Icons (same hand-drawn line style as the rest of the app) ──────────────
const AIcon = {
  user: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4.2 3.6-7 8-7s8 2.8 8 7" />
    </svg>
  ),
  shield: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v6c0 4.6-3 8.3-7 9-4-0.7-7-4.4-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" />
    </svg>
  ),
  sliders: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="6" x2="20" y2="6" /><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" /><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="18" x2="20" y2="18" /><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  info: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16.5" /><circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  ),
  check: (w = 14) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12l5 5L20 6" />
    </svg>
  ),
  back: (w = 15) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 19l-7-7 7-7" />
    </svg>
  ),
  sun: (w = 15) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M4.5 12H2M22 12h-2.5M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
    </svg>
  ),
  moon: (w = 15) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.3a7 7 0 0 0 11 11.2z" />
    </svg>
  ),
  shuffle: (w = 14) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12a4 4 0 0 1 4-4h8M4 12a4 4 0 0 0 4 4h8M14 5l3 3-3 3M14 13l3 3-3 3" />
    </svg>
  ),
};

const ACCOUNT_SETTINGS_STYLES = `
  .acct-page{
    --a-bg:#DFE1E0; --a-paper:#EAEBE8; --a-paper-2:#E3E4E1; --a-card:#FFFFFF;
    --a-ink:#181B1D; --a-ink-soft:#494E51; --a-muted:#868C8E; --a-muted-2:#B3B8B9; --a-rule:#D2D5D4;
    --a-accent:#937243; --a-accent-soft:#EFDCD1; --a-good:#2F7D4F; --a-good-soft:#DCEEE1; --a-bad:#B2402E; --a-bad-soft:#F4DCD8;
    --a-font-serif:'Fraunces', serif; --a-font-sans:'IBM Plex Sans', sans-serif; --a-font-mono:'IBM Plex Mono', monospace;
    min-height:100%; background:var(--a-bg); padding:40px clamp(20px,4vw,56px) 80px; font-family:var(--a-font-sans); color:var(--a-ink);
  }
  html[data-theme="dark"] .acct-page{
    --a-bg:#191C1D; --a-paper:#212527; --a-paper-2:#2A2F31; --a-card:#242A2C;
    --a-ink:#D6D9D9; --a-ink-soft:#AAAEAE; --a-muted:#727776; --a-muted-2:#494E4D; --a-rule:#333939;
    --a-accent:#B08D57; --a-accent-soft:#3B281F; --a-good:#5FBE86; --a-good-soft:#1D3327; --a-bad:#E0796A; --a-bad-soft:#3B2420;
  }
  .acct-page *{ box-sizing:border-box; }
  .acct-shell{ max-width:980px; margin:0 auto; }

  .acct-head{ display:flex; align-items:flex-start; gap:16px; margin-bottom:34px; }
  .acct-back{ display:flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:8px; border:1px solid var(--a-rule); background:var(--a-paper); color:var(--a-ink-soft); cursor:pointer; flex-shrink:0; margin-top:3px; transition:border-color .15s ease, color .15s ease; }
  .acct-back:hover{ border-color:var(--a-accent); color:var(--a-accent); }
  .acct-title{ font-family:var(--a-font-serif); font-style:italic; font-weight:600; font-size:30px; letter-spacing:-0.3px; margin:0 0 6px; }
  .acct-sub{ font-size:13.5px; color:var(--a-muted); max-width:560px; line-height:1.5; }

  .acct-grid{ display:grid; grid-template-columns:220px 1fr; gap:36px; align-items:flex-start; }
  @media (max-width: 860px){ .acct-grid{ grid-template-columns:1fr; } }

  .acct-nav{ position:sticky; top:24px; display:flex; flex-direction:column; gap:2px; }
  .acct-nav-btn{ display:flex; align-items:center; gap:10px; padding:10px 14px; border-radius:9px; border:1px solid transparent; background:none; color:var(--a-ink-soft); font-family:var(--a-font-sans); font-size:13.5px; text-align:left; cursor:pointer; transition:background .15s ease, color .15s ease; }
  .acct-nav-btn svg{ flex-shrink:0; opacity:.85; }
  .acct-nav-btn:hover{ background:var(--a-paper-2); color:var(--a-ink); }
  .acct-nav-btn.active{ background:var(--a-accent-soft); color:var(--a-accent); font-weight:600; border-color:var(--a-accent-soft); }

  .acct-main{ display:flex; flex-direction:column; gap:22px; min-width:0; }
  .acct-card{ background:var(--a-card); border:1px solid var(--a-rule); border-radius:14px; padding:26px 28px; box-shadow:0 1px 2px rgba(0,0,0,.03); }
  .acct-card-head{ display:flex; align-items:center; gap:10px; margin-bottom:4px; }
  .acct-card-head svg{ color:var(--a-accent); }
  .acct-card-title{ font-family:var(--a-font-serif); font-style:italic; font-weight:600; font-size:18px; }
  .acct-card-desc{ font-size:12.5px; color:var(--a-muted); margin:4px 0 20px; line-height:1.5; }

  .acct-profile-row{ display:flex; align-items:center; gap:16px; margin-bottom:24px; }
  .acct-avatar{ width:58px; height:58px; border-radius:50%; background:var(--a-accent); color:var(--a-on-accent,#FBF7EE); display:flex; align-items:center; justify-content:center; font-family:var(--a-font-serif); font-weight:600; font-size:21px; flex-shrink:0; }
  .acct-profile-meta .name{ font-weight:600; font-size:15.5px; }
  .acct-profile-meta .sub{ font-size:12px; color:var(--a-muted); margin-top:2px; font-family:var(--a-font-mono); }

  .acct-field-grid{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  @media (max-width: 560px){ .acct-field-grid{ grid-template-columns:1fr; } }
  .acct-field{ display:flex; flex-direction:column; gap:6px; }
  .acct-field.full{ grid-column:1/-1; }
  .acct-field label{ font-size:11.5px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--a-muted); }
  .acct-field input{ font-family:var(--a-font-sans); font-size:13.5px; padding:10px 12px; border-radius:8px; border:1px solid var(--a-rule); background:var(--a-paper); color:var(--a-ink); outline:none; transition:border-color .15s ease; }
  .acct-field input:focus{ border-color:var(--a-accent); }
  .acct-field input:disabled{ color:var(--a-muted); cursor:not-allowed; opacity:.75; }
  .acct-field .hint{ font-size:11px; color:var(--a-muted); }

  .acct-actions{ display:flex; align-items:center; gap:10px; margin-top:20px; }
  .acct-btn{ font-family:var(--a-font-sans); font-size:13px; font-weight:600; padding:9px 18px; border-radius:8px; cursor:pointer; border:1px solid transparent; transition:opacity .15s ease, background .15s ease; }
  .acct-btn.primary{ background:var(--a-accent); color:#FBF7EE; }
  .acct-btn.primary:hover{ opacity:.9; }
  .acct-btn.primary:disabled{ opacity:.5; cursor:not-allowed; }
  .acct-btn.ghost{ background:none; border-color:var(--a-rule); color:var(--a-ink-soft); }
  .acct-btn.ghost:hover{ border-color:var(--a-accent); color:var(--a-accent); }
  .acct-msg{ font-size:12.5px; display:flex; align-items:center; gap:6px; }
  .acct-msg.ok{ color:var(--a-good); }
  .acct-msg.bad{ color:var(--a-bad); }

  .acct-divider{ height:1px; background:var(--a-rule); margin:22px 0; }

  .acct-pref-row{ display:flex; align-items:center; justify-content:space-between; padding:14px 0; border-bottom:1px solid var(--a-paper-2); }
  .acct-pref-row:last-child{ border-bottom:none; }
  .acct-pref-label{ font-size:13.5px; font-weight:600; }
  .acct-pref-desc{ font-size:12px; color:var(--a-muted); margin-top:2px; }
  .acct-theme-switch{ display:flex; border:1px solid var(--a-rule); border-radius:999px; padding:3px; gap:2px; background:var(--a-paper); }
  .acct-theme-opt{ display:flex; align-items:center; gap:6px; padding:7px 14px; border-radius:999px; font-size:12.5px; font-weight:600; background:none; border:none; color:var(--a-muted); cursor:pointer; }
  .acct-theme-opt.active{ background:var(--a-accent); color:#FBF7EE; }

  .acct-strength{ display:flex; gap:4px; margin-top:4px; }
  .acct-strength span{ height:4px; flex:1; border-radius:2px; background:var(--a-rule); }
  .acct-strength span.on-1{ background:var(--a-bad); }
  .acct-strength span.on-2{ background:var(--a-major,#D9AD5C); }
  .acct-strength span.on-3, .acct-strength span.on-4{ background:var(--a-good); }

  .acct-about-row{ display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--a-paper-2); font-size:13px; }
  .acct-about-row:last-child{ border-bottom:none; }
  .acct-about-row .k{ color:var(--a-muted); }
  .acct-about-row .v{ font-weight:600; font-family:var(--a-font-mono); font-size:12.5px; }
  .acct-badge{ display:inline-flex; align-items:center; gap:6px; font-family:var(--a-font-mono); font-size:11px; color:var(--a-accent); background:var(--a-accent-soft); padding:5px 11px; border-radius:999px; margin-top:4px; }
`;

function passwordScore(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

function SectionNav({ active, onSelect }) {
  const items = [
    { id: 'profile', label: 'Profile', icon: AIcon.user },
    { id: 'security', label: 'Security', icon: AIcon.shield },
    { id: 'preferences', label: 'Preferences', icon: AIcon.sliders },
    { id: 'about', label: 'About', icon: AIcon.info },
  ];
  return (
    <nav className="acct-nav">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`acct-nav-btn${active === it.id ? ' active' : ''}`}
          onClick={() => onSelect(it.id)}
        >
          {it.icon(15)}{it.label}
        </button>
      ))}
    </nav>
  );
}

function ProfileSection({ user, setUser }) {
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }
  // AuthContext resolves `user` asynchronously (GET /api/auth/me on page
  // load) — on a hard reload this component mounts before that resolves,
  // so the useState initial values above capture an empty user. Sync once
  // real user data arrives, but never after the advocate has started
  // editing (a background refresh mid-edit must not clobber their draft).
  const hydrated = useRef(false);
  const dirtyRef = useRef(false);
  React.useEffect(() => {
    if (!user || dirtyRef.current) return;
    if (!hydrated.current) {
      setName(user.name || '');
      setPhone(user.phone || '');
      hydrated.current = true;
    }
  }, [user]);
  const dirty = name !== (user?.name || '') || phone !== (user?.phone || '');
  React.useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  const monogram = (user?.name || 'L').trim().charAt(0).toUpperCase();
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short' })
    : null;

  const save = async () => {
    if (!name.trim()) { setMsg({ ok: false, text: 'Name cannot be empty.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save your profile.');
      setUser((u) => ({ ...u, ...data.user }));
      setMsg({ ok: true, text: 'Profile updated.' });
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="acct-card">
      <div className="acct-card-head">{AIcon.user(17)}<span className="acct-card-title">Profile</span></div>
      <div className="acct-card-desc">Your name and contact details, as they appear across LexAmplify — matter notes, generated drafts and shared documents.</div>

      <div className="acct-profile-row">
        <div className="acct-avatar">{monogram}</div>
        <div className="acct-profile-meta">
          <div className="name">{user?.name || 'Advocate'}</div>
          <div className="sub">{user?.role || 'Lawyer'}{memberSince ? ` · Member since ${memberSince}` : ''}</div>
        </div>
      </div>

      <div className="acct-field-grid">
        <div className="acct-field">
          <label htmlFor="acct-name">Full name</label>
          <input id="acct-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" />
        </div>
        <div className="acct-field">
          <label htmlFor="acct-phone">Phone</label>
          <input id="acct-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98XXXXXXXX" />
        </div>
        <div className="acct-field full">
          <label htmlFor="acct-email">Email address</label>
          <input id="acct-email" value={user?.email || ''} disabled />
          <span className="hint">Your email is your sign-in ID and can't be changed here.</span>
        </div>
      </div>

      <div className="acct-actions">
        <button type="button" className="acct-btn primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
        {msg && <span className={`acct-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.ok && AIcon.check(13)}{msg.text}</span>}
      </div>
    </div>
  );
}

function SecuritySection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const score = passwordScore(next);
  const strengthLabel = ['Too short', 'Weak', 'Okay', 'Strong', 'Very strong'][score];

  const submit = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (!current || !next) { setMsg({ ok: false, text: 'Fill in your current and new password.' }); return; }
    if (next.length < 8) { setMsg({ ok: false, text: 'New password must be at least 8 characters.' }); return; }
    if (next !== confirm) { setMsg({ ok: false, text: 'New password and confirmation do not match.' }); return; }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not change your password.');
      setMsg({ ok: true, text: 'Password changed successfully.' });
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e2) {
      setMsg({ ok: false, text: e2.message || 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="acct-card">
      <div className="acct-card-head">{AIcon.shield(17)}<span className="acct-card-title">Security</span></div>
      <div className="acct-card-desc">Change the password used to sign in to LexAmplify. You'll stay signed in on this device after changing it.</div>

      <form onSubmit={submit}>
        <div className="acct-field-grid">
          <div className="acct-field full">
            <label htmlFor="acct-cur-pw">Current password</label>
            <input id="acct-cur-pw" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="acct-field">
            <label htmlFor="acct-new-pw">New password</label>
            <input id="acct-new-pw" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            {next && (
              <>
                <div className="acct-strength">
                  {[0, 1, 2, 3].map((i) => <span key={i} className={i < score ? `on-${score}` : ''} />)}
                </div>
                <span className="hint">{strengthLabel}</span>
              </>
            )}
          </div>
          <div className="acct-field">
            <label htmlFor="acct-confirm-pw">Confirm new password</label>
            <input id="acct-confirm-pw" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
        </div>
        <div className="acct-actions">
          <button type="submit" className="acct-btn primary" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
          {msg && <span className={`acct-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.ok && AIcon.check(13)}{msg.text}</span>}
        </div>
      </form>
    </div>
  );
}

function PreferencesSection() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="acct-card">
      <div className="acct-card-head">{AIcon.sliders(17)}<span className="acct-card-title">Preferences</span></div>
      <div className="acct-card-desc">How LexAmplify looks on this device.</div>

      <div className="acct-pref-row">
        <div>
          <div className="acct-pref-label">Appearance</div>
          <div className="acct-pref-desc">Switch between a light workspace and a dark one — applies everywhere, instantly.</div>
        </div>
        <div className="acct-theme-switch">
          <button type="button" className={`acct-theme-opt${theme !== 'dark' ? ' active' : ''}`} onClick={() => theme === 'dark' && toggleTheme()}>{AIcon.sun(13)}Light</button>
          <button type="button" className={`acct-theme-opt${theme === 'dark' ? ' active' : ''}`} onClick={() => theme !== 'dark' && toggleTheme()}>{AIcon.moon(13)}Dark</button>
        </div>
      </div>
    </div>
  );
}

function AboutSection({ user }) {
  return (
    <div className="acct-card">
      <div className="acct-card-head">{AIcon.info(17)}<span className="acct-card-title">About this account</span></div>
      <div className="acct-card-desc">Where your account stands, at a glance.</div>
      <div className="acct-about-row"><span className="k">Workspace</span><span className="v">LexAmplify</span></div>
      <div className="acct-about-row"><span className="k">Account role</span><span className="v">{user?.role || 'Lawyer'}</span></div>
      <div className="acct-about-row"><span className="k">Signed in as</span><span className="v">{user?.email || '—'}</span></div>
      <span className="acct-badge">{AIcon.shuffle(11)} Operating strictly under Indian Law</span>
    </div>
  );
}

export default function AccountSettings() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [section, setSection] = useState('profile');

  return (
    <div className="acct-page">
      <style>{ACCOUNT_SETTINGS_STYLES}</style>
      <div className="acct-shell">
        <div className="acct-head">
          <button type="button" className="acct-back" onClick={() => navigate(-1)} aria-label="Go back" title="Go back">{AIcon.back()}</button>
          <div>
            <h1 className="acct-title">Account settings</h1>
            <div className="acct-sub">Manage your profile, password and how LexAmplify looks — changes here apply only to your own account.</div>
          </div>
        </div>

        <div className="acct-grid">
          <SectionNav active={section} onSelect={setSection} />
          <div className="acct-main">
            {section === 'profile' && <ProfileSection user={user} setUser={setUser} />}
            {section === 'security' && <SecuritySection />}
            {section === 'preferences' && <PreferencesSection />}
            {section === 'about' && <AboutSection user={user} />}
          </div>
        </div>
      </div>
    </div>
  );
}
