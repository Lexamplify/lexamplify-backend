import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { downloadDocument } from '../services/draftApi.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const STYLES = `
.cc { max-width: 820px; margin: 0 auto; padding: clamp(20px, 4vw, 48px) clamp(16px, 4vw, 32px) 80px; color: var(--ink); }
.cc * { box-sizing: border-box; }
.cc h1 { font-family: 'Fraunces', Georgia, serif; font-weight: 400; font-size: clamp(28px, 4.2vw, 40px); line-height: 1.1; letter-spacing: -.018em; margin: 0 0 8px; outline: none; }
.cc a { color: var(--accent-ink); }
.cc-lede { margin: 0 0 24px; color: var(--ink-soft); font-size: 15.5px; line-height: 1.6; max-width: 600px; }
.cc-form { display: grid; gap: 16px; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 14px; padding: 20px; }
.cc label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.cc-hint { font-size: 12.5px; color: var(--muted); margin-top: 4px; }
.cc-in { width: 100%; font: inherit; font-size: 15px; padding: 11px 12px; min-height: 44px; border: 1px solid var(--rule); border-radius: 8px; background: var(--paper); color: var(--ink); }
.cc-in:focus-visible, .cc-btn:focus-visible, .cc-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.cc-btn { min-height: 44px; padding: 0 22px; border-radius: 10px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); font: inherit; font-size: 15px; cursor: pointer; }
.cc-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; }
.cc-btn[disabled] { opacity: .55; cursor: not-allowed; }
.cc-link { background: none; border: 0; padding: 0; font: inherit; font-size: 13.5px; color: var(--ink-soft); text-decoration: underline; cursor: pointer; min-height: 44px; }
.cc-banner { margin: 26px 0 16px; padding: 16px 18px; border-radius: 12px; border: 1px solid var(--rule); font-size: 15.5px; line-height: 1.5; }
.cc-banner b { display: block; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 4px; }
.cc-banner.conflict { border-color: #b3261e; background: color-mix(in srgb, #b3261e 8%, var(--paper)); }
.cc-banner.possible { border-color: #c98a1a; background: color-mix(in srgb, #c98a1a 9%, var(--paper)); }
.cc-banner.clear { border-color: #2e7d4f; background: color-mix(in srgb, #2e7d4f 8%, var(--paper)); }
.cc-banner.no_records { border-color: var(--rule); background: var(--paper-2); }
.cc-card { border: 1px solid var(--rule); border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; background: var(--paper); }
.cc-card.conflict { border-left: 4px solid #b3261e; } .cc-card.possible { border-left: 4px solid #c98a1a; } .cc-card.info { border-left: 4px solid var(--rule); }
.cc-card p { margin: 0 0 6px; font-size: 14.5px; line-height: 1.55; }
.cc-meta { font-size: 12.5px; color: var(--muted); line-height: 1.6; }
.cc-limits { margin-top: 22px; font-size: 12.5px; color: var(--muted); line-height: 1.6; }
.cc-limits ul { margin: 6px 0 0; padding-left: 18px; }
.cc-err { margin: 16px 0; padding: 12px 14px; border: 1px solid #b3261e; border-radius: 10px; background: color-mix(in srgb, #b3261e 7%, var(--paper)); font-size: 14px; line-height: 1.5; }
.cc-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 14px; }
@media (max-width: 720px) { .cc-actions .cc-btn { width: 100%; } }
`;

const LABEL = { conflict: 'Possible conflict', possible: 'Please check', clear: 'No match found', no_records: 'Nothing to check against' };

async function check(client, opposing) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`${API_BASE}/api/practice/conflicts/check`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ client_name: client, opposing_names: opposing }),
    });
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      if (body && body.code === 'NO_FIRM') return { error: 'You have not set up your practice yet. Set it up and add your clients and cases first. Without them there is nothing to check against.', noFirm: true };
      if (res.status === 401 || res.status === 403) return { error: (body && body.message) || 'Your session has expired. Please sign in again.' };
      if (res.status === 429) return { error: 'Too many checks in a short time. Please wait a minute and try again.' };
      if (res.status >= 500) return { error: 'Something went wrong on our side. Please try again in a moment.' };
      return { error: (body && typeof body.message === 'string' && body.message) || 'That did not work. Please check the names and try again.' };
    }
    return { result: body };
  } catch (e) {
    if (e && e.name === 'AbortError') return { error: 'The server is taking too long to answer. It may be waking up. Please try again in a few seconds.' };
    return { error: 'We could not reach the server. Check your internet connection and try again.' };
  } finally { clearTimeout(timer); }
}

export default function ConflictCheck() {
  const [client, setClient] = useState('');
  const [others, setOthers] = useState(['']);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [note, setNote] = useState('');
  const headRef = useRef(null);

  const names = others.map((n) => n.trim()).filter(Boolean);
  const canRun = (client.trim() || names.length) && !busy;

  const run = async (e) => {
    e.preventDefault();
    if (!canRun) return;
    setBusy(true); setOut(null); setNote('');
    const r = await check(client.trim(), names);
    setOut(r); setBusy(false);
    setTimeout(() => headRef.current && headRef.current.focus({ preventScroll: false }), 50);
  };

  const saveRecord = async () => {
    const r = out && out.result;
    if (!r) return;
    const when = new Intl.DateTimeFormat('en-IN', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date());
    const blocks = [
      { type: 'title', text: 'RECORD OF CONFLICT CHECK' },
      { type: 'para', text: `Date and time: ${when}` },
      { type: 'para', text: `Name checked (the person asking you to act): ${r.checked.client || 'not given'}` },
      { type: 'para', text: `Other side: ${r.checked.opposing.length ? r.checked.opposing.join('; ') : 'not given'}` },
      { type: 'para', bold: true, text: `Result: ${LABEL[r.status]}. ${r.headline}` },
      { type: 'para', text: `Searched in Practice: ${r.searched.clients} clients, ${r.searched.cases} cases, ${r.searched.parties} parties.` },
      ...r.findings.map((f, i) => ({ type: 'numbered', number: i + 1, text: `${f.message} (${f.record.type === 'case' ? (f.record.visible ? `${f.record.title}, ${f.record.case_no}, ${f.record.court}` : 'restricted matter') : 'client record'}; ${f.match.why})` })),
      { type: 'heading', text: 'Limits of this check' },
      ...r.limits.map((l) => ({ type: 'para', text: l })),
    ];
    try {
      await downloadDocument({ title: 'Conflict check record', blocks }, 'docx');
      setNote('Saved. Keep the file with the matter.');
    } catch (e) { setNote(e.message); }
  };

  const result = out && out.result;
  return (
    <section className="cc" aria-labelledby="cc-h">
      <style>{STYLES}</style>
      <h1 id="cc-h">Check for a conflict of interest</h1>
      <p className="cc-lede">Before you take a new matter, we compare the names against your own clients, cases and parties in Practice. Nothing outside your firm is searched.</p>

      <form className="cc-form" onSubmit={run}>
        <div>
          <label htmlFor="cc-client">Who wants to hire you?</label>
          <input id="cc-client" className="cc-in" value={client} onChange={(e) => setClient(e.target.value)} maxLength={160} placeholder="For example: M/s Sundaram Agencies" autoComplete="off" />
        </div>
        <div>
          <label htmlFor="cc-other-0">Who is on the other side?</label>
          {others.map((n, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <input id={`cc-other-${i}`} className="cc-in" aria-label={`Name of the other side ${i + 1}`} value={n} maxLength={160} autoComplete="off" placeholder={i === 0 ? 'For example: M/s Kumar Traders Pvt Ltd' : 'Another name'}
                onChange={(e) => setOthers((o) => o.map((x, k) => (k === i ? e.target.value : x)))} />
            </div>
          ))}
          {others.length < 3 && <button type="button" className="cc-link" onClick={() => setOthers((o) => [...o, ''])}>Add another name</button>}
          <div className="cc-hint">Optional, but needed to find out whether you already act for the other side.</div>
        </div>
        <div><button type="submit" className="cc-btn primary" disabled={!canRun}>{busy ? 'Checking…' : 'Check names'}</button></div>
      </form>

      {out && out.error && (
        <div className="cc-err" role="alert">
          {out.error}{out.noFirm ? <> <Link to="/practice">Open Practice</Link></> : null}
        </div>
      )}

      {result && (
        <div aria-live="polite">
          <div className={`cc-banner ${result.status}`} role="status">
            <b ref={headRef} tabIndex={-1}>{LABEL[result.status]}</b>
            {result.headline}
            {result.status === 'no_records' && <div className="cc-actions"><Link className="cc-btn primary" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }} to="/practice/clients">Add your clients</Link><Link className="cc-btn" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }} to="/practice/cases">Add a case</Link></div>}
          </div>

          {result.findings.map((f, i) => (
            <article key={i} className={`cc-card ${f.level}`}>
              <p><b>{f.message}</b></p>
              <div className="cc-meta">
                You typed “{f.checked_name}”; your records have “{f.matched_name}”. {f.match.why}
                {f.record.type === 'case' && f.record.visible && <> Matter: <Link to={`/practice/cases/${f.record.case_id}`}>{f.record.title}</Link>, {f.record.case_no}, {f.record.court}{f.record.closed ? ' (closed)' : ''}.</>}
                {f.record.type === 'case' && !f.record.visible && <> This is a restricted matter. Ask your Senior Advocate for details.</>}
                {f.record.type === 'client' && <> <Link to={`/practice/clients/${f.record.client_id}`}>Open the client record</Link>.</>}
              </div>
            </article>
          ))}

          {result.status !== 'no_records' && (
            <div className="cc-actions">
              <button type="button" className="cc-btn" onClick={saveRecord}>Save a record of this check (Word)</button>
              {note && <span role="status" className="cc-meta">{note}</span>}
            </div>
          )}

          <div className="cc-limits">
            Searched {result.searched.clients} clients, {result.searched.cases} cases and {result.searched.parties} parties.
            <ul>{result.limits.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </div>
        </div>
      )}
    </section>
  );
}
