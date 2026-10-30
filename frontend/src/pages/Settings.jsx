import { useState, useEffect, useCallback } from 'react';
import * as Ic from '../icons.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../store/useSettings.js';
import Modal from '../components/Modal.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

const TABS = ['Profile', 'Chambers', 'Team', 'Billing', 'Notifications', 'Integrations', 'Security', 'Appearance'];

function Row({ label, hint, children }) {
  return (
    <div className="lx-between" style={{ padding: '18px 0', borderBottom: '1px solid var(--rule)', gap: 24, alignItems: 'flex-start' }}>
      <div style={{ maxWidth: 300 }}>
        <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14.5 }}>{label}</div>
        {hint && <div className="lx-muted" style={{ marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div style={{ flex: 1, maxWidth: 380 }}>{children}</div>
    </div>
  );
}
const field = { width: '100%', height: 44, border: '1px solid var(--rule)', borderRadius: 10, padding: '0 14px', fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--ink)', background: 'var(--bg-card)', outline: 'none' };
const fieldRO = { ...field, background: 'var(--bg-soft, var(--bg-card))', color: 'var(--ink-soft)', opacity: .85 };
function Toggle({ on = true }) {
  const [v, setV] = useState(on);
  return <button onClick={() => setV(!v)} style={{ width: 44, height: 26, borderRadius: 999, border: 0, background: v ? 'var(--accent)' : 'var(--rule)', position: 'relative', transition: 'background .2s' }}>
    <span style={{ position: 'absolute', top: 3, left: v ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} /></button>;
}

// Segmented control that reads/writes the shared useSettings store so
// appearance choices actually drive the live theme (same store Theme Studio uses).
function Seg({ options, value, onChange }) {
  return (
    <div className="lx-row" style={{ gap: 8 }}>
      {options.map(([id, name]) => {
        const on = value === id;
        return (
          <button key={id} className="lx-btn lx-btn--sm" onClick={() => onChange(id)}
            style={on
              ? { background: 'var(--ink)', color: 'var(--paper)' }
              : { background: 'transparent', border: '1px solid var(--rule)', color: 'var(--ink-soft)' }}>
            {name}
          </button>
        );
      })}
    </div>
  );
}

// Integration descriptions are static product information (not user data).
const INTEGRATIONS = [
  ['eCourts', 'Live case sync from eCourts'],
  ['Google Drive', 'Save drafts to Drive'],
  ['Outlook Calendar', 'Push hearings to your calendar'],
  ['WhatsApp', 'Hearing reminders on WhatsApp'],
];

export default function Settings() {
  const [tab, setTab] = useState('Profile');
  const { user, logout } = useAuth();
  const s = useSettings();

  // ── Account (GET /api/auth/me, falling back to the signed-in user) ──
  const [me, setMe] = useState(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [meErr, setMeErr] = useState('');
  // Practice membership (GET /api/practice/me) — firm + LPMS role for this user
  const [practice, setPractice] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
        if (!res.ok) {
          if (alive) setMeErr(res.status === 401 ? 'Your session has expired. Please sign in again.' : 'Could not load your account.');
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (alive) setMe(data.user || data || null);
      } catch {
        if (alive) setMeErr('Could not reach the server.');
      } finally {
        if (alive) setLoadingMe(false);
      }
    })();
    // Load LPMS membership in parallel — may 404 or 403 for users not in a firm; that's fine.
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/practice/me`, { credentials: 'include' });
        if (r.ok) {
          const d = await r.json().catch(() => null);
          if (alive && d) setPractice(d);
        }
      } catch { /* no practice yet — leave null */ }
    })();
    return () => { alive = false; };
  }, []);

  const acct = me || user || null;
  const acctName = (acct?.name || acct?.full_name || '').trim();
  const acctEmail = acct?.email || '';
  const acctRole = acct?.role || '';
  const acctPhone = acct?.phone || '';
  const monogram = (acctName || acctEmail || 'L').trim().charAt(0).toUpperCase();
  const memberSince = acct?.created_at
    ? new Date(acct.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short' })
    : null;
  // Practice-level info
  const firmName = practice?.firm?.name || '';
  const lpmsRoleLabel = practice?.member?.role_label || (practice?.member?.role ? practice.member.role : '');
  const joinedAt = practice?.member?.created_at
    ? new Date(practice.member.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

  // ── Change password (POST /api/auth/change-password) ──
  const [cur, setCur] = useState('');
  const [npw, setNpw] = useState('');
  const [cpw, setCpw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState(null); // { ok, text }

  const changePassword = async (e) => {
    e.preventDefault();
    setPwMsg(null);
    if (!cur || !npw) { setPwMsg({ ok: false, text: 'Fill in your current and new password.' }); return; }
    if (npw.length < 8) { setPwMsg({ ok: false, text: 'New password must be at least 8 characters.' }); return; }
    if (npw !== cpw) { setPwMsg({ ok: false, text: 'New password and confirmation do not match.' }); return; }
    setPwBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/change-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ current_password: cur, new_password: npw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) throw new Error('Your session has expired. Please sign in again.');
        throw new Error(data.error || 'Could not change your password.');
      }
      setPwMsg({ ok: true, text: 'Password changed successfully.' });
      setCur(''); setNpw(''); setCpw('');
    } catch (e2) {
      setPwMsg({ ok: false, text: e2.message || 'Something went wrong.' });
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="lx-page lx-rise" style={{ maxWidth: 940 }}>
      <div className="ph">
        <span className="ph__eyebrow">Account</span>
        <h1 className="ph__title">Settings</h1>
        <p className="ph__sub">Manage your profile, chambers and how Lexamplify works for you.</p>
      </div>

      <div className="tabs" style={{ marginBottom: 24 }}>
        {TABS.map((t) => <button key={t} className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      <div className="lx-card lx-card--pad">
        {tab === 'Profile' && (<>
          {meErr && <div className="lx-badge lx-badge--risk" style={{ marginBottom: 6 }}>{meErr}</div>}
          <Row label="Full name" hint="As it appears on drafts and filings.">
            <input style={fieldRO} value={loadingMe ? 'Loading…' : (acctName || '—')} readOnly />
          </Row>
          <Row label="Email" hint="Your sign-in ID.">
            <input style={fieldRO} value={loadingMe ? 'Loading…' : (acctEmail || '—')} readOnly />
          </Row>
          <Row label="Role" hint="Your access level in this workspace.">
            <span className="lx-badge">{loadingMe ? '…' : (lpmsRoleLabel || acctRole || 'Lawyer')}</span>
          </Row>
          {firmName && (
            <Row label="Practice" hint="The firm or chambers you belong to.">
              <div className="lx-row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 16, color: 'var(--ink)' }}>{firmName}</span>
                {joinedAt && <span className="lx-muted" style={{ fontSize: 12.5 }}>· Joined {joinedAt}</span>}
              </div>
            </Row>
          )}
          {acctPhone && (
            <Row label="Phone"><input style={fieldRO} value={acctPhone} readOnly /></Row>
          )}
          <Row label="Member since" hint="When your account was created.">
            <span className="lx-badge">{memberSince || '—'}</span>
          </Row>
          <div className="lx-row" style={{ gap: 10, marginTop: 24 }}>
            <button className="lx-btn lx-btn--ghost" onClick={() => logout()}><Ic.Arrow size={15} /> Sign out</button>
          </div>
        </>)}

        {tab === 'Chambers' && (<>
          {!firmName ? (
            <div className="lx-empty" style={{ padding: '28px 0' }}>
              <div className="lx-empty__ico"><Ic.Scale size={22} /></div>
              <h4>No practice yet</h4>
              <p>Head to Matters to set up your practice. Chambers details appear here once it exists.</p>
            </div>
          ) : (
            <>
              <Row label="Practice name" hint={practice?.member?.role === 'senior' ? 'Rename this from the Matters page (click the pencil next to the name).' : 'Only a Senior Advocate can rename the practice.'}>
                <input style={fieldRO} value={firmName} readOnly />
              </Row>
              <Row label="Your role" hint="Decides what you can see and do in the practice.">
                <span className="lx-badge">{lpmsRoleLabel || '—'}</span>
              </Row>
              {joinedAt && (
                <Row label="You joined" hint="When you were added to this practice.">
                  <span className="lx-badge">{joinedAt}</span>
                </Row>
              )}
            </>
          )}
        </>)}

        {tab === 'Team' && <TeamSection />}

        {tab === 'Billing' && (
          <div className="lx-empty" style={{ padding: '32px 0' }}>
            <p>No billing information is available for your account yet.</p>
          </div>
        )}

        {tab === 'Notifications' && (<>
          <EmailAlertSettings />
          {[['Hearing reminders', 'The evening before and morning of a hearing'], ['Limitation alerts', 'When a deadline is within 7 days'], ['Draft ready', 'When the AI finishes a draft'], ['Weekly digest', 'A Monday summary of your week']].map(([l, h], i) => (
            <Row key={i} label={l} hint={h}><div style={{ display: 'flex', justifyContent: 'flex-end' }}><Toggle on={i < 3} /></div></Row>
          ))}
        </>)}

        {tab === 'Integrations' && (<>
          <div className="lx-list">
            {INTEGRATIONS.map(([n, d], i) => (
              <div className="lx-item" key={i}><div className="lx-item__ico"><Ic.Sliders size={16} /></div>
                <div className="lx-item__body"><div className="lx-item__title" style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14.5 }}>{n}</div><div className="lx-item__meta">{d}</div></div>
                <button className="lx-btn lx-btn--ghost lx-btn--sm">Connect</button></div>
            ))}
          </div>
        </>)}

        {tab === 'Security' && (<>
          <form onSubmit={changePassword}>
            <Row label="Current password" hint="Required to confirm the change.">
              <input style={field} type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
            </Row>
            <Row label="New password" hint="At least 8 characters.">
              <input style={field} type="password" autoComplete="new-password" value={npw} onChange={(e) => setNpw(e.target.value)} />
            </Row>
            <Row label="Confirm new password">
              <input style={field} type="password" autoComplete="new-password" value={cpw} onChange={(e) => setCpw(e.target.value)} />
            </Row>
            <div className="lx-row" style={{ gap: 10, marginTop: 24, alignItems: 'center' }}>
              <button type="submit" className="lx-btn lx-btn--primary" disabled={pwBusy}>{pwBusy ? 'Updating…' : 'Update password'}</button>
              {pwMsg && <span className={`lx-badge ${pwMsg.ok ? 'lx-badge--ok' : 'lx-badge--risk'}`}>{pwMsg.ok && <Ic.Check size={12} />} {pwMsg.text}</span>}
            </div>
          </form>

          <div style={{ marginTop: 10 }}>
            <Row label="Data residency" hint="Where your matters are stored."><span className="lx-badge">India · AES-256</span></Row>
            <Row label="Model training" hint="Your data is never used to train models."><span className="lx-badge lx-badge--ok"><Ic.Check size={12} /> Excluded</span></Row>
          </div>
        </>)}

        {tab === 'Appearance' && (<>
          <Row label="Theme & accent" hint="Open Theme Studio (bottom-right) for the full palette.">
            <span className="lx-badge">{s.theme} · {s.layout} layout</span>
          </Row>
          <Row label="Density" hint="Spacing of lists and tables.">
            <Seg options={[['comfortable', 'Comfortable'], ['compact', 'Compact']]} value={s.density} onChange={(v) => s.update({ density: v })} />
          </Row>
          <Row label="Text size" hint="Base reading size across the app.">
            <Seg options={[['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']]} value={s.text} onChange={(v) => s.update({ text: v })} />
          </Row>
          <Row label="Motion" hint="Reduce animations if you prefer.">
            <Seg options={[['full', 'Full'], ['reduced', 'Reduced']]} value={s.motion} onChange={(v) => s.update({ motion: v })} />
          </Row>
        </>)}
      </div>
    </div>
  );
}

/**
 * Email alert settings — persisted via /api/settings/notifications.
 * Lets the user add an email + toggle alerts on/off. SMTP delivery requires
 * backend/.env SMTP_* credentials; without them, the backend logs the attempt.
 */
function EmailAlertSettings() {
  const [email, setEmail] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/settings/notifications`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setEmail(d.alert_email || '');
          setEnabled(!!d.email_alerts_enabled);
        }
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    setStatus('');
    try {
      const r = await fetch(`${API_BASE}/api/settings/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        credentials: 'include',
        body: JSON.stringify({ email_alerts_enabled: enabled, alert_email: email }),
      });
      setStatus(r.ok ? 'saved' : 'failed');
    } catch {
      setStatus('failed');
    } finally {
      setSaving(false);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  return (
    <>
      <Row label="Email alerts" hint="Send IP renewal alerts and critical notifications to this address. Email delivery requires SMTP configuration by your administrator.">
        <div className="lx-stack" style={{ gap: 10 }}>
          <div className="lx-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Enable email alerts</span>
            <button
              type="button"
              onClick={() => setEnabled((v) => !v)}
              style={{
                width: 44, height: 26, borderRadius: 999, border: 0,
                background: enabled ? 'var(--accent)' : 'var(--rule)',
                position: 'relative', cursor: 'pointer', transition: 'background .2s',
              }}
            >
              <span style={{
                position: 'absolute', top: 3, left: enabled ? 21 : 3,
                width: 20, height: 20, borderRadius: '50%', background: '#fff',
                transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
              }} />
            </button>
          </div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!enabled}
            placeholder="you@example.com"
            style={{ ...field, opacity: enabled ? 1 : 0.6 }}
          />
          <div className="lx-row" style={{ gap: 10, alignItems: 'center' }}>
            <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {status === 'saved' && <span style={{ fontSize: 12.5, color: 'var(--good, #16a34a)' }}>✓ Saved</span>}
            {status === 'failed' && <span style={{ fontSize: 12.5, color: 'var(--risk, #ef4444)' }}>Failed to save</span>}
          </div>
        </div>
      </Row>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
 * TEAM SECTION  — ported from legacy /practice Team.jsx
 *   Fetches your firm's members, lets a Senior Advocate add / edit / deactivate.
 *   Uses the merged LPMS backend endpoints under /api/practice.
 * ────────────────────────────────────────────────────────────────────────────── */

const ROLE_LABEL = { senior: 'Senior Advocate', junior: 'Junior Advocate', staff: 'Office Staff' };
const ROLE_HINT  = {
  senior: 'Sees every case, creates cases and accounts, runs all reports and settings.',
  junior: 'Records proceedings and notes on assigned cases, uploads documents.',
  staff:  'Appointments, client details, document filing and a few reports.',
};

function TeamSection() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [edit, setEdit] = useState(null);         // member being edited
  const [canManage, setCanManage] = useState(false);
  const [firmReady, setFirmReady] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/practice/members`, { credentials: 'include' });
      if (r.status === 403) {
        const d = await r.json().catch(() => ({}));
        if (d.code === 'NO_FIRM') { setFirmReady(false); setMembers([]); return; }
        throw new Error(d.message || 'This action is not allowed.');
      }
      if (!r.ok) throw new Error('Could not load members.');
      const data = await r.json();
      setMembers(Array.isArray(data.members) ? data.members : []);
      // Fetch /practice/me to know if you're the Senior who can manage
      const me = await fetch(`${API_BASE}/api/practice/me`, { credentials: 'include' })
        .then((x) => (x.ok ? x.json() : null)).catch(() => null);
      setCanManage(me?.member?.role === 'senior');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!firmReady) {
    return (
      <div className="lx-empty" style={{ padding: '28px 0' }}>
        <div className="lx-empty__ico"><Ic.Users size={22} /></div>
        <h4>Set up your practice first</h4>
        <p>Create your practice from the Matters page to add team members.</p>
      </div>
    );
  }

  return (
    <>
      <div className="lx-between" style={{ padding: '4px 0 14px', alignItems: 'center' }}>
        <div className="lx-muted">
          {loading ? 'Loading…' : `${members.length} member${members.length === 1 ? '' : 's'}`}
        </div>
        {canManage && (
          <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={() => setShowAdd(true)}>
            <Ic.Plus size={14} /> Add member
          </button>
        )}
      </div>

      {err && <div role="alert" style={{ color: 'var(--risk)', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      <div className="lx-list">
        {loading ? (
          <div className="lx-empty"><p>Loading members…</p></div>
        ) : members.length === 0 ? (
          <div className="lx-empty"><p>No team members yet.</p></div>
        ) : members.map((mem) => {
          const initial = (mem.name || mem.email || 'A').trim().charAt(0).toUpperCase();
          return (
            <div className="lx-item" key={mem.id} style={{ padding: '14px 2px' }}>
              <div className="rail__avatar" style={{ width: 38, height: 38, flexShrink: 0 }}>{initial}</div>
              <div className="lx-item__body">
                <div className="lx-item__title" style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14.5 }}>
                  {mem.name || mem.email || 'Member'}
                </div>
                <div className="lx-item__meta">
                  {mem.email}
                  {typeof mem.active_cases === 'number' && mem.active_cases > 0 && (
                    <span style={{ marginLeft: 10, color: 'var(--muted)' }}>· {mem.active_cases} open case{mem.active_cases === 1 ? '' : 's'}</span>
                  )}
                </div>
              </div>
              <span className={`lx-badge ${mem.role === 'senior' ? 'lx-badge--ok' : 'lx-badge--muted'}`} style={{ minWidth: 110, justifyContent: 'center' }}>
                {mem.role_label || ROLE_LABEL[mem.role] || mem.role}
              </span>
              {!mem.active && <span className="lx-badge lx-badge--muted">Inactive</span>}
              {canManage && (
                <button
                  type="button"
                  className="lx-btn lx-btn--ghost lx-btn--sm"
                  style={{ padding: '4px 10px', fontSize: 11 }}
                  onClick={() => setEdit(mem)}
                >
                  Edit
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="lx-muted" style={{ marginTop: 14, fontSize: 13, lineHeight: 1.5 }}>
        Senior Advocates see every case. Juniors see only cases assigned to them, plus any case tagged with a team they're in. Staff see appointments and client contacts.
      </p>

      {/* Groups / teams within the practice — power the shared-case design.
          Tagging a case with a group lets every member of that group see it. */}
      <GroupsSection firmMembers={members} canManage={canManage} />

      {showAdd && (
        <AddMemberModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
        />
      )}
      {edit && (
        <EditMemberModal
          member={edit}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); load(); }}
        />
      )}
    </>
  );
}

/** Add a new firm member. Handles both "create new account" and "link existing LexAmplify user". */
function AddMemberModal({ onClose, onSaved }) {
  const [f, setF] = useState({ email: '', name: '', phone: '', role: 'junior', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [linkExisting, setLinkExisting] = useState(null); // existing user name
  const [madeCreds, setMadeCreds] = useState(null);       // {email, password, name}
  const [copied, setCopied] = useState(false);
  const set = (k) => (e) => { setF((s) => ({ ...s, [k]: e.target.value })); setErr(''); setLinkExisting(null); };

  const generate = () => {
    const alpha = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const v = crypto.getRandomValues(new Uint32Array(12));
    setF((s) => ({ ...s, password: [...v].map((x) => alpha[x % alpha.length]).join('') }));
  };

  const submit = async (e, link = false) => {
    if (e) e.preventDefault();
    if (!f.email.trim()) { setErr('Enter their email address.'); return; }
    if (!link && !linkExisting && !f.name.trim()) { setErr('Name is required for a new account.'); return; }
    if (!link && !linkExisting && f.password.length < 8) { setErr('Give a temporary password of at least 8 characters.'); return; }
    setBusy(true); setErr('');
    try {
      const body = {
        email: f.email.trim(),
        name: f.name.trim() || null,
        phone: f.phone.trim() || null,
        role: f.role,
        password: f.password || null,
        link_existing: link,
      };
      const r = await fetch(`${API_BASE}/api/practice/members`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (data.code === 'EXISTS') {
          setLinkExisting(data.existing_name || 'this person');
          return;
        }
        throw new Error(data.message || 'Could not add member.');
      }
      if (data.managed) {
        setMadeCreds({ email: f.email.trim(), password: f.password, name: f.name });
      } else {
        onSaved();
      }
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const copyCreds = async () => {
    try {
      await navigator.clipboard.writeText(`Email: ${madeCreds.email}\nPassword: ${madeCreds.password}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {}
  };

  if (madeCreds) {
    return (
      <Modal title="Account created" onClose={onSaved}
        footer={<button className="lx-btn lx-btn--primary" onClick={onSaved}>Done</button>}>
        <p style={{ marginTop: 0 }}>
          Give {madeCreds.name || 'them'} these sign-in details.
          <b> Nothing has been emailed.</b> They should change the password after their first sign-in.
        </p>
        <div style={{
          background: 'var(--paper-2, var(--bg-card))', padding: 14, borderRadius: 8,
          border: '1px solid var(--rule)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13,
        }}>
          <div>Email: <b>{madeCreds.email}</b></div>
          <div>Password: <b>{madeCreds.password}</b></div>
        </div>
        <button className="lx-btn lx-btn--ghost lx-btn--sm" style={{ marginTop: 12 }} onClick={copyCreds}>
          {copied ? '✓ Copied' : 'Copy both'}
        </button>
      </Modal>
    );
  }

  return (
    <Modal title="Add a team member" onClose={busy ? () => {} : onClose}
      footer={<>
        <button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
        {linkExisting ? (
          <button className="lx-btn lx-btn--primary" onClick={(e) => submit(e, true)} disabled={busy}>
            {busy ? 'Adding…' : `Add ${linkExisting} to my practice`}
          </button>
        ) : (
          <button className="lx-btn lx-btn--primary" onClick={() => submit()} disabled={busy}>
            {busy ? 'Adding…' : 'Add member'}
          </button>
        )}
      </>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}
      {linkExisting && (
        <div style={{
          marginBottom: 14, padding: '10px 14px', background: 'var(--accent-soft, var(--paper-2))',
          border: '1px solid var(--rule)', borderRadius: 8, fontSize: 13.5,
        }}>
          <b>{f.email}</b> already has a LexAmplify account. You can add them to your practice —
          they'll keep their own password.
        </div>
      )}
      <div><label className="lbl">Email</label>
        <input className="inp" type="email" autoFocus value={f.email} onChange={set('email')} maxLength={160} />
      </div>
      {!linkExisting && (
        <>
          <div><label className="lbl">Full name</label>
            <input className="inp" value={f.name} onChange={set('name')} maxLength={120} placeholder="Needed for a new account" />
          </div>
          <div><label className="lbl">Phone (optional)</label>
            <input className="inp" value={f.phone} onChange={set('phone')} inputMode="tel" maxLength={30} />
          </div>
        </>
      )}
      <div><label className="lbl">Role</label>
        <select className="inp" value={f.role} onChange={set('role')} style={{ background: 'var(--bg-card)' }}>
          <option value="junior">{ROLE_LABEL.junior}</option>
          <option value="senior">{ROLE_LABEL.senior}</option>
          <option value="staff">{ROLE_LABEL.staff}</option>
        </select>
        <div className="lx-muted" style={{ fontSize: 12.5, marginTop: 4 }}>{ROLE_HINT[f.role]}</div>
      </div>
      {!linkExisting && (
        <div>
          <label className="lbl">Temporary password</label>
          <div className="lx-row" style={{ gap: 8 }}>
            <input className="inp" value={f.password} onChange={set('password')} autoComplete="new-password" maxLength={100} placeholder="At least 8 characters" />
            <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm" onClick={generate}>Generate</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Edit a member — change role or deactivate. */
function EditMemberModal({ member, onClose, onSaved }) {
  const [role, setRole] = useState(member.role);
  const [active, setActive] = useState(member.active !== false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/practice/members/${member.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ role, active: active ? 1 : 0 }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.message || 'Could not save changes.');
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit ${member.name || member.email}`} onClose={onClose}
      footer={<>
        <button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="lx-btn lx-btn--primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}
      <div><label className="lbl">Role</label>
        <select className="inp" value={role} onChange={(e) => setRole(e.target.value)} style={{ background: 'var(--bg-card)' }}>
          <option value="junior">{ROLE_LABEL.junior}</option>
          <option value="senior">{ROLE_LABEL.senior}</option>
          <option value="staff">{ROLE_LABEL.staff}</option>
        </select>
        <div className="lx-muted" style={{ fontSize: 12.5, marginTop: 4 }}>{ROLE_HINT[role]}</div>
      </div>
      <div className="lx-between" style={{ marginTop: 14, padding: '12px 0', borderTop: '1px solid var(--rule)' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Active</div>
          <div className="lx-muted" style={{ fontSize: 12.5 }}>
            Deactivating prevents sign-in but keeps the person's history.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setActive((v) => !v)}
          style={{
            width: 44, height: 26, borderRadius: 999, border: 0,
            background: active ? 'var(--accent)' : 'var(--rule)',
            position: 'relative', cursor: 'pointer', transition: 'background .2s',
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: active ? 21 : 3,
            width: 20, height: 20, borderRadius: '50%', background: '#fff',
            transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
          }} />
        </button>
      </div>
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
 * GROUPS SECTION — teams within the practice. A case tagged with a group is
 * shared with everyone in that group (collaborative access, per the Model B
 * SQL filter in utils/lpms_store.py:case_visible_sql).
 * ────────────────────────────────────────────────────────────────────────────── */

function GroupsSection({ firmMembers, canManage }) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [manage, setManage] = useState(null);     // {id, name} being managed

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/teams`, { credentials: 'include' });
      if (!r.ok) throw new Error('Could not load groups.');
      const d = await r.json();
      setTeams(Array.isArray(d.teams) ? d.teams : []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ marginTop: 30, paddingTop: 20, borderTop: '1px solid var(--rule)' }}>
      <div className="lx-between" style={{ padding: '0 0 14px', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, fontFamily: 'var(--font-serif)' }}>Groups within your practice</h3>
          <p className="lx-muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
            Add people to a group so every member sees cases tagged with that group.
          </p>
        </div>
      </div>

      {err && <div role="alert" style={{ color: 'var(--risk)', fontSize: 13, marginBottom: 10 }}>{err}</div>}

      <div className="lx-list">
        {loading ? (
          <div className="lx-empty" style={{ padding: '14px 0' }}><p>Loading groups…</p></div>
        ) : teams.length === 0 ? (
          <div className="lx-empty" style={{ padding: '14px 0' }}>
            <p>No groups yet. Create one from the Matters page ("New team" button).</p>
          </div>
        ) : teams.map((t) => (
          <div className="lx-item" key={t.id} style={{ padding: '12px 2px' }}>
            <div className="lx-item__ico"><Ic.Users size={16} /></div>
            <div className="lx-item__body">
              <div className="lx-item__title" style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14.5 }}>{t.name}</div>
              {t.description && <div className="lx-item__meta">{t.description}</div>}
            </div>
            <button
              type="button"
              className="lx-btn lx-btn--ghost lx-btn--sm"
              onClick={() => setManage(t)}
            >
              Manage members
            </button>
          </div>
        ))}
      </div>

      {manage && (
        <ManageGroupModal
          team={manage}
          firmMembers={firmMembers}
          canManage={canManage}
          onClose={() => setManage(null)}
        />
      )}
    </div>
  );
}

/** Manage a group's roster — add from firm members, remove existing. */
function ManageGroupModal({ team, firmMembers, canManage, onClose }) {
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [toAdd, setToAdd] = useState('');       // selected user_id to add

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/teams/${team.id}/roster`, { credentials: 'include' });
      if (!r.ok) throw new Error('Could not load this group.');
      const d = await r.json();
      setRoster(Array.isArray(d.roster) ? d.roster : []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [team.id]);

  useEffect(() => { load(); }, [load]);

  // Firm members not already in the group — eligible to be added.
  const inGroupIds = new Set(roster.map((r) => r.user_id));
  const eligible = (firmMembers || []).filter(
    (fm) => fm.user_id && fm.active !== false && !inGroupIds.has(fm.user_id),
  );

  const add = async () => {
    const uid = Number(toAdd);
    if (!uid) { setErr('Pick someone to add first.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/teams/${team.id}/members`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ user_id: uid }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || 'Could not add that person.');
      setToAdd('');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/teams/${team.id}/members/${userId}`, {
        method: 'DELETE', credentials: 'include',
        headers: { 'X-CSRF-TOKEN': csrf() },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || 'Could not remove that person.');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Members of “${team.name}”`} onClose={onClose}
      footer={<button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Close</button>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}

      {/* Add row — Senior / team owner only. */}
      {canManage && (
        <div style={{ padding: '0 0 14px', borderBottom: '1px solid var(--rule)', marginBottom: 14 }}>
          <label className="lbl">Add from your firm</label>
          {eligible.length === 0 ? (
            <div className="lx-muted" style={{ fontSize: 13 }}>
              Everyone in your firm is already in this group.
            </div>
          ) : (
            <div className="lx-row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <select
                className="inp"
                value={toAdd}
                onChange={(e) => setToAdd(e.target.value)}
                style={{ flex: 1, minWidth: 220, background: 'var(--bg-card)' }}
              >
                <option value="">Pick a firm member…</option>
                {eligible.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name || m.email} — {ROLE_LABEL[m.role] || m.role}
                  </option>
                ))}
              </select>
              <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={add} disabled={busy || !toAdd}>
                {busy ? 'Adding…' : 'Add to group'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Current roster */}
      <div className="lbl">In this group ({roster.length})</div>
      <div className="lx-list">
        {loading ? (
          <div className="lx-empty" style={{ padding: '12px 0' }}><p>Loading…</p></div>
        ) : roster.length === 0 ? (
          <div className="lx-empty" style={{ padding: '12px 0' }}><p>Just the owner so far.</p></div>
        ) : roster.map((r) => {
          const initial = (r.name || r.email || 'A').trim().charAt(0).toUpperCase();
          const isOwner = r.role === 'owner';
          return (
            <div className="lx-item" key={r.user_id} style={{ padding: '10px 2px' }}>
              <div className="rail__avatar" style={{ width: 32, height: 32, flexShrink: 0, fontSize: 13 }}>{initial}</div>
              <div className="lx-item__body">
                <div className="lx-item__title" style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14 }}>
                  {r.name || r.email || 'Member'}
                </div>
                <div className="lx-item__meta">{r.email}</div>
              </div>
              <span className={`lx-badge ${isOwner ? 'lx-badge--ok' : 'lx-badge--muted'}`} style={{ minWidth: 70, justifyContent: 'center' }}>
                {isOwner ? 'Owner' : 'Member'}
              </span>
              {canManage && !isOwner && (
                <button
                  type="button"
                  className="lx-btn lx-btn--ghost lx-btn--sm"
                  style={{ padding: '4px 10px', fontSize: 11 }}
                  onClick={() => remove(r.user_id)}
                  disabled={busy}
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
