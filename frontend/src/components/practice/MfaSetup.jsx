import { useState } from 'react';
import { saveBlob } from '../dochub/api.js';
import { Modal } from '../dochub/ui.jsx';
import { PIcon } from './icons.jsx';
import { doneWith, pr } from './api.js';
import { usePractice } from './ctx.js';
import { Card, ErrText, ErrorBox, Field, Loading, useAsync } from './widgets.jsx';

function RecoveryCodes({ codes, onDone }) {
  const { toast } = usePractice();
  const text = `LexAmplify recovery codes\nEach code works once if you lose your phone.\n\n${codes.join('\n')}\n`;
  const copy = async () => { try { await navigator.clipboard.writeText(codes.join('\n')); toast('Codes copied'); } catch { toast('Could not copy. Select the codes and copy them.', { tone: 'bad' }); } };
  const save = () => saveBlob(new Blob([text], { type: 'text/plain' }), 'lexamplify-recovery-codes.txt');
  return (
    <div>
      <div className="dh-banner" style={{ marginBottom: 12 }}><PIcon name="alert" /><div className="body"><b>Save these recovery codes now.</b> They are shown only once. If you lose your phone, each code lets you sign in one time.</div></div>
      <div className="pr-codes" aria-label="Recovery codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
      <div className="pr-actions" style={{ marginTop: 12 }}>
        <button type="button" className="dh-btn ghost" onClick={copy}><PIcon name="copy" />Copy</button>
        <button type="button" className="dh-btn ghost" onClick={save}><PIcon name="download" />Download as a file</button>
        <button type="button" className="dh-btn primary" onClick={onDone}>I have saved them</button>
      </div>
    </div>
  );
}

function CodeModal({ title, label, danger, confirm, onClose, onSubmit, children }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (e) => {
    e.preventDefault();
    if (!code.trim()) { setErr('Enter a code from your authenticator app, or a recovery code.'); return; }
    setBusy(true); setErr('');
    try { await onSubmit(code.trim()); } catch (e2) { setErr(doneWith(e2)); setBusy(false); }
  };
  return (
    <Modal small title={title} onClose={busy ? () => {} : onClose}
      footer={(<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="pr-code-form" className={`dh-btn ${danger ? 'danger' : 'primary'}`} disabled={busy}>{busy ? 'Checking…' : confirm}</button></>)}>
      <form id="pr-code-form" onSubmit={go} noValidate>
        <ErrText>{err}</ErrText>
        {children}
        <Field label={label}><input className="dh-input pr-otp" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={20} placeholder="123456" aria-label="Authenticator code" /></Field>
      </form>
    </Modal>
  );
}

export default function MfaSetup({ forced, onDone }) {
  const { me, reloadMe, toast } = usePractice();
  const st = useAsync((signal) => pr.get('/mfa', null, signal), []);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [codes, setCodes] = useState(null);
  const [modal, setModal] = useState(null);
  const s = st.data;
  const done = () => { st.reload(); reloadMe?.(); onDone?.(); };

  const begin = async () => {
    setBusy(true); setErr('');
    try { setSetup(await pr.post('/mfa/setup')); setCode(''); } catch (e) { setErr(doneWith(e)); } finally { setBusy(false); }
  };
  const enable = async (e) => {
    e.preventDefault();
    if (code.replace(/\s/g, '').length < 6) { setErr('Enter the 6-digit code from your app.'); return; }
    setBusy(true); setErr('');
    try { const r = await pr.post('/mfa/enable', { code: code.replace(/\s/g, '') }); setSetup(null); setCodes(r.recovery_codes); st.reload(); } catch (e2) { setErr(doneWith(e2)); } finally { setBusy(false); }
  };

  const body = (() => {
    if (codes) return <RecoveryCodes codes={codes} onDone={() => { setCodes(null); toast('Two-step sign-in is on'); done(); }} />;
    if (!s) return st.error ? <ErrorBox error={st.error} retry={st.reload} compact /> : <Loading />;
    if (setup) {
      return (
        <form onSubmit={enable} noValidate>
          <ErrText>{err}</ErrText>
          <ol style={{ margin: '0 0 14px', paddingLeft: 20, lineHeight: 1.7 }}>
            <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…).</li>
            <li>Scan the code below, or choose “enter a setup key” and type the key.</li>
            <li>Type the 6-digit number the app shows.</li>
          </ol>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 14 }}>
            {setup.qr ? <div className="pr-qr" dangerouslySetInnerHTML={{ __html: setup.qr }} aria-label="QR code for your authenticator app" role="img" /> : null}
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="pr-note" style={{ marginTop: 0 }}>Setup key</div>
              <div className="pr-secret">{setup.secret}</div>
              {!setup.qr ? <p className="pr-note">A QR code is not available on this server, so enter the key by hand.</p> : null}
            </div>
          </div>
          <Field label="6-digit code"><input className="dh-input pr-otp" style={{ maxWidth: 240 }} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123456" autoFocus aria-label="6-digit code" /></Field>
          <div className="pr-actions"><button type="submit" className="dh-btn primary" disabled={busy}>{busy ? 'Checking…' : 'Turn on two-step sign-in'}</button><button type="button" className="dh-btn ghost" onClick={() => { setSetup(null); setErr(''); }} disabled={busy}>Back</button></div>
        </form>
      );
    }
    if (s.enabled) {
      return (
        <>
          <div className="pr-actions" style={{ marginBottom: 12 }}><span className="pr-pill good"><PIcon name="shield" />Two-step sign-in is on</span><span className="pr-pill">{s.recovery_left} recovery code{s.recovery_left === 1 ? '' : 's'} left</span></div>
          <p className="pr-note" style={{ marginTop: 0 }}>After your password, you enter a 6-digit code from your authenticator app. Your recovery codes work once each if you lose your phone.</p>
          <div className="pr-actions" style={{ marginTop: 12 }}>
            <button type="button" className="dh-btn ghost" onClick={() => setModal('recovery')}><PIcon name="key" />Get new recovery codes</button>
            <button type="button" className="dh-btn danger" onClick={() => setModal('off')} disabled={s.required} title={s.required ? 'Your practice requires it' : undefined}>Turn off</button>
          </div>
          {s.required ? <p className="pr-note">Your practice requires two-step sign-in, so it cannot be turned off.</p> : null}
        </>
      );
    }
    return (
      <>
        <ErrText>{err}</ErrText>
        {forced ? <div className="dh-banner rust" style={{ marginBottom: 14 }}><PIcon name="shield" /><div className="body"><b>{me?.firm?.name || 'Your practice'} requires two-step sign-in.</b> Set it up once and you can continue. It takes about a minute.</div></div> : <p className="pr-note" style={{ marginTop: 0 }}>Add a second step to your sign-in: a 6-digit code from an authenticator app on your phone. It protects client information even if your password leaks.</p>}
        <button type="button" className="dh-btn primary" onClick={begin} disabled={busy}>{busy ? 'Starting…' : 'Set up two-step sign-in'}</button>
      </>
    );
  })();

  return (
    <div className={forced ? 'pr-center' : undefined}>
      {forced ? <div style={{ marginBottom: 14 }}><h2 className="dh-title">Set up two-step sign-in</h2></div> : null}
      {forced ? <div className="pr-card" style={{ padding: 18 }}>{body}</div> : <Card title="Two-step sign-in">{body}</Card>}
      {modal === 'off' ? (
        <CodeModal title="Turn off two-step sign-in" label="Code from your app (or a recovery code)" danger confirm="Turn off" onClose={() => setModal(null)}
          onSubmit={async (c) => { await pr.post('/mfa/disable', { code: c }); toast('Two-step sign-in turned off'); setModal(null); done(); }}>
          <p style={{ marginTop: 0 }}>Enter a current code to confirm it is you.</p>
        </CodeModal>
      ) : null}
      {modal === 'recovery' ? (
        <CodeModal title="New recovery codes" label="Code from your app" confirm="Create new codes" onClose={() => setModal(null)}
          onSubmit={async (c) => { const r = await pr.post('/mfa/recovery', { code: c }); setModal(null); setCodes(r.recovery_codes); st.reload(); }}>
          <p style={{ marginTop: 0 }}>This replaces your old recovery codes. Enter a current code to confirm.</p>
        </CodeModal>
      ) : null}
    </div>
  );
}
