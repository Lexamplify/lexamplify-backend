import { useState } from 'react';
import * as Ic from '../icons.jsx';

const TABS = ['Profile', 'Chambers', 'Security', 'Appearance'];

function Row({ label, hint, children }) {
  return (
    <div className="lx-between" style={{ padding: '18px 0', borderBottom: '1px solid var(--rule)', gap: 24, alignItems: 'flex-start' }}>
      <div style={{ maxWidth: 300 }}>
        <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14.5 }}>{label}</div>
        {hint && <div className="lx-muted" style={{ marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div style={{ flex: 1, maxWidth: 360 }}>{children}</div>
    </div>
  );
}

const field = { width: '100%', height: 44, border: '1px solid var(--rule)', borderRadius: 10, padding: '0 14px', fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--ink)', background: 'var(--bg-card)', outline: 'none' };

export default function Settings() {
  const [tab, setTab] = useState('Profile');

  return (
    <div className="lx-page lx-rise" style={{ maxWidth: 900 }}>
      <div className="ph">
        <span className="ph__eyebrow">Account</span>
        <h1 className="ph__title">Settings</h1>
        <p className="ph__sub">Manage your profile, chambers and how Lexamplify works for you.</p>
      </div>

      <div className="lx-row" style={{ gap: 6, marginBottom: 22, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className="lx-btn lx-btn--sm"
            style={tab === t ? { background: 'var(--ink)', color: 'var(--paper)' } : { background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--rule)' }}>{t}</button>
        ))}
      </div>

      <div className="lx-card lx-card--pad">
        {tab === 'Profile' && (<>
          <Row label="Full name" hint="As it appears on drafts and filings."><input style={field} defaultValue="Aarav Advocate" /></Row>
          <Row label="Enrolment" hint="Bar Council of Delhi."><input style={field} defaultValue="D/1123/2014" /></Row>
          <Row label="Email"><input style={field} defaultValue="aarav@advocatechambers.in" /></Row>
          <Row label="Signature block" hint="Appended to generated documents."><textarea style={{ ...field, height: 90, padding: 14, resize: 'vertical' }} defaultValue={'Aarav Advocate\nAdvocate, Delhi High Court'} /></Row>
        </>)}
        {tab === 'Chambers' && (<>
          <Row label="Chambers name"><input style={field} defaultValue="Advocate Chambers" /></Row>
          <Row label="Primary court"><input style={field} defaultValue="Delhi High Court" /></Row>
          <Row label="Team" hint="Counsel with access to this workspace."><div className="lx-muted">3 members · <span className="gold-text" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>Invite</span></div></Row>
        </>)}
        {tab === 'Security' && (<>
          <Row label="Two-factor authentication" hint="Required for all privileged matters."><span className="lx-badge lx-badge--ok"><Ic.Shield size={12} /> Enabled</span></Row>
          <Row label="Data residency" hint="Where your matters are stored."><span className="lx-badge">India · AES-256</span></Row>
          <Row label="Model training" hint="Your data is never used to train models."><span className="lx-badge lx-badge--ok"><Ic.Check size={12} /> Excluded</span></Row>
          <Row label="Active sessions"><button className="lx-btn lx-btn--ghost lx-btn--sm">Sign out other devices</button></Row>
        </>)}
        {tab === 'Appearance' && (<>
          <Row label="Theme" hint="Warm luxury — ivory & forest green."><div className="lx-row" style={{ gap: 8 }}><span className="lx-badge">Light</span><span className="lx-muted">Dark · soon</span></div></Row>
          <Row label="Density" hint="Spacing of lists and tables."><div className="lx-row" style={{ gap: 8 }}><button className="lx-btn lx-btn--sm" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>Comfortable</button><button className="lx-btn lx-btn--sm" style={{ background: 'transparent', border: '1px solid var(--rule)', color: 'var(--ink-soft)' }}>Compact</button></div></Row>
        </>)}
        <div className="lx-row" style={{ gap: 10, marginTop: 24 }}>
          <button className="lx-btn lx-btn--primary">Save changes</button>
          <button className="lx-btn lx-btn--ghost">Cancel</button>
        </div>
      </div>
    </div>
  );
}
